-- ═══════════════════════════════════════════════════════════════
-- WV.A.4 — saved_filters
--
-- Wiederverwendbare Filter-Definitionen pro AtomKind. Konsumiert
-- ueber Welle A FilterBuilderModal + spaeter BoardView/ChecklistPanel/
-- Sidebar-Trees/Command-Palette. body-jsonb folgt SavedFilterBody-
-- Format aus lib/atom-filter-attrs.ts (WV.Y, commit 8f25ee2).
--
-- Visibility:
--   workspace_id SET + owner_user_id NULL → Workspace-shared
--   workspace_id SET + owner_user_id SET → User-privat im Workspace
--
-- Schema-Heptad pro Tabelle:
--   - Schema:       diese Migration.
--   - Types:        lib/types.ts — SavedFilterRow.
--   - Mutations:    lib/saved-filters.ts — addSavedFilter, updateSavedFilter,
--                   deleteSavedFilter, fetchSavedFiltersForWorkspace.
--   - Cache:        offline-cache.ts — TABLES + DB_VERSION-Bump.
--   - Realtime:     direct table.
--   - Export:       export.ts — workspace-shared exportieren; user-privat
--                   nur wenn Export vom selben User getriggert wird.
--   - MCP:          packages/bridge/src/tools/saved-filters.ts neu.
--   - Channel-Bridge: n/a.
--
-- Apply:
--   docker exec matrix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f 070_saved_filters.sql
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.saved_filters (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_user_id uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          text NOT NULL,
  atom_kind     text NOT NULL CHECK (atom_kind IN ('task', 'link', 'doc', 'checklist', 'imported_event')),
  body          jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Versions-Diskriminator: body.v muss 1 sein. Schema-Drift in
  -- lib/atom-filter-attrs.ts loest Migration aus (Schema-Quad).
  CONSTRAINT saved_filters_body_v1 CHECK ((body ->> 'v') = '1')
);

CREATE INDEX IF NOT EXISTS saved_filters_ws_idx ON public.saved_filters(workspace_id);
CREATE INDEX IF NOT EXISTS saved_filters_owner_idx ON public.saved_filters(owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS saved_filters_atom_kind_idx ON public.saved_filters(workspace_id, atom_kind);

ALTER TABLE public.saved_filters ENABLE ROW LEVEL SECURITY;

-- ─── RLS Policies ────────────────────────────────────────────
DROP POLICY IF EXISTS saved_filters_select ON public.saved_filters;
CREATE POLICY saved_filters_select ON public.saved_filters
  FOR SELECT USING (
    -- Workspace-shared: alle Member sehen.
    (owner_user_id IS NULL AND public.is_workspace_member(workspace_id))
    -- User-privat: nur Owner sieht.
    OR (owner_user_id = auth.uid() AND public.is_workspace_member(workspace_id))
  );

DROP POLICY IF EXISTS saved_filters_write ON public.saved_filters;
CREATE POLICY saved_filters_write ON public.saved_filters
  FOR ALL
  USING (
    -- Workspace-shared: jeder mit can_write_workspace.
    (owner_user_id IS NULL AND public.can_write_workspace(workspace_id))
    -- User-privat: nur Owner.
    OR (owner_user_id = auth.uid() AND public.is_workspace_member(workspace_id))
  )
  WITH CHECK (
    (owner_user_id IS NULL AND public.can_write_workspace(workspace_id))
    OR (owner_user_id = auth.uid() AND public.is_workspace_member(workspace_id))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_filters TO authenticated;
GRANT ALL ON public.saved_filters TO service_role;

-- ─── updated_at Trigger ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public._touch_saved_filters_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS saved_filters_touch_updated_at ON public.saved_filters;
CREATE TRIGGER saved_filters_touch_updated_at
  BEFORE UPDATE ON public.saved_filters
  FOR EACH ROW EXECUTE FUNCTION public._touch_saved_filters_updated_at();

-- ─── Realtime ───────────────────────────────────────────────
ALTER TABLE public.saved_filters REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'saved_filters'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.saved_filters;
  END IF;
END $$;

COMMENT ON TABLE public.saved_filters IS
  'WV.A.4 wiederverwendbare Filter-Definitionen pro atom_kind. body-jsonb folgt SavedFilterBody aus lib/atom-filter-attrs.ts (WV.Y). Workspace-shared (owner_user_id NULL) oder User-privat.';

COMMIT;
