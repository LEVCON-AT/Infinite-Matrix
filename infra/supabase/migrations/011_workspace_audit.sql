-- ═══════════════════════════════════════════════════════════════
-- Phase 1 (P1.A) — Workspace-Audit-Log + Invite-RPCs
--
-- workspace_audit_log: append-only Tabelle fuer alle Workspace-Member-
-- Mutationen (invite-erzeugt, invite-akzeptiert, invite-widerrufen,
-- spaeter Rolle-geaendert + Member-entfernt aus P1.B). Immutability
-- per Trigger erzwungen — UPDATE/DELETE/TRUNCATE wirft Exception.
--
-- Schreib-Zugriff geht ausschliesslich ueber SECURITY DEFINER RPCs,
-- die in dieser Migration zusammen mit der Tabelle definiert werden.
-- Damit existieren beide Tabellen (workspace_invites aus 010 +
-- workspace_audit_log hier) im Moment der CREATE FUNCTION — kein
-- Lazy-Resolve-Risiko, eager Plan-Check faengt Fehler beim Apply.
--
-- Idempotent: IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.
-- ═══════════════════════════════════════════════════════════════

-- pgcrypto fuer digest() + gen_random_bytes() in den Invite-RPCs.
-- In Supabase-Default-Setups bereits geladen, aber explizit fuer
-- CI / Self-Hosted / kuenftige Env-Klone.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Tabelle workspace_audit_log ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  actor_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action         text NOT NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.workspace_audit_log IS
  'Phase 1 — append-only Audit-Trail fuer Member-/Invite-Mutationen.';
COMMENT ON COLUMN public.workspace_audit_log.action IS
  'invite.created | invite.accepted | invite.revoked | member.role_changed | member.removed';

CREATE INDEX IF NOT EXISTS workspace_audit_log_ws_ts_idx
  ON public.workspace_audit_log(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workspace_audit_log_actor_idx
  ON public.workspace_audit_log(actor_id, created_at DESC);

-- ─── Immutability-Trigger ─────────────────────────────────────
-- UPDATE/DELETE pro Row, TRUNCATE auf Statement-Level (postgres-Pflicht).
CREATE OR REPLACE FUNCTION public.workspace_audit_immutable_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workspace_audit_log is append-only — UPDATE/DELETE not allowed'
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE OR REPLACE FUNCTION public.workspace_audit_immutable_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workspace_audit_log is append-only — TRUNCATE not allowed'
    USING ERRCODE = 'restrict_violation';
END
$$;

DROP TRIGGER IF EXISTS workspace_audit_log_no_modify ON public.workspace_audit_log;
CREATE TRIGGER workspace_audit_log_no_modify
  BEFORE UPDATE OR DELETE ON public.workspace_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.workspace_audit_immutable_row();

DROP TRIGGER IF EXISTS workspace_audit_log_no_truncate ON public.workspace_audit_log;
CREATE TRIGGER workspace_audit_log_no_truncate
  BEFORE TRUNCATE ON public.workspace_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.workspace_audit_immutable_truncate();

-- ─── RLS aktivieren ───────────────────────────────────────────
ALTER TABLE public.workspace_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_audit_log FORCE ROW LEVEL SECURITY;

-- ─── Policies ─────────────────────────────────────────────────
-- SELECT: nur owner/admin (Audit-Trail = Admin-Funktion).
DROP POLICY IF EXISTS workspace_audit_log_select_admin ON public.workspace_audit_log;
CREATE POLICY workspace_audit_log_select_admin ON public.workspace_audit_log
  FOR SELECT USING (public.workspace_role_of(workspace_id) IN ('owner','admin'));

-- INSERT/UPDATE/DELETE: deny-all auf API-Rollen-Ebene. Nur RPCs (SECURITY
-- DEFINER) bzw. service_role schreiben. Trigger blockt UPDATE/DELETE
-- ohnehin — Policy ist Defense-in-Depth.
DROP POLICY IF EXISTS workspace_audit_log_no_direct_write ON public.workspace_audit_log;
CREATE POLICY workspace_audit_log_no_direct_write ON public.workspace_audit_log
  FOR ALL USING (false) WITH CHECK (false);

-- ─── Grants ───────────────────────────────────────────────────
GRANT SELECT ON public.workspace_audit_log TO authenticated;
GRANT ALL ON public.workspace_audit_log TO service_role;

-- ═══════════════════════════════════════════════════════════════
-- Invite-RPCs: create / redeem / revoke
--
-- Alle drei sind SECURITY DEFINER + SET search_path = public, damit
-- sie Membership-Checks via public.workspace_role_of() korrekt
-- aufloesen, RLS bypassen und ein Search-Path-Hijack durch User-
-- Schemata ausgeschlossen ist (ASVS V5.3.4).
--
-- Atomicitaet: jede RPC INSERTet/UPDATEt sowohl workspace_invites
-- als auch workspace_audit_log innerhalb ihrer impliziten Transaktion.
-- Faellt eine der beiden Tabellen aus, rollt postgres die ganze
-- Funktion zurueck — kein Audit-Drift.
-- ═══════════════════════════════════════════════════════════════

-- Helper: URL-safe Base64 (RFC 4648 §5) ohne Padding.
-- pgcrypto.encode liefert Standard-Base64 mit +/= — wir mappen das auf
-- -_ und stripen '='. Damit landet der Token ohne Url-Escape im Mail-
-- Link und in der Browser-History.
CREATE OR REPLACE FUNCTION public.urlsafe_b64encode(p_bytes bytea)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT translate(encode(p_bytes, 'base64'), E'+/=\n', '-_');
$$;

GRANT EXECUTE ON FUNCTION public.urlsafe_b64encode(bytea) TO authenticated, service_role;

-- ─── create_invite ────────────────────────────────────────────
-- Erzeugt einen neuen Single-Use-Token. Returnt das Klartext-Token —
-- der Aufrufer (Bridge / Settings-Form) baut daraus den Mail-Link
-- /invite/<token>. DB persistiert nur den SHA-256-Hash.
CREATE OR REPLACE FUNCTION public.create_invite(
  p_workspace_id uuid,
  p_role         public.workspace_role,
  p_invited_email text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_role_caller public.workspace_role;
  v_raw         bytea;
  v_token_text  text;
  v_hash        bytea;
  v_lookup      bytea;
  v_invite_id   uuid;
  v_expires_at  timestamptz;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_role NOT IN ('editor','viewer') THEN
    RAISE EXCEPTION 'role_invalid' USING ERRCODE = 'check_violation';
  END IF;

  -- Caller-Rolle: nur owner/admin duerfen einladen.
  v_role_caller := public.workspace_role_of(p_workspace_id);
  IF v_role_caller NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 32 byte Entropie -> ~256 bit. Url-safe-Base64 ergibt 43 Zeichen.
  v_raw        := gen_random_bytes(32);
  v_token_text := public.urlsafe_b64encode(v_raw);
  v_hash       := digest(v_token_text, 'sha256');
  v_lookup     := substring(v_hash from 1 for 8);
  v_expires_at := now() + interval '7 days';

  INSERT INTO public.workspace_invites (
    workspace_id, token_hash, token_lookup, role,
    invited_by, invited_email, expires_at
  )
  VALUES (
    p_workspace_id, v_hash, v_lookup, p_role,
    v_actor, p_invited_email, v_expires_at
  )
  RETURNING id INTO v_invite_id;

  INSERT INTO public.workspace_audit_log (
    workspace_id, actor_id, action, target_user_id, payload
  )
  VALUES (
    p_workspace_id, v_actor, 'invite.created', NULL,
    jsonb_build_object(
      'invite_id', v_invite_id,
      'role', p_role,
      'invited_email', p_invited_email,
      'expires_at', v_expires_at
    )
  );

  RETURN jsonb_build_object(
    'invite_id', v_invite_id,
    'token', v_token_text,
    'expires_at', v_expires_at
  );
END
$$;

GRANT EXECUTE ON FUNCTION public.create_invite(uuid, public.workspace_role, text)
  TO authenticated, service_role;

-- ─── redeem_invite ────────────────────────────────────────────
-- Loest den Klartext-Token in eine Membership um. Atomar: UPDATE-mit-
-- WHERE-Guard verhindert Doppel-Use bei zwei parallelen Klicks. Generic
-- Error 'invite_invalid' bei ABLAUF / WIDERRUFEN / SCHON-AKZEPTIERT /
-- TOKEN-UNBEKANNT — kein Side-Channel-Leak welcher Status zutrifft.
CREATE OR REPLACE FUNCTION public.redeem_invite(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_hash       bytea;
  v_lookup     bytea;
  v_invite_id  uuid;
  v_workspace  uuid;
  v_role       public.workspace_role;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_token IS NULL OR length(p_token) < 16 THEN
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_hash   := digest(p_token, 'sha256');
  v_lookup := substring(v_hash from 1 for 8);

  -- Atomar: einziger UPDATE-Pfad, der Invites von "offen" auf
  -- "akzeptiert" flippt. Race-frei — wenn zwei parallele Calls
  -- denselben Token treffen, gewinnt einer, der andere bekommt
  -- 0 affected rows + invite_invalid.
  UPDATE public.workspace_invites
     SET accepted_at         = now(),
         accepted_by_user_id = v_actor
   WHERE token_lookup = v_lookup
     AND token_hash   = v_hash
     AND accepted_at  IS NULL
     AND revoked_at   IS NULL
     AND expires_at   > now()
  RETURNING id, workspace_id, role
       INTO v_invite_id, v_workspace, v_role;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'check_violation';
  END IF;

  -- Membership anlegen oder bestehende Rolle nicht ueberschreiben.
  -- Wenn der User schon Member ist (egal welche Rolle), bleibt alles
  -- wie es ist — wir akzeptieren den Invite trotzdem (Audit-Trail).
  INSERT INTO public.memberships (workspace_id, user_id, role)
  VALUES (v_workspace, v_actor, v_role)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

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

-- ─── revoke_invite ────────────────────────────────────────────
-- Markiert ein offenes Invite als widerrufen. Idempotent fuer schon
-- widerrufene/akzeptierte Invites: kein Status-Wechsel, aber auch kein
-- Fehler — fuer UI-Resilience.
CREATE OR REPLACE FUNCTION public.revoke_invite(p_invite_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_workspace  uuid;
  v_old_state  text;
  v_changed    boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Workspace + Status holen, um Caller-Rolle zu pruefen.
  SELECT workspace_id,
         CASE
           WHEN accepted_at IS NOT NULL THEN 'accepted'
           WHEN revoked_at  IS NOT NULL THEN 'revoked'
           ELSE 'open'
         END
    INTO v_workspace, v_old_state
    FROM public.workspace_invites
   WHERE id = p_invite_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  IF public.workspace_role_of(v_workspace) NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Nur offene Invites flippen. accepted bleibt accepted, revoked bleibt revoked.
  UPDATE public.workspace_invites
     SET revoked_at = now(),
         revoked_by = v_actor
   WHERE id          = p_invite_id
     AND accepted_at IS NULL
     AND revoked_at  IS NULL;

  v_changed := FOUND;

  IF v_changed THEN
    INSERT INTO public.workspace_audit_log (
      workspace_id, actor_id, action, target_user_id, payload
    )
    VALUES (
      v_workspace, v_actor, 'invite.revoked', NULL,
      jsonb_build_object('invite_id', p_invite_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'invite_id', p_invite_id,
    'previous_state', v_old_state,
    'changed', v_changed
  );
END
$$;

GRANT EXECUTE ON FUNCTION public.revoke_invite(uuid) TO authenticated, service_role;

-- ─── list_workspace_members ───────────────────────────────────
-- Joined Members-Liste mit auth.users (Email + display_name aus
-- raw_user_meta_data). Direktes JOIN aus dem Client geht nicht —
-- auth.users liegt in einem anderen Schema und PostgREST published
-- nur public. SECURITY DEFINER reicht das Read-Recht durch + erzwingt
-- workspace-Mitgliedschaft des Aufrufers ueber workspace_role_of().
--
-- viewer/editor/admin/owner duerfen alle co-Member sehen. Nicht-Member
-- bekommt 'forbidden'. Reihenfolge: owner zuerst, dann admin/editor/
-- viewer alphabetisch nach Rolle, innerhalb gleicher Rolle nach
-- Beitritt-Datum.
CREATE OR REPLACE FUNCTION public.list_workspace_members(p_workspace_id uuid)
RETURNS TABLE (
  user_id      uuid,
  email        text,
  display_name text,
  role         public.workspace_role,
  joined_at    timestamptz
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
      m.created_at
    FROM public.memberships m
    JOIN auth.users u ON u.id = m.user_id
    WHERE m.workspace_id = p_workspace_id
    ORDER BY
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
