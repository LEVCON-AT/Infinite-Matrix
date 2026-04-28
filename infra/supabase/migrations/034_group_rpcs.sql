-- ═══════════════════════════════════════════════════════════════
-- Phase 3 Welle O.3 — Group/SoftGroup-RPCs
--
-- Bulk-Entry-Modal kann beim Anlegen von N Zeilen/Spalten optional
-- eine echte `groups`-Entry mit den N erzeugten Object-Refs als
-- Members anlegen. Auch nachtraeglich (Bulk-Edit auf existing Matrix)
-- soll dasselbe Modal Gruppen anlegen koennen.
--
-- Soft-Gruppen sind die ephemere Variante: ohne expliziten "Als Gruppe
-- speichern"-Klick wird die Multi-Select-Auswahl als soft_groups-Entry
-- gespeichert — bei der naechsten aehnlichen Bulk-Aktion bekommt der
-- User einen Quick-Vorschlag. TTL 60 Tage ohne Re-Use → Cleanup-Job
-- in O.7.
--
-- Pattern wie Migration 021/033: SECURITY DEFINER, _mcp_assert_writer,
-- _mcp_validate_label re-use, search_path explizit.
-- ═══════════════════════════════════════════════════════════════

-- ─── mcp_create_group ───────────────────────────────────────
-- Direkter "neue Gruppe anlegen"-Pfad. Object-Members werden in einem
-- separaten Call (mcp_add_group_members) hinzugefuegt — sonst muesste
-- der RPC eine variable-laengen UUID-Liste annehmen, was per RPC zwar
-- moeglich ist (uuid[]) aber das Frontend-Optimistic-Pattern bricht.
CREATE OR REPLACE FUNCTION public.mcp_create_group(
  p_workspace_id uuid,
  p_name         text,
  p_description  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_name     text;
  v_group_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM public._mcp_assert_writer(p_workspace_id);
  v_name := public._mcp_validate_label(p_name);

  INSERT INTO public.groups (workspace_id, name, description, created_by)
  VALUES (p_workspace_id, v_name, NULLIF(trim(coalesce(p_description, '')), ''), v_actor)
  RETURNING id INTO v_group_id;

  RETURN jsonb_build_object(
    'group_id',     v_group_id,
    'workspace_id', p_workspace_id,
    'name',         v_name
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_create_group(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.mcp_create_group IS
  'Phase 3 O.3 — neue Group im Workspace. Members folgen via mcp_add_group_members.';

-- ─── mcp_add_group_members ──────────────────────────────────
-- Idempotenter Bulk-Insert (ON CONFLICT DO NOTHING). object_ids wird
-- als uuid[] uebergeben, alle muessen im selben Workspace wie die
-- Group sein — sonst Reject.
CREATE OR REPLACE FUNCTION public.mcp_add_group_members(
  p_group_id   uuid,
  p_object_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_ws      uuid;
  v_added   int;
  v_invalid int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT workspace_id INTO v_ws FROM public.groups WHERE id = p_group_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'group_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public._mcp_assert_writer(v_ws);

  -- Cross-Workspace-Check: alle Objects muessen in v_ws liegen.
  SELECT count(*) INTO v_invalid
    FROM unnest(p_object_ids) AS oid
   WHERE NOT EXISTS (
     SELECT 1 FROM public.objects o
      WHERE o.id = oid AND o.workspace_id = v_ws
   );
  IF v_invalid > 0 THEN
    RAISE EXCEPTION 'cross_workspace_object' USING ERRCODE = 'check_violation';
  END IF;

  WITH ins AS (
    INSERT INTO public.group_members (group_id, object_id, workspace_id)
    SELECT p_group_id, oid, v_ws
      FROM unnest(p_object_ids) AS oid
      ON CONFLICT (group_id, object_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_added FROM ins;

  RETURN jsonb_build_object(
    'group_id', p_group_id,
    'added',    v_added,
    'total',    array_length(p_object_ids, 1)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_add_group_members(uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.mcp_add_group_members IS
  'Phase 3 O.3 — fuegt Object-Refs in Group ein. Idempotent (ON CONFLICT DO NOTHING). Cross-Workspace-Refs werden rejected.';

-- ─── mcp_remove_group_members ───────────────────────────────
-- Symmetrie zum add. Wird in Group-Mgmt-Page (O.7) aktiviert,
-- aber schon in O.3 mit ausgeliefert — kein Aufwand.
CREATE OR REPLACE FUNCTION public.mcp_remove_group_members(
  p_group_id   uuid,
  p_object_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_ws      uuid;
  v_removed int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT workspace_id INTO v_ws FROM public.groups WHERE id = p_group_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'group_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public._mcp_assert_writer(v_ws);

  WITH del AS (
    DELETE FROM public.group_members
     WHERE group_id = p_group_id
       AND object_id = ANY (p_object_ids)
    RETURNING 1
  )
  SELECT count(*) INTO v_removed FROM del;

  RETURN jsonb_build_object(
    'group_id', p_group_id,
    'removed',  v_removed
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_remove_group_members(uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.mcp_remove_group_members IS
  'Phase 3 O.3 — entfernt Object-Refs aus Group. Symmetrie zu mcp_add_group_members.';

-- ─── mcp_rename_group ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mcp_rename_group(
  p_group_id uuid,
  p_new_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ws    uuid;
  v_name  text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT workspace_id INTO v_ws FROM public.groups WHERE id = p_group_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'group_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public._mcp_assert_writer(v_ws);
  v_name := public._mcp_validate_label(p_new_name);

  UPDATE public.groups SET name = v_name WHERE id = p_group_id;

  RETURN jsonb_build_object('group_id', p_group_id, 'name', v_name);
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_rename_group(uuid, text) TO authenticated;

-- ─── mcp_delete_group ───────────────────────────────────────
-- Cascade auf group_members ist via FK ON DELETE CASCADE in Migration 030.
CREATE OR REPLACE FUNCTION public.mcp_delete_group(p_group_id uuid)
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

  SELECT workspace_id INTO v_ws FROM public.groups WHERE id = p_group_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'group_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public._mcp_assert_writer(v_ws);

  DELETE FROM public.groups WHERE id = p_group_id;

  RETURN jsonb_build_object('group_id', p_group_id, 'deleted', true);
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_delete_group(uuid) TO authenticated;

-- ─── mcp_create_soft_group ──────────────────────────────────
-- Wird vom BulkAddModal aufgerufen wenn der User KEINEN expliziten
-- "Als Gruppe speichern"-Klick gemacht hat. Vorschlag-Speicher fuer
-- naechste Bulk-Aktion mit aehnlichem Kontext (source_node_id).
CREATE OR REPLACE FUNCTION public.mcp_create_soft_group(
  p_workspace_id  uuid,
  p_name          text,
  p_source_node_id uuid,
  p_object_ids    uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_name     text;
  v_sg_id    uuid;
  v_invalid  int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM public._mcp_assert_writer(p_workspace_id);
  v_name := public._mcp_validate_label(p_name);

  -- Cross-Workspace-Check fuer Objects.
  IF p_object_ids IS NOT NULL AND array_length(p_object_ids, 1) > 0 THEN
    SELECT count(*) INTO v_invalid
      FROM unnest(p_object_ids) AS oid
     WHERE NOT EXISTS (
       SELECT 1 FROM public.objects o
        WHERE o.id = oid AND o.workspace_id = p_workspace_id
     );
    IF v_invalid > 0 THEN
      RAISE EXCEPTION 'cross_workspace_object' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- source_node_id muss falls gesetzt im Workspace liegen.
  IF p_source_node_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.nodes
       WHERE id = p_source_node_id AND workspace_id = p_workspace_id
    ) THEN
      RAISE EXCEPTION 'cross_workspace_node' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO public.soft_groups (workspace_id, name, source_node_id, created_by)
  VALUES (p_workspace_id, v_name, p_source_node_id, v_actor)
  RETURNING id INTO v_sg_id;

  IF p_object_ids IS NOT NULL AND array_length(p_object_ids, 1) > 0 THEN
    INSERT INTO public.soft_group_members (soft_group_id, object_id, workspace_id)
    SELECT v_sg_id, oid, p_workspace_id
      FROM unnest(p_object_ids) AS oid
      ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'soft_group_id', v_sg_id,
    'workspace_id',  p_workspace_id,
    'name',          v_name,
    'count',         coalesce(array_length(p_object_ids, 1), 0)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_create_soft_group(uuid, text, uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.mcp_create_soft_group IS
  'Phase 3 O.3 — ephemere Soft-Gruppe aus Bulk-Auswahl. Ohne expliziten "Als Gruppe speichern"-Klick. TTL via last_used_at + Cleanup-Job in O.7.';

-- ─── mcp_promote_soft_group ─────────────────────────────────
-- Soft-Gruppe zu echter groups-Entry erheben. Members werden kopiert,
-- soft_groups.promoted_to wird gesetzt — Soft-Gruppe bleibt zum
-- Audit-Trail erhalten.
CREATE OR REPLACE FUNCTION public.mcp_promote_soft_group(
  p_soft_group_id uuid,
  p_group_name    text,
  p_description   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_ws       uuid;
  v_existing uuid;
  v_name     text;
  v_group_id uuid;
  v_added    int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT workspace_id, promoted_to INTO v_ws, v_existing
    FROM public.soft_groups WHERE id = p_soft_group_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'soft_group_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM public._mcp_assert_writer(v_ws);

  IF v_existing IS NOT NULL THEN
    -- bereits promoted → idempotent zurueckgeben.
    RETURN jsonb_build_object(
      'group_id',      v_existing,
      'soft_group_id', p_soft_group_id,
      'already_promoted', true
    );
  END IF;

  v_name := public._mcp_validate_label(p_group_name);

  INSERT INTO public.groups (workspace_id, name, description, created_by)
  VALUES (v_ws, v_name, NULLIF(trim(coalesce(p_description, '')), ''), v_actor)
  RETURNING id INTO v_group_id;

  WITH ins AS (
    INSERT INTO public.group_members (group_id, object_id, workspace_id)
    SELECT v_group_id, sgm.object_id, v_ws
      FROM public.soft_group_members sgm
     WHERE sgm.soft_group_id = p_soft_group_id
      ON CONFLICT (group_id, object_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_added FROM ins;

  UPDATE public.soft_groups
     SET promoted_to = v_group_id,
         last_used_at = now()
   WHERE id = p_soft_group_id;

  RETURN jsonb_build_object(
    'group_id',      v_group_id,
    'soft_group_id', p_soft_group_id,
    'name',          v_name,
    'added',         v_added
  );
END $$;

GRANT EXECUTE ON FUNCTION public.mcp_promote_soft_group(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.mcp_promote_soft_group IS
  'Phase 3 O.3 — Soft-Gruppe zu echter Group erheben. Idempotent: schon promoted → bestehende group_id zurueck. Soft-Gruppe bleibt fuer Audit-Trail.';

-- ─── Smoke (manuell nach Apply) ─────────────────────────────
-- 1. SELECT mcp_create_group('<ws>', 'Kunden', 'B2B-Liste');
-- 2. SELECT mcp_add_group_members('<group-id>', ARRAY['<obj-1>','<obj-2>']::uuid[]);
-- 3. SELECT mcp_create_soft_group('<ws>', 'Hunderassen-Auswahl', '<node-id>', ARRAY['<obj-1>']::uuid[]);
-- 4. SELECT mcp_promote_soft_group('<sg-id>', 'Hunderassen-V1');
-- 5. SELECT mcp_remove_group_members('<group-id>', ARRAY['<obj-1>']::uuid[]);
-- 6. SELECT mcp_delete_group('<group-id>');  -- Kaskade auf group_members.
