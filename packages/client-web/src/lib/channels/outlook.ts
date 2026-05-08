// Welle WV.D.3.e — Outlook-Mail-Provider via Microsoft Graph.
//
// Konzept §13.1 (Mail-Bridge) + plan-welle-d.md §4.1.
//
// Microsoft-Graph-Doku: https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview
// Endpoints (alle https://graph.microsoft.com/v1.0/...):
//   /me/mailFolders                          — Liste der Folder (INBOX, Sent, Drafts, ...).
//   /me/mailFolders/{id}/messages            — Messages eines Folders.
//   /me/sendMail                             — Mail senden.
//   /me                                      — Test-Connect.
//
// Auth: `Authorization: Bearer <ms-oauth-token>` mit Scope
// `Mail.Read,Mail.Send,User.Read`. Gleicher Token-Storage-Pfad wie
// `teams` (Migration 077: provider-ENUM 'outlook'). Tokens sind aber
// PRO-PROVIDER getrennt — User kann teams + outlook unabhaengig
// verbinden (oder mit demselben MS-Account beide).
//
// CORS: graph.microsoft.com unterstuetzt CORS — kein Proxy.

import { getBearerToken } from './token';
import type {
  ChannelComposeInput,
  ChannelInbox,
  ChannelMessage,
  ChannelProviderImpl,
} from './types';

const GRAPH_API = 'https://graph.microsoft.com/v1.0';

type GraphMailFolder = {
  id: string;
  displayName: string;
  parentFolderId?: string;
  unreadItemCount?: number;
  totalItemCount?: number;
};

type GraphMailMessage = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string; contentType?: 'text' | 'html' };
  receivedDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  conversationId?: string;
  webLink?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
};

type GraphUser = {
  id: string;
  displayName: string;
  userPrincipalName?: string;
  mail?: string;
};

async function graphGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  const token = await getBearerToken('outlook');
  const url = new URL(`${GRAPH_API}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`outlook:graph_${res.status}:${errBody.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

async function graphPost(path: string, body: Record<string, unknown>): Promise<void> {
  const token = await getBearerToken('outlook');
  const res = await fetch(`${GRAPH_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 202) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`outlook:graph_${res.status}:${errBody.slice(0, 120)}`);
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<\/p>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

export const outlookProvider: ChannelProviderImpl = {
  provider: 'outlook',

  async listInboxes(): Promise<ChannelInbox[]> {
    const json = await graphGet<{ value: GraphMailFolder[] }>('/me/mailFolders', {
      $top: '50',
      $orderby: 'displayName',
    });
    return (json.value ?? []).map((f) => ({
      id: f.id,
      name: f.displayName,
      unreadCount: f.unreadItemCount,
    }));
  },

  async listMessages(inboxId: string, limit?: number): Promise<ChannelMessage[]> {
    const effectiveLimit = limit ?? 20;
    const json = await graphGet<{ value: GraphMailMessage[] }>(
      `/me/mailFolders/${inboxId}/messages`,
      {
        $top: String(Math.max(1, Math.min(50, effectiveLimit))),
        $orderby: 'receivedDateTime desc',
        $select:
          'id,subject,bodyPreview,body,receivedDateTime,isRead,hasAttachments,conversationId,webLink,from',
      },
    );
    return (json.value ?? []).map((m) => {
      const fromName = m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? 'Unbekannt';
      const fromAddr = m.from?.emailAddress?.address;
      const isHtml = m.body?.contentType === 'html';
      const rawBody = m.body?.content ?? m.bodyPreview ?? '';
      return {
        id: m.id,
        inboxId,
        fromName,
        fromAddress: fromAddr,
        subject: m.subject || undefined,
        bodyText: isHtml ? htmlToText(rawBody) : rawBody,
        bodyHtml: isHtml ? rawBody : undefined,
        receivedAt: m.receivedDateTime ?? new Date().toISOString(),
        isUnread: m.isRead === false,
        hasAttachments: m.hasAttachments,
        threadId: m.conversationId,
        externalUrl: m.webLink,
      };
    });
  },

  async sendMessage(input: ChannelComposeInput): Promise<{ id: string }> {
    // Graph /me/sendMail nimmt eine vollstaendige Message-Resource +
    // saveToSentItems-Flag. Antwortet 202 ohne Body — wir generieren
    // eine Pseudo-ID lokal (Tab-only).
    await graphPost('/me/sendMail', {
      message: {
        subject: input.subject ?? '(ohne Betreff)',
        body: {
          contentType: 'text',
          content: input.bodyText,
        },
        toRecipients: input.to.map((addr) => ({ emailAddress: { address: addr } })),
        ccRecipients: input.cc?.map((addr) => ({ emailAddress: { address: addr } })) ?? [],
        bccRecipients: input.bcc?.map((addr) => ({ emailAddress: { address: addr } })) ?? [],
      },
      saveToSentItems: true,
    });
    return { id: `local:${Date.now()}` };
  },

  async testConnect(): Promise<{ ok: true; profileLabel: string } | { ok: false; reason: string }> {
    try {
      const me = await graphGet<GraphUser>('/me');
      return { ok: true, profileLabel: me.mail || me.userPrincipalName || me.displayName };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: msg };
    }
  },
};
