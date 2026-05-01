-- ═══════════════════════════════════════════════════════════════
-- Welle B B.0/B.1 Folge — Public-Read fuer Provider-Status auf Login
--
-- Login-Page muss VOR Auth wissen, welche SSO-Provider aktiviert sind,
-- um die passenden Buttons zu rendern. system_config ist admin-only
-- per RLS — wir exposen einen schmalen anon-callable RPC der nur
-- Provider-Keys + enabled-Bit zurueckgibt, KEINE Secrets.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_enabled_auth_providers()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cfg AS (
    SELECT key,
           COALESCE((value ->> 'enabled')::boolean, false) AS enabled
      FROM public.system_config
     WHERE key IN ('auth.providers.google', 'auth.providers.microsoft')
  )
  SELECT jsonb_build_object(
    'google',     COALESCE((SELECT enabled FROM cfg WHERE key = 'auth.providers.google'),     false),
    'microsoft',  COALESCE((SELECT enabled FROM cfg WHERE key = 'auth.providers.microsoft'),  false)
  );
$$;

-- Anon + authenticated duerfen lesen — Login-Page laeuft anon, der
-- Rest authentifiziert.
GRANT EXECUTE ON FUNCTION public.get_enabled_auth_providers() TO anon, authenticated;

COMMENT ON FUNCTION public.get_enabled_auth_providers() IS
  'Public-Read fuer Login-Page: welche SSO-Provider sind aktiv? Liefert nur enabled-Booleans, KEINE Secrets.';
