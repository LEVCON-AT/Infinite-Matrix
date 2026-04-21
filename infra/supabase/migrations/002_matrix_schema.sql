-- ═══════════════════════════════════════════════════════════════
-- Phase 0c.2 — Matrix/Kanban/Checklist-Schema
--
-- Abbildung des heutigen Client-JSON-Modells (nodes/cells/kb_cards/
-- checklists/links) als relationales Schema, pro Workspace isoliert.
--
-- Kern-Pattern fuer Tenant-Isolation: jede Tabelle traegt workspace_id.
-- Composite-FKs (id, workspace_id) -> parent(id, workspace_id) stellen
-- sicher, dass Kinder nicht in einen anderen Workspace ausreissen
-- koennen. RLS-Policies pruefen direkt workspace_id (ohne JOIN) und
-- nutzen is_workspace_member / workspace_role_of aus 001_workspaces.
--
-- Idempotent: IF NOT EXISTS / OR REPLACE / DO-Bloecke.
-- Reihenfolge:
--   1. Enums
--   2. nodes (forward-declared parent_cell_id, FK spaeter)
--   3. rows, cols, cells
--   4. FK nodes.parent_cell_id -> cells
--   5. kb_cols, kb_cards
--   6. checklists, checklist_items
--   7. links
--   8. audit_log
--   9. Indexes, Trigger, RLS, Grants
-- ═══════════════════════════════════════════════════════════════

-- ─── Enums ────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'node_type') THEN
    CREATE TYPE public.node_type AS ENUM ('matrix','board');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'link_type') THEN
    CREATE TYPE public.link_type AS ENUM ('url','mail');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checklist_close_mode') THEN
    CREATE TYPE public.checklist_close_mode AS ENUM ('manual','auto-prompt','auto-silent');
  END IF;
END $$;

-- ─── nodes ────────────────────────────────────────────────────
-- Eine Zeile pro Matrix ODER Board. parent_cell_id zeigt auf die
-- Zelle, in der dieser Node als Sub-Feature lebt (NULL fuer Root).
CREATE TABLE IF NOT EXISTS public.nodes (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type           public.node_type NOT NULL,
  label          text NOT NULL,
  alias          text,
  parent_cell_id uuid, -- FK wird nach cells-Definition hinzugefuegt
  data           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (id, workspace_id)
);
CREATE INDEX IF NOT EXISTS nodes_workspace_idx    ON public.nodes(workspace_id);
CREATE INDEX IF NOT EXISTS nodes_parent_cell_idx  ON public.nodes(parent_cell_id);
CREATE UNIQUE INDEX IF NOT EXISTS nodes_alias_uq
  ON public.nodes(workspace_id, lower(alias))
  WHERE alias IS NOT NULL;

COMMENT ON TABLE public.nodes IS
  'Matrix oder Board. Hierarchie via parent_cell_id (Cell in anderer Matrix).';

-- ─── rows ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rows (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matrix_id    uuid NOT NULL,
  workspace_id uuid NOT NULL,
  label        text NOT NULL DEFAULT '',
  position     int  NOT NULL DEFAULT 0,
  FOREIGN KEY (matrix_id, workspace_id)
    REFERENCES public.nodes(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS rows_matrix_idx ON public.rows(matrix_id, position);

-- ─── cols ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cols (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matrix_id    uuid NOT NULL,
  workspace_id uuid NOT NULL,
  label        text NOT NULL DEFAULT '',
  position     int  NOT NULL DEFAULT 0,
  FOREIGN KEY (matrix_id, workspace_id)
    REFERENCES public.nodes(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS cols_matrix_idx ON public.cols(matrix_id, position);

-- ─── cells ────────────────────────────────────────────────────
-- features: Array der aktivierten Feature-Keys ('info','board','matrix','checklists').
-- child_matrix_id / board_id: Verweise auf Sub-Nodes (falls Feature aktiv).
CREATE TABLE IF NOT EXISTS public.cells (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL,
  matrix_id       uuid NOT NULL,
  row_id          uuid NOT NULL REFERENCES public.rows(id) ON DELETE CASCADE,
  col_id          uuid NOT NULL REFERENCES public.cols(id) ON DELETE CASCADE,
  alias           text,
  features        text[] NOT NULL DEFAULT ARRAY[]::text[],
  child_matrix_id uuid,
  board_id        uuid,
  data            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (id, workspace_id),
  UNIQUE (matrix_id, row_id, col_id),
  FOREIGN KEY (matrix_id, workspace_id)
    REFERENCES public.nodes(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (child_matrix_id, workspace_id)
    REFERENCES public.nodes(id, workspace_id) ON DELETE SET NULL,
  FOREIGN KEY (board_id, workspace_id)
    REFERENCES public.nodes(id, workspace_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS cells_matrix_idx ON public.cells(matrix_id);
CREATE INDEX IF NOT EXISTS cells_board_idx  ON public.cells(board_id);
CREATE INDEX IF NOT EXISTS cells_child_idx  ON public.cells(child_matrix_id);
CREATE UNIQUE INDEX IF NOT EXISTS cells_alias_uq
  ON public.cells(workspace_id, lower(alias))
  WHERE alias IS NOT NULL;

-- ─── nodes.parent_cell_id FK (circular, nach cells) ───────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'nodes_parent_cell_id_fkey'
  ) THEN
    ALTER TABLE public.nodes
      ADD CONSTRAINT nodes_parent_cell_id_fkey
      FOREIGN KEY (parent_cell_id) REFERENCES public.cells(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── kb_cols (Kanban-Spalten eines Boards) ────────────────────
CREATE TABLE IF NOT EXISTS public.kb_cols (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  board_id     uuid NOT NULL,
  label        text NOT NULL DEFAULT '',
  position     int  NOT NULL DEFAULT 0,
  color        text,
  FOREIGN KEY (board_id, workspace_id)
    REFERENCES public.nodes(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS kb_cols_board_idx ON public.kb_cols(board_id, position);

-- ─── kb_cards (Kanban-Karten) ─────────────────────────────────
-- checklist_ref: Referenz auf Standalone-Checkliste (V2.4 ref-mode).
-- checklist:     Inline-Checkliste als JSONB (V2.4 inline-mode).
-- recur:         jsonb (type/every/weekday/monthType/day/endType/endDate/endCount/startDate).
CREATE TABLE IF NOT EXISTS public.kb_cards (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL,
  board_id         uuid NOT NULL,
  col_id           uuid NOT NULL REFERENCES public.kb_cols(id) ON DELETE CASCADE,
  alias            text,
  name             text NOT NULL DEFAULT '',
  note             text NOT NULL DEFAULT '',
  tags             text[] NOT NULL DEFAULT ARRAY[]::text[],
  who              text[] NOT NULL DEFAULT ARRAY[]::text[],
  deadline         date,
  priority         int,
  done             boolean NOT NULL DEFAULT false,
  archived         boolean NOT NULL DEFAULT false,
  position         int NOT NULL DEFAULT 0,
  recur            jsonb,
  done_occurrences date[] NOT NULL DEFAULT ARRAY[]::date[],
  source_cl_id     uuid,
  source_label     text,
  checklist_ref    uuid, -- FK spaeter (checklists existiert noch nicht)
  checklist        jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (board_id, workspace_id)
    REFERENCES public.nodes(id, workspace_id) ON DELETE CASCADE,
  CHECK (checklist_ref IS NULL OR checklist IS NULL)
);
CREATE INDEX IF NOT EXISTS kb_cards_board_idx    ON public.kb_cards(board_id);
CREATE INDEX IF NOT EXISTS kb_cards_col_idx      ON public.kb_cards(col_id, position);
CREATE INDEX IF NOT EXISTS kb_cards_deadline_idx ON public.kb_cards(board_id, deadline)
  WHERE deadline IS NOT NULL AND archived = false;
CREATE UNIQUE INDEX IF NOT EXISTS kb_cards_alias_uq
  ON public.kb_cards(workspace_id, lower(alias))
  WHERE alias IS NOT NULL;

-- ─── checklists (Standalone-Checklisten am Board) ─────────────
CREATE TABLE IF NOT EXISTS public.checklists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  board_id     uuid NOT NULL,
  label        text NOT NULL DEFAULT '',
  position     int  NOT NULL DEFAULT 0,
  recur        jsonb,
  close_mode   public.checklist_close_mode NOT NULL DEFAULT 'auto-prompt',
  action       jsonb,
  history      jsonb NOT NULL DEFAULT '[]'::jsonb,
  alias        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (board_id, workspace_id)
    REFERENCES public.nodes(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS checklists_board_idx ON public.checklists(board_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS checklists_alias_uq
  ON public.checklists(workspace_id, lower(alias))
  WHERE alias IS NOT NULL;

-- ─── kb_cards.checklist_ref FK (nach checklists) ──────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kb_cards_checklist_ref_fkey'
  ) THEN
    ALTER TABLE public.kb_cards
      ADD CONSTRAINT kb_cards_checklist_ref_fkey
      FOREIGN KEY (checklist_ref) REFERENCES public.checklists(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kb_cards_source_cl_fkey'
  ) THEN
    ALTER TABLE public.kb_cards
      ADD CONSTRAINT kb_cards_source_cl_fkey
      FOREIGN KEY (source_cl_id) REFERENCES public.checklists(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ─── checklist_items ──────────────────────────────────────────
-- level 0..2 (Nesting); position fuer Reihenfolge innerhalb der Checkliste.
CREATE TABLE IF NOT EXISTS public.checklist_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL,
  checklist_id  uuid NOT NULL REFERENCES public.checklists(id) ON DELETE CASCADE,
  text          text NOT NULL DEFAULT '',
  done          boolean NOT NULL DEFAULT false,
  level         smallint NOT NULL DEFAULT 0 CHECK (level BETWEEN 0 AND 2),
  position      int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS checklist_items_cl_idx
  ON public.checklist_items(checklist_id, position);

-- ─── links (URLs + Mail-Vorlagen am Board) ────────────────────
CREATE TABLE IF NOT EXISTS public.links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  board_id     uuid NOT NULL,
  type         public.link_type NOT NULL,
  label        text NOT NULL DEFAULT '',
  url          text NOT NULL DEFAULT '',
  alias        text,
  position     int NOT NULL DEFAULT 0,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (board_id, workspace_id)
    REFERENCES public.nodes(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS links_board_idx ON public.links(board_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS links_alias_uq
  ON public.links(workspace_id, lower(alias))
  WHERE alias IS NOT NULL;

-- ─── audit_log ────────────────────────────────────────────────
-- Append-only. Jeder Tool-Call (Bridge/Client) schreibt hierhin.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id           bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  args         jsonb,
  result       jsonb,
  ok           boolean NOT NULL DEFAULT true,
  ts           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_ws_ts_idx ON public.audit_log(workspace_id, ts DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_idx  ON public.audit_log(user_id, ts DESC);

-- ─── updated_at-Trigger ───────────────────────────────────────
DROP TRIGGER IF EXISTS nodes_set_updated_at ON public.nodes;
CREATE TRIGGER nodes_set_updated_at
  BEFORE UPDATE ON public.nodes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS cells_set_updated_at ON public.cells;
CREATE TRIGGER cells_set_updated_at
  BEFORE UPDATE ON public.cells
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS kb_cards_set_updated_at ON public.kb_cards;
CREATE TRIGGER kb_cards_set_updated_at
  BEFORE UPDATE ON public.kb_cards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS checklists_set_updated_at ON public.checklists;
CREATE TRIGGER checklists_set_updated_at
  BEFORE UPDATE ON public.checklists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS aktivieren ───────────────────────────────────────────
ALTER TABLE public.nodes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rows             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cols             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cells            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_cols          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_cards         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklists       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.links            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log        ENABLE ROW LEVEL SECURITY;

-- ─── RLS-Policies — uniformes Schema ──────────────────────────
-- SELECT: jeder Workspace-Member (inkl. viewer).
-- Schreiben (INSERT/UPDATE/DELETE): owner/admin/editor; viewer nur read.

-- helper: workspace-write-privileg
CREATE OR REPLACE FUNCTION public.can_write_workspace(wid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT public.workspace_role_of(wid) IN ('owner','admin','editor');
$$;

GRANT EXECUTE ON FUNCTION public.can_write_workspace(uuid) TO anon, authenticated, service_role;

-- Makro-artiges Anlegen via DO-Block, damit wir nicht 40 Policies duplizieren.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'nodes','rows','cols','cells',
    'kb_cols','kb_cards','checklists','checklist_items','links'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON public.%1$s', t);
    EXECUTE format(
      'CREATE POLICY %1$s_select ON public.%1$s
         FOR SELECT USING (public.is_workspace_member(workspace_id))',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS %1$s_write ON public.%1$s', t);
    EXECUTE format(
      'CREATE POLICY %1$s_write ON public.%1$s
         FOR ALL
         USING (public.can_write_workspace(workspace_id))
         WITH CHECK (public.can_write_workspace(workspace_id))',
      t
    );
  END LOOP;
END $$;

-- audit_log: SELECT nur owner/admin, INSERT jeder Member (fuer eigene Aktionen),
-- kein UPDATE/DELETE.
DROP POLICY IF EXISTS audit_log_select ON public.audit_log;
CREATE POLICY audit_log_select ON public.audit_log
  FOR SELECT USING (public.workspace_role_of(workspace_id) IN ('owner','admin'));

DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;
CREATE POLICY audit_log_insert ON public.audit_log
  FOR INSERT WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- ─── Grants ───────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'nodes','rows','cols','cells',
    'kb_cols','kb_cards','checklists','checklist_items','links'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.audit_log_id_seq TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
GRANT ALL ON SEQUENCE public.audit_log_id_seq TO service_role;
