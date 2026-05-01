-- ═══════════════════════════════════════════════════════════════
-- Welle B B.1.A Folge — public-Read auf 4 SSO-Provider erweitert
--
-- 052 hatte nur google + microsoft. Hier kommen github + linkedin
-- dazu. Same Pattern: SECURITY DEFINER, anon+authenticated-callable,
-- liefert nur enabled-Booleans, KEINE Secrets.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_enabled_auth_providers()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH cfg AS (
    SELECT key,
           COALESCE((value ->> 'enabled')::boolean, false) AS enabled
      FROM public.system_config
     WHERE key IN (
       'auth.providers.google',
       'auth.providers.microsoft',
       'auth.providers.github',
       'auth.providers.linkedin'
     )
  )
  SELECT jsonb_build_object(
    'google',    COALESCE((SELECT enabled FROM cfg WHERE key = 'auth.providers.google'),    false),
    'microsoft', COALESCE((SELECT enabled FROM cfg WHERE key = 'auth.providers.microsoft'), false),
    'github',    COALESCE((SELECT enabled FROM cfg WHERE key = 'auth.providers.github'),    false),
    'linkedin',  COALESCE((SELECT enabled FROM cfg WHERE key = 'auth.providers.linkedin'),  false)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_enabled_auth_providers() TO anon, authenticated;
