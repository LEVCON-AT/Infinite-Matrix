// Welle I.5 — Calendar-Inbound Client-Lib.
//
// Liest/Mutiert external_calendars + external_events ueber die RPCs
// aus Migration 060. Offline-First-Pattern: Reads gehen durch IDB-Cache
// (lib/offline-cache.ts), Mutationen via runOptimistic*-Wrapper aus
// lib/safe-mutation.ts wo es Sinn macht.
//
// RPCs (alle SECURITY DEFINER):
//   create_external_calendar
//   update_external_calendar
//   delete_external_calendar
//   trigger_external_calendar_sync
//   import_ics_events_batch
//   derive_task_from_event
//
// Direkt-Reads gegen die Tabellen (RLS schuetzt: external_calendars
// self-only, external_events workspace-scoped).

import {
  type CacheTable,
  getByWorkspace,
  mergeRows,
  putAll,
  putOne,
} from './offline-cache';
import { isNetworkError } from './mutation-queue';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { supabase } from './supabase';
import { showToast } from './toasts';
import { translateDbError } from './errors';
import type {
  DeriveScope,
  DeriveSyncMode,
  ExternalCalendar,
  ExternalCalendarKind,
  ExternalEvent,
} from './types';

const EXT_CAL_TABLE: CacheTable = 'external_calendars';
const EXT_EV_TABLE: CacheTable = 'external_events';

// ─── Reads ─────────────────────────────────────────────────────
export async function fetchExternalCalendars(
  workspaceId?: string,
): Promise<ExternalCalendar[]> {
  try {
    const q = supabase.from('external_calendars').select('*');
    const { data, error } = workspaceId ? await q.eq('workspace_id', workspaceId) : await q;
    if (error) throw error;
    const rows = (data ?? []) as ExternalCalendar[];
    if (workspaceId) {
      void putAll(EXT_CAL_TABLE, rows, workspaceId).catch(() => {});
    } else {
      void mergeRows(EXT_CAL_TABLE, rows).catch(() => {});
    }
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    if (workspaceId) {
      const cached = await getByWorkspace<ExternalCalendar>(EXT_CAL_TABLE, workspaceId);
      markCacheFallback();
      return cached;
    }
    markCacheFallback();
    return [];
  }
}

export async function fetchExternalEventsByCalendar(
  calendarId: string,
  workspaceId: string,
): Promise<ExternalEvent[]> {
  try {
    const { data, error } = await supabase
      .from('external_events')
      .select('*')
      .eq('external_calendar_id', calendarId)
      .eq('sync_state', 'active');
    if (error) throw error;
    const rows = (data ?? []) as ExternalEvent[];
    void mergeRows(EXT_EV_TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<ExternalEvent>(EXT_EV_TABLE, workspaceId);
    markCacheFallback();
    return cached.filter((e) => e.external_calendar_id === calendarId);
  }
}

export async function fetchExternalEventById(
  eventId: string,
): Promise<ExternalEvent | null> {
  try {
    const { data, error } = await supabase
      .from('external_events')
      .select('*')
      .eq('id', eventId)
      .maybeSingle();
    if (error) throw error;
    return (data as ExternalEvent | null) ?? null;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return null;
  }
}

// ─── Mutations: External-Calendars ────────────────────────────
export type CreateExternalCalendarInput = {
  workspaceId: string;
  kind: ExternalCalendarKind;
  label: string;
  sourceUrl?: string | null;
  color?: string;
  syncIntervalMinutes?: number;
  oauthToken?: string;
  oauthRefreshToken?: string;
  oauthExpiresAt?: string;
};

export async function createExternalCalendar(
  args: CreateExternalCalendarInput,
): Promise<ExternalCalendar> {
  const { data, error } = await supabase.rpc('create_external_calendar', {
    p_workspace_id: args.workspaceId,
    p_kind: args.kind,
    p_label: args.label,
    p_source_url: args.sourceUrl ?? null,
    p_color: args.color ?? '#3b82f6',
    p_sync_interval_minutes: args.syncIntervalMinutes ?? 15,
    p_oauth_token: args.oauthToken ?? null,
    p_oauth_refresh_token: args.oauthRefreshToken ?? null,
    p_oauth_expires_at: args.oauthExpiresAt ?? null,
  });
  if (error) throw error;
  // Voll-Refetch fuer den Cache — RPC liefert nicht alle Felder mit.
  await fetchExternalCalendars(args.workspaceId);
  return data as ExternalCalendar;
}

export type UpdateExternalCalendarInput = {
  id: string;
  label?: string;
  color?: string;
  enabled?: boolean;
  syncIntervalMinutes?: number;
};

export async function updateExternalCalendar(
  args: UpdateExternalCalendarInput,
): Promise<ExternalCalendar> {
  const { data, error } = await supabase.rpc('update_external_calendar', {
    p_id: args.id,
    p_label: args.label ?? null,
    p_color: args.color ?? null,
    p_enabled: args.enabled ?? null,
    p_sync_interval_minutes: args.syncIntervalMinutes ?? null,
  });
  if (error) throw error;
  // Cache-Refetch: external_calendars ist klein, ein einzelner Row-
  // Fetch reicht.
  void supabase
    .from('external_calendars')
    .select('*')
    .eq('id', args.id)
    .maybeSingle()
    .then(({ data: row }) => {
      if (row) void putOne(EXT_CAL_TABLE, row as ExternalCalendar);
    });
  return data as ExternalCalendar;
}

export async function deleteExternalCalendar(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_external_calendar', { p_id: id });
  if (error) throw error;
}

export async function triggerExternalCalendarSync(id: string): Promise<void> {
  const { error } = await supabase.rpc('trigger_external_calendar_sync', { p_id: id });
  if (error) throw error;
}

// ─── ICS-File-Upload: Client-Side-Parser + Batch-RPC ───────────
// Wir parsen die .ics-Datei lokal mit ical.js (oder einem Substitut)
// und schicken nur das normalisierte Event-Array an das Backend.
// Die ical-Bibliothek wird in I.6 gebundelt — V1-Stub akzeptiert
// bereits ein vorparsetes ParsedEvent[]-Array vom Caller.

export type ParsedEventInput = {
  external_id?: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  start_at: string;          // ISO timestamp
  end_at?: string | null;
  all_day?: boolean;
  rrule?: string | null;
  recurrence_id?: string | null;
};

export type ImportIcsResult = {
  calendar_id: string;
  imported_count: number;
};

export async function importIcsEvents(
  workspaceId: string,
  label: string,
  events: ParsedEventInput[],
  args?: { color?: string; calendarId?: string },
): Promise<ImportIcsResult> {
  const { data, error } = await supabase.rpc('import_ics_events_batch', {
    p_workspace_id: workspaceId,
    p_label: label,
    p_color: args?.color ?? '#10b981',
    p_events: events,
    p_calendar_id: args?.calendarId ?? null,
  });
  if (error) throw error;
  await fetchExternalCalendars(workspaceId);
  return data as ImportIcsResult;
}

// ─── Task-Ableitung ────────────────────────────────────────────
export type DeriveTaskInput = {
  eventId: string;
  mode: DeriveSyncMode;
  scope: DeriveScope;
  titleOverride?: string;
  deadlineOverride?: string;  // 'YYYY-MM-DD'
};

export type DeriveTaskResult = {
  task_id: string;
  workspace_id: string;
  mode: DeriveSyncMode;
  scope: DeriveScope;
};

export async function deriveTaskFromEvent(args: DeriveTaskInput): Promise<DeriveTaskResult> {
  const { data, error } = await supabase.rpc('derive_task_from_event', {
    p_event_id: args.eventId,
    p_mode: args.mode,
    p_scope: args.scope,
    p_title_override: args.titleOverride ?? null,
    p_deadline_override: args.deadlineOverride ?? null,
  });
  if (error) throw error;
  return data as DeriveTaskResult;
}

// ─── Convenience: User-facing Wrapper mit Toast-Fehlerbehandlung ──
export async function runWithToast<T>(
  fn: () => Promise<T>,
  errorMsg: string,
): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    showToast(translateDbError(err, errorMsg), 'error');
    return null;
  }
}
