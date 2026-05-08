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
import { slackProvider } from './slack';
import type { ChannelProviderImpl } from './types';

export type * from './types';
export { getDecryptedOAuthToken, getBearerToken } from './token';

const REGISTRY = new Map<ChannelProvider, ChannelProviderImpl>();

REGISTRY.set('slack', slackProvider);

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
