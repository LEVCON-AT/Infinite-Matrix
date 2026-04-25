-- ═══════════════════════════════════════════════════════════════
-- Phase 0e.2 — Realtime-Publication fuer Zwei-Tab-Sync
--
-- Supabase-Realtime broadcastet INSERT/UPDATE/DELETE nur fuer
-- Tabellen, die in der Publication `supabase_realtime` eingetragen
-- sind. Bei self-hosted Supabase ist diese Publication leer beim
-- Setup — wir fuegen unsere 9 Matrix-Tabellen hinzu.
--
-- REPLICA IDENTITY FULL:
--   Default (DEFAULT) broadcastet bei DELETE nur die Primary-Key-
--   Spalten. Fuer Client-Filter `workspace_id=eq.<id>` brauchen
--   wir die workspace_id auch im Delete-Payload — also FULL, das
--   die komplette alte Row im WAL fuehrt.
--   Overhead: etwas mehr WAL pro DELETE/UPDATE. Fuer unsere
--   Datenmengen (Checklisten, Cells) irrelevant.
--
-- Idempotent: DROP PUBLICATION + CREATE EMPTY + ALTER ADD.
--   Alternativ ALTER ADD TABLE IF NOT EXISTS — PG unterstuetzt das
--   nicht direkt; der DO-Block unten ist der uebliche Workaround.
-- ═══════════════════════════════════════════════════════════════

-- 1. Publication anlegen falls nicht vorhanden (Supabase-Standard-
--    Setup legt sie leer an, aber wir sind paranoid).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

-- 2. Tabellen zur Publication hinzufuegen. ALTER ADD TABLE wirft
--    Fehler wenn Tabelle schon drin — daher pro Tabelle einzeln
--    in pg_publication_tables pruefen.
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'nodes','cells','rows','cols',
    'kb_cols','kb_cards',
    'checklists','checklist_items',
    'links'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
    END IF;
  END LOOP;
END $$;

-- 3. REPLICA IDENTITY FULL pro Tabelle, damit DELETE-Events die
--    komplette alte Row inkl. workspace_id broadcasten.
--    ALTER TABLE ... REPLICA IDENTITY FULL ist re-runnable (PG
--    akzeptiert mehrfaches Setzen); der DO-Block ist hier rein zur
--    Konsistenz mit dem Idempotenz-Pattern der anderen Sektionen
--    oben.
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'nodes','cells','rows','cols',
    'kb_cols','kb_cards',
    'checklists','checklist_items',
    'links'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', tbl);
  END LOOP;
END $$;
