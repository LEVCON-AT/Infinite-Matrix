-- ═══════════════════════════════════════════════════════════════
-- Phase 4 T.AC.A.5 — atom_manifestations in supabase_realtime
--
-- Migration 044 hat die atom_manifestations-Tabelle angelegt, aber
-- nicht in die supabase_realtime-Publication eingetragen. Damit
-- bekommen Clients keine postgres_changes-Events fuer Inserts/Updates/
-- Deletes auf der Tabelle — Link-/Checklist-Drops in einem zweiten Tab
-- erscheinen erst nach Refetch (Page-Reload, Tab-Switch).
--
-- Pattern wie Migration 005 / 007: Existenz-Check + ADD TABLE + REPLICA
-- IDENTITY FULL (DELETE-Events brauchen workspace_id im old-Payload
-- damit der Channel-Filter greift).
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- 1. Tabelle zur supabase_realtime-Publication hinzufuegen, falls
  --    noch nicht drin. ALTER ADD TABLE wirft auf bereits-eingetragene
  --    Tabellen — daher der Existenz-Check.
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'atom_manifestations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.atom_manifestations;
  END IF;
END $$;

-- 2. REPLICA IDENTITY FULL: DELETE-Payload muss workspace_id tragen,
--    sonst greift der Realtime-Filter (workspace_id=eq.X) nicht und
--    der Client bekommt keine DELETE-Events.
ALTER TABLE public.atom_manifestations REPLICA IDENTITY FULL;

-- ─── Smoke (manuell nach Apply) ─────────────────────────────────
-- 1. SELECT relreplident FROM pg_class WHERE relname='atom_manifestations';
--    -- erwartet 'f' (FULL).
-- 2. SELECT * FROM pg_publication_tables WHERE tablename='atom_manifestations';
--    -- erwartet 1 Zeile, pubname='supabase_realtime'.
-- 3. Im Client einen Link auf einen Calendar-Tag droppen → Tab 2 sollte
--    den Event ohne Reload sehen.
