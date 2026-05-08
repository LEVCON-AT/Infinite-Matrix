// Welle WV.D.3 — Channel-Provider-Metadata fuer UI.
//
// Labels + Icons + Doku-URLs pro ChannelProvider. Wird aus mehreren
// UI-Stellen genutzt (AccountChannels, ChannelTokenSetupModal,
// AdminProviderSlots) — Single-Source statt In-Component-Repeats.

import type { IconName } from '../components/Icon';
import type { BrandKey } from './brand-icons';
import type { ChannelProvider } from './types';

// Anzeige-Label pro Provider. Konsistent fuer Buttons + Toasts +
// Headings.
export const CHANNEL_PROVIDER_LABEL: Record<ChannelProvider, string> = {
  outlook: 'Outlook',
  gmail: 'Gmail',
  'mail-generic': 'IMAP/SMTP',
  onenote: 'OneNote',
  onedrive: 'OneDrive',
  drive: 'Google Drive',
  dropbox: 'Dropbox',
  nextcloud: 'Nextcloud',
  slack: 'Slack',
  teams: 'Microsoft Teams',
  discord: 'Discord',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
};

// Brand-Key pro Provider — primaer-Pfad fuer UI-Render via BrandIcon
// (lib/brand-icons.ts). 1:1-Mapping ChannelProvider → BrandKey.
export const CHANNEL_PROVIDER_BRAND: Record<ChannelProvider, BrandKey> = {
  outlook: 'outlook',
  gmail: 'gmail',
  'mail-generic': 'mail-generic',
  onenote: 'onenote',
  onedrive: 'onedrive',
  drive: 'drive',
  dropbox: 'dropbox',
  nextcloud: 'nextcloud',
  slack: 'slack',
  teams: 'teams',
  discord: 'discord',
  whatsapp: 'whatsapp',
  telegram: 'telegram',
};

// Heroicon-Fallback pro Provider — wird genutzt wenn BrandIcon-Render
// nicht moeglich ist (z.B. in Symbol-Resolution Auto-Path fuer Link-
// Atome ohne Brand-Bundle). Kategorie-Symbol (cloud / chat-bubble /
// envelope) bleibt damit als Fallback verfuegbar.
export const CHANNEL_PROVIDER_ICON: Record<ChannelProvider, IconName> = {
  outlook: 'envelope',
  gmail: 'envelope',
  'mail-generic': 'envelope',
  onenote: 'document-text',
  onedrive: 'cloud',
  drive: 'cloud',
  dropbox: 'cloud',
  nextcloud: 'cloud',
  slack: 'chat-bubble',
  teams: 'chat-bubble',
  discord: 'chat-bubble',
  whatsapp: 'phone',
  telegram: 'paper-airplane',
};

// Doku-Link wo der User seinen Token / Auth-Setup findet. Wird auf den
// Provider-Karten als „Wo finde ich meinen Token?"-Hint gerendert.
export const CHANNEL_PROVIDER_DOCS_URL: Record<ChannelProvider, string> = {
  outlook: 'https://learn.microsoft.com/en-us/graph/auth-v2-user',
  gmail: 'https://developers.google.com/gmail/api/auth/web-server',
  'mail-generic': 'https://wiki.dovecot.org/PasswordDatabase',
  onenote: 'https://learn.microsoft.com/en-us/graph/api/resources/onenote-api-overview',
  onedrive: 'https://learn.microsoft.com/en-us/onedrive/developer/rest-api/',
  drive: 'https://developers.google.com/drive/api/quickstart/js',
  dropbox: 'https://www.dropbox.com/developers/documentation/http/overview',
  nextcloud: 'https://docs.nextcloud.com/server/latest/developer_manual/client_apis/index.html',
  slack: 'https://api.slack.com/apps',
  teams: 'https://learn.microsoft.com/en-us/graph/teams-concept-overview',
  discord: 'https://discord.com/developers/applications',
  whatsapp: 'https://developers.facebook.com/docs/whatsapp/cloud-api/',
  telegram: 'https://core.telegram.org/bots/api',
};

// Provider-Reihenfolge pro Domain — fuer die Settings-Page-Liste.
export const CHANNEL_PROVIDERS_BY_DOMAIN: Record<string, readonly ChannelProvider[]> = {
  Mail: ['outlook', 'gmail', 'mail-generic'],
  Doc: ['onenote'],
  Drive: ['onedrive', 'drive', 'dropbox', 'nextcloud'],
  Messenger: ['slack', 'teams', 'discord', 'whatsapp', 'telegram'],
};

export const CHANNEL_DOMAIN_ORDER: readonly string[] = ['Mail', 'Doc', 'Drive', 'Messenger'];
