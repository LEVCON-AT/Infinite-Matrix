-- ═══════════════════════════════════════════════════════════════
-- Supabase-Rollen-Setup — laeuft beim ersten DB-Init.
-- Verwendet psql-Meta-Commands (\set + `echo`) um ENV-Vars einzuspielen.
-- ═══════════════════════════════════════════════════════════════

\set pgpass `echo "$POSTGRES_PASSWORD"`
\set jwt_secret `echo "$JWT_SECRET"`
\set jwt_exp `echo "$JWT_EXP"`

-- Supabase super-admin Passwort setzen
ALTER USER supabase_admin WITH PASSWORD :'pgpass' VALID UNTIL 'infinity';

-- Authenticator (PostgREST wechselt von hier auf anon/authenticated/service_role)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN;
  END IF;
END
$$;
ALTER USER authenticator WITH NOINHERIT LOGIN PASSWORD :'pgpass' VALID UNTIL 'infinity';

-- GoTrue-Rolle
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin NOINHERIT CREATEROLE LOGIN;
  END IF;
END
$$;
ALTER USER supabase_auth_admin WITH NOINHERIT CREATEROLE LOGIN PASSWORD :'pgpass' VALID UNTIL 'infinity';

-- Storage-Rolle (fuer spaeter)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    CREATE ROLE supabase_storage_admin NOINHERIT CREATEROLE LOGIN;
  END IF;
END
$$;
ALTER USER supabase_storage_admin WITH NOINHERIT CREATEROLE LOGIN PASSWORD :'pgpass' VALID UNTIL 'infinity';

-- Anon/Authenticated/Service-Role — das Supabase-Image sollte die schon anlegen,
-- wir stellen sicher dass die Beziehungen passen.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END
$$;

GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;

-- JWT-Einstellungen (fuer auth.jwt() und Policies)
ALTER DATABASE postgres SET "app.settings.jwt_secret" TO :'jwt_secret';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
