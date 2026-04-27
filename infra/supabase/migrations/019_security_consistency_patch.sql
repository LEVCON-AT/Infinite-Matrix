-- ═══════════════════════════════════════════════════════════════
-- Phase 2 Polish-Welle 1 — RLS+RPC-Konsistenz-Sweep
--
-- Audit (docs/audit/B0-rls-rpc-sweep.md, 2026-04-28) hat den Stack auf
-- 4 Kriterien gepeilt:
--   - Tabellen mit ENABLE+FORCE RLS + alle CRUD-Policies
--   - SECURITY DEFINER-RPCs mit search_path + auth.uid()-Check + GRANT
--   - Backwards-Compat-Drift bei alten Migrationen
--   - Realtime-Publication-Drift
--
-- Ergebnis: ueberraschend sauber. Nur 2 defensive Mini-Defizite:
--   1) `urlsafe_b64encode(bytea)` in 011 ohne SET search_path
--   2) `_ai_master_key()` in 018 ohne SET search_path
--
-- Kein kritisches Loch — nur Konsistenz-Patch fuer Defense-in-Depth
-- gegen Schema-Hijacking. Schema-Hijack-Pfad waere: ein Angreifer mit
-- WRITE-Recht auf eine eigene `<userschema>.encode()` koennte bei
-- search_path-Drift die SECURITY DEFINER-Funktion gegen sich umlenken.
-- Mit Service-Role-Backend praktisch nicht relevant, aber Standard-
-- Praxis bei SECURITY DEFINER ist explicit search_path.
--
-- CREATE OR REPLACE haelt Body identisch — nur das FUNCTION-Header
-- bekommt `SET search_path`. Idempotent.
-- ═══════════════════════════════════════════════════════════════

-- 1) urlsafe_b64encode: search_path nachtragen.
--    Body unveraendert: encoded base64 mit +/=\n auf -_'' getranslatet.
CREATE OR REPLACE FUNCTION public.urlsafe_b64encode(p_bytes bytea)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
SET search_path = public, extensions
AS $$
  SELECT translate(encode(p_bytes, 'base64'), E'+/=\n', '-_');
$$;

-- 2) _ai_master_key: search_path nachtragen.
--    Body unveraendert: liest GUC + raised wenn fehlt/zu kurz.
CREATE OR REPLACE FUNCTION public._ai_master_key()
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE k text;
BEGIN
  k := current_setting('app.ai_master_key', true);
  IF k IS NULL OR length(k) < 16 THEN
    RAISE EXCEPTION 'ai_master_key_missing'
      USING HINT = 'Postgres-GUC app.ai_master_key muss gesetzt sein (siehe docs/claude/architektur.md).';
  END IF;
  RETURN k;
END $$;
