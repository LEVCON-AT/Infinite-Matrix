// Credential-Helper — holt den Default-AI-Provider via RPC.
//
// Ruft get_my_provider_credential() (Migration 021) das den Klartext-
// Key des Default-Providers fuer den eingeloggten User decrypted und
// zurueckgibt. Cache-Strategy: in-Memory pro Session. Kein local-
// Storage — der Klartext-Key soll nicht persistiert werden.
//
// Lifecycle:
//   - Erste runAssist-Aufruf → fetch + cache
//   - Subsequent calls → cache-hit (kein RPC-Roundtrip)
//   - Bei "no_default_provider"-Error: cache nicht setzen, Caller
//     soll den User auf Settings → AI-Anbindung lenken.
//   - Logout (auth state change) → cache clearen via clearProviderCredentialCache()

import { supabase } from '../supabase';
import type { AiProviderKind } from '../types';

export type ProviderCredential = {
  kind: AiProviderKind;
  label: string;
  modelName: string;
  apiKey: string; // Klartext, nur in-memory
};

let cached: ProviderCredential | null = null;
let cachePromise: Promise<ProviderCredential> | null = null;

// Spezifischer Error-Subtyp fuer "kein Provider gesetzt", damit der
// UI-Layer das von echten Errors unterscheiden kann.
export class NoDefaultProviderError extends Error {
  constructor() {
    super(
      'Kein AI-Provider als Standard hinterlegt. Bitte unter Settings → Konto → AI-Anbindung einen Provider verbinden.',
    );
    this.name = 'NoDefaultProviderError';
  }
}

export async function getProviderCredential(): Promise<ProviderCredential> {
  if (cached) return cached;
  if (cachePromise) return cachePromise;

  cachePromise = (async () => {
    const { data, error } = await supabase.rpc('get_my_provider_credential');
    if (error) {
      cachePromise = null;
      // Postgres-Exception "no_default_provider" wird hier sichtbar.
      const msg = error.message ?? '';
      if (msg.includes('no_default_provider')) {
        throw new NoDefaultProviderError();
      }
      throw error;
    }
    if (!data || typeof data !== 'object') {
      cachePromise = null;
      throw new Error('Ungueltige Antwort von get_my_provider_credential.');
    }
    const obj = data as {
      kind: AiProviderKind;
      label: string;
      model_name: string | null;
      api_key: string;
    };
    const cred: ProviderCredential = {
      kind: obj.kind,
      label: obj.label,
      modelName: obj.model_name ?? '',
      apiKey: obj.api_key,
    };
    cached = cred;
    cachePromise = null;
    return cred;
  })();

  return cachePromise;
}

// Logout-Hook: cache clearen damit der naechste User-Login frischen
// Key zieht. Wird in lib/auth.ts beim SIGN_OUT-Event gerufen.
export function clearProviderCredentialCache(): void {
  cached = null;
  cachePromise = null;
}
