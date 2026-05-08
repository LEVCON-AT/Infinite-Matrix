// Welle WV.D.2 — OAuth-Tokens + Provider-Slots (Frontend-Layer).
//
// Konzept §13 (Channel-Bridges) + plan-welle-d.md §3.
//
// Read: View `user_oauth_tokens_safe` (ohne *_encrypted-Spalten).
// Write: SECURITY DEFINER RPCs `set_oauth_token` / `delete_oauth_token`.
// Direkter INSERT/UPDATE/DELETE auf user_oauth_tokens ist policy-blockiert
// — alle Schreibvorgaenge MUESSEN ueber RPCs gehen, damit Encryption
// garantiert ist.
//
// Plaintext-Token-Decrypt laeuft NIE im Frontend — nur Bridge-side via
// get_oauth_token_decrypted-RPC. Hier exposen wir das nicht.
//
// Provider-Slots (oauth_provider_slots): platform_admin-only. Frontend
// rendert die Konfig-Maske im Admin-Dashboard. Test-Connect-Endpoint
// schreibt Status zurueck via `set_oauth_provider_slot_status`.
//
// Pattern aus lib/ai-providers.ts (Phase 2 A.0).

import { isNetworkError } from './mutation-queue';
import { markCacheFallback } from './offline-state';
import { supabase } from './supabase';
import type {
  ChannelProvider,
  GenericMailCredentials,
  OAuthProviderSlotSafe,
  OAuthProviderSlotStatus,
  UserOAuthTokenSafe,
} from './types';

const TOKEN_CACHE_KEY = (userId: string) => `oauth-tokens-cache:${userId}`;
const SLOTS_CACHE_KEY = 'oauth-provider-slots-cache';

// ─── User-Token-Read ────────────────────────────────────────────

function readTokenCache(userId: string): UserOAuthTokenSafe[] | null {
  try {
    const raw = localStorage.getItem(TOKEN_CACHE_KEY(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UserOAuthTokenSafe[]) : null;
  } catch {
    return null;
  }
}

function writeTokenCache(userId: string, list: UserOAuthTokenSafe[]): void {
  try {
    localStorage.setItem(TOKEN_CACHE_KEY(userId), JSON.stringify(list));
  } catch {
    // QuotaExceededError — Cache ist Bonus.
  }
}

export async function fetchOAuthTokens(userId: string): Promise<UserOAuthTokenSafe[]> {
  try {
    // Memory `feedback_rls_select_filter.md`: explizites user_id-Filter
    // auch wenn RLS eh schuetzt — Defense-in-Depth gegen Policy-Drift.
    const { data, error } = await supabase
      .from('user_oauth_tokens_safe')
      .select(
        'id, user_id, provider, expires_at, scopes, has_refresh_token, has_generic_credentials, created_at, updated_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    const list = (data ?? []) as UserOAuthTokenSafe[];
    writeTokenCache(userId, list);
    return list;
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = readTokenCache(userId);
      if (cached) {
        markCacheFallback();
        return cached;
      }
    }
    throw err;
  }
}

// ─── User-Token-Write (RPC) ─────────────────────────────────────

export type SetOAuthTokenInput = {
  provider: ChannelProvider;
  // Mindestens accessToken ODER genericCredentials muss bei INSERT
  // gesetzt sein. Bei UPDATE optional — NULL behaelt existing Wert.
  accessToken?: string;
  refreshToken?: string;
  // mail-generic-Pfad (IMAP+SMTP, kein OAuth).
  genericCredentials?: GenericMailCredentials;
  expiresAt?: Date | null;
  scopes?: string[];
};

export async function setOAuthToken(input: SetOAuthTokenInput): Promise<UserOAuthTokenSafe> {
  const { data, error } = await supabase.rpc('set_oauth_token', {
    p_provider: input.provider,
    p_access_token: input.accessToken ?? null,
    p_refresh_token: input.refreshToken ?? null,
    p_generic_credentials: input.genericCredentials ?? null,
    p_expires_at: input.expiresAt ? input.expiresAt.toISOString() : null,
    p_scopes: input.scopes ?? null,
  });
  if (error) throw error;
  return data as UserOAuthTokenSafe;
}

export async function deleteOAuthToken(provider: ChannelProvider): Promise<void> {
  const { error } = await supabase.rpc('delete_oauth_token', { p_provider: provider });
  if (error) throw error;
}

// ─── Provider-Slot-Read (admin-only) ────────────────────────────

function readSlotsCache(): OAuthProviderSlotSafe[] | null {
  try {
    const raw = localStorage.getItem(SLOTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OAuthProviderSlotSafe[]) : null;
  } catch {
    return null;
  }
}

function writeSlotsCache(list: OAuthProviderSlotSafe[]): void {
  try {
    localStorage.setItem(SLOTS_CACHE_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}

export async function fetchOAuthProviderSlots(): Promise<OAuthProviderSlotSafe[]> {
  try {
    const { data, error } = await supabase
      .from('oauth_provider_slots_safe')
      .select(
        'id, provider, client_id, auth_url, token_url, scopes_default, extra_config, status, status_checked_at, status_message, has_client_secret, created_at, updated_at',
      )
      .order('provider', { ascending: true });
    if (error) throw error;
    const list = (data ?? []) as OAuthProviderSlotSafe[];
    writeSlotsCache(list);
    return list;
  } catch (err) {
    if (isNetworkError(err)) {
      const cached = readSlotsCache();
      if (cached) {
        markCacheFallback();
        return cached;
      }
    }
    throw err;
  }
}

// ─── Provider-Slot-Write (admin-only RPCs) ──────────────────────

export type SetOAuthProviderSlotInput = {
  provider: ChannelProvider;
  clientId: string;
  // NULL bei Update ohne Secret-Wechsel.
  clientSecret?: string;
  authUrl?: string;
  tokenUrl?: string;
  scopesDefault?: string[];
  extraConfig?: Record<string, unknown>;
};

export async function setOAuthProviderSlot(
  input: SetOAuthProviderSlotInput,
): Promise<OAuthProviderSlotSafe> {
  const { data, error } = await supabase.rpc('set_oauth_provider_slot', {
    p_provider: input.provider,
    p_client_id: input.clientId,
    p_client_secret: input.clientSecret ?? null,
    p_auth_url: input.authUrl ?? null,
    p_token_url: input.tokenUrl ?? null,
    p_scopes_default: input.scopesDefault ?? null,
    p_extra_config: input.extraConfig ?? null,
  });
  if (error) throw error;
  return data as OAuthProviderSlotSafe;
}

export async function deleteOAuthProviderSlot(provider: ChannelProvider): Promise<void> {
  const { error } = await supabase.rpc('delete_oauth_provider_slot', { p_provider: provider });
  if (error) throw error;
}

// Wird vom Test-Connect-Endpoint gerufen (admin-only) — schreibt das
// Verifikations-Resultat zurueck. Das eigentliche HTTP-Test-Probing
// laeuft Server-Side (Bridge) damit Plaintext-Secret nicht zum Client
// muss.
export async function setOAuthProviderSlotStatus(
  provider: ChannelProvider,
  status: Exclude<OAuthProviderSlotStatus, 'fehlt'>,
  message: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('set_oauth_provider_slot_status', {
    p_provider: provider,
    p_status: status,
    p_message: message,
  });
  if (error) throw error;
}

// ─── Helper: Token-Status pro Provider ──────────────────────────
// Convenience fuer UI — gibt fuer einen Provider zurueck ob Token
// existiert und wie der Expiry-Status ist.

export type TokenStatus =
  | { kind: 'missing' }
  | { kind: 'valid'; expiresAt: Date | null; scopes: string[] | null }
  | { kind: 'expired'; expiresAt: Date };

export function tokenStatusFor(
  tokens: UserOAuthTokenSafe[],
  provider: ChannelProvider,
): TokenStatus {
  const row = tokens.find((t) => t.provider === provider);
  if (!row) return { kind: 'missing' };
  if (row.expires_at) {
    const exp = new Date(row.expires_at);
    if (exp.getTime() < Date.now()) {
      return { kind: 'expired', expiresAt: exp };
    }
    return { kind: 'valid', expiresAt: exp, scopes: row.scopes };
  }
  // Kein expires_at = App-Password (mail-generic) oder long-lived Token.
  return { kind: 'valid', expiresAt: null, scopes: row.scopes };
}
