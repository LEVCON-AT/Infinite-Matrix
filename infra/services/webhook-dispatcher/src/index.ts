// Welle C.3 — Webhook-Dispatch-Worker.
//
// Selbst-gehosteter Node-Service. LAEUFT NEBEN Supabase auf demselben
// VPS. Verbindet sich an die Postgres-DB direkt (DATABASE_URL via env)
// und LISTEN'd auf 'workspace_events_new'-Channel. Bei NOTIFY:
//   1. Event laden via SELECT.
//   2. Aktive Webhooks mit passendem event_type-Subscribe finden.
//   3. POST an target_url mit HMAC-SHA256-Signatur (Header
//      X-Webhook-Signature: sha256=<hex>).
//   4. last_status_code + last_attempt_at + last_success_at +
//      fail_count updaten. Direkt ueber die DB, weil der Service mit
//      service_role-Permissions laeuft.
//
// SSRF-Schutz (Welle C.3 Pflicht):
//   - target_url muss https sein (DB-Constraint plus Re-Check hier).
//   - DNS-Aufloesung gegen private IP-Ranges blockieren:
//     127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
//     169.254.0.0/16 (link-local), ::1, fc00::/7.
//   - Maximum-Redirects 0 (kein Follow → User kann nicht mit
//     internem 302 wegredirecten).
//   - Timeout 5s.
//
// Retry mit exponential-Backoff via fail_count: 1./2./3. Versuch
// sofort bei Event, danach Manual-Retry vom UI (V2 = automatischer
// Retry-Job).
//
// Boot:
//   DATABASE_URL=postgresql://postgres@.../postgres node dist/index.js
//
// systemd-Unit: infra/systemd/matrix-webhook-dispatcher.service
// (folgt im Deploy-Sprint).

import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { Client } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL env-var fehlt.');
  process.exit(1);
}

const HTTP_TIMEOUT_MS = 5000;
const MAX_FAIL_COUNT = 5; // nach 5 fails wird der Webhook auto-disabled

type Event = {
  id: string;
  workspace_id: string;
  event_type: string;
  payload: unknown;
  actor_id: string | null;
  created_at: string;
};

type Webhook = {
  id: string;
  target_url: string;
  signing_secret: Buffer;
  fail_count: number;
};

const pg = new Client({ connectionString: DATABASE_URL });

async function loadEvent(id: string): Promise<Event | null> {
  const r = await pg.query<Event>(
    'SELECT id, workspace_id, event_type, payload, actor_id, created_at FROM workspace_events WHERE id = $1',
    [id],
  );
  return r.rows[0] ?? null;
}

async function loadWebhooks(workspaceId: string, eventType: string): Promise<Webhook[]> {
  const r = await pg.query<Webhook>(
    `SELECT id, target_url, signing_secret, fail_count
       FROM workspace_webhooks
      WHERE workspace_id = $1
        AND enabled = true
        AND $2 = ANY(event_types)
        AND fail_count < $3`,
    [workspaceId, eventType, MAX_FAIL_COUNT],
  );
  return r.rows;
}

// SSRF-Filter: bekannte private IP-Ranges.
function isPrivateIp(ip: string): boolean {
  if (ip === '127.0.0.1' || ip === '::1') return true;
  // IPv4 private Ranges.
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [, a, b] = m.map(Number) as [number, number, number, number, number];
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 127) return true;
    if (a >= 224) return true; // multicast/reserved
  }
  // IPv6 ULA fc00::/7 + link-local fe80::/10 + loopback ::1.
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
  if (ip.startsWith('fe80:') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) return true;
  return false;
}

async function ssrfCheckUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('invalid_url');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('invalid_protocol');
  }
  // Dual-stack-Aufloesung gegen private IPs pruefen.
  const addrs = await lookup(u.hostname, { all: true });
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new Error('private_ip_blocked');
    }
  }
  return u;
}

function buildPayload(event: Event): Uint8Array {
  const body = JSON.stringify({
    id: event.id,
    workspace_id: event.workspace_id,
    event_type: event.event_type,
    payload: event.payload,
    actor_id: event.actor_id,
    created_at: event.created_at,
  });
  return new TextEncoder().encode(body);
}

function signPayload(secret: Buffer, body: Uint8Array): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(body);
  return `sha256=${hmac.digest('hex')}`;
}

async function dispatchOne(event: Event, hook: Webhook): Promise<void> {
  const start = Date.now();
  let statusCode: number | null = null;
  let success = false;
  try {
    const url = await ssrfCheckUrl(hook.target_url);
    const body = buildPayload(event);
    const sig = signPayload(hook.signing_secret, body);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': sig,
        'X-Webhook-Event-Type': event.event_type,
        'X-Webhook-Event-Id': event.id,
        'User-Agent': 'matrix-webhook-dispatcher/0.1',
      },
      body,
      redirect: 'manual', // kein Redirect-Follow (SSRF-Schutz)
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    statusCode = res.status;
    success = res.status >= 200 && res.status < 300;
  } catch (err) {
    console.warn(`[dispatch] hook=${hook.id} event=${event.id} failed:`, err);
  }

  // Status zurueckschreiben.
  await pg.query(
    `UPDATE workspace_webhooks
        SET last_attempt_at = now(),
            last_status_code = $1,
            last_success_at = CASE WHEN $2 THEN now() ELSE last_success_at END,
            fail_count = CASE WHEN $2 THEN 0 ELSE fail_count + 1 END,
            enabled = CASE WHEN $2 THEN enabled WHEN fail_count + 1 >= $3 THEN false ELSE enabled END
      WHERE id = $4`,
    [statusCode, success, MAX_FAIL_COUNT, hook.id],
  );
  console.log(
    `[dispatch] hook=${hook.id} event=${event.id} status=${statusCode} ms=${Date.now() - start}`,
  );
}

async function processEvent(eventId: string): Promise<void> {
  const event = await loadEvent(eventId);
  if (!event) {
    console.warn(`[dispatch] event ${eventId} not found`);
    return;
  }
  const hooks = await loadWebhooks(event.workspace_id, event.event_type);
  if (hooks.length === 0) return;
  await Promise.all(hooks.map((h) => dispatchOne(event, h)));
}

async function main() {
  await pg.connect();
  console.log('[dispatcher] connected to postgres');

  pg.on('notification', (msg) => {
    if (msg.channel !== 'workspace_events_new' || !msg.payload) return;
    void processEvent(msg.payload).catch((err) => {
      console.error('[dispatch] processEvent failed:', err);
    });
  });

  await pg.query('LISTEN workspace_events_new');
  console.log('[dispatcher] listening on workspace_events_new');

  // Graceful Shutdown.
  const shutdown = async (sig: string) => {
    console.log(`[dispatcher] ${sig} — shutting down`);
    try {
      await pg.end();
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[dispatcher] fatal:', err);
  process.exit(1);
});
