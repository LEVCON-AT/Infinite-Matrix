-- ═══════════════════════════════════════════════════════════════
-- AU-B1 K11a — System-Audit-Log + delete_workspace-Forensik
--
--   B1-A-003 (HIGH): `delete_workspace` (Migration 015) loescht den
--   workspace via DELETE → Cascade nimmt workspace_audit_log mit.
--   Folge: keine forensische Spur des Loesch-Vorgangs.
--   Loesung: workspace-unabhaengige `system_audit_log`-Tabelle die
--   `workspace.deleted`-Events ueberlebt.
--
-- Schema-Design:
--   - `system_audit_log` ohne workspace_id-FK (sonst CASCADE-Risiko).
--   - actor_id ist FK auf auth.users(id) ON DELETE SET NULL — bei
--     User-Loeschung bleibt der Audit-Eintrag erhalten, nur der Pointer
--     wird neutralisiert.
--   - workspace_id ist plain uuid (KEIN FK) — der workspace existiert
--     nach `workspace.deleted` ja nicht mehr.
--   - workspace_name als Snapshot, damit Forensik nicht erst andere
--     Tabellen joinen muss.
--
-- RLS: nur Platform-Admins lesen. In dieser Phase gibt es noch kein
--      platform_admins-Konzept (Stream A B1-A-007 hat es vorgeschlagen
--      aber nicht umgesetzt) → vorerst service_role-only mit deny-all-
--      authenticated. Read-Path fuer Owner kommt mit Phase B (Auth).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.system_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action          text NOT NULL,
  actor_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  workspace_id    uuid,                            -- KEIN FK (siehe oben)
  workspace_name  text,                            -- Snapshot
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS system_audit_log_action_idx
  ON public.system_audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS system_audit_log_actor_idx
  ON public.system_audit_log(actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS system_audit_log_workspace_idx
  ON public.system_audit_log(workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;

-- Append-only: kein UPDATE/DELETE.
ALTER TABLE public.system_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_audit_log_no_user_select ON public.system_audit_log;
CREATE POLICY system_audit_log_no_user_select ON public.system_audit_log
  FOR SELECT USING (false);

DROP POLICY IF EXISTS system_audit_log_no_user_writes ON public.system_audit_log;
CREATE POLICY system_audit_log_no_user_writes ON public.system_audit_log
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS system_audit_log_no_user_updates ON public.system_audit_log;
CREATE POLICY system_audit_log_no_user_updates ON public.system_audit_log
  FOR UPDATE USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS system_audit_log_no_user_deletes ON public.system_audit_log;
CREATE POLICY system_audit_log_no_user_deletes ON public.system_audit_log
  FOR DELETE USING (false);

COMMENT ON TABLE public.system_audit_log IS
  'Workspace-unabhaengiger Audit-Log fuer destruktive System-Events (workspace.deleted etc.). Schreiben nur via SECURITY-DEFINER-RPC. Lesen Phase B mit platform_admins-Konzept.';

-- ─── delete_workspace mit Audit-Stempel patchen ──────────────────
-- Reihenfolge:
--   1. workspace.name + actor merken
--   2. system_audit_log INSERT BEFORE DELETE (sonst Cascade leert den
--      audit erst danach — system_audit_log hat aber kein FK auf
--      workspaces, ist also unabhaengig).
--   3. workspaces DELETE (Cascade laeuft).
CREATE OR REPLACE FUNCTION public.delete_workspace(
  p_workspace_id  uuid,
  p_confirm_name  text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_name   text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.workspace_role_of(p_workspace_id) <> 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT name INTO v_name
    FROM public.workspaces
   WHERE id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  IF p_confirm_name IS NULL OR p_confirm_name <> v_name THEN
    RAISE EXCEPTION 'name_mismatch' USING ERRCODE = 'check_violation';
  END IF;

  -- AU-B1 K11a (B1-A-003): Audit-Stempel BEFORE DELETE — system_audit_log
  -- hat keinen FK auf workspaces, ueberlebt also den Cascade.
  INSERT INTO public.system_audit_log (action, actor_id, workspace_id, workspace_name, payload)
  VALUES (
    'workspace.deleted',
    v_actor,
    p_workspace_id,
    v_name,
    jsonb_build_object('confirmed_name', p_confirm_name)
  );

  -- Cascade laeuft automatisch ueber alle FK ON DELETE CASCADE.
  DELETE FROM public.workspaces WHERE id = p_workspace_id;

  RETURN jsonb_build_object(
    'workspace_id', p_workspace_id,
    'deleted', true
  );
END
$$;
