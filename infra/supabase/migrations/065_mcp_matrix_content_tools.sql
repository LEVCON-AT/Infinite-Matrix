-- 065 — MCP-Tools fuer Matrix-Inhalt (Rows, Cols, Cells) +
-- Cell-Child-Node-Verknuepfung. Loest die User-Beschwerde, dass der
-- AI-Assistent zwar Matrizen/Boards anlegen, aber NICHT Zeilen/Spalten/
-- Zellen befuellen oder eine "zweite Ebene" (Sub-Matrix in einer Cell)
-- verkabeln kann.
--
-- Pattern matched 021_mcp_tools.sql:
--   - SECURITY DEFINER + assert_writer fuer RLS-Bypass
--   - Validate label via _mcp_validate_label
--   - Cross-workspace-Check via _mcp_resolve_workspace
--   - RETURNS jsonb mit ID + relevanten Feldern

-- ─── mcp_add_row ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_add_row(
  p_matrix_id uuid,
  p_label     text          -- darf '' sein (Matrix erlaubt leere Row-Labels)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ws       uuid;
  v_row_id   uuid;
  v_pos      int;
  v_label    text;
BEGIN
  v_ws := public._mcp_resolve_workspace('node', p_matrix_id);
  PERFORM public._mcp_assert_writer(v_ws);

  -- Pruefen dass das Ziel auch wirklich eine Matrix ist (nicht Board).
  IF NOT EXISTS (
    SELECT 1 FROM public.nodes
     WHERE id = p_matrix_id AND type = 'matrix'
  ) THEN
    RAISE EXCEPTION 'not_a_matrix'
      USING ERRCODE = 'check_violation', HINT = 'mcp_add_row erwartet einen matrix-Knoten.';
  END IF;

  -- Leere Labels sind erlaubt; nur wenn nicht leer, validieren.
  IF p_label IS NULL OR p_label = '' THEN
    v_label := '';
  ELSE
    v_label := public._mcp_validate_label(p_label);
  END IF;

  SELECT COALESCE(MAX(position), 0) + 1024 INTO v_pos
    FROM public.rows WHERE matrix_id = p_matrix_id;

  INSERT INTO public.rows (matrix_id, workspace_id, label, position)
    VALUES (p_matrix_id, v_ws, v_label, v_pos)
    RETURNING id INTO v_row_id;

  RETURN jsonb_build_object(
    'row_id', v_row_id,
    'matrix_id', p_matrix_id,
    'workspace_id', v_ws,
    'label', v_label,
    'position', v_pos
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_add_row(uuid, text) TO authenticated;

-- ─── mcp_add_col ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_add_col(
  p_matrix_id uuid,
  p_label     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ws     uuid;
  v_col_id uuid;
  v_pos    int;
  v_label  text;
BEGIN
  v_ws := public._mcp_resolve_workspace('node', p_matrix_id);
  PERFORM public._mcp_assert_writer(v_ws);

  IF NOT EXISTS (
    SELECT 1 FROM public.nodes
     WHERE id = p_matrix_id AND type = 'matrix'
  ) THEN
    RAISE EXCEPTION 'not_a_matrix'
      USING ERRCODE = 'check_violation', HINT = 'mcp_add_col erwartet einen matrix-Knoten.';
  END IF;

  IF p_label IS NULL OR p_label = '' THEN
    v_label := '';
  ELSE
    v_label := public._mcp_validate_label(p_label);
  END IF;

  SELECT COALESCE(MAX(position), 0) + 1024 INTO v_pos
    FROM public.cols WHERE matrix_id = p_matrix_id;

  INSERT INTO public.cols (matrix_id, workspace_id, label, position)
    VALUES (p_matrix_id, v_ws, v_label, v_pos)
    RETURNING id INTO v_col_id;

  RETURN jsonb_build_object(
    'col_id', v_col_id,
    'matrix_id', p_matrix_id,
    'workspace_id', v_ws,
    'label', v_label,
    'position', v_pos
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_add_col(uuid, text) TO authenticated;

-- ─── mcp_add_cell ────────────────────────────────────────────
-- Legt Cell an Schnittpunkt (row_id, col_id) an. Idempotent:
-- existiert die Cell schon, wird ihre id zurueckgegeben.
CREATE OR REPLACE FUNCTION public.mcp_add_cell(
  p_row_id uuid,
  p_col_id uuid,
  p_alias  text          -- NULL erlaubt
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ws_row     uuid;
  v_ws_col     uuid;
  v_ws         uuid;
  v_matrix_row uuid;
  v_matrix_col uuid;
  v_cell_id    uuid;
  v_alias      text;
  v_existed    boolean := false;
BEGIN
  -- Row + Col laden, Workspace + Matrix verifizieren.
  SELECT workspace_id, matrix_id INTO v_ws_row, v_matrix_row
    FROM public.rows WHERE id = p_row_id;
  SELECT workspace_id, matrix_id INTO v_ws_col, v_matrix_col
    FROM public.cols WHERE id = p_col_id;

  IF v_ws_row IS NULL THEN
    RAISE EXCEPTION 'row_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_ws_col IS NULL THEN
    RAISE EXCEPTION 'col_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_ws_row <> v_ws_col OR v_matrix_row <> v_matrix_col THEN
    RAISE EXCEPTION 'row_col_matrix_mismatch'
      USING ERRCODE = 'check_violation',
            HINT = 'Row und Col muessen zur selben Matrix im selben Workspace gehoeren.';
  END IF;

  v_ws := v_ws_row;
  PERFORM public._mcp_assert_writer(v_ws);

  v_alias := public._mcp_validate_alias(p_alias);

  -- Idempotenz: existiert die Cell bereits?
  SELECT id INTO v_cell_id
    FROM public.cells
   WHERE row_id = p_row_id AND col_id = p_col_id;

  IF v_cell_id IS NOT NULL THEN
    v_existed := true;
    -- Bei Wiederholung optional Alias setzen (nur wenn neu nicht NULL).
    IF v_alias IS NOT NULL THEN
      UPDATE public.cells SET alias = v_alias WHERE id = v_cell_id;
    END IF;
  ELSE
    INSERT INTO public.cells (
      workspace_id, matrix_id, row_id, col_id, alias, features, data
    )
    VALUES (
      v_ws, v_matrix_row, p_row_id, p_col_id, v_alias, ARRAY[]::text[], '{}'::jsonb
    )
    RETURNING id INTO v_cell_id;
  END IF;

  RETURN jsonb_build_object(
    'cell_id', v_cell_id,
    'workspace_id', v_ws,
    'matrix_id', v_matrix_row,
    'row_id', p_row_id,
    'col_id', p_col_id,
    'alias', v_alias,
    'existed', v_existed
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_add_cell(uuid, uuid, text) TO authenticated;

-- ─── mcp_link_cell_child_node ───────────────────────────────
-- Verknuepft eine existing Cell mit einem existing Sub-Knoten (Matrix
-- oder Board) und ergaenzt die features-Liste entsprechend. So kann
-- der Assistent eine "zweite Ebene" verkabeln, ohne dass der User
-- manuell ueber den UI-Wizard muss.
--
-- mcp_create_node mit p_parent_cell_id setzt zwar nodes.parent_cell_id,
-- aber NICHT cells.child_matrix_id / cells.board_id / features. Diese
-- Funktion schliesst die Luecke.
CREATE OR REPLACE FUNCTION public.mcp_link_cell_child_node(
  p_cell_id uuid,
  p_node_id uuid          -- Ziel-Knoten (matrix oder board)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ws_cell uuid;
  v_ws_node uuid;
  v_node_type public.node_type;
  v_feat    text;
BEGIN
  v_ws_cell := public._mcp_resolve_workspace('cell', p_cell_id);
  PERFORM public._mcp_assert_writer(v_ws_cell);

  SELECT workspace_id, type INTO v_ws_node, v_node_type
    FROM public.nodes WHERE id = p_node_id;

  IF v_ws_node IS NULL THEN
    RAISE EXCEPTION 'node_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_ws_node <> v_ws_cell THEN
    RAISE EXCEPTION 'cross_workspace_link' USING ERRCODE = 'check_violation';
  END IF;

  IF v_node_type = 'matrix' THEN
    v_feat := 'matrix';
    UPDATE public.cells
       SET child_matrix_id = p_node_id,
           features = (
             SELECT ARRAY(SELECT DISTINCT unnest(features || ARRAY[v_feat]::text[]))
               FROM public.cells WHERE id = p_cell_id
           )
     WHERE id = p_cell_id;
  ELSIF v_node_type = 'board' THEN
    v_feat := 'board';
    UPDATE public.cells
       SET board_id = p_node_id,
           features = (
             SELECT ARRAY(SELECT DISTINCT unnest(features || ARRAY[v_feat]::text[]))
               FROM public.cells WHERE id = p_cell_id
           )
     WHERE id = p_cell_id;
  ELSE
    RAISE EXCEPTION 'invalid_link_target_type'
      USING ERRCODE = 'check_violation', HINT = 'Ziel-Knoten muss matrix oder board sein.';
  END IF;

  RETURN jsonb_build_object(
    'cell_id', p_cell_id,
    'node_id', p_node_id,
    'feature', v_feat,
    'workspace_id', v_ws_cell
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_link_cell_child_node(uuid, uuid) TO authenticated;
