-- Phase 4 T.1.H — MCP-Tool-Quartett fuer den Task-Layer.
--
-- Vier neue RPCs damit der LLM (lib/ai-assist/index.ts) Tasks anlegen,
-- aendern und cross-cutten kann:
--
--   * mcp_search_tasks       Trigram-Fuzzy auf tasks.label, Filter
--                            status/deadline, Top-N.
--   * mcp_create_task        Layer-0-Atom anlegen (label/note/status/
--                            deadline/who).
--   * mcp_update_task        Felder patchen (label/note/status/deadline).
--   * mcp_add_manifestation  Layer-1-Sicht hinzufuegen (kanban/checklist/
--                            calendar/standalone) — der ECS-Cross-Cut.
--
-- Pattern wie 021_mcp_tools.sql: SECURITY DEFINER, _mcp_assert_writer
-- als Role-Gate, Validation-Helper aus 021 wiederverwendet. Returns
-- jsonb damit der LLM strukturiert weiterarbeiten kann.

-- ─── _mcp_resolve_workspace fuer task-IDs erweitern ────────────
-- Die mcp_update_task / mcp_add_manifestation muessen den Workspace
-- ueber die task_id ermitteln koennen. Gleicher Mechanismus wie heute
-- fuer card/checklist — wir ergaenzen den 'task'-Branch in-place.
CREATE OR REPLACE FUNCTION public._mcp_resolve_workspace(
  p_kind text,
  p_id   uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_ws uuid;
BEGIN
  CASE p_kind
    WHEN 'node' THEN
      SELECT workspace_id INTO v_ws FROM public.nodes WHERE id = p_id;
    WHEN 'cell' THEN
      SELECT workspace_id INTO v_ws FROM public.cells WHERE id = p_id;
    WHEN 'col' THEN
      SELECT workspace_id INTO v_ws FROM public.kb_cols WHERE id = p_id;
    WHEN 'checklist' THEN
      SELECT workspace_id INTO v_ws FROM public.checklists WHERE id = p_id;
    WHEN 'task' THEN
      SELECT workspace_id INTO v_ws FROM public.tasks WHERE id = p_id;
    WHEN 'manifestation' THEN
      SELECT workspace_id INTO v_ws FROM public.task_manifestations WHERE id = p_id;
    ELSE
      RAISE EXCEPTION 'unknown_resource_kind: %', p_kind;
  END CASE;

  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'resource_not_found: % %', p_kind, p_id
      USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_ws;
END $$;

-- ─── mcp_search_tasks ───────────────────────────────────────────
-- Trigram-Fuzzy auf tasks.label im Workspace. Optional Filter:
--   p_status: nur passende Status (NULL = alle)
--   p_deadline_from / p_deadline_to: Bereichs-Filter (NULL = unbeschraenkt)
-- Default-Limit 8, geclampt 1..50.
CREATE OR REPLACE FUNCTION public.mcp_search_tasks(
  p_workspace_id  uuid,
  p_query         text,
  p_status        text[] DEFAULT NULL,
  p_deadline_from date   DEFAULT NULL,
  p_deadline_to   date   DEFAULT NULL,
  p_limit         int    DEFAULT 8
)
RETURNS TABLE (
  id         uuid,
  label      text,
  status     text,
  deadline   date,
  similarity real
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_role  public.workspace_role;
  v_limit int;
BEGIN
  v_role := public.workspace_role_of(p_workspace_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_limit := GREATEST(LEAST(COALESCE(p_limit, 8), 50), 1);

  IF p_query IS NULL OR length(trim(p_query)) = 0 THEN
    RETURN QUERY
      SELECT t.id, t.label, t.status, t.deadline, 0::real AS sim
        FROM public.tasks t
       WHERE t.workspace_id = p_workspace_id
         AND (p_status IS NULL OR t.status = ANY(p_status))
         AND (p_deadline_from IS NULL OR t.deadline >= p_deadline_from)
         AND (p_deadline_to   IS NULL OR t.deadline <= p_deadline_to)
       ORDER BY t.updated_at DESC
       LIMIT v_limit;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT t.id, t.label, t.status, t.deadline,
           similarity(t.label, p_query) AS sim
      FROM public.tasks t
     WHERE t.workspace_id = p_workspace_id
       AND t.label % p_query
       AND (p_status IS NULL OR t.status = ANY(p_status))
       AND (p_deadline_from IS NULL OR t.deadline >= p_deadline_from)
       AND (p_deadline_to   IS NULL OR t.deadline <= p_deadline_to)
     ORDER BY sim DESC, t.label ASC
     LIMIT v_limit;
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_search_tasks(uuid, text, text[], date, date, int) TO authenticated;

COMMENT ON FUNCTION public.mcp_search_tasks IS
  'Phase 4 T.1.H — Trigram-Fuzzy-Search auf tasks.label im Workspace. Optional Filter status/deadline-Range. Default-Limit 8, max 50.';

-- ─── mcp_create_task ────────────────────────────────────────────
-- Layer-0-Atom anlegen. note/deadline/status/who optional. Status muss
-- in dem CHECK aus 040_task_layer.sql liegen ('open' default).
CREATE OR REPLACE FUNCTION public.mcp_create_task(
  p_workspace_id uuid,
  p_label        text,
  p_note         text   DEFAULT NULL,
  p_status       text   DEFAULT 'open',
  p_deadline     date   DEFAULT NULL,
  p_who          text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_label  text;
  v_status text;
  v_id     uuid;
BEGIN
  PERFORM public._mcp_assert_writer(p_workspace_id);
  v_label := public._mcp_validate_label(p_label);

  v_status := COALESCE(p_status, 'open');
  IF v_status NOT IN ('open','in_progress','blocked','done','archived') THEN
    RAISE EXCEPTION 'invalid_task_status' USING ERRCODE = 'check_violation',
      HINT = 'status muss open, in_progress, blocked, done oder archived sein.';
  END IF;

  IF p_note IS NOT NULL AND length(p_note) > 5000 THEN
    RAISE EXCEPTION 'note_too_long_max_5000' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.tasks (
    workspace_id, label, note, status, deadline, who, done_occurrences
  ) VALUES (
    p_workspace_id, v_label, p_note, v_status, p_deadline,
    COALESCE(p_who, ARRAY[]::text[]),
    ARRAY[]::date[]
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'task_id', v_id,
    'workspace_id', p_workspace_id,
    'label', v_label,
    'status', v_status,
    'deadline', p_deadline
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_create_task(uuid, text, text, text, date, text[]) TO authenticated;

COMMENT ON FUNCTION public.mcp_create_task IS
  'Phase 4 T.1.H — Layer-0-Task anlegen (label/note/status/deadline/who). Status default open. Note max 5000 Zeichen.';

-- ─── mcp_update_task ────────────────────────────────────────────
-- Patch-Pattern: nur die Felder updaten, fuer die ein Wert ungleich
-- NULL-Sentinel uebergeben wurde. Da SQL-Args kein "undefined vs null"
-- kennen, nutzen wir einen Bool-Flag pro Feld.
CREATE OR REPLACE FUNCTION public.mcp_update_task(
  p_task_id        uuid,
  p_label          text   DEFAULT NULL,
  p_set_label      bool   DEFAULT false,
  p_note           text   DEFAULT NULL,
  p_set_note       bool   DEFAULT false,
  p_status         text   DEFAULT NULL,
  p_set_status     bool   DEFAULT false,
  p_deadline       date   DEFAULT NULL,
  p_set_deadline   bool   DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ws    uuid;
  v_label text;
BEGIN
  v_ws := public._mcp_resolve_workspace('task', p_task_id);
  PERFORM public._mcp_assert_writer(v_ws);

  IF p_set_status AND p_status IS NOT NULL
     AND p_status NOT IN ('open','in_progress','blocked','done','archived') THEN
    RAISE EXCEPTION 'invalid_task_status' USING ERRCODE = 'check_violation';
  END IF;

  IF p_set_label THEN
    v_label := public._mcp_validate_label(p_label);
  END IF;

  IF p_set_note AND p_note IS NOT NULL AND length(p_note) > 5000 THEN
    RAISE EXCEPTION 'note_too_long_max_5000' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.tasks t
     SET label    = CASE WHEN p_set_label    THEN v_label    ELSE t.label    END,
         note     = CASE WHEN p_set_note     THEN p_note     ELSE t.note     END,
         status   = CASE WHEN p_set_status   THEN p_status   ELSE t.status   END,
         deadline = CASE WHEN p_set_deadline THEN p_deadline ELSE t.deadline END,
         updated_at = now()
   WHERE t.id = p_task_id;

  RETURN (
    SELECT jsonb_build_object(
      'task_id', t.id,
      'label', t.label,
      'status', t.status,
      'deadline', t.deadline,
      'updated_at', t.updated_at
    ) FROM public.tasks t WHERE t.id = p_task_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_update_task(uuid, text, bool, text, bool, text, bool, date, bool) TO authenticated;

COMMENT ON FUNCTION public.mcp_update_task IS
  'Phase 4 T.1.H — Patch eines Layer-0-Tasks. Pro Feld ein p_set_*-Flag, weil SQL kein undefined vs null kennt.';

-- ─── mcp_add_manifestation ──────────────────────────────────────
-- Layer-1-Sicht hinzufuegen — der eigentliche ECS-Cross-Cut. Same task,
-- new view. kind ∈ {kanban, checklist, calendar, standalone}.
-- container_id darf NULL sein nur fuer kind='standalone'. Sonst Foreign-
-- Key-Check ueber den richtigen Container-Typ. position default = max+1
-- innerhalb des Containers (oder 0).
CREATE OR REPLACE FUNCTION public.mcp_add_manifestation(
  p_task_id      uuid,
  p_kind         text,
  p_container_id uuid    DEFAULT NULL,
  p_position     numeric DEFAULT NULL,
  p_level        smallint DEFAULT NULL,
  p_display_meta jsonb   DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ws       uuid;
  v_pos      numeric;
  v_id       uuid;
  v_resolved uuid;
BEGIN
  v_ws := public._mcp_resolve_workspace('task', p_task_id);
  PERFORM public._mcp_assert_writer(v_ws);

  IF p_kind NOT IN ('kanban','checklist','calendar','standalone') THEN
    RAISE EXCEPTION 'invalid_manifestation_kind' USING ERRCODE = 'check_violation',
      HINT = 'kind muss kanban, checklist, calendar oder standalone sein.';
  END IF;

  -- Container-Validation per Kind. Level nur fuer checklist sinnvoll.
  IF p_kind = 'kanban' THEN
    IF p_container_id IS NULL THEN
      RAISE EXCEPTION 'container_required' USING ERRCODE = 'check_violation',
        HINT = 'kind=kanban braucht container_id (kb_cols.id).';
    END IF;
    v_resolved := public._mcp_resolve_workspace('col', p_container_id);
    IF v_resolved <> v_ws THEN
      RAISE EXCEPTION 'cross_workspace_container' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF p_kind = 'checklist' THEN
    IF p_container_id IS NULL THEN
      RAISE EXCEPTION 'container_required' USING ERRCODE = 'check_violation',
        HINT = 'kind=checklist braucht container_id (checklists.id).';
    END IF;
    v_resolved := public._mcp_resolve_workspace('checklist', p_container_id);
    IF v_resolved <> v_ws THEN
      RAISE EXCEPTION 'cross_workspace_container' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF p_kind = 'calendar' THEN
    -- container_id optional — heute meist NULL (virtuell). T.AC bringt
    -- ggf. spaeter cross-atom-Calendar-Container.
    IF p_container_id IS NOT NULL THEN
      v_resolved := public._mcp_resolve_workspace('node', p_container_id);
      IF v_resolved <> v_ws THEN
        RAISE EXCEPTION 'cross_workspace_container' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  -- Position default = max + 1 innerhalb desselben Containers.
  IF p_position IS NULL THEN
    SELECT COALESCE(max(position) + 1, 0) INTO v_pos
      FROM public.task_manifestations
     WHERE workspace_id = v_ws AND kind = p_kind
       AND ((container_id IS NULL AND p_container_id IS NULL)
            OR container_id = p_container_id);
  ELSE
    v_pos := p_position;
  END IF;

  INSERT INTO public.task_manifestations (
    task_id, workspace_id, kind, container_id, position, level, display_meta
  ) VALUES (
    p_task_id, v_ws, p_kind, p_container_id, v_pos, p_level,
    COALESCE(p_display_meta, '{}'::jsonb)
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'manifestation_id', v_id,
    'task_id', p_task_id,
    'kind', p_kind,
    'container_id', p_container_id,
    'position', v_pos
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_add_manifestation(uuid, text, uuid, numeric, smallint, jsonb) TO authenticated;

COMMENT ON FUNCTION public.mcp_add_manifestation IS
  'Phase 4 T.1.H — Layer-1-Sicht zu existing Task hinzufuegen (kanban/checklist/calendar/standalone). Cross-Cut: dieselbe Task in mehreren Sichten.';
