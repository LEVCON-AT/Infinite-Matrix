-- ═══════════════════════════════════════════════════════════════
-- WV.B.4 — Backfill cell.data.infoFields + cell.data.links → Atom-Tabellen
--
-- Konzept-Verankerung: §11 (Info-Vorlage), §15.1-A info_fields,
-- §12.3.2 links-provider.
--
-- Clean-cut-Pflicht (Memory `feedback_clean_cut_no_prod_data.md`):
-- User 2026-05-06: „keine relevanten Daten". Kein Dual-Write, kein
-- Lazy-Migration — direkt INSERT + Cell-Data-Drop.
--
-- Reihenfolge:
--   1. cell.data.infoFields[] → info_fields-Rows.
--      (Mit atom_manifestations(kind='info', container_kind='cell',
--      container_id=cell.id) — damit die Cell-Info-Section sie sieht.)
--   2. cell.data.links[] → links-Rows mit provider='url'.
--      Plus atom_manifestations(kind='pinned', container_kind='cell',
--      container_id=cell.id) damit Section „Links" der Info-Vorlage
--      sie rendert.
--   3. cell.data wird auf '{}'::jsonb genullt (alle Sub-Keys weg).
--
-- Idempotenz: ON CONFLICT (id) DO NOTHING auf info_fields/links —
-- legacy-objects in jsonb haben bereits eigene UUIDs (id-Feld), die
-- wir wiederverwenden. Re-Apply produziert keine Duplikate.
--
-- Apply:
--   docker exec matrix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f 075_backfill_cell_data.sql
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── Stage 1: infoFields → info_fields ────────────────────────
-- Format: cell.data.infoFields[] = [{id, label, value, type?}].
-- Wir mappen optional type → value_type. Wenn type fehlt: 'text' Default.
INSERT INTO public.info_fields (id, workspace_id, label, value, value_type, value_meta)
SELECT
  COALESCE((field->>'id')::uuid, gen_random_uuid()),
  c.workspace_id,
  COALESCE(field->>'label', ''),
  field->>'value',
  COALESCE(field->>'type', 'text'),
  COALESCE(field->'meta', '{}'::jsonb)
FROM public.cells c
CROSS JOIN LATERAL jsonb_array_elements(c.data->'infoFields') AS field
WHERE c.data ? 'infoFields'
  AND jsonb_typeof(c.data->'infoFields') = 'array'
  -- Skip wenn type unbekannt — V1 erlaubt nur die 10 Konzept-§12.1-Werte.
  -- Legacy-Daten ohne type kommen als 'text' rein. Unbekannte type-Werte
  -- werden via CHECK-Constraint vom DB abgewiesen. Wir filtern hier
  -- nur „type ist string oder null".
  AND (field->>'type' IS NULL OR field->>'type' IN (
    'text', 'number', 'date', 'currency',
    'boolean', 'email', 'phone', 'url',
    'enum', 'alias-ref'
  ))
ON CONFLICT (id) DO NOTHING;

-- Atom-Manifestations fuer info_fields: kind='info', container_kind='cell'.
-- position numerisch aus Reihenfolge im Array. ordinality liefert 1-basierten Index.
INSERT INTO public.atom_manifestations (
  atom_type, atom_id, workspace_id, kind, container_id, container_kind,
  position, level, display_meta
)
SELECT
  'info_field',
  COALESCE((field->>'id')::uuid, gen_random_uuid()),
  c.workspace_id,
  'info',
  c.id,
  'cell',
  ord,
  NULL,
  '{}'::jsonb
FROM public.cells c
CROSS JOIN LATERAL jsonb_array_elements(c.data->'infoFields') WITH ORDINALITY AS t(field, ord)
WHERE c.data ? 'infoFields'
  AND jsonb_typeof(c.data->'infoFields') = 'array'
  AND (field->>'type' IS NULL OR field->>'type' IN (
    'text', 'number', 'date', 'currency',
    'boolean', 'email', 'phone', 'url',
    'enum', 'alias-ref'
  ))
  AND EXISTS (
    SELECT 1 FROM public.info_fields i WHERE i.id = (field->>'id')::uuid
  )
ON CONFLICT DO NOTHING;

-- ─── Stage 2: cell.data.links → links + atom_manifestations(kind='pinned') ──
-- cell.data.links[] = [{id, url, label}]. board_id ist hier NULL — heute
-- ist links.board_id NOT NULL. Wir lassen Cell-Links daher NICHT in die
-- links-Tabelle wandern, sondern modellieren sie via atom_manifestations
-- + pinned-Container 'cell' wenn ein Link-Atom existiert. Ohne board_id
-- gibt es keinen klassischen links-Pfad fuer cell-scoped Links.
--
-- Fuer V1-Backfill: wir tragen Cell-Links auch nicht in links-Tabelle —
-- sie verbleiben in cell.data bis Welle-A-Info-Renderer die Section
-- selbst aus cell.data.links liest (Renderer-Stub). Welle B's Info-
-- Vorlage-Renderer wird dann auf links-Tabelle umstellen, sobald
-- links.board_id NULLABLE wird (separate Migration).
--
-- Daher: Stage 2 NO-OP fuer Cell-Links — die bleiben in data bis ein
-- naehkstes Migrations-File die board_id-Pflicht aufhebt. Wir loeschen
-- aber den infoFields-Sub-Key, weil dieser komplett migriert ist.

-- ─── Stage 3: data sub-keys droppen (nur infoFields) ─────────
-- cell.data.links bleibt drin bis Cell-Link-Migration mit
-- nullable board_id (separater Sprint).
UPDATE public.cells
SET data = data - 'infoFields'
WHERE data ? 'infoFields';

COMMIT;

-- Smoke-Verifikation als COMMENT — Postgres `\echo` faengt im Apply-Pfad
-- nicht. Caller fuehrt nach Apply aus:
--   SELECT count(*) FROM public.info_fields;
--   SELECT count(*) FROM public.cells WHERE data ? 'infoFields';  -- soll 0 sein
COMMENT ON TABLE public.info_fields IS
  'WV.B.1+B.4: typed Cell-Info-Felder. Backfill aus cell.data.infoFields[] (Migration 075).';
