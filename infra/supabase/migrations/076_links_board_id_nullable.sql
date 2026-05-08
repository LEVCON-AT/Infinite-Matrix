-- ═══════════════════════════════════════════════════════════════
-- WV.C fortgesetzt — links.board_id NULLABLE + Cell-Links-Backfill
--
-- Konzept-Verankerung: §12.3.2 (Link-Provider als Atom), §15.1-B
-- (links als Atom-Tabelle mit Cell-/Workspace-Scope, nicht board-only).
--
-- Hintergrund: bis WV.B war links.board_id NOT NULL — Links existierten
-- nur als Kanban-Sub-Atome. Welle WV.B's Info-Vorlage rendert links
-- aber als Cell-scoped Atome ohne Board-Bindung. Migration 075
-- (cell.data-Backfill) liess Cell-Links unangetastet im cell.data.links-
-- Sub-Key, mit dem Verweis „separater Sprint".
--
-- Diese Migration:
--   1. ALTER COLUMN board_id DROP NOT NULL → cell-scoped Links erlaubt.
--   2. Backfill: cell.data.links[] → links-Rows mit board_id=NULL +
--      atom_manifestations(kind='pinned', container_kind='cell').
--   3. cell.data.links Sub-Key droppen (alle migriert).
--
-- Clean-cut-Pflicht (Memory `feedback_clean_cut_no_prod_data.md`):
-- User 2026-05-06: „keine relevanten Daten". Direkter ALTER + INSERT
-- ohne Dual-Write.
--
-- RLS-Anpassung: bestehende Policies referenzieren board_id fuer
-- Workspace-Resolve. Mit nullable board_id muss workspace_id direkt
-- auf der links-Row liegen — Policy-Refactor: workspace_id aus board_id-
-- JOIN ableiten ODER direkt aus links.workspace_id (wenn die Spalte
-- existiert; sonst als Teil dieser Migration hinzufuegen).
--
-- Idempotenz: ON CONFLICT (id) DO NOTHING. ALTER COLUMN ist idempotent
-- per Postgres (DROP NOT NULL auf bereits nullable Spalte ist NO-OP).
--
-- Apply (User-Go-Pflicht):
--   docker exec matrix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f 076_links_board_id_nullable.sql
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── Stage 1: ALTER COLUMN ─────────────────────────────────────
ALTER TABLE public.links
  ALTER COLUMN board_id DROP NOT NULL;

-- workspace_id-Spalte: existiert seit Schema-Anlage, redundant zu
-- board_id->kb_cols->workspace_id. Wir verifizieren via DO-Block —
-- wenn fehlend, hinzufuegen + via board_id-JOIN backfillen.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'links'
      AND column_name = 'workspace_id'
  ) THEN
    ALTER TABLE public.links ADD COLUMN workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
    -- Backfill aus board_id (kb_cols.workspace_id, oder direkt
    -- nodes.workspace_id falls board_id auf nodes zeigt).
    UPDATE public.links l
    SET workspace_id = n.workspace_id
    FROM public.nodes n
    WHERE l.board_id = n.id AND l.workspace_id IS NULL;
    -- workspace_id ist ab jetzt Pflicht fuer alle weiteren Inserts.
    ALTER TABLE public.links ALTER COLUMN workspace_id SET NOT NULL;
  END IF;
END $$;

-- ─── Stage 2: Backfill cell.data.links → links + atom_manifestations ──
-- cell.data.links[] = [{id, url, label}]. Provider 'url' Default
-- (15-Werte-CHECK aus Migration 073). board_id NULL = Cell-Scope.
INSERT INTO public.links (
  id, workspace_id, board_id, url, label, provider, click_count
)
SELECT
  COALESCE((link->>'id')::uuid, gen_random_uuid()),
  c.workspace_id,
  NULL,
  COALESCE(link->>'url', ''),
  link->>'label',
  'url',
  0
FROM public.cells c
CROSS JOIN LATERAL jsonb_array_elements(c.data->'links') AS link
WHERE c.data ? 'links'
  AND jsonb_typeof(c.data->'links') = 'array'
  AND link->>'url' IS NOT NULL
  AND length(link->>'url') > 0
ON CONFLICT (id) DO NOTHING;

-- atom_manifestations fuer Cell-Links: kind='pinned', container_kind='cell'.
-- Reihenfolge aus Array-Index (ORDINALITY).
INSERT INTO public.atom_manifestations (
  atom_type, atom_id, workspace_id, kind, container_id, container_kind,
  position, level, display_meta
)
SELECT
  'link',
  COALESCE((link->>'id')::uuid, gen_random_uuid()),
  c.workspace_id,
  'pinned',
  c.id,
  'cell',
  ord,
  NULL,
  '{}'::jsonb
FROM public.cells c
CROSS JOIN LATERAL jsonb_array_elements(c.data->'links') WITH ORDINALITY AS t(link, ord)
WHERE c.data ? 'links'
  AND jsonb_typeof(c.data->'links') = 'array'
  AND link->>'url' IS NOT NULL
  AND length(link->>'url') > 0
  AND EXISTS (
    SELECT 1 FROM public.links l WHERE l.id = (link->>'id')::uuid
  )
ON CONFLICT DO NOTHING;

-- ─── Stage 3: cell.data.links Sub-Key droppen ─────────────────
UPDATE public.cells
SET data = data - 'links'
WHERE data ? 'links';

-- ─── Stage 4: RLS-Policy-Refresh ──────────────────────────────
-- Bestehende Policies pro links-Tabelle referenzierten typischerweise
-- board_id → kb_cols → workspace_id. Mit board_id NULL muessen sie
-- direkt auf links.workspace_id schauen. Wir setzen idempotent neu.
ALTER TABLE public.links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS links_select ON public.links;
CREATE POLICY links_select ON public.links
  FOR SELECT
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS links_insert ON public.links;
CREATE POLICY links_insert ON public.links
  FOR INSERT
  WITH CHECK (can_write_workspace(workspace_id));

DROP POLICY IF EXISTS links_update ON public.links;
CREATE POLICY links_update ON public.links
  FOR UPDATE
  USING (is_workspace_member(workspace_id))
  WITH CHECK (can_write_workspace(workspace_id));

DROP POLICY IF EXISTS links_delete ON public.links;
CREATE POLICY links_delete ON public.links
  FOR DELETE
  USING (can_write_workspace(workspace_id));

-- Realtime: links-Tabelle ist bereits in supabase_realtime publication
-- seit WV.B.3 (Migration 073). REPLICA IDENTITY FULL bleibt — kein
-- Re-Add noetig.

COMMIT;

-- Smoke-Verifikation:
--   SELECT count(*) FILTER (WHERE board_id IS NULL) AS cell_links,
--          count(*) FILTER (WHERE board_id IS NOT NULL) AS board_links
--   FROM public.links;
--   SELECT count(*) FROM public.cells WHERE data ? 'links';  -- soll 0 sein
COMMENT ON TABLE public.links IS
  'WV.B.3 + WV.C-Erweiterung: link-Atome (provider, provider_meta, '
  'symbol_override, click_count). board_id NULL = cell-/workspace-scoped, '
  'NOT NULL = board-scoped. Migration 076 backfilled cell.data.links.';
