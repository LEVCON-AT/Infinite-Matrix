// Welle WV.D.x — Discord-Provider via Discord REST API.
//
// Konzept §13.4 + plan-welle-d.md §4.1.
//
// Doku: https://discord.com/developers/docs/reference
// Endpoints (alle https://discord.com/api/v10/...):
//   /users/@me/guilds                      — Liste der Servers (Guilds).
//   /guilds/{id}/channels                  — Channels eines Guilds.
//   /channels/{id}/messages                — Liste Messages.
//   POST /channels/{id}/messages           — Senden.
//   /users/@me                             — Test-Connect.
//
// Auth: V1 Bot-Token (Authorization: Bot <token>) ODER Bearer fuer
// User-OAuth. Wir akzeptieren beides — Token-Format-Detection im Header.
//
// CORS: discord.com/api erlaubt browser-direkten Zugriff fuer
// User-OAuth, aber nicht fuer Bot-Token (Bot-Calls sollen Server-Side
// sein). V1: User soll User-OAuth-Token nutzen. Bot-Token funktioniert
// nur via Server-Side-Proxy.

import { getBearerToken } from './token';
import type {
  ChannelComposeInput,
  ChannelInbox,
  ChannelMessage,
  ChannelProviderImpl,
} from './types';

const API = 'https://discord.com/api/v10';

type DiscordChannel = {
  id: string;
  name?: string;
  type: number;
  guild_id?: string;
};

type DiscordMessage = {
  id: string;
  content: string;
  timestamp: string;
  author: { id: string; username: string };
  channel_id: string;
};

async function discordGet<T>(path: string): Promise<T> {
  const token = await getBearerToken('discord');
  // Discord-Token-Format: Bot-Tokens sind „xxx", User-OAuth „yyy".
  // V1: User pasted entweder „Bearer-Token-string" oder „Bot xxx".
  // Wir nehmen den Token wie er ist — User soll im Setup-Modal das
  // Format eintragen (z.B. Direkt ohne Praefix → Bearer; mit „Bot "-Praefix → Bot).
  const authHeader = token.startsWith('Bot ') ? token : `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: authHeader },
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`discord:${res.status}:${errBody.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

async function discordPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = await getBearerToken('discord');
  const authHeader = token.startsWith('Bot ') ? token : `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`discord:${res.status}:${errBody.slice(0, 120)}`);
  }
  return (await res.json()) as T;
}

export const discordProvider: ChannelProviderImpl = {
  provider: 'discord',

  async listInboxes(): Promise<ChannelInbox[]> {
    // Liste aller Guilds, dann pro Guild die Channels — fuer V1 reicht
    // das. Pagination V2.
    const guilds = await discordGet<Array<{ id: string; name: string }>>('/users/@me/guilds');
    const out: ChannelInbox[] = [];
    for (const g of guilds.slice(0, 10)) {
      try {
        const channels = await discordGet<DiscordChannel[]>(`/guilds/${g.id}/channels`);
        for (const c of channels) {
          // type 0 = GUILD_TEXT, type 5 = GUILD_ANNOUNCEMENT (lesbar)
          if (c.type !== 0 && c.type !== 5) continue;
          out.push({
            id: c.id,
            name: `${g.name} / #${c.name ?? c.id}`,
            description: g.name,
          });
        }
      } catch {
        // Guild ohne Channel-Permissions — skip.
      }
    }
    return out;
  },

  async listMessages(inboxId: string, limit?: number): Promise<ChannelMessage[]> {
    const effectiveLimit = limit ?? 20;
    const json = await discordGet<DiscordMessage[]>(
      `/channels/${inboxId}/messages?limit=${Math.max(1, Math.min(100, effectiveLimit))}`,
    );
    return json.map((m) => ({
      id: m.id,
      inboxId,
      fromName: m.author.username,
      fromAddress: m.author.id,
      bodyText: m.content,
      receivedAt: m.timestamp,
    }));
  },

  async sendMessage(input: ChannelComposeInput): Promise<{ id: string }> {
    const json = await discordPost<DiscordMessage>(`/channels/${input.inboxId}/messages`, {
      content: input.bodyText,
    });
    return { id: json.id };
  },

  async testConnect(): Promise<{ ok: true; profileLabel: string } | { ok: false; reason: string }> {
    try {
      const me = await discordGet<{ id: string; username: string; discriminator?: string }>(
        '/users/@me',
      );
      const tag = me.discriminator && me.discriminator !== '0' ? `#${me.discriminator}` : '';
      return { ok: true, profileLabel: `${me.username}${tag}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, reason: msg };
    }
  },
};
