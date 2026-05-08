-- ═══════════════════════════════════════════════════════════════
-- WV.A.5 — Plattform-Default-Vorlagen Seed
--
-- Spielt 5 Plattform-Vorlagen ein (Konzept §6.3 + plan-welle-wv.md
-- §3): Kanban, Info, Checkliste, Smart Summary, Doc.
--
-- Hardcoded UUIDs damit Re-Apply idempotent ist (ON CONFLICT(id)
-- DO NOTHING). Pattern aus §6.3:
--   00000000-0000-0000-0000-000000000a01..a05 = Templates
--   00000000-0000-0000-0000-000000000b01..b05 = Sections (1 pro Template)
--   00000000-0000-0000-0000-000000000c01..c05 = Widgets (1 pro Template)
--
-- Two-Stage-Insert: erst Templates (root_widget_id NULL), dann
-- Sections, dann Widgets, am Ende root_widget_id setzen. DEFERRABLE
-- FK aus Migration 067 erlaubt das in einer Transaktion.
--
-- Slot-Konvention (Konzept §6.3):
--   1: Matrix       — wird in Welle WV.A nicht ueber Vorlagen-System
--                     abgebildet (Matrix-Erzeugung bleibt via Command-
--                     Palette + /templates/-Route, kein Default-Slot).
--                     Slot 1 bleibt frei.
--   2: Info         — feature_templates.hotkey_slot=2
--   3: Kanban       — hotkey_slot=3
--   4: Checkliste   — hotkey_slot=4
--   5-9: leer (User 2026-05-06: noch zu klaeren)
--
-- Smart Summary + Doc haben hotkey_slot=NULL (keine Slot-Belegung):
--   - Smart Summary: render_position='auto_under_features' (§11.6)
--   - Doc: globaler 'd'-Hotkey, nicht in feature_templates.hotkey_slot
--
-- Apply:
--   docker exec matrix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f 071_seed_default_templates.sql
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- DEFERRABLE-FK aktivieren damit root_widget_id in zwei Stages
-- gesetzt werden kann (Stage-1: Template ohne root_widget_id;
-- Stage-2: Update root_widget_id nach Widget-Insert).
SET CONSTRAINTS public.feature_templates_root_widget_id_fkey DEFERRED;

-- ─── Stage 1: Plattform-Vorlagen ──────────────────────────────
INSERT INTO public.feature_templates (
  id, workspace_id, owner_user_id, name, symbol, hotkey_slot,
  visibility, layout_version, render_position
) VALUES
  (
    '00000000-0000-0000-0000-000000000a01',
    NULL, NULL,
    'Kanban', 'view-columns', 3,
    'platform', 1, 'hotkey_slot'
  ),
  (
    '00000000-0000-0000-0000-000000000a02',
    NULL, NULL,
    'Info', 'information-circle', 2,
    'platform', 1, 'hotkey_slot'
  ),
  (
    '00000000-0000-0000-0000-000000000a03',
    NULL, NULL,
    'Checkliste', 'list-bullet', 4,
    'platform', 1, 'hotkey_slot'
  ),
  (
    '00000000-0000-0000-0000-000000000a04',
    NULL, NULL,
    'Smart Summary', 'sparkles', NULL,
    'platform', 1, 'auto_under_features'
  ),
  (
    '00000000-0000-0000-0000-000000000a05',
    NULL, NULL,
    'Doku', 'document-text', NULL,
    'platform', 1, 'hotkey_slot'
  )
ON CONFLICT (id) DO NOTHING;

-- ─── Stage 2: Default-Sections (1 pro Template) ──────────────
-- title NULL = Default-Section ohne sichtbaren Header
-- (Render-Code zeigt nur den Header wenn title gesetzt ist).
INSERT INTO public.template_sections (
  id, template_id, position, title, default_collapsed, visibility
) VALUES
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000a01', 1, NULL, false, 'always'),
  ('00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-000000000a02', 1, NULL, false, 'always'),
  ('00000000-0000-0000-0000-000000000b03', '00000000-0000-0000-0000-000000000a03', 1, NULL, false, 'always'),
  ('00000000-0000-0000-0000-000000000b04', '00000000-0000-0000-0000-000000000a04', 1, NULL, false, 'always'),
  ('00000000-0000-0000-0000-000000000b05', '00000000-0000-0000-0000-000000000a05', 1, NULL, false, 'always')
ON CONFLICT (id) DO NOTHING;

-- ─── Stage 3: Default-Widgets (1 pro Section) ────────────────
-- size_cols=12 (volle Breite), size_rows=12 (default-Hoehe).
-- data/toggles/config leer fuer Default-Anlage — User passt pro Cell
-- via cell_widget_overrides an.
INSERT INTO public.template_widgets (
  id, section_id, "column", position, type, size_cols, size_rows,
  data, toggles, config
) VALUES
  ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-000000000b01', 1, 1, 'kanban',        12, 12, '{}', '{}', '{}'),
  ('00000000-0000-0000-0000-000000000c02', '00000000-0000-0000-0000-000000000b02', 1, 1, 'info',          12, 8,  '{}', '{}', '{}'),
  ('00000000-0000-0000-0000-000000000c03', '00000000-0000-0000-0000-000000000b03', 1, 1, 'checklist',     12, 12, '{}', '{}', '{}'),
  ('00000000-0000-0000-0000-000000000c04', '00000000-0000-0000-0000-000000000b04', 1, 1, 'smart_summary', 12, 6,  '{}', '{}', '{}'),
  ('00000000-0000-0000-0000-000000000c05', '00000000-0000-0000-0000-000000000b05', 1, 1, 'doc',           12, 12, '{}', '{}', '{}')
ON CONFLICT (id) DO NOTHING;

-- ─── Stage 4: root_widget_id setzen ──────────────────────────
-- Konzept §6.2: root_widget_id zeigt auf den Default-Drop-Target-
-- Widget-Slot. Smart Summary hat KEIN Root (NULL bleibt) — bei Drag
-- auf Cell mit Smart-Summary-Vorlage zeigt WidgetPicker alle Slots
-- statt direkt zu routen.
UPDATE public.feature_templates SET root_widget_id = '00000000-0000-0000-0000-000000000c01' WHERE id = '00000000-0000-0000-0000-000000000a01';
UPDATE public.feature_templates SET root_widget_id = '00000000-0000-0000-0000-000000000c02' WHERE id = '00000000-0000-0000-0000-000000000a02';
UPDATE public.feature_templates SET root_widget_id = '00000000-0000-0000-0000-000000000c03' WHERE id = '00000000-0000-0000-0000-000000000a03';
-- Smart Summary: root_widget_id bleibt NULL.
UPDATE public.feature_templates SET root_widget_id = '00000000-0000-0000-0000-000000000c05' WHERE id = '00000000-0000-0000-0000-000000000a05';

-- Comments ueber die Default-IDs damit DB-Inspektion + Doc-Lookup
-- direkt im psql ersichtlich.
COMMENT ON CONSTRAINT feature_templates_root_widget_id_fkey ON public.feature_templates IS
  'WV.A.1 DEFERRABLE — Two-Stage-Insert in Migration 071: Templates ohne root_widget_id zuerst, dann Widgets, dann Update auf root_widget_id.';

COMMIT;
