-- ═══════════════════════════════════════════════════════════════
-- Welle D.2 — Atom-Pin + Tag-System RPCs
--
-- ❗ APPLY-HINWEIS: braucht supabase_admin-Rechte (Functions in
--    public-Schema). Apply via:
--      docker exec -i matrix-supabase-db psql -U supabase_admin \
--        -d postgres -v ON_ERROR_STOP=1 < 064_atom_pins_and_tags_rpcs.sql
--
-- Alle RPCs SECURITY DEFINER mit is_workspace_member-Check fuer SELECT
-- bzw. can_write_workspace fuer INSERT/UPDATE/DELETE. RLS bleibt als
-- zweite Verteidigungslinie aktiv.
--
-- 11 RPCs:
--   create_atom_pin, delete_atom_pin, move_atom_pin,
--   pin_doc_with_create,
--   register_workspace_tag,
--   add_atom_tag_freetext, add_atom_tag_alias, add_atom_tag_atomref,
--   add_atom_tag_objectref,
--   remove_atom_tag, gc_workspace_tags
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- Helper: parent_id-Existenz pruefen je nach parent_kind.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._verify_atom_pin_parent(
  p_workspace_id uuid,
  p_parent_kind  public.atom_parent_kind,
  p_parent_id    uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF p_parent_kind = 'cell' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.cells
       WHERE id = p_parent_id AND workspace_id = p_workspace_id
    ) INTO v_exists;
  ELSIF p_parent_kind = 'node' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.nodes
       WHERE id = p_parent_id AND workspace_id = p_workspace_id
    ) INTO v_exists;
  ELSIF p_parent_kind = 'atom' THEN
    -- Polymorpher Parent: in einer der 5 Atom-Source-Tabellen.
    SELECT EXISTS (
      SELECT 1 FROM public.tasks WHERE id = p_parent_id AND workspace_id = p_workspace_id
      UNION ALL
      SELECT 1 FROM public.links WHERE id = p_parent_id AND workspace_id = p_workspace_id
      UNION ALL
      SELECT 1 FROM public.docs WHERE id = p_parent_id AND workspace_id = p_workspace_id
      UNION ALL
      SELECT 1 FROM public.checklists WHERE id = p_parent_id AND workspace_id = p_workspace_id
      UNION ALL
      SELECT 1 FROM public.external_events WHERE id = p_parent_id AND workspace_id = p_workspace_id
    ) INTO v_exists;
  ELSIF p_parent_kind = 'manifestation' THEN
    -- V2-deferred. Vorerst NICHT erlauben.
    RAISE EXCEPTION 'parent_kind_manifestation_not_yet_supported'
      USING ERRCODE = 'feature_not_supported';
  ELSE
    RAISE EXCEPTION 'unknown_parent_kind' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'parent_not_found' USING ERRCODE = 'no_data_found';
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- Helper: atom_id-Existenz pruefen je nach atom_type.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._verify_atom_exists(
  p_workspace_id uuid,
  p_atom_type    public.atom_type,
  p_atom_id      uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF p_atom_type = 'task' THEN
    SELECT EXISTS (SELECT 1 FROM public.tasks WHERE id = p_atom_id AND workspace_id = p_workspace_id) INTO v_exists;
  ELSIF p_atom_type = 'link' THEN
    SELECT EXISTS (SELECT 1 FROM public.links WHERE id = p_atom_id AND workspace_id = p_workspace_id) INTO v_exists;
  ELSIF p_atom_type = 'doc' THEN
    SELECT EXISTS (SELECT 1 FROM public.docs WHERE id = p_atom_id AND workspace_id = p_workspace_id) INTO v_exists;
  ELSIF p_atom_type = 'checklist' THEN
    SELECT EXISTS (SELECT 1 FROM public.checklists WHERE id = p_atom_id AND workspace_id = p_workspace_id) INTO v_exists;
  ELSIF p_atom_type = 'imported_event' THEN
    SELECT EXISTS (SELECT 1 FROM public.external_events WHERE id = p_atom_id AND workspace_id = p_workspace_id) INTO v_exists;
  ELSE
    RAISE EXCEPTION 'unknown_atom_type' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'atom_not_found' USING ERRCODE = 'no_data_found';
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────
-- 1) create_atom_pin
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_atom_pin(
  p_workspace_id uuid,
  p_atom_type    public.atom_type,
  p_atom_id      uuid,
  p_parent_kind  public.atom_parent_kind,
  p_parent_id    uuid,
  p_position     numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id    uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.can_write_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM public._verify_atom_exists(p_workspace_id, p_atom_type, p_atom_id);
  PERFORM public._verify_atom_pin_parent(p_workspace_id, p_parent_kind, p_parent_id);

  INSERT INTO public.atom_pins (
    atom_type, atom_id, workspace_id, parent_kind, parent_id, position
  ) VALUES (
    p_atom_type, p_atom_id, p_workspace_id, p_parent_kind, p_parent_id, p_position
  )
  ON CONFLICT (atom_type, atom_id, parent_kind, parent_id) DO UPDATE
    SET position = EXCLUDED.position
  RETURNING id INTO v_id;

  RETURN (
    SELECT jsonb_build_object(
      'id', id,
      'atom_type', atom_type,
      'atom_id', atom_id,
      'workspace_id', workspace_id,
      'parent_kind', parent_kind,
      'parent_id', parent_id,
      'position', position,
      'created_at', created_at
    )
    FROM public.atom_pins WHERE id = v_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.create_atom_pin(uuid, public.atom_type, uuid, public.atom_parent_kind, uuid, numeric) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 2) delete_atom_pin
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_atom_pin(p_id uuid)
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
  SELECT workspace_id INTO v_ws FROM public.atom_pins WHERE id = p_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'pin_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_write_workspace(v_ws) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM public.atom_pins WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id, 'deleted', true);
END $$;

GRANT EXECUTE ON FUNCTION public.delete_atom_pin(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 3) move_atom_pin — Parent-Wechsel (z.B. Doc von Cell A nach Cell B).
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.move_atom_pin(
  p_id              uuid,
  p_new_parent_kind public.atom_parent_kind,
  p_new_parent_id   uuid,
  p_new_position    numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_pin   public.atom_pins%ROWTYPE;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_pin FROM public.atom_pins WHERE id = p_id;
  IF v_pin.id IS NULL THEN
    RAISE EXCEPTION 'pin_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_write_workspace(v_pin.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM public._verify_atom_pin_parent(v_pin.workspace_id, p_new_parent_kind, p_new_parent_id);

  UPDATE public.atom_pins
     SET parent_kind = p_new_parent_kind,
         parent_id   = p_new_parent_id,
         position    = p_new_position
   WHERE id = p_id;

  RETURN (
    SELECT jsonb_build_object(
      'id', id,
      'atom_type', atom_type,
      'atom_id', atom_id,
      'workspace_id', workspace_id,
      'parent_kind', parent_kind,
      'parent_id', parent_id,
      'position', position,
      'created_at', created_at
    )
    FROM public.atom_pins WHERE id = p_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.move_atom_pin(uuid, public.atom_parent_kind, uuid, numeric) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 4) pin_doc_with_create — Atomic Doc + Pin in einer Transaktion.
-- Frontend ruft das fuer den Pending-Tab-Branch im DocsPopup.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pin_doc_with_create(
  p_workspace_id uuid,
  p_title        text,
  p_content      text DEFAULT '<p></p>',
  p_alias        text DEFAULT NULL,
  p_source_alias text DEFAULT NULL,
  p_parent_kind  public.atom_parent_kind DEFAULT NULL,
  p_parent_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor  uuid := auth.uid();
  v_doc_id uuid;
  v_pin_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.can_write_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Pin-Param-Konsistenz: parent_kind + parent_id muessen beide gesetzt
  -- sein oder beide NULL (= Standalone-Doku ohne Pin).
  IF (p_parent_kind IS NULL) <> (p_parent_id IS NULL) THEN
    RAISE EXCEPTION 'pin_args_inconsistent'
      USING ERRCODE = 'check_violation',
            DETAIL  = 'parent_kind und parent_id muessen gemeinsam gesetzt sein';
  END IF;

  IF p_parent_kind IS NOT NULL THEN
    PERFORM public._verify_atom_pin_parent(p_workspace_id, p_parent_kind, p_parent_id);
  END IF;

  INSERT INTO public.docs (workspace_id, title, content, alias, source_alias)
  VALUES (p_workspace_id, p_title, COALESCE(p_content, '<p></p>'), p_alias, p_source_alias)
  RETURNING id INTO v_doc_id;

  IF p_parent_kind IS NOT NULL THEN
    INSERT INTO public.atom_pins (
      atom_type, atom_id, workspace_id, parent_kind, parent_id, position
    ) VALUES (
      'doc', v_doc_id, p_workspace_id, p_parent_kind, p_parent_id, 0
    )
    RETURNING id INTO v_pin_id;
  END IF;

  RETURN jsonb_build_object(
    'doc', (SELECT row_to_json(d.*) FROM public.docs d WHERE d.id = v_doc_id),
    'pin', CASE
             WHEN v_pin_id IS NULL THEN NULL
             ELSE (SELECT row_to_json(p.*) FROM public.atom_pins p WHERE p.id = v_pin_id)
           END
  );
END $$;

GRANT EXECUTE ON FUNCTION public.pin_doc_with_create(uuid, text, text, text, text, public.atom_parent_kind, uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 5) register_workspace_tag — idempotente Tag-Registry-Erfassung.
-- Wird von add_atom_tag_*-RPCs intern genutzt, aber auch direkt
-- aufrufbar fuer Pre-Register-Use-Cases (z.B. Bulk-Import).
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_workspace_tag(
  p_workspace_id  uuid,
  p_kind          text,
  p_value         text,
  p_display_label text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_id    uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.can_write_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_kind NOT IN ('freetext','atom_ref','object_ref','alias_ref') THEN
    RAISE EXCEPTION 'invalid_tag_kind' USING ERRCODE = 'check_violation';
  END IF;
  IF p_value IS NULL OR length(trim(p_value)) = 0 THEN
    RAISE EXCEPTION 'value_required' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.workspace_tags (workspace_id, kind, value, display_label)
  VALUES (p_workspace_id, p_kind, p_value, p_display_label)
  ON CONFLICT (workspace_id, kind, value) DO UPDATE
    SET display_label = COALESCE(EXCLUDED.display_label, public.workspace_tags.display_label)
  RETURNING id INTO v_id;

  RETURN (
    SELECT jsonb_build_object(
      'id', id,
      'workspace_id', workspace_id,
      'kind', kind,
      'value', value,
      'display_label', display_label,
      'usage_count', usage_count,
      'created_at', created_at
    )
    FROM public.workspace_tags WHERE id = v_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.register_workspace_tag(uuid, text, text, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- Helper: tag_id finden oder anlegen (bundled register+lookup).
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._upsert_workspace_tag(
  p_workspace_id  uuid,
  p_kind          text,
  p_value         text,
  p_display_label text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.workspace_tags (workspace_id, kind, value, display_label)
  VALUES (p_workspace_id, p_kind, p_value, p_display_label)
  ON CONFLICT (workspace_id, kind, value) DO UPDATE
    SET display_label = COALESCE(EXCLUDED.display_label, public.workspace_tags.display_label)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- ───────────────────────────────────────────────────────────────
-- 6) add_atom_tag_freetext — Tippe `#design` → atom_tags + workspace_tags.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_atom_tag_freetext(
  p_workspace_id uuid,
  p_atom_type    public.atom_type,
  p_atom_id      uuid,
  p_value        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_canon   text;
  v_tag_id  uuid;
  v_link_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.can_write_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public._verify_atom_exists(p_workspace_id, p_atom_type, p_atom_id);

  v_canon := lower(trim(p_value));
  IF v_canon IS NULL OR length(v_canon) = 0 THEN
    RAISE EXCEPTION 'value_required' USING ERRCODE = 'check_violation';
  END IF;

  v_tag_id := public._upsert_workspace_tag(p_workspace_id, 'freetext', v_canon, NULL);

  INSERT INTO public.atom_tags (atom_type, atom_id, workspace_id, tag_id)
  VALUES (p_atom_type, p_atom_id, p_workspace_id, v_tag_id)
  ON CONFLICT (atom_type, atom_id, tag_id) DO UPDATE
    SET position = public.atom_tags.position
  RETURNING id INTO v_link_id;

  RETURN (
    SELECT jsonb_build_object(
      'id', t.id,
      'atom_type', t.atom_type,
      'atom_id', t.atom_id,
      'workspace_id', t.workspace_id,
      'tag_id', t.tag_id,
      'tag_kind', wt.kind,
      'tag_value', wt.value,
      'tag_display_label', wt.display_label,
      'created_at', t.created_at
    )
    FROM public.atom_tags t
    JOIN public.workspace_tags wt ON wt.id = t.tag_id
    WHERE t.id = v_link_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.add_atom_tag_freetext(uuid, public.atom_type, uuid, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 7) add_atom_tag_alias — User tippt `^kuerzel`. Resolved gegen
-- nodes.alias / cells.alias / docs.alias / kb_cards.alias /
-- checklists.alias / links.alias (analog OWNER_TO_TABLE in
-- lib/alias.ts). value = canonical alias-string, display_label =
-- `^alias` Snapshot.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_atom_tag_alias(
  p_workspace_id uuid,
  p_atom_type    public.atom_type,
  p_atom_id      uuid,
  p_alias        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_canon    text;
  v_resolved boolean;
  v_tag_id   uuid;
  v_link_id  uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.can_write_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public._verify_atom_exists(p_workspace_id, p_atom_type, p_atom_id);

  v_canon := lower(trim(p_alias));
  IF v_canon IS NULL OR length(v_canon) = 0 THEN
    RAISE EXCEPTION 'alias_required' USING ERRCODE = 'check_violation';
  END IF;
  -- `^`-Prefix tolerieren falls vom Frontend mitgegeben.
  IF substring(v_canon FROM 1 FOR 1) = '^' THEN
    v_canon := substring(v_canon FROM 2);
  END IF;

  -- Existenz-Probe ueber alle Alias-tragenden Tabellen (cells, checklists,
  -- docs, links, nodes, objects). Cross-Type-Konflikt-Check macht das
  -- Frontend bzw. der ALIAS-Index — wir akzeptieren jeden alias der
  -- irgendwo im Workspace vergeben ist.
  SELECT EXISTS (
    SELECT 1 FROM public.nodes WHERE workspace_id = p_workspace_id AND lower(alias) = v_canon
    UNION ALL SELECT 1 FROM public.cells WHERE workspace_id = p_workspace_id AND lower(alias) = v_canon
    UNION ALL SELECT 1 FROM public.docs WHERE workspace_id = p_workspace_id AND lower(alias) = v_canon
    UNION ALL SELECT 1 FROM public.checklists WHERE workspace_id = p_workspace_id AND lower(alias) = v_canon
    UNION ALL SELECT 1 FROM public.links WHERE workspace_id = p_workspace_id AND lower(alias) = v_canon
    UNION ALL SELECT 1 FROM public.objects WHERE workspace_id = p_workspace_id AND lower(alias) = v_canon
  ) INTO v_resolved;
  IF NOT v_resolved THEN
    RAISE EXCEPTION 'alias_not_found' USING ERRCODE = 'no_data_found',
      DETAIL = 'Alias ^' || v_canon || ' existiert nicht im Workspace.';
  END IF;

  v_tag_id := public._upsert_workspace_tag(
    p_workspace_id, 'alias_ref', v_canon, '^' || v_canon
  );

  INSERT INTO public.atom_tags (atom_type, atom_id, workspace_id, tag_id)
  VALUES (p_atom_type, p_atom_id, p_workspace_id, v_tag_id)
  ON CONFLICT (atom_type, atom_id, tag_id) DO UPDATE
    SET position = public.atom_tags.position
  RETURNING id INTO v_link_id;

  RETURN (
    SELECT jsonb_build_object(
      'id', t.id,
      'atom_type', t.atom_type,
      'atom_id', t.atom_id,
      'workspace_id', t.workspace_id,
      'tag_id', t.tag_id,
      'tag_kind', wt.kind,
      'tag_value', wt.value,
      'tag_display_label', wt.display_label,
      'created_at', t.created_at
    )
    FROM public.atom_tags t
    JOIN public.workspace_tags wt ON wt.id = t.tag_id
    WHERE t.id = v_link_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.add_atom_tag_alias(uuid, public.atom_type, uuid, text) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 8) add_atom_tag_atomref — Tag verweist auf konkretes Atom.
-- value = target atom_id::text, display_label = title-Snapshot.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_atom_tag_atomref(
  p_workspace_id     uuid,
  p_atom_type        public.atom_type,
  p_atom_id          uuid,
  p_target_atom_type public.atom_type,
  p_target_atom_id   uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_label    text;
  v_tag_id   uuid;
  v_link_id  uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.can_write_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  PERFORM public._verify_atom_exists(p_workspace_id, p_atom_type, p_atom_id);
  PERFORM public._verify_atom_exists(p_workspace_id, p_target_atom_type, p_target_atom_id);

  -- Display-Label-Snapshot ziehen je nach atom_type.
  IF p_target_atom_type = 'task' THEN
    SELECT label INTO v_label FROM public.tasks WHERE id = p_target_atom_id;
  ELSIF p_target_atom_type = 'link' THEN
    SELECT label INTO v_label FROM public.links WHERE id = p_target_atom_id;
  ELSIF p_target_atom_type = 'doc' THEN
    SELECT title INTO v_label FROM public.docs WHERE id = p_target_atom_id;
  ELSIF p_target_atom_type = 'checklist' THEN
    SELECT label INTO v_label FROM public.checklists WHERE id = p_target_atom_id;
  ELSIF p_target_atom_type = 'imported_event' THEN
    SELECT summary INTO v_label FROM public.external_events WHERE id = p_target_atom_id;
  END IF;
  v_label := COALESCE(NULLIF(trim(v_label), ''), '(unbenannt)');

  v_tag_id := public._upsert_workspace_tag(
    p_workspace_id, 'atom_ref', p_target_atom_id::text, v_label
  );

  INSERT INTO public.atom_tags (atom_type, atom_id, workspace_id, tag_id)
  VALUES (p_atom_type, p_atom_id, p_workspace_id, v_tag_id)
  ON CONFLICT (atom_type, atom_id, tag_id) DO UPDATE
    SET position = public.atom_tags.position
  RETURNING id INTO v_link_id;

  RETURN (
    SELECT jsonb_build_object(
      'id', t.id,
      'atom_type', t.atom_type,
      'atom_id', t.atom_id,
      'workspace_id', t.workspace_id,
      'tag_id', t.tag_id,
      'tag_kind', wt.kind,
      'tag_value', wt.value,
      'tag_display_label', wt.display_label,
      'target_atom_type', p_target_atom_type,
      'created_at', t.created_at
    )
    FROM public.atom_tags t
    JOIN public.workspace_tags wt ON wt.id = t.tag_id
    WHERE t.id = v_link_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.add_atom_tag_atomref(uuid, public.atom_type, uuid, public.atom_type, uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 9) add_atom_tag_objectref — Tag verweist auf Cell/Matrix/Node.
-- object_kind: 'cell' | 'node'. (Cells und Nodes sind die Object-
-- Typen die heute Aliases tragen koennen.)
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_atom_tag_objectref(
  p_workspace_id uuid,
  p_atom_type    public.atom_type,
  p_atom_id      uuid,
  p_object_kind  text,
  p_object_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_label   text;
  v_tag_id  uuid;
  v_link_id uuid;
  v_value   text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.can_write_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_object_kind NOT IN ('cell','node') THEN
    RAISE EXCEPTION 'invalid_object_kind' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public._verify_atom_exists(p_workspace_id, p_atom_type, p_atom_id);

  IF p_object_kind = 'cell' THEN
    SELECT COALESCE(NULLIF(trim(alias), ''), 'Zelle') INTO v_label
      FROM public.cells WHERE id = p_object_id AND workspace_id = p_workspace_id;
  ELSIF p_object_kind = 'node' THEN
    SELECT COALESCE(NULLIF(trim(alias), ''), NULLIF(trim(label), ''), 'Node') INTO v_label
      FROM public.nodes WHERE id = p_object_id AND workspace_id = p_workspace_id;
  END IF;
  IF v_label IS NULL THEN
    RAISE EXCEPTION 'object_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  -- value-Diskriminator: prefix damit cell-id und node-id eindeutig
  -- in derselben workspace_tags(value) sind (UNIQUE(ws,kind,value)).
  v_value := p_object_kind || ':' || p_object_id::text;

  v_tag_id := public._upsert_workspace_tag(
    p_workspace_id, 'object_ref', v_value, v_label
  );

  INSERT INTO public.atom_tags (atom_type, atom_id, workspace_id, tag_id)
  VALUES (p_atom_type, p_atom_id, p_workspace_id, v_tag_id)
  ON CONFLICT (atom_type, atom_id, tag_id) DO UPDATE
    SET position = public.atom_tags.position
  RETURNING id INTO v_link_id;

  RETURN (
    SELECT jsonb_build_object(
      'id', t.id,
      'atom_type', t.atom_type,
      'atom_id', t.atom_id,
      'workspace_id', t.workspace_id,
      'tag_id', t.tag_id,
      'tag_kind', wt.kind,
      'tag_value', wt.value,
      'tag_display_label', wt.display_label,
      'object_kind', p_object_kind,
      'object_id', p_object_id,
      'created_at', t.created_at
    )
    FROM public.atom_tags t
    JOIN public.workspace_tags wt ON wt.id = t.tag_id
    WHERE t.id = v_link_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.add_atom_tag_objectref(uuid, public.atom_type, uuid, text, uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 10) remove_atom_tag — Junction-Row loeschen. usage_count wird via
-- Trigger automatisch dekrementiert.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.remove_atom_tag(p_id uuid)
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
  SELECT workspace_id INTO v_ws FROM public.atom_tags WHERE id = p_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'tag_link_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.can_write_workspace(v_ws) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM public.atom_tags WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id, 'deleted', true);
END $$;

GRANT EXECUTE ON FUNCTION public.remove_atom_tag(uuid) TO authenticated;

-- ───────────────────────────────────────────────────────────────
-- 11) gc_workspace_tags — manueller Sweep. Loescht Registry-Tags
-- mit usage_count = 0. Idempotent. Returnt count der geloeschten.
-- ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gc_workspace_tags(p_workspace_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.can_write_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  WITH del AS (
    DELETE FROM public.workspace_tags
     WHERE workspace_id = p_workspace_id AND usage_count <= 0
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM del;
  RETURN v_count;
END $$;

GRANT EXECUTE ON FUNCTION public.gc_workspace_tags(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- Smoke (manuell, als authenticated):
--
-- 1. Doc + Pin:
--    SELECT pin_doc_with_create('<WS>', 'Test', '<p>hi</p>', NULL, NULL,
--                               'cell', '<CELL>');
-- 2. Freetext-Tag:
--    SELECT add_atom_tag_freetext('<WS>', 'doc', '<DOC>', 'design');
-- 3. workspace_tags.usage_count:
--    SELECT * FROM workspace_tags WHERE workspace_id='<WS>';
--    -- usage_count=1 nach Insert.
-- 4. Remove + GC:
--    SELECT remove_atom_tag('<JUNCTION_ID>');
--    SELECT * FROM workspace_tags ...;  -- usage_count=0
--    SELECT gc_workspace_tags('<WS>');  -- 1
-- ═══════════════════════════════════════════════════════════════
