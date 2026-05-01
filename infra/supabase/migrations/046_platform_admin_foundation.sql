-- ═══════════════════════════════════════════════════════════════
-- Phase B Welle B.0.A — Platform-Admin-Foundation
--
-- Voraussetzung fuer SSO (B.1) / MFA (B.2) / Step-Up (B.3) / Audit
-- (B.4) / Sessions (B.5). Alle externen Provider-Configs (Google /
-- GitHub / LinkedIn / Microsoft Client-IDs+Secrets, SMTP-Settings,
-- Magic-Link-Templates) leben hier — KEIN Out-of-Band-ENV-Setup.
--
-- Memory-Regel: "Externe Provider/Configs gehoeren in Admin-Dashboard-
-- Konfigmaske, kein Out-of-Band-ENV-Setup. Features bleiben aus-
-- geblendet/ausgegraut bis Konfig 100% korrekt + verifiziert."
--
-- Schema:
--   platform_admins    — Liste der User mit Plattform-Admin-Rolle.
--                        Keine Workspace-Bindung — orthogonal zu
--                        workspace_members.role. Erster Admin wird
--                        manuell per SQL provisioniert (deployer task).
--   system_config       — generischer Key-Value-Store (jsonb). Keys
--                        sind dotted (`auth.providers.google`,
--                        `smtp.host`, ...). description ist UI-Hinweis.
--                        Read+Write nur platform_admins via RPC.
--
-- RLS:
--   platform_admins: SELECT fuer alle platform_admins (auch self);
--                    INSERT/UPDATE/DELETE NUR via service_role
--                    (keine direkte User-Manipulation; Anlage neuer
--                    Admins per Admin-Dashboard via SECURITY DEFINER
--                    RPC).
--   system_config: SELECT/UPSERT NUR via SECURITY DEFINER RPCs
--                  (get/set/list). Direkte SELECT-Policy bleibt
--                  service_role-only — RPCs prufen is_platform_admin().
-- ═══════════════════════════════════════════════════════════════

-- ─── Tabelle: platform_admins ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note        text
);

COMMENT ON TABLE public.platform_admins IS
  'Phase B B.0.A — Plattform-Admins. Orthogonal zu workspace_members.role. Lesen/Schreiben nur ueber RPCs.';

-- ─── Tabelle: system_config ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_config (
  key          text PRIMARY KEY,
  value        jsonb NOT NULL DEFAULT '{}'::jsonb,
  description  text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.system_config IS
  'Phase B B.0.A — Plattform-Konfig (SSO-Provider, SMTP, etc.). Keys dotted (auth.providers.google). Zugriff nur via RPCs.';

-- ─── RLS aktivieren (FORCE — Pattern aus 037) ──────────────────
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins FORCE ROW LEVEL SECURITY;
ALTER TABLE public.system_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config   FORCE ROW LEVEL SECURITY;

-- ─── is_platform_admin: Predicate-Helper ───────────────────────
-- STABLE damit RLS-Policies ohne Performance-Penalty re-using koennen.
-- SECURITY DEFINER damit auth.uid()-Lookup gegen platform_admins
-- unabhaengig von Caller-Permissions laeuft.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
     WHERE user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

COMMENT ON FUNCTION public.is_platform_admin IS
  'Phase B B.0.A — Predicate fuer Plattform-Admin-Auth. Aus Frontend via supabase.rpc + im Admin-Dashboard-Route-Guard.';

-- ─── RLS-Policies ─────────────────────────────────────────────
-- platform_admins: SELECT fuer Admins (incl. self). Andere DML-Pfade
-- sind nur via service_role oder via grant_platform_admin-RPC erreichbar
-- (in B.0.B mit Step-Up).
DROP POLICY IF EXISTS platform_admins_select ON public.platform_admins;
CREATE POLICY platform_admins_select ON public.platform_admins
  FOR SELECT USING (public.is_platform_admin());

-- system_config: gar keine Direct-Policy fuer authenticated. Reads
-- gehen ausschliesslich ueber get/list-RPCs (Owner-only Lesepfad
-- jetzt nicht; spaeter via separate "public-readable"-Keys).
-- service_role bypasst RLS sowieso fuer Bootstrap.

-- ─── RPCs: Read ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_system_config(p_key text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN (SELECT value FROM public.system_config WHERE key = p_key);
END $$;

GRANT EXECUTE ON FUNCTION public.get_system_config(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_system_config()
RETURNS TABLE (
  key text,
  value jsonb,
  description text,
  updated_at timestamptz,
  updated_by uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT c.key, c.value, c.description, c.updated_at, c.updated_by
      FROM public.system_config c
     ORDER BY c.key;
END $$;

GRANT EXECUTE ON FUNCTION public.list_system_config() TO authenticated;

-- ─── RPCs: Write ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_system_config(
  p_key         text,
  p_value       jsonb,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RAISE EXCEPTION 'key_required' USING ERRCODE = 'check_violation';
  END IF;
  -- Key-Format-Hinweis: dotted lowercase. Nicht hart erzwungen damit
  -- spaeter z.B. URL-Templates flexibel sind.
  INSERT INTO public.system_config (key, value, description, updated_at, updated_by)
  VALUES (p_key, COALESCE(p_value, '{}'::jsonb), p_description, now(), auth.uid())
  ON CONFLICT (key) DO UPDATE
    SET value       = EXCLUDED.value,
        description = COALESCE(EXCLUDED.description, public.system_config.description),
        updated_at  = now(),
        updated_by  = auth.uid();
  RETURN (SELECT value FROM public.system_config WHERE key = p_key);
END $$;

GRANT EXECUTE ON FUNCTION public.set_system_config(text, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_system_config(p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM public.system_config WHERE key = p_key;
END $$;

GRANT EXECUTE ON FUNCTION public.delete_system_config(text) TO authenticated;

-- ─── RPC: list_platform_admins (admin-only Self-Lookup) ────────
-- Auth-Page gates auf is_platform_admin() — der Admin-Dashboard
-- darf zeigen wer sonst Admin ist (auditierbar, transparent).
CREATE OR REPLACE FUNCTION public.list_platform_admins()
RETURNS TABLE (
  user_id    uuid,
  email      text,
  granted_at timestamptz,
  granted_by uuid,
  note       text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT pa.user_id, u.email::text, pa.granted_at, pa.granted_by, pa.note
      FROM public.platform_admins pa
      JOIN auth.users u ON u.id = pa.user_id
     ORDER BY pa.granted_at;
END $$;

GRANT EXECUTE ON FUNCTION public.list_platform_admins() TO authenticated;

-- ─── RPCs: Admin-Provisioning (Step-Up wird in B.3 ergaenzt) ────
-- grant_platform_admin: existierender Admin promotet einen anderen
-- User. Bootstrapping-Hinweis: der ALLERERSTE Admin wird via SQL
-- als service_role provisioniert (kein User darf sich selbst zum
-- Admin promoten).
CREATE OR REPLACE FUNCTION public.grant_platform_admin(
  p_user_id uuid,
  p_note    text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id_required' USING ERRCODE = 'check_violation';
  END IF;
  -- Idempotent: doppel-grant ueberschreibt Note + granted_by.
  INSERT INTO public.platform_admins (user_id, granted_at, granted_by, note)
  VALUES (p_user_id, now(), auth.uid(), p_note)
  ON CONFLICT (user_id) DO UPDATE
    SET granted_at = now(),
        granted_by = auth.uid(),
        note       = COALESCE(EXCLUDED.note, public.platform_admins.note);
END $$;

GRANT EXECUTE ON FUNCTION public.grant_platform_admin(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_platform_admin(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_count int;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id_required' USING ERRCODE = 'check_violation';
  END IF;
  -- Schutz: niemand darf den letzten Admin entfernen — sonst kein
  -- Weg zurueck ohne service_role-SQL.
  SELECT count(*) INTO v_count FROM public.platform_admins;
  IF v_count <= 1 THEN
    RAISE EXCEPTION 'last_admin_protected' USING
      ERRCODE = 'check_violation',
      HINT = 'Der letzte Plattform-Admin kann nicht entfernt werden.';
  END IF;
  -- Selbst-Revoke ist OK aber nur wenn nicht-letzter (oben gesperrt).
  DELETE FROM public.platform_admins WHERE user_id = p_user_id;
END $$;

GRANT EXECUTE ON FUNCTION public.revoke_platform_admin(uuid) TO authenticated;

-- ─── system_audit_log: Read fuer platform_admins ───────────────
-- Migration 039 hat den Read-Pfad explizit auf Phase B verschoben.
-- Jetzt aktivieren: platform_admins koennen audit_log lesen.
DROP POLICY IF EXISTS system_audit_log_select_admin ON public.system_audit_log;
CREATE POLICY system_audit_log_select_admin ON public.system_audit_log
  FOR SELECT USING (public.is_platform_admin());

-- ─── Smoke-Verifikation (manuell nach Apply) ─────────────────
-- 1. SELECT count(*) FROM public.platform_admins; -- 0 (kein Bootstrap-Admin)
-- 2. SELECT public.is_platform_admin();           -- false als anonymer User
-- 3. service_role-Bootstrap (Deployer-Action):
--      INSERT INTO public.platform_admins (user_id, granted_by, note)
--        VALUES ('<UUID>', NULL, 'Initial admin');
-- 4. Aus dem Frontend SELECT public.is_platform_admin() → true
-- 5. SELECT public.list_system_config(); -- empty rows (no config yet)
-- 6. SELECT public.set_system_config('test.key', '{"hello":"world"}'::jsonb, 'Smoke');
-- 7. SELECT public.get_system_config('test.key'); -- {"hello":"world"}
-- 8. SELECT public.delete_system_config('test.key');
