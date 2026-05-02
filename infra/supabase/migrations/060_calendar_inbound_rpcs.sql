-- ═══════════════════════════════════════════════════════════════
-- Welle I.2 — Calendar Inbound RPCs + Service-Helper
--
-- ❗ APPLY-HINWEIS: Wie 059 — supabase_admin-Rechte noetig.
--    docker exec -it matrix-supabase-db psql -U supabase_admin -d postgres -f 060_calendar_inbound_rpcs.sql
--
-- RPCs fuer Frontend (User-RPCs, alle SECURITY DEFINER mit
-- is_workspace_member-Check):
--   - create_external_calendar
--   - update_external_calendar
--   - delete_external_calendar
--   - trigger_external_calendar_sync (pg_notify)
--   - import_ics_events_batch (Atomic-Insert nach Client-Side-Parser)
--   - derive_task_from_event
--
-- Service-Helper fuer Sync-Worker (Service-Role bypassed RLS, aber
-- die Helper verkapseln Encryption + Touch-Logik):
--   - get_external_calendar_credentials
--   - update_external_calendar_credentials
--   - update_external_calendar_sync_status
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- 1) create_external_calendar
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_external_calendar(
  p_workspace_id          uuid,
  p_kind                  text,
  p_label                 text,
  p_source_url            text DEFAULT NULL,
  p_color                 text DEFAULT '#3b82f6',
  p_sync_interval_minutes int  DEFAULT 15,
  p_oauth_token           text DEFAULT NULL,
  p_oauth_refresh_token   text DEFAULT NULL,
  p_oauth_expires_at      timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_id      uuid;
  v_token   bytea;
  v_refresh bytea;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_kind NOT IN ('ics_subscribe','google','microsoft','upload') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = 'check_violation';
  END IF;
  IF p_label IS NULL OR length(trim(p_label)) = 0 THEN
    RAISE EXCEPTION 'label_required' USING ERRCODE = 'check_violation';
  END IF;
  IF p_kind = 'ics_subscribe' AND (p_source_url IS NULL OR length(trim(p_source_url)) = 0) THEN
    RAISE EXCEPTION 'source_url_required' USING ERRCODE = 'check_violation';
  END IF;
  IF p_sync_interval_minutes < 5 OR p_sync_interval_minutes > 1440 THEN
    RAISE EXCEPTION 'sync_interval_out_of_range' USING ERRCODE = 'check_violation';
  END IF;

  IF p_oauth_token IS NOT NULL THEN
    v_token := pgp_sym_encrypt(p_oauth_token, public._ai_master_key());
  END IF;
  IF p_oauth_refresh_token IS NOT NULL THEN
    v_refresh := pgp_sym_encrypt(p_oauth_refresh_token, public._ai_master_key());
  END IF;

  INSERT INTO public.external_calendars (
    user_id, workspace_id, kind, label, source_url, color,
    sync_interval_minutes, oauth_token_encrypted,
    oauth_refresh_token_encrypted, oauth_expires_at
  ) VALUES (
    v_actor, p_workspace_id, p_kind, p_label, p_source_url, p_color,
    p_sync_interval_minutes, v_token, v_refresh, p_oauth_expires_at
  ) RETURNING id INTO v_id;

  RETURN (
    SELECT jsonb_build_object(
      'id', id,
      'kind', kind,
      'label', label,
      'workspace_id', workspace_id,
      'source_url', source_url,
      'color', color,
      'sync_interval_minutes', sync_interval_minutes,
      'sync_status', sync_status,
      'enabled', enabled,
      'last_sync_at', last_sync_at,
      'created_at', created_at
    )
    FROM public.external_calendars
    WHERE id = v_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.create_external_calendar(
  uuid, text, text, text, text, int, text, text, timestamptz
) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 2) update_external_calendar
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_external_calendar(
  p_id                    uuid,
  p_label                 text DEFAULT NULL,
  p_color                 text DEFAULT NULL,
  p_enabled               boolean DEFAULT NULL,
  p_sync_interval_minutes int  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.external_calendars
     WHERE id = p_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'calendar_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF p_sync_interval_minutes IS NOT NULL
     AND (p_sync_interval_minutes < 5 OR p_sync_interval_minutes > 1440) THEN
    RAISE EXCEPTION 'sync_interval_out_of_range' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.external_calendars
     SET label                 = COALESCE(p_label, label),
         color                 = COALESCE(p_color, color),
         enabled               = COALESCE(p_enabled, enabled),
         sync_interval_minutes = COALESCE(p_sync_interval_minutes, sync_interval_minutes)
   WHERE id = p_id AND user_id = v_actor;

  RETURN (
    SELECT jsonb_build_object(
      'id', id,
      'label', label,
      'color', color,
      'enabled', enabled,
      'sync_interval_minutes', sync_interval_minutes,
      'updated_at', updated_at
    )
    FROM public.external_calendars
    WHERE id = p_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.update_external_calendar(uuid, text, text, boolean, int) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 3) delete_external_calendar
-- ───────────────────────────────────────────────────────────────
-- Cascade: external_events (via FK) + atom_manifestations (via Trigger).
CREATE OR REPLACE FUNCTION public.delete_external_calendar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.external_calendars
     WHERE id = p_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'calendar_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  DELETE FROM public.external_calendars
   WHERE id = p_id AND user_id = v_actor;

  RETURN jsonb_build_object('id', p_id, 'deleted', true);
END $$;

GRANT EXECUTE ON FUNCTION public.delete_external_calendar(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 4) trigger_external_calendar_sync — pg_notify fuer Sync-Worker
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trigger_external_calendar_sync(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.external_calendars
     WHERE id = p_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'calendar_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM pg_notify('calendar_sync_due', p_id::text);
  RETURN jsonb_build_object('id', p_id, 'notified', true);
END $$;

GRANT EXECUTE ON FUNCTION public.trigger_external_calendar_sync(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 5) import_ics_events_batch — Client-parsed events nach DB
-- ───────────────────────────────────────────────────────────────
-- Der Client parst die ICS-Datei lokal (node-ical im Browser-Bundle)
-- und schickt ein jsonb-Array. Wir erstellen erst den Calendar
-- (kind='upload'), dann INSERT'en alle Events atomar. Re-Upload
-- (zweiter Aufruf mit selber Workspace+Label) ueberschreibt Events
-- des selben Calendars (DELETE + INSERT).
--
-- p_events Format (jsonb-array):
--   [
--     {
--       "external_id": "uid-from-ics",
--       "summary": "Event-Title",
--       "description": "...",
--       "location": "...",
--       "url": "...",
--       "start_at": "2025-12-01T10:00:00Z",
--       "end_at": "2025-12-01T11:00:00Z" | null,
--       "all_day": false,
--       "rrule": "FREQ=WEEKLY;..." | null,
--       "recurrence_id": "..." | null
--     },
--     ...
--   ]
CREATE OR REPLACE FUNCTION public.import_ics_events_batch(
  p_workspace_id  uuid,
  p_label         text,
  p_color         text,
  p_events        jsonb,
  p_calendar_id   uuid DEFAULT NULL  -- NULL = neuer Calendar; sonst Re-Import
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_calendar_id uuid;
  v_count      int := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION 'events_must_be_array' USING ERRCODE = 'check_violation';
  END IF;

  IF p_calendar_id IS NULL THEN
    INSERT INTO public.external_calendars (
      user_id, workspace_id, kind, label, color, sync_interval_minutes, enabled
    ) VALUES (
      v_actor, p_workspace_id, 'upload', p_label, COALESCE(p_color,'#3b82f6'), 1440, true
    ) RETURNING id INTO v_calendar_id;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.external_calendars
       WHERE id = p_calendar_id AND user_id = v_actor AND kind = 'upload'
    ) THEN
      RAISE EXCEPTION 'calendar_not_found' USING ERRCODE = 'no_data_found';
    END IF;
    v_calendar_id := p_calendar_id;
    DELETE FROM public.external_events WHERE external_calendar_id = v_calendar_id;
  END IF;

  INSERT INTO public.external_events (
    external_calendar_id, workspace_id, external_id,
    summary, description, location, url,
    start_at, end_at, all_day, rrule, recurrence_id,
    source_provider, sync_state
  )
  SELECT
    v_calendar_id,
    p_workspace_id,
    COALESCE(ev->>'external_id', gen_random_uuid()::text),
    COALESCE(NULLIF(trim(ev->>'summary'), ''), '(ohne Titel)'),
    NULLIF(ev->>'description', ''),
    NULLIF(ev->>'location', ''),
    NULLIF(ev->>'url', ''),
    (ev->>'start_at')::timestamptz,
    NULLIF(ev->>'end_at', '')::timestamptz,
    COALESCE((ev->>'all_day')::boolean, false),
    NULLIF(ev->>'rrule', ''),
    NULLIF(ev->>'recurrence_id', ''),
    'upload',
    'active'
  FROM jsonb_array_elements(p_events) AS ev
  WHERE ev ? 'start_at' AND ev ? 'summary';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.external_calendars
     SET last_sync_at = now(), sync_status = 'idle', last_error_msg = NULL
   WHERE id = v_calendar_id;

  RETURN jsonb_build_object(
    'calendar_id', v_calendar_id,
    'imported_count', v_count
  );
END $$;

GRANT EXECUTE ON FUNCTION public.import_ics_events_batch(uuid, text, text, jsonb, uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 6) derive_task_from_event — Task aus External-Event ableiten
-- ───────────────────────────────────────────────────────────────
-- Erstellt eine task aus einem external_event. Bei mode='live' und
-- scope='instance'/'series' bleibt die Verbindung; der Sync-Worker
-- propagiert spaetere event-Updates auf den Task.
CREATE OR REPLACE FUNCTION public.derive_task_from_event(
  p_event_id          uuid,
  p_mode              text DEFAULT 'snapshot',  -- 'snapshot' | 'live'
  p_scope             text DEFAULT 'instance',  -- 'instance' | 'series'
  p_title_override    text DEFAULT NULL,
  p_deadline_override date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_event    record;
  v_task_id  uuid;
  v_label    text;
  v_deadline date;
  v_recur    jsonb;
  v_note     text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_mode NOT IN ('snapshot','live') THEN
    RAISE EXCEPTION 'invalid_mode' USING ERRCODE = 'check_violation';
  END IF;
  IF p_scope NOT IN ('instance','series') THEN
    RAISE EXCEPTION 'invalid_scope' USING ERRCODE = 'check_violation';
  END IF;

  SELECT e.* INTO v_event
    FROM public.external_events e
   WHERE e.id = p_event_id
     AND public.is_workspace_member(e.workspace_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_write_workspace(v_event.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_label := COALESCE(NULLIF(trim(p_title_override),''), v_event.summary);
  v_deadline := COALESCE(p_deadline_override, (v_event.start_at AT TIME ZONE 'UTC')::date);

  -- Recur uebernehmen nur bei scope='series' und vorhandenem rrule.
  -- Format ist Provider-RRULE-String — wir packen ihn als
  -- {type:'ics', rrule:'...'} damit lib/recur.ts ihn als Hint erkennen
  -- kann (Welle I.9 erweitert recurFiresOn um den ics-Type).
  IF p_scope = 'series' AND v_event.rrule IS NOT NULL THEN
    v_recur := jsonb_build_object('type','ics','rrule', v_event.rrule);
  END IF;

  -- Mehrtagige Events: end_at-Hinweis in note.
  IF v_event.end_at IS NOT NULL AND (v_event.end_at AT TIME ZONE 'UTC')::date > v_deadline THEN
    v_note := COALESCE(v_event.description || E'\n\n','') ||
              'Termin laeuft bis: ' || ((v_event.end_at AT TIME ZONE 'UTC')::date)::text;
  ELSE
    v_note := v_event.description;
  END IF;

  INSERT INTO public.tasks (
    workspace_id, label, note, deadline, recur, created_by,
    derived_from_external_event_id, derive_sync_mode, derive_scope
  ) VALUES (
    v_event.workspace_id, v_label, v_note, v_deadline, v_recur, v_actor,
    p_event_id, p_mode, p_scope
  ) RETURNING id INTO v_task_id;

  RETURN jsonb_build_object(
    'task_id', v_task_id,
    'workspace_id', v_event.workspace_id,
    'mode', p_mode,
    'scope', p_scope
  );
END $$;

GRANT EXECUTE ON FUNCTION public.derive_task_from_event(uuid, text, text, text, date) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 7) Service-Helper: get_external_calendar_credentials
-- ───────────────────────────────────────────────────────────────
-- Sync-Worker (service-role) ruft diese Funktion um den entschluesselten
-- OAuth-Token + Refresh-Token zu bekommen. RLS-bypass via service-role
-- + SECURITY DEFINER. Frontend hat KEINEN Zugriff (kein GRANT EXECUTE
-- TO authenticated).
CREATE OR REPLACE FUNCTION public.get_external_calendar_credentials(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token         text;
  v_refresh       text;
  v_expires       timestamptz;
  v_kind          text;
  v_sync_token    text;
  v_source_url    text;
  v_workspace_id  uuid;
  v_user_id       uuid;
  v_last_etag     text;
  v_last_modified text;
  v_token_enc     bytea;
  v_refresh_enc   bytea;
BEGIN
  SELECT kind, source_url, workspace_id, user_id, sync_token,
         oauth_expires_at, last_etag, last_modified_header,
         oauth_token_encrypted, oauth_refresh_token_encrypted
    INTO v_kind, v_source_url, v_workspace_id, v_user_id, v_sync_token,
         v_expires, v_last_etag, v_last_modified,
         v_token_enc, v_refresh_enc
    FROM public.external_calendars
   WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_token_enc IS NOT NULL THEN
    v_token := pgp_sym_decrypt(v_token_enc, public._ai_master_key());
  END IF;
  IF v_refresh_enc IS NOT NULL THEN
    v_refresh := pgp_sym_decrypt(v_refresh_enc, public._ai_master_key());
  END IF;

  RETURN jsonb_build_object(
    'id', p_id,
    'kind', v_kind,
    'source_url', v_source_url,
    'workspace_id', v_workspace_id,
    'user_id', v_user_id,
    'sync_token', v_sync_token,
    'last_etag', v_last_etag,
    'last_modified_header', v_last_modified,
    'oauth_token', v_token,
    'oauth_refresh_token', v_refresh,
    'oauth_expires_at', v_expires
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_external_calendar_credentials(uuid) TO service_role;

-- ───────────────────────────────────────────────────────────────
-- 8) Service-Helper: update_external_calendar_credentials
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_external_calendar_credentials(
  p_id              uuid,
  p_oauth_token     text DEFAULT NULL,
  p_oauth_refresh   text DEFAULT NULL,
  p_oauth_expires   timestamptz DEFAULT NULL,
  p_sync_token      text DEFAULT NULL,
  p_last_etag       text DEFAULT NULL,
  p_last_modified   text DEFAULT NULL,
  p_webhook_channel text DEFAULT NULL,
  p_webhook_resource text DEFAULT NULL,
  p_webhook_expires  timestamptz DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token   bytea;
  v_refresh bytea;
BEGIN
  IF p_oauth_token IS NOT NULL THEN
    v_token := pgp_sym_encrypt(p_oauth_token, public._ai_master_key());
  END IF;
  IF p_oauth_refresh IS NOT NULL THEN
    v_refresh := pgp_sym_encrypt(p_oauth_refresh, public._ai_master_key());
  END IF;

  UPDATE public.external_calendars
     SET oauth_token_encrypted         = COALESCE(v_token, oauth_token_encrypted),
         oauth_refresh_token_encrypted = COALESCE(v_refresh, oauth_refresh_token_encrypted),
         oauth_expires_at              = COALESCE(p_oauth_expires, oauth_expires_at),
         sync_token                    = COALESCE(p_sync_token, sync_token),
         last_etag                     = COALESCE(p_last_etag, last_etag),
         last_modified_header          = COALESCE(p_last_modified, last_modified_header),
         webhook_channel_id            = COALESCE(p_webhook_channel, webhook_channel_id),
         webhook_resource_id           = COALESCE(p_webhook_resource, webhook_resource_id),
         webhook_expires_at            = COALESCE(p_webhook_expires, webhook_expires_at)
   WHERE id = p_id;
END $$;

GRANT EXECUTE ON FUNCTION public.update_external_calendar_credentials(
  uuid, text, text, timestamptz, text, text, text, text, text, timestamptz
) TO service_role;

-- ───────────────────────────────────────────────────────────────
-- 9) Service-Helper: update_external_calendar_sync_status
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_external_calendar_sync_status(
  p_id      uuid,
  p_status  text,
  p_error   text DEFAULT NULL,
  p_touch   boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF p_status NOT IN ('idle','syncing','error') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'check_violation';
  END IF;
  UPDATE public.external_calendars
     SET sync_status   = p_status,
         last_error_msg = p_error,
         last_sync_at  = CASE WHEN p_touch THEN now() ELSE last_sync_at END
   WHERE id = p_id;
END $$;

GRANT EXECUTE ON FUNCTION public.update_external_calendar_sync_status(uuid, text, text, boolean) TO service_role;

-- ───────────────────────────────────────────────────────────────
-- 10) Service-Helper: list_due_external_calendars
-- ───────────────────────────────────────────────────────────────
-- Sync-Worker ruft das alle 60s, bekommt alle ICS-Subscribes deren
-- last_sync_at < now() - sync_interval_minutes.
CREATE OR REPLACE FUNCTION public.list_due_external_calendars()
RETURNS TABLE(
  id                    uuid,
  kind                  text,
  sync_interval_minutes int,
  last_sync_at          timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
  SELECT id, kind, sync_interval_minutes, last_sync_at
    FROM public.external_calendars
   WHERE enabled
     AND kind IN ('ics_subscribe')
     AND (
       last_sync_at IS NULL
       OR last_sync_at < now() - (sync_interval_minutes || ' minutes')::interval
     )
   ORDER BY last_sync_at NULLS FIRST
   LIMIT 50;
$$;

GRANT EXECUTE ON FUNCTION public.list_due_external_calendars() TO service_role;

-- ───────────────────────────────────────────────────────────────
-- 11) Service-Helper: upsert_external_event_batch
-- ───────────────────────────────────────────────────────────────
-- Sync-Worker uebergibt geparste Events als jsonb-Array. UPSERT via
-- (external_calendar_id, external_id, recurrence_id) UNIQUE.
-- Events die nicht mehr im Provider-Feed sind (Diff-Detection) werden
-- vom Worker via separate Helper auf sync_state='cancelled' gesetzt.
CREATE OR REPLACE FUNCTION public.upsert_external_event_batch(
  p_calendar_id uuid,
  p_events      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_workspace_id uuid;
  v_count_in     int := 0;
  v_count_up     int := 0;
BEGIN
  SELECT workspace_id INTO v_workspace_id
    FROM public.external_calendars WHERE id = p_calendar_id;
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'calendar_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  WITH input AS (
    SELECT
      COALESCE(ev->>'external_id', md5(ev::text)) AS external_id,
      NULLIF(ev->>'recurrence_id','') AS recurrence_id,
      COALESCE(NULLIF(trim(ev->>'summary'), ''), '(ohne Titel)') AS summary,
      NULLIF(ev->>'description','') AS description,
      NULLIF(ev->>'location','') AS location,
      NULLIF(ev->>'url','') AS url,
      (ev->>'start_at')::timestamptz AS start_at,
      NULLIF(ev->>'end_at','')::timestamptz AS end_at,
      COALESCE((ev->>'all_day')::boolean, false) AS all_day,
      NULLIF(ev->>'rrule','') AS rrule,
      NULLIF(ev->>'source_modified_at','')::timestamptz AS source_modified_at
    FROM jsonb_array_elements(p_events) AS ev
    WHERE ev ? 'start_at' AND ev ? 'summary'
  ),
  ups AS (
    INSERT INTO public.external_events (
      external_calendar_id, workspace_id, external_id, recurrence_id,
      summary, description, location, url,
      start_at, end_at, all_day, rrule,
      source_provider, source_modified_at,
      sync_state, last_synced_at
    )
    SELECT
      p_calendar_id, v_workspace_id, i.external_id, i.recurrence_id,
      i.summary, i.description, i.location, i.url,
      i.start_at, i.end_at, i.all_day, i.rrule,
      (SELECT kind FROM public.external_calendars WHERE id = p_calendar_id),
      i.source_modified_at,
      'active', now()
    FROM input i
    ON CONFLICT (external_calendar_id, external_id, recurrence_id)
    DO UPDATE SET
      summary            = EXCLUDED.summary,
      description        = EXCLUDED.description,
      location           = EXCLUDED.location,
      url                = EXCLUDED.url,
      start_at           = EXCLUDED.start_at,
      end_at             = EXCLUDED.end_at,
      all_day            = EXCLUDED.all_day,
      rrule              = EXCLUDED.rrule,
      source_modified_at = EXCLUDED.source_modified_at,
      sync_state         = 'active',
      last_synced_at     = now()
    RETURNING xmax = 0 AS is_insert
  )
  SELECT
    count(*) FILTER (WHERE is_insert),
    count(*) FILTER (WHERE NOT is_insert)
  INTO v_count_in, v_count_up
  FROM ups;

  RETURN jsonb_build_object(
    'inserted', v_count_in,
    'updated',  v_count_up
  );
END $$;

GRANT EXECUTE ON FUNCTION public.upsert_external_event_batch(uuid, jsonb) TO service_role;

-- ───────────────────────────────────────────────────────────────
-- 12) Service-Helper: mark_external_events_orphaned
-- ───────────────────────────────────────────────────────────────
-- Nach einem Voll-Sync: alle Events des Calendars die NICHT in der
-- aktuellen external_id-Liste enthalten sind → sync_state='cancelled'.
-- Das triggert den Mirror-Trigger der die Manifestation entfernt.
CREATE OR REPLACE FUNCTION public.mark_external_events_orphaned(
  p_calendar_id  uuid,
  p_keep_ids     text[]
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.external_events
     SET sync_state = 'cancelled', last_synced_at = now()
   WHERE external_calendar_id = p_calendar_id
     AND external_id <> ALL (p_keep_ids)
     AND sync_state = 'active';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.mark_external_events_orphaned(uuid, text[]) TO service_role;

-- ───────────────────────────────────────────────────────────────
-- 13) Service-Helper: live_sync_derived_tasks
-- ───────────────────────────────────────────────────────────────
-- Nach upsert_external_event_batch: alle tasks mit
-- derived_from_external_event_id IN (...) UND derive_sync_mode='live'
-- werden mit den Event-Feldern gefuettert — ausser die Spalte ist in
-- tasks.local_overrides als true markiert. Worker setzt
-- session-setting 'tasks.from_external_sync=on' um den
-- _tasks_track_local_overrides-Trigger zu ueberspringen.
CREATE OR REPLACE FUNCTION public.live_sync_derived_tasks(
  p_event_ids uuid[]
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count int := 0;
  rec     record;
BEGIN
  PERFORM set_config('tasks.from_external_sync', 'on', true);

  FOR rec IN
    SELECT t.id AS task_id,
           t.derive_scope,
           t.local_overrides,
           e.summary, e.description, e.start_at, e.end_at, e.rrule
      FROM public.tasks t
      JOIN public.external_events e ON e.id = t.derived_from_external_event_id
     WHERE t.derived_from_external_event_id = ANY(p_event_ids)
       AND t.derive_sync_mode = 'live'
  LOOP
    UPDATE public.tasks SET
      label    = CASE WHEN COALESCE((rec.local_overrides->>'label')::boolean, false)
                      THEN label ELSE rec.summary END,
      note     = CASE WHEN COALESCE((rec.local_overrides->>'note')::boolean, false)
                      THEN note ELSE rec.description END,
      deadline = CASE WHEN COALESCE((rec.local_overrides->>'deadline')::boolean, false)
                      THEN deadline
                      ELSE (rec.start_at AT TIME ZONE 'UTC')::date END,
      recur    = CASE WHEN COALESCE((rec.local_overrides->>'recur')::boolean, false)
                      THEN recur
                      WHEN rec.derive_scope = 'series' AND rec.rrule IS NOT NULL
                        THEN jsonb_build_object('type','ics','rrule', rec.rrule)
                      ELSE recur END
    WHERE id = rec.task_id;
    v_count := v_count + 1;
  END LOOP;

  PERFORM set_config('tasks.from_external_sync', 'off', true);
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.live_sync_derived_tasks(uuid[]) TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- Smoke-Verifikation (manuell nach Apply als authenticated):
--
-- 1. SELECT create_external_calendar(
--      '<WORKSPACE_ID>', 'ics_subscribe', 'Test',
--      'https://example.com/cal.ics', '#3b82f6', 30
--    );
--    -- erwartet: jsonb mit id, sync_status='idle', enabled=true
--
-- 2. SELECT trigger_external_calendar_sync('<CAL_ID>');
--    -- erwartet: notified=true; pg_notify-Listener empfaengt 'calendar_sync_due'.
--
-- 3. SELECT import_ics_events_batch(
--      '<WS>', 'Upload-Test', '#10b981',
--      jsonb_build_array(
--        jsonb_build_object(
--          'external_id','ev-1','summary','Lokales Event',
--          'start_at', (now()+interval '1 day')::text,
--          'all_day', true
--        )
--      ),
--      NULL
--    );
--    -- erwartet: imported_count=1; SELECT * FROM atom_manifestations
--    --           WHERE atom_type='imported_event' zeigt Mirror-Row.
--
-- 4. SELECT derive_task_from_event('<EVENT_ID>', 'snapshot', 'instance');
--    -- erwartet: task_id; SELECT * FROM tasks WHERE id=$task_id zeigt
--    --           derived_from_external_event_id gesetzt, derive_sync_mode='snapshot'.
-- ═══════════════════════════════════════════════════════════════
