// Welle WV.D.3.f.2 — Server-Side OAuth-Token-Exchange.
//
// Konzept §13 + plan-welle-d.md §3.3.
//
// Komplettiert die Auto-OAuth-Flow-Pfade fuer Provider die client_secret
// beim Token-Exchange brauchen (slack, gmail, ...). Browser-PKCE-Pfad
// fuer Public-Clients (Microsoft SPA) bleibt im Frontend (lib/oauth-flow.ts).
//
// Endpoints (alle behind nginx /api/oauth-bridge/...):
//
//   POST /exchange
//     Body: { provider, code, code_verifier, redirect_uri }
//     Auth: Bearer <user-jwt>
//     Output: { access_token, refresh_token?, expires_at?, scopes }
//     Side-effect: KEINE — Caller (Browser) speichert via set_oauth_token-RPC.
//
//   POST /refresh
//     Body: { provider }
//     Auth: Bearer <user-jwt>
//     Output: { access_token, refresh_token?, expires_at? }
//     Side-effect: speichert via service-role direkt (Lazy-Refresh-
//     Hot-Path).
//
// Bind: 127.0.0.1:8085. nginx routet /api/oauth-bridge/.
//
// Env:
//   PORT=8085
//   HOST=127.0.0.1
//   DATABASE_URL=postgresql://...
//   SUPABASE_JWT_SECRET=<jwt-secret>
//   SUPABASE_SERVICE_ROLE_KEY=<service-role-jwt> — fuer set_oauth_token-Call

import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Client } from 'pg';

const PORT = Number(process.env.PORT ?? 8085);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://supabase.matrix.levcon.at';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!DATABASE_URL) {
  console.error('[oauth-bridge] DATABASE_URL fehlt.');
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error('[oauth-bridge] SUPABASE_JWT_SECRET fehlt.');
  process.exit(1);
}
if (!SERVICE_ROLE) {
  console.error('[oauth-bridge] SUPABASE_SERVICE_ROLE_KEY fehlt.');
  process.exit(1);
}

const pg = new Client({ connectionString: DATABASE_URL });

// ─── JWT-Verify ─────────────────────────────────────────────────

type JwtPayload = { sub?: string; exp?: number };

function base64UrlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 ? 4 - (padded.length % 4) : 0;
  return Buffer.from(padded + '='.repeat(pad), 'base64');
}

function verifyJwt(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac('sha256', JWT_SECRET as string)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  if (expectedSig !== sigB64) return null;
  try {
    const p = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as JwtPayload;
    if (p.exp && p.exp * 1000 < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

function extractToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  return auth?.startsWith('Bearer ') ? auth.slice(7) : null;
}

// ─── Body-Parser ────────────────────────────────────────────────

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : (c as Buffer));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function send(res: ServerResponse, status: number, json: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(json));
}

// ─── Slot-Read (service-role bypasses RLS) ──────────────────────

type SlotConfig = {
  client_id: string;
  client_secret: string;
  token_url: string;
};

async function loadSlot(provider: string): Promise<SlotConfig | null> {
  const r = await pg.query<{
    client_id: string;
    client_secret_decrypted: string | null;
    token_url: string | null;
  }>(
    `SELECT client_id,
            CASE WHEN client_secret_encrypted IS NOT NULL
                 THEN pgp_sym_decrypt(client_secret_encrypted, current_setting('app.ai_master_key'))
                 ELSE NULL END AS client_secret_decrypted,
            token_url
       FROM public.oauth_provider_slots
      WHERE provider = $1`,
    [provider],
  );
  const row = r.rows[0];
  if (!row || !row.client_id || !row.client_secret_decrypted || !row.token_url) return null;
  return {
    client_id: row.client_id,
    client_secret: row.client_secret_decrypted,
    token_url: row.token_url,
  };
}

// ─── Token-Exchange ─────────────────────────────────────────────

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function exchangeCode(
  slot: SlotConfig,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: slot.client_id,
    client_secret: slot.client_secret,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const res = await fetch(slot.token_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return (await res.json()) as TokenResponse;
}

async function refreshAccessToken(
  slot: SlotConfig,
  refreshToken: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: slot.client_id,
    client_secret: slot.client_secret,
    refresh_token: refreshToken,
  });
  const res = await fetch(slot.token_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  return (await res.json()) as TokenResponse;
}

// ─── Endpoint: /exchange ────────────────────────────────────────

async function handleExchange(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    send(res, 401, { error: 'unauthorized' });
    return;
  }
  const payload = verifyJwt(token);
  if (!payload || !payload.sub) {
    send(res, 401, { error: 'invalid_token' });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch {
    send(res, 400, { error: 'invalid_json' });
    return;
  }

  const provider = String(body.provider ?? '');
  const code = String(body.code ?? '');
  const codeVerifier = String(body.code_verifier ?? '');
  const redirectUri = String(body.redirect_uri ?? '');
  if (!provider || !code || !codeVerifier || !redirectUri) {
    send(res, 400, { error: 'missing_params' });
    return;
  }

  const slot = await loadSlot(provider);
  if (!slot) {
    send(res, 400, { error: 'slot_not_configured', provider });
    return;
  }

  try {
    const t = await exchangeCode(slot, code, codeVerifier, redirectUri);
    if (t.error || !t.access_token) {
      send(res, 400, {
        error: 'token_exchange_failed',
        provider,
        reason: t.error_description ?? t.error ?? 'no_access_token',
      });
      return;
    }
    const expiresAt = t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null;
    send(res, 200, {
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? null,
      expires_at: expiresAt,
      scopes: t.scope ? t.scope.split(/\s+/).filter(Boolean) : null,
    });
  } catch (err) {
    console.error('[oauth-bridge] exchange-error:', err);
    send(res, 500, { error: 'internal_error' });
  }
}

// ─── Endpoint: /refresh ─────────────────────────────────────────

async function handleRefresh(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const token = extractToken(req);
  if (!token) {
    send(res, 401, { error: 'unauthorized' });
    return;
  }
  const payload = verifyJwt(token);
  if (!payload || !payload.sub) {
    send(res, 401, { error: 'invalid_token' });
    return;
  }
  const body = (await readJson(req).catch(() => ({}))) as Record<string, unknown>;
  const provider = String(body.provider ?? '');
  if (!provider) {
    send(res, 400, { error: 'missing_provider' });
    return;
  }

  const slot = await loadSlot(provider);
  if (!slot) {
    send(res, 400, { error: 'slot_not_configured', provider });
    return;
  }

  // Refresh-Token aus user_oauth_tokens (service-role bypasses RLS).
  const tokRow = await pg.query<{ refresh_token: string | null }>(
    `SELECT pgp_sym_decrypt(refresh_token_encrypted, current_setting('app.ai_master_key')) AS refresh_token
       FROM public.user_oauth_tokens
      WHERE user_id = $1 AND provider = $2 AND refresh_token_encrypted IS NOT NULL`,
    [payload.sub, provider],
  );
  const refreshToken = tokRow.rows[0]?.refresh_token;
  if (!refreshToken) {
    send(res, 400, { error: 'no_refresh_token', provider });
    return;
  }

  try {
    const t = await refreshAccessToken(slot, refreshToken);
    if (t.error || !t.access_token) {
      send(res, 400, {
        error: 'refresh_failed',
        provider,
        reason: t.error_description ?? t.error ?? 'no_access_token',
      });
      return;
    }
    const expiresAt = t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null;
    // Direkt in DB persistieren via set_oauth_token-RPC. Wir rufen das
    // mit User-JWT auf (Caller-JWT erlaubt SECURITY DEFINER-RPC zu
    // erkennen).
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/set_oauth_token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE}`,
        apikey: SERVICE_ROLE as string,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_provider: provider,
        p_access_token: t.access_token,
        p_refresh_token: t.refresh_token ?? null,
        p_generic_credentials: null,
        p_expires_at: expiresAt,
        p_scopes: t.scope ? t.scope.split(/\s+/).filter(Boolean) : null,
      }),
    });
    send(res, 200, {
      access_token: t.access_token,
      refresh_token: t.refresh_token ?? null,
      expires_at: expiresAt,
    });
  } catch (err) {
    console.error('[oauth-bridge] refresh-error:', err);
    send(res, 500, { error: 'internal_error' });
  }
}

// ─── HTTP-Server ────────────────────────────────────────────────

async function main(): Promise<void> {
  await pg.connect();
  console.log('[oauth-bridge] postgres connected');

  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      send(res, 405, { error: 'method_not_allowed' });
      return;
    }
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    if (url.pathname === '/exchange') return void handleExchange(req, res);
    if (url.pathname === '/refresh') return void handleRefresh(req, res);
    send(res, 404, { error: 'not_found' });
  });

  server.listen(PORT, HOST, () => {
    console.log(`[oauth-bridge] listening on ${HOST}:${PORT}`);
  });
}

void main().catch((err) => {
  console.error('[oauth-bridge] startup-error:', err);
  process.exit(1);
});
