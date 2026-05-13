// Shared Auth-Helpers fuer Edge-Functions.
//
// Self-hosted Supabase: das edge-runtime extrahiert den Authorization-
// Header nicht automatisch — wir parsen + verifizieren das JWT selbst
// gegen JWT_SECRET aus dem env-Block des Containers. Bei Erfolg
// liefern wir die User-Claims; bei Fehler werfen wir.

import { create, verify } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';

export type AuthClaims = {
  sub: string; // user_id
  email?: string;
  role?: string;
  aal?: 'aal1' | 'aal2';
  amr?: Array<{ method: string; timestamp: number }>;
  exp: number;
};

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const secret = Deno.env.get('JWT_SECRET');
  if (!secret) throw new Error('JWT_SECRET not set in functions env');
  cachedKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify', 'sign'],
  );
  return cachedKey;
}

export async function requireAuth(req: Request): Promise<AuthClaims> {
  const header = req.headers.get('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    throw new Response('Unauthorized', { status: 401 });
  }
  const token = header.slice(7).trim();
  const key = await getKey();
  let payload: unknown;
  try {
    payload = await verify(token, key);
  } catch {
    throw new Response('Invalid token', { status: 401 });
  }
  const claims = payload as AuthClaims;
  if (!claims.sub) throw new Response('Invalid token (no sub)', { status: 401 });
  return claims;
}

// AAL2-Step-Up: pruefen ob die letzte AAL2-Verification jung genug ist.
// Pattern aus lib/auth-step-up.ts auf Server-Side wiederholt — Frontend
// kann luegen, wir muessen es hier autoritativ pruefen.
export function requireFreshAal2(claims: AuthClaims, maxAgeSec = 300): void {
  if (claims.aal !== 'aal2') {
    throw new Response('Step-up required (AAL2)', { status: 401 });
  }
  const totp = (claims.amr ?? []).find((m) => m.method === 'totp');
  if (!totp) {
    throw new Response('TOTP factor required', { status: 401 });
  }
  const ageSec = Math.floor(Date.now() / 1000 - totp.timestamp);
  if (ageSec > maxAgeSec) {
    throw new Response('Step-up stale', { status: 401 });
  }
}

void create; // Re-export-Stub damit ungenutzter Import-Lint nicht zuschlaegt.
