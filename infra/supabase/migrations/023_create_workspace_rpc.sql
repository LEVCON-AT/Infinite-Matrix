-- ═══════════════════════════════════════════════════════════════
-- Phase 2 Welle A.4a — create_workspace-RPC + audit-Eintrag
--
-- Heute (Pre-A.4a) entstehen Workspaces ausschliesslich via
-- handle_new_user-Trigger (Migration 001) — genau einmal beim ersten
-- Login. Es gibt keinen Frontend-Pfad einen weiteren Workspace
-- anzulegen. Fuer den Onboarding-Wizard (A.4) wollen wir den Wizard
-- aber re-startbar machen ("Neuer Workspace + erneut durchklicken,
-- alten loeschen wenn die Struktur nicht passt"). Dazu braucht es
-- einen sauberen Create-Pfad.
--
-- Pattern wie create_invite (Migration 011):
--   - SECURITY DEFINER + search_path explizit (ASVS V5.3.4)
--   - auth.uid() NULL-Check
--   - _mcp_validate_label aus Migration 021 fuer die Name-Validierung
--   - INSERT workspaces + INSERT memberships(role=owner) atomar
--   - Audit-Log Eintrag (action='workspace.created')
--   - returns die neue workspace_id
--
-- Nicht hier (forbidden — siehe LLM-Tool-Allowlist):
--   - Workspace-Loeschung (existing DeleteWorkspace-Modal mit Step-Up)
--   - Owner-Transfer (D.4-Sprint, Step-Up-Pflicht)
--   - Member-Add/Remove (existing Invite/Member-RPCs)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_workspace(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id    uuid;
  v_name  text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Name-Validierung: trim, 1-200 Zeichen. Pattern aus Migration 021.
  v_name := public._mcp_validate_label(p_name);

  INSERT INTO public.workspaces (name, owner_id)
  VALUES (v_name, v_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.memberships (workspace_id, user_id, role)
  VALUES (v_id, v_actor, 'owner');

  INSERT INTO public.workspace_audit_log (
    workspace_id, actor_id, action, target_user_id, payload
  )
  VALUES (
    v_id, v_actor, 'workspace.created', NULL,
    jsonb_build_object('name', v_name)
  );

  RETURN v_id;
END
$$;

GRANT EXECUTE ON FUNCTION public.create_workspace(text) TO authenticated;

COMMENT ON FUNCTION public.create_workspace(text) IS
  'Phase 2 A.4a — erstellt einen neuen Workspace fuer den eingeloggten User (owner). Aufruf vom Onboarding-Wizard (Re-Run-Pfad) sowie vom WorkspaceSwitcher-Button "+ Neuer Workspace". Keine Member-Adds — nur Owner. Audit-Log Eintrag wird automatisch geschrieben.';
