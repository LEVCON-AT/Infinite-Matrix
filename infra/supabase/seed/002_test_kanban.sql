-- ═══════════════════════════════════════════════════════════════
-- Seed: Test-Kanban fuer 0d.5-Verifikation
--
-- Fuellt das Board ^kanban (aus 001_test_tree.sql) mit:
--   3 Spalten (Backlog/Doing/Done)
--   4 Karten (davon 1 mit inline-Checkliste)
--   1 standalone Checkliste "Shopping" mit 3 Items
--   2 Links (URL + Mail-Vorlage)
--
-- Idempotent: wenn das Board schon kb_cols hat, passiert nichts.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_email text := 'albi.enric@gmail.com';
  v_ws    uuid;
  v_board uuid;
  v_col_backlog uuid;
  v_col_doing   uuid;
  v_col_done    uuid;
  v_card_recur  uuid;
  v_cl_shop     uuid;
BEGIN
  SELECT w.id INTO v_ws
  FROM public.workspaces w
  JOIN auth.users u ON u.id = w.owner_id
  WHERE u.email = v_email
  LIMIT 1;

  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'Workspace nicht gefunden fuer %', v_email;
  END IF;

  SELECT id INTO v_board
  FROM public.nodes
  WHERE workspace_id = v_ws AND lower(alias) = 'kanban' AND type = 'board'
  LIMIT 1;

  IF v_board IS NULL THEN
    RAISE EXCEPTION 'Board ^kanban nicht gefunden (zuerst 001_test_tree.sql laufen lassen)';
  END IF;

  IF EXISTS (SELECT 1 FROM public.kb_cols WHERE board_id = v_board) THEN
    RAISE NOTICE 'Kanban-Seed bereits vorhanden (kb_cols existieren). Nichts zu tun.';
    RETURN;
  END IF;

  -- ─── Spalten ───────────────────────────────────────────────
  INSERT INTO public.kb_cols (workspace_id, board_id, label, position, color)
    VALUES (v_ws, v_board, 'Backlog', 0, '#9aa0a6')
    RETURNING id INTO v_col_backlog;

  INSERT INTO public.kb_cols (workspace_id, board_id, label, position, color)
    VALUES (v_ws, v_board, 'Doing', 1, '#e0a94d')
    RETURNING id INTO v_col_doing;

  INSERT INTO public.kb_cols (workspace_id, board_id, label, position, color)
    VALUES (v_ws, v_board, 'Done', 2, '#6be3a6')
    RETURNING id INTO v_col_done;

  -- ─── Karten ────────────────────────────────────────────────
  INSERT INTO public.kb_cards (
    workspace_id, board_id, col_id, name, note, tags, who, deadline,
    priority, position
  ) VALUES (
    v_ws, v_board, v_col_backlog,
    'Wochenplan schreiben',
    E'Uebersicht fuer KW17: Features, Blocker, Meetings.\nBeispiel-Notiz mit Zeilenumbruch.',
    ARRAY['plan']::text[],
    ARRAY['me']::text[],
    CURRENT_DATE + INTERVAL '3 days',
    2,
    0
  );

  INSERT INTO public.kb_cards (
    workspace_id, board_id, col_id, name, note, tags, who, priority, position
  ) VALUES (
    v_ws, v_board, v_col_doing,
    '0d.5 implementieren',
    'BoardView mit Kanban-Spalten, Karten, Checklisten-Preview. Overlay fuer Detail-Ansicht.',
    ARRAY['dev','frontend']::text[],
    ARRAY['claude']::text[],
    1,
    0
  );

  INSERT INTO public.kb_cards (
    workspace_id, board_id, col_id, name, note, tags, recur,
    checklist, position
  ) VALUES (
    v_ws, v_board, v_col_doing,
    'Taegliche Routine',
    'Demo fuer recur + inline-Checkliste.',
    ARRAY['routine']::text[],
    jsonb_build_object(
      'type','daily','every',1,
      'startDate', to_char(CURRENT_DATE, 'YYYY-MM-DD'),
      'endType','never'
    ),
    jsonb_build_array(
      jsonb_build_object('id','it-1','text','Wasser trinken','done',true, 'level',0),
      jsonb_build_object('id','it-2','text','Sport','done',true, 'level',0),
      jsonb_build_object('id','it-3','text','Tages-Reflexion','done',false,'level',0),
      jsonb_build_object('id','it-4','text','  davon: 3 Erfolge','done',false,'level',1)
    ),
    1
  ) RETURNING id INTO v_card_recur;

  INSERT INTO public.kb_cards (
    workspace_id, board_id, col_id, name, done, archived, position
  ) VALUES (
    v_ws, v_board, v_col_done,
    '0d.4 abgeschlossen',
    true, false, 0
  );

  -- ─── Standalone-Checkliste ────────────────────────────────
  INSERT INTO public.checklists (
    workspace_id, board_id, label, position, alias, close_mode
  ) VALUES (
    v_ws, v_board, 'Shopping', 0, 'shop', 'auto-prompt'
  ) RETURNING id INTO v_cl_shop;

  INSERT INTO public.checklist_items (workspace_id, checklist_id, text, done, level, position)
  VALUES
    (v_ws, v_cl_shop, 'Brot', true, 0, 0),
    (v_ws, v_cl_shop, 'Milch', false, 0, 1),
    (v_ws, v_cl_shop, 'Obst', false, 0, 2),
    (v_ws, v_cl_shop, 'Aepfel', false, 1, 3),
    (v_ws, v_cl_shop, 'Bananen', false, 1, 4);

  -- ─── Links ────────────────────────────────────────────────
  INSERT INTO public.links (workspace_id, board_id, type, label, url, position)
  VALUES
    (v_ws, v_board, 'url',  'GitHub Repo', 'https://github.com/LEVCON-AT/Infinite-Matrix', 0),
    (v_ws, v_board, 'mail', 'Support',     'admin@levcon.at', 1);

  RAISE NOTICE 'Kanban-Seed angelegt: board=%, recur-card=%, shop-cl=%',
    v_board, v_card_recur, v_cl_shop;
END $$;
