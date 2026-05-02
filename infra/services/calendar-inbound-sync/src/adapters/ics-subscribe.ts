// ICS-Subscribe-Adapter (Welle I.3).
//
// Pollt eine externe ICS-URL via HTTP GET mit Conditional-Headern
// (If-None-Match / If-Modified-Since), parst RFC-5545 via node-ical
// und uebergibt die ParsedEvents an den Caller (der dann upsertEvents
// + markOrphaned + liveSyncDerived ausfuehrt).
//
// Recurring: node-ical liefert pro RRULE-EVENT ein Master-Event +
// expandierte Instanzen. Wir speichern nur das Master-Event mit der
// originalen RRULE-Property — Expansion passiert clientseitig via
// recurFiresOn (lib/calendar.ts). Exception-Instanzen (RECURRENCE-ID)
// kommen als separate Events mit recurrence_id != null.

import * as ical from 'node-ical';
import type { ParsedEvent, SyncResult } from '../types.js';

const HTTP_TIMEOUT_MS = 15_000;

export type IcsAdapterArgs = {
  url: string;
  lastEtag: string | null;
  lastModifiedHeader: string | null;
};

export async function syncIcsSubscribe(args: IcsAdapterArgs): Promise<{
  result: SyncResult;
  events: ParsedEvent[];
  externalIds: string[];
}> {
  const headers: Record<string, string> = {
    'User-Agent': 'matrix-calendar-inbound-sync/0.1',
    Accept: 'text/calendar',
  };
  if (args.lastEtag) headers['If-None-Match'] = args.lastEtag;
  if (args.lastModifiedHeader) headers['If-Modified-Since'] = args.lastModifiedHeader;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(args.url, { headers, redirect: 'follow', signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }

  if (resp.status === 304) {
    return {
      result: { ok: true, inserted: 0, updated: 0, orphaned: 0, not_modified: true },
      events: [],
      externalIds: [],
    };
  }
  if (!resp.ok) {
    return {
      result: {
        ok: false,
        inserted: 0,
        updated: 0,
        orphaned: 0,
        not_modified: false,
        error: `http_${resp.status}`,
      },
      events: [],
      externalIds: [],
    };
  }

  const text = await resp.text();
  const events = parseIcsText(text);
  const externalIds = events.map((e) => e.external_id);

  const newEtag = resp.headers.get('etag');
  const newLastModified = resp.headers.get('last-modified');

  return {
    result: {
      ok: true,
      inserted: 0,
      updated: 0,
      orphaned: 0,
      not_modified: false,
      meta: {
        ...(newEtag ? { last_etag: newEtag } : {}),
        ...(newLastModified ? { last_modified_header: newLastModified } : {}),
      },
    },
    events,
    externalIds,
  };
}

function isAllDay(start: Date, raw: Record<string, unknown>): boolean {
  // node-ical setzt fuer DATE-only-Events den 'datetype'='date'.
  if (raw['datetype'] === 'date') return true;
  // Fallback: 00:00:00 UTC plus exact 1 day Differenz waere Indiz.
  if (start.getUTCHours() === 0 && start.getUTCMinutes() === 0 && start.getUTCSeconds() === 0) {
    return false; // konservativ — ohne datetype='date' nehmen wir timed an.
  }
  return false;
}

function parseIcsText(text: string): ParsedEvent[] {
  const parsed = ical.sync.parseICS(text);
  const out: ParsedEvent[] = [];

  for (const key of Object.keys(parsed)) {
    const ev = parsed[key];
    if (!ev || ev.type !== 'VEVENT') continue;

    const start = ev.start as Date | undefined;
    const end = ev.end as Date | undefined;
    if (!start) continue;

    const summary = typeof ev.summary === 'string' ? ev.summary : (ev.summary as { val?: string })?.val ?? '';

    // node-ical legt Recurrence-Exceptions als Properties unter dem
    // Master-Event ab (ev.recurrences[YYYY-MM-DD]). Wir flatten beides.
    // Master-Event:
    const masterRrule = (ev as { rrule?: { toString: () => string } }).rrule?.toString() ?? null;

    out.push({
      external_id: typeof ev.uid === 'string' ? ev.uid : key,
      recurrence_id: null,
      summary: summary.trim() || '(ohne Titel)',
      description: typeof ev.description === 'string' ? ev.description : null,
      location: typeof ev.location === 'string' ? ev.location : null,
      url: typeof ev.url === 'string' ? ev.url : null,
      start_at: start.toISOString(),
      end_at: end ? end.toISOString() : null,
      all_day: isAllDay(start, ev as unknown as Record<string, unknown>),
      rrule: masterRrule,
      source_modified_at: ev.lastmodified instanceof Date ? ev.lastmodified.toISOString() : null,
    });

    // Recurrence-Exceptions als separate Rows.
    const recurrences = (ev as { recurrences?: Record<string, unknown> }).recurrences;
    if (recurrences) {
      for (const dateKey of Object.keys(recurrences)) {
        const exc = recurrences[dateKey] as {
          start?: Date;
          end?: Date;
          summary?: string | { val: string };
          description?: string;
          location?: string;
          url?: string;
          uid?: string;
          lastmodified?: Date;
        };
        if (!exc.start) continue;
        const excSummary =
          typeof exc.summary === 'string'
            ? exc.summary
            : (exc.summary as { val?: string } | undefined)?.val ?? summary;
        out.push({
          external_id: typeof ev.uid === 'string' ? ev.uid : key,
          recurrence_id: dateKey,
          summary: (excSummary || '').trim() || '(ohne Titel)',
          description: exc.description ?? null,
          location: exc.location ?? null,
          url: exc.url ?? null,
          start_at: exc.start.toISOString(),
          end_at: exc.end ? exc.end.toISOString() : null,
          all_day: isAllDay(exc.start, exc as unknown as Record<string, unknown>),
          rrule: null,
          source_modified_at: exc.lastmodified ? exc.lastmodified.toISOString() : null,
        });
      }
    }
  }

  return out;
}
