-- ═══════════════════════════════════════════════════════════════
-- Welle I.1 — Calendar Inbound (externe Kalender → Matrix)
--
-- ❗ APPLY-HINWEIS: Diese Migration braucht supabase_admin-Rechte
--    (DROP CONSTRAINT auf atom_manifestations, ALTER TYPE atom_type,
--    ALTER TABLE auf tasks). Der `postgres`-User reicht NICHT.
--    User muss interaktiv mit supabase_admin-Passwort applien:
--      docker exec -it matrix-supabase-db psql -U supabase_admin -d postgres -f 059_calendar_inbound.sql
--
-- Externe Kalender (Gmail/Outlook/Apple/Nextcloud/CalDAV) sollen IN
-- das System fliessen. Atom-Zwiebel-Treue: importierte Events leben
-- einmal in eigener Source-Tabelle (external_events) und erscheinen
-- polymorph als atom_manifestations(atom_type='imported_event').
-- Damit funktioniert Drag-to-Create-Manifestation automatisch — der
-- User droppt einen externen Termin auf eine Kanban-Spalte und es
-- entsteht eine zweite Manifestation desselben Atoms.
--
-- Schema-Quad:
--   - Schema:    diese Migration (Tabellen + Enum-Extend + Trigger).
--   - Mutations: lib/calendar-inbound.ts (Welle I.5).
--   - MCP/Bridge: -- noch nicht; Inbound ist (vorerst) Frontend-only.
--   - Export/Import: external_events sind workspace-scoped, sollten
--                   in Workspace-Export mit. (Welle I.5/I.7 Detail.)
--
-- Apply-Strategie:
--   Stage 1 (eigene Transaktion): ALTER TYPE atom_type ADD VALUE.
--   Stage 2 (eigene Transaktion): CHECK-Recreate + neue Tabellen +
--                                 Trigger + RLS + Realtime.
--   Postgres 12+ erlaubt ADD VALUE im Transaktionsblock, aber der
--   neue Wert darf in derselben Transaktion nicht in CAST/CHECK
--   verwendet werden. Der explizite COMMIT zwischen Stages loest das.
-- ═══════════════════════════════════════════════════════════════

-- ─── STAGE 1: Enum-Extend ───────────────────────────────────────
BEGIN;

-- Den defensive CHECK-Constraint aus Migration 044 vorab loeschen,
-- damit wir ihn in Stage 2 mit der erweiterten Liste neu setzen.
-- Der ENUM selbst bleibt der primaere Constraint.
ALTER TABLE public.atom_manifestations
  DROP CONSTRAINT IF EXISTS atom_manifestations_atom_type_check;

ALTER TYPE public.atom_type ADD VALUE IF NOT EXISTS 'imported_event';

COMMIT;

-- ─── STAGE 2: Tabellen + Trigger + RLS + Realtime ───────────────
BEGIN;

-- CHECK-Constraint mit erweiterter Liste neu setzen.
ALTER TABLE public.atom_manifestations
  ADD CONSTRAINT atom_manifestations_atom_type_check
  CHECK (atom_type IN ('task','link','doc','checklist','imported_event'));

-- ─── external_calendars: Verbindung User × Workspace × Provider ──
CREATE TABLE IF NOT EXISTS public.external_calendars (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id                  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind                          text NOT NULL,
  label                         text NOT NULL,
  source_url                    text,
  oauth_token_encrypted         bytea,
  oauth_refresh_token_encrypted bytea,
  oauth_expires_at              timestamptz,
  webhook_channel_id            text,
  webhook_resource_id           text,
  webhook_expires_at            timestamptz,
  sync_token                    text,
  sync_status                   text NOT NULL DEFAULT 'idle',
  sync_interval_minutes         int  NOT NULL DEFAULT 15,
  last_sync_at                  timestamptz,
  last_etag                     text,
  last_modified_header          text,
  last_error_msg                text,
  color                         text NOT NULL DEFAULT '#3b82f6',
  enabled                       boolean NOT NULL DEFAULT true,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT external_calendars_kind_check
    CHECK (kind IN ('ics_subscribe','google','microsoft','upload')),
  CONSTRAINT external_calendars_sync_status_check
    CHECK (sync_status IN ('idle','syncing','error')),
  CONSTRAINT external_calendars_sync_interval_check
    CHECK (sync_interval_minutes BETWEEN 5 AND 1440),
  CONSTRAINT external_calendars_label_not_empty
    CHECK (length(trim(label)) > 0),
  -- ICS-Subscribe braucht source_url; Upload optional; OAuth-Provider
  -- haben source_url=NULL aber oauth_token_encrypted gesetzt.
  CONSTRAINT external_calendars_source_required
    CHECK (
      (kind = 'ics_subscribe' AND source_url IS NOT NULL)
      OR kind <> 'ics_subscribe'
    )
);

CREATE INDEX IF NOT EXISTS external_calendars_workspace_idx
  ON public.external_calendars(workspace_id);
CREATE INDEX IF NOT EXISTS external_calendars_user_idx
  ON public.external_calendars(user_id);
CREATE INDEX IF NOT EXISTS external_calendars_due_idx
  ON public.external_calendars(last_sync_at, sync_interval_minutes)
  WHERE enabled;
CREATE INDEX IF NOT EXISTS external_calendars_webhook_idx
  ON public.external_calendars(webhook_channel_id)
  WHERE webhook_channel_id IS NOT NULL;

DROP TRIGGER IF EXISTS external_calendars_set_updated_at ON public.external_calendars;
CREATE TRIGGER external_calendars_set_updated_at
  BEFORE UPDATE ON public.external_calendars
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── external_events: Source-Tabelle fuer atom_type='imported_event' ──
CREATE TABLE IF NOT EXISTS public.external_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_calendar_id  uuid NOT NULL REFERENCES public.external_calendars(id) ON DELETE CASCADE,
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  external_id           text NOT NULL,
  summary               text NOT NULL,
  description           text,
  location              text,
  url                   text,
  start_at              timestamptz NOT NULL,
  end_at                timestamptz,
  all_day               boolean NOT NULL DEFAULT false,
  rrule                 text,
  recurrence_id         text,
  source_provider       text NOT NULL,
  source_modified_at    timestamptz,
  sync_state            text NOT NULL DEFAULT 'active',
  last_synced_at        timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT external_events_source_provider_check
    CHECK (source_provider IN ('ics_subscribe','google','microsoft','upload')),
  CONSTRAINT external_events_sync_state_check
    CHECK (sync_state IN ('active','cancelled','orphaned')),
  CONSTRAINT external_events_summary_not_empty
    CHECK (length(trim(summary)) > 0),
  CONSTRAINT external_events_unique_per_calendar
    UNIQUE (external_calendar_id, external_id, recurrence_id)
);

CREATE INDEX IF NOT EXISTS external_events_workspace_start_idx
  ON public.external_events(workspace_id, start_at);
CREATE INDEX IF NOT EXISTS external_events_calendar_idx
  ON public.external_events(external_calendar_id);
CREATE INDEX IF NOT EXISTS external_events_active_idx
  ON public.external_events(sync_state)
  WHERE sync_state = 'active';

DROP TRIGGER IF EXISTS external_events_set_updated_at ON public.external_events;
CREATE TRIGGER external_events_set_updated_at
  BEFORE UPDATE ON public.external_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Cascade-Trigger: external_events DELETE → atom_manifestations ──
-- Pattern aus Migration 044:113. FK-Cascade ist polymorph nicht moeglich.
CREATE OR REPLACE FUNCTION public._atom_manif_purge_for_imported_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_manifestations
   WHERE atom_type = 'imported_event' AND atom_id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS atom_manif_purge_on_imported_event_delete ON public.external_events;
CREATE TRIGGER atom_manif_purge_on_imported_event_delete
  BEFORE DELETE ON public.external_events
  FOR EACH ROW EXECUTE FUNCTION public._atom_manif_purge_for_imported_event();

-- ─── Mirror-Trigger: external_events INSERT/UPDATE → atom_manifestations ──
-- Eine atom_manifestation pro external_event (kind='calendar', position aus
-- start_at als epoch — analog Migration 044). Bei UPDATE wird display_meta
-- + position synchron gehalten.
CREATE OR REPLACE FUNCTION public._imported_event_mirror_to_atom_manif()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_start_d  date;
  v_end_d    date;
  v_time     text;
  v_color    text;
  v_existing uuid;
BEGIN
  v_start_d := (NEW.start_at AT TIME ZONE 'UTC')::date;
  v_end_d   := COALESCE((NEW.end_at AT TIME ZONE 'UTC')::date, v_start_d);
  v_time    := CASE
                 WHEN NEW.all_day THEN NULL
                 ELSE to_char((NEW.start_at AT TIME ZONE 'UTC')::time, 'HH24:MI')
               END;
  SELECT color INTO v_color
    FROM public.external_calendars
   WHERE id = NEW.external_calendar_id;

  -- Existierende Mirror-Row finden (idempotent fuer UPSERT-Updates).
  SELECT id INTO v_existing
    FROM public.atom_manifestations
   WHERE atom_type = 'imported_event'
     AND atom_id = NEW.id
     AND kind = 'calendar'
   LIMIT 1;

  IF v_existing IS NULL THEN
    -- Cancelled/orphaned Events spiegeln wir nicht.
    IF NEW.sync_state <> 'active' THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.atom_manifestations (
      atom_type, atom_id, workspace_id, kind, container_id,
      position, display_meta
    ) VALUES (
      'imported_event', NEW.id, NEW.workspace_id, 'calendar', NULL,
      EXTRACT(epoch FROM NEW.start_at),
      jsonb_build_object(
        'start_date',          v_start_d::text,
        'end_date',            v_end_d::text,
        'time',                v_time,
        'all_day',             NEW.all_day,
        'label',               NEW.summary,
        'description',         NEW.description,
        'location',            NEW.location,
        'url',                 NEW.url,
        'rrule',               NEW.rrule,
        'recurrence_id',       NEW.recurrence_id,
        'source_provider',     NEW.source_provider,
        'source_color',        v_color,
        'source_calendar_id',  NEW.external_calendar_id::text
      )
    );
  ELSE
    -- UPDATE-Pfad: cancelled/orphaned → Mirror entfernen, sonst sync display_meta.
    IF NEW.sync_state <> 'active' THEN
      DELETE FROM public.atom_manifestations WHERE id = v_existing;
    ELSE
      UPDATE public.atom_manifestations
         SET workspace_id = NEW.workspace_id,
             position     = EXTRACT(epoch FROM NEW.start_at),
             display_meta = jsonb_build_object(
               'start_date',          v_start_d::text,
               'end_date',            v_end_d::text,
               'time',                v_time,
               'all_day',             NEW.all_day,
               'label',               NEW.summary,
               'description',         NEW.description,
               'location',            NEW.location,
               'url',                 NEW.url,
               'rrule',               NEW.rrule,
               'recurrence_id',       NEW.recurrence_id,
               'source_provider',     NEW.source_provider,
               'source_color',        v_color,
               'source_calendar_id',  NEW.external_calendar_id::text
             )
       WHERE id = v_existing;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS imported_event_mirror_to_atom_manif ON public.external_events;
CREATE TRIGGER imported_event_mirror_to_atom_manif
  AFTER INSERT OR UPDATE ON public.external_events
  FOR EACH ROW EXECUTE FUNCTION public._imported_event_mirror_to_atom_manif();

-- ─── tasks-Erweiterung: Ableitungs-FK + Sync-Mode ────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS derived_from_external_event_id uuid
    REFERENCES public.external_events(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS derive_sync_mode text DEFAULT 'snapshot';

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS derive_scope text DEFAULT 'instance';

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS local_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tasks_derive_sync_mode_check'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_derive_sync_mode_check
      CHECK (derive_sync_mode IS NULL OR derive_sync_mode IN ('snapshot','live'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tasks_derive_scope_check'
  ) THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_derive_scope_check
      CHECK (derive_scope IS NULL OR derive_scope IN ('instance','series'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tasks_derived_from_event_idx
  ON public.tasks(derived_from_external_event_id)
  WHERE derived_from_external_event_id IS NOT NULL;

-- local_overrides-Trigger: vermerkt vom User editierte Felder, damit der
-- Live-Sync-Worker diese nicht ueberschreibt. Der Sync-Worker setzt
-- session-setting `tasks.from_external_sync='on'` waehrend seiner
-- Updates — dann ueberspringt der Trigger den Vermerk.
CREATE OR REPLACE FUNCTION public._tasks_track_local_overrides()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_skip text;
  v_overrides jsonb;
BEGIN
  -- Nur fuer abgeleitete + live-sync-Tasks tracken.
  IF NEW.derived_from_external_event_id IS NULL OR NEW.derive_sync_mode <> 'live' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_skip := current_setting('tasks.from_external_sync', true);
  EXCEPTION WHEN OTHERS THEN
    v_skip := NULL;
  END;
  IF v_skip = 'on' THEN
    RETURN NEW;
  END IF;

  v_overrides := COALESCE(NEW.local_overrides, '{}'::jsonb);
  IF NEW.label IS DISTINCT FROM OLD.label THEN
    v_overrides := v_overrides || jsonb_build_object('label', true);
  END IF;
  IF NEW.note IS DISTINCT FROM OLD.note THEN
    v_overrides := v_overrides || jsonb_build_object('note', true);
  END IF;
  IF NEW.deadline IS DISTINCT FROM OLD.deadline THEN
    v_overrides := v_overrides || jsonb_build_object('deadline', true);
  END IF;
  IF NEW.recur IS DISTINCT FROM OLD.recur THEN
    v_overrides := v_overrides || jsonb_build_object('recur', true);
  END IF;
  NEW.local_overrides := v_overrides;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tasks_track_local_overrides ON public.tasks;
CREATE TRIGGER tasks_track_local_overrides
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._tasks_track_local_overrides();

-- ─── RLS: external_calendars ────────────────────────────────────
ALTER TABLE public.external_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_calendars FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS external_calendars_self_select ON public.external_calendars;
CREATE POLICY external_calendars_self_select ON public.external_calendars
  FOR SELECT USING (
    user_id = auth.uid() AND public.is_workspace_member(workspace_id)
  );

-- INSERT/UPDATE/DELETE laufen ausschliesslich ueber SECURITY DEFINER-RPCs
-- (Welle I.2). Direkte Schreibpfade blocken — defense in depth.
DROP POLICY IF EXISTS external_calendars_block_direct_inserts ON public.external_calendars;
CREATE POLICY external_calendars_block_direct_inserts ON public.external_calendars
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS external_calendars_block_direct_updates ON public.external_calendars;
CREATE POLICY external_calendars_block_direct_updates ON public.external_calendars
  FOR UPDATE USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS external_calendars_block_direct_deletes ON public.external_calendars;
CREATE POLICY external_calendars_block_direct_deletes ON public.external_calendars
  FOR DELETE USING (false);

GRANT SELECT ON public.external_calendars TO authenticated;
GRANT ALL    ON public.external_calendars TO service_role;

-- ─── RLS: external_events ───────────────────────────────────────
-- Lesen: alle Workspace-Member (analog tasks/links). Schreiben: nur
-- Service-Role (Sync-Worker) bzw. SECURITY DEFINER-RPCs (Upload).
ALTER TABLE public.external_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_events FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS external_events_member_select ON public.external_events;
CREATE POLICY external_events_member_select ON public.external_events
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS external_events_block_direct_inserts ON public.external_events;
CREATE POLICY external_events_block_direct_inserts ON public.external_events
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS external_events_block_direct_updates ON public.external_events;
CREATE POLICY external_events_block_direct_updates ON public.external_events
  FOR UPDATE USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS external_events_block_direct_deletes ON public.external_events;
CREATE POLICY external_events_block_direct_deletes ON public.external_events
  FOR DELETE USING (false);

GRANT SELECT ON public.external_events TO authenticated;
GRANT ALL    ON public.external_events TO service_role;

-- ─── Realtime: external_calendars + external_events publizieren ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'external_calendars'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.external_calendars;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'external_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.external_events;
  END IF;
END $$;

ALTER TABLE public.external_calendars REPLICA IDENTITY FULL;
ALTER TABLE public.external_events    REPLICA IDENTITY FULL;

-- ─── Comments ────────────────────────────────────────────────────
COMMENT ON TABLE public.external_calendars IS
  'Calendar Inbound (Welle I) — Verbindung User × Workspace × Provider. OAuth-Tokens at-rest verschluesselt mit pgp_sym_encrypt + GUC app.ai_master_key.';
COMMENT ON TABLE public.external_events IS
  'Source-Tabelle fuer atom_type=''imported_event''. Polymorpher atom_id-Pointer. Mirror-Trigger _imported_event_mirror_to_atom_manif synct atom_manifestations(kind=''calendar'').';
COMMENT ON COLUMN public.external_calendars.sync_interval_minutes IS
  'User-einstellbares Polling-Intervall (5min..24h, default 15min). Bei OAuth-Push-Providern Fallback-Frequenz falls Webhook-Channel abgelaufen.';
COMMENT ON COLUMN public.external_calendars.oauth_token_encrypted IS
  'pgp_sym_encrypt(access_token, app.ai_master_key). Niemals exposed via Safe-View.';
COMMENT ON COLUMN public.tasks.derived_from_external_event_id IS
  'Wenn gesetzt: Task wurde aus einem importierten externen Termin abgeleitet. derive_sync_mode steuert ob Live-Sync aktiv (Welle I.9).';
COMMENT ON COLUMN public.tasks.local_overrides IS
  'JSONB-Map {field: true} fuer User-editierte Felder. Live-Sync-Worker ueberschreibt diese Felder nicht.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- Smoke-Verifikation (manuell nach Apply):
--
-- 1. Enum hat 5 Werte:
--    SELECT unnest(enum_range(NULL::public.atom_type));
--
-- 2. Tabellen existieren mit RLS:
--    SELECT relname, relrowsecurity, relforcerowsecurity
--      FROM pg_class
--     WHERE relname IN ('external_calendars','external_events');
--
-- 3. Trigger:
--    SELECT tgname FROM pg_trigger
--     WHERE tgrelid IN ('public.external_events'::regclass, 'public.tasks'::regclass)
--       AND NOT tgisinternal;
--
-- 4. Realtime-Publication:
--    SELECT tablename FROM pg_publication_tables
--     WHERE pubname='supabase_realtime'
--       AND tablename IN ('external_calendars','external_events');
--
-- 5. Mirror-Trigger E2E (als service-role):
--    INSERT INTO external_calendars (user_id, workspace_id, kind, label, source_url)
--      VALUES ('<USER>', '<WS>', 'ics_subscribe', 'Test', 'https://example.com/cal.ics')
--      RETURNING id;  -- $CAL
--    INSERT INTO external_events (external_calendar_id, workspace_id, external_id,
--                                 summary, start_at, all_day, source_provider)
--      VALUES ('$CAL', '<WS>', 'test-1', 'Test-Event',
--              now() + interval '1 day', true, 'ics_subscribe')
--      RETURNING id;  -- $EV
--    SELECT atom_type, atom_id, kind, display_meta->>'label'
--      FROM atom_manifestations WHERE atom_id='$EV';
--    -- erwartet: 'imported_event' / $EV / 'calendar' / 'Test-Event'
--    DELETE FROM external_events WHERE id='$EV';
--    SELECT count(*) FROM atom_manifestations WHERE atom_id='$EV';  -- 0
-- ═══════════════════════════════════════════════════════════════
