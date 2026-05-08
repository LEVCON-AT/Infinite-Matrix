// Welle WV.D.3 — Microsoft Teams-Provider-Implementierung.
//
// Konzept §13.4 (Messenger-Bridge) + plan-welle-d.md §4.1.
//
// Microsoft-Graph-Doku: https://learn.microsoft.com/en-us/graph/api/resources/teams-api-overview
// Endpoints (alle https://graph.microsoft.com/v1.0/...):
//   /me/chats                        — Liste meiner Chats.
//   /me/chats/{chat-id}/messages     — Liste/Post Messages eines Chats.
//   /me                              — Test-Connect.
//
// Auth: `Authorization: Bearer <ms-oauth-token>` mit Scope
// `Chat.Read,Chat.ReadWrite,User.Read`. Token kommt aus user_oauth_tokens
// mit provider='teams' (Microsoft-Single-Identity — Teams + Outlook
// nutzen verschiedene Provider-Slots aber ggfs. denselben Token wenn
// User mit selber MS-Identitaet verbunden hat).
//
// CORS: graph.microsoft.com unterstuetzt CORS fuer browser-direkten
// Zugriff seit 2018 — kein Proxy noetig.

import { getBearerToken } from './token';
import type {
  ChannelComposeInput,
  ChannelInbox,
  ChannelMessage,
  ChannelProviderImpl,
} from './types';

const GRAPH_API = 'https://graph.microsoft.com/v1.0';

type GraphChat = {
  id: string;
  topic?: string | null;
  chatType?: 'oneOnOne' | 'group' | 'meeting' | 'unknownFutureValue';
  members?: Array<{ displayName?: string }>;
};

type GraphMessage = {
  id: string;
  createdDateTime: string;
  body?: { content?: string; contentType?: 'text' | 'html' };
  from?: { user?: { displayName?: string; id?: string } };
  webUrl?: string;
};

type GraphUser = {
  id: string;
  displayName: string;
  userPrincipalName?: string;
};

async function graphGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  const token = await getBearerToken('teams');
  const url = new URL(`${GRAPH_API}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`teams:graph_${res.status}:${errBody.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

async function graphPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = await getBearerToken('teams');
  const res = await fetch(`${GRAPH_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`teams:graph_${res.status}:${errBody.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

function chatLabel(chat: GraphChat): string {
  if (chat.topic) return chat.topic;
  if (chat.chatType === 'oneOnOne') {
    const other = chat.members?.find((m) => m.displayName);
    if (other?.displayName) return other.displayName;
  }
  if (chat.chatType === 'group' && chat.members) {
    const names = chat.members
      .map((m) => m.displayName)
      .filter((n): n is string => Boolean(n))
      .slice(0, 3);
    if (names.length > 0) return names.join(', ');
  }
  return chat.id;
}

// Strip HTML for snippet preview. Graph kann HTML-Body liefern; Plain
// Text ist Fallback. Conservative: nur Tags entfernen, Entities
// werden in der List-Sicht via DOM-Renderer eh dargestellt.
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

export const teamsProvider: ChannelProviderImpl = {
  provider: 'teams',

  async listInboxes(): Promise<ChannelInbox[]> {
    const json = await graphGet<{ value: GraphChat[] }>('/me/chats', {
      $expand: 'members',
      $top: '50',
    });
    return (json.value ?? []).map((c) => ({
      id: c.id,
      name: chatLabel(c),
      description: c.chatType === 'oneOnOne' ? '1:1' : (c.chatType ?? undefined),
    }));
  },

  async listMessages(inboxId: string, limit?: number): Promise<ChannelMessage[]> {
    const effectiveLimit = limit ?? 20;
    const json = await graphGet<{ value: GraphMessage[] }>(`/me/chats/${inboxId}/messages`, {
      $top: String(Math.max(1, Math.min(50, effectiveLimit))),
      $orderby: 'createdDateTime desc',
    });
    return (json.value ?? []).map((m) => {
      const isHtml = m.body?.contentType === 'html';
      const raw = m.body?.content ?? '';
      return {
        id: m.id,
        inboxId,
        fromName: m.from?.user?.displayName ?? 'Unbekannt',
        fromAddress: m.from?.user?.id,
        bodyText: isHtml ? htmlToText(raw) : raw,
        bodyHtml: isHtml ? raw : undefined,
        receivedAt: m.createdDateTime,
        externalUrl: m.webUrl,
      };
    });
  },

  async sendMessage(input: ChannelComposeInput): Promise<{ id: string; externalUrl?: string }> {
    const json = await graphPost<{ id: string; webUrl?: string }>(
      `/me/chats/${input.inboxId}/messages`,
      {
        body: {
          content: input.bodyText,
          contentType: 'text',
        },
      },
    );
    return { id: json.id, externalUrl: json.webUrl };
  },

  async testConnect(): Promise<{ ok: true; profileLabel: string } | { ok: false; reason: string }> {
    try {
      const me = await graphGet<GraphUser>('/me');
      return { ok: true, profileLabel: me.userPrincipalName || me.displayName };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: msg };
    }
  },
};
