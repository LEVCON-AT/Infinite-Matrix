-- ═══════════════════════════════════════════════════════════════
-- Welle N.1 — In-App-Notifications
--
-- ❗ APPLY-HINWEIS: braucht supabase_admin-Rechte (memberships wird
--    referenziert; Trigger auf workspace_events). User muss interaktiv
--    applien:
--      docker exec -i matrix-supabase-db psql -U supabase_admin -d postgres < 061_notifications.sql
--
-- workspace_events ist admin/owner-only (Migration 050) — fuer In-App-
-- Notifications brauchen wir per-User-Rows mit Read-State. Pattern:
-- Eine notifications-Tabelle, gefuellt via Trigger AFTER INSERT auf
-- workspace_events. Fan-out an alle Workspace-Member (ausser den
-- Actor selbst — der hat das Event ja gerade ausgeloest).
--
-- Felder werden im Trigger aus event.payload + event_type gebaut —
-- Frontend muss kein Mapping selbst betreiben (single-source-of-truth).
-- title + body + link_to sind deutsch (Endkunden-Sprache, Memory
-- feedback_user_facing_toasts).
--
-- Schema-Quad:
--   - Schema: hier
--   - Mutations: lib/notifications.ts (Welle N.3)
--   - MCP: -- nicht relevant
--   - Export/Import: nicht relevant (User-private, kein Workspace-Asset)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES public.workspace_events(id) ON DELETE CASCADE,
  kind            public.workspace_event_kind NOT NULL,
  title           text NOT NULL,
  body            text,
  link_to         text,
  actor_user_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_user_workspace_idx
  ON public.notifications (user_id, workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_event_idx
  ON public.notifications (event_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_self_select ON public.notifications;
CREATE POLICY notifications_self_select ON public.notifications
  FOR SELECT USING (user_id = auth.uid());

-- UPDATE nur fuer read_at — Frontend-Idempotenz. INSERT/DELETE blocken,
-- laeuft via Trigger bzw. Cascade.
DROP POLICY IF EXISTS notifications_self_mark_read ON public.notifications;
CREATE POLICY notifications_self_mark_read ON public.notifications
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_block_direct_inserts ON public.notifications;
CREATE POLICY notifications_block_direct_inserts ON public.notifications
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS notifications_block_direct_deletes ON public.notifications;
CREATE POLICY notifications_block_direct_deletes ON public.notifications
  FOR DELETE USING (false);

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL              ON public.notifications TO service_role;

-- ─── Event-zu-Text-Mapping (server-side) ────────────────────────
-- Eine Funktion fuer alle workspace_event_kind-Werte. Default ist
-- ein Generic-Fallback ("Aktivitaet im Workspace") — schadet nicht,
-- aber Hauptarbeit ist in den expliziten WHEN-Branches.
CREATE OR REPLACE FUNCTION public._notification_text_from_event(
  p_kind     public.workspace_event_kind,
  p_payload  jsonb,
  p_actor    text  -- Display-Name oder Email-Prefix
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_title text;
  v_body  text;
  v_link  text;
  v_label text;
BEGIN
  v_label := COALESCE(p_payload->>'label', p_payload->>'name', p_payload->>'title', '(ohne Titel)');
  v_link  := NULL;

  CASE p_kind
    WHEN 'workspace.created' THEN
      v_title := p_actor || ' hat den Workspace „' || v_label || '" angelegt.';
    WHEN 'workspace.updated' THEN
      v_title := p_actor || ' hat den Workspace „' || v_label || '" aktualisiert.';
    WHEN 'workspace.deleted' THEN
      v_title := p_actor || ' hat den Workspace „' || v_label || '" geloescht.';
    WHEN 'member.invited' THEN
      v_title := p_actor || ' hat eine Einladung verschickt.';
      v_body  := COALESCE(p_payload->>'invited_email', '');
    WHEN 'member.joined' THEN
      v_title := p_actor || ' ist dem Workspace beigetreten.';
    WHEN 'member.role_changed' THEN
      v_title := p_actor || ' hat eine Mitglieder-Rolle geaendert.';
      v_body  := COALESCE(p_payload->>'target_email','') ||
                 ' → ' || COALESCE(p_payload->>'new_role','?');
    WHEN 'member.removed' THEN
      v_title := p_actor || ' hat ein Mitglied entfernt.';
      v_body  := COALESCE(p_payload->>'target_email', '');
    WHEN 'task.created' THEN
      v_title := p_actor || ' hat Task „' || v_label || '" erstellt.';
      IF p_payload ? 'task_id' THEN
        v_link := '/task/' || (p_payload->>'task_id');
      END IF;
    WHEN 'task.completed' THEN
      v_title := p_actor || ' hat Task „' || v_label || '" erledigt.';
      IF p_payload ? 'task_id' THEN
        v_link := '/task/' || (p_payload->>'task_id');
      END IF;
    WHEN 'task.deleted' THEN
      v_title := p_actor || ' hat Task „' || v_label || '" geloescht.';
    WHEN 'cell.created' THEN
      v_title := p_actor || ' hat eine neue Zelle „' || v_label || '" angelegt.';
    WHEN 'cell.deleted' THEN
      v_title := p_actor || ' hat eine Zelle geloescht.';
    ELSE
      v_title := 'Aktivitaet im Workspace';
  END CASE;

  RETURN jsonb_build_object(
    'title', v_title,
    'body',  v_body,
    'link_to', v_link
  );
END $$;

-- ─── Fan-Out-Trigger: workspace_events → notifications ──────────
CREATE OR REPLACE FUNCTION public._workspace_events_fan_out_notifications()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor_label text;
  v_text        jsonb;
BEGIN
  -- Actor-Label ermitteln (E-Mail-Praefix als Fallback).
  IF NEW.actor_id IS NOT NULL THEN
    SELECT split_part(email, '@', 1) INTO v_actor_label
      FROM auth.users WHERE id = NEW.actor_id;
  END IF;
  v_actor_label := COALESCE(v_actor_label, 'Jemand');

  v_text := public._notification_text_from_event(NEW.event_type, NEW.payload, v_actor_label);

  -- Fan-out an alle aktiven Member ausser den Actor selbst.
  INSERT INTO public.notifications (
    user_id, workspace_id, event_id, kind,
    title, body, link_to, actor_user_id
  )
  SELECT
    m.user_id,
    NEW.workspace_id,
    NEW.id,
    NEW.event_type,
    v_text->>'title',
    NULLIF(v_text->>'body',''),
    NULLIF(v_text->>'link_to',''),
    NEW.actor_id
  FROM public.memberships m
  WHERE m.workspace_id = NEW.workspace_id
    AND m.deactivated_at IS NULL
    AND (NEW.actor_id IS NULL OR m.user_id <> NEW.actor_id);

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS workspace_events_fan_out_notifications ON public.workspace_events;
CREATE TRIGGER workspace_events_fan_out_notifications
  AFTER INSERT ON public.workspace_events
  FOR EACH ROW EXECUTE FUNCTION public._workspace_events_fan_out_notifications();

-- ─── Realtime ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

ALTER TABLE public.notifications REPLICA IDENTITY FULL;

COMMENT ON TABLE public.notifications IS
  'Welle N — In-App-Notifications. Fan-out via Trigger AFTER INSERT auf workspace_events. RLS self-only (user_id=auth.uid).';
COMMENT ON FUNCTION public._notification_text_from_event IS
  'Server-side Event → Notification-Text-Mapping. Single-Source-of-Truth fuer Notifications-Texte (deutsch, Endkunden-Sprache).';
