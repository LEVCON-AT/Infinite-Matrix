-- ═══════════════════════════════════════════════════════════════
-- WV.D.2 — OAuth-Foundation: RPCs + Provider-Slots + Safe-Views
--
-- Konzept §13 (Channel-Bridges) + plan-welle-d.md §3.
--
-- Baut auf 077 auf (user_oauth_tokens + widget_external_channels +
-- ENUM channel_provider). Diese Migration ergaenzt:
--
--   1. oauth_provider_slots — System-weite Konfig pro Provider
--      (client_id, client_secret_encrypted, auth_url, token_url,
--      scopes_default). RLS: platform_admin-only.
--   2. RPCs fuer user_oauth_tokens — SECURITY DEFINER:
--      set_oauth_token / delete_oauth_token / get_oauth_token_decrypted.
--      Frontend SCHREIBT NUR via RPC (Direct-Write-Block-Policies).
--   3. RPCs fuer oauth_provider_slots — admin-only:
--      set_oauth_provider_slot / delete_oauth_provider_slot.
--   4. Safe-Views ohne *_encrypted-Spalten:
--      user_oauth_tokens_safe / oauth_provider_slots_safe.
--   5. Direct-Write-Block-Policies auf user_oauth_tokens
--      (Defense-in-Depth — RPC ist Single-Pfad).
--
-- Pattern aus 018_user_ai_providers.sql (set_ai_provider).
--
-- Apply (User-Go-Pflicht):
--   docker exec matrix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f 078_oauth_rpcs_and_provider_slots.sql
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── oauth_provider_slots ──────────────────────────────────────
-- System-weite Provider-Configs. Pro Provider genau eine Row.
-- platform_admin-only Lese- + Schreib-Rechte.
CREATE TABLE IF NOT EXISTS public.oauth_provider_slots (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                 public.channel_provider NOT NULL,
  client_id                text NOT NULL,
  -- Client-Secret verschluesselt (pgp_sym_encrypt mit app.ai_master_key).
  client_secret_encrypted  bytea NULL,
  auth_url                 text NULL,    -- z.B. https://login.microsoftonline.com/.../authorize
  token_url                text NULL,    -- z.B. https://login.microsoftonline.com/.../token
  -- Default-Scopes pro Provider — User-Override moeglich pro Token.
  scopes_default           text[] NULL,
  -- Free-Form-Konfig pro Provider (z.B. tenant_id fuer Microsoft,
  -- redirect_uri-Override, custom_endpoint fuer Nextcloud).
  extra_config             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                   text NOT NULL DEFAULT 'fehlt',
    -- 'fehlt' (init), 'konfiguriert' (Client-ID+Secret gesetzt),
    -- 'verifiziert' (Test-Connect erfolgreich), 'ungueltig' (Test-Fail).
  status_checked_at        timestamptz NULL,
  status_message           text NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oauth_provider_slots_unique_per_provider UNIQUE (provider),
  CONSTRAINT oauth_provider_slots_status_chk CHECK (
    status IN ('fehlt', 'konfiguriert', 'verifiziert', 'ungueltig')
  )
);

CREATE INDEX IF NOT EXISTS oauth_provider_slots_provider_idx
  ON public.oauth_provider_slots(provider);

CREATE OR REPLACE FUNCTION public._oauth_provider_slots_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS oauth_provider_slots_touch_updated_at ON public.oauth_provider_slots;
CREATE TRIGGER oauth_provider_slots_touch_updated_at
  BEFORE UPDATE ON public.oauth_provider_slots
  FOR EACH ROW EXECUTE FUNCTION public._oauth_provider_slots_touch_updated_at();

ALTER TABLE public.oauth_provider_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oauth_provider_slots FORCE  ROW LEVEL SECURITY;

-- platform_admin-only — Direct-Read OK, Direct-Write geblockt
-- (RPC-Pflicht damit Encrypt garantiert ist).
DROP POLICY IF EXISTS oauth_provider_slots_admin_select ON public.oauth_provider_slots;
CREATE POLICY oauth_provider_slots_admin_select ON public.oauth_provider_slots
  FOR SELECT USING (public.is_platform_admin());

DROP POLICY IF EXISTS oauth_provider_slots_block_direct_writes ON public.oauth_provider_slots;
CREATE POLICY oauth_provider_slots_block_direct_writes ON public.oauth_provider_slots
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS oauth_provider_slots_block_direct_updates ON public.oauth_provider_slots;
CREATE POLICY oauth_provider_slots_block_direct_updates ON public.oauth_provider_slots
  FOR UPDATE USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS oauth_provider_slots_block_direct_deletes ON public.oauth_provider_slots;
CREATE POLICY oauth_provider_slots_block_direct_deletes ON public.oauth_provider_slots
  FOR DELETE USING (false);

-- ─── user_oauth_tokens — Direct-Write-Block ────────────────────
-- 077 hat SELECT/INSERT/UPDATE/DELETE-Owner-Policies geboren.
-- Wir ersetzen INSERT/UPDATE/DELETE durch Block-Policies, damit alle
-- Schreibvorgaenge ueber RPCs laufen (Encryption-Garantie).
DROP POLICY IF EXISTS user_oauth_tokens_insert ON public.user_oauth_tokens;
CREATE POLICY user_oauth_tokens_block_direct_inserts ON public.user_oauth_tokens
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS user_oauth_tokens_update ON public.user_oauth_tokens;
CREATE POLICY user_oauth_tokens_block_direct_updates ON public.user_oauth_tokens
  FOR UPDATE USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS user_oauth_tokens_delete ON public.user_oauth_tokens;
CREATE POLICY user_oauth_tokens_block_direct_deletes ON public.user_oauth_tokens
  FOR DELETE USING (false);

ALTER TABLE public.user_oauth_tokens FORCE ROW LEVEL SECURITY;

-- ─── Safe-Views ────────────────────────────────────────────────
DROP VIEW IF EXISTS public.user_oauth_tokens_safe;
CREATE VIEW public.user_oauth_tokens_safe
  WITH (security_invoker = true) AS
SELECT
  id, user_id, provider, expires_at, scopes,
  -- Hilfsfelder fuer Frontend-Status:
  (refresh_token_encrypted IS NOT NULL)        AS has_refresh_token,
  (generic_credentials_encrypted IS NOT NULL)  AS has_generic_credentials,
  created_at, updated_at
FROM public.user_oauth_tokens;

GRANT SELECT ON public.user_oauth_tokens_safe TO authenticated;

DROP VIEW IF EXISTS public.oauth_provider_slots_safe;
CREATE VIEW public.oauth_provider_slots_safe
  WITH (security_invoker = true) AS
SELECT
  id, provider, client_id, auth_url, token_url, scopes_default,
  extra_config, status, status_checked_at, status_message,
  (client_secret_encrypted IS NOT NULL) AS has_client_secret,
  created_at, updated_at
FROM public.oauth_provider_slots;

GRANT SELECT ON public.oauth_provider_slots_safe TO authenticated;

-- ─── RPC: set_oauth_token (User-eigener Token speichern) ───────
-- Wird vom OAuth-Callback-Endpoint gerufen (Server-Side, mit User-JWT)
-- ODER vom mail-generic-Setup-Form (App-Password).
-- p_access_token / p_refresh_token sind Plaintext bei INSERT.
-- Bei UPDATE: wenn NULL, bleibt der existing Wert (selektiver Update).
CREATE OR REPLACE FUNCTION public.set_oauth_token(
  p_provider             public.channel_provider,
  p_access_token         text,
  p_refresh_token        text,
  p_generic_credentials  jsonb,    -- {imap_host, smtp_host, username, app_password} fuer mail-generic
  p_expires_at           timestamptz,
  p_scopes               text[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_id       uuid;
  v_acc_enc  bytea;
  v_ref_enc  bytea;
  v_gen_enc  bytea;
  v_existing public.user_oauth_tokens%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_existing
    FROM public.user_oauth_tokens
   WHERE user_id = v_actor AND provider = p_provider;

  -- Encrypt nur wenn Plaintext geliefert. Sonst bleibt v_*_enc NULL
  -- → COALESCE im UPDATE behaelt den existing Wert.
  IF p_access_token IS NOT NULL THEN
    IF length(trim(p_access_token)) < 4 THEN
      RAISE EXCEPTION 'access_token_too_short' USING ERRCODE = 'check_violation';
    END IF;
    v_acc_enc := pgp_sym_encrypt(p_access_token, public._ai_master_key());
  END IF;

  IF p_refresh_token IS NOT NULL THEN
    v_ref_enc := pgp_sym_encrypt(p_refresh_token, public._ai_master_key());
  END IF;

  IF p_generic_credentials IS NOT NULL THEN
    v_gen_enc := pgp_sym_encrypt(p_generic_credentials::text, public._ai_master_key());
  END IF;

  IF v_existing.id IS NULL THEN
    -- INSERT: access_token ODER generic_credentials Pflicht.
    IF v_acc_enc IS NULL AND v_gen_enc IS NULL THEN
      RAISE EXCEPTION 'access_token_or_generic_credentials_required'
        USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.user_oauth_tokens (
      user_id, provider, access_token_encrypted, refresh_token_encrypted,
      generic_credentials_encrypted, expires_at, scopes
    ) VALUES (
      v_actor, p_provider,
      COALESCE(v_acc_enc, '\x'::bytea),  -- bytea NOT NULL — Empty-bytea-Fallback fuer App-Password-Pfad
      v_ref_enc, v_gen_enc, p_expires_at, p_scopes
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.user_oauth_tokens
       SET access_token_encrypted        = COALESCE(v_acc_enc, access_token_encrypted),
           refresh_token_encrypted       = COALESCE(v_ref_enc, refresh_token_encrypted),
           generic_credentials_encrypted = COALESCE(v_gen_enc, generic_credentials_encrypted),
           expires_at                    = COALESCE(p_expires_at, expires_at),
           scopes                        = COALESCE(p_scopes, scopes)
     WHERE id = v_existing.id;
    v_id := v_existing.id;
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'id', id,
      'user_id', user_id,
      'provider', provider,
      'expires_at', expires_at,
      'scopes', scopes,
      'has_refresh_token', refresh_token_encrypted IS NOT NULL,
      'has_generic_credentials', generic_credentials_encrypted IS NOT NULL,
      'created_at', created_at,
      'updated_at', updated_at
    )
    FROM public.user_oauth_tokens WHERE id = v_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.set_oauth_token(
  public.channel_provider, text, text, jsonb, timestamptz, text[]
) TO authenticated;

-- ─── RPC: delete_oauth_token (User-eigener Token loeschen) ─────
CREATE OR REPLACE FUNCTION public.delete_oauth_token(p_provider public.channel_provider)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id    uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.user_oauth_tokens
   WHERE user_id = v_actor AND provider = p_provider
   RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'token_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  RETURN jsonb_build_object('id', v_id, 'provider', p_provider);
END $$;

GRANT EXECUTE ON FUNCTION public.delete_oauth_token(public.channel_provider) TO authenticated;

-- ─── RPC: get_oauth_token_decrypted ─────────────────────────────
-- Gibt Plaintext-Tokens zurueck — NUR fuer Bridge / Server-Side-Refresh-
-- Logik. Caller MUSS auth.uid() = user_id der Row haben (RLS-equivalent
-- innerhalb des SECURITY DEFINER per WHERE-Klausel).
--
-- Pattern: Bridge ruft mit User-JWT-Token aus WS-Auth → auth.uid() ist
-- der User. Token-Plaintext landet im Bridge-Memory, niemals im Frontend.
CREATE OR REPLACE FUNCTION public.get_oauth_token_decrypted(
  p_provider public.channel_provider
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_row   public.user_oauth_tokens%ROWTYPE;
  v_acc   text;
  v_ref   text;
  v_gen   jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row
    FROM public.user_oauth_tokens
   WHERE user_id = v_actor AND provider = p_provider;

  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF octet_length(v_row.access_token_encrypted) > 0 THEN
    v_acc := pgp_sym_decrypt(v_row.access_token_encrypted, public._ai_master_key());
  END IF;
  IF v_row.refresh_token_encrypted IS NOT NULL THEN
    v_ref := pgp_sym_decrypt(v_row.refresh_token_encrypted, public._ai_master_key());
  END IF;
  IF v_row.generic_credentials_encrypted IS NOT NULL THEN
    v_gen := pgp_sym_decrypt(v_row.generic_credentials_encrypted, public._ai_master_key())::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'provider', v_row.provider,
    'access_token', v_acc,
    'refresh_token', v_ref,
    'generic_credentials', v_gen,
    'expires_at', v_row.expires_at,
    'scopes', v_row.scopes,
    'updated_at', v_row.updated_at
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_oauth_token_decrypted(public.channel_provider)
  TO authenticated;

-- ─── RPC: set_oauth_provider_slot (admin-only) ─────────────────
-- Setzt/aktualisiert Provider-Konfiguration. Client-Secret optional —
-- bleibt erhalten wenn NULL geliefert.
CREATE OR REPLACE FUNCTION public.set_oauth_provider_slot(
  p_provider        public.channel_provider,
  p_client_id       text,
  p_client_secret   text,    -- NULL = unchanged bei UPDATE
  p_auth_url        text,
  p_token_url       text,
  p_scopes_default  text[],
  p_extra_config    jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_id      uuid;
  v_sec_enc bytea;
  v_existing public.oauth_provider_slots%ROWTYPE;
  v_status  text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'platform_admin_required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_client_id IS NULL OR length(trim(p_client_id)) = 0 THEN
    RAISE EXCEPTION 'client_id_required' USING ERRCODE = 'check_violation';
  END IF;

  IF p_client_secret IS NOT NULL THEN
    IF length(trim(p_client_secret)) < 4 THEN
      RAISE EXCEPTION 'client_secret_too_short' USING ERRCODE = 'check_violation';
    END IF;
    v_sec_enc := pgp_sym_encrypt(p_client_secret, public._ai_master_key());
  END IF;

  SELECT * INTO v_existing
    FROM public.oauth_provider_slots
   WHERE provider = p_provider;

  -- Status-Berechnung: wenn Client-ID + Secret beide vorhanden → 'konfiguriert'.
  -- Test-Connect setzt spaeter 'verifiziert' / 'ungueltig'.
  v_status := CASE
    WHEN p_client_id IS NOT NULL AND (
      v_sec_enc IS NOT NULL OR v_existing.client_secret_encrypted IS NOT NULL
    ) THEN 'konfiguriert'
    ELSE 'fehlt'
  END;

  IF v_existing.id IS NULL THEN
    INSERT INTO public.oauth_provider_slots (
      provider, client_id, client_secret_encrypted, auth_url, token_url,
      scopes_default, extra_config, status
    ) VALUES (
      p_provider, p_client_id, v_sec_enc, p_auth_url, p_token_url,
      p_scopes_default, COALESCE(p_extra_config, '{}'::jsonb), v_status
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.oauth_provider_slots
       SET client_id                = p_client_id,
           client_secret_encrypted  = COALESCE(v_sec_enc, client_secret_encrypted),
           auth_url                 = COALESCE(p_auth_url, auth_url),
           token_url                = COALESCE(p_token_url, token_url),
           scopes_default           = COALESCE(p_scopes_default, scopes_default),
           extra_config             = COALESCE(p_extra_config, extra_config),
           status                   = v_status
     WHERE id = v_existing.id;
    v_id := v_existing.id;
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'id', id,
      'provider', provider,
      'client_id', client_id,
      'has_client_secret', client_secret_encrypted IS NOT NULL,
      'auth_url', auth_url,
      'token_url', token_url,
      'scopes_default', scopes_default,
      'extra_config', extra_config,
      'status', status
    )
    FROM public.oauth_provider_slots WHERE id = v_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.set_oauth_provider_slot(
  public.channel_provider, text, text, text, text, text[], jsonb
) TO authenticated;

-- ─── RPC: set_oauth_provider_slot_status (Test-Connect-Result) ──
-- Wird vom Test-Connect-Endpoint gerufen (admin-only) — schreibt
-- 'verifiziert' / 'ungueltig' + Message.
CREATE OR REPLACE FUNCTION public.set_oauth_provider_slot_status(
  p_provider public.channel_provider,
  p_status   text,
  p_message  text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'platform_admin_required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_status NOT IN ('konfiguriert', 'verifiziert', 'ungueltig') THEN
    RAISE EXCEPTION 'invalid_status_value' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.oauth_provider_slots
     SET status            = p_status,
         status_checked_at = now(),
         status_message    = p_message
   WHERE provider = p_provider;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider_slot_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  RETURN jsonb_build_object(
    'provider', p_provider, 'status', p_status, 'message', p_message
  );
END $$;

GRANT EXECUTE ON FUNCTION public.set_oauth_provider_slot_status(
  public.channel_provider, text, text
) TO authenticated;

-- ─── RPC: get_oauth_provider_slot_decrypted (admin-only) ───────
-- Liefert Plaintext-Client-Secret fuer OAuth-Callback-Code-Exchange.
-- Nur platform_admin darf das callen.
CREATE OR REPLACE FUNCTION public.get_oauth_provider_slot_decrypted(
  p_provider public.channel_provider
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_row    public.oauth_provider_slots%ROWTYPE;
  v_secret text;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'platform_admin_required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row
    FROM public.oauth_provider_slots
   WHERE provider = p_provider;

  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_row.client_secret_encrypted IS NOT NULL THEN
    v_secret := pgp_sym_decrypt(v_row.client_secret_encrypted, public._ai_master_key());
  END IF;

  RETURN jsonb_build_object(
    'provider', v_row.provider,
    'client_id', v_row.client_id,
    'client_secret', v_secret,
    'auth_url', v_row.auth_url,
    'token_url', v_row.token_url,
    'scopes_default', v_row.scopes_default,
    'extra_config', v_row.extra_config
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_oauth_provider_slot_decrypted(public.channel_provider)
  TO authenticated;

-- ─── RPC: delete_oauth_provider_slot (admin-only) ──────────────
CREATE OR REPLACE FUNCTION public.delete_oauth_provider_slot(
  p_provider public.channel_provider
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'platform_admin_required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.oauth_provider_slots
   WHERE provider = p_provider
   RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'provider_slot_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  RETURN jsonb_build_object('id', v_id, 'provider', p_provider);
END $$;

GRANT EXECUTE ON FUNCTION public.delete_oauth_provider_slot(public.channel_provider)
  TO authenticated;

COMMIT;

COMMENT ON TABLE public.oauth_provider_slots IS
  'WV.D.2: System-weite Provider-Configs (client_id/secret/auth_url/token_url). Pro Provider 1 Row. RLS: platform_admin-only.';
COMMENT ON FUNCTION public.set_oauth_token IS
  'WV.D.2: User-eigenen Token speichern (Pflicht-Pfad fuer Frontend-Schreiben). pgp_sym_encrypt mit app.ai_master_key.';
COMMENT ON FUNCTION public.get_oauth_token_decrypted IS
  'WV.D.2: Plaintext-Token fuer Bridge-Refresh-Logik. Caller MUSS user-context haben (auth.uid()=user_id).';
