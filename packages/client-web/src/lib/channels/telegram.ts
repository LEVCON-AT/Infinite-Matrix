// Welle WV.D.x — Telegram-Provider via Bot API.
//
// Konzept §13.4 + plan-welle-d.md §4.1.
//
// Doku: https://core.telegram.org/bots/api
// Endpoints (alle https://api.telegram.org/bot<TOKEN>/...):
//   /getMe                                 — Test-Connect.
//   /getUpdates                            — Liste Updates (Messages).
//   /sendMessage                           — Senden an chat_id.
//
// Auth: Token im URL-Path (kein Header). Format „123456:ABC-DEF".
// User legt das Bot via @BotFather an, paste Token im Manual-Setup.
//
// CORS: api.telegram.org blockiert browser-direkten Zugriff (kein
// Access-Control-Allow-Origin). V1-Limit: testConnect funktioniert
// nicht im Browser. listInboxes/Messages auch nicht.
//
// Lib existiert als Stub damit Provider-Slot + Token-Storage funktioniert.
// Volle Browser-direkte Funktionalitaet erfordert Server-Side-Proxy
// (D.3.f.2-Service-Erweiterung mit /api/telegram-proxy/<method>-Routes).

import { getBearerToken } from './token';
import type {
  ChannelComposeInput,
  ChannelInbox,
  ChannelMessage,
  ChannelProviderImpl,
} from './types';

const API_BASE = 'https://api.telegram.org';

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; title?: string; first_name?: string; type: string };
    from?: { id: number; first_name?: string; username?: string };
    text?: string;
    date: number;
  };
};

async function telegramCall<T>(method: string, query?: Record<string, string>): Promise<T> {
  const token = await getBearerToken('telegram');
  const url = new URL(`${API_BASE}/bot${token}/${method}`);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`telegram:${res.status}:${errBody.slice(0, 120)}`);
  }
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok || json.result === undefined) {
    throw new Error(`telegram:${json.description ?? 'unknown'}`);
  }
  return json.result;
}

export const telegramProvider: ChannelProviderImpl = {
  provider: 'telegram',

  async listInboxes(): Promise<ChannelInbox[]> {
    // Telegram-Bot-API liefert keine direkte Chat-Liste — chat_ids
    // werden ueber getUpdates entdeckt (User schreibt zuerst an Bot).
    // V1: getUpdates iterieren, distinct chat-ids extrahieren.
    const updates = await telegramCall<TelegramUpdate[]>('getUpdates', { limit: '100' });
    const chats = new Map<number, ChannelInbox>();
    for (const u of updates) {
      if (!u.message) continue;
      const c = u.message.chat;
      if (chats.has(c.id)) continue;
      const name = c.title ?? c.first_name ?? `chat_${c.id}`;
      chats.set(c.id, {
        id: String(c.id),
        name,
        description: c.type,
      });
    }
    return Array.from(chats.values());
  },

  async listMessages(inboxId: string, limit?: number): Promise<ChannelMessage[]> {
    const effectiveLimit = limit ?? 20;
    const updates = await telegramCall<TelegramUpdate[]>('getUpdates', {
      limit: String(Math.max(1, Math.min(100, effectiveLimit * 3))),
    });
    const filtered = updates
      .filter(
        (u): u is TelegramUpdate & { message: NonNullable<TelegramUpdate['message']> } =>
          Boolean(u.message) && String(u.message?.chat.id) === inboxId,
      )
      .slice(-effectiveLimit)
      .reverse();
    return filtered.map((u) => {
      const m = u.message;
      const fromName = m.from?.username || m.from?.first_name || 'unbekannt';
      return {
        id: String(m.message_id),
        inboxId,
        fromName,
        fromAddress: m.from?.id ? String(m.from.id) : undefined,
        bodyText: m.text ?? '',
        receivedAt: new Date(m.date * 1000).toISOString(),
      };
    });
  },

  async sendMessage(input: ChannelComposeInput): Promise<{ id: string }> {
    const result = await telegramCall<{ message_id: number }>('sendMessage', {
      chat_id: input.inboxId,
      text: input.bodyText,
    });
    return { id: String(result.message_id) };
  },

  async testConnect(): Promise<{ ok: true; profileLabel: string } | { ok: false; reason: string }> {
    try {
      const me = await telegramCall<{ username?: string; first_name?: string; id: number }>(
        'getMe',
      );
      const label = me.username ? `@${me.username}` : (me.first_name ?? `bot_${me.id}`);
      return { ok: true, profileLabel: label };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: msg };
    }
  },
};
