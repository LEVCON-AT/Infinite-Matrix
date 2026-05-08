-- ═══════════════════════════════════════════════════════════════
-- WV.B.1 — info_fields-Atom + atom_type-ENUM-Erweiterung
--
-- Konzept-Verankerung: §12 (typed Field-Types), §15.1-A info_fields.
--
-- Was:
--   1. ALTER TYPE atom_type ADD VALUE 'info_field' (6. Atom-Typ).
--   2. ALTER TYPE atom_manifestation_kind ADD VALUE 'info' (Cell-Info-
--      Section-Manifestation, anstatt cell.data.infoFields-jsonb).
--   3. CREATE TABLE info_fields mit value_type CHECK (10 Werte aus §12.1).
--   4. CREATE TRIGGER cascade — info_fields-DELETE → atom_manifestations
--      purge (analog tasks-Trigger Migration 044).
--
-- Schema-Heptad pro info_fields (siehe `architektur.md` §3):
--   - Schema:       diese Migration.
--   - Types:        lib/types.ts — InfoFieldRow, InfoFieldValueType.
--   - Mutations:    lib/info-fields.ts — CRUD pro Field.
--   - Cache:        offline-cache.ts — TABLES + DB_VERSION-Bump.
--   - Realtime:     direct table.
--   - Export:       export.ts + subtree-import.ts — workspace + cell-Pfad.
--   - MCP:          packages/bridge/src/tools/info-fields.ts neu.
--   - Channel-Bridge: n/a — Strukturdaten.
--
-- Apply:
--   docker exec matrix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f 072_info_fields.sql
--
-- ENUM-Erweiterung erfordert supabase_admin-Rechte. Bei Postgres-User-
-- Apply: ALTER TYPE faellt durch und Migration steht — User muss
-- interaktiv mit supabase_admin nachziehen.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── ENUM-Erweiterungen ──────────────────────────────────────
-- ALTER TYPE ADD VALUE muss ausserhalb einer Transaktion stehen, oder
-- wir splitten — Postgres erlaubt es seit V12 in Transaktionen wenn
-- der neue Wert nicht in derselben TX verwendet wird. Wir nutzen ihn
-- erst in der info_fields-Tabelle (atom_type-Spalten kommen erst spaeter
-- im Trigger), daher TX-safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'atom_type')
      AND enumlabel = 'info_field'
  ) THEN
    ALTER TYPE public.atom_type ADD VALUE 'info_field';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'atom_manifestation_kind')
      AND enumlabel = 'info'
  ) THEN
    ALTER TYPE public.atom_manifestation_kind ADD VALUE 'info';
  END IF;
END $$;

COMMIT;

-- Zweites BEGIN: ALTER TYPE ADD VALUE muss in Postgres committed sein
-- bevor der neue Wert in derselben Session gelesen werden kann
-- (Memory feedback_clean_cut_no_prod_data.md — kein Dual-Write,
-- klare Phasen-Trennung).
BEGIN;

-- ─── Tabelle: info_fields ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.info_fields (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  label         text NOT NULL,
  value         text NULL,
  -- 10 Field-Types aus Konzept §12.1. Erweiterung in V2.
  value_type    text NOT NULL DEFAULT 'text'
                CHECK (value_type IN (
                  'text', 'number', 'date', 'currency',
                  'boolean', 'email', 'phone', 'url',
                  'enum', 'alias-ref'
                )),
  -- value_meta: typed Erweiterungen (z.B. {min,max,step,unit} bei number;
  -- {currency_code, locale} bei currency; {options:string[]} bei enum).
  value_meta    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- WV.B.6 Symbol-System: User-Override gegenueber Auto-Symbol.
  -- NULL = Auto-Logik (siehe lib/symbol-resolution.ts §12.3.4).
  symbol_override text NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS info_fields_ws_idx ON public.info_fields(workspace_id);

ALTER TABLE public.info_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS info_fields_select ON public.info_fields;
CREATE POLICY info_fields_select ON public.info_fields
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS info_fields_write ON public.info_fields;
CREATE POLICY info_fields_write ON public.info_fields
  FOR ALL
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.info_fields TO authenticated;
GRANT ALL ON public.info_fields TO service_role;

-- updated_at-Touch.
CREATE OR REPLACE FUNCTION public._touch_info_fields_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS info_fields_touch_updated_at ON public.info_fields;
CREATE TRIGGER info_fields_touch_updated_at
  BEFORE UPDATE ON public.info_fields
  FOR EACH ROW EXECUTE FUNCTION public._touch_info_fields_updated_at();

-- Cascade: DELETE info_fields → atom_manifestations purge (analog tasks).
CREATE OR REPLACE FUNCTION public._atom_manif_purge_for_info_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.atom_manifestations
  WHERE atom_type = 'info_field' AND atom_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS info_fields_cascade_atom_manifs ON public.info_fields;
CREATE TRIGGER info_fields_cascade_atom_manifs
  AFTER DELETE ON public.info_fields
  FOR EACH ROW EXECUTE FUNCTION public._atom_manif_purge_for_info_fields();

-- ─── Realtime ───────────────────────────────────────────────
ALTER TABLE public.info_fields REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'info_fields'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.info_fields;
  END IF;
END $$;

COMMENT ON TABLE public.info_fields IS
  'WV.B.1 typed Cell-Info-Felder. value_type-CHECK 10 Werte (§12.1). value_meta jsonb fuer typed Erweiterungen. symbol_override fuer User-Symbol-Override (Auto via lib/symbol-resolution.ts).';

COMMIT;
