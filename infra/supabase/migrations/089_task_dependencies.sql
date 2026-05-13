-- ═══════════════════════════════════════════════════════════════
-- Phase 4 Welle T.3 — Task-Dependencies (ECS Layer 2)
--
-- „Task B kann erst starten wenn Task A erledigt ist." — klassische
-- gerichtete Vorgaenger-Beziehung (Blocker → Blocked). Selbst-Loops
-- + Doubletten sind verboten; Zyklen werden via Trigger geprueft
-- (Insert dep `A → B` ist illegal, wenn `B → ... → A` schon existiert).
--
-- Workspace-Constraint: beide Tasks muessen im gleichen Workspace sein
-- (Cross-Workspace-Dependencies waeren ein Datenleck-Vektor — die RLS
-- der einen Seite koennte umgangen werden). Wird vom Insert-Trigger
-- geprueft.
--
-- Cascading-Delete: wenn eine Task geloescht wird, verschwinden auch
-- ihre Dependencies (in beiden Richtungen) via FK ON DELETE CASCADE.
--
-- Layer 3 (task_rules) folgt in T.4 — diese Migration legt nur Layer 2.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.task_dependencies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  blocker_task_id   uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  blocked_task_id   uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_dependencies_no_self_loop CHECK (blocker_task_id <> blocked_task_id),
  CONSTRAINT task_dependencies_unique UNIQUE (blocker_task_id, blocked_task_id)
);

CREATE INDEX IF NOT EXISTS task_dependencies_ws_idx
  ON public.task_dependencies(workspace_id);
CREATE INDEX IF NOT EXISTS task_dependencies_blocker_idx
  ON public.task_dependencies(blocker_task_id);
CREATE INDEX IF NOT EXISTS task_dependencies_blocked_idx
  ON public.task_dependencies(blocked_task_id);

COMMENT ON TABLE public.task_dependencies IS
  'Phase 4 T.3 — Vorgaenger-Beziehung zwischen Tasks (Layer 2). blocker_task_id muss done sein, bevor blocked_task_id sinnvoll bearbeitet werden kann.';

-- ─── Insert-Validation: gleicher Workspace + Cycle-Detection ───
-- Beide Tasks muessen im gleichen Workspace + der durch den Insert
-- angelegten gerichteten Beziehung. Zyklus-Check per recursive CTE.
CREATE OR REPLACE FUNCTION public.task_dependencies_validate()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_blocker_ws  uuid;
  v_blocked_ws  uuid;
  v_cycle_exists boolean;
BEGIN
  -- Workspace-Match-Check ueber die referenzierten Tasks.
  SELECT workspace_id INTO v_blocker_ws FROM public.tasks WHERE id = NEW.blocker_task_id;
  SELECT workspace_id INTO v_blocked_ws FROM public.tasks WHERE id = NEW.blocked_task_id;
  IF v_blocker_ws IS NULL OR v_blocked_ws IS NULL THEN
    RAISE EXCEPTION 'referenced task not found' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_blocker_ws <> v_blocked_ws THEN
    RAISE EXCEPTION 'cross-workspace task dependency not allowed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_blocker_ws <> NEW.workspace_id THEN
    -- Row-eigene workspace_id muss konsistent sein (sonst RLS-Bypass-Vektor).
    RAISE EXCEPTION 'workspace_id does not match referenced tasks'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Cycle-Detection: existiert ein Pfad blocked → ... → blocker, dann
  -- wuerde der Insert blocker → blocked einen Zyklus schliessen.
  WITH RECURSIVE walk(node) AS (
    SELECT NEW.blocked_task_id
    UNION ALL
    SELECT d.blocked_task_id
    FROM public.task_dependencies d
    JOIN walk w ON d.blocker_task_id = w.node
  )
  SELECT EXISTS (SELECT 1 FROM walk WHERE node = NEW.blocker_task_id)
  INTO v_cycle_exists;

  IF v_cycle_exists THEN
    RAISE EXCEPTION 'cycle in task dependencies'
      USING ERRCODE = 'check_violation', HINT = 'A → ... → B → A nicht zulaessig.';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS task_dependencies_validate_trg ON public.task_dependencies;
CREATE TRIGGER task_dependencies_validate_trg
  BEFORE INSERT ON public.task_dependencies
  FOR EACH ROW EXECUTE FUNCTION public.task_dependencies_validate();

-- ─── RLS aktivieren (mit FORCE) ──────────────────────────────
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_dependencies FORCE ROW LEVEL SECURITY;

-- SELECT: jeder Workspace-Member.
-- WRITE (INSERT/DELETE): can_write_workspace. UPDATE-Pfade existieren
-- nicht — Dependencies sind add/remove-only.
DROP POLICY IF EXISTS task_dependencies_select ON public.task_dependencies;
CREATE POLICY task_dependencies_select ON public.task_dependencies
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS task_dependencies_write ON public.task_dependencies;
CREATE POLICY task_dependencies_write ON public.task_dependencies
  FOR ALL
  USING (public.can_write_workspace(workspace_id))
  WITH CHECK (public.can_write_workspace(workspace_id));

GRANT SELECT, INSERT, DELETE ON public.task_dependencies TO authenticated;
GRANT ALL ON public.task_dependencies TO service_role;

-- ─── Smoke-Verifikation (manuell nach Apply) ─────────────────
-- 1. \d+ public.task_dependencies
-- 2. SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--      WHERE relname = 'task_dependencies'; -- beide true
-- 3. -- Self-Loop muss raisen:
--    INSERT INTO public.task_dependencies (workspace_id, blocker_task_id, blocked_task_id)
--      VALUES ('<ws>', '<t>', '<t>'); -- check_violation
-- 4. -- Cycle muss raisen:
--    INSERT (A→B), INSERT (B→C), INSERT (C→A); letzter raised check_violation.
-- 5. -- Doublette muss raisen:
--    INSERT (A→B), INSERT (A→B); letzter raised unique_violation.
