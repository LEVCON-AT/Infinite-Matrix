-- ═══════════════════════════════════════════════════════════════
-- Phase 4 T.AC.A.1 — Atom-Manifestations (polymorphe Sicht-Tabelle)
--
-- Nicht nur Tasks, sondern auch Links und Checklisten (als Ganzes,
-- nicht ihre Items) sollen kalendarmanifestiert werden koennen.
-- Vision aus Plan T.AC: "JEDES Atom (Task / Checkliste / Link / Doc)
-- kann calendar-manifestiert werden."
--
-- Schema-Variante C (siehe Plan): polymorphes (atom_type, atom_id)
-- Pair statt FK auf eine konkrete Tabelle. Cascade-Delete via
-- DB-Trigger statt FK (ist mit polymorphem Ref nicht moeglich).
--
-- Diese Migration ist Sub-Sprint A.1: Schema + Backfill + Sync-
-- Trigger task_manifestations → atom_manifestations. Bestehender
-- Code liest/schreibt weiterhin task_manifestations; jeder Schreib-
-- Vorgang wird automatisch in atom_manifestations gespiegelt. A.2-A.4
-- schalten den Code nach atom_manifestations um und entfernen das
-- Spiegeln.
--
-- Konsequenz: nach A.1 Apply ist atom_manifestations fertig befuellt
-- und konsistent zu task_manifestations. Verifikation per
-- count(*)-Diff am Ende.
-- ═══════════════════════════════════════════════════════════════

-- ─── Enum: atom_type ───────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'atom_type') THEN
    CREATE TYPE public.atom_type AS ENUM
      ('task', 'link', 'doc', 'checklist');
  END IF;
END $$;

-- ─── Enum: atom_manifestation_kind (re-uses task_manifestation_kind) ──
-- Wir behalten dieselben Kind-Werte (kanban/checklist/calendar/
-- standalone). Spaetere Kinds (z.B. 'flowchart') werden hier ergaenzt.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'atom_manifestation_kind') THEN
    CREATE TYPE public.atom_manifestation_kind AS ENUM
      ('kanban', 'checklist', 'calendar', 'standalone');
  END IF;
END $$;

-- ─── Tabelle: atom_manifestations ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.atom_manifestations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  atom_type     public.atom_type NOT NULL,
  atom_id       uuid NOT NULL,
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind          public.atom_manifestation_kind NOT NULL,
  container_id  uuid,
  position      numeric NOT NULL DEFAULT 0,
  level         smallint,
  display_meta  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- level nur bei kind='checklist' sinnvoll.
  CONSTRAINT atom_manifestations_level_check
    CHECK (
      (kind = 'checklist' AND level IS NOT NULL AND level BETWEEN 0 AND 2)
      OR (kind <> 'checklist' AND level IS NULL)
    ),

  -- container_id Pflicht bei kind='kanban'/'checklist'.
  CONSTRAINT atom_manifestations_container_check
    CHECK (
      (kind IN ('kanban','checklist') AND container_id IS NOT NULL)
      OR (kind IN ('calendar','standalone') AND container_id IS NULL)
    ),

  -- Polymorpher Ref: atom_type bestimmt, in welcher Tabelle atom_id
  -- liegt. Tatsaechliche Existenz-Pruefung passiert via Trigger
  -- (atom_purge_on_delete unten) bzw. im Mutations-Layer.
  CONSTRAINT atom_manifestations_atom_type_check
    CHECK (atom_type IN ('task','link','doc','checklist'))
);

CREATE INDEX IF NOT EXISTS atom_manifestations_atom_idx
  ON public.atom_manifestations(atom_type, atom_id);
CREATE INDEX IF NOT EXISTS atom_manifestations_ws_kind_idx
  ON public.atom_manifestations(workspace_id, kind);
CREATE INDEX IF NOT EXISTS atom_manifestations_container_pos_idx
  ON public.atom_manifestations(container_id, position)
  WHERE container_id IS NOT NULL;

COMMENT ON TABLE public.atom_manifestations IS
  'Phase 4 T.AC.A — polymorphe Manifestation. Ein Atom (task/link/doc/checklist) kann in mehreren Sichten erscheinen. Loest task_manifestations als Single-Source-of-Truth ab (Code-Switch in T.AC.A.2).';
COMMENT ON COLUMN public.atom_manifestations.atom_type IS
  'Diskriminator. atom_id verweist auf die Tabelle dieses Typs (task→tasks.id, link→links.id, doc→docs.id, checklist→checklists.id).';

-- ─── RLS: einheitliches Pattern ────────────────────────────────
ALTER TABLE public.atom_manifestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.atom_manifestations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS atom_manifestations_select ON public.atom_manifestations;
CREATE POLICY atom_manifestations_select ON public.atom_manifestations
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS atom_manifestations_write ON public.atom_manifestations;
CREATE POLICY atom_manifestations_write ON public.atom_manifestations
  FOR ALL
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.atom_manifestations TO authenticated;
GRANT ALL ON public.atom_manifestations TO service_role;

-- ─── Trigger: Pseudo-CASCADE bei Source-Atom-Delete ───────────
-- FK-CASCADE geht nicht polymorph. Stattdessen: nach DELETE auf
-- tasks/links/docs/checklists die zugehoerigen atom_manifestations
-- explizit purgen.
CREATE OR REPLACE FUNCTION public._atom_manif_purge_for_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_manifestations
   WHERE atom_type = 'task' AND atom_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_manif_purge_for_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_manifestations
   WHERE atom_type = 'link' AND atom_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_manif_purge_for_doc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_manifestations
   WHERE atom_type = 'doc' AND atom_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_manif_purge_for_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_manifestations
   WHERE atom_type = 'checklist' AND atom_id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS atom_manif_purge_on_task_delete ON public.tasks;
CREATE TRIGGER atom_manif_purge_on_task_delete
  BEFORE DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._atom_manif_purge_for_task();

DROP TRIGGER IF EXISTS atom_manif_purge_on_link_delete ON public.links;
CREATE TRIGGER atom_manif_purge_on_link_delete
  BEFORE DELETE ON public.links
  FOR EACH ROW EXECUTE FUNCTION public._atom_manif_purge_for_link();

DROP TRIGGER IF EXISTS atom_manif_purge_on_doc_delete ON public.docs;
CREATE TRIGGER atom_manif_purge_on_doc_delete
  BEFORE DELETE ON public.docs
  FOR EACH ROW EXECUTE FUNCTION public._atom_manif_purge_for_doc();

DROP TRIGGER IF EXISTS atom_manif_purge_on_checklist_delete ON public.checklists;
CREATE TRIGGER atom_manif_purge_on_checklist_delete
  BEFORE DELETE ON public.checklists
  FOR EACH ROW EXECUTE FUNCTION public._atom_manif_purge_for_checklist();

-- ─── Sync-Trigger: task_manifestations ↔ atom_manifestations ──
-- Solange der Client-Code an task_manifestations haengt (T.AC.A.2 macht
-- den Switch), spiegelt jeder INSERT/UPDATE/DELETE dort in
-- atom_manifestations. atom_id = task_id; atom_type = 'task'.
--
-- Wir nutzen einen Session-Setting-Hack ('atom.skip_mirror') um
-- Zirkularitaet zu vermeiden — nach A.2 wenn der Code direkt in
-- atom_manifestations schreibt, setzt das Mutations-Layer das Setting,
-- damit hier kein Echo entsteht.

CREATE OR REPLACE FUNCTION public._task_manif_sync_to_atom()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_skip text;
BEGIN
  BEGIN
    v_skip := current_setting('atom.skip_mirror', true);
  EXCEPTION WHEN OTHERS THEN
    v_skip := NULL;
  END;
  IF v_skip = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.atom_manifestations (
      id, atom_type, atom_id, workspace_id, kind, container_id,
      position, level, display_meta, created_at
    ) VALUES (
      NEW.id, 'task', NEW.task_id, NEW.workspace_id, NEW.kind::text::public.atom_manifestation_kind,
      NEW.container_id, NEW.position, NEW.level, NEW.display_meta, NEW.created_at
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.atom_manifestations SET
      atom_id = NEW.task_id,
      workspace_id = NEW.workspace_id,
      kind = NEW.kind::text::public.atom_manifestation_kind,
      container_id = NEW.container_id,
      position = NEW.position,
      level = NEW.level,
      display_meta = NEW.display_meta
    WHERE id = NEW.id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.atom_manifestations WHERE id = OLD.id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS task_manif_sync_to_atom ON public.task_manifestations;
CREATE TRIGGER task_manif_sync_to_atom
  AFTER INSERT OR UPDATE OR DELETE ON public.task_manifestations
  FOR EACH ROW EXECUTE FUNCTION public._task_manif_sync_to_atom();

-- ─── Backfill: bestehende task_manifestations spiegeln ────────
-- Idempotent dank ON CONFLICT — A.1 mehrfach apply-bar.
INSERT INTO public.atom_manifestations (
  id, atom_type, atom_id, workspace_id, kind, container_id,
  position, level, display_meta, created_at
)
SELECT
  tm.id,
  'task'::public.atom_type,
  tm.task_id,
  tm.workspace_id,
  tm.kind::text::public.atom_manifestation_kind,
  tm.container_id,
  tm.position,
  tm.level,
  tm.display_meta,
  tm.created_at
FROM public.task_manifestations tm
ON CONFLICT (id) DO NOTHING;

-- ─── Smoke-Verifikation (manuell nach Apply) ─────────────────
-- 1. SELECT count(*) FROM public.task_manifestations;
-- 2. SELECT count(*) FROM public.atom_manifestations WHERE atom_type='task';
--    -- (1) und (2) muessen identisch sein.
-- 3. INSERT INTO public.task_manifestations(...) — der neue Row landet
--    automatisch auch in atom_manifestations.
-- 4. DELETE FROM public.tasks WHERE id = 'X' — atom_manifestations
--    fuer task_id=X werden gepurgt (BEFORE DELETE Trigger).
-- 5. SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--      WHERE relname = 'atom_manifestations';
--    -- beide Spalten = true.
