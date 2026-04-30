-- ═══════════════════════════════════════════════════════════════
-- AU-B1 K9 (Welle HIGH) — zweiter SQL-Security-Patch.
--
--   B1-A-007 (HIGH): _mcp_assert_writer als SECURITY DEFINER deklarieren.
--                    Vorher SECURITY INVOKER mit auth.uid()-Check, was im
--                    Self-Hosted-Setup ohne PostgREST-JWT-GUC NULL liefern
--                    kann. SECURITY DEFINER + SET search_path haerted das
--                    Verhalten cross-Postgres-Setups.
--
--   B1-I-009 (HIGH-eskaliert von MEDIUM): memberships_select RLS-Policy
--                    zu breit — jedes Member kann alle Membership-Rows des
--                    Workspaces lesen (E-Mails, Rollen, Einladungsstatus).
--                    Privacy-Leak in groesseren Workspaces.
--                    Self-Filter + Owner/Admin-Pfad.
--
-- Idempotent — alle Statements `CREATE OR REPLACE` / `DROP IF EXISTS`.
-- ═══════════════════════════════════════════════════════════════

-- 1) B1-A-007: _mcp_assert_writer als SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public._mcp_assert_writer(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_role public.workspace_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_role := public.workspace_role_of(p_workspace_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_role NOT IN ('owner', 'admin', 'editor') THEN
    RAISE EXCEPTION 'viewer_cannot_mutate' USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

-- REVOKE FROM PUBLIC bleibt aus 037 in Kraft — interne Caller (SECURITY-
-- DEFINER-RPCs) laufen im Owner-Context und brauchen kein explizites GRANT.

-- 2) B1-I-009: memberships_select-Policy verschaerfen.
--    Vorher: jedes Member sieht alle Member-Rows des Workspace.
--    Nachher: User sieht (a) seine eigene Row, (b) alle Rows wenn er
--             owner/admin ist. Editor/Viewer sehen nur sich selbst.
--
--    Konsequenz fuer das Frontend: list_workspace_members-RPC ist
--    SECURITY DEFINER (Migration 013) und gibt fuer alle Member die
--    Workspace-Mitgliederliste zurueck — diese RPC-Pfad bleibt
--    intakt. Direkter SELECT auf memberships ist nur fuer Owner/Admin
--    + Self-Listing moeglich.
DROP POLICY IF EXISTS memberships_select ON public.memberships;
CREATE POLICY memberships_select ON public.memberships
  FOR SELECT USING (
    user_id = auth.uid()
    OR public.workspace_role_of(workspace_id) IN ('owner', 'admin')
  );

-- ─── Verifikation ────────────────────────────────────────────────
DO $$
DECLARE
  v_func_secdef boolean;
BEGIN
  SELECT prosecdef INTO v_func_secdef
    FROM pg_proc
    WHERE proname = '_mcp_assert_writer'
      AND pronamespace = 'public'::regnamespace
    LIMIT 1;
  IF NOT COALESCE(v_func_secdef, false) THEN
    RAISE WARNING 'B1-A-007: _mcp_assert_writer NICHT als SECURITY DEFINER deklariert';
  END IF;
END $$;
