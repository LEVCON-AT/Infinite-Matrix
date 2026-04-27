-- ═══════════════════════════════════════════════════════════════
-- Phase 2 (Welle A.0) — User-eigene AI-Provider-Keys
--
-- Speichert pro User einen oder mehrere AI-Provider-Keys (Anthropic,
-- OpenAI, Gemini). Genau einer pro User darf is_default = true sein.
-- Der API-Key wird at-rest verschluesselt (pgp_sym_encrypt) — Master-
-- Key liegt in einer Postgres-GUC, die ausserhalb dieser Migration
-- gesetzt wird (`ALTER DATABASE postgres SET app.ai_master_key = '…'`,
-- siehe docs/claude/architektur.md). Master-Key gehoert NICHT ins Repo
-- und NICHT in DB-Dumps lesbar herum.
--
-- Self-hosted Supabase (dieser Stack) hat KEIN Edge-Functions-Service.
-- Encryption + RPC-Logik leben deshalb in PL/pgSQL. Das ai-assist-Pipe
-- (Welle A.2) braucht spaeter einen externen Node-/Deno-Service, der
-- den entschluesselten Key holt und LLM-Outbound-Calls macht — der
-- Service-Pfad wird in einem getrennten Sprint zwischen A.0 und A.1
-- gebaut.
--
-- Schema-Quad:
--   - Schema: hier (Tabelle + ENUM + View + RPCs).
--   - Mutations: lib/ai-providers.ts ruft RPCs (kein Direkt-Insert).
--   - MCP-Tools-Trio: AI-Provider sind user-private; KEINE Bridge-Tools.
--   - Export/Import: NICHT exportiert (Keys sind user-privat, nicht
--     workspace-bezogen).
--
-- pgcrypto-Extension ist seit Migration 011 aktiv.
-- ═══════════════════════════════════════════════════════════════

-- 1) Provider-Kind-ENUM. Erweiterbar via ALTER TYPE … ADD VALUE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_provider_kind') THEN
    CREATE TYPE public.ai_provider_kind AS ENUM ('anthropic', 'openai', 'gemini');
  END IF;
END $$;

-- 2) Master-Key-Helper. Liest GUC app.ai_master_key, raised wenn leer.
--    Jede Encryption/Decryption-Operation ruft das — wenn Server falsch
--    konfiguriert ist, schlaegt set_ai_provider sofort lautlos NICHT
--    fehl, sondern mit klarem Fehler.
CREATE OR REPLACE FUNCTION public._ai_master_key()
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text;
BEGIN
  k := current_setting('app.ai_master_key', true);
  IF k IS NULL OR length(k) < 16 THEN
    RAISE EXCEPTION 'ai_master_key_missing'
      USING HINT = 'Postgres-GUC app.ai_master_key muss gesetzt sein (siehe docs/claude/architektur.md).';
  END IF;
  RETURN k;
END $$;

-- 3) Tabelle. api_key_encrypted ist bytea (PGP-Sym-Encrypt-Output).
CREATE TABLE IF NOT EXISTS public.user_ai_providers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind               public.ai_provider_kind NOT NULL,
  label              text NOT NULL,
  api_key_encrypted  bytea NOT NULL,
  model_name         text,
  is_default         boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Genau eine Default-Reihe pro User.
CREATE UNIQUE INDEX IF NOT EXISTS user_ai_providers_default
  ON public.user_ai_providers (user_id) WHERE is_default;

CREATE INDEX IF NOT EXISTS user_ai_providers_user_idx
  ON public.user_ai_providers (user_id);

DROP TRIGGER IF EXISTS user_ai_providers_set_updated_at ON public.user_ai_providers;
CREATE TRIGGER user_ai_providers_set_updated_at
  BEFORE UPDATE ON public.user_ai_providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_ai_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_ai_providers FORCE  ROW LEVEL SECURITY;

-- RLS-Policies: Self-only, kein Direkt-Insert/Update von der Tabelle
-- aus dem Frontend (geht ueber RPCs). Aber wir lassen SELECT explizit
-- offen, weil die _safe-View darauf aufsetzt (security_invoker = true).
DROP POLICY IF EXISTS user_ai_providers_self_select ON public.user_ai_providers;
CREATE POLICY user_ai_providers_self_select ON public.user_ai_providers
  FOR SELECT USING (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE laufen ueber SECURITY DEFINER-RPCs. Wir lassen
-- die Direct-Pfade auch policy-blockiert offen — defense in depth.
-- (Service-Role bypasses RLS und kann via Vault-Migrations rein, aber
-- Frontend sieht nichts.)
DROP POLICY IF EXISTS user_ai_providers_block_direct_writes ON public.user_ai_providers;
CREATE POLICY user_ai_providers_block_direct_writes ON public.user_ai_providers
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS user_ai_providers_block_direct_updates ON public.user_ai_providers;
CREATE POLICY user_ai_providers_block_direct_updates ON public.user_ai_providers
  FOR UPDATE USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS user_ai_providers_block_direct_deletes ON public.user_ai_providers;
CREATE POLICY user_ai_providers_block_direct_deletes ON public.user_ai_providers
  FOR DELETE USING (false);

-- 4) Safe-View ohne api_key_encrypted-Spalte. Frontend liest IMMER hier
--    — security_invoker = true sorgt dafuer, dass die View die RLS-
--    Rechte des aufrufenden Users erbt.
DROP VIEW IF EXISTS public.user_ai_providers_safe;
CREATE VIEW public.user_ai_providers_safe
  WITH (security_invoker = true) AS
SELECT id, user_id, kind, label, model_name, is_default, created_at, updated_at
  FROM public.user_ai_providers;

GRANT SELECT ON public.user_ai_providers_safe TO authenticated;

-- 5) RPC: Provider anlegen oder aktualisieren.
--    p_id = NULL → INSERT. p_id = uuid → UPDATE (api_key optional, wenn
--    NULL bleibt der existing Wert).
--    Setzen-als-Default wird in einer Transaktion atomar gemacht — alle
--    anderen is_default auf false, dann diesen auf true.
CREATE OR REPLACE FUNCTION public.set_ai_provider(
  p_id           uuid,
  p_kind         public.ai_provider_kind,
  p_label        text,
  p_api_key      text,         -- NULL bei Update ohne Key-Wechsel
  p_model_name   text,
  p_set_default  boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_id      uuid;
  v_key_enc bytea;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_label IS NULL OR length(trim(p_label)) = 0 THEN
    RAISE EXCEPTION 'label_required' USING ERRCODE = 'check_violation';
  END IF;

  -- Key encrypten, wenn neu/geliefert.
  IF p_api_key IS NOT NULL THEN
    IF length(trim(p_api_key)) < 8 THEN
      RAISE EXCEPTION 'api_key_too_short' USING ERRCODE = 'check_violation';
    END IF;
    v_key_enc := pgp_sym_encrypt(p_api_key, public._ai_master_key());
  END IF;

  IF p_id IS NULL THEN
    -- INSERT-Pfad: Key ist Pflicht.
    IF v_key_enc IS NULL THEN
      RAISE EXCEPTION 'api_key_required_on_insert' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.user_ai_providers (user_id, kind, label, api_key_encrypted, model_name)
      VALUES (v_actor, p_kind, p_label, v_key_enc, p_model_name)
      RETURNING id INTO v_id;
  ELSE
    -- UPDATE-Pfad: Owner-Check + selektives Update.
    IF NOT EXISTS (
      SELECT 1 FROM public.user_ai_providers
        WHERE id = p_id AND user_id = v_actor
    ) THEN
      RAISE EXCEPTION 'provider_not_found' USING ERRCODE = 'no_data_found';
    END IF;
    UPDATE public.user_ai_providers
       SET kind              = p_kind,
           label             = p_label,
           api_key_encrypted = COALESCE(v_key_enc, api_key_encrypted),
           model_name        = p_model_name
     WHERE id = p_id AND user_id = v_actor;
    v_id := p_id;
  END IF;

  -- Default-Toggle in derselben Transaktion: erst alle vom User auf
  -- false, dann diese eine auf true. Atomar — Unique-Index nie verletzt.
  IF p_set_default THEN
    UPDATE public.user_ai_providers
       SET is_default = false
     WHERE user_id = v_actor AND id <> v_id AND is_default;
    UPDATE public.user_ai_providers
       SET is_default = true
     WHERE id = v_id;
  END IF;

  RETURN (
    SELECT jsonb_build_object(
      'id', id,
      'kind', kind,
      'label', label,
      'model_name', model_name,
      'is_default', is_default,
      'created_at', created_at,
      'updated_at', updated_at
    )
    FROM public.user_ai_providers
    WHERE id = v_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.set_ai_provider(uuid, public.ai_provider_kind, text, text, text, boolean) TO authenticated;

-- 6) RPC: Provider loeschen.
CREATE OR REPLACE FUNCTION public.delete_ai_provider(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_was_default boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT is_default INTO v_was_default
    FROM public.user_ai_providers
   WHERE id = p_id AND user_id = v_actor;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  DELETE FROM public.user_ai_providers
   WHERE id = p_id AND user_id = v_actor;

  RETURN jsonb_build_object('id', p_id, 'was_default', v_was_default);
END $$;

GRANT EXECUTE ON FUNCTION public.delete_ai_provider(uuid) TO authenticated;

-- 7) RPC: Default-Provider setzen (ohne andere Felder zu touchen).
CREATE OR REPLACE FUNCTION public.set_ai_provider_default(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_ai_providers
      WHERE id = p_id AND user_id = v_actor
  ) THEN
    RAISE EXCEPTION 'provider_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE public.user_ai_providers
     SET is_default = false
   WHERE user_id = v_actor AND id <> p_id AND is_default;

  UPDATE public.user_ai_providers
     SET is_default = true
   WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'is_default', true);
END $$;

GRANT EXECUTE ON FUNCTION public.set_ai_provider_default(uuid) TO authenticated;

-- 8) ai_call_log: Audit-/Cost-Log fuer kommende ai-assist-Pipe (A.2).
--    Insert nur via Service-Role (kein User-RPC), Read self-only.
CREATE TABLE IF NOT EXISTS public.ai_call_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id   uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  provider       public.ai_provider_kind NOT NULL,
  model_name     text,
  input_tokens   int,
  output_tokens  int,
  duration_ms    int,
  tool_calls     int NOT NULL DEFAULT 0,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_call_log_user_idx
  ON public.ai_call_log (user_id, created_at DESC);

ALTER TABLE public.ai_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_call_log FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_call_log_self_read ON public.ai_call_log;
CREATE POLICY ai_call_log_self_read ON public.ai_call_log
  FOR SELECT USING (auth.uid() = user_id);

-- Insert nur via Service-Role (Edge/Node-Service in A.2). Frontend kann
-- nicht selber Logs schreiben.
DROP POLICY IF EXISTS ai_call_log_no_user_writes ON public.ai_call_log;
CREATE POLICY ai_call_log_no_user_writes ON public.ai_call_log
  FOR INSERT WITH CHECK (false);

-- 9) Comments fuer DB-Browser/Studio.
COMMENT ON TABLE  public.user_ai_providers IS
  'User-eigene AI-Provider (Anthropic/OpenAI/Gemini). API-Keys at-rest verschluesselt mit pgp_sym_encrypt + GUC app.ai_master_key.';
COMMENT ON COLUMN public.user_ai_providers.api_key_encrypted IS
  'pgp_sym_encrypt(api_key, current_setting(app.ai_master_key)). Nie ueber Safe-View exposed.';
COMMENT ON VIEW   public.user_ai_providers_safe IS
  'Frontend-Read-View ohne api_key_encrypted. security_invoker=true erbt RLS vom aufrufenden User.';
COMMENT ON TABLE  public.ai_call_log IS
  'Audit-Log fuer ai-assist-Pipe (A.2). Token-Counts + Tool-Calls + Errors.';
