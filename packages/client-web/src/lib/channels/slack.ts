// Welle WV.D.3 — Slack-Provider-Implementierung.
//
// Konzept §13.4 (Messenger-Bridge) + plan-welle-d.md §4.1.
//
// Slack-Web-API-Doku: https://api.slack.com/web
// Endpoints (alle https://slack.com/api/<method>):
//   conversations.list   — Liste Channels.
//   conversations.history — Liste Messages eines Channels.
//   users.info           — User-Info fuer „from"-Namen-Resolve.
//   chat.postMessage     — Nachricht senden.
//   auth.test            — Test-Connect (verifiziert Token).
//
// Auth: `Authorization: Bearer xoxp-...` oder `xoxb-...` (Bot/User).
// CORS: Slack erlaubt browser-direkten Zugriff auf api.slack.com seit
// 2020 — kein Proxy noetig.
//
// V1-Constraint: Read-only fuer Bots (xoxb), full fuer xoxp. Wir
// unterscheiden V1 nicht — wir liefern was der Token kann.

import { getBearerToken } from './token';
import type {
  ChannelComposeInput,
  ChannelInbox,
  ChannelMessage,
  ChannelProviderImpl,
} from './types';

const SLACK_API = 'https://slack.com/api';

type SlackChannel = {
  id: string;
  name: string;
  topic?: { value?: string };
  purpose?: { value?: string };
  unread_count?: number;
};

type SlackMessage = {
  ts: string;
  user?: string;
  text?: string;
  thread_ts?: string;
  client_msg_id?: string;
  bot_id?: string;
  username?: string;
};

type SlackUser = {
  id: string;
  real_name?: string;
  profile?: { display_name?: string; real_name?: string };
};

// User-Cache pro Page-Load. Slack-User-IDs werden bei jedem
// listMessages-Call resolved — Cache verhindert N+1 fuer dieselbe
// Channel-History.
const userCache = new Map<string, SlackUser>();

async function slackGet<T>(method: string, params: Record<string, string>): Promise<T> {
  const token = await getBearerToken('slack');
  const url = new URL(`${SLACK_API}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!json.ok) {
    throw new Error(`slack:${json.error ?? 'unknown_error'}`);
  }
  return json;
}

async function slackPost<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = await getBearerToken('slack');
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!json.ok) {
    throw new Error(`slack:${json.error ?? 'unknown_error'}`);
  }
  return json;
}

async function resolveUser(userId: string): Promise<SlackUser | null> {
  if (!userId) return null;
  const cached = userCache.get(userId);
  if (cached) return cached;
  try {
    const json = await slackGet<{ user: SlackUser }>('users.info', { user: userId });
    userCache.set(userId, json.user);
    return json.user;
  } catch {
    return null;
  }
}

function userDisplayName(u: SlackUser | null, fallback: string): string {
  if (!u) return fallback;
  return u.profile?.display_name || u.profile?.real_name || u.real_name || u.id;
}

export const slackProvider: ChannelProviderImpl = {
  provider: 'slack',

  async listInboxes(): Promise<ChannelInbox[]> {
    const json = await slackGet<{ channels: SlackChannel[] }>('conversations.list', {
      types: 'public_channel,private_channel',
      limit: '200',
      exclude_archived: 'true',
    });
    return (json.channels ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      description: c.topic?.value || c.purpose?.value || undefined,
      unreadCount: c.unread_count,
    }));
  },

  async listMessages(inboxId: string, limit?: number, since?: string): Promise<ChannelMessage[]> {
    const effectiveLimit = limit ?? 20;
    const params: Record<string, string> = {
      channel: inboxId,
      limit: String(Math.max(1, Math.min(100, effectiveLimit))),
    };
    if (since) {
      // Slack nutzt ts (Unix-Sekunden) als Cursor. Convert ISO → Unix.
      params.oldest = String(Math.floor(new Date(since).getTime() / 1000));
    }
    const json = await slackGet<{ messages: SlackMessage[] }>('conversations.history', params);
    const messages = json.messages ?? [];

    // User-IDs in einer Runde resolved (deduped per Cache).
    const userIds = new Set<string>();
    for (const m of messages) if (m.user) userIds.add(m.user);
    await Promise.all(Array.from(userIds).map((id) => resolveUser(id)));

    return messages.map((m) => {
      const user = m.user ? (userCache.get(m.user) ?? null) : null;
      const tsMs = Math.floor(Number.parseFloat(m.ts) * 1000);
      return {
        id: m.ts,
        inboxId,
        fromName: userDisplayName(user, m.username || m.bot_id || 'Unknown'),
        fromAddress: m.user,
        bodyText: m.text ?? '',
        receivedAt: new Date(tsMs).toISOString(),
        threadId: m.thread_ts,
        externalUrl: undefined, // Slack-Permalink-API nicht V1.
      };
    });
  },

  async sendMessage(input: ChannelComposeInput): Promise<{ id: string }> {
    // Slack hat ein Channel-Concept; `to` ist hier ignoriert (Channel-ID
    // ist inboxId). thread_ts wenn replyToMessageId gesetzt.
    const body: Record<string, unknown> = {
      channel: input.inboxId,
      text: input.bodyText,
    };
    if (input.replyToMessageId) body.thread_ts = input.replyToMessageId;
    const json = await slackPost<{ ts: string }>('chat.postMessage', body);
    return { id: json.ts };
  },

  async testConnect(): Promise<{ ok: true; profileLabel: string } | { ok: false; reason: string }> {
    try {
      const json = await slackGet<{ team: string; user: string }>('auth.test', {});
      return { ok: true, profileLabel: `${json.user} @ ${json.team}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: msg };
    }
  },
};
