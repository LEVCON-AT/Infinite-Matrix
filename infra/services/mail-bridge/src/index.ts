// Welle WV.D.3.d — Mail-Bridge (IMAP+SMTP) fuer mail-generic Provider.
//
// Konzept §13.1 + plan-welle-d.md §4.1.
//
// Browser kann keinen TCP-Socket fuer IMAP/SMTP oeffnen — dieser Service
// proxy't pro User-Request:
//   - Liest user_oauth_tokens.generic_credentials_encrypted (service-role).
//   - Decrypted + parsed JSON {imap_host, imap_port, smtp_host, smtp_port,
//     username, app_password}.
//   - Oeffnet IMAP-Verbindung via imapflow ODER SMTP via nodemailer.
//   - Gibt Mail-Liste / Mail-Body / Send-Result zurueck.
//
// Endpoints (alle behind nginx /api/mail-bridge/...):
//
//   POST /list_folders
//     Auth: Bearer <user-jwt>
//     Output: { folders: Array<{ id, name, unread? }> }
//
//   POST /list_messages
//     Body: { folder_id, limit? }
//     Output: { messages: Array<{ id, subject, from, body_text, received_at, ... }> }
//
//   POST /send
//     Body: { to[], cc?, bcc?, subject?, body_text }
//     Output: { ok: true, message_id }
//
//   POST /test_connect
//     Output: { ok: true, profile_label } | { ok: false, reason }
//
// Bind: 127.0.0.1:8086. nginx routet /api/mail-bridge/.
//
// Env:
//   PORT=8086
//   HOST=127.0.0.1
//   DATABASE_URL=postgresql://...
//   SUPABASE_JWT_SECRET=<jwt-secret>

import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { Client } from 'pg';

const PORT = Number(process.env.PORT ?? 8086);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

if (!DATABASE_URL) {
  console.error('[mail-bridge] DATABASE_URL fehlt.');
  process.exit(1);
}
if (!JWT_SECRET) {
  console.error('[mail-bridge] SUPABASE_JWT_SECRET fehlt.');
  process.exit(1);
}

const pg = new Client({ connectionString: DATABASE_URL });

// ─── JWT-Verify (gleich wie in oauth-bridge) ────────────────────

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

// ─── Credentials laden ──────────────────────────────────────────

type MailCreds = {
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  username: string;
  app_password: string;
};

async function loadCreds(userId: string): Promise<MailCreds | null> {
  const r = await pg.query<{ creds: string | null }>(
    `SELECT pgp_sym_decrypt(generic_credentials_encrypted, current_setting('app.ai_master_key'))::text AS creds
       FROM public.user_oauth_tokens
      WHERE user_id = $1
        AND provider = 'mail-generic'
        AND generic_credentials_encrypted IS NOT NULL`,
    [userId],
  );
  const raw = r.rows[0]?.creds;
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<MailCreds>;
    if (
      !obj.imap_host ||
      !obj.smtp_host ||
      !obj.username ||
      !obj.app_password
    ) {
      return null;
    }
    return {
      imap_host: obj.imap_host,
      imap_port: obj.imap_port ?? 993,
      smtp_host: obj.smtp_host,
      smtp_port: obj.smtp_port ?? 465,
      username: obj.username,
      app_password: obj.app_password,
    };
  } catch {
    return null;
  }
}

// ─── IMAP-Helpers ───────────────────────────────────────────────

async function withImap<T>(creds: MailCreds, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: creds.imap_host,
    port: creds.imap_port,
    secure: creds.imap_port === 993,
    auth: { user: creds.username, pass: creds.app_password },
    logger: false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

async function listFolders(creds: MailCreds): Promise<Array<{ id: string; name: string }>> {
  return withImap(creds, async (client) => {
    const list = await client.list();
    return list.map((box) => ({ id: box.path, name: box.name ?? box.path }));
  });
}

async function listMessages(
  creds: MailCreds,
  folder: string,
  limit: number,
): Promise<
  Array<{
    id: string;
    subject?: string;
    from?: string;
    from_address?: string;
    body_text?: string;
    received_at?: string;
  }>
> {
  return withImap(creds, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const out: Array<{
        id: string;
        subject?: string;
        from?: string;
        from_address?: string;
        body_text?: string;
        received_at?: string;
      }> = [];
      const all = await client.search({ all: true });
      const allIds: number[] = Array.isArray(all) ? all : [];
      const ids = allIds.slice(-limit).reverse();
      for (const seq of ids) {
        const msg = await client.fetchOne(String(seq), {
          uid: true,
          envelope: true,
          internalDate: true,
          source: true,
        });
        if (!msg) continue;
        const fromAddr = msg.envelope?.from?.[0];
        const internal = msg.internalDate;
        const internalIso =
          internal instanceof Date ? internal.toISOString() : typeof internal === 'string' ? internal : undefined;
        out.push({
          id: String(msg.uid ?? seq),
          subject: msg.envelope?.subject,
          from: fromAddr?.name || fromAddr?.address || 'unbekannt',
          from_address: fromAddr?.address,
          received_at: internalIso,
          body_text: msg.source ? msg.source.toString().slice(0, 5000) : undefined,
        });
      }
      return out;
    } finally {
      lock.release();
    }
  });
}

async function sendMail(
  creds: MailCreds,
  input: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject?: string;
    body_text: string;
  },
): Promise<string> {
  const transporter = nodemailer.createTransport({
    host: creds.smtp_host,
    port: creds.smtp_port,
    secure: creds.smtp_port === 465,
    auth: { user: creds.username, pass: creds.app_password },
  });
  const info = await transporter.sendMail({
    from: creds.username,
    to: input.to.join(', '),
    cc: input.cc?.join(', '),
    bcc: input.bcc?.join(', '),
    subject: input.subject ?? '',
    text: input.body_text,
  });
  return info.messageId ?? '';
}

// ─── Endpoints ──────────────────────────────────────────────────

async function authedHandler(
  req: IncomingMessage,
  res: ServerResponse,
  fn: (userId: string, body: Record<string, unknown>) => Promise<unknown>,
): Promise<void> {
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
  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    try {
      body = await readJson(req);
    } catch {
      send(res, 400, { error: 'invalid_json' });
      return;
    }
  }
  try {
    const result = await fn(payload.sub, body);
    send(res, 200, result);
  } catch (err) {
    console.error('[mail-bridge] error:', err);
    send(res, 500, { error: err instanceof Error ? err.message : 'internal_error' });
  }
}

async function main(): Promise<void> {
  await pg.connect();
  console.log('[mail-bridge] postgres connected');

  const server = createServer((req, res) => {
    if (req.method !== 'POST') {
      send(res, 405, { error: 'method_not_allowed' });
      return;
    }
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);

    if (url.pathname === '/list_folders') {
      void authedHandler(req, res, async (uid) => {
        const creds = await loadCreds(uid);
        if (!creds) throw new Error('not_connected');
        return { folders: await listFolders(creds) };
      });
      return;
    }
    if (url.pathname === '/list_messages') {
      void authedHandler(req, res, async (uid, body) => {
        const creds = await loadCreds(uid);
        if (!creds) throw new Error('not_connected');
        const folder = String(body.folder_id ?? 'INBOX');
        const limit = Number(body.limit ?? 20);
        return { messages: await listMessages(creds, folder, limit) };
      });
      return;
    }
    if (url.pathname === '/send') {
      void authedHandler(req, res, async (uid, body) => {
        const creds = await loadCreds(uid);
        if (!creds) throw new Error('not_connected');
        const to = Array.isArray(body.to) ? (body.to as string[]) : [];
        const cc = Array.isArray(body.cc) ? (body.cc as string[]) : undefined;
        const bcc = Array.isArray(body.bcc) ? (body.bcc as string[]) : undefined;
        const subject = body.subject ? String(body.subject) : undefined;
        const bodyText = String(body.body_text ?? '');
        if (to.length === 0) throw new Error('to_required');
        const id = await sendMail(creds, { to, cc, bcc, subject, body_text: bodyText });
        return { ok: true, message_id: id };
      });
      return;
    }
    if (url.pathname === '/test_connect') {
      void authedHandler(req, res, async (uid) => {
        const creds = await loadCreds(uid);
        if (!creds) return { ok: false, reason: 'not_connected' };
        try {
          const folders = await listFolders(creds);
          return { ok: true, profile_label: creds.username, folder_count: folders.length };
        } catch (err) {
          return { ok: false, reason: err instanceof Error ? err.message : 'imap_error' };
        }
      });
      return;
    }
    send(res, 404, { error: 'not_found' });
  });

  server.listen(PORT, HOST, () => {
    console.log(`[mail-bridge] listening on ${HOST}:${PORT}`);
  });
}

void main().catch((err) => {
  console.error('[mail-bridge] startup-error:', err);
  process.exit(1);
});
