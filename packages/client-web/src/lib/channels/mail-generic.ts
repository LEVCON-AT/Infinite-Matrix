// Welle WV.D.3.d — mail-generic Provider via mail-bridge-Service.
//
// Konzept §13.1 + plan-welle-d.md §4.1.
//
// Browser kann keine raw-IMAP/SMTP-Verbindungen oeffnen — wir leiten ALLE
// Calls ueber den lokal laufenden mail-bridge-Service (`/api/mail-bridge/`).
// Der Service decryptet die User-Credentials (generic_credentials_encrypted)
// und macht IMAP/SMTP-Calls auf User-Mail-Server.
//
// Auth: User-JWT als Bearer (mail-bridge validiert via SUPABASE_JWT_SECRET).

import { supabase } from '../supabase';
import type {
  ChannelComposeInput,
  ChannelInbox,
  ChannelMessage,
  ChannelProviderImpl,
} from './types';

const MAIL_BRIDGE_BASE =
  (import.meta.env.VITE_MAIL_BRIDGE_BASE as string | undefined) ?? '/api/mail-bridge';

async function getJwt(): Promise<string> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session?.access_token) throw new Error('mail-generic:not_authenticated');
  return session.access_token;
}

async function bridgePost<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const jwt = await getJwt();
  const res = await fetch(`${MAIL_BRIDGE_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let reason = `mail-bridge:${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      reason += `:${j.error ?? ''}`;
    } catch {
      /* ignore */
    }
    throw new Error(reason);
  }
  return (await res.json()) as T;
}

type BridgeMessage = {
  id: string;
  subject?: string;
  from?: string;
  from_address?: string;
  body_text?: string;
  received_at?: string;
};

export const mailGenericProvider: ChannelProviderImpl = {
  provider: 'mail-generic',

  async listInboxes(): Promise<ChannelInbox[]> {
    const json = await bridgePost<{ folders: Array<{ id: string; name: string }> }>(
      '/list_folders',
    );
    return (json.folders ?? []).map((f) => ({ id: f.id, name: f.name }));
  },

  async listMessages(inboxId: string, limit?: number): Promise<ChannelMessage[]> {
    const effectiveLimit = limit ?? 20;
    const json = await bridgePost<{ messages: BridgeMessage[] }>('/list_messages', {
      folder_id: inboxId,
      limit: effectiveLimit,
    });
    return (json.messages ?? []).map((m) => ({
      id: m.id,
      inboxId,
      fromName: m.from ?? 'unbekannt',
      fromAddress: m.from_address,
      subject: m.subject,
      bodyText: m.body_text ?? '',
      receivedAt: m.received_at ?? new Date().toISOString(),
    }));
  },

  async sendMessage(input: ChannelComposeInput): Promise<{ id: string }> {
    const json = await bridgePost<{ ok: boolean; message_id: string }>('/send', {
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      body_text: input.bodyText,
    });
    return { id: json.message_id };
  },

  async testConnect(): Promise<{ ok: true; profileLabel: string } | { ok: false; reason: string }> {
    try {
      const json = await bridgePost<
        { ok: true; profile_label: string } | { ok: false; reason: string }
      >('/test_connect');
      if (json.ok) return { ok: true, profileLabel: json.profile_label };
      return { ok: false, reason: json.reason };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'unknown' };
    }
  },
};
