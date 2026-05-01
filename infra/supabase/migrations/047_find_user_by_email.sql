-- ═══════════════════════════════════════════════════════════════
-- Phase B Welle B.0.D — find_user_id_by_email (admin-only Helper)
--
-- Im Admin-Dashboard "Plattform-Admins"-Sektion soll der Admin neue
-- Admins per E-Mail-Adresse hinzufuegen koennen (statt UUID zu pasten).
-- auth.users ist fuer authenticated normal NICHT lesbar — daher braucht's
-- einen SECURITY DEFINER RPC, der is_platform_admin() prueft.
--
-- Returns NULL wenn kein User mit dieser Email existiert (frontend
-- entscheidet ob Toast oder confirm "User existiert nicht — Einladung
-- senden?" — letzteres kommt mit B.1.X Invitation-Flow).
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.find_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN NULL;
  END IF;
  -- auth.users.email ist case-insensitive, aber Vorsicht mit Trim.
  SELECT id INTO v_id FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;
  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.find_user_id_by_email(text) TO authenticated;

COMMENT ON FUNCTION public.find_user_id_by_email IS
  'Phase B B.0.D — admin-only Lookup auth.users.email → id. Returns NULL wenn nicht gefunden.';
