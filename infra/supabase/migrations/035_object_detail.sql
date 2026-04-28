-- ═══════════════════════════════════════════════════════════════
-- Phase 3 Welle O.4 — Object-Detail + Hierarchie + Tags
--
-- Object-Detail-Page braucht:
--   1. Edit-Pfad fuer label/alias/type/attrs (mcp_update_object)
--   2. Hierarchie-Setzung mit Cycle-Check (mcp_set_object_parent)
--   3. M:N-Tags (mcp_add_object_tag / _remove)
--   4. Loesch-Pfad (mcp_delete_object)
--   5. Backlinks-View (object_backlinks_v) — alle Vorkommen ueber
--      rows/cols/kb_cols/nodes, mit dem zugehoerigen Node-Pfad fuer
--      Click-Through-Navigation.
--
-- Pattern wie Migration 034: SECURITY DEFINER + _mcp_assert_writer +
-- _mcp_validate_label/_alias re-use.
-- ═══════════════════════════════════════════════════════════════

-- ─── mcp_update_object ──────────────────────────────────────
-- Partial-Update: nur Felder die nicht NULL sind werden geschrieben.
-- attrs wird komplett ersetzt wenn p_attrs nicht NULL — Merge-Pattern
-- ist im Frontend (lib/objects.ts) gepflegt.
CREATE OR REPLACE FUNCTION public.mcp_update_object(
  p_object_id  uuid,
  p_label      text,         -- optional — NULL = nicht aendern
  p_alias      text,         -- optional, '' = clear
  p_type_label text,         -- optional, '' = clear
  p_attrs      jsonb         -- optional — NULL = nicht aendern
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ws    uuid;
  v_label text;
  v_alias text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT workspace_id INTO v_ws FROM public.objects WHERE id = p_object_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'object_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public._mcp_assert_writer(v_ws);

  IF p_label IS NOT NULL THEN
    v_label := public._mcp_validate_label(p_label);
  END IF;

  -- alias: '' → NULL (clear), sonst validieren.
  IF p_alias IS NOT NULL THEN
    IF length(trim(p_alias)) = 0 THEN
      v_alias := NULL;
    ELSE
      v_alias := public._mcp_validate_alias(p_alias);
    END IF;
  END IF;

  UPDATE public.objects SET
    label      = COALESCE(v_label, label),
    alias      = CASE WHEN p_alias IS NULL THEN alias ELSE v_alias END,
    type_label = CASE
                   WHEN p_type_label IS NULL THEN type_label
                   WHEN length(trim(p_type_label)) = 0 THEN NULL
                   ELSE p_type_label
                 END,
    attrs      = COALESCE(p_attrs, attrs),
    updated_at = now()
  WHERE id = p_object_id;

  RETURN jsonb_build_object('object_id', p_object_id, 'workspace_id', v_ws);
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_update_object(uuid, text, text, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.mcp_update_object IS
  'Phase 3 O.4 — partial update auf objects. NULL = nicht aendern, '''' = clear (alias/type_label).';

-- ─── mcp_set_object_parent ──────────────────────────────────
-- Hierarchie-Setzung mit Cycle-Check. Walk-up vom kandidatischen
-- parent_id; wenn p_object_id auf dem Pfad auftaucht → Cycle, reject.
-- Auch p_parent_id = p_object_id direkt → reject.
CREATE OR REPLACE FUNCTION public.mcp_set_object_parent(
  p_object_id uuid,
  p_parent_id uuid           -- NULL = Root machen
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor       uuid := auth.uid();
  v_ws          uuid;
  v_parent_ws   uuid;
  v_walker      uuid;
  v_steps       int := 0;
  v_max_steps   int := 100;  -- Schutz gegen unbeendbare Loops
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_parent_id IS NOT NULL AND p_parent_id = p_object_id THEN
    RAISE EXCEPTION 'self_parent' USING ERRCODE = 'check_violation';
  END IF;

  SELECT workspace_id INTO v_ws FROM public.objects WHERE id = p_object_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'object_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public._mcp_assert_writer(v_ws);

  IF p_parent_id IS NOT NULL THEN
    SELECT workspace_id INTO v_parent_ws FROM public.objects WHERE id = p_parent_id;
    IF v_parent_ws IS NULL THEN
      RAISE EXCEPTION 'parent_object_not_found' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_parent_ws <> v_ws THEN
      RAISE EXCEPTION 'cross_workspace_parent' USING ERRCODE = 'check_violation';
    END IF;

    -- Cycle-Check: walk vom p_parent_id nach oben. Wenn p_object_id
    -- auf dem Pfad → wuerde Cycle erzeugen.
    v_walker := p_parent_id;
    WHILE v_walker IS NOT NULL AND v_steps < v_max_steps LOOP
      IF v_walker = p_object_id THEN
        RAISE EXCEPTION 'cycle_in_hierarchy' USING ERRCODE = 'check_violation';
      END IF;
      SELECT parent_id INTO v_walker FROM public.objects WHERE id = v_walker;
      v_steps := v_steps + 1;
    END LOOP;
  END IF;

  UPDATE public.objects
     SET parent_id = p_parent_id,
         updated_at = now()
   WHERE id = p_object_id;

  RETURN jsonb_build_object('object_id', p_object_id, 'parent_id', p_parent_id);
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_set_object_parent(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.mcp_set_object_parent IS
  'Phase 3 O.4 — Object-Hierarchie setzen mit Cycle-Check. NULL = Root.';

-- ─── mcp_add_object_tag ─────────────────────────────────────
-- M:N: ein Object wird mit einem anderen Object getagged. Tags sind
-- selbst Objects (z.B. "B2B" oder "Polizei-Asset" als Object).
CREATE OR REPLACE FUNCTION public.mcp_add_object_tag(
  p_object_id     uuid,
  p_tag_object_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_ws       uuid;
  v_tag_ws   uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_object_id = p_tag_object_id THEN
    RAISE EXCEPTION 'self_tag' USING ERRCODE = 'check_violation';
  END IF;

  SELECT workspace_id INTO v_ws FROM public.objects WHERE id = p_object_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'object_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT workspace_id INTO v_tag_ws FROM public.objects WHERE id = p_tag_object_id;
  IF v_tag_ws IS NULL THEN
    RAISE EXCEPTION 'tag_object_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_tag_ws <> v_ws THEN
    RAISE EXCEPTION 'cross_workspace_tag' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public._mcp_assert_writer(v_ws);

  INSERT INTO public.object_tags (object_id, tag_object_id, workspace_id)
  VALUES (p_object_id, p_tag_object_id, v_ws)
  ON CONFLICT (object_id, tag_object_id) DO NOTHING;

  RETURN jsonb_build_object(
    'object_id', p_object_id,
    'tag_object_id', p_tag_object_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_add_object_tag(uuid, uuid) TO authenticated;

-- ─── mcp_remove_object_tag ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_remove_object_tag(
  p_object_id     uuid,
  p_tag_object_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ws    uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT workspace_id INTO v_ws FROM public.objects WHERE id = p_object_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'object_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public._mcp_assert_writer(v_ws);

  DELETE FROM public.object_tags
   WHERE object_id = p_object_id
     AND tag_object_id = p_tag_object_id;

  RETURN jsonb_build_object(
    'object_id', p_object_id,
    'tag_object_id', p_tag_object_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_remove_object_tag(uuid, uuid) TO authenticated;

-- ─── mcp_delete_object ──────────────────────────────────────
-- Cascading: rows/cols/kb_cols/nodes.object_id wird auf NULL gesetzt
-- (ON DELETE SET NULL aus Migration 030). object_tags + group_members +
-- soft_group_members werden via CASCADE entfernt.
-- Children (objects.parent_id) werden auf NULL gesetzt (Self-FK SET NULL).
CREATE OR REPLACE FUNCTION public.mcp_delete_object(p_object_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ws    uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT workspace_id INTO v_ws FROM public.objects WHERE id = p_object_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'object_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public._mcp_assert_writer(v_ws);

  DELETE FROM public.objects WHERE id = p_object_id;

  RETURN jsonb_build_object('object_id', p_object_id, 'deleted', true);
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_delete_object(uuid) TO authenticated;

-- ─── View: object_backlinks_v ───────────────────────────────
-- Workspace-weite UNION-View aller Vorkommen eines Objects ueber
-- rows / cols / kb_cols / nodes mit object_id-FK. Plus: Node-Label fuer
-- Click-Through-Pfad.
--
-- Schema:
--   workspace_id uuid    — fuer RLS-Filter
--   object_id    uuid    — das verlinkte Object
--   kind         text    — 'row' | 'col' | 'kb_col' | 'node'
--   ref_id       uuid    — id des row/col/kb_col/node-Eintrags
--   ref_label    text    — label des Eintrags
--   node_id      uuid    — Node der ihn enthaelt (matrix_id / board_id /
--                          oder ref_id selbst bei kind='node')
--   node_label   text    — Label des Nodes (fuer Pfad-Anzeige)
--   node_type    text    — 'matrix' | 'board' | NULL
--
-- RLS: kein eigenes RLS-Statement — die View selektiert nur via
-- INNER JOIN auf objects/nodes, die jeweils eigene RLS haben. Postgres
-- ueberprueft die zugrunde liegenden Tabellen automatisch.
CREATE OR REPLACE VIEW public.object_backlinks_v AS
  -- rows
  SELECT
    r.workspace_id,
    r.object_id,
    'row'::text     AS kind,
    r.id            AS ref_id,
    r.label         AS ref_label,
    r.matrix_id     AS node_id,
    n.label         AS node_label,
    n.type::text    AS node_type
  FROM public.rows r
  JOIN public.nodes n ON n.id = r.matrix_id
  WHERE r.object_id IS NOT NULL

  UNION ALL

  -- cols
  SELECT
    c.workspace_id,
    c.object_id,
    'col'::text     AS kind,
    c.id            AS ref_id,
    c.label         AS ref_label,
    c.matrix_id     AS node_id,
    n.label         AS node_label,
    n.type::text    AS node_type
  FROM public.cols c
  JOIN public.nodes n ON n.id = c.matrix_id
  WHERE c.object_id IS NOT NULL

  UNION ALL

  -- kb_cols
  SELECT
    kc.workspace_id,
    kc.object_id,
    'kb_col'::text  AS kind,
    kc.id           AS ref_id,
    kc.label        AS ref_label,
    kc.board_id     AS node_id,
    n.label         AS node_label,
    n.type::text    AS node_type
  FROM public.kb_cols kc
  JOIN public.nodes n ON n.id = kc.board_id
  WHERE kc.object_id IS NOT NULL

  UNION ALL

  -- nodes selbst (Power-User Toggle aus Migration 030)
  SELECT
    n.workspace_id,
    n.object_id,
    'node'::text    AS kind,
    n.id            AS ref_id,
    n.label         AS ref_label,
    n.id            AS node_id,
    n.label         AS node_label,
    n.type::text    AS node_type
  FROM public.nodes n
  WHERE n.object_id IS NOT NULL;

GRANT SELECT ON public.object_backlinks_v TO authenticated;

COMMENT ON VIEW public.object_backlinks_v IS
  'Phase 3 O.4 — alle Vorkommen eines Objects ueber rows/cols/kb_cols/nodes mit object_id-FK. RLS ueber underlying-Tabellen.';

-- ─── Smoke (manuell nach Apply) ─────────────────────────────
-- 1. SELECT mcp_update_object('<obj-id>', 'Neuer Name', 'neu-alias', 'Kunde', '{"branche":"IT"}'::jsonb);
-- 2. SELECT mcp_set_object_parent('<child>', '<parent>');  -- ok
-- 3. SELECT mcp_set_object_parent('<parent>', '<child>');  -- cycle_in_hierarchy
-- 4. SELECT mcp_add_object_tag('<obj>', '<tag-obj>');
-- 5. SELECT * FROM object_backlinks_v WHERE object_id = '<obj>';
-- 6. SELECT mcp_delete_object('<obj>');
