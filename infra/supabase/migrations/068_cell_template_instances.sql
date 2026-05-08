-- ═══════════════════════════════════════════════════════════════
-- WV.A.2 — cell_template_instances + cell_widget_overrides
--
-- Verbindung Cell ↔ Vorlage. Eine Cell kann N Vorlagen halten
-- (Multi-Root, Konzept §9.A.6). Pro Cell+Template max einmal
-- (UNIQUE), aber dieselbe Vorlage kann in verschiedenen Cells
-- mehrfach genutzt werden. Sparse-Overrides pro Widget-Instanz
-- (Konzept §6.5 — User-Edits gehen in cell_widget_overrides,
-- Vorlage bleibt unangetastet → Reset-to-Template moeglich).
--
-- Schema-Heptad pro Tabelle:
--   - Schema:       diese Migration.
--   - Types:        lib/types.ts — CellTemplateInstanceRow,
--                   CellWidgetOverrideRow.
--   - Mutations:    lib/cell-templates.ts — applyTemplateToCell,
--                   removeTemplateFromCell, upsertWidgetOverride,
--                   resetWidgetOverride.
--   - Cache:        offline-cache.ts — TABLES + DB_VERSION-Bump.
--   - Realtime:     realtime.ts — DIRECT_TABLES erweitert.
--   - Export:       export.ts + subtree-import.ts — cell-Subtree
--                   exportiert/importiert die Junction.
--   - MCP:          packages/bridge/src/tools/cell-templates.ts
--                   neu (apply / remove / override).
--   - Channel-Bridge: n/a (Strukturdaten).
--
-- Apply:
--   docker exec matrix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f 068_cell_template_instances.sql
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── cell_template_instances ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cell_template_instances (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cell_id         uuid NOT NULL REFERENCES public.cells(id) ON DELETE CASCADE,
  template_id     uuid NOT NULL REFERENCES public.feature_templates(id) ON DELETE CASCADE,
  -- Workspace-Scope denormalisiert (Trigger pflegt aus cell.workspace_id).
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- layout_version pinned beim Apply — bei spaeterem Template-Update
  -- vergleichen wir ungleich + zeigen Update-Hint (Konzept §6.5).
  layout_version  int NOT NULL DEFAULT 1,
  applied_at      timestamptz NOT NULL DEFAULT now(),
  applied_by      uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Eine Vorlage maximal einmal pro Cell. Multi-Vorlagen pro Cell
  -- (Konzept §9.A.6) sind unterschiedliche template_id-Rows, nicht
  -- mehrfache Instanzen derselben Vorlage.
  UNIQUE (cell_id, template_id)
);

CREATE INDEX IF NOT EXISTS cell_template_instances_cell_idx ON public.cell_template_instances(cell_id);
CREATE INDEX IF NOT EXISTS cell_template_instances_template_idx ON public.cell_template_instances(template_id);
CREATE INDEX IF NOT EXISTS cell_template_instances_ws_idx ON public.cell_template_instances(workspace_id);

ALTER TABLE public.cell_template_instances ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._touch_cell_template_instance_workspace_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  SELECT c.workspace_id INTO NEW.workspace_id
  FROM public.cells c
  WHERE c.id = NEW.cell_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cell_template_instances_touch_workspace_id ON public.cell_template_instances;
CREATE TRIGGER cell_template_instances_touch_workspace_id
  BEFORE INSERT OR UPDATE OF cell_id ON public.cell_template_instances
  FOR EACH ROW EXECUTE FUNCTION public._touch_cell_template_instance_workspace_id();

-- ─── cell_widget_overrides ────────────────────────────────────
-- Sparse: nur die Felder die der User explizit veraendert hat.
-- override_data ist ein partial-Update auf template_widgets.data
-- (User-Patch). toggles + config bleiben separat falls noetig —
-- V1 buendelt alles in override_data (eine Spalte reicht).
CREATE TABLE IF NOT EXISTS public.cell_widget_overrides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id   uuid NOT NULL REFERENCES public.cell_template_instances(id) ON DELETE CASCADE,
  widget_id     uuid NOT NULL REFERENCES public.template_widgets(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  override_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- Pro Instance + Widget maximal eine Override-Row.
  UNIQUE (instance_id, widget_id)
);

CREATE INDEX IF NOT EXISTS cell_widget_overrides_instance_idx ON public.cell_widget_overrides(instance_id);
CREATE INDEX IF NOT EXISTS cell_widget_overrides_widget_idx ON public.cell_widget_overrides(widget_id);
CREATE INDEX IF NOT EXISTS cell_widget_overrides_ws_idx ON public.cell_widget_overrides(workspace_id);

ALTER TABLE public.cell_widget_overrides ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._touch_cell_widget_override_workspace_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  SELECT cti.workspace_id INTO NEW.workspace_id
  FROM public.cell_template_instances cti
  WHERE cti.id = NEW.instance_id;
  -- updated_at-Touch mitnehmen.
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cell_widget_overrides_touch_workspace_id ON public.cell_widget_overrides;
CREATE TRIGGER cell_widget_overrides_touch_workspace_id
  BEFORE INSERT OR UPDATE ON public.cell_widget_overrides
  FOR EACH ROW EXECUTE FUNCTION public._touch_cell_widget_override_workspace_id();

-- ─── RLS Policies — cell_template_instances ──────────────────
DROP POLICY IF EXISTS cell_template_instances_select ON public.cell_template_instances;
CREATE POLICY cell_template_instances_select ON public.cell_template_instances
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS cell_template_instances_write ON public.cell_template_instances;
CREATE POLICY cell_template_instances_write ON public.cell_template_instances
  FOR ALL
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

-- ─── RLS Policies — cell_widget_overrides ────────────────────
DROP POLICY IF EXISTS cell_widget_overrides_select ON public.cell_widget_overrides;
CREATE POLICY cell_widget_overrides_select ON public.cell_widget_overrides
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS cell_widget_overrides_write ON public.cell_widget_overrides;
CREATE POLICY cell_widget_overrides_write ON public.cell_widget_overrides
  FOR ALL
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

-- ─── Grants ──────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cell_template_instances TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cell_widget_overrides TO authenticated;
GRANT ALL ON public.cell_template_instances TO service_role;
GRANT ALL ON public.cell_widget_overrides TO service_role;

-- ─── Realtime ───────────────────────────────────────────────
ALTER TABLE public.cell_template_instances REPLICA IDENTITY FULL;
ALTER TABLE public.cell_widget_overrides REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'cell_template_instances'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cell_template_instances;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'cell_widget_overrides'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cell_widget_overrides;
  END IF;
END $$;

-- ─── Comments ───────────────────────────────────────────────
COMMENT ON TABLE public.cell_template_instances IS
  'WV.A.2 Cell ↔ Vorlage Junction. Multi-Vorlagen pro Cell (Konzept §9.A.6) via mehrere Rows mit unterschiedlichen template_id. layout_version pinned fuer Update-Hint.';
COMMENT ON TABLE public.cell_widget_overrides IS
  'WV.A.2 Sparse User-Overrides auf Template-Widget-Daten. JSON-Patch auf template_widgets.data — Reset-to-Template via DELETE der Override-Row.';

COMMIT;
