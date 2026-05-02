// Welle I.3 — Calendar-Inbound-Sync.
//
// Self-hosted Node-Service auf 127.0.0.1:8083 (default). Saugt externe
// Kalender (ICS-Subscribe / Google / Microsoft) in die DB:
//
//   1. LISTEN auf 'calendar_sync_due' fuer sofortigen Sync-Auftrag aus
//      dem Frontend ("Pull-jetzt"-Knopf via trigger_external_calendar_sync).
//   2. Cron-Loop alle 60s: list_due_external_calendars liefert alle
//      ICS-Subscribes deren last_sync_at < now() - sync_interval_minutes.
//   3. HTTP-Server (Welle I.10/I.11): /webhook/google/:channelId und
//      /webhook/microsoft/:subscriptionId fuer Push-Notifications.
//      V1-Skeleton: Webhook-Endpoints melden 200 + triggern Sync.
//
// nginx routet 'staging.matrix.levcon.at/api/calendar-inbound-webhook/*'
// → 127.0.0.1:8083. Defense-in-Depth: kein direkter Internet-Zugriff.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Client } from 'pg';
import { syncIcsSubscribe } from './adapters/ics-subscribe.js';
import { syncGoogle } from './adapters/google.js';
import { syncMicrosoft } from './adapters/microsoft.js';
import { DB, summarizeResult } from './db.js';
import type { CalendarKind, ParsedEvent, SyncResult } from './types.js';

const PORT = Number(process.env.PORT ?? 8083);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATABASE_URL = process.env.DATABASE_URL;
const CRON_TICK_MS = Number(process.env.CRON_TICK_MS ?? 60_000);

if (!DATABASE_URL) {
  console.error('[cal-inbound] DATABASE_URL env-var fehlt.');
  process.exit(1);
}

const pg = new Client({ connectionString: DATABASE_URL });
const db = new DB(pg);

// ─── Single-flight: nicht denselben Calendar parallel syncen ────────
const inflight = new Set<string>();

async function syncCalendar(id: string): Promise<void> {
  if (inflight.has(id)) {
    console.log(`[cal-inbound] cal=${id} skip (inflight)`);
    return;
  }
  inflight.add(id);
  try {
    await db.setSyncStatus(id, 'syncing');
    const cred = await db.getCredentials(id);
    if (!cred) {
      console.warn(`[cal-inbound] cal=${id} not found`);
      return;
    }

    let result: SyncResult;
    let events: ParsedEvent[] = [];
    let externalIds: string[] = [];

    if (cred.kind === 'ics_subscribe') {
      if (!cred.source_url) {
        result = {
          ok: false,
          inserted: 0,
          updated: 0,
          orphaned: 0,
          not_modified: false,
          error: 'no_source_url',
        };
      } else {
        const r = await syncIcsSubscribe({
          url: cred.source_url,
          lastEtag: cred.last_etag,
          lastModifiedHeader: cred.last_modified_header,
        });
        result = r.result;
        events = r.events;
        externalIds = r.externalIds;
      }
    } else if (cred.kind === 'google') {
      const r = await syncGoogle({
        oauth_token: cred.oauth_token,
        oauth_refresh_token: cred.oauth_refresh_token,
        oauth_expires_at: cred.oauth_expires_at,
        sync_token: cred.sync_token,
      });
      result = r.result;
      events = r.events;
      externalIds = r.externalIds;
    } else if (cred.kind === 'microsoft') {
      const r = await syncMicrosoft({
        oauth_token: cred.oauth_token,
        oauth_refresh_token: cred.oauth_refresh_token,
        oauth_expires_at: cred.oauth_expires_at,
        sync_token: cred.sync_token,
      });
      result = r.result;
      events = r.events;
      externalIds = r.externalIds;
    } else {
      // 'upload' wird nicht periodisch gesynct.
      result = {
        ok: true,
        inserted: 0,
        updated: 0,
        orphaned: 0,
        not_modified: true,
      };
    }

    if (result.ok && !result.not_modified) {
      const upsert = await db.upsertEvents(id, events);
      result.inserted = upsert.inserted;
      result.updated = upsert.updated;
      const orphaned = await db.markOrphaned(id, externalIds);
      result.orphaned = orphaned;

      const liveIds = await db.eventIdsForLiveSync(id);
      if (liveIds.length > 0) {
        const synced = await db.liveSyncDerived(liveIds);
        if (synced > 0) console.log(`[cal-inbound] cal=${id} live-sync tasks=${synced}`);
      }
    }

    if (result.meta) {
      await db.updateCredentials(id, {
        ...(result.meta.last_etag ? { last_etag: result.meta.last_etag } : {}),
        ...(result.meta.last_modified_header
          ? { last_modified_header: result.meta.last_modified_header }
          : {}),
        ...(result.meta.sync_token ? { sync_token: result.meta.sync_token } : {}),
      });
    }

    await db.setSyncStatus(id, result.ok ? 'idle' : 'error', result.ok ? null : result.error);
    console.log(`[cal-inbound] cal=${id} kind=${cred.kind} ${summarizeResult(result)}`);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.error(`[cal-inbound] cal=${id} fatal:`, msg);
    try {
      await db.setSyncStatus(id, 'error', msg);
    } catch {
      /* swallow */
    }
  } finally {
    inflight.delete(id);
  }
}

// ─── LISTEN-Loop fuer "Pull-jetzt"-Trigger ───────────────────────
function attachListener(): void {
  pg.on('notification', (msg) => {
    if (msg.channel !== 'calendar_sync_due' || !msg.payload) return;
    const id = msg.payload;
    void syncCalendar(id).catch((err) => {
      console.error('[cal-inbound] sync failed:', err);
    });
  });
}

// ─── Cron-Loop: alle CRON_TICK_MS Due-Calendars holen ───────────
async function tickCron(): Promise<void> {
  try {
    const due = await db.listDue();
    if (due.length === 0) return;
    console.log(`[cal-inbound] cron tick — due=${due.length}`);
    for (const c of due) {
      void syncCalendar(c.id).catch((err) => {
        console.error('[cal-inbound] cron sync failed:', err);
      });
    }
  } catch (err) {
    console.error('[cal-inbound] cron tick failed:', err);
  }
}

// ─── HTTP-Server fuer Webhook-Endpoints (V1-Skeleton) ───────────
async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk;
      // 64 KB hard cap — Webhook-Bodies sind ueblicherweise klein.
      if (buf.length > 65_536) {
        req.destroy();
        reject(new Error('body_too_large'));
      }
    });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

async function findCalendarByChannelId(channelId: string): Promise<string | null> {
  const r = await pg.query<{ id: string }>(
    'SELECT id FROM public.external_calendars WHERE webhook_channel_id = $1 LIMIT 1',
    [channelId],
  );
  return r.rows[0]?.id ?? null;
}

async function findCalendarByMsSubscriptionId(subId: string): Promise<string | null> {
  const r = await pg.query<{ id: string }>(
    'SELECT id FROM public.external_calendars WHERE webhook_channel_id = $1 LIMIT 1',
    [subId],
  );
  return r.rows[0]?.id ?? null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://internal');

    if (req.method === 'GET' && url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }

    // Microsoft Graph subscription validation handshake:
    //   POST /webhook/microsoft/:subId?validationToken=<token>
    //   → muss 200 mit dem Token im Body antworten innerhalb 10s.
    const msMatch = url.pathname.match(/^\/webhook\/microsoft\/([^/]+)$/);
    if (msMatch && req.method === 'POST') {
      const validationToken = url.searchParams.get('validationToken');
      if (validationToken) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(validationToken);
        return;
      }
      const subId = msMatch[1];
      if (!subId) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not_found');
        return;
      }
      const calendarId = await findCalendarByMsSubscriptionId(subId);
      if (!calendarId) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not_found');
        return;
      }
      // Body-Validation (clientState) wird in I.11 ergaenzt.
      await readBody(req).catch(() => '');
      res.writeHead(202, { 'content-type': 'text/plain' });
      res.end('accepted');
      void syncCalendar(calendarId).catch((err) => {
        console.error('[cal-inbound] webhook ms sync failed:', err);
      });
      return;
    }

    // Google Calendar Push:
    //   POST /webhook/google
    //   Headers:
    //     X-Goog-Channel-Id, X-Goog-Resource-Id, X-Goog-Resource-State
    if (url.pathname === '/webhook/google' && req.method === 'POST') {
      const channelId = req.headers['x-goog-channel-id'] as string | undefined;
      const resourceState = req.headers['x-goog-resource-state'] as string | undefined;
      if (!channelId) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end('missing_channel_id');
        return;
      }
      // 'sync' beim ersten Watch — koennen wir ignorieren.
      if (resourceState === 'sync') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
        return;
      }
      const calendarId = await findCalendarByChannelId(channelId);
      if (!calendarId) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('channel_not_found');
        return;
      }
      res.writeHead(202, { 'content-type': 'text/plain' });
      res.end('accepted');
      void syncCalendar(calendarId).catch((err) => {
        console.error('[cal-inbound] webhook google sync failed:', err);
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not_found');
  } catch (err) {
    console.error('[cal-inbound] http error:', err);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('internal_error');
  }
});

// ─── Bootstrap ──────────────────────────────────────────────────
let cronInterval: ReturnType<typeof setInterval> | null = null;

async function main(): Promise<void> {
  await pg.connect();
  console.log('[cal-inbound] connected to postgres');

  attachListener();
  await pg.query('LISTEN calendar_sync_due');
  console.log('[cal-inbound] listening on calendar_sync_due');

  cronInterval = setInterval(() => {
    void tickCron();
  }, CRON_TICK_MS);
  // Initialer Tick — verzoegert damit Service nicht direkt nach Boot
  // alles synct (gibt nginx/systemd Zeit zum Warmlaufen).
  setTimeout(() => void tickCron(), 5_000);

  server.listen(PORT, HOST, () => {
    console.log(`[cal-inbound] listening on ${HOST}:${PORT}`);
  });
}

const shutdown = async (sig: string): Promise<void> => {
  console.log(`[cal-inbound] ${sig} — shutting down`);
  if (cronInterval) clearInterval(cronInterval);
  try {
    server.close();
  } catch {
    /* ignore */
  }
  try {
    await pg.end();
  } catch {
    /* ignore */
  }
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((err) => {
  console.error('[cal-inbound] fatal:', err);
  process.exit(1);
});
