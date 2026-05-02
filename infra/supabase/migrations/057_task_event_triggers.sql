-- ═══════════════════════════════════════════════════════════════
-- Welle C Folge — Task-Lifecycle-Triggers
--
-- emit_event-Hooks fuer task.created / task.completed / task.deleted.
-- Plus cell.created / cell.deleted analog.
--
-- Tasks-Mutations laufen direkt aus dem Frontend via supabase.from().
-- update/insert/delete (kein RPC-Wrapper). Trigger AFTER INSERT/UPDATE/
-- DELETE ist daher der einzige Punkt um Events zuverlaessig zu emittieren.
--
-- Best-Effort-Pattern: jeder Trigger kapselt emit_event in EXCEPTION
-- WHEN OTHERS — Trigger-Fail darf die eigentliche Mutation NIE blockieren.
-- ═══════════════════════════════════════════════════════════════

-- ─── Tasks ────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS task_insert_emit_event ON public.tasks;
CREATE OR REPLACE FUNCTION public._task_insert_emit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.emit_event(NEW.workspace_id, 'task.created',
    jsonb_build_object(
      'task_id', NEW.id,
      'label', NEW.label,
      'status', NEW.status,
      'deadline', NEW.deadline
    ));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

CREATE TRIGGER task_insert_emit_event
  AFTER INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._task_insert_emit_event();

DROP TRIGGER IF EXISTS task_status_emit_event ON public.tasks;
CREATE OR REPLACE FUNCTION public._task_status_emit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Status-Wechsel auf 'done' → task.completed.
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'done' THEN
    PERFORM public.emit_event(NEW.workspace_id, 'task.completed',
      jsonb_build_object(
        'task_id', NEW.id,
        'label', NEW.label,
        'old_status', OLD.status
      ));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

CREATE TRIGGER task_status_emit_event
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._task_status_emit_event();

DROP TRIGGER IF EXISTS task_delete_emit_event ON public.tasks;
CREATE OR REPLACE FUNCTION public._task_delete_emit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.emit_event(OLD.workspace_id, 'task.deleted',
    jsonb_build_object('task_id', OLD.id, 'label', OLD.label));
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RETURN OLD;
END $$;

CREATE TRIGGER task_delete_emit_event
  AFTER DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public._task_delete_emit_event();

-- ─── Cells ────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS cell_insert_emit_event ON public.cells;
CREATE OR REPLACE FUNCTION public._cell_insert_emit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.emit_event(NEW.workspace_id, 'cell.created',
    jsonb_build_object(
      'cell_id', NEW.id,
      'matrix_id', NEW.matrix_id,
      'features', NEW.features
    ));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

CREATE TRIGGER cell_insert_emit_event
  AFTER INSERT ON public.cells
  FOR EACH ROW EXECUTE FUNCTION public._cell_insert_emit_event();

DROP TRIGGER IF EXISTS cell_delete_emit_event ON public.cells;
CREATE OR REPLACE FUNCTION public._cell_delete_emit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.emit_event(OLD.workspace_id, 'cell.deleted',
    jsonb_build_object('cell_id', OLD.id, 'matrix_id', OLD.matrix_id));
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RETURN OLD;
END $$;

CREATE TRIGGER cell_delete_emit_event
  AFTER DELETE ON public.cells
  FOR EACH ROW EXECUTE FUNCTION public._cell_delete_emit_event();

COMMENT ON FUNCTION public._task_insert_emit_event IS
  'Welle C Folge — emit_event(task.created) AFTER INSERT.';
COMMENT ON FUNCTION public._task_status_emit_event IS
  'Welle C Folge — emit_event(task.completed) bei status→done.';
COMMENT ON FUNCTION public._task_delete_emit_event IS
  'Welle C Folge — emit_event(task.deleted) AFTER DELETE.';
COMMENT ON FUNCTION public._cell_insert_emit_event IS
  'Welle C Folge — emit_event(cell.created) AFTER INSERT.';
COMMENT ON FUNCTION public._cell_delete_emit_event IS
  'Welle C Folge — emit_event(cell.deleted) AFTER DELETE.';
