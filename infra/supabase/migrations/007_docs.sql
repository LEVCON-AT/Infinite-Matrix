-- ═══════════════════════════════════════════════════════════════
-- Phase 0e.3 — Dokumentations-Entitaet
--
-- Docs sind freischwebende Markdown-Light-Notizen pro Workspace.
-- Anders als Node-Description (an Matrix/Board) oder Card-Note
-- (an Karte) haben sie keinen verpflichtenden Parent — sie leben
-- am Workspace. Ein optionaler attached_cell_id erlaubt Anzeige
-- im Info/Checklisten-Bereich einer Zelle; ein optionaler
-- source_alias dokumentiert den Ursprung (Karte/Matrix, von wo
-- aus die Doku angelegt wurde).
--
-- Warum eigene Tabelle, nicht JSONB an existierender Tabelle:
--   - Alias-Quicknav braucht eindeutige Eintraege pro Alias.
--     Eine Doku mit eigenem Alias soll wie eine Matrix/Card
--     aufgeloest werden koennen — UNIQUE-Index auf
--     (workspace_id, lower(alias)) analog zu kb_cards.
--   - Global-Search soll title+content ilike'n — separate Spalten
--     statt JSONB-Cast.
--   - Realtime: eigene Publication-Entry, damit docs auch in
--     Multi-Tab-Sessions aktuell bleiben.
--
-- Idempotent: IF NOT EXISTS / pg_constraint-Checks.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.docs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  alias            text,
  title            text NOT NULL DEFAULT '',
  content          text NOT NULL DEFAULT '',
  source_alias     text,
  attached_cell_id uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Composite-FK auf cells (id, workspace_id) — dieselbe Konvention
-- wie checklists. ON DELETE SET NULL: Zelle weg -> Doku bleibt
-- freischwebend auffindbar (via Shift+D / Search). Kein Datenverlust.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'docs_attached_cell_fkey'
  ) THEN
    ALTER TABLE public.docs
      ADD CONSTRAINT docs_attached_cell_fkey
      FOREIGN KEY (attached_cell_id, workspace_id)
      REFERENCES public.cells(id, workspace_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS docs_workspace_idx
  ON public.docs(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS docs_attached_cell_idx
  ON public.docs(attached_cell_id, updated_at DESC)
  WHERE attached_cell_id IS NOT NULL;

-- Alias case-insensitive unique pro Workspace. Analog zu kb_cards.
CREATE UNIQUE INDEX IF NOT EXISTS docs_alias_uq
  ON public.docs(workspace_id, lower(alias))
  WHERE alias IS NOT NULL;

-- ─── updated_at-Trigger ───────────────────────────────────────
DROP TRIGGER IF EXISTS docs_set_updated_at ON public.docs;
CREATE TRIGGER docs_set_updated_at
  BEFORE UPDATE ON public.docs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS aktivieren ───────────────────────────────────────────
ALTER TABLE public.docs ENABLE ROW LEVEL SECURITY;

-- SELECT: jeder Workspace-Member (inkl. viewer).
-- Schreiben: owner/admin/editor.
DROP POLICY IF EXISTS docs_select ON public.docs;
CREATE POLICY docs_select ON public.docs
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS docs_write ON public.docs;
CREATE POLICY docs_write ON public.docs
  FOR ALL
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

-- ─── Grants ───────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.docs TO authenticated;
GRANT ALL ON public.docs TO service_role;

-- ─── Realtime-Publication ─────────────────────────────────────
-- Analog zu Migration 005: Tabelle zur supabase_realtime-Publication
-- hinzufuegen (idempotent via pg_publication_tables-Check) und
-- REPLICA IDENTITY FULL fuer workspace_id im DELETE-Payload.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'docs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.docs;
  END IF;
END $$;

ALTER TABLE public.docs REPLICA IDENTITY FULL;

COMMENT ON TABLE public.docs IS
  'Freischwebende Markdown-Dokumente pro Workspace. Optional via attached_cell_id an eine Zelle gehaengt; optional mit source_alias versehen (Ursprungs-Referenz).';
