-- ═══════════════════════════════════════════════════════════════
-- Phase 4 Welle T.1.A — Task-Layer Schema-Foundation (ECS-Pattern)
--
-- Atomares Aufgaben-Element (Layer 0 = tasks) + Manifestations
-- (Layer 1 = task_manifestations). Eine Task existiert genau einmal,
-- erscheint aber in mehreren Sichten (Kanban, Checklist, Calendar,
-- Standalone). Pattern analog Migration 030 (Object-Layer).
--
-- Layer 2 (task_dependencies), Layer 3 (task_rules), Layer 4
-- (task_comments / task_attachments / task_docs) folgen in T.3 / T.4
-- / T.2 — diese Migration legt nur Layer 0 + 1.
--
-- Schema-Vier-Artefakte-Regel: Mutations (T.1.C), MCP-Tools (T.1.H),
-- Export/Import (T.1.I) folgen in nachgelagerten Sub-Sprints.
--
-- Re-Use:
--   - is_workspace_member / can_write_workspace (existieren seit 002)
--   - set_updated_at-Trigger-Function (existiert seit 001)
--   - Pattern aus 030_object_layer.sql + 037_b1_security_patch.sql
--     (FORCE RLS direkt aktiviert — Lesson aus AU-B1 K1).
-- ═══════════════════════════════════════════════════════════════

-- ─── Enum: Task-Status ───────────────────────────────────────
-- Lifecycle: open → in_progress → done (Standardpfad).
-- blocked = wartet auf etwas (Layer 2 Dependency in T.3 macht das
-- automatisch). archived = aus Aktiv-Sichten weg, in Detail-Page
-- weiterhin sichtbar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE public.task_status AS ENUM
      ('open', 'in_progress', 'blocked', 'done', 'archived');
  END IF;
END $$;

-- ─── Enum: Manifestation-Kind ────────────────────────────────
-- Polymorpher Container-Ref auf task_manifestations.container_id.
-- 'kanban'      → container_id = kb_cols.id
-- 'checklist'   → container_id = checklists.id
-- 'calendar'    → container_id NULL (Datum aus tasks.deadline +
--                 display_meta.time)
-- 'standalone'  → container_id NULL (free-floating, nur in Agenda)
-- Spaeter (T.4): 'flowchart' → container_id = flowchart-node-id.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_manifestation_kind') THEN
    CREATE TYPE public.task_manifestation_kind AS ENUM
      ('kanban', 'checklist', 'calendar', 'standalone');
  END IF;
END $$;

-- ─── Tabelle: tasks (Layer 0 — Aggregate Root) ───────────────
-- Eine Wahrheit pro Aufgabe. Alle Task-Eigenschaften (Status,
-- Deadline, Recur, Assignee) leben hier — niemals dupliziert in
-- Manifestations.
CREATE TABLE IF NOT EXISTS public.tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  label             text NOT NULL,
  note              text,
  status            public.task_status NOT NULL DEFAULT 'open',
  deadline          date,
  who               text[] NOT NULL DEFAULT '{}',     -- T.2: optional zu user_ref/object_ref upgradable
  recur             jsonb,                            -- gleiche Struktur wie kb_cards.recur (siehe lib/recur.ts)
  done_occurrences  date[] NOT NULL DEFAULT '{}',     -- bei recur != null
  attrs             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_ws_status_idx
  ON public.tasks(workspace_id, status);
CREATE INDEX IF NOT EXISTS tasks_ws_deadline_idx
  ON public.tasks(workspace_id, deadline)
  WHERE deadline IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_label_trgm_idx
  ON public.tasks USING gin (label gin_trgm_ops);

COMMENT ON TABLE public.tasks IS
  'Phase 4 T.1.A — Aggregate Root des Task-Layers (ECS Layer 0). Eine Aufgabe existiert genau einmal; Manifestations (Layer 1) verlinken auf diesen Datensatz.';
COMMENT ON COLUMN public.tasks.who IS
  'Stub bis T.2 — text[] mit Frei-Text-Assignees. Spaeter optional Object-Ref-Liste oder user_id-Liste.';
COMMENT ON COLUMN public.tasks.recur IS
  'JSONB mit RecurSpec aus lib/recur.ts (type/every/weekdays[]/monthType/endType/...). Identisches Format wie kb_cards.recur fuer Migrations-Symmetrie.';
COMMENT ON COLUMN public.tasks.done_occurrences IS
  'Bei recur != null: Liste der bereits erledigten Termin-Datums. status bleibt open, done wird per Datum getrackt.';

DROP TRIGGER IF EXISTS tasks_set_updated_at ON public.tasks;
CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Tabelle: task_manifestations (Layer 1) ──────────────────
-- Eine Manifestation = "Wo erscheint diese Task?". Eine Task kann
-- 0..N Manifestations haben (z.B. gleichzeitig Kanban-Karte UND
-- Calendar-Termin). Manifestation traegt nur Container-spezifisches
-- (kb_col_id, level, position-im-Container, Display-Hints).
--
-- container_id ist polymorph (verweist je nach kind auf kb_cols.id /
-- checklists.id / NULL). Kein FK — Enforcement im Mutations-Layer
-- (T.1.C) ueber kind-spezifische Helper.
CREATE TABLE IF NOT EXISTS public.task_manifestations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind          public.task_manifestation_kind NOT NULL,
  container_id  uuid,                                 -- polymorph; NULL bei kind='calendar' / 'standalone'
  position      numeric NOT NULL DEFAULT 0,
  level         smallint,                             -- nur bei kind='checklist' (0/1/2 wie checklist_items.level)
  display_meta  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- z.B. {"time":"09:30","duration_min":60} bei calendar
  created_at    timestamptz NOT NULL DEFAULT now(),

  -- level nur bei kind='checklist' sinnvoll. Bei anderen kinds NULL.
  CONSTRAINT task_manifestations_level_check
    CHECK (
      (kind = 'checklist' AND level IS NOT NULL AND level BETWEEN 0 AND 2)
      OR (kind <> 'checklist' AND level IS NULL)
    ),

  -- container_id Pflicht bei kind='kanban'/'checklist', NULL bei
  -- kind='calendar'/'standalone'.
  CONSTRAINT task_manifestations_container_check
    CHECK (
      (kind IN ('kanban','checklist') AND container_id IS NOT NULL)
      OR (kind IN ('calendar','standalone') AND container_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS task_manifestations_task_idx
  ON public.task_manifestations(task_id);
CREATE INDEX IF NOT EXISTS task_manifestations_ws_kind_idx
  ON public.task_manifestations(workspace_id, kind);
CREATE INDEX IF NOT EXISTS task_manifestations_container_pos_idx
  ON public.task_manifestations(container_id, position)
  WHERE container_id IS NOT NULL;

COMMENT ON TABLE public.task_manifestations IS
  'Phase 4 T.1.A — Manifestation einer Task in einem Container (ECS Layer 1). Polymorpher container_id-Ref (kanban=kb_cols.id, checklist=checklists.id, calendar/standalone=NULL).';
COMMENT ON COLUMN public.task_manifestations.display_meta IS
  'kind-spezifische Display-Hints. Beispiele: {"color":"blue"} (kanban), {"time":"14:00","duration_min":30} (calendar).';

-- ─── RLS aktivieren (mit FORCE — Lesson aus AU-B1 K1) ────────
ALTER TABLE public.tasks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks                FORCE ROW LEVEL SECURITY;
ALTER TABLE public.task_manifestations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_manifestations  FORCE ROW LEVEL SECURITY;

-- ─── RLS-Policies (uniform, Pattern aus 030) ─────────────────
-- SELECT: jeder Workspace-Member.
-- WRITE (INSERT/UPDATE/DELETE): owner/admin/editor via can_write_workspace.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['tasks','task_manifestations'];
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

-- ─── Grants ──────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['tasks','task_manifestations'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ─── Smoke-Verifikation (manuell nach Apply) ─────────────────
-- 1. \d+ public.tasks                    -- Spalten + Indizes erwartet
-- 2. \d+ public.task_manifestations      -- dito + 2 CHECK-Constraints
-- 3. SELECT count(*) FROM public.tasks;  -- 0
-- 4. INSERT INTO public.tasks (workspace_id, label) VALUES (...);
--    -- nur fuer owner/admin/editor erlaubt; viewer faellt durch.
-- 5. SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--      WHERE relname IN ('tasks','task_manifestations');
--    -- beide Spalten = true (FORCE RLS aktiv).
