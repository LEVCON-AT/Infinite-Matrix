// Welle WV.D.3 — Channel-Provider-Registry.
//
// Mail-/Chat-Widgets dispatchen ueber `getChannelImpl(provider)` zur
// passenden Implementation. V1 hat nur slack; teams / mail-generic /
// outlook / gmail / ... folgen in spaeteren Sprints.
//
// Drive-Provider (onedrive / drive / dropbox / nextcloud) leben in
// einer separaten Registry (lib/channels/drive.ts) — die Drive-Atom-
// Operationen sind anders geformt (File-Pick / Download / Upload).

import type { ChannelProvider } from '../types';
import { discordProvider } from './discord';
import { googleDriveProvider } from './drive-google';
import type { DriveProviderImpl } from './drive-types';
import { dropboxProvider } from './dropbox';
import { gmailProvider } from './gmail';
import { mailGenericProvider } from './mail-generic';
import { nextcloudProvider } from './nextcloud';
import { onedriveProvider } from './onedrive';
import { onenoteProvider } from './onenote';
import { outlookProvider } from './outlook';
import { slackProvider } from './slack';
import { teamsProvider } from './teams';
import { telegramProvider } from './telegram';
import type { ChannelProviderImpl } from './types';

export type * from './types';
export type * from './drive-types';
export { getDecryptedOAuthToken, getBearerToken } from './token';

// ─── Channel-Provider (Mail/Chat) ────────────────────────────────
const REGISTRY = new Map<ChannelProvider, ChannelProviderImpl>();

REGISTRY.set('slack', slackProvider);
REGISTRY.set('teams', teamsProvider);
REGISTRY.set('outlook', outlookProvider);
REGISTRY.set('gmail', gmailProvider);
REGISTRY.set('onenote', onenoteProvider);
REGISTRY.set('discord', discordProvider);
REGISTRY.set('telegram', telegramProvider);
REGISTRY.set('mail-generic', mailGenericProvider);

export function getChannelImpl(provider: ChannelProvider): ChannelProviderImpl {
  const impl = REGISTRY.get(provider);
  if (!impl) {
    throw new Error(`channel:${provider}:not_implemented`);
  }
  return impl;
}

// Liefert true wenn fuer den Provider eine Impl existiert. UI nutzt
// das fuer „Provider auswaehlbar?"-Filter im Widget-Inspector.
export function hasChannelImpl(provider: ChannelProvider): boolean {
  return REGISTRY.has(provider);
}

// V1-implemented Provider-List — fuer UI-Hint „diese Provider sind in
// V1 schon nutzbar". Erweitert sich automatisch wenn neue Lib hier
// registriert wird.
export function listImplementedProviders(): ChannelProvider[] {
  return Array.from(REGISTRY.keys());
}

// ─── Drive-Provider (File-Bridge) ────────────────────────────────
// Welle WV.D.5: Eigenes Interface, eigene Registry. Drive-Widget
// (DriveWidget.tsx) dispatcht via getDriveImpl.

const DRIVE_REGISTRY = new Map<ChannelProvider, DriveProviderImpl>();

DRIVE_REGISTRY.set('onedrive', onedriveProvider);
DRIVE_REGISTRY.set('drive', googleDriveProvider);
DRIVE_REGISTRY.set('dropbox', dropboxProvider);
DRIVE_REGISTRY.set('nextcloud', nextcloudProvider);

export function getDriveImpl(provider: ChannelProvider): DriveProviderImpl {
  const impl = DRIVE_REGISTRY.get(provider);
  if (!impl) {
    throw new Error(`drive:${provider}:not_implemented`);
  }
  return impl;
}

export function hasDriveImpl(provider: ChannelProvider): boolean {
  return DRIVE_REGISTRY.has(provider);
}

export function listImplementedDriveProviders(): ChannelProvider[] {
  return Array.from(DRIVE_REGISTRY.keys());
}
