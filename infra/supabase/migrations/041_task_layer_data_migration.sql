-- ═══════════════════════════════════════════════════════════════
-- Phase 4 Welle T.1.B — Task-Layer Daten-Migration
--
-- Kopiert Bestandsdaten aus kb_cards + checklist_items in das neue
-- Schema (Migration 040). Idempotent via WHERE NOT EXISTS — eine
-- erneute Ausfuehrung ueberschreibt nichts.
--
-- WICHTIG: kb_cards.id und checklist_items.id werden 1:1 als
-- tasks.id uebernommen. Damit bleiben bestehende Frontend-Refs
-- (z.B. card.id im IDB-Cache) gueltig, sobald T.1.D die UI auf
-- die neuen Views umstellt.
--
-- Originaltabellen werden NICHT geloescht — das passiert erst in
-- T.1.J (Migration 042) nach manueller Verifikation auf staging.
--
-- Pattern:
--   - Nicht in tasks-Spalten passende Felder (priority, tags, alias,
--     checklist_ref, checklist-jsonb, source_*) wandern in tasks.attrs.
--   - Status wird aus archived/done abgeleitet:
--       archived=true → 'archived'
--       done=true     → 'done'
--       sonst         → 'open'
--   - Manifestations:
--       kanban     → container_id = kb_cards.col_id
--       checklist  → container_id = checklist_items.checklist_id, level=level
-- ═══════════════════════════════════════════════════════════════

-- ─── Schritt 1: kb_cards → tasks ─────────────────────────────
INSERT INTO public.tasks (
  id,
  workspace_id,
  label,
  note,
  status,
  deadline,
  who,
  recur,
  done_occurrences,
  attrs,
  created_at,
  updated_at
)
SELECT
  c.id,
  c.workspace_id,
  c.name,
  COALESCE(c.note, ''),
  CASE
    WHEN c.archived = true THEN 'archived'::public.task_status
    WHEN c.done     = true THEN 'done'::public.task_status
    ELSE                        'open'::public.task_status
  END,
  c.deadline,
  c.who,
  c.recur,
  c.done_occurrences,
  -- attrs sammelt alles, was wir nicht in eigene Spalten gehoben haben.
  -- NULLs werden uebersprungen (nur belegte Felder landen im JSON).
  jsonb_strip_nulls(jsonb_build_object(
    'legacy_kind',     'kb_card',
    'priority',        c.priority,
    'tags',            CASE WHEN array_length(c.tags, 1) IS NOT NULL THEN to_jsonb(c.tags) ELSE NULL END,
    'alias',           c.alias,
    'checklist_ref',   c.checklist_ref,
    'checklist_inline', c.checklist,
    'source_cl_id',    c.source_cl_id,
    'source_label',    c.source_label
  )),
  c.created_at,
  c.updated_at
FROM public.kb_cards c
WHERE NOT EXISTS (
  SELECT 1 FROM public.tasks t WHERE t.id = c.id
);

-- ─── Schritt 2: kb_cards → task_manifestations (kind='kanban') ──
INSERT INTO public.task_manifestations (
  task_id,
  workspace_id,
  kind,
  container_id,
  position,
  level,
  display_meta,
  created_at
)
SELECT
  c.id,
  c.workspace_id,
  'kanban'::public.task_manifestation_kind,
  c.col_id,
  c.position,
  NULL,
  jsonb_strip_nulls(jsonb_build_object(
    'board_id', c.board_id,
    'archived', CASE WHEN c.archived THEN true ELSE NULL END
  )),
  c.created_at
FROM public.kb_cards c
WHERE NOT EXISTS (
  SELECT 1 FROM public.task_manifestations m
   WHERE m.task_id = c.id AND m.kind = 'kanban'
);

-- ─── Schritt 3: checklist_items → tasks ──────────────────────
INSERT INTO public.tasks (
  id,
  workspace_id,
  label,
  note,
  status,
  attrs
)
SELECT
  i.id,
  i.workspace_id,
  i.text,
  '',
  CASE WHEN i.done THEN 'done'::public.task_status ELSE 'open'::public.task_status END,
  jsonb_build_object(
    'legacy_kind', 'checklist_item'
  )
FROM public.checklist_items i
WHERE NOT EXISTS (
  SELECT 1 FROM public.tasks t WHERE t.id = i.id
);

-- ─── Schritt 4: checklist_items → task_manifestations (kind='checklist') ──
INSERT INTO public.task_manifestations (
  task_id,
  workspace_id,
  kind,
  container_id,
  position,
  level,
  display_meta
)
SELECT
  i.id,
  i.workspace_id,
  'checklist'::public.task_manifestation_kind,
  i.checklist_id,
  i.position,
  i.level,
  '{}'::jsonb
FROM public.checklist_items i
WHERE NOT EXISTS (
  SELECT 1 FROM public.task_manifestations m
   WHERE m.task_id = i.id AND m.kind = 'checklist'
);

-- ─── Verifikation (informationell, blockiert nicht) ──────────
DO $$
DECLARE
  v_kb_cards_count   bigint;
  v_items_count      bigint;
  v_tasks_count      bigint;
  v_manif_kanban     bigint;
  v_manif_checklist  bigint;
BEGIN
  SELECT count(*) INTO v_kb_cards_count  FROM public.kb_cards;
  SELECT count(*) INTO v_items_count     FROM public.checklist_items;
  SELECT count(*) INTO v_tasks_count     FROM public.tasks;
  SELECT count(*) INTO v_manif_kanban    FROM public.task_manifestations WHERE kind = 'kanban';
  SELECT count(*) INTO v_manif_checklist FROM public.task_manifestations WHERE kind = 'checklist';

  RAISE NOTICE 'T.1.B Migration: kb_cards=% items=% → tasks=% manif_kanban=% manif_checklist=%',
    v_kb_cards_count, v_items_count, v_tasks_count, v_manif_kanban, v_manif_checklist;

  IF v_tasks_count < v_kb_cards_count + v_items_count THEN
    RAISE WARNING 'T.1.B: tasks-count (%) < erwartet (%) — manuell pruefen',
      v_tasks_count, v_kb_cards_count + v_items_count;
  END IF;

  IF v_manif_kanban <> v_kb_cards_count THEN
    RAISE WARNING 'T.1.B: kanban-Manifestations (%) != kb_cards (%) — manuell pruefen',
      v_manif_kanban, v_kb_cards_count;
  END IF;

  IF v_manif_checklist <> v_items_count THEN
    RAISE WARNING 'T.1.B: checklist-Manifestations (%) != checklist_items (%) — manuell pruefen',
      v_manif_checklist, v_items_count;
  END IF;
END $$;
