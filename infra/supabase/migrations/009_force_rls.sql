-- ═══════════════════════════════════════════════════════════════
-- Phase 0g.3 / ASVS V4.1 — FORCE ROW LEVEL SECURITY
--
-- ENABLE ROW LEVEL SECURITY (Migration 002) reicht NICHT, um den
-- Tabelleneigentuemer (in Supabase: postgres-User, von dem Migrations
-- + service_role abgeleitet werden) an die Policies zu binden. Ohne
-- FORCE darf der Owner alle Rows lesen/schreiben — was strukturell
-- gewollt ist (Migrations, Bridge mit service_role-Key), aber als
-- impliziter Pfad ein Defense-in-Depth-Risiko ist:
--
--   - Wenn jemals eine zusaetzliche DB-Rolle mit BYPASSRLS angelegt
--     wird (Backup-User, Reporting-Tool), greift die Policy nicht.
--   - Wenn der Bridge-Code versehentlich einen Workspace-Filter
--     vergisst und mit service_role schreibt, gibt es keinen DB-
--     seitigen Backstop.
--
-- FORCE ROW LEVEL SECURITY zwingt die Policies AUCH auf den Tabellen-
-- eigentuemer. Migrations + service_role-Operationen mit explizitem
-- workspace-Filter funktionieren weiter; nur das "implicit-everyone"-
-- Verhalten faellt weg.
--
-- Idempotent: ALTER TABLE ... FORCE ist re-runnable.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'workspaces',
    'memberships',
    'nodes',
    'cells',
    'rows',
    'cols',
    'kb_cols',
    'kb_cards',
    'checklists',
    'checklist_items',
    'links',
    'docs',
    'audit_log'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Pruefen ob die Tabelle ueberhaupt existiert (audit_log ist
    -- optional in alten Setups). Wenn nein: skip ohne Fehler.
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'public' AND c.relname = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
    END IF;
  END LOOP;
END $$;
