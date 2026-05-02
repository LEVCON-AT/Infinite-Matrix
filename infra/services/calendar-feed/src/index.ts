// Matrix Calendar-Feed (Welle Calendar V2).
//
// Live-ICS-Feed fuer Outlook/Google/Apple Calendar-Subscriptions. Der
// User klickt in Settings "Calendar abonnieren" → wir generieren ein
// Token, zeigen die URL an. Der Calendar-Client pollt periodisch und
// holt die aktuelle ICS aus diesem Service.
//
// Endpoint:
//   GET /:token.ics
//     200 text/calendar — ICS mit allen Tasks + Atom-Manifestations
//                         des Workspaces (RLS-bypass via SECURITY
//                         DEFINER-RPC).
//     404 — Token nicht gefunden / revoked.
//
// Bind nur auf 127.0.0.1; nginx routet `ics.matrix.levcon.at/{...}.ics`
// → 127.0.0.1:8082. Defense-in-Depth (kein direkter Internet-Zugriff).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Client } from 'pg';

const PORT = Number(process.env.PORT ?? 8082);
const HOST = process.env.HOST ?? '127.0.0.1';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[cal-feed] DATABASE_URL env-var fehlt.');
  process.exit(1);
}

type EventRow = {
  event_id: string;
  event_kind: string;
  label: string | null;
  description: string | null;
  start_date: string | null;  // YYYY-MM-DD
  start_time: string | null;  // HH:MM:SS
  end_date: string | null;
  end_time: string | null;
  all_day: boolean;
  rrule: string | null;
};

const pg = new Client({ connectionString: DATABASE_URL });

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function dateToIcsDate(d: string): string {
  // 'YYYY-MM-DD' → 'YYYYMMDD'
  return d.replace(/-/g, '');
}

function nowIcsStamp(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function buildIcs(events: EventRow[]): string {
  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//Matrix//Calendar Feed 1.0//DE');
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');

  const stamp = nowIcsStamp();
  for (const ev of events) {
    if (!ev.start_date) continue;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.event_kind}-${ev.event_id}@matrix.levcon.at`);
    lines.push(`DTSTAMP:${stamp}`);
    if (ev.all_day) {
      lines.push(`DTSTART;VALUE=DATE:${dateToIcsDate(ev.start_date)}`);
      lines.push(`DTEND;VALUE=DATE:${dateToIcsDate(ev.end_date ?? ev.start_date)}`);
    } else {
      // Mit Zeit — V1 Helper liefert nur all-day; future-proofing.
      const dt = ev.start_time
        ? `${dateToIcsDate(ev.start_date)}T${ev.start_time.replace(/:/g, '').slice(0, 6)}`
        : dateToIcsDate(ev.start_date);
      lines.push(`DTSTART:${dt}`);
      if (ev.end_date) {
        const dte = ev.end_time
          ? `${dateToIcsDate(ev.end_date)}T${ev.end_time.replace(/:/g, '').slice(0, 6)}`
          : dateToIcsDate(ev.end_date);
        lines.push(`DTEND:${dte}`);
      }
    }
    if (ev.label) lines.push(`SUMMARY:${escapeIcs(ev.label)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeIcs(ev.description)}`);
    if (ev.rrule) lines.push(`RRULE:${ev.rrule}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

async function handleFeed(token: string, res: ServerResponse): Promise<void> {
  try {
    const r = await pg.query<EventRow>(
      'SELECT event_id::text, event_kind, label, description, start_date::text, start_time::text, end_date::text, end_time::text, all_day, rrule FROM public.calendar_feed_events($1)',
      [token],
    );
    if (r.rows.length === 0) {
      // Kann legitim leer sein (User hat keine Tasks) ODER Token invalid.
      // Wir antworten 200 mit leerem Calendar — Client soll nicht 404
      // gezeigt bekommen wenn er lange Zeit nicht synced. Token-Revoke
      // gibt der User aktiv aus; bis dahin liefern wir leeren Feed.
      const empty = buildIcs([]);
      res.writeHead(200, {
        'content-type': 'text/calendar; charset=utf-8',
        'cache-control': 'no-cache, max-age=300',
      });
      res.end(empty);
      return;
    }
    const ics = buildIcs(r.rows);
    res.writeHead(200, {
      'content-type': 'text/calendar; charset=utf-8',
      'cache-control': 'no-cache, max-age=300',
    });
    res.end(ics);
    console.log(`[cal-feed] token=${token.slice(0, 8)}… events=${r.rows.length}`);
  } catch (e) {
    console.error('[cal-feed] error:', e);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('internal_error');
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'content-type': 'text/plain' });
    res.end('method_not_allowed');
    return;
  }
  const url = new URL(req.url ?? '/', 'http://internal');
  // Pfad: /{token}.ics oder /healthz
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  const m = url.pathname.match(/^\/([0-9a-f]{32,128})\.ics$/);
  if (!m) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not_found');
    return;
  }
  await handleFeed(m[1] ?? '', res);
});

(async () => {
  await pg.connect();
  console.log('[cal-feed] connected to postgres');
  server.listen(PORT, HOST, () => {
    console.log(`[cal-feed] listening on ${HOST}:${PORT}`);
  });
})();

const shutdown = async (sig: string) => {
  console.log(`[cal-feed] ${sig} — shutting down`);
  try {
    await pg.end();
  } catch {
    // ignore
  }
  server.close(() => process.exit(0));
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
