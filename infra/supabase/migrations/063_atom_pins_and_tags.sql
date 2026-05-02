-- ═══════════════════════════════════════════════════════════════
-- Welle D.1 — Atom-Pins + globales Tag-System
--
-- ❗ APPLY-HINWEIS: ALTER TABLE docs DROP COLUMN braucht Tabellen-
--    Eigentuemer-Rechte. supabase_admin oder docs-Owner. Apply via:
--      docker exec -i matrix-supabase-db psql -U supabase_admin \
--        -d postgres -v ON_ERROR_STOP=1 < 063_atom_pins_and_tags.sql
--
-- Drei Tabellen + 14 Cascade-Trigger fuer die Atom-Zwiebel-konsistente
-- Erweiterung der Doku auf alle Pin-Targets (Cell/Atom/Node) und das
-- globale Tag-System ueber alle Atom-Typen.
--
--   1. atom_pins         — generische "Atom A ist an Parent P gepinnt"-
--                          Relation. parent_kind ENUM: cell/atom/node/
--                          manifestation. Loest docs.attached_cell_id
--                          ab (sauberer Cut, kein Dual-Write).
--   2. workspace_tags    — Registry pro Workspace. Vier Tag-Kinds:
--                          freetext / atom_ref / object_ref / alias_ref.
--                          UNIQUE(ws, kind, value).
--   3. atom_tags         — Junction Atom→Tag. Tag-Owner = ausschliesslich
--                          Atom (Manifestation erbt vom Atom).
--
-- Schema-Quad:
--   - Schema:    diese Migration (Tabellen + Trigger + RLS + Realtime).
--   - Mutations: lib/atom-pins.ts + lib/atom-tags.ts (Welle D.3).
--   - MCP/Bridge: -- noch nicht; D.10 (V2 deferred).
--   - Export/Import: atom_pins + atom_tags + workspace_tags sind
--                    workspace-scoped, gehoeren in Workspace-Export.
--
-- Apply-Strategie: alles in einer Transaktion. Keine ENUM-Extends auf
-- existing Types (atom_parent_kind ist neu), kein CHECK-Recreate.
--
-- Clean-Cut-Annahme (User-Bestaetigung 2026-05-02): keine Production-
-- Daten in `docs` mit relevantem `content` oder `attached_cell_id`-
-- Bezug. → Backfill + DROP COLUMN + content clean-slate in derselben
-- Migration. Kein Dual-Write-Window.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── ENUM: atom_parent_kind ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'atom_parent_kind') THEN
    CREATE TYPE public.atom_parent_kind AS ENUM
      ('cell', 'atom', 'node', 'manifestation');
  END IF;
END $$;

COMMENT ON TYPE public.atom_parent_kind IS
  'Welle D.1 — Pin-Target. cell=cells.id, atom=tasks/links/docs/checklists/external_events.id (atom_type via context), node=nodes.id (matrix/board/sub-matrix), manifestation=atom_manifestations.id (V2-deferred).';

-- ─── TABELLE: atom_pins ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.atom_pins (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  atom_type     public.atom_type NOT NULL,
  atom_id       uuid NOT NULL,
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  parent_kind   public.atom_parent_kind NOT NULL,
  parent_id     uuid NOT NULL,
  position      numeric NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- Doppel-Pin desselben Atoms am selben Parent verboten. Multi-Pin
  -- (Atom an mehreren Parents) ist erlaubt — eine Wahrheit, viele
  -- Anker.
  CONSTRAINT atom_pins_unique
    UNIQUE (atom_type, atom_id, parent_kind, parent_id)
);

CREATE INDEX IF NOT EXISTS atom_pins_atom_idx
  ON public.atom_pins(atom_type, atom_id);
CREATE INDEX IF NOT EXISTS atom_pins_parent_idx
  ON public.atom_pins(parent_kind, parent_id);
CREATE INDEX IF NOT EXISTS atom_pins_ws_idx
  ON public.atom_pins(workspace_id);

COMMENT ON TABLE public.atom_pins IS
  'Welle D.1 — Generische Atom→Parent-Pin-Relation. Loest docs.attached_cell_id ab und erweitert auf alle Atom-Typen + Parent-Kinds. Eine Doku kann an Cell, Atom, Node (matrix/board) oder kuenftig Manifestation gepinnt sein.';
COMMENT ON COLUMN public.atom_pins.parent_id IS
  'Polymorpher Ref auf Parent. Tatsaechliche Existenz-Pruefung via Cascade-Trigger (siehe unten). Keine FK weil parent_kind diskriminiert.';

-- ─── TABELLE: workspace_tags ──────────────────────────────────
-- Registry der Tags pro Workspace. usage_count fuer GC + Sortierung.
CREATE TABLE IF NOT EXISTS public.workspace_tags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  value         text NOT NULL,
  display_label text,
  usage_count   integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workspace_tags_kind_check
    CHECK (kind IN ('freetext', 'atom_ref', 'object_ref', 'alias_ref')),

  -- Pro (workspace, kind, value) genau eine Registry-Zeile.
  CONSTRAINT workspace_tags_unique
    UNIQUE (workspace_id, kind, value)
);

CREATE INDEX IF NOT EXISTS workspace_tags_ws_kind_idx
  ON public.workspace_tags(workspace_id, kind);
CREATE INDEX IF NOT EXISTS workspace_tags_ws_value_idx
  ON public.workspace_tags(workspace_id, kind, lower(value));

COMMENT ON TABLE public.workspace_tags IS
  'Welle D.1 — Tag-Registry pro Workspace. value haelt den canonical Tag-Wert (freetext-String oder Target-UUID). display_label ist Snapshot (z.B. ^kuerzel-Anzeige). usage_count wird via atom_tags-Trigger gepflegt.';

-- ─── TABELLE: atom_tags ───────────────────────────────────────
-- Junction Atom→Tag. Tag-Owner ausschliesslich Atom (Manifestation erbt).
CREATE TABLE IF NOT EXISTS public.atom_tags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  atom_type     public.atom_type NOT NULL,
  atom_id       uuid NOT NULL,
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  tag_id        uuid NOT NULL REFERENCES public.workspace_tags(id) ON DELETE CASCADE,
  position      numeric NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT atom_tags_unique
    UNIQUE (atom_type, atom_id, tag_id)
);

CREATE INDEX IF NOT EXISTS atom_tags_atom_idx
  ON public.atom_tags(atom_type, atom_id);
CREATE INDEX IF NOT EXISTS atom_tags_tag_idx
  ON public.atom_tags(tag_id);
CREATE INDEX IF NOT EXISTS atom_tags_ws_idx
  ON public.atom_tags(workspace_id);

COMMENT ON TABLE public.atom_tags IS
  'Welle D.1 — Junction Atom→Tag. Eine Zeile pro konkreter Tag-Anwendung. Manifestationen erben Tags via atom_id-Lookup (kein eigener atom_tags-Eintrag).';

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.atom_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atom_pins FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS atom_pins_select ON public.atom_pins;
CREATE POLICY atom_pins_select ON public.atom_pins
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS atom_pins_write ON public.atom_pins;
CREATE POLICY atom_pins_write ON public.atom_pins
  FOR ALL
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.atom_pins TO authenticated;
GRANT ALL ON public.atom_pins TO service_role;

ALTER TABLE public.workspace_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_tags FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_tags_select ON public.workspace_tags;
CREATE POLICY workspace_tags_select ON public.workspace_tags
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS workspace_tags_write ON public.workspace_tags;
CREATE POLICY workspace_tags_write ON public.workspace_tags
  FOR ALL
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_tags TO authenticated;
GRANT ALL ON public.workspace_tags TO service_role;

ALTER TABLE public.atom_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atom_tags FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS atom_tags_select ON public.atom_tags;
CREATE POLICY atom_tags_select ON public.atom_tags
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS atom_tags_write ON public.atom_tags;
CREATE POLICY atom_tags_write ON public.atom_tags
  FOR ALL
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.atom_tags TO authenticated;
GRANT ALL ON public.atom_tags TO service_role;

-- ─── TRIGGER: atom_pins Source-Side Cascade (5 Atom-Typen) ────
-- Pattern aus Migration 044:113. Bei DELETE eines Atom-Source-Rows:
--   1. atom_pins purgen wo dieses Atom Owner ist (atom_type+atom_id)
--   2. atom_pins purgen wo dieses Atom als parent_kind='atom' Target ist
-- So sind dangling rows in beide Richtungen ausgeschlossen.

CREATE OR REPLACE FUNCTION public._atom_pins_purge_for_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_pins
   WHERE atom_type = 'task' AND atom_id = OLD.id;
  DELETE FROM public.atom_pins
   WHERE parent_kind = 'atom' AND parent_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_pins_purge_for_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_pins
   WHERE atom_type = 'link' AND atom_id = OLD.id;
  DELETE FROM public.atom_pins
   WHERE parent_kind = 'atom' AND parent_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_pins_purge_for_doc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_pins
   WHERE atom_type = 'doc' AND atom_id = OLD.id;
  DELETE FROM public.atom_pins
   WHERE parent_kind = 'atom' AND parent_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_pins_purge_for_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_pins
   WHERE atom_type = 'checklist' AND atom_id = OLD.id;
  DELETE FROM public.atom_pins
   WHERE parent_kind = 'atom' AND parent_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_pins_purge_for_imported_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_pins
   WHERE atom_type = 'imported_event' AND atom_id = OLD.id;
  DELETE FROM public.atom_pins
   WHERE parent_kind = 'atom' AND parent_id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS atom_pins_purge_on_task_delete ON public.tasks;
CREATE TRIGGER atom_pins_purge_on_task_delete
  BEFORE DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._atom_pins_purge_for_task();

DROP TRIGGER IF EXISTS atom_pins_purge_on_link_delete ON public.links;
CREATE TRIGGER atom_pins_purge_on_link_delete
  BEFORE DELETE ON public.links
  FOR EACH ROW EXECUTE FUNCTION public._atom_pins_purge_for_link();

DROP TRIGGER IF EXISTS atom_pins_purge_on_doc_delete ON public.docs;
CREATE TRIGGER atom_pins_purge_on_doc_delete
  BEFORE DELETE ON public.docs
  FOR EACH ROW EXECUTE FUNCTION public._atom_pins_purge_for_doc();

DROP TRIGGER IF EXISTS atom_pins_purge_on_checklist_delete ON public.checklists;
CREATE TRIGGER atom_pins_purge_on_checklist_delete
  BEFORE DELETE ON public.checklists
  FOR EACH ROW EXECUTE FUNCTION public._atom_pins_purge_for_checklist();

DROP TRIGGER IF EXISTS atom_pins_purge_on_imported_event_delete ON public.external_events;
CREATE TRIGGER atom_pins_purge_on_imported_event_delete
  BEFORE DELETE ON public.external_events
  FOR EACH ROW EXECUTE FUNCTION public._atom_pins_purge_for_imported_event();

-- ─── TRIGGER: atom_pins Parent-Side Cascade (Cell, Node) ──────
-- parent_kind='atom' ist bereits in den Source-Side-Triggern oben
-- abgedeckt. parent_kind='manifestation' bleibt V2-deferred (kein
-- Trigger noetig solange keine Rows existieren — V2 fuegt ihn dann
-- nach).

CREATE OR REPLACE FUNCTION public._atom_pins_purge_for_cell()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_pins
   WHERE parent_kind = 'cell' AND parent_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_pins_purge_for_node()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_pins
   WHERE parent_kind = 'node' AND parent_id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS atom_pins_purge_on_cell_delete ON public.cells;
CREATE TRIGGER atom_pins_purge_on_cell_delete
  BEFORE DELETE ON public.cells
  FOR EACH ROW EXECUTE FUNCTION public._atom_pins_purge_for_cell();

DROP TRIGGER IF EXISTS atom_pins_purge_on_node_delete ON public.nodes;
CREATE TRIGGER atom_pins_purge_on_node_delete
  BEFORE DELETE ON public.nodes
  FOR EACH ROW EXECUTE FUNCTION public._atom_pins_purge_for_node();

-- ─── TRIGGER: atom_tags Source-Side Cascade (5 Atom-Typen) ────
-- workspace_tags-Cascade lauft via FK ON DELETE CASCADE. Aber Atom-
-- Source-DELETE muessen wir manuell purgen (polymorph).

CREATE OR REPLACE FUNCTION public._atom_tags_purge_for_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_tags
   WHERE atom_type = 'task' AND atom_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_tags_purge_for_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_tags
   WHERE atom_type = 'link' AND atom_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_tags_purge_for_doc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_tags
   WHERE atom_type = 'doc' AND atom_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_tags_purge_for_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_tags
   WHERE atom_type = 'checklist' AND atom_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_tags_purge_for_imported_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_tags
   WHERE atom_type = 'imported_event' AND atom_id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS atom_tags_purge_on_task_delete ON public.tasks;
CREATE TRIGGER atom_tags_purge_on_task_delete
  BEFORE DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._atom_tags_purge_for_task();

DROP TRIGGER IF EXISTS atom_tags_purge_on_link_delete ON public.links;
CREATE TRIGGER atom_tags_purge_on_link_delete
  BEFORE DELETE ON public.links
  FOR EACH ROW EXECUTE FUNCTION public._atom_tags_purge_for_link();

DROP TRIGGER IF EXISTS atom_tags_purge_on_doc_delete ON public.docs;
CREATE TRIGGER atom_tags_purge_on_doc_delete
  BEFORE DELETE ON public.docs
  FOR EACH ROW EXECUTE FUNCTION public._atom_tags_purge_for_doc();

DROP TRIGGER IF EXISTS atom_tags_purge_on_checklist_delete ON public.checklists;
CREATE TRIGGER atom_tags_purge_on_checklist_delete
  BEFORE DELETE ON public.checklists
  FOR EACH ROW EXECUTE FUNCTION public._atom_tags_purge_for_checklist();

DROP TRIGGER IF EXISTS atom_tags_purge_on_imported_event_delete ON public.external_events;
CREATE TRIGGER atom_tags_purge_on_imported_event_delete
  BEFORE DELETE ON public.external_events
  FOR EACH ROW EXECUTE FUNCTION public._atom_tags_purge_for_imported_event();

-- ─── TRIGGER: workspace_tags.usage_count Pflege ───────────────
-- usage_count wird automatisch auf atom_tags INSERT/DELETE gepflegt.
-- gc_workspace_tags-RPC kann spaeter Tags mit usage_count=0 purgen.

CREATE OR REPLACE FUNCTION public._workspace_tags_bump_usage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.workspace_tags
       SET usage_count = usage_count + 1
     WHERE id = NEW.tag_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.workspace_tags
       SET usage_count = GREATEST(usage_count - 1, 0)
     WHERE id = OLD.tag_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS workspace_tags_usage_bump ON public.atom_tags;
CREATE TRIGGER workspace_tags_usage_bump
  AFTER INSERT OR DELETE ON public.atom_tags
  FOR EACH ROW EXECUTE FUNCTION public._workspace_tags_bump_usage();

-- ─── BACKFILL atom_pins aus docs.attached_cell_id ─────────────
-- Sauberer Cut, kein Dual-Write. ON CONFLICT DO NOTHING fuer
-- Idempotenz (Migration mehrfach apply-bar, aber attached_cell_id
-- wird gleich danach gedroppt — die Idempotenz greift nur fuer
-- mehrfache Apply-Versuche bevor DROP COLUMN durchlief).
INSERT INTO public.atom_pins (
  atom_type, atom_id, workspace_id, parent_kind, parent_id, position
)
SELECT
  'doc'::public.atom_type,
  d.id,
  d.workspace_id,
  'cell'::public.atom_parent_kind,
  d.attached_cell_id,
  0
FROM public.docs d
WHERE d.attached_cell_id IS NOT NULL
ON CONFLICT (atom_type, atom_id, parent_kind, parent_id) DO NOTHING;

-- ─── docs.attached_cell_id direkt droppen ─────────────────────
-- Keine Production-Daten → kein Dual-Write-Window noetig.
ALTER TABLE public.docs DROP COLUMN IF EXISTS attached_cell_id;

-- ─── docs.content auf clean-slate HTML setzen ─────────────────
-- ProseMirror erwartet HTML. Bestehende leere/markdown-Contents
-- werden durch ein leeres <p></p>-Document ersetzt. User-Briefing:
-- keine relevanten Doc-Inhalte vorhanden.
UPDATE public.docs
   SET content = '<p></p>'
 WHERE content IS NULL
    OR btrim(content) = ''
    OR substring(btrim(content) FROM 1 FOR 1) <> '<';

-- ─── Realtime-Publication ─────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'atom_pins'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.atom_pins;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'workspace_tags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_tags;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'atom_tags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.atom_tags;
  END IF;
END $$;

COMMIT;

-- ─── Smoke-Verifikation (manuell nach Apply) ─────────────────
-- 1. \d atom_pins atom_tags workspace_tags
-- 2. SELECT count(*) FROM atom_pins WHERE atom_type='doc' AND parent_kind='cell';
--    -- == count(*) docs WHERE attached_cell_id war NOT NULL (vor Apply)
-- 3. SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--      WHERE relname IN ('atom_pins','workspace_tags','atom_tags');
--    -- alle 3 mit beiden Spalten = true
-- 4. SELECT count(*) FROM information_schema.triggers
--      WHERE trigger_name LIKE 'atom_pins_purge%' OR trigger_name LIKE 'atom_tags_purge%';
--    -- == 12 (5 atom_pins source + 2 atom_pins parent + 5 atom_tags source)
-- 5. \d docs — attached_cell_id ist weg, content ist <p></p> oder bestehendes HTML.
