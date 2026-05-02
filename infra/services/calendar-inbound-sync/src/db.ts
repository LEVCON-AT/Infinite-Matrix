// DB-Helper: Service-role-RPC-Aufrufe via direkter pg-Verbindung.
// Encryption + Touch-Logik leben in den SECURITY DEFINER-Helper-Funktionen
// aus Migration 060 — der Service ruft nur RPCs.

import { Client } from 'pg';
import type { CalendarCredentials, ParsedEvent, SyncResult } from './types.js';

export class DB {
  constructor(private pg: Client) {}

  async listDue(): Promise<{ id: string; kind: string }[]> {
    const r = await this.pg.query<{ id: string; kind: string }>(
      'SELECT id, kind FROM public.list_due_external_calendars()',
    );
    return r.rows;
  }

  async getCredentials(id: string): Promise<CalendarCredentials | null> {
    const r = await this.pg.query<{ get_external_calendar_credentials: CalendarCredentials }>(
      'SELECT public.get_external_calendar_credentials($1) AS get_external_calendar_credentials',
      [id],
    );
    const j = r.rows[0]?.get_external_calendar_credentials;
    return j ?? null;
  }

  async setSyncStatus(id: string, status: 'idle' | 'syncing' | 'error', error?: string | null): Promise<void> {
    await this.pg.query('SELECT public.update_external_calendar_sync_status($1, $2, $3, $4)', [
      id,
      status,
      error ?? null,
      status === 'idle' || status === 'error',
    ]);
  }

  async updateCredentials(
    id: string,
    args: Partial<{
      sync_token: string;
      last_etag: string;
      last_modified_header: string;
      oauth_token: string;
      oauth_refresh: string;
      oauth_expires: string;
      webhook_channel: string;
      webhook_resource: string;
      webhook_expires: string;
    }>,
  ): Promise<void> {
    await this.pg.query(
      `SELECT public.update_external_calendar_credentials(
        $1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9, $10::timestamptz
      )`,
      [
        id,
        args.oauth_token ?? null,
        args.oauth_refresh ?? null,
        args.oauth_expires ?? null,
        args.sync_token ?? null,
        args.last_etag ?? null,
        args.last_modified_header ?? null,
        args.webhook_channel ?? null,
        args.webhook_resource ?? null,
        args.webhook_expires ?? null,
      ],
    );
  }

  async upsertEvents(
    calendarId: string,
    events: ParsedEvent[],
  ): Promise<{ inserted: number; updated: number }> {
    if (events.length === 0) return { inserted: 0, updated: 0 };
    const r = await this.pg.query<{ upsert_external_event_batch: { inserted: number; updated: number } }>(
      'SELECT public.upsert_external_event_batch($1, $2::jsonb) AS upsert_external_event_batch',
      [calendarId, JSON.stringify(events)],
    );
    return r.rows[0]?.upsert_external_event_batch ?? { inserted: 0, updated: 0 };
  }

  async markOrphaned(calendarId: string, keepIds: string[]): Promise<number> {
    const r = await this.pg.query<{ mark_external_events_orphaned: number }>(
      'SELECT public.mark_external_events_orphaned($1, $2) AS mark_external_events_orphaned',
      [calendarId, keepIds],
    );
    return r.rows[0]?.mark_external_events_orphaned ?? 0;
  }

  async eventIdsForLiveSync(calendarId: string): Promise<string[]> {
    // Alle Event-IDs des Calendars die als Source fuer abgeleitete Live-Tasks dienen.
    const r = await this.pg.query<{ id: string }>(
      `SELECT DISTINCT t.derived_from_external_event_id AS id
         FROM public.tasks t
         JOIN public.external_events e ON e.id = t.derived_from_external_event_id
        WHERE e.external_calendar_id = $1
          AND t.derive_sync_mode = 'live'`,
      [calendarId],
    );
    return r.rows.map((row) => row.id);
  }

  async liveSyncDerived(eventIds: string[]): Promise<number> {
    if (eventIds.length === 0) return 0;
    const r = await this.pg.query<{ live_sync_derived_tasks: number }>(
      'SELECT public.live_sync_derived_tasks($1) AS live_sync_derived_tasks',
      [eventIds],
    );
    return r.rows[0]?.live_sync_derived_tasks ?? 0;
  }
}

export function summarizeResult(result: SyncResult): string {
  if (result.not_modified) return 'not-modified';
  if (!result.ok) return `error: ${result.error ?? 'unknown'}`;
  return `+${result.inserted} ~${result.updated} -${result.orphaned}`;
}
