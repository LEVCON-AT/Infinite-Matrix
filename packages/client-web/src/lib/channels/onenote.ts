// Welle WV.D.4 V1 — OneNote-Provider via Microsoft Graph.
//
// Konzept §13.2 + plan-welle-d.md §4.2.
//
// V1-Strategie: OneNote als ChannelProvider implementieren. listInboxes
// liefert Notebooks; listMessages liefert Pages eines Notebooks (statt
// Sections — V1-Vereinfachung). sendMessage erstellt eine neue Page.
//
// Bidirektionaler Sync (Polling, Last-Write-Wins) deferred D.4.b mit
// Doc-Atom-Mapping. V1 zeigt nur Page-Liste + Click → externalUrl.
//
// Endpoints (alle https://graph.microsoft.com/v1.0/me/onenote/...):
//   /notebooks                          — Notebooks-Liste.
//   /notebooks/{id}/sections            — Sections eines Notebooks.
//   /sections/{id}/pages                — Pages einer Section.
//   /pages                              — Alle Pages (search-friendly).
//   POST /sections/{id}/pages           — Page erstellen.

import { getBearerToken } from './token';
import type {
  ChannelComposeInput,
  ChannelInbox,
  ChannelMessage,
  ChannelProviderImpl,
} from './types';

const GRAPH_API = 'https://graph.microsoft.com/v1.0/me/onenote';

type Notebook = {
  id: string;
  displayName: string;
};

type Page = {
  id: string;
  title?: string;
  contentUrl?: string;
  links?: { oneNoteWebUrl?: { href?: string }; oneNoteClientUrl?: { href?: string } };
  lastModifiedDateTime?: string;
  parentSection?: { id: string; displayName?: string };
  parentNotebook?: { id: string; displayName?: string };
};

async function graphGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  const token = await getBearerToken('onenote');
  const url = new URL(`${GRAPH_API}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`onenote:graph_${res.status}:${errBody.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

async function graphPost(
  path: string,
  body: string,
  contentType = 'application/xhtml+xml',
): Promise<Page> {
  const token = await getBearerToken('onenote');
  const res = await fetch(`${GRAPH_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body,
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`onenote:graph_${res.status}:${errBody.slice(0, 120)}`);
  }
  return (await res.json()) as Page;
}

export const onenoteProvider: ChannelProviderImpl = {
  provider: 'onenote',

  async listInboxes(): Promise<ChannelInbox[]> {
    // V1: Inboxes = Notebooks. Sections-Granularitaet kommt mit D.4.b.
    const json = await graphGet<{ value: Notebook[] }>('/notebooks', {
      $top: '50',
      $orderby: 'displayName',
    });
    return (json.value ?? []).map((n) => ({
      id: n.id,
      name: n.displayName,
    }));
  },

  async listMessages(inboxId: string, limit?: number): Promise<ChannelMessage[]> {
    const effectiveLimit = limit ?? 20;
    // Pages aus dem Notebook (Filter via parentNotebook). Microsoft Graph
    // erlaubt $filter auf parentNotebook/id == '<id>' mit eq.
    const json = await graphGet<{ value: Page[] }>('/pages', {
      $top: String(Math.max(1, Math.min(50, effectiveLimit))),
      $orderby: 'lastModifiedDateTime desc',
      $filter: `parentNotebook/id eq '${inboxId}'`,
      $expand: 'parentSection',
    });
    return (json.value ?? []).map((p) => ({
      id: p.id,
      inboxId,
      fromName: p.parentSection?.displayName ?? 'OneNote',
      bodyText: p.title ?? '(unbenannt)',
      subject: p.title,
      receivedAt: p.lastModifiedDateTime ?? new Date().toISOString(),
      externalUrl: p.links?.oneNoteWebUrl?.href ?? p.links?.oneNoteClientUrl?.href,
      threadId: p.parentSection?.id,
    }));
  },

  async sendMessage(input: ChannelComposeInput): Promise<{ id: string; externalUrl?: string }> {
    // OneNote braucht Section-ID, nicht Notebook-ID. inboxId-Format:
    // V1 expectet Section-ID. UI darf eines auswaehlen.
    // ABER: Wir kriegen Notebook-ID. Erste Section nehmen.
    let sectionId = input.inboxId;
    try {
      const sections = await graphGet<{ value: Array<{ id: string }> }>(
        `/notebooks/${input.inboxId}/sections`,
      );
      sectionId = sections.value?.[0]?.id ?? input.inboxId;
    } catch {
      // Fall through — vielleicht ist inboxId schon eine Section-ID.
    }
    const html = `<!DOCTYPE html>
<html>
<head><title>${escapeHtml(input.subject ?? '(neu)')}</title></head>
<body><p>${escapeHtml(input.bodyText)}</p></body>
</html>`;
    const page = await graphPost(`/sections/${sectionId}/pages`, html);
    return {
      id: page.id,
      externalUrl: page.links?.oneNoteWebUrl?.href ?? page.links?.oneNoteClientUrl?.href,
    };
  },

  async testConnect(): Promise<{ ok: true; profileLabel: string } | { ok: false; reason: string }> {
    try {
      const json = await graphGet<{ value: Notebook[] }>('/notebooks', { $top: '1' });
      const first = json.value?.[0];
      return { ok: true, profileLabel: first ? first.displayName : 'OneNote (leer)' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: msg };
    }
  },
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
