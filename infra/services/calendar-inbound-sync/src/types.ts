// Shared Types fuer Calendar-Inbound-Sync.

export type CalendarKind = 'ics_subscribe' | 'google' | 'microsoft' | 'upload';

export type ParsedEvent = {
  external_id: string;
  recurrence_id?: string | null;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  start_at: string;            // ISO timestamp
  end_at?: string | null;
  all_day: boolean;
  rrule?: string | null;
  source_modified_at?: string | null;
};

export type CalendarCredentials = {
  id: string;
  kind: CalendarKind;
  source_url: string | null;
  workspace_id: string;
  user_id: string;
  sync_token: string | null;
  last_etag: string | null;
  last_modified_header: string | null;
  oauth_token: string | null;
  oauth_refresh_token: string | null;
  oauth_expires_at: string | null;
};

export type SyncResult = {
  ok: boolean;
  inserted: number;
  updated: number;
  orphaned: number;
  not_modified: boolean;
  error?: string;
  meta?: Partial<{
    last_etag: string;
    last_modified_header: string;
    sync_token: string;
  }>;
};
