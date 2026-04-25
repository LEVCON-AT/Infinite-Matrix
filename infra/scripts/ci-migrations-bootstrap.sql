-- ═══════════════════════════════════════════════════════════════
-- CI-Bootstrap fuer Migrations-Smoke gegen plain Postgres-Service
--
-- Die Live-DB ist Supabase (postgres-image mit auth-Schema, _realtime-
-- Schema, anon/authenticated/service_role-Rollen — alles vom Container
-- geliefert). In CI laeuft ein nackter postgres:15 — wir muessen die
-- Schema-/Rollen-Grundlage nachbauen, sonst scheitern die Migrations
-- am ersten REFERENCES auth.users(id) oder INSERT INTO _realtime.*.
--
-- Nur Stubs: leere Tabellen mit den noetigen Spalten, damit FK-Targets
-- und FROM-Ziele aufloesbar sind. Reicht fuer Idempotenz-Smoke; das
-- echte Schema-Verhalten wird im Live-Postgres in production verifiziert.
-- ═══════════════════════════════════════════════════════════════

-- pgcrypto fuer gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Supabase-Rollen ────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'ci';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin SUPERUSER LOGIN PASSWORD 'ci';
  END IF;
END
$$;

-- ─── auth-Schema mit users-Stub ─────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text,
  raw_user_meta_data jsonb,
  created_at   timestamptz DEFAULT now()
);

-- auth.uid() / auth.jwt() — Stubs, geben NULL zurueck. Reicht zum
-- Migration-Parsen; RLS-Policies werten zur Migration-Zeit nicht aus.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('request.jwt.claims', true)::jsonb, '{}'::jsonb)
$$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(current_setting('request.jwt.claim.email', true), '')
$$;

-- ─── _realtime-Schema mit tenants/extensions-Stubs ──────────
-- Echte Spalten-Liste aus realtime-v2.34.x — sonst koennen die INSERTs
-- in 006_realtime_tenant_alias.sql nicht parsen.
CREATE SCHEMA IF NOT EXISTS _realtime;

CREATE TABLE IF NOT EXISTS _realtime.tenants (
  id                       uuid PRIMARY KEY,
  name                     text,
  external_id              text UNIQUE,
  jwt_secret               text,
  max_concurrent_users     int  DEFAULT 200,
  inserted_at              timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),
  max_events_per_second    int  DEFAULT 100,
  postgres_cdc_default     text DEFAULT 'postgres_cdc_rls',
  max_bytes_per_second     int  DEFAULT 100000,
  max_channels_per_client  int  DEFAULT 100,
  max_joins_per_second     int  DEFAULT 500,
  suspend                  bool DEFAULT false,
  jwt_jwks                 jsonb,
  notify_private_alpha     bool DEFAULT false,
  private_only             bool DEFAULT false
);

CREATE TABLE IF NOT EXISTS _realtime.extensions (
  id                  uuid PRIMARY KEY,
  type                text,
  settings            jsonb DEFAULT '{}'::jsonb,
  tenant_external_id  text REFERENCES _realtime.tenants(external_id) ON DELETE CASCADE,
  inserted_at         timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Seed: realtime-dev-Tenant simulieren, damit 006 nicht 0 rows
-- liefert (dann waere Idempotenz-Test auf re-INSERT ohne Wert).
INSERT INTO _realtime.tenants (
  id, name, external_id, jwt_secret, jwt_jwks
) VALUES (
  gen_random_uuid(), 'realtime-dev', 'realtime-dev', 'ci-secret', '{}'::jsonb
) ON CONFLICT (external_id) DO NOTHING;

INSERT INTO _realtime.extensions (
  id, type, settings, tenant_external_id
) VALUES (
  gen_random_uuid(), 'postgres_cdc_rls', '{}'::jsonb, 'realtime-dev'
) ON CONFLICT DO NOTHING;
