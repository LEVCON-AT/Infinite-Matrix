// Welle WV.D.3 — Channel-Token-Helper.
//
// Ruft den SECURITY DEFINER-RPC `get_oauth_token_decrypted` auf und
// liefert den entschluesselten Access-Token + Metadaten zurueck.
//
// **Nur fuer Channel-Provider-Libs**, nie fuer UI-Komponenten direkt.
// Plaintext-Token im JS-Memory ist unvermeidlich (Provider-API braucht
// ihn als Bearer), aber er soll nicht persistiert werden — kein
// localStorage, kein logger.
//
// Refresh-Logik: V1 minimal. Wenn token abgelaufen ist, wirft der
// Helper. Server-Side-Refresh (Service mit client_secret) kommt mit
// Sub-Sprint D.3.e (oder spaeter) — bis dahin muss der User Re-Auth
// machen, wenn der Refresh-Token noch da ist.

import { supabase } from '../supabase';
import type { ChannelProvider, GenericMailCredentials } from '../types';

export type DecryptedOAuthToken = {
  id: string;
  provider: ChannelProvider;
  accessToken: string | null;
  refreshToken: string | null;
  genericCredentials: GenericMailCredentials | null;
  expiresAt: Date | null;
  scopes: string[] | null;
  updatedAt: string;
};

// Wirft, wenn unauthorized (kein Token vorhanden) oder abgelaufen.
// Caller (Provider-Lib) faengt + rendert „Bitte neu verbinden"-CTA.
export async function getDecryptedOAuthToken(
  provider: ChannelProvider,
): Promise<DecryptedOAuthToken | null> {
  const { data, error } = await supabase.rpc('get_oauth_token_decrypted', {
    p_provider: provider,
  });
  if (error) throw error;
  if (!data) return null;

  const row = data as {
    id: string;
    provider: ChannelProvider;
    access_token: string | null;
    refresh_token: string | null;
    generic_credentials: GenericMailCredentials | null;
    expires_at: string | null;
    scopes: string[] | null;
    updated_at: string;
  };

  return {
    id: row.id,
    provider: row.provider,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    genericCredentials: row.generic_credentials,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    scopes: row.scopes,
    updatedAt: row.updated_at,
  };
}

// Convenience: liefert Bearer-Token oder wirft mit klarer Message
// damit Provider-Libs `getBearerToken('slack')` direkt im fetch-Header
// einsetzen koennen. V1 ohne Refresh — Caller muss sich um Re-Auth
// kuemmern wenn das wirft.
export async function getBearerToken(provider: ChannelProvider): Promise<string> {
  const row = await getDecryptedOAuthToken(provider);
  if (!row || !row.accessToken) {
    throw new Error(`channel:${provider}:not_connected`);
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    throw new Error(`channel:${provider}:token_expired`);
  }
  return row.accessToken;
}
