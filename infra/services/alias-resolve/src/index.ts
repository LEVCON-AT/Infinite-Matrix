// Welle WV.D.6 — Public-Alias-Resolve-Endpoint.
//
// Konzept §14.1 + plan-welle-d.md §5.1.
//
// Endpoint: GET /api/resolve/:alias
//   - Auth via JWT-Cookie ODER Authorization: Bearer <jwt>.
//   - Alias-Lookup im Workspace-Scope. RLS-bypass per service-role.
//   - Member-Check: User muss Mitglied im Workspace sein, dem der Alias
//     gehoert. Bei Non-Member: HTTP-401 + Redirect zu /login?return=...
//   - Bei Member: HTTP-302 zur tatsaechlichen Atom-URL.
//
// V1: Workspace-internes-Resolve. V2 (deferred): Public-Read fuer
// workspace-public-Atomen (Konzept §14.1).
//
// Bind: 127.0.0.1:8084. nginx routet `matrix.levcon.at/api/resolve/`
// → dahin.
//
// Env:
//   PORT=8084
//   HOST=127.0.0.1
//   DATABASE_URL=postgresql://...
//   SUPABASE_JWT_SECRET=<jwt-secret aus supabase/.env, JWT_SECRET>
//   FRONTEND_BASE_URL=https://matrix.levcon.at/app

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac } from 'node:crypto';
import { Client } from 'pg';

const PORT = Number(process.env.PORT ?? 8084);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const FRONTEND_BASE = (process.env.FRONTEND_BASE_URL ?? 'https://matrix.levcon.at/app').replace(
  /\/$/,
  '',
);

if (!DATABASE_URL) {
  console.error('[alias-resolve] DATABASE_URL fehlt.');
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error('[alias-resolve] SUPABASE_JWT_SECRET fehlt.');
  process.exit(1);
}

const pg = new Client({ connectionString: DATABASE_URL });

// ─── JWT-Validation ─────────────────────────────────────────────
// Supabase-JWT ist HS256 mit JWT_SECRET. Wir validieren Signatur +
// Expiry, extrahieren `sub` (= user-id) + `role`.

type JwtPayload = {
  sub?: string;
  role?: string;
  exp?: number;
};

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
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as JwtPayload;
  } catch {
    return null;
  }
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  return payload;
}

function extractToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  // Cookie-Fallback: supabase-auth-token
  const cookie = req.headers.cookie ?? '';
  const m = cookie.match(/sb-access-token=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  return null;
}

// ─── Alias-Resolve ─────────────────────────────────────────────
// Wir nutzen eine SECURITY DEFINER-RPC `resolve_alias_for_user` (folgt
// in Migration 081) ODER einen direkten SQL-Lookup via service-role
// (RLS-bypass). V1: direkter Lookup auf 6 Alias-Tabellen.

type ResolvedAtom = {
  workspace_id: string;
  url_path: string; // z.B. '/w/<wsId>/n/<nodeId>' oder '/w/<wsId>/c/<cellId>/info'
};

async function resolveAlias(alias: string, userId: string): Promise<ResolvedAtom | null> {
  const key = alias.toLowerCase().replace(/^\^/, '');
  // 1. Nodes (matrix/board)
  const node = await pg.query(
    `SELECT id, workspace_id FROM public.nodes WHERE lower(alias) = $1 LIMIT 1`,
    [key],
  );
  if (node.rowCount && node.rowCount > 0) {
    const r = node.rows[0];
    if (await isMember(r.workspace_id, userId)) {
      return { workspace_id: r.workspace_id, url_path: `/w/${r.workspace_id}/n/${r.id}` };
    }
    return null;
  }
  // 2. Cells
  const cell = await pg.query(
    `SELECT id, workspace_id FROM public.cells WHERE lower(alias) = $1 LIMIT 1`,
    [key],
  );
  if (cell.rowCount && cell.rowCount > 0) {
    const r = cell.rows[0];
    if (await isMember(r.workspace_id, userId)) {
      return {
        workspace_id: r.workspace_id,
        url_path: `/w/${r.workspace_id}/c/${r.id}/info`,
      };
    }
    return null;
  }
  // 3. kb_cards (Cards)
  const card = await pg.query(
    `SELECT c.id, c.workspace_id, c.board_id FROM public.kb_cards c WHERE lower(c.alias) = $1 LIMIT 1`,
    [key],
  );
  if (card.rowCount && card.rowCount > 0) {
    const r = card.rows[0];
    if (await isMember(r.workspace_id, userId)) {
      return {
        workspace_id: r.workspace_id,
        url_path: `/w/${r.workspace_id}/n/${r.board_id}#card-${r.id}`,
      };
    }
    return null;
  }
  // 4. links
  const link = await pg.query(
    `SELECT l.id, l.workspace_id, l.url FROM public.links l WHERE lower(l.label) = $1 LIMIT 1`,
    [key],
  );
  if (link.rowCount && link.rowCount > 0) {
    const r = link.rows[0];
    if (await isMember(r.workspace_id, userId)) {
      return { workspace_id: r.workspace_id, url_path: r.url };
    }
    return null;
  }
  // 5. checklists
  const cl = await pg.query(
    `SELECT id, workspace_id FROM public.checklists WHERE lower(alias) = $1 LIMIT 1`,
    [key],
  );
  if (cl.rowCount && cl.rowCount > 0) {
    const r = cl.rows[0];
    if (await isMember(r.workspace_id, userId)) {
      return {
        workspace_id: r.workspace_id,
        url_path: `/w/${r.workspace_id}/checklist/${r.id}`,
      };
    }
    return null;
  }
  return null;
}

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const r = await pg.query(
    `SELECT 1 FROM public.memberships WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
    [workspaceId, userId],
  );
  return (r.rowCount ?? 0) > 0;
}

// ─── HTTP-Server ────────────────────────────────────────────────

function send(res: ServerResponse, status: number, body: string, contentType = 'text/plain'): void {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

async function handleResolve(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '', `http://${req.headers.host}`);
  const m = url.pathname.match(/^\/api\/resolve\/([^/]+)\/?$/);
  if (!m) {
    send(res, 404, 'not_found');
    return;
  }
  const alias = decodeURIComponent(m[1]);

  const token = extractToken(req);
  if (!token) {
    // 401 + Login-Redirect-Hint via Header (Frontend-Helper kann lesen).
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'X-Login-Redirect': `${FRONTEND_BASE}/login?return=/api/resolve/${encodeURIComponent(alias)}`,
    });
    res.end(JSON.stringify({ error: 'unauthorized', alias }));
    return;
  }
  const payload = verifyJwt(token);
  if (!payload || !payload.sub) {
    send(res, 401, JSON.stringify({ error: 'invalid_token' }), 'application/json');
    return;
  }

  try {
    const resolved = await resolveAlias(alias, payload.sub);
    if (!resolved) {
      send(res, 404, JSON.stringify({ error: 'alias_not_found_or_no_access', alias }), 'application/json');
      return;
    }
    res.writeHead(302, { Location: `${FRONTEND_BASE}${resolved.url_path}` });
    res.end();
  } catch (err) {
    console.error('[alias-resolve] db error:', err);
    send(res, 500, JSON.stringify({ error: 'internal_error' }), 'application/json');
  }
}

async function main(): Promise<void> {
  await pg.connect();
  console.log('[alias-resolve] postgres connected');

  const server = createServer((req, res) => {
    if (req.method !== 'GET') {
      send(res, 405, 'method_not_allowed');
      return;
    }
    void handleResolve(req, res);
  });

  server.listen(PORT, HOST, () => {
    console.log(`[alias-resolve] listening on ${HOST}:${PORT}`);
  });
}

void main().catch((err) => {
  console.error('[alias-resolve] startup-error:', err);
  process.exit(1);
});
