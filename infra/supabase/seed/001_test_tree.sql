-- ═══════════════════════════════════════════════════════════════
-- Seed: Test-Tree fuer 0d-Verifikation
--
-- Legt einen minimalen Baum im Workspace von albi.enric@gmail.com an:
--   Lebens-Matrix (^life)
--     └── Tages-Plan  (unter Zelle Arbeit/Heute)
--   Kanban-Demo (^kanban)
--
-- Idempotent: prueft via alias, ob schon angelegt; tut dann nichts.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_email text := 'albi.enric@gmail.com';
  v_ws   uuid;
  v_root uuid;
  v_row  uuid;
  v_col  uuid;
  v_cell uuid;
  v_sub  uuid;
  v_board uuid;
BEGIN
  SELECT w.id INTO v_ws
  FROM public.workspaces w
  JOIN auth.users u ON u.id = w.owner_id
  WHERE u.email = v_email
  LIMIT 1;

  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'Workspace nicht gefunden fuer %', v_email;
  END IF;

  -- Idempotenz: Alias 'life' bereits vorhanden? Dann raus.
  IF EXISTS (SELECT 1 FROM public.nodes WHERE workspace_id = v_ws AND lower(alias) = 'life') THEN
    RAISE NOTICE 'Seed bereits vorhanden (alias=life). Nichts zu tun.';
    RETURN;
  END IF;

  INSERT INTO public.nodes (workspace_id, type, label, alias)
    VALUES (v_ws, 'matrix', 'Lebens-Matrix', 'life')
    RETURNING id INTO v_root;

  INSERT INTO public.rows (matrix_id, workspace_id, label, position)
    VALUES (v_root, v_ws, 'Arbeit', 0)
    RETURNING id INTO v_row;

  INSERT INTO public.cols (matrix_id, workspace_id, label, position)
    VALUES (v_root, v_ws, 'Heute', 0)
    RETURNING id INTO v_col;

  INSERT INTO public.cells (workspace_id, matrix_id, row_id, col_id, features)
    VALUES (v_ws, v_root, v_row, v_col, ARRAY['matrix']::text[])
    RETURNING id INTO v_cell;

  INSERT INTO public.nodes (workspace_id, type, label, parent_cell_id)
    VALUES (v_ws, 'matrix', 'Tages-Plan', v_cell)
    RETURNING id INTO v_sub;

  UPDATE public.cells SET child_matrix_id = v_sub WHERE id = v_cell;

  INSERT INTO public.nodes (workspace_id, type, label, alias)
    VALUES (v_ws, 'board', 'Kanban-Demo', 'kanban')
    RETURNING id INTO v_board;

  RAISE NOTICE 'Seed angelegt: root=%, sub=%, board=%', v_root, v_sub, v_board;
END $$;
