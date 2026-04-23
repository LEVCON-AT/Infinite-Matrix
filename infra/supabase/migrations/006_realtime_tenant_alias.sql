-- ═══════════════════════════════════════════════════════════════
-- Phase 0e.2 — Realtime-Tenant-Alias fuer Docker-Service-Hostname
--
-- Problem: supabase-realtime v2.34.47 extrahiert die Tenant-ID aus
-- dem `Host`-Header der eingehenden WS-Verbindung. Kong forwardet
-- an `http://realtime:4000` — der Tenant wird zu "realtime".
-- SEED_SELF_HOST legt beim ersten Boot aber den Tenant "realtime-dev"
-- an (Default), was zu "TenantNotFound: realtime" fuehrt und
-- Kong mit HTTP 403 antwortet.
--
-- Fix: dupliziere den "realtime-dev"-Tenant 1:1 als "realtime".
-- Gleiches jwt_secret, gleiche Limits, gleiche Postgres-CDC-Config.
-- Idempotent (ON CONFLICT DO NOTHING), damit Re-Deploys nichts
-- zerbrechen.
--
-- Alternative (verworfen): APP_NAME in docker-compose aendern oder
-- Kong's request-transformer nutzen — beide koppeln den Fix an
-- Compose/Kong-Config und waeren bei Supabase-Updates fragiler als
-- ein DB-Level-Alias.
-- ═══════════════════════════════════════════════════════════════

-- 1. Tenant "realtime" als Kopie von "realtime-dev".
--    Nur anlegen wenn realtime-dev existiert (SEED_SELF_HOST muss
--    schon gelaufen sein) und realtime noch nicht.
INSERT INTO _realtime.tenants (
  id, name, external_id, jwt_secret,
  max_concurrent_users, inserted_at, updated_at,
  max_events_per_second, postgres_cdc_default,
  max_bytes_per_second, max_channels_per_client, max_joins_per_second,
  suspend, jwt_jwks, notify_private_alpha, private_only
)
SELECT
  gen_random_uuid(), 'realtime', 'realtime', jwt_secret,
  max_concurrent_users, now(), now(),
  max_events_per_second, postgres_cdc_default,
  max_bytes_per_second, max_channels_per_client, max_joins_per_second,
  suspend, jwt_jwks, notify_private_alpha, private_only
FROM _realtime.tenants
WHERE external_id = 'realtime-dev'
ON CONFLICT (external_id) DO NOTHING;

-- 2. Extensions (postgres_cdc_rls) fuer den neuen Tenant duplizieren.
--    Ohne diese Zeile laeuft Realtime zwar, broadcastet aber keine
--    Postgres-CDC-Events.
INSERT INTO _realtime.extensions (
  id, type, settings, tenant_external_id, inserted_at, updated_at
)
SELECT
  gen_random_uuid(), src.type, src.settings, 'realtime', now(), now()
FROM _realtime.extensions AS src
WHERE src.tenant_external_id = 'realtime-dev'
  AND NOT EXISTS (
    SELECT 1 FROM _realtime.extensions AS dst
    WHERE dst.tenant_external_id = 'realtime'
      AND dst.type = src.type
  );
