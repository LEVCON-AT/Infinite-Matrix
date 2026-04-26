-- ═══════════════════════════════════════════════════════════════
-- Phase 1 (P1.B.1) — change_member_role RPC + Last-Owner-Demote-Schutz
--
-- Erlaubt es owner/admin, die Rolle eines aktiven Mitglieds zu aendern.
-- Setzt strikte Gating-Regeln, die in der UI ohnehin schon vorgeblendet
-- werden, hier aber als Defense-in-Depth zwingend durchgesetzt sind:
--
--  - owner kann jede Rolle setzen (inkl. promote-to-owner und
--    demote-eines-anderen-owner).
--  - admin kann NUR editor <-> viewer wechseln. Owner-Memberships sind
--    fuer ihn unsichtbar bzgl. Aenderung; promote-to-owner ist ihm
--    explizit verboten.
--  - Self-Demote: erlaubt fuer alle, AUSSER der Self-Caller ist owner
--    und einziger aktiver Owner — dann `cannot_demote_last_owner`.
--    Last-Owner-Demote durch andere Owner ist ebenfalls verboten.
--  - target muss eine aktive Membership haben (deaktivierte erst
--    reaktivieren — `member_not_found` sonst).
--  - Wenn old=new: idempotenter no-op (kein Audit-Eintrag, kein UPDATE).
--
-- Audit `member.role_changed` mit `old_role` + `new_role` im Payload.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.change_member_role(
  p_workspace_id uuid,
  p_user_id      uuid,
  p_new_role     public.workspace_role
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_caller_role public.workspace_role;
  v_old_role    public.workspace_role;
  v_target_dea  timestamptz;
  v_active_owners int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Caller-Berechtigung. workspace_role_of liefert nur AKTIVE Memberships
  -- (siehe 013) — deaktivierte caller koennen nichts aendern.
  v_caller_role := public.workspace_role_of(p_workspace_id);
  IF v_caller_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Target laden inkl. Status. Deaktivierte werden absichtlich nicht
  -- gefiltert hier — wir wollen einen klaren Fehler, statt das Frontend
  -- "schwebend" zu lassen (zeigt eine Zeile, RPC tut aber nix).
  SELECT role, deactivated_at
    INTO v_old_role, v_target_dea
    FROM public.memberships
   WHERE workspace_id = p_workspace_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_target_dea IS NOT NULL THEN
    RAISE EXCEPTION 'member_deactivated' USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotent no-op bei gleicher Rolle. Frontend kann sich darauf
  -- verlassen, dass ein Re-Submit derselben Auswahl keinen Audit-
  -- Eintrag und keinen UPDATE produziert.
  IF v_old_role = p_new_role THEN
    RETURN jsonb_build_object(
      'workspace_id', p_workspace_id,
      'user_id', p_user_id,
      'old_role', v_old_role,
      'new_role', p_new_role,
      'changed', false
    );
  END IF;

  -- Admin-Restriktionen: nur editor <-> viewer.
  IF v_caller_role = 'admin' THEN
    IF v_old_role IN ('owner','admin') OR p_new_role IN ('owner','admin') THEN
      RAISE EXCEPTION 'admin_cannot_set_owner_or_admin'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Last-Owner-Demote-Schutz: wenn die alte Rolle owner ist und die
  -- neue Rolle nicht owner ist, muss mindestens ein weiterer aktiver
  -- Owner existieren. Greift sowohl bei Self-Demote als auch wenn ein
  -- anderer Owner einen Owner demoten will.
  IF v_old_role = 'owner' AND p_new_role <> 'owner' THEN
    SELECT count(*) INTO v_active_owners
      FROM public.memberships
     WHERE workspace_id = p_workspace_id
       AND role = 'owner'
       AND deactivated_at IS NULL
       AND user_id <> p_user_id;
    IF v_active_owners < 1 THEN
      RAISE EXCEPTION 'cannot_demote_last_owner' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.memberships
     SET role = p_new_role
   WHERE workspace_id = p_workspace_id AND user_id = p_user_id;

  INSERT INTO public.workspace_audit_log (
    workspace_id, actor_id, action, target_user_id, payload
  )
  VALUES (
    p_workspace_id, v_actor, 'member.role_changed', p_user_id,
    jsonb_build_object('old_role', v_old_role, 'new_role', p_new_role)
  );

  RETURN jsonb_build_object(
    'workspace_id', p_workspace_id,
    'user_id', p_user_id,
    'old_role', v_old_role,
    'new_role', p_new_role,
    'changed', true
  );
END
$$;

GRANT EXECUTE ON FUNCTION public.change_member_role(uuid, uuid, public.workspace_role)
  TO authenticated, service_role;
