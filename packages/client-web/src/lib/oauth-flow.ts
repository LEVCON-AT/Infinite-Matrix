// Welle WV.D.3.f V1 — Browser-OAuth-Flow mit PKCE.
//
// Konzept §13 + plan-welle-d.md §3.3.
//
// Browser-only-Pfad fuer Public-Client-Provider (Microsoft Azure AD-SPA,
// Google-Installed-App). Token-Exchange ohne client_secret moeglich, nur
// PKCE-code_verifier reicht. Provider-Konfig kommt aus
// oauth_provider_slots (admin-konfiguriert).
//
// V1-unterstuetzt:
//   - outlook: Azure AD App Registration „Single-page application"
//   - teams: gleicher MS-Token-Pfad wie outlook (eigener Slot)
//
// V2 / D.3.f.2 (Server-Side):
//   - gmail: Google-Web-App braucht client_secret beim Exchange
//   - slack: Slack OAuth v2 braucht client_secret beim Exchange
//
// Flow:
//   1. startOAuthFlow(provider) — generiert verifier + state, oeffnet
//      popup auf provider.auth_url mit code_challenge.
//   2. Provider redirected zu redirect_uri (/oauth/callback).
//   3. OAuthCallback-Page (routes/OAuthCallback.tsx) extrahiert code +
//      state, ruft completeOAuthFlow.
//   4. completeOAuthFlow tauscht code → tokens via fetch(token_url) und
//      ruft set_oauth_token-RPC.
//   5. postMessage('matrix-oauth-success') zum opener; popup schliesst sich.
//
// Storage zwischen 1 und 4: sessionStorage (popup teilt Storage mit
// opener im selben Origin) — wir speichern code_verifier + provider +
// scopes_granted unter dem state-Key.

import { setOAuthToken } from './oauth-tokens';
import type { ChannelProvider, OAuthProviderSlotSafe } from './types';

// Provider die V1 browser-only PKCE unterstuetzen. Andere fallen zurueck
// auf Manual-Paste oder D.3.f.2-Server-Side.
const PUBLIC_CLIENT_PROVIDERS: ReadonlySet<ChannelProvider> = new Set(['outlook', 'teams']);

export function supportsBrowserPkce(provider: ChannelProvider): boolean {
  return PUBLIC_CLIENT_PROVIDERS.has(provider);
}

const STORAGE_PREFIX = 'matrix-oauth-pending:';

type PendingFlow = {
  provider: ChannelProvider;
  codeVerifier: string;
  redirectUri: string;
  tokenUrl: string;
  clientId: string;
  scopes: string[];
};

function storePending(state: string, data: PendingFlow): void {
  sessionStorage.setItem(STORAGE_PREFIX + state, JSON.stringify(data));
}

function readPending(state: string): PendingFlow | null {
  const raw = sessionStorage.getItem(STORAGE_PREFIX + state);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingFlow;
  } catch {
    return null;
  }
}

function clearPending(state: string): void {
  sessionStorage.removeItem(STORAGE_PREFIX + state);
}

// ─── PKCE-Helpers ───────────────────────────────────────────────

function base64UrlEncode(bytes: Uint8Array): string {
  // btoa nimmt latin1-string; wir basteln aus Bytes manuell um sicher
  // zu sein (TextDecoder('latin1') hat keine Browser-Garantie).
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateCodeVerifier(): string {
  // RFC7636: 43-128 Zeichen, [A-Z a-z 0-9 - . _ ~]. 32 random Bytes →
  // 43 Zeichen base64url.
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function codeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(hash));
}

function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

// ─── Redirect-URI ───────────────────────────────────────────────
// Lebt im selben SPA — Route /oauth/callback (registriert in main.tsx).
// Provider-App-Registrierung muss diese URI als „Authorized redirect"
// eingetragen haben.

export function buildRedirectUri(): string {
  const origin = window.location.origin;
  // VITE_BASE_PATH respektieren (sub-pfad-deploy z.B. /app/).
  const base = (import.meta.env.VITE_BASE_PATH as string | undefined) ?? '/';
  const cleaned = base.replace(/\/$/, '');
  return `${origin}${cleaned}/oauth/callback`;
}

// ─── Start-Flow ─────────────────────────────────────────────────

export type StartOAuthFlowOptions = {
  provider: ChannelProvider;
  // Konfig aus oauth_provider_slots_safe — Caller muss vorher pruefen
  // dass slot.status mind. 'konfiguriert' ist.
  slot: OAuthProviderSlotSafe;
  // Override fuer scopes (z.B. wenn User mehr braucht als Default).
  // Wenn null → slot.scopes_default.
  scopes?: string[];
};

export type StartOAuthFlowResult = {
  // Popup-Window-Reference. Caller kann polling auf .closed machen
  // damit Re-Try-Buttons nach Abbruch wieder klickbar werden.
  popup: Window | null;
  // Promise resolved wenn completeOAuthFlow fertig ist (postMessage
  // vom Callback). Rejected bei Fehler oder Popup-Close ohne Erfolg.
  done: Promise<{ ok: true } | { ok: false; reason: string }>;
};

export async function startOAuthFlow(
  options: StartOAuthFlowOptions,
): Promise<StartOAuthFlowResult> {
  const { provider, slot } = options;
  if (!supportsBrowserPkce(provider)) {
    throw new Error(
      `OAuth-Browser-Flow fuer ${provider} nicht unterstuetzt — bitte Manual-Paste benutzen.`,
    );
  }
  if (!slot.auth_url || !slot.token_url || !slot.client_id) {
    throw new Error(
      `Provider-Slot fuer ${provider} unvollstaendig (auth_url/token_url/client_id fehlt).`,
    );
  }

  const verifier = generateCodeVerifier();
  const challenge = await codeChallenge(verifier);
  const state = generateState();
  const redirectUri = buildRedirectUri();
  const scopes = options.scopes ?? slot.scopes_default ?? [];

  storePending(state, {
    provider,
    codeVerifier: verifier,
    redirectUri,
    tokenUrl: slot.token_url,
    clientId: slot.client_id,
    scopes,
  });

  const url = new URL(slot.auth_url);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', slot.client_id);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (scopes.length > 0) url.searchParams.set('scope', scopes.join(' '));
  // Microsoft: response_mode=query erlaubt Code im URL-Query (statt fragment).
  url.searchParams.set('response_mode', 'query');

  const popup = window.open(url.toString(), 'matrix-oauth', 'width=520,height=720');
  if (!popup) {
    clearPending(state);
    throw new Error('Popup geblockt — bitte Popup-Blocker fuer matrix.levcon.at erlauben.');
  }

  const done = new Promise<{ ok: true } | { ok: false; reason: string }>((resolve) => {
    let resolved = false;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const data = e.data as {
        type?: string;
        state?: string;
        ok?: boolean;
        reason?: string;
      } | null;
      if (!data || data.type !== 'matrix-oauth-result') return;
      if (data.state !== state) return;
      resolved = true;
      window.removeEventListener('message', onMessage);
      clearInterval(closedTimer);
      if (data.ok) resolve({ ok: true });
      else resolve({ ok: false, reason: data.reason ?? 'unknown' });
    };
    window.addEventListener('message', onMessage);

    // Popup-Close-Watcher: wenn User Popup ohne Erfolg schliesst,
    // Promise rejecten.
    const closedTimer = window.setInterval(() => {
      if (popup.closed && !resolved) {
        resolved = true;
        window.removeEventListener('message', onMessage);
        clearInterval(closedTimer);
        clearPending(state);
        resolve({ ok: false, reason: 'popup_closed' });
      }
    }, 500);
  });

  return { popup, done };
}

// ─── Complete-Flow (im Callback-Popup) ──────────────────────────

export type CompleteOAuthFlowResult =
  | { ok: true; provider: ChannelProvider }
  | { ok: false; reason: string };

export async function completeOAuthFlow(
  state: string,
  code: string,
): Promise<CompleteOAuthFlowResult> {
  const pending = readPending(state);
  if (!pending) return { ok: false, reason: 'state_not_found' };

  // Token-Exchange. Public-Client-Flow: kein client_secret.
  // Microsoft: token_url akzeptiert form-encoded Body via CORS fuer
  // SPA-registrierte Apps. application/x-www-form-urlencoded.
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: pending.clientId,
    code,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.codeVerifier,
  });

  let tokenJson: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  try {
    const res = await fetch(pending.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    tokenJson = await res.json();
  } catch (err) {
    clearPending(state);
    return {
      ok: false,
      reason: `token_exchange_network: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }

  if (tokenJson.error || !tokenJson.access_token) {
    clearPending(state);
    return {
      ok: false,
      reason: tokenJson.error_description ?? tokenJson.error ?? 'no_access_token',
    };
  }

  const expiresAt =
    typeof tokenJson.expires_in === 'number'
      ? new Date(Date.now() + tokenJson.expires_in * 1000)
      : null;
  const scopes = tokenJson.scope ? tokenJson.scope.split(/\s+/).filter(Boolean) : pending.scopes;

  try {
    await setOAuthToken({
      provider: pending.provider,
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token,
      expiresAt,
      scopes,
    });
  } catch (err) {
    clearPending(state);
    return {
      ok: false,
      reason: `token_store_failed: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }

  clearPending(state);
  return { ok: true, provider: pending.provider };
}

// ─── postMessage helper fuer OAuthCallback-Page ─────────────────

export function postOAuthResultToOpener(
  state: string,
  result: { ok: true } | { ok: false; reason: string },
): void {
  if (!window.opener) return;
  try {
    window.opener.postMessage(
      {
        type: 'matrix-oauth-result',
        state,
        ok: result.ok,
        reason: result.ok ? undefined : result.reason,
      },
      window.location.origin,
    );
  } catch {
    // Cross-Origin-Block — kann passieren bei extension-Sandbox.
  }
}
