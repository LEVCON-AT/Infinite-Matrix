-- ═══════════════════════════════════════════════════════════════
-- Phase 2 Welle A.1 — MCP-Tool-RPCs fuer KI-Pipe
--
-- Browser-direct-Architektur: der Browser macht den LLM-Aufruf direkt
-- (kein externer Service, siehe docs/plan-user-backend.md). Dafuer
-- braucht es:
--   1) get_my_provider_credential() — gibt den Klartext-API-Key des
--      Default-Providers an den eingeloggten User zurueck (decrypt mit
--      Master-Key aus Migration 018, _ai_master_key()).
--   2) MCP-Tool-RPCs — die der LLM via tool_use aufruft. Jedes RPC ist
--      SECURITY DEFINER + workspace_role_of-Check + Tool-Args-Validation
--      (Length/Type/Regex). Nur "safe"-Klasse Tools hier; destructive
--      Tools (delete_*) bleiben Frontend-Confirm-Pattern (siehe Plan
--      Section "LLM-Tool-Allowlist").
--
-- Pattern: identisch zu change_member_role aus Migration 014.
-- search_path explizit. auth.uid() NULL-Check. Errors strukturiert.
--
-- Schema-Quad-Regel: diese RPCs spiegeln Mutation-Helper aus
-- packages/client-web/src/lib/mutations.ts. Sie sind eine PARALLELE
-- Tool-Schicht fuer LLM-Calls — die Frontend-Mutations bleiben fuer
-- Direct-User-Pfade unangetastet.
--
-- Tool-Allowlist (siehe Plan):
--   - safe: alle hier definierten RPCs (LLM darf direkt aufrufen)
--   - destructive: delete_node/card/checklist/doc — NICHT hier, kommen
--     als request_-Variante mit Frontend-Confirm in spaeteren Sprints
--   - forbidden: account/auth/workspace-lifecycle/webhooks — NICHT als
--     Tool exposed, taucht nicht im LLM-Schema auf
-- ═══════════════════════════════════════════════════════════════

-- ─── Helper: Provider-Credential-Decrypt ────────────────────────
-- Gibt fuer den eingeloggten User den Klartext-API-Key des Default-
-- Providers zurueck. Plus kind + model_name. Aufrufer ist lib/ai-
-- assist.ts im Browser, das den Key fuer den Outbound-LLM-Header nutzt.
--
-- WICHTIG: Diese Funktion ist die EINZIGE Stelle die je den Klartext-
-- Key liefert. Sie laeuft ueber auth.uid(), kein Service-Role-Pfad.
-- Frontend-RLS-Filter via _safe-View garantiert dass User nur seinen
-- eigenen Key sieht.
CREATE OR REPLACE FUNCTION public.get_my_provider_credential()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_kind     public.ai_provider_kind;
  v_label    text;
  v_key_enc  bytea;
  v_model    text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT kind, label, api_key_encrypted, model_name
    INTO v_kind, v_label, v_key_enc, v_model
    FROM public.user_ai_providers
   WHERE user_id = v_actor AND is_default
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_default_provider'
      USING HINT = 'Bitte unter Settings > Konto > AI-Anbindung einen Provider als Standard setzen.';
  END IF;

  RETURN jsonb_build_object(
    'kind', v_kind,
    'label', v_label,
    'model_name', v_model,
    'api_key', pgp_sym_decrypt(v_key_enc, public._ai_master_key())
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_my_provider_credential() TO authenticated;

COMMENT ON FUNCTION public.get_my_provider_credential() IS
  'Liefert den Default-Provider des eingeloggten Users mit decrypted Klartext-Key. Aufruf von lib/ai-assist.ts vor jedem LLM-Call. Sicherheit: nur via JWT, RLS implizit (auth.uid()).';

-- ─── MCP-Helper: workspace_id eines beliebigen Resource-Refs holen ──
-- Wird von Tools gebraucht die board_id/cell_id/node_id/checklist_id
-- entgegennehmen, aber den Workspace-Scope vorab pruefen muessen.
CREATE OR REPLACE FUNCTION public._mcp_resolve_workspace(
  p_kind text,        -- 'node' | 'cell' | 'board_node' | 'col' | 'card' | 'checklist'
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
    WHEN 'card' THEN
      SELECT workspace_id INTO v_ws FROM public.kb_cards WHERE id = p_id;
    WHEN 'checklist' THEN
      SELECT workspace_id INTO v_ws FROM public.checklists WHERE id = p_id;
    WHEN 'checklist_item' THEN
      SELECT workspace_id INTO v_ws FROM public.checklist_items WHERE id = p_id;
    ELSE
      RAISE EXCEPTION 'unknown_resource_kind: %', p_kind;
  END CASE;

  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'resource_not_found: % %', p_kind, p_id
      USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_ws;
END $$;

-- _mcp_assert_writer: einheitlicher Role-Gate. Owner/admin/editor duerfen
-- mutieren; viewer wird abgelehnt.
CREATE OR REPLACE FUNCTION public._mcp_assert_writer(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_role public.workspace_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_role := public.workspace_role_of(p_workspace_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_role NOT IN ('owner', 'admin', 'editor') THEN
    RAISE EXCEPTION 'viewer_cannot_mutate' USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

-- _mcp_validate_label: Tool-Args-Validation Pattern. Trim, length 1-200.
CREATE OR REPLACE FUNCTION public._mcp_validate_label(p_label text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_trim text;
BEGIN
  v_trim := trim(p_label);
  IF length(v_trim) = 0 THEN
    RAISE EXCEPTION 'label_empty' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_trim) > 200 THEN
    RAISE EXCEPTION 'label_too_long_max_200' USING ERRCODE = 'check_violation';
  END IF;
  RETURN v_trim;
END $$;

-- _mcp_validate_alias: optional, max 50, alphanumeric + underscore.
CREATE OR REPLACE FUNCTION public._mcp_validate_alias(p_alias text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_trim text;
BEGIN
  IF p_alias IS NULL THEN RETURN NULL; END IF;
  v_trim := trim(p_alias);
  IF length(v_trim) = 0 THEN RETURN NULL; END IF;
  IF length(v_trim) > 50 THEN
    RAISE EXCEPTION 'alias_too_long_max_50' USING ERRCODE = 'check_violation';
  END IF;
  IF v_trim !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'alias_invalid_chars' USING ERRCODE = 'check_violation',
      HINT = 'Alias darf nur Buchstaben, Zahlen, _ und - enthalten.';
  END IF;
  RETURN v_trim;
END $$;

-- ─── Read-Tool: Workspace-Context fuer LLM ──────────────────────
-- Liefert eine kompakte JSONB-Struktur die der LLM in seinen Context
-- bekommt: Workspace-Name + Knoten-Liste + pro Knoten Cells (mit
-- Feature-Set) + Card-Counts. Fuer A.3 Inline-Help-Drawer und A.4
-- Onboarding-Wizard. KEINE Card-Inhalte/Notes/Checklist-Items
-- exposed (Volume + Privacy).
CREATE OR REPLACE FUNCTION public.mcp_get_workspace_context(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_role  public.workspace_role;
  v_name  text;
  v_nodes jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_role := public.workspace_role_of(p_workspace_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT name INTO v_name FROM public.workspaces WHERE id = p_workspace_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'type', n.type,
    'label', n.label,
    'alias', n.alias,
    'parent_cell_id', n.parent_cell_id,
    'cell_count', (SELECT count(*) FROM public.cells WHERE matrix_id = n.id),
    'card_count', CASE WHEN n.type = 'board'
                       THEN (SELECT count(*) FROM public.kb_cards WHERE board_id = n.id)
                       ELSE 0 END
  ) ORDER BY n.created_at), '[]'::jsonb)
    INTO v_nodes
    FROM public.nodes n
   WHERE n.workspace_id = p_workspace_id;

  RETURN jsonb_build_object(
    'workspace_id', p_workspace_id,
    'workspace_name', v_name,
    'caller_role', v_role,
    'nodes', v_nodes
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_get_workspace_context(uuid) TO authenticated;

-- ─── Create-Tools (safe class) ──────────────────────────────────

-- mcp_create_node: neuer matrix/board-Knoten. parent_cell_id optional
-- (NULL = Workspace-Root-Knoten, wenn supported).
CREATE OR REPLACE FUNCTION public.mcp_create_node(
  p_workspace_id    uuid,
  p_parent_cell_id  uuid,         -- NULL fuer Top-Level
  p_type            text,         -- 'matrix' | 'board'
  p_label           text,
  p_alias           text          -- optional
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_node_id uuid;
  v_label   text;
  v_alias   text;
  v_parent_ws uuid;
BEGIN
  PERFORM public._mcp_assert_writer(p_workspace_id);
  v_label := public._mcp_validate_label(p_label);
  v_alias := public._mcp_validate_alias(p_alias);

  IF p_type NOT IN ('matrix', 'board') THEN
    RAISE EXCEPTION 'invalid_node_type'
      USING ERRCODE = 'check_violation', HINT = 'type muss matrix oder board sein.';
  END IF;

  -- Wenn parent_cell_id gesetzt: Parent muss in selbem Workspace sein.
  IF p_parent_cell_id IS NOT NULL THEN
    SELECT workspace_id INTO v_parent_ws FROM public.cells WHERE id = p_parent_cell_id;
    IF v_parent_ws IS NULL THEN
      RAISE EXCEPTION 'parent_cell_not_found' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_parent_ws <> p_workspace_id THEN
      RAISE EXCEPTION 'cross_workspace_parent' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO public.nodes (workspace_id, type, label, alias, parent_cell_id, data)
    VALUES (p_workspace_id, p_type::public.node_type, v_label, v_alias, p_parent_cell_id, '{}'::jsonb)
    RETURNING id INTO v_node_id;

  RETURN jsonb_build_object(
    'node_id', v_node_id,
    'workspace_id', p_workspace_id,
    'type', p_type,
    'label', v_label,
    'alias', v_alias,
    'parent_cell_id', p_parent_cell_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_create_node(uuid, uuid, text, text, text) TO authenticated;

-- mcp_rename_node: Label aendern.
CREATE OR REPLACE FUNCTION public.mcp_rename_node(
  p_node_id   uuid,
  p_new_label text
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
  v_ws := public._mcp_resolve_workspace('node', p_node_id);
  PERFORM public._mcp_assert_writer(v_ws);
  v_label := public._mcp_validate_label(p_new_label);

  UPDATE public.nodes SET label = v_label WHERE id = p_node_id;
  RETURN jsonb_build_object('node_id', p_node_id, 'label', v_label);
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_rename_node(uuid, text) TO authenticated;

-- mcp_set_node_alias: Alias aendern oder loeschen (NULL).
CREATE OR REPLACE FUNCTION public.mcp_set_node_alias(
  p_node_id uuid,
  p_alias   text          -- NULL = Alias entfernen
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ws    uuid;
  v_alias text;
BEGIN
  v_ws := public._mcp_resolve_workspace('node', p_node_id);
  PERFORM public._mcp_assert_writer(v_ws);
  v_alias := public._mcp_validate_alias(p_alias);

  UPDATE public.nodes SET alias = v_alias WHERE id = p_node_id;
  RETURN jsonb_build_object('node_id', p_node_id, 'alias', v_alias);
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_set_node_alias(uuid, text) TO authenticated;

-- mcp_create_card: neue Karte in einer Spalte.
-- Position = max + 1 in dieser Spalte.
CREATE OR REPLACE FUNCTION public.mcp_create_card(
  p_col_id  uuid,
  p_name    text,
  p_note    text,         -- optional, default ''
  p_alias   text          -- optional
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ws       uuid;
  v_board_id uuid;
  v_card_id  uuid;
  v_pos      int;
  v_name     text;
  v_alias    text;
BEGIN
  v_ws := public._mcp_resolve_workspace('col', p_col_id);
  PERFORM public._mcp_assert_writer(v_ws);
  v_name := public._mcp_validate_label(p_name);
  v_alias := public._mcp_validate_alias(p_alias);

  -- Board-ID aus der Spalte holen (kb_cols.board_id ist FK auf nodes)
  SELECT board_id INTO v_board_id FROM public.kb_cols WHERE id = p_col_id;
  IF v_board_id IS NULL THEN
    RAISE EXCEPTION 'col_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT COALESCE(max(position) + 1, 0) INTO v_pos
    FROM public.kb_cards
   WHERE board_id = v_board_id AND col_id = p_col_id;

  -- note auf 5000 Zeichen limitieren (Volume + LLM-Output-Cap)
  IF p_note IS NOT NULL AND length(p_note) > 5000 THEN
    RAISE EXCEPTION 'note_too_long_max_5000' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.kb_cards (
    workspace_id, board_id, col_id, name, note, alias, position, tags, who, done_occurrences
  ) VALUES (
    v_ws, v_board_id, p_col_id, v_name, COALESCE(p_note, ''), v_alias, v_pos,
    ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[]
  ) RETURNING id INTO v_card_id;

  RETURN jsonb_build_object(
    'card_id', v_card_id,
    'board_id', v_board_id,
    'col_id', p_col_id,
    'name', v_name,
    'position', v_pos
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_create_card(uuid, text, text, text) TO authenticated;

-- mcp_rename_card: Name aendern.
CREATE OR REPLACE FUNCTION public.mcp_rename_card(
  p_card_id uuid,
  p_new_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ws   uuid;
  v_name text;
BEGIN
  v_ws := public._mcp_resolve_workspace('card', p_card_id);
  PERFORM public._mcp_assert_writer(v_ws);
  v_name := public._mcp_validate_label(p_new_name);

  UPDATE public.kb_cards SET name = v_name WHERE id = p_card_id;
  RETURN jsonb_build_object('card_id', p_card_id, 'name', v_name);
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_rename_card(uuid, text) TO authenticated;

-- mcp_move_card: cross-col-move. Setzt col_id + position = max+1 in
-- Ziel-Col. Innerhalb-Col-Sort wird durch Trigger 020 nicht geloggt
-- (Volume-Risk), cross-col triggert card.moved-Audit.
CREATE OR REPLACE FUNCTION public.mcp_move_card(
  p_card_id      uuid,
  p_target_col_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ws      uuid;
  v_card_ws uuid;
  v_card_board uuid;
  v_target_ws  uuid;
  v_target_board uuid;
  v_pos     int;
BEGIN
  v_card_ws := public._mcp_resolve_workspace('card', p_card_id);
  PERFORM public._mcp_assert_writer(v_card_ws);
  v_target_ws := public._mcp_resolve_workspace('col', p_target_col_id);

  IF v_card_ws <> v_target_ws THEN
    RAISE EXCEPTION 'cross_workspace_move' USING ERRCODE = 'check_violation';
  END IF;

  SELECT board_id INTO v_card_board FROM public.kb_cards WHERE id = p_card_id;
  SELECT board_id INTO v_target_board FROM public.kb_cols WHERE id = p_target_col_id;

  IF v_card_board <> v_target_board THEN
    RAISE EXCEPTION 'cross_board_move_not_supported'
      USING ERRCODE = 'check_violation',
            HINT = 'Karte zuerst auf gleichem Board verschieben oder Cross-Board manuell.';
  END IF;

  SELECT COALESCE(max(position) + 1, 0) INTO v_pos
    FROM public.kb_cards
   WHERE board_id = v_card_board AND col_id = p_target_col_id;

  UPDATE public.kb_cards
     SET col_id = p_target_col_id, position = v_pos
   WHERE id = p_card_id;

  RETURN jsonb_build_object('card_id', p_card_id, 'col_id', p_target_col_id, 'position', v_pos);
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_move_card(uuid, uuid) TO authenticated;

-- mcp_set_card_archived: archiviert/de-archiviert. Reversibel — kein Confirm.
CREATE OR REPLACE FUNCTION public.mcp_set_card_archived(
  p_card_id  uuid,
  p_archived boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ws uuid;
BEGIN
  v_ws := public._mcp_resolve_workspace('card', p_card_id);
  PERFORM public._mcp_assert_writer(v_ws);

  UPDATE public.kb_cards SET archived = p_archived WHERE id = p_card_id;
  RETURN jsonb_build_object('card_id', p_card_id, 'archived', p_archived);
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_set_card_archived(uuid, boolean) TO authenticated;

-- mcp_create_checklist: Cell- ODER Board-bezogene Liste.
-- Genau eines von p_cell_id / p_board_id muss gesetzt sein
-- (DB-Constraint enforces XOR via 003_checklist_cell_parent.sql).
CREATE OR REPLACE FUNCTION public.mcp_create_checklist(
  p_cell_id  uuid,         -- NULL fuer board-bezogen
  p_board_id uuid,         -- NULL fuer cell-bezogen
  p_label    text,
  p_alias    text          -- optional
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ws    uuid;
  v_cl_id uuid;
  v_label text;
  v_alias text;
  v_pos   int;
BEGIN
  IF (p_cell_id IS NULL AND p_board_id IS NULL)
     OR (p_cell_id IS NOT NULL AND p_board_id IS NOT NULL) THEN
    RAISE EXCEPTION 'exactly_one_of_cell_or_board_required'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_cell_id IS NOT NULL THEN
    v_ws := public._mcp_resolve_workspace('cell', p_cell_id);
  ELSE
    v_ws := public._mcp_resolve_workspace('node', p_board_id);
  END IF;
  PERFORM public._mcp_assert_writer(v_ws);
  v_label := public._mcp_validate_label(p_label);
  v_alias := public._mcp_validate_alias(p_alias);

  -- Position: max+1 im Scope (cell oder board)
  IF p_cell_id IS NOT NULL THEN
    SELECT COALESCE(max(position) + 1, 0) INTO v_pos
      FROM public.checklists WHERE cell_id = p_cell_id;
  ELSE
    SELECT COALESCE(max(position) + 1, 0) INTO v_pos
      FROM public.checklists WHERE board_id = p_board_id;
  END IF;

  INSERT INTO public.checklists (
    workspace_id, board_id, cell_id, label, alias, position, close_mode
  ) VALUES (
    v_ws, p_board_id, p_cell_id, v_label, v_alias, v_pos, 'manual'
  ) RETURNING id INTO v_cl_id;

  RETURN jsonb_build_object(
    'checklist_id', v_cl_id,
    'cell_id', p_cell_id,
    'board_id', p_board_id,
    'label', v_label,
    'position', v_pos
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_create_checklist(uuid, uuid, text, text) TO authenticated;

-- mcp_add_checklist_item: Item zur Liste hinzufuegen.
-- level = 0 (default), 1 oder 2 fuer Einrueckung.
CREATE OR REPLACE FUNCTION public.mcp_add_checklist_item(
  p_checklist_id uuid,
  p_text  text,
  p_level int        -- default 0; 0|1|2
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_ws   uuid;
  v_item uuid;
  v_text text;
  v_lvl  int;
  v_pos  int;
BEGIN
  v_ws := public._mcp_resolve_workspace('checklist', p_checklist_id);
  PERFORM public._mcp_assert_writer(v_ws);

  v_text := trim(p_text);
  IF length(v_text) = 0 THEN
    RAISE EXCEPTION 'item_text_empty' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_text) > 500 THEN
    RAISE EXCEPTION 'item_text_too_long_max_500' USING ERRCODE = 'check_violation';
  END IF;

  v_lvl := COALESCE(p_level, 0);
  IF v_lvl NOT IN (0, 1, 2) THEN
    RAISE EXCEPTION 'invalid_level' USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(max(position) + 1, 0) INTO v_pos
    FROM public.checklist_items WHERE checklist_id = p_checklist_id;

  INSERT INTO public.checklist_items (
    workspace_id, checklist_id, text, done, level, position
  ) VALUES (
    v_ws, p_checklist_id, v_text, false, v_lvl, v_pos
  ) RETURNING id INTO v_item;

  RETURN jsonb_build_object(
    'item_id', v_item,
    'checklist_id', p_checklist_id,
    'text', v_text,
    'level', v_lvl,
    'position', v_pos
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_add_checklist_item(uuid, text, int) TO authenticated;

-- ─── Comments ──────────────────────────────────────────────────
COMMENT ON FUNCTION public.get_my_provider_credential() IS
  'Decrypt + return Default-AI-Provider fuer eingeloggten User. Aufruf von Browser vor jedem LLM-Outbound-Call.';
COMMENT ON FUNCTION public.mcp_get_workspace_context(uuid) IS
  'Read-only Workspace-Snapshot fuer LLM-Context (Tree + Cell-Counts + Card-Counts). Keine Card-Inhalte.';
COMMENT ON FUNCTION public.mcp_create_node(uuid, uuid, text, text, text) IS
  'MCP-Tool: erstellt matrix/board-Knoten. Optional unter parent_cell_id geschachtelt.';
COMMENT ON FUNCTION public.mcp_create_card(uuid, text, text, text) IS
  'MCP-Tool: erstellt Karte in einer Kanban-Spalte. note max 5000 Zeichen.';
COMMENT ON FUNCTION public.mcp_move_card(uuid, uuid) IS
  'MCP-Tool: cross-col-move innerhalb desselben Boards. Cross-Board oder cross-Workspace blockiert.';
COMMENT ON FUNCTION public.mcp_create_checklist(uuid, uuid, text, text) IS
  'MCP-Tool: Liste auf Cell ODER Board (XOR). Genau eines von cell_id/board_id muss gesetzt sein.';
COMMENT ON FUNCTION public.mcp_add_checklist_item(uuid, text, int) IS
  'MCP-Tool: Item zur Checkliste. level 0/1/2 fuer Einrueckung. text max 500 Zeichen.';
