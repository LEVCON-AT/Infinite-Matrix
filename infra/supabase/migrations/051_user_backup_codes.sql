-- ═══════════════════════════════════════════════════════════════
-- Welle B B.2 Folge — User Backup-Codes (TOTP-Fallback)
--
-- 10 single-use Codes pro User. Plain-Code wird einmalig bei
-- generate_backup_codes() ausgegeben — nur Hash bleibt in der DB.
-- Login/Step-Up-Flow akzeptiert Backup-Code als Alternative zum
-- TOTP-6-stelligen-Code, wenn der User seine Authenticator-App
-- verloren hat.
--
-- Hash: sha256(code) — kein bcrypt/argon2, weil Codes 12 Zeichen
-- mit hoher Entropie sind (62^12 ≈ 3.2*10^21). Single-use durch
-- used_at-Timestamp.
--
-- Schema-Quad:
--   - Schema: hier (Tabelle + RPCs).
--   - Mutations: lib/backup-codes.ts ruft RPCs.
--   - MCP-Tools: nicht relevant (User-private).
--   - Export/Import: NICHT exportiert.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_backup_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash   bytea NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_backup_codes_user_unused
  ON public.user_backup_codes (user_id) WHERE used_at IS NULL;

ALTER TABLE public.user_backup_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_backup_codes FORCE  ROW LEVEL SECURITY;

-- SELECT nur fuer Status-Lookup (Frontend zeigt "X von 10 unbenutzt").
-- Direkter Zugriff auf code_hash bringt nichts (nur Hash).
DROP POLICY IF EXISTS user_backup_codes_self_select ON public.user_backup_codes;
CREATE POLICY user_backup_codes_self_select ON public.user_backup_codes
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_backup_codes_no_direct_writes ON public.user_backup_codes;
CREATE POLICY user_backup_codes_no_direct_writes ON public.user_backup_codes
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS user_backup_codes_no_direct_updates ON public.user_backup_codes;
CREATE POLICY user_backup_codes_no_direct_updates ON public.user_backup_codes
  FOR UPDATE USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS user_backup_codes_no_direct_deletes ON public.user_backup_codes;
CREATE POLICY user_backup_codes_no_direct_deletes ON public.user_backup_codes
  FOR DELETE USING (false);

-- Helper: 12-Zeichen-Code aus alphanumerischem Set generieren.
CREATE OR REPLACE FUNCTION public._gen_backup_code()
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- ohne 0/O/1/I/L (Verwechslung)
  result text := '';
  i int;
  rnd int;
BEGIN
  FOR i IN 1..12 LOOP
    rnd := floor(random() * length(alphabet))::int + 1;
    result := result || substr(alphabet, rnd, 1);
  END LOOP;
  -- 4-4-4-Format: ABCD-EFGH-JKLM
  RETURN substr(result, 1, 4) || '-' || substr(result, 5, 4) || '-' || substr(result, 9, 4);
END $$;

-- 1) Generieren: alte Codes loeschen, 10 neue anlegen, Plain als
--    JSON-Array zurueckgeben. Atomar in Transaction.
CREATE OR REPLACE FUNCTION public.generate_backup_codes()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_codes text[] := '{}';
  v_code  text;
  i int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Alte Codes wegwerfen (User hat neue angefordert).
  DELETE FROM public.user_backup_codes WHERE user_id = v_actor;

  FOR i IN 1..10 LOOP
    v_code := public._gen_backup_code();
    v_codes := array_append(v_codes, v_code);
    INSERT INTO public.user_backup_codes (user_id, code_hash)
      VALUES (v_actor, digest(v_code, 'sha256'));
  END LOOP;

  RETURN jsonb_build_object('codes', to_jsonb(v_codes));
END $$;

GRANT EXECUTE ON FUNCTION public.generate_backup_codes() TO authenticated;

-- 2) Konsumieren: Code-Hash matchen + used_at setzen. Returns
--    {consumed: bool, remaining: int}. Race-frei via UPDATE-mit-WHERE-
--    Guard (used_at IS NULL).
CREATE OR REPLACE FUNCTION public.consume_backup_code(p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id uuid;
  v_remaining int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_code IS NULL OR length(trim(p_code)) < 12 THEN
    RAISE EXCEPTION 'code_invalid' USING ERRCODE = 'check_violation';
  END IF;

  -- Atomarer UPDATE: nur unbenutzten Code mit Hash-Match konsumieren.
  UPDATE public.user_backup_codes
     SET used_at = now()
   WHERE user_id = v_actor
     AND code_hash = digest(upper(trim(p_code)), 'sha256')
     AND used_at IS NULL
   RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- Generischer Fail (kein Side-Channel ueber "Code falsch" vs.
    -- "Code schon benutzt").
    RAISE EXCEPTION 'code_invalid_or_used' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT count(*) INTO v_remaining
    FROM public.user_backup_codes
   WHERE user_id = v_actor AND used_at IS NULL;

  RETURN jsonb_build_object('consumed', true, 'remaining', v_remaining);
END $$;

GRANT EXECUTE ON FUNCTION public.consume_backup_code(text) TO authenticated;

-- 3) Status: nur Counts, kein Hash. Frontend zeigt "7 von 10 unbenutzt".
CREATE OR REPLACE FUNCTION public.backup_codes_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'total', count(*)::int,
    'remaining', count(*) FILTER (WHERE used_at IS NULL)::int,
    'used', count(*) FILTER (WHERE used_at IS NOT NULL)::int
  )
  FROM public.user_backup_codes
  WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.backup_codes_status() TO authenticated;

COMMENT ON TABLE public.user_backup_codes IS
  'Single-use Backup-Codes als TOTP-Fallback (B.2 Folge). 10 Codes pro User; Plain einmalig bei generate_backup_codes; nur sha256(code) at-rest.';
