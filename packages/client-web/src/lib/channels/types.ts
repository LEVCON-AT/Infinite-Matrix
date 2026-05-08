// Welle WV.D.3 — Channel-Provider-Abstraktion (Types).
//
// Konzept §13.1-§13.3 + plan-welle-d.md §4.
//
// Single-Source fuer Provider-Interfaces. Jede konkrete Channel-Lib
// (slack.ts / teams.ts / mail-generic.ts / outlook.ts / gmail.ts)
// implementiert das gleiche Interface — Mail-/Chat-Widgets konsumieren
// es ohne den konkreten Provider zu kennen.
//
// Bewusst minimal: V1 deckt Mail/Chat ab; Drive-Provider haben ein
// separates Interface (drive.ts / DriveProvider, kommt mit D.5).

import type { ChannelProvider } from '../types';

// ─── Inbox/Channel-Folder ───────────────────────────────────────
// Eine logische Sammlung von Messages — Provider-abhaengig:
//   - mail-generic / outlook / gmail: Folder (INBOX, Sent, Drafts).
//   - slack / teams / discord: Channel.
//   - whatsapp / telegram: Chat.

export type ChannelInbox = {
  // Provider-Native-ID (folder-uid / channel-id / chat-id).
  id: string;
  name: string;
  // Optional: Unread-Count fuer Badge-Indikator.
  unreadCount?: number;
  // Optional: Topic / Description / Folder-Path.
  description?: string;
};

// ─── Channel-Message ────────────────────────────────────────────
// Normalisierte Message-Repraesentation. Provider-spezifische Felder
// landen in `raw` (jsonb), damit Aenderungen am Provider-API nicht den
// Frontend-Code brechen.

export type ChannelMessageAttachment = {
  id: string;
  name: string;
  url: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type ChannelMessage = {
  id: string;
  inboxId: string;
  // Anzeige-Daten:
  fromName: string;
  fromAddress?: string; // Email / Slack-User-ID / Telefonnummer
  subject?: string; // Mail-only (Chat hat kein Subject).
  bodyText: string; // Plain-Text, fuer Listen-Snippet.
  bodyHtml?: string; // Optional Rich-Render fuer Mail.
  receivedAt: string; // ISO-Timestamp.
  // Status-Flags:
  isUnread?: boolean;
  hasAttachments?: boolean;
  // Thread-Verlinkung (wenn vom Provider bereitgestellt):
  threadId?: string;
  // Original-Verweis fuer „Im Provider oeffnen"-Button:
  externalUrl?: string;
  attachments?: ChannelMessageAttachment[];
  // Provider-rohe Daten (JSON-blob), V1 nur fuer Debugging genutzt.
  raw?: Record<string, unknown>;
};

// ─── Compose-Input ──────────────────────────────────────────────
// V1 minimal. Mail-Provider nutzen subject+bodyText; Chat-Provider
// ignorieren subject. attachments deferred bis V2.

export type ChannelComposeInput = {
  inboxId: string;
  to: string[]; // Email-Adressen / Channel-IDs / User-IDs.
  cc?: string[];
  bcc?: string[];
  subject?: string; // Mail-only.
  bodyText: string; // Plain-Text. HTML deferred.
  // Optional: Reply-To-Thread (Slack-Threads, Mail-References).
  replyToMessageId?: string;
};

// ─── Channel-Provider-Interface ─────────────────────────────────
// Jede konkrete Channel-Lib exportiert ein Objekt, das diesem Type
// genuegt. Dispatcher in widgets/MailWidget waehlt nach widget.provider
// die passende Impl.

export interface ChannelProviderImpl {
  provider: ChannelProvider;

  // Auflisten der Inbox/Channels (z.B. fuer Folder-Picker im Widget-
  // Inspector). Pagination V1 nicht — alles als Array.
  listInboxes(): Promise<ChannelInbox[]>;

  // Auflisten der letzten Messages eines Inboxes. limit Default 20.
  // since: optional ISO-Timestamp fuer „nur neuere als ..." (V1 ignoriert
  // wenn Provider nicht supported).
  listMessages(inboxId: string, limit?: number, since?: string): Promise<ChannelMessage[]>;

  // Senden / Reply. Wirft bei Provider-Fehler — kein stilles Misserfolg.
  // V1: nicht alle Provider implementieren das (Read-only-Modus).
  sendMessage?(input: ChannelComposeInput): Promise<{ id: string; externalUrl?: string }>;

  // Test-Connect: Verifiziert dass das Token gueltig ist und das User-
  // Profil erreicht werden kann. UI-Verify-Button im Provider-Slot-
  // Setup ruft das.
  testConnect(): Promise<{ ok: true; profileLabel: string } | { ok: false; reason: string }>;
}
