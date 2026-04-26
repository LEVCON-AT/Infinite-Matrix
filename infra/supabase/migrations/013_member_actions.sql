-- ═══════════════════════════════════════════════════════════════
-- Phase 1 (P1.A.4) — Member-Mgmt: deactivate / reactivate / remove
--
-- Plan-Phase-1 sah Member-Aktionen erst in P1.B vor — wird wegen
-- akutem User-Bedarf vorgezogen (Live-Smoke deckte Bug auf, der zu
-- versehentlichen "Falsch-User-akzeptiert"-Token fuehrte; User braucht
-- jetzt eine Moeglichkeit, Mitglieder/Token aufzuraeumen).
--
-- Schema-Erweiterung: memberships.deactivated_at (nullable). NULL =
-- aktiver Member; gesetzt = deaktiviert (kein RLS-Read/Write mehr,
-- aber Eintrag bleibt fuer spaetere Reaktivierung + Audit-Trail).
--
-- Helper-Funktionen (is_workspace_member, workspace_role_of,
-- can_write_workspace) ziehen jetzt automatisch deactivated_at IS NULL
-- in die Pruefung — RLS auf allen abhaengigen Tabellen blockt
-- deaktivierte Mitglieder ohne weitere Policy-Anpassung.
--
-- Drei RPCs:
--   1. deactivate_member  — owner/admin, idempotent, last-owner-Schutz.
--   2. reactivate_member  — owner/admin, idempotent.
--   3. remove_member      — owner-only, last-owner-Schutz, hart-delete.
--
-- Idempotent: ALTER TABLE IF NOT EXISTS / CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════

-- ─── Schema: deactivated_at ───────────────────────────────────
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;

CREATE INDEX IF NOT EXISTS memberships_active_idx
  ON public.memberships(workspace_id, user_id)
  WHERE deactivated_at IS NULL;

COMMENT ON COLUMN public.memberships.deactivated_at IS
  'Phase 1 P1.A.4: NULL = aktiv. timestamp = deaktiviert (Membership existiert weiter, aber RLS-Helper geben false).';

-- ─── Helper: nur aktive Memberships zaehlen ─────────────────
CREATE OR REPLACE FUNCTION public.is_workspace_member(wid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE workspace_id = wid
      AND user_id = auth.uid()
      AND deactivated_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.workspace_role_of(wid uuid)
RETURNS public.workspace_role LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT role FROM public.memberships
  WHERE workspace_id = wid
    AND user_id = auth.uid()
    AND deactivated_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_write_workspace(wid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT public.workspace_role_of(wid) IN ('owner','admin','editor');
$$;

-- ─── deactivate_member ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.deactivate_member(
  p_workspace_id uuid,
  p_user_id      uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_caller_role public.workspace_role;
  v_target_role public.workspace_role;
  v_target_state text;
  v_active_owners int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_user_id = v_actor THEN
    RAISE EXCEPTION 'cannot_deactivate_self' USING ERRCODE = 'check_violation';
  END IF;

  v_caller_role := public.workspace_role_of(p_workspace_id);
  IF v_caller_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Target laden inkl. aktuellem Status.
  SELECT role,
         CASE WHEN deactivated_at IS NULL THEN 'active' ELSE 'deactivated' END
    INTO v_target_role, v_target_state
    FROM public.memberships
   WHERE workspace_id = p_workspace_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  -- Schon deaktiviert: idempotent no-op (kein Audit-Doublette).
  IF v_target_state = 'deactivated' THEN
    RETURN jsonb_build_object(
      'workspace_id', p_workspace_id,
      'user_id', p_user_id,
      'changed', false,
      'previous_state', 'deactivated'
    );
  END IF;

  -- Last-Owner-Schutz.
  IF v_target_role = 'owner' THEN
    SELECT count(*) INTO v_active_owners
      FROM public.memberships
     WHERE workspace_id = p_workspace_id
       AND role = 'owner'
       AND deactivated_at IS NULL;
    IF v_active_owners <= 1 THEN
      RAISE EXCEPTION 'cannot_deactivate_last_owner' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.memberships
     SET deactivated_at = now()
   WHERE workspace_id = p_workspace_id AND user_id = p_user_id;

  INSERT INTO public.workspace_audit_log (workspace_id, actor_id, action, target_user_id, payload)
  VALUES (
    p_workspace_id, v_actor, 'member.deactivated', p_user_id,
    jsonb_build_object('role', v_target_role)
  );

  RETURN jsonb_build_object(
    'workspace_id', p_workspace_id,
    'user_id', p_user_id,
    'changed', true,
    'previous_state', 'active'
  );
END
$$;

GRANT EXECUTE ON FUNCTION public.deactivate_member(uuid, uuid) TO authenticated, service_role;

-- ─── reactivate_member ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reactivate_member(
  p_workspace_id uuid,
  p_user_id      uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_caller_role public.workspace_role;
  v_target_role public.workspace_role;
  v_target_state text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_caller_role := public.workspace_role_of(p_workspace_id);
  IF v_caller_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT role,
         CASE WHEN deactivated_at IS NULL THEN 'active' ELSE 'deactivated' END
    INTO v_target_role, v_target_state
    FROM public.memberships
   WHERE workspace_id = p_workspace_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_target_state = 'active' THEN
    RETURN jsonb_build_object(
      'workspace_id', p_workspace_id,
      'user_id', p_user_id,
      'changed', false,
      'previous_state', 'active'
    );
  END IF;

  UPDATE public.memberships
     SET deactivated_at = NULL
   WHERE workspace_id = p_workspace_id AND user_id = p_user_id;

  INSERT INTO public.workspace_audit_log (workspace_id, actor_id, action, target_user_id, payload)
  VALUES (
    p_workspace_id, v_actor, 'member.reactivated', p_user_id,
    jsonb_build_object('role', v_target_role)
  );

  RETURN jsonb_build_object(
    'workspace_id', p_workspace_id,
    'user_id', p_user_id,
    'changed', true,
    'previous_state', 'deactivated'
  );
END
$$;

GRANT EXECUTE ON FUNCTION public.reactivate_member(uuid, uuid) TO authenticated, service_role;

-- ─── remove_member ────────────────────────────────────────────
-- Owner-only. Hart-Delete. Last-Owner-Schutz UND Self-Schutz.
CREATE OR REPLACE FUNCTION public.remove_member(
  p_workspace_id uuid,
  p_user_id      uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_caller_role public.workspace_role;
  v_removed_role public.workspace_role;
  v_active_owners int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_user_id = v_actor THEN
    RAISE EXCEPTION 'cannot_remove_self' USING ERRCODE = 'check_violation';
  END IF;

  v_caller_role := public.workspace_role_of(p_workspace_id);
  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT role INTO v_removed_role
    FROM public.memberships
   WHERE workspace_id = p_workspace_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  -- Last-Owner-Schutz: zaehle aktive Owner ohne den zu entfernenden,
  -- wenn der entfernende ein owner ist.
  IF v_removed_role = 'owner' THEN
    SELECT count(*) INTO v_active_owners
      FROM public.memberships
     WHERE workspace_id = p_workspace_id
       AND role = 'owner'
       AND deactivated_at IS NULL
       AND user_id <> p_user_id;
    IF v_active_owners < 1 THEN
      RAISE EXCEPTION 'cannot_remove_last_owner' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  DELETE FROM public.memberships
   WHERE workspace_id = p_workspace_id AND user_id = p_user_id;

  INSERT INTO public.workspace_audit_log (workspace_id, actor_id, action, target_user_id, payload)
  VALUES (
    p_workspace_id, v_actor, 'member.removed', p_user_id,
    jsonb_build_object('removed_role', v_removed_role)
  );

  RETURN jsonb_build_object(
    'workspace_id', p_workspace_id,
    'user_id', p_user_id,
    'removed_role', v_removed_role
  );
END
$$;

GRANT EXECUTE ON FUNCTION public.remove_member(uuid, uuid) TO authenticated, service_role;

-- ─── list_workspace_members — deactivated_at + Filter ergaenzen ─
-- Bisher liefert die RPC ALLE Memberships. Wir behalten das Verhalten
-- (deaktivierte sehen + Status anzeigen), ergaenzen aber das Feld
-- damit das Frontend zwischen aktiv/deaktiviert unterscheiden kann.
CREATE OR REPLACE FUNCTION public.list_workspace_members(p_workspace_id uuid)
RETURNS TABLE (
  user_id        uuid,
  email          text,
  display_name   text,
  role           public.workspace_role,
  joined_at      timestamptz,
  deactivated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_role public.workspace_role;
BEGIN
  v_role := public.workspace_role_of(p_workspace_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT
      m.user_id,
      u.email::text,
      NULLIF(u.raw_user_meta_data->>'display_name', '')::text,
      m.role,
      m.created_at,
      m.deactivated_at
    FROM public.memberships m
    JOIN auth.users u ON u.id = m.user_id
    WHERE m.workspace_id = p_workspace_id
    ORDER BY
      m.deactivated_at NULLS FIRST,
      CASE m.role
        WHEN 'owner'   THEN 0
        WHEN 'admin'   THEN 1
        WHEN 'editor'  THEN 2
        WHEN 'viewer'  THEN 3
      END,
      m.created_at;
END
$$;

GRANT EXECUTE ON FUNCTION public.list_workspace_members(uuid) TO authenticated, service_role;

-- ─── redeem_invite — Already-Member-Check auf aktive Memberships ─
-- Nachdem deactivated_at jetzt existiert, Check anpassen damit
-- deaktivierte Memberships nicht das Re-Joinen verhindern.
CREATE OR REPLACE FUNCTION public.redeem_invite(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_actor_email text;
  v_hash        bytea;
  v_lookup      bytea;
  v_invite_id   uuid;
  v_workspace   uuid;
  v_role        public.workspace_role;
  v_invited_em  text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_token IS NULL OR length(p_token) < 16 THEN
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_hash   := digest(p_token, 'sha256');
  v_lookup := substring(v_hash from 1 for 8);

  SELECT id, workspace_id, role, invited_email
    INTO v_invite_id, v_workspace, v_role, v_invited_em
    FROM public.workspace_invites
   WHERE token_lookup = v_lookup
     AND token_hash   = v_hash
     AND accepted_at  IS NULL
     AND revoked_at   IS NULL
     AND expires_at   > now()
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'check_violation';
  END IF;

  IF v_invited_em IS NOT NULL THEN
    v_actor_email := lower(NULLIF(auth.email(), ''));
    IF v_actor_email IS NULL OR v_actor_email <> lower(v_invited_em) THEN
      RAISE EXCEPTION 'invite_email_mismatch'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Already-Member-Check: nur AKTIVE Memberships zaehlen.
  -- Wenn der User existing-but-deactivated ist, INSERT unten wuerde
  -- per (workspace_id,user_id)-PK kollidieren — daher reaktivieren.
  IF EXISTS (
    SELECT 1 FROM public.memberships
     WHERE workspace_id = v_workspace
       AND user_id = v_actor
       AND deactivated_at IS NULL
  ) THEN
    RAISE EXCEPTION 'already_member' USING ERRCODE = 'unique_violation';
  END IF;

  UPDATE public.workspace_invites
     SET accepted_at         = now(),
         accepted_by_user_id = v_actor
   WHERE id            = v_invite_id
     AND accepted_at   IS NULL
     AND revoked_at    IS NULL
     AND expires_at    > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'check_violation';
  END IF;

  -- INSERT mit ON CONFLICT DO UPDATE: Reaktivierung wenn deaktivierte
  -- Membership existiert. Bei keiner existing-row wird Insert ausgefuehrt.
  INSERT INTO public.memberships (workspace_id, user_id, role)
  VALUES (v_workspace, v_actor, v_role)
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        deactivated_at = NULL;

  INSERT INTO public.workspace_audit_log (
    workspace_id, actor_id, action, target_user_id, payload
  )
  VALUES (
    v_workspace, v_actor, 'invite.accepted', v_actor,
    jsonb_build_object('invite_id', v_invite_id, 'role', v_role)
  );

  RETURN jsonb_build_object(
    'workspace_id', v_workspace,
    'role', v_role
  );
END
$$;

GRANT EXECUTE ON FUNCTION public.redeem_invite(text) TO authenticated, service_role;
