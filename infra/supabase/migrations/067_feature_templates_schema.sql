-- ═══════════════════════════════════════════════════════════════
-- WV.A.1 — feature_templates + template_sections + template_widgets
--
-- Vorlagen-Foundation aus dem Widget+Vorlagen-Konzept (§6.2).
-- Drei Tabellen, alle Layer-2-im-Atom-Zwiebel-Modell (Strukturdaten,
-- kein User-Inhalt — analog cells/nodes).
--
-- Schema-Heptad pro Tabelle (siehe `docs/claude/architektur.md` §3):
--   - Schema:       diese Migration.
--   - Types:        lib/types.ts — FeatureTemplateRow, TemplateSectionRow,
--                   TemplateWidgetRow. (WV.A.1b)
--   - Mutations:    lib/templates.ts — Create/Update/Delete + Hotkey-
--                   Slot-Zuweisung. (WV.A.1c)
--   - Cache:        offline-cache.ts — TABLES + DB_VERSION-Bump. (WV.A.1d)
--   - Realtime:     realtime.ts — DIRECT_TABLES erweitert. (WV.A.1e)
--   - Export:       export.ts + subtree-import.ts — Workspace-Pfad
--                   exportiert/importiert die 3 Tabellen. (WV.A.1f)
--   - MCP:          packages/bridge/src/tools/templates.ts neu —
--                   templates.list/create/update/delete + Hotkey-Bind. (WV.A.1g)
--   - Channel-Bridge: n/a (Strukturdaten, kein User-Inhalt).
--
-- Visibility-Modell:
--   workspace_id IS NULL  + owner_user_id IS NULL  → Plattform-Vorlage
--   workspace_id IS NOT NULL + owner_user_id IS NULL → Workspace-shared
--   workspace_id IS NOT NULL + owner_user_id IS NOT NULL → User-privat
--
-- Hotkey-Slot:
--   feature_templates.hotkey_slot ist hier nur Default-Hint. Effektive
--   Slot-Belegung pro Workspace lebt in workspace_hotkey_slots (WV.A.3).
--
-- Apply:
--   docker exec matrix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f 067_feature_templates_schema.sql
--
-- Alle DDL ist idempotent (CREATE TABLE IF NOT EXISTS / DROP POLICY
-- IF EXISTS) — Re-Apply auf Staging-State ist sicher.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── ENUM: template_visibility ────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_visibility') THEN
    CREATE TYPE public.template_visibility AS ENUM ('platform', 'workspace', 'user');
  END IF;
END $$;

-- ─── ENUM: template_render_position ───────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_render_position') THEN
    CREATE TYPE public.template_render_position AS ENUM ('hotkey_slot', 'auto_under_features');
  END IF;
END $$;

-- ─── ENUM: template_section_visibility ────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'template_section_visibility') THEN
    CREATE TYPE public.template_section_visibility AS ENUM ('always', 'edit_only');
  END IF;
END $$;

-- ─── feature_templates ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feature_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_user_id   uuid NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  symbol          text NULL,
  symbol_color    text NULL,
  hotkey_slot     int NULL CHECK (hotkey_slot IS NULL OR (hotkey_slot BETWEEN 1 AND 9)),
  is_global       boolean NOT NULL DEFAULT false,
  visibility      public.template_visibility NOT NULL,
  layout_version  int NOT NULL DEFAULT 1,
  title_template  text NULL,
  -- root_widget_id: DEFERRABLE damit zirkulaerer FK (template_widgets →
  -- template_sections → feature_templates) bei Two-Stage-Insert nicht
  -- bricht. ON DELETE SET NULL falls das referenzierte Widget weg ist.
  root_widget_id  uuid NULL,
  render_position public.template_render_position NOT NULL DEFAULT 'hotkey_slot',
  config          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- Visibility-Konsistenz: workspace_id+owner_user_id muessen zur
  -- visibility passen.
  CONSTRAINT feature_templates_visibility_consistent CHECK (
    (visibility = 'platform' AND workspace_id IS NULL AND owner_user_id IS NULL)
    OR (visibility = 'workspace' AND workspace_id IS NOT NULL AND owner_user_id IS NULL)
    OR (visibility = 'user' AND workspace_id IS NOT NULL AND owner_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS feature_templates_ws_idx ON public.feature_templates(workspace_id);
CREATE INDEX IF NOT EXISTS feature_templates_owner_idx ON public.feature_templates(owner_user_id) WHERE owner_user_id IS NOT NULL;
-- Partial UNIQUE: pro Workspace + Slot maximal eine aktive Belegung.
-- NULL workspace_id (Plattform-Vorlagen) sind unique pro Slot.
CREATE UNIQUE INDEX IF NOT EXISTS feature_templates_workspace_hotkey_slot_uniq
  ON public.feature_templates(workspace_id, hotkey_slot)
  WHERE hotkey_slot IS NOT NULL;

ALTER TABLE public.feature_templates ENABLE ROW LEVEL SECURITY;

-- ─── template_sections ────────────────────────────────────────
-- workspace_id ist denormalisiert (kopiert aus parent feature_template)
-- damit Workspace-Subtree-Reads + IDB-Cache + Realtime-Routing ohne
-- JOIN auskommen. Trigger _touch_template_section_workspace_id
-- pflegt die Spalte automatisch.
CREATE TABLE IF NOT EXISTS public.template_sections (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id       uuid NOT NULL REFERENCES public.feature_templates(id) ON DELETE CASCADE,
  workspace_id      uuid NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  position          numeric NOT NULL,
  title             text NULL,
  default_collapsed boolean NOT NULL DEFAULT false,
  visibility        public.template_section_visibility NOT NULL DEFAULT 'always',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS template_sections_template_idx ON public.template_sections(template_id, position);
CREATE INDEX IF NOT EXISTS template_sections_ws_idx ON public.template_sections(workspace_id) WHERE workspace_id IS NOT NULL;

ALTER TABLE public.template_sections ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._touch_template_section_workspace_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Auf INSERT/UPDATE: workspace_id aus parent feature_template kopieren.
  -- User-Patches auf workspace_id werden ueberschrieben (Single-Source
  -- ist parent).
  SELECT ft.workspace_id INTO NEW.workspace_id
  FROM public.feature_templates ft
  WHERE ft.id = NEW.template_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS template_sections_touch_workspace_id ON public.template_sections;
CREATE TRIGGER template_sections_touch_workspace_id
  BEFORE INSERT OR UPDATE OF template_id ON public.template_sections
  FOR EACH ROW EXECUTE FUNCTION public._touch_template_section_workspace_id();

-- ─── template_widgets ────────────────────────────────────────
-- workspace_id denormalisiert wie template_sections (zwei Layer hoch
-- via section.template_id → template.workspace_id).
CREATE TABLE IF NOT EXISTS public.template_widgets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id   uuid NOT NULL REFERENCES public.template_sections(id) ON DELETE CASCADE,
  workspace_id uuid NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  "column"     int NOT NULL DEFAULT 1 CHECK ("column" >= 1),
  position     numeric NOT NULL,
  type         text NOT NULL CHECK (type IN ('kanban','checklist','info','doc','link','calendar','smart_summary')),
  size_cols    int NOT NULL DEFAULT 12 CHECK (size_cols BETWEEN 1 AND 12),
  size_rows    int NOT NULL DEFAULT 6 CHECK (size_rows BETWEEN 1 AND 24),
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  toggles      jsonb NOT NULL DEFAULT '{}'::jsonb,
  config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS template_widgets_section_idx ON public.template_widgets(section_id, position);
CREATE INDEX IF NOT EXISTS template_widgets_ws_idx ON public.template_widgets(workspace_id) WHERE workspace_id IS NOT NULL;

ALTER TABLE public.template_widgets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._touch_template_widget_workspace_id()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  SELECT ts.workspace_id INTO NEW.workspace_id
  FROM public.template_sections ts
  WHERE ts.id = NEW.section_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS template_widgets_touch_workspace_id ON public.template_widgets;
CREATE TRIGGER template_widgets_touch_workspace_id
  BEFORE INSERT OR UPDATE OF section_id ON public.template_widgets
  FOR EACH ROW EXECUTE FUNCTION public._touch_template_widget_workspace_id();

-- ─── feature_templates.root_widget_id FK (Stage-2: nach widget) ──
-- Zirkulaer (feature_templates → template_widgets → template_sections →
-- feature_templates). DEFERRABLE INITIALLY DEFERRED erlaubt Two-Stage-
-- Insert in derselben Transaktion (Seed-Migration A.5).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'feature_templates_root_widget_id_fkey'
      AND conrelid = 'public.feature_templates'::regclass
  ) THEN
    ALTER TABLE public.feature_templates
      ADD CONSTRAINT feature_templates_root_widget_id_fkey
      FOREIGN KEY (root_widget_id) REFERENCES public.template_widgets(id)
      ON DELETE SET NULL
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- ─── RLS Policies — feature_templates ─────────────────────────
-- Plattform-Vorlagen: SELECT fuer alle authenticated, WRITE nur
-- platform_admin. Workspace-Vorlagen: SELECT/WRITE per
-- is_workspace_member/can_write_workspace. User-Vorlagen: SELECT/WRITE
-- nur Owner.

DROP POLICY IF EXISTS feature_templates_select ON public.feature_templates;
CREATE POLICY feature_templates_select ON public.feature_templates
  FOR SELECT USING (
    -- Plattform-Vorlagen sichtbar fuer alle authenticated.
    (visibility = 'platform')
    -- Workspace-Vorlagen sichtbar fuer Member.
    OR (visibility = 'workspace' AND public.is_workspace_member(workspace_id))
    -- User-Vorlagen sichtbar nur fuer den Owner (zusaetzlich Member-Pflicht).
    OR (visibility = 'user' AND owner_user_id = auth.uid() AND public.is_workspace_member(workspace_id))
  );

DROP POLICY IF EXISTS feature_templates_write ON public.feature_templates;
CREATE POLICY feature_templates_write ON public.feature_templates
  FOR ALL
  USING (
    -- Plattform-Vorlagen: nur platform_admin schreibt.
    (visibility = 'platform' AND EXISTS (
      SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
    ))
    -- Workspace-Vorlagen: jeder mit can_write_workspace.
    OR (visibility = 'workspace' AND public.can_write_workspace(workspace_id))
    -- User-Vorlagen: nur der Owner.
    OR (visibility = 'user' AND owner_user_id = auth.uid() AND public.is_workspace_member(workspace_id))
  )
  WITH CHECK (
    (visibility = 'platform' AND EXISTS (
      SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
    ))
    OR (visibility = 'workspace' AND public.can_write_workspace(workspace_id))
    OR (visibility = 'user' AND owner_user_id = auth.uid() AND public.is_workspace_member(workspace_id))
  );

-- ─── RLS Policies — template_sections ─────────────────────────
-- Vererbt aus parent template via JOIN.

DROP POLICY IF EXISTS template_sections_select ON public.template_sections;
CREATE POLICY template_sections_select ON public.template_sections
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.feature_templates ft
      WHERE ft.id = template_sections.template_id
        AND (
          ft.visibility = 'platform'
          OR (ft.visibility = 'workspace' AND public.is_workspace_member(ft.workspace_id))
          OR (ft.visibility = 'user' AND ft.owner_user_id = auth.uid()
              AND public.is_workspace_member(ft.workspace_id))
        )
    )
  );

DROP POLICY IF EXISTS template_sections_write ON public.template_sections;
CREATE POLICY template_sections_write ON public.template_sections
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.feature_templates ft
      WHERE ft.id = template_sections.template_id
        AND (
          (ft.visibility = 'platform' AND EXISTS (
            SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
          ))
          OR (ft.visibility = 'workspace' AND public.can_write_workspace(ft.workspace_id))
          OR (ft.visibility = 'user' AND ft.owner_user_id = auth.uid()
              AND public.is_workspace_member(ft.workspace_id))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.feature_templates ft
      WHERE ft.id = template_sections.template_id
        AND (
          (ft.visibility = 'platform' AND EXISTS (
            SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
          ))
          OR (ft.visibility = 'workspace' AND public.can_write_workspace(ft.workspace_id))
          OR (ft.visibility = 'user' AND ft.owner_user_id = auth.uid()
              AND public.is_workspace_member(ft.workspace_id))
        )
    )
  );

-- ─── RLS Policies — template_widgets ──────────────────────────
-- Vererbt aus template via section. Zwei-stage JOIN.

DROP POLICY IF EXISTS template_widgets_select ON public.template_widgets;
CREATE POLICY template_widgets_select ON public.template_widgets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.template_sections ts
      JOIN public.feature_templates ft ON ft.id = ts.template_id
      WHERE ts.id = template_widgets.section_id
        AND (
          ft.visibility = 'platform'
          OR (ft.visibility = 'workspace' AND public.is_workspace_member(ft.workspace_id))
          OR (ft.visibility = 'user' AND ft.owner_user_id = auth.uid()
              AND public.is_workspace_member(ft.workspace_id))
        )
    )
  );

DROP POLICY IF EXISTS template_widgets_write ON public.template_widgets;
CREATE POLICY template_widgets_write ON public.template_widgets
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.template_sections ts
      JOIN public.feature_templates ft ON ft.id = ts.template_id
      WHERE ts.id = template_widgets.section_id
        AND (
          (ft.visibility = 'platform' AND EXISTS (
            SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
          ))
          OR (ft.visibility = 'workspace' AND public.can_write_workspace(ft.workspace_id))
          OR (ft.visibility = 'user' AND ft.owner_user_id = auth.uid()
              AND public.is_workspace_member(ft.workspace_id))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.template_sections ts
      JOIN public.feature_templates ft ON ft.id = ts.template_id
      WHERE ts.id = template_widgets.section_id
        AND (
          (ft.visibility = 'platform' AND EXISTS (
            SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()
          ))
          OR (ft.visibility = 'workspace' AND public.can_write_workspace(ft.workspace_id))
          OR (ft.visibility = 'user' AND ft.owner_user_id = auth.uid()
              AND public.is_workspace_member(ft.workspace_id))
        )
    )
  );

-- ─── Grants ───────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.feature_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_sections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.template_widgets TO authenticated;
GRANT ALL ON public.feature_templates TO service_role;
GRANT ALL ON public.template_sections TO service_role;
GRANT ALL ON public.template_widgets TO service_role;

-- ─── Realtime: REPLICA IDENTITY FULL + Publication ────────────
ALTER TABLE public.feature_templates REPLICA IDENTITY FULL;
ALTER TABLE public.template_sections REPLICA IDENTITY FULL;
ALTER TABLE public.template_widgets REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'feature_templates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.feature_templates;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'template_sections'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.template_sections;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'template_widgets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.template_widgets;
  END IF;
END $$;

-- ─── updated_at Trigger ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public._touch_feature_templates_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS feature_templates_touch_updated_at ON public.feature_templates;
CREATE TRIGGER feature_templates_touch_updated_at
  BEFORE UPDATE ON public.feature_templates
  FOR EACH ROW EXECUTE FUNCTION public._touch_feature_templates_updated_at();

-- ─── Comments ────────────────────────────────────────────────
COMMENT ON TABLE public.feature_templates IS
  'WV.A.1 Vorlagen-Foundation. Plattform/Workspace/User-Visibility, Hotkey-Slot 1-9 (Default — effektiv via workspace_hotkey_slots WV.A.3), root_widget_id mit DEFERRABLE FK fuer zirkulaere Insert-Reihenfolge.';
COMMENT ON TABLE public.template_sections IS
  'WV.A.1 Vorlagen-Sections. Render-Sortierung via position (numeric).';
COMMENT ON TABLE public.template_widgets IS
  'WV.A.1 Vorlagen-Widgets. type aus dem 7er-Enum (kanban/checklist/info/doc/link/calendar/smart_summary). Daten in data/toggles/config jsonb.';

COMMIT;
