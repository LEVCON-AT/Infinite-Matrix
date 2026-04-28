-- ═══════════════════════════════════════════════════════════════
-- Phase 3 Welle O.2a — Object-Layer RPCs
--
-- mcp_create_object: SECURITY DEFINER, owner/admin/editor only.
--   Aufruf vom Frontend wenn eine neue Row/Col/Kb_col getippt wird.
--   home_ref wird optional gesetzt — Frontend backfilled nach Row-
--   Insert. Alias wird in O.2b autocomplete-/manuell vergeben.
--
-- mcp_search_objects: Trigram-Search auf objects.label fuer Autocomplete-
--   Suggestion-Dropdown (O.2b). Gibt top-N nach pg_trgm-Score sortiert.
--
-- mcp_set_object_home_ref: Backfill nach Row-/Col-/Kb_col-Insert.
--   Frontend ruft 3-stufig: create_object → insert row → set_home_ref.
--
-- Pattern aus Migration 021 (mcp_create_node), search_path explizit,
-- _mcp_validate_label/_mcp_validate_alias re-use.
-- ═══════════════════════════════════════════════════════════════

-- ─── Helper: workspace-writer-Assert ────────────────────────
-- Existiert bereits aus Migration 021 (_mcp_assert_writer). Re-use.
-- _mcp_validate_label / _mcp_validate_alias ebenso aus Migration 021.

-- ─── mcp_create_object ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_create_object(
  p_workspace_id  uuid,
  p_label         text,
  p_alias         text,           -- optional
  p_type_label    text,           -- optional
  p_parent_id     uuid,           -- optional
  p_attrs         jsonb,          -- default '{}'
  p_home_ref_kind public.object_home_ref_kind,  -- optional
  p_home_ref_id   uuid            -- optional
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_label    text;
  v_alias    text;
  v_object_id uuid;
  v_parent_ws uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM public._mcp_assert_writer(p_workspace_id);
  v_label := public._mcp_validate_label(p_label);
  v_alias := public._mcp_validate_alias(p_alias);

  -- Wenn parent_id gesetzt: Parent muss in selbem Workspace sein.
  IF p_parent_id IS NOT NULL THEN
    SELECT workspace_id INTO v_parent_ws FROM public.objects WHERE id = p_parent_id;
    IF v_parent_ws IS NULL THEN
      RAISE EXCEPTION 'parent_object_not_found' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_parent_ws <> p_workspace_id THEN
      RAISE EXCEPTION 'cross_workspace_parent' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO public.objects (
    workspace_id, label, alias, type_label, parent_id, attrs,
    home_ref_kind, home_ref_id, created_by
  )
  VALUES (
    p_workspace_id, v_label, v_alias, p_type_label, p_parent_id,
    COALESCE(p_attrs, '{}'::jsonb),
    p_home_ref_kind, p_home_ref_id, v_actor
  )
  RETURNING id INTO v_object_id;

  RETURN jsonb_build_object(
    'object_id', v_object_id,
    'workspace_id', p_workspace_id,
    'label', v_label,
    'alias', v_alias
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_create_object(
  uuid, text, text, text, uuid, jsonb,
  public.object_home_ref_kind, uuid
) TO authenticated;

COMMENT ON FUNCTION public.mcp_create_object IS
  'Phase 3 O.2a — erzeugt einen Object-Eintrag im gegebenen Workspace. SECURITY DEFINER, writer-rolle Pflicht. Pattern aus Migration 021 (mcp_create_node). Aufgerufen vom Frontend wenn neue Zeile/Spalte/Kb_col getippt wird.';

-- ─── mcp_set_object_home_ref ────────────────────────────────
-- Backfill nach Row-/Col-/Kb_col-Insert. 3-Schritt-Pattern damit das
-- Frontend sequenziell mit optimistic-updates arbeiten kann.
CREATE OR REPLACE FUNCTION public.mcp_set_object_home_ref(
  p_object_id     uuid,
  p_home_ref_kind public.object_home_ref_kind,
  p_home_ref_id   uuid
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

  UPDATE public.objects
     SET home_ref_kind = p_home_ref_kind,
         home_ref_id   = p_home_ref_id
   WHERE id = p_object_id;

  RETURN jsonb_build_object(
    'object_id', p_object_id,
    'home_ref_kind', p_home_ref_kind,
    'home_ref_id', p_home_ref_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_set_object_home_ref(
  uuid, public.object_home_ref_kind, uuid
) TO authenticated;

COMMENT ON FUNCTION public.mcp_set_object_home_ref IS
  'Phase 3 O.2a — Backfill home_ref_kind/_id auf einem existing Object. Frontend ruft das nach Row-/Col-/Kb_col-Insert um den "wo wurde es zuerst erstellt"-Anker zu setzen.';

-- ─── mcp_search_objects (fuer Autocomplete in O.2b) ─────────
-- Trigram-Fuzzy-Search auf objects.label im aktuellen Workspace.
-- Sortiert nach pg_trgm-Similarity. Top-N (default 8).
--
-- Wird in O.2b vom ObjectSuggestion-Dropdown aufgerufen waehrend der
-- User eine Zeile/Spalte tippt: gibt existierende Objects mit aehnlichem
-- Label zurueck, der User kann waehlen → Reuse statt neu anlegen.
CREATE OR REPLACE FUNCTION public.mcp_search_objects(
  p_workspace_id uuid,
  p_query        text,
  p_limit        int DEFAULT 8
)
RETURNS TABLE (
  id          uuid,
  label       text,
  type_label  text,
  alias       text,
  similarity  real
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_role public.workspace_role;
BEGIN
  v_role := public.workspace_role_of(p_workspace_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_query IS NULL OR length(trim(p_query)) = 0 THEN
    -- Leere Query: top-N nach Aktualitaet (created_at DESC). Schnell-
    -- Vorschlag fuer "ohne tippen einfach gucken was es gibt".
    RETURN QUERY
      SELECT o.id, o.label, o.type_label, o.alias, 0::real AS similarity
        FROM public.objects o
       WHERE o.workspace_id = p_workspace_id
       ORDER BY o.created_at DESC
       LIMIT GREATEST(p_limit, 1);
    RETURN;
  END IF;

  RETURN QUERY
    SELECT o.id, o.label, o.type_label, o.alias,
           similarity(o.label, p_query) AS sim
      FROM public.objects o
     WHERE o.workspace_id = p_workspace_id
       AND o.label % p_query                        -- Trigram-Match (Schwelle pg_trgm.similarity_threshold)
     ORDER BY sim DESC, o.label ASC
     LIMIT GREATEST(p_limit, 1);
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_search_objects(uuid, text, int) TO authenticated;

COMMENT ON FUNCTION public.mcp_search_objects IS
  'Phase 3 O.2 — Trigram-Fuzzy-Search auf objects.label fuer Autocomplete. Empty p_query → top-N nach Aktualitaet. Limit default 8, geclampt auf min 1.';

-- ─── Smoke (manuell nach Apply) ─────────────────────────────
-- 1. SELECT mcp_create_object('<ws>', 'Test-Object', null, 'Kunde', null, '{}'::jsonb, null, null);
-- 2. SELECT mcp_search_objects('<ws>', 'Test', 5);  -- findet 'Test-Object'
-- 3. SELECT mcp_set_object_home_ref('<obj-id>', 'standalone', null);  -- klappt fuer Owner
