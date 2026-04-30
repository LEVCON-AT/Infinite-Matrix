-- ═══════════════════════════════════════════════════════════════
-- Phase 4 Welle T.1.J — Cleanup-Migration
--
-- Daten leben seit T.1.D ausschliesslich in tasks + task_manifestations
-- (siehe Migration 040). client-web hat seit Commit 17977a9 keinen
-- DB-Read/Write mehr auf kb_cards / checklist_items. Migration 041 hat
-- die Bestandsdaten 1:1 in die neue Struktur kopiert.
--
-- Diese Migration entfernt die Legacy-Tabellen final:
--   1. MCP-Functions die kb_cards/checklist_items referenzieren werden
--      entweder auf tasks/task_manifestations umgebogen
--      (_mcp_resolve_workspace, mcp_get_workspace_context) oder
--      ersatzlos gedroppt (mcp_create_card, mcp_rename_card,
--      mcp_move_card, mcp_set_card_archived, mcp_add_checklist_item).
--      Die Drop-Liste hat nicht mehr funktionierende Bodies und wird
--      in T.1.H durch task-native Aequivalente (mcp_create_task etc.)
--      ersetzt.
--   2. DROP TABLE checklist_items CASCADE.
--   3. DROP TABLE kb_cards CASCADE.
--   4. Verifikation (Tabellen weg, count(*) auf tasks unveraendert).
--
-- Reihenfolge:
--   - Functions vor Tabellen, weil DROP TABLE CASCADE wuerde Functions
--     nicht automatisch droppen — ihre Bodies wuerden lediglich beim
--     naechsten Aufruf scheitern.
--   - checklist_items vor kb_cards, weil die Foreign-Key-Reihenfolge
--     sonst irrelevant ist (kein FK zwischen den beiden), aber so
--     entspricht es der historischen Insert-Reihenfolge.
--
-- Smoke nach Apply:
--   - SELECT count(*) FROM public.tasks;             -- unveraendert
--   - \dt public.kb_cards public.checklist_items;    -- ERROR: not exist
--   - \df public.mcp_create_card                     -- ERROR: not exist
-- ═══════════════════════════════════════════════════════════════

-- ─── Schritt 1a: _mcp_resolve_workspace auf tasks umbiegen ────
-- Die WHEN-Branches 'card' und 'checklist_item' resolven jetzt
-- gegen tasks (cardId == taskId nach Migration 041 1:1).
CREATE OR REPLACE FUNCTION public._mcp_resolve_workspace(
  p_kind text,
  p_id   uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_ws uuid;
BEGIN
  CASE p_kind
    WHEN 'node' THEN
      SELECT workspace_id INTO v_ws FROM public.nodes WHERE id = p_id;
    WHEN 'cell' THEN
      SELECT workspace_id INTO v_ws FROM public.cells WHERE id = p_id;
    WHEN 'col' THEN
      SELECT workspace_id INTO v_ws FROM public.kb_cols WHERE id = p_id;
    WHEN 'card' THEN
      -- T.1.J: Karten leben in tasks (mit kanban-Manifestation).
      SELECT workspace_id INTO v_ws FROM public.tasks WHERE id = p_id;
    WHEN 'checklist' THEN
      SELECT workspace_id INTO v_ws FROM public.checklists WHERE id = p_id;
    WHEN 'checklist_item' THEN
      -- T.1.J: Items leben in tasks (mit checklist-Manifestation).
      SELECT workspace_id INTO v_ws FROM public.tasks WHERE id = p_id;
    WHEN 'task' THEN
      SELECT workspace_id INTO v_ws FROM public.tasks WHERE id = p_id;
    WHEN 'task_manifestation' THEN
      SELECT workspace_id INTO v_ws FROM public.task_manifestations WHERE id = p_id;
    ELSE
      RAISE EXCEPTION 'unknown_resource_kind: %', p_kind;
  END CASE;

  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'resource_not_found: % %', p_kind, p_id
      USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_ws;
END $$;

-- ─── Schritt 1b: mcp_get_workspace_context — card_count via Manifestation ──
-- Zaehlt Karten via task_manifestations(kind='kanban') wo
-- display_meta.board_id == nodes.id.
CREATE OR REPLACE FUNCTION public.mcp_get_workspace_context(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_role  public.workspace_role;
  v_name  text;
  v_nodes jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_role := public.workspace_role_of(p_workspace_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT name INTO v_name FROM public.workspaces WHERE id = p_workspace_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'type', n.type,
    'label', n.label,
    'alias', n.alias,
    'parent_cell_id', n.parent_cell_id,
    'cell_count', (SELECT count(*) FROM public.cells WHERE matrix_id = n.id),
    'card_count', CASE WHEN n.type = 'board'
                       THEN (SELECT count(*) FROM public.task_manifestations m
                              WHERE m.kind = 'kanban'
                                AND m.display_meta->>'board_id' = n.id::text)
                       ELSE 0 END
  ) ORDER BY n.created_at), '[]'::jsonb)
    INTO v_nodes
    FROM public.nodes n
   WHERE n.workspace_id = p_workspace_id;

  RETURN jsonb_build_object(
    'workspace_id', p_workspace_id,
    'workspace_name', v_name,
    'caller_role', v_role,
    'nodes', v_nodes
  );
END $$;

-- ─── Schritt 1c: Obsolete Card/Item-MCP-Functions DROPpen ────
-- Diese Funktionen haben Bodies die kb_cards/checklist_items SQL
-- absetzen. Nach DROP TABLE CASCADE wuerden sie beim naechsten
-- Aufruf scheitern — deshalb explizit entfernen. T.1.H schreibt
-- mcp_create_task / mcp_update_task / mcp_search_tasks /
-- mcp_add_manifestation als task-native Aequivalente.
DROP FUNCTION IF EXISTS public.mcp_create_card(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.mcp_rename_card(uuid, text);
DROP FUNCTION IF EXISTS public.mcp_move_card(uuid, uuid);
DROP FUNCTION IF EXISTS public.mcp_set_card_archived(uuid, boolean);
DROP FUNCTION IF EXISTS public.mcp_add_checklist_item(uuid, text, int);

-- ─── Schritt 1d: Audit-Trigger-Function fuer kb_cards entfernen ──
-- Migration 020 legte kb_cards_audit_emit() + 3 Trigger (insert/update/
-- delete) an. CASCADE entfernt die abhaengigen Trigger zusammen mit
-- der Function — der nachfolgende DROP TABLE haette die Trigger zwar
-- ohnehin gekippt, aber dazwischen waeren sie ein Moment lang ohne
-- Function gewesen (kein Showstopper, aber unsauber).
DROP FUNCTION IF EXISTS public.kb_cards_audit_emit() CASCADE;

-- ─── Schritt 2: Realtime-Publication entfernt referenzen automatisch ──
-- DROP TABLE CASCADE entfernt Eintraege aus supabase_realtime
-- automatisch. Kein expliziter ALTER PUBLICATION noetig.

-- ─── Schritt 3: Tabellen droppen ─────────────────────────────
-- CASCADE entfernt:
--   - Indizes (kb_cards_*_idx, checklist_items_*_idx)
--   - RLS-Policies (kb_cards_*, checklist_items_*)
--   - Trigger (kb_cards_set_updated_at)
--   - Foreign-Key-Constraints (kb_cards.col_id → kb_cols, etc.)
--   - Publication-Entries (supabase_realtime).
DROP TABLE IF EXISTS public.checklist_items CASCADE;
DROP TABLE IF EXISTS public.kb_cards CASCADE;

-- ─── Schritt 4: Verifikation ─────────────────────────────────
DO $$
DECLARE
  v_kb_cards_exists       boolean;
  v_checklist_items_exists boolean;
  v_tasks_count           bigint;
  v_kanban_manifs         bigint;
  v_checklist_manifs      bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
     WHERE n.nspname = 'public' AND c.relname = 'kb_cards'
  ) INTO v_kb_cards_exists;
  SELECT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
     WHERE n.nspname = 'public' AND c.relname = 'checklist_items'
  ) INTO v_checklist_items_exists;

  SELECT count(*) INTO v_tasks_count FROM public.tasks;
  SELECT count(*) INTO v_kanban_manifs
    FROM public.task_manifestations WHERE kind = 'kanban';
  SELECT count(*) INTO v_checklist_manifs
    FROM public.task_manifestations WHERE kind = 'checklist';

  RAISE NOTICE 'T.1.J Cleanup: kb_cards-exists=% checklist_items-exists=% tasks=% kanban=% checklist=%',
    v_kb_cards_exists, v_checklist_items_exists,
    v_tasks_count, v_kanban_manifs, v_checklist_manifs;

  IF v_kb_cards_exists THEN
    RAISE WARNING 'T.1.J: kb_cards immer noch da — DROP fehlgeschlagen?';
  END IF;
  IF v_checklist_items_exists THEN
    RAISE WARNING 'T.1.J: checklist_items immer noch da — DROP fehlgeschlagen?';
  END IF;
END $$;
