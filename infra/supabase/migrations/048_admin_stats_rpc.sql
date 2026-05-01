-- ═══════════════════════════════════════════════════════════════
-- Phase B Welle B.0.F — Admin-Stats-RPC
--
-- Aggregierte Plattform-Counts fuer das Admin-Dashboard. SECURITY
-- DEFINER weil auth.users nicht direkt fuer authenticated lesbar ist.
-- is_platform_admin()-Check vorne dran.
--
-- Returns jsonb-Object damit das Schema flexibel waechst (V1 minimal:
-- user/workspace/task-Counts; spaeter z.B. session-Counts in B.5).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_users          int;
  v_users_recent   int;
  v_workspaces     int;
  v_tasks          int;
  v_manifs         int;
  v_atom_manifs    int;
  v_audit_24h      int;
  v_now            timestamptz := now();
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*) INTO v_users FROM auth.users;
  SELECT count(*) INTO v_users_recent
    FROM auth.users
   WHERE last_sign_in_at >= v_now - interval '30 days';
  SELECT count(*) INTO v_workspaces FROM public.workspaces;
  SELECT count(*) INTO v_tasks FROM public.tasks;
  SELECT count(*) INTO v_manifs FROM public.task_manifestations;
  SELECT count(*) INTO v_atom_manifs FROM public.atom_manifestations;
  SELECT count(*) INTO v_audit_24h
    FROM public.system_audit_log
   WHERE created_at >= v_now - interval '24 hours';

  RETURN jsonb_build_object(
    'users_total', v_users,
    'users_active_30d', v_users_recent,
    'workspaces_total', v_workspaces,
    'tasks_total', v_tasks,
    'task_manifestations_total', v_manifs,
    'atom_manifestations_total', v_atom_manifs,
    'audit_events_24h', v_audit_24h,
    'as_of', v_now
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;

COMMENT ON FUNCTION public.get_admin_stats IS
  'Phase B B.0.F — aggregierte Plattform-Counts fuer Admin-Dashboard. is_platform_admin()-gegated. Returns jsonb (Schema flexibel).';
