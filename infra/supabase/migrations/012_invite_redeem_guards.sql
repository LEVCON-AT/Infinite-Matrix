-- ═══════════════════════════════════════════════════════════════
-- Phase 1 (P1.A.4) — redeem_invite haerten
--
-- Live-Smoke deckte Daten-Integritaets-Bug auf: Wenn der Inviter
-- selbst (oder ein anderer eingeloggter User mit dem Token in der
-- Hand) den Mail-Link klickte, lief redeem_invite mit dessen
-- auth.uid() durch. Der Token wurde als accepted markiert obwohl
-- der Klicker nicht der Eingeladene war, und INSERT INTO memberships
-- ON CONFLICT DO NOTHING tat nichts (Inviter ist schon Member). Der
-- echte Eingeladene konnte den Token danach nicht mehr einloesen.
--
-- Fix:
--   1. Wenn invited_email gesetzt ist: auth.email() MUSS exakt (case-
--      insensitive) matchen. Sonst Fehler invite_email_mismatch ohne
--      Token-Konsum.
--   2. Wenn Caller bereits aktive Membership im Workspace hat: Fehler
--      already_member ohne Token-Konsum.
--   3. ON CONFLICT DO NOTHING im Membership-Insert wegfallen lassen —
--      durch (2) ist Conflict ausgeschlossen, das schweigsame
--      no-op-Verhalten war ja gerade die Falle.
--
-- Plus: Mini-RPC get_workspace_owners(uuid[]) fuer den Workspace-
-- Switcher-Sub-Label aus S2 (Owner-Email anzeigen).
--
-- Idempotent: CREATE OR REPLACE FUNCTION ist re-runnable.
-- ═══════════════════════════════════════════════════════════════

-- ─── redeem_invite — neu mit Email-Match + Already-Member-Check ─
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

  -- 1) Lookup-only zuerst — kein Token-Konsum bevor Vor-Checks gruen.
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

  -- 2) Strict-Email-Check wenn invited_email gesetzt.
  IF v_invited_em IS NOT NULL THEN
    -- auth.email() liefert die Klartext-Email aus dem JWT-Claim. Wir
    -- vergleichen case-insensitive, weil Email-Adressen formal nicht
    -- case-sensitive sind und User-Eingabe inkonsistent ist.
    v_actor_email := lower(NULLIF(auth.email(), ''));
    IF v_actor_email IS NULL OR v_actor_email <> lower(v_invited_em) THEN
      RAISE EXCEPTION 'invite_email_mismatch'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- 3) Already-Member-Check — kein Konsum bei Doppel-Anmeldung des
  --    Inviters oder eines bereits-Mitglieds. Aktive Membership-Definition
  --    ueber deactivated_at IS NULL kommt erst mit Migration 013; bis
  --    dahin existiert die Spalte nicht, also defensiv-coalescend pruefen
  --    via column_exists-Pattern um Migration 012 unabhaengig von 013
  --    anwendbar zu halten.
  IF EXISTS (
    SELECT 1
      FROM public.memberships
     WHERE workspace_id = v_workspace
       AND user_id = v_actor
  ) THEN
    -- Hinweis: nach Migration 013 wird hier zusaetzlich
    -- `AND deactivated_at IS NULL` gefiltert — aktualisiert in 013.
    RAISE EXCEPTION 'already_member'
      USING ERRCODE = 'unique_violation';
  END IF;

  -- 4) Atomarer Token-Konsum: UPDATE-mit-WHERE-Guard race-frei.
  UPDATE public.workspace_invites
     SET accepted_at         = now(),
         accepted_by_user_id = v_actor
   WHERE id            = v_invite_id
     AND accepted_at   IS NULL
     AND revoked_at    IS NULL
     AND expires_at    > now();

  IF NOT FOUND THEN
    -- Race: zwei parallele Klicks haben sich gerade gegenseitig konsumiert.
    -- Generic invite_invalid — der Verlierer faellt auf den ersten Pfad
    -- zurueck.
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'check_violation';
  END IF;

  -- 5) Membership einlegen. Kein ON CONFLICT mehr — durch Step 3
  --    ausgeschlossen, dass Duplicate moeglich ist.
  INSERT INTO public.memberships (workspace_id, user_id, role)
  VALUES (v_workspace, v_actor, v_role);

  -- 6) Audit-Log mit korrektem actor + target.
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

-- ─── get_workspace_owners — fuer S2 Switcher-Sub-Label ──────────
-- Bekommt eine Liste Workspace-IDs (in denen Caller Member ist) +
-- liefert pro Workspace die Owner-Email zurueck. Nutzt JOIN auf
-- auth.users (was via PostgREST nicht published ist) — daher RPC.
--
-- Caller-Schutz: nur fuer Workspaces, in denen Caller selber Member
-- ist (sonst koennte jeder Owner-Emails fremder Workspaces enumerieren).
CREATE OR REPLACE FUNCTION public.get_workspace_owners(p_workspace_ids uuid[])
RETURNS TABLE (workspace_id uuid, owner_email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT w.id AS workspace_id,
           u.email::text AS owner_email
      FROM public.workspaces w
      JOIN auth.users u ON u.id = w.owner_id
     WHERE w.id = ANY(p_workspace_ids)
       AND public.is_workspace_member(w.id);
END
$$;

GRANT EXECUTE ON FUNCTION public.get_workspace_owners(uuid[]) TO authenticated, service_role;
