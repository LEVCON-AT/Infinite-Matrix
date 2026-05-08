// Welle WV.D.3.e — Gmail-Provider via Google API.
//
// Konzept §13.1 (Mail-Bridge) + plan-welle-d.md §4.1.
//
// Google-Doku: https://developers.google.com/gmail/api/v1/reference
// Endpoints (alle https://gmail.googleapis.com/gmail/v1/users/me/...):
//   /labels                            — Liste Labels (entspricht Foldern + Tags).
//   /messages?labelIds=<id>           — Liste Message-IDs eines Labels.
//   /messages/{id}?format=metadata     — Message-Metadata (Subject, From, Date).
//   /messages/send                     — Mail senden (RFC822-RAW base64).
//   /profile                           — Test-Connect (eigene Adresse).
//
// Auth: `Authorization: Bearer <oauth-token>` mit Scope
// `https://www.googleapis.com/auth/gmail.modify` (Read+Send) oder
// `gmail.readonly` (V1 minimal).
//
// CORS: gmail.googleapis.com erlaubt browser-direkten Zugriff —
// kein Proxy noetig.
//
// Limitierung: V1 nutzt list-then-fetch-each (N+1) fuer Message-
// Metadata. Pro Inbox → metadata-Call pro Message. 20-Limit im Default
// haelt das ueberschaubar (Gmail-Quota: 250 quota-units/sec, jeder
// metadata-call kostet 5 → 50 calls/sec headroom).

import { getBearerToken } from './token';
import type {
  ChannelComposeInput,
  ChannelInbox,
  ChannelMessage,
  ChannelProviderImpl,
} from './types';

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

type GmailLabel = {
  id: string;
  name: string;
  type?: 'system' | 'user';
  messagesUnread?: number;
};

type GmailMessageStub = {
  id: string;
  threadId?: string;
};

type GmailHeader = {
  name: string;
  value: string;
};

type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string; // unix-millis as string
  payload?: {
    headers?: GmailHeader[];
    mimeType?: string;
    body?: { data?: string };
    parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
  };
};

type GmailProfile = {
  emailAddress: string;
  messagesTotal?: number;
};

async function gmailGet<T>(path: string, query?: Record<string, string>): Promise<T> {
  const token = await getBearerToken('gmail');
  const url = new URL(`${GMAIL_API}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`gmail:${res.status}:${errBody.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

async function gmailPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = await getBearerToken('gmail');
  const res = await fetch(`${GMAIL_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`gmail:${res.status}:${errBody.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value;
}

// Gmail-Body-Decode: erst payload.body.data, sonst rekursiv durch parts.
// Format: base64url. atob mag das nicht direkt — Padding + Pluszeichen
// ergaenzen. Plain-Text bevorzugt; HTML als Fallback.
function decodeBody(payload: GmailMessage['payload']): { text: string; html?: string } {
  if (!payload) return { text: '' };
  const tryDecode = (raw: string): string => {
    try {
      const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
      const padding = b64.length % 4 ? 4 - (b64.length % 4) : 0;
      return decodeURIComponent(escape(atob(b64 + '='.repeat(padding))));
    } catch {
      return '';
    }
  };

  let text = '';
  let html: string | undefined;
  const collect = (mimeType: string | undefined, data: string | undefined): void => {
    if (!data) return;
    const decoded = tryDecode(data);
    if (mimeType === 'text/plain' && !text) text = decoded;
    else if (mimeType === 'text/html' && !html) html = decoded;
  };

  collect(payload.mimeType, payload.body?.data);
  for (const part of payload.parts ?? []) {
    collect(part.mimeType, part.body?.data);
  }

  // Fallback: html zu plain wenn nur html da
  if (!text && html) {
    text = html
      .replace(/<\/p>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }
  return { text, html };
}

// RFC822-Encode fuer /messages/send. Minimal: Subject + To + Body.
// Kein MIME-multipart V1 (Attachments deferred V2).
function encodeRfc822Mail(input: ChannelComposeInput): string {
  const lines: string[] = [];
  lines.push(`To: ${input.to.join(', ')}`);
  if (input.cc && input.cc.length > 0) lines.push(`Cc: ${input.cc.join(', ')}`);
  if (input.bcc && input.bcc.length > 0) lines.push(`Bcc: ${input.bcc.join(', ')}`);
  if (input.subject) lines.push(`Subject: ${input.subject}`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('');
  lines.push(input.bodyText);
  // Base64-URL-Encode (Gmail-Pflicht).
  const raw = lines.join('\r\n');
  return btoa(unescape(encodeURIComponent(raw)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export const gmailProvider: ChannelProviderImpl = {
  provider: 'gmail',

  async listInboxes(): Promise<ChannelInbox[]> {
    const json = await gmailGet<{ labels: GmailLabel[] }>('/labels');
    return (json.labels ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      unreadCount: l.messagesUnread,
      description: l.type === 'system' ? 'System' : undefined,
    }));
  },

  async listMessages(inboxId: string, limit?: number): Promise<ChannelMessage[]> {
    const effectiveLimit = limit ?? 20;
    const list = await gmailGet<{ messages?: GmailMessageStub[] }>('/messages', {
      labelIds: inboxId,
      maxResults: String(Math.max(1, Math.min(50, effectiveLimit))),
    });
    const stubs = list.messages ?? [];
    if (stubs.length === 0) return [];

    // Parallel-Fetch je Message-Metadata. Quota-Headroom checken (s.o.).
    const messages = await Promise.all(
      stubs.map((s) =>
        gmailGet<GmailMessage>(`/messages/${s.id}`, { format: 'full' }).catch(() => null),
      ),
    );

    return messages
      .filter((m): m is GmailMessage => m !== null)
      .map((m) => {
        const headers = m.payload?.headers;
        const subject = headerValue(headers, 'Subject');
        const fromHdr = headerValue(headers, 'From') ?? 'Unbekannt';
        // From-Format: "Name <email@host>" oder nur "email@host".
        const fromMatch = fromHdr.match(/^(.*?)\s*<([^>]+)>$/);
        const fromName = fromMatch ? fromMatch[1].trim() || fromMatch[2] : fromHdr;
        const fromAddr = fromMatch ? fromMatch[2] : undefined;
        const { text, html } = decodeBody(m.payload);
        const ts = m.internalDate ? Number.parseInt(m.internalDate, 10) : Date.now();

        return {
          id: m.id,
          inboxId,
          fromName,
          fromAddress: fromAddr,
          subject: subject || undefined,
          bodyText: text || (m.snippet ?? ''),
          bodyHtml: html,
          receivedAt: new Date(ts).toISOString(),
          isUnread: (m.labelIds ?? []).includes('UNREAD'),
          threadId: m.threadId,
          externalUrl: m.threadId
            ? `https://mail.google.com/mail/u/0/#inbox/${m.threadId}`
            : undefined,
        };
      });
  },

  async sendMessage(input: ChannelComposeInput): Promise<{ id: string }> {
    const raw = encodeRfc822Mail(input);
    const json = await gmailPost<{ id: string }>('/messages/send', { raw });
    return { id: json.id };
  },

  async testConnect(): Promise<{ ok: true; profileLabel: string } | { ok: false; reason: string }> {
    try {
      const profile = await gmailGet<GmailProfile>('/profile');
      return { ok: true, profileLabel: profile.emailAddress };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: msg };
    }
  },
};
