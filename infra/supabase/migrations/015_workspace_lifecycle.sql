-- ═══════════════════════════════════════════════════════════════
-- Phase 1 (P1.B.4 + P1.B.5) — Workspace-Lifecycle: Ownership-Transfer
-- + Workspace-Delete
--
-- Schliesst die Lifecycle-Luecke aus Phase-1.A: change_member_role
-- (014) verbietet das Demoten des letzten Owners. Damit fehlt aktuell
-- ein sauberer Pfad zum Eigentumswechsel und zum Loeschen eines
-- Workspaces.
--
-- transfer_workspace_ownership(p_workspace_id, p_new_owner_id):
--   - Caller MUSS aktueller owner sein.
--   - Target MUSS aktive Membership im Workspace haben (kein
--     deactivated, kein Fremduser).
--   - Atomarer Swap: Caller -> admin, Target -> owner.
--   - workspaces.owner_id wird aktualisiert (haelt Switcher und
--     WorkspaceGeneral synchron).
--   - Audit 'workspace.ownership_transferred'.
--   - cannot_transfer_to_self bei Caller=Target.
--
-- delete_workspace(p_workspace_id, p_confirm_name):
--   - Caller MUSS aktueller owner sein.
--   - p_confirm_name MUSS exakt mit workspaces.name matchen
--     (case-sensitive — User soll bewusst tippen, nicht klick-und-weg).
--   - DELETE FROM workspaces -> CASCADE auf alle abhaengigen Tabellen
--     ueber FK ON DELETE CASCADE. Cascade-Sweep vor dieser Migration:
--       direkt: memberships, nodes, docs, workspace_invites,
--               workspace_audit_log, audit_log.
--       indirekt via nodes(id, workspace_id): rows, cols, cells,
--               kb_cols, kb_cards, checklists, links.
--       indirekt via checklists: checklist_items.
--     Alle Pfade sind ON DELETE CASCADE — kein FK-Lockstep noetig.
--   - Kein Audit-Insert: der gesamte workspace_audit_log wird
--     mitgeloescht. Forensik-Wunsch waere ein cross-workspace
--     system_audit_log (eigener Sprint).
--   - Kein Last-Workspace-Schutz: User darf seinen einzigen Workspace
--     loeschen. Empty-State im Frontend faengt das ab.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- ═══════════════════════════════════════════════════════════════

-- ─── transfer_workspace_ownership ─────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_workspace_ownership(
  p_workspace_id  uuid,
  p_new_owner_id  uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_target_role public.workspace_role;
  v_target_dea  timestamptz;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_actor = p_new_owner_id THEN
    RAISE EXCEPTION 'cannot_transfer_to_self' USING ERRCODE = 'check_violation';
  END IF;

  -- Caller-Check: muss aktiver owner sein. workspace_role_of liefert
  -- bei deactivated_at NOT NULL bereits NULL, die Pruefung greift
  -- also auch fuer deaktivierte Owner.
  IF public.workspace_role_of(p_workspace_id) <> 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Target laden inkl. Status. Wir wollen einen klaren Fehler statt
  -- silent no-op, wenn Target deaktiviert oder nicht-Mitglied ist.
  SELECT role, deactivated_at
    INTO v_target_role, v_target_dea
    FROM public.memberships
   WHERE workspace_id = p_workspace_id AND user_id = p_new_owner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_target_dea IS NOT NULL THEN
    RAISE EXCEPTION 'member_deactivated' USING ERRCODE = 'check_violation';
  END IF;

  -- Atomarer Swap. Reihenfolge: Caller demoten zu admin, dann Target
  -- promoten zu owner, dann workspaces.owner_id aktualisieren.
  -- Postgres locked die memberships-Rows automatisch — keine Race-
  -- Lecks auch bei concurrent transfers von zwei verschiedenen Ownern.
  UPDATE public.memberships SET role = 'admin'
   WHERE workspace_id = p_workspace_id AND user_id = v_actor;

  UPDATE public.memberships SET role = 'owner'
   WHERE workspace_id = p_workspace_id AND user_id = p_new_owner_id;

  UPDATE public.workspaces SET owner_id = p_new_owner_id
   WHERE id = p_workspace_id;

  INSERT INTO public.workspace_audit_log (
    workspace_id, actor_id, action, target_user_id, payload
  ) VALUES (
    p_workspace_id, v_actor, 'workspace.ownership_transferred', p_new_owner_id,
    jsonb_build_object(
      'old_owner_id', v_actor,
      'new_owner_id', p_new_owner_id,
      'old_target_role', v_target_role
    )
  );

  RETURN jsonb_build_object(
    'workspace_id', p_workspace_id,
    'old_owner_id', v_actor,
    'new_owner_id', p_new_owner_id
  );
END
$$;

GRANT EXECUTE ON FUNCTION public.transfer_workspace_ownership(uuid, uuid)
  TO authenticated, service_role;

-- ─── delete_workspace ─────────────────────────────────────────
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

  -- Cascade laeuft automatisch ueber alle FK ON DELETE CASCADE
  -- (siehe Migration-Header fuer die vollstaendige Liste der
  -- abhaengigen Tabellen). Postgres macht das atomar.
  DELETE FROM public.workspaces WHERE id = p_workspace_id;

  RETURN jsonb_build_object(
    'workspace_id', p_workspace_id,
    'deleted', true
  );
END
$$;

GRANT EXECUTE ON FUNCTION public.delete_workspace(uuid, text)
  TO authenticated, service_role;
