-- ═══════════════════════════════════════════════════════════════
-- Welle N.2 — Notification-RPCs fuer Frontend-Mark-Read-Pfade.
--
-- ❗ APPLY-HINWEIS: braucht supabase_admin.
-- ═══════════════════════════════════════════════════════════════

-- mark_notification_read: einzelne Notification als gelesen markieren.
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id uuid)
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
  UPDATE public.notifications
     SET read_at = COALESCE(read_at, now())
   WHERE id = p_id AND user_id = v_actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'notification_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN jsonb_build_object('id', p_id, 'read', true);
END $$;

GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid) TO authenticated;

-- mark_all_workspace_notifications_read: alle unread des Users in
-- einem bestimmten Workspace (oder ueberall, wenn p_workspace_id=NULL).
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(
  p_workspace_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  WITH upd AS (
    UPDATE public.notifications
       SET read_at = now()
     WHERE user_id = v_actor
       AND read_at IS NULL
       AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id)
     RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN jsonb_build_object('marked_read', v_count);
END $$;

GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid) TO authenticated;

-- get_unread_notification_count: Quick-Badge-Wert. Kein RPC-Round-Trip
-- pro Page wenn der Client subscribed (Realtime updated den Cache),
-- aber initiales Load braucht es. Optional p_workspace_id filtert.
CREATE OR REPLACE FUNCTION public.get_unread_notification_count(
  p_workspace_id uuid DEFAULT NULL
)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
  SELECT count(*)::int
    FROM public.notifications
   WHERE user_id = auth.uid()
     AND read_at IS NULL
     AND (p_workspace_id IS NULL OR workspace_id = p_workspace_id);
$$;

GRANT EXECUTE ON FUNCTION public.get_unread_notification_count(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- Smoke (manuell, als authenticated):
--
-- 1. Task erstellen → workspace_events → fan-out an notifications:
--    INSERT INTO tasks (workspace_id, label) VALUES ('<WS>', 'Test');
--    SELECT count(*) FROM notifications WHERE user_id=auth.uid();
--
-- 2. SELECT get_unread_notification_count();  -- erwartet > 0
-- 3. SELECT mark_all_notifications_read();    -- markiert alle
-- 4. SELECT get_unread_notification_count();  -- 0
-- ═══════════════════════════════════════════════════════════════
