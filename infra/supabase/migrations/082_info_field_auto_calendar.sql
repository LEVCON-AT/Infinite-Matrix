-- ═══════════════════════════════════════════════════════════════
-- Welle WV.E Item #37 — Auto-Calendar-Manifestation aus
-- info_field(value_type='date')
--
-- Konzept-Verankerung: widget-vorlagen-foundation.md §9.14
-- (Konzept-Pass 2026-05-08).
--
-- Was:
--   1. atom_type-CHECK-Update — 'info_field' zugelassen (Erweiterung
--      analog Migration 059 fuer 'imported_event'). Migration 072
--      hatte das Enum erweitert, den CHECK aber vergessen.
--   2. container_check-Update — kind='calendar' darf jetzt
--      container_id NOT NULL + container_kind='cell' haben (fuer
--      Auto-Mirror der info_field-Date in pro-Cell-Calendar-Slots).
--      Bestehender Standalone-Pfad (container_id NULL) bleibt.
--   3. UNIQUE partial index fuer Auto-Calendar-Mirror — eine Auto-
--      Manif pro (atom_type, atom_id, container_kind='cell',
--      container_id) damit T1-Re-Sync nicht duplikate erzeugt.
--   4. Trigger T1: info_fields AFTER UPDATE → re-sync alle
--      Auto-Manifs des Atoms (Value- oder Type-Wechsel).
--   5. Trigger T2: atom_manifestations AFTER INSERT (kind='info',
--      atom_type='info_field') → erzeuge Auto-Manif wenn info_field
--      value_type='date' und value parsable.
--   6. Trigger T3: atom_manifestations AFTER DELETE (kind='info',
--      atom_type='info_field') → loesche korrespondierende
--      Auto-Manif (gleicher cell_id, atom_id).
--   7. Backfill: pro existing info_field(value_type='date') × pro
--      existing atom_manifestations(kind='info', atom_type='info_field',
--      container_kind='cell') eine Auto-Manif erzeugen.
--
-- Schema-Heptad (siehe §9.14.5 + architektur.md §3):
--   - Schema:       diese Migration.
--   - Types:        n/a — display_meta.auto im JSONB.
--   - Mutations:    lib/atom-manifestations.ts — Manual-Delete-Block
--                   bei display_meta.auto=true.
--   - Cache:        n/a — Realtime deckt es ab.
--   - Realtime:     atom_manifestations ist im publication.
--   - Export:       Auto-Manifs werden mitexportiert; idempotenter
--                   Import dank UNIQUE partial index (re-creates
--                   beim ersten Trigger-Feuer wenn fehlt).
--   - MCP:          n/a — keine neue User-API (Read laeuft ueber
--                   bestehendes fetchAtomCalendarManifestations).
--
-- Apply:
--   docker exec matrix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f 082_info_field_auto_calendar.sql
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. atom_type-CHECK-Update ────────────────────────────────
-- info_field war seit Migration 072 im Enum, aber nicht im CHECK.
ALTER TABLE public.atom_manifestations
  DROP CONSTRAINT IF EXISTS atom_manifestations_atom_type_check;

ALTER TABLE public.atom_manifestations
  ADD CONSTRAINT atom_manifestations_atom_type_check
  CHECK (atom_type IN ('task','link','doc','checklist','imported_event','info_field'));

-- ─── 2. container_check-Update ────────────────────────────────
-- kind='calendar' bisher: container_id NULL, container_kind NULL.
-- Neu zusaetzlich: container_id NOT NULL + container_kind='cell' fuer
-- Auto-Mirror aus info_field. Standalone-Calendar-Manifestations
-- (Tasks/Links ohne Cell-Kontext) bleiben moeglich.
ALTER TABLE public.atom_manifestations
  DROP CONSTRAINT IF EXISTS atom_manifestations_container_check;

ALTER TABLE public.atom_manifestations
  ADD CONSTRAINT atom_manifestations_container_check
  CHECK (
    (kind IN ('kanban','checklist')
       AND container_id IS NOT NULL AND container_kind IS NULL)
    OR (kind = 'calendar'
       AND container_id IS NULL AND container_kind IS NULL)
    OR (kind = 'calendar'
       AND container_id IS NOT NULL AND container_kind = 'cell')
    OR (kind = 'standalone'
       AND container_id IS NULL AND container_kind IS NULL)
    OR (kind = 'pinned'
       AND container_id IS NOT NULL
       AND container_kind IN ('cell','atom','node'))
    OR (kind = 'info'
       AND container_id IS NOT NULL AND container_kind IN ('cell','atom','node'))
  );

-- ─── 3. UNIQUE partial index fuer Auto-Calendar-Mirror ────────
-- Trigger T1 nutzt UPSERT mit ON CONFLICT auf diesem Index. Ohne
-- den Index waeren mehrfache T1-Feuer (z.B. Bulk-Update) zum Race.
CREATE UNIQUE INDEX IF NOT EXISTS atom_manifestations_calendar_auto_unique
  ON public.atom_manifestations (atom_type, atom_id, container_kind, container_id)
  WHERE kind = 'calendar' AND (display_meta ->> 'auto')::boolean = true;

-- ─── 4. Trigger T1 — info_fields AFTER UPDATE ─────────────────
-- Re-sync der Auto-Manifs:
--   - value_type wechselt weg von 'date' → alle Auto-Manifs purgen.
--   - value parse-fail / NULL → alle Auto-Manifs purgen.
--   - value parsable → UPSERT pro existing kind='info'-Manif.
CREATE OR REPLACE FUNCTION public._info_field_auto_calendar_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_date date;
BEGIN
  -- value_type-Wechsel weg von 'date' → alle Auto-Manifs purgen.
  IF NEW.value_type <> 'date' THEN
    DELETE FROM public.atom_manifestations
    WHERE atom_type = 'info_field' AND atom_id = NEW.id
      AND kind = 'calendar' AND (display_meta ->> 'auto')::boolean = true;
    RETURN NEW;
  END IF;

  -- value-Parse. Bei NULL/leer/parse-fail → Auto-Manifs purgen.
  BEGIN
    v_date := NEW.value::date;
  EXCEPTION WHEN others THEN
    DELETE FROM public.atom_manifestations
    WHERE atom_type = 'info_field' AND atom_id = NEW.id
      AND kind = 'calendar' AND (display_meta ->> 'auto')::boolean = true;
    RETURN NEW;
  END;
  IF v_date IS NULL THEN
    DELETE FROM public.atom_manifestations
    WHERE atom_type = 'info_field' AND atom_id = NEW.id
      AND kind = 'calendar' AND (display_meta ->> 'auto')::boolean = true;
    RETURN NEW;
  END IF;

  -- UPSERT pro existing Cell-Info-Manifestation.
  -- start_date in display_meta — konsistent zur bestehenden Calendar-
  -- Manifestation-Konvention (siehe lib/calendar.ts buildEvents).
  -- auto:true Marker, source:'info_field' fuer UI-Diagnose.
  INSERT INTO public.atom_manifestations (
    atom_type, atom_id, workspace_id, kind, container_id, container_kind,
    position, level, display_meta
  )
  SELECT
    'info_field', NEW.id, m.workspace_id, 'calendar', m.container_id, 'cell',
    0, NULL,
    jsonb_build_object(
      'start_date', v_date::text,
      'end_date', v_date::text,
      'auto', true,
      'source', 'info_field',
      'label', NEW.label
    )
  FROM public.atom_manifestations m
  WHERE m.atom_type = 'info_field' AND m.atom_id = NEW.id
    AND m.kind = 'info' AND m.container_kind = 'cell'
  ON CONFLICT (atom_type, atom_id, container_kind, container_id)
  WHERE kind = 'calendar' AND (display_meta ->> 'auto')::boolean = true
  DO UPDATE SET display_meta = EXCLUDED.display_meta;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS info_fields_auto_calendar_sync ON public.info_fields;
CREATE TRIGGER info_fields_auto_calendar_sync
  AFTER UPDATE OF value, value_type, label ON public.info_fields
  FOR EACH ROW EXECUTE FUNCTION public._info_field_auto_calendar_sync();

-- ─── 5. Trigger T2 — info_manif AFTER INSERT ──────────────────
-- Wenn eine neue Cell-Info-Manifestation fuer ein info_field mit
-- value_type='date' angelegt wird, eine korrespondierende Auto-
-- Calendar-Manif erzeugen.
CREATE OR REPLACE FUNCTION public._atom_manif_auto_calendar_on_info_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_field public.info_fields%ROWTYPE;
  v_date date;
BEGIN
  -- Nur kind='info' + atom_type='info_field' + container_kind='cell'.
  IF NEW.kind <> 'info'
     OR NEW.atom_type <> 'info_field'
     OR NEW.container_kind <> 'cell' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_field FROM public.info_fields WHERE id = NEW.atom_id;
  IF NOT FOUND OR v_field.value_type <> 'date' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_date := v_field.value::date;
  EXCEPTION WHEN others THEN
    RETURN NEW;
  END;
  IF v_date IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.atom_manifestations (
    atom_type, atom_id, workspace_id, kind, container_id, container_kind,
    position, level, display_meta
  ) VALUES (
    'info_field', v_field.id, NEW.workspace_id, 'calendar', NEW.container_id, 'cell',
    0, NULL,
    jsonb_build_object(
      'start_date', v_date::text,
      'end_date', v_date::text,
      'auto', true,
      'source', 'info_field',
      'label', v_field.label
    )
  )
  ON CONFLICT (atom_type, atom_id, container_kind, container_id)
  WHERE kind = 'calendar' AND (display_meta ->> 'auto')::boolean = true
  DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS atom_manif_auto_calendar_on_info_insert ON public.atom_manifestations;
CREATE TRIGGER atom_manif_auto_calendar_on_info_insert
  AFTER INSERT ON public.atom_manifestations
  FOR EACH ROW EXECUTE FUNCTION public._atom_manif_auto_calendar_on_info_insert();

-- ─── 6. Trigger T3 — info_manif AFTER DELETE ──────────────────
-- Wenn eine Cell-Info-Manifestation entfernt wird, korrespondierende
-- Auto-Calendar-Manif loeschen (gleicher cell_id, atom_id).
CREATE OR REPLACE FUNCTION public._atom_manif_auto_calendar_on_info_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind <> 'info'
     OR OLD.atom_type <> 'info_field'
     OR OLD.container_kind <> 'cell' THEN
    RETURN OLD;
  END IF;

  DELETE FROM public.atom_manifestations
  WHERE atom_type = 'info_field' AND atom_id = OLD.atom_id
    AND kind = 'calendar'
    AND container_kind = 'cell' AND container_id = OLD.container_id
    AND (display_meta ->> 'auto')::boolean = true;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS atom_manif_auto_calendar_on_info_delete ON public.atom_manifestations;
CREATE TRIGGER atom_manif_auto_calendar_on_info_delete
  AFTER DELETE ON public.atom_manifestations
  FOR EACH ROW EXECUTE FUNCTION public._atom_manif_auto_calendar_on_info_delete();

-- ─── 7. Backfill ──────────────────────────────────────────────
-- Fuer alle existing info_fields mit value_type='date' + parsbarem
-- Datum × alle existing kind='info'-Manifs (container_kind='cell')
-- eine Auto-Calendar-Manif erzeugen. ON CONFLICT skippt Duplikate.
INSERT INTO public.atom_manifestations (
  atom_type, atom_id, workspace_id, kind, container_id, container_kind,
  position, level, display_meta
)
SELECT
  'info_field',
  f.id,
  m.workspace_id,
  'calendar',
  m.container_id,
  'cell',
  0,
  NULL,
  jsonb_build_object(
    'start_date', f.value,
    'end_date', f.value,
    'auto', true,
    'source', 'info_field',
    'label', f.label
  )
FROM public.info_fields f
JOIN public.atom_manifestations m
  ON m.atom_type = 'info_field' AND m.atom_id = f.id
  AND m.kind = 'info' AND m.container_kind = 'cell'
WHERE f.value_type = 'date'
  AND f.value IS NOT NULL
  AND f.value <> ''
  AND f.value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
ON CONFLICT (atom_type, atom_id, container_kind, container_id)
WHERE kind = 'calendar' AND (display_meta ->> 'auto')::boolean = true
DO NOTHING;

COMMIT;

-- Smoke-Verifikation:
--   SELECT count(*) FROM atom_manifestations
--    WHERE atom_type='info_field' AND kind='calendar'
--      AND (display_meta->>'auto')::boolean = true;
--   -- Match-zaehler zu info_fields(value_type='date') × info-Manifs.
COMMENT ON INDEX public.atom_manifestations_calendar_auto_unique IS
  'WV.E #37 — UNIQUE pro (atom, container) fuer Auto-Calendar-Manifs aus info_field(value_type=date). Trigger _info_field_auto_calendar_sync nutzt ON CONFLICT.';
