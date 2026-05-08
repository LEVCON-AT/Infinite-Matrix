-- ═══════════════════════════════════════════════════════════════
-- WV.WV.1 — atom_pins → atom_manifestations(kind='pinned')
--
-- ❗ APPLY-HINWEIS: Diese Migration braucht supabase_admin-Rechte
--    (DROP CONSTRAINT auf atom_manifestations, ALTER TYPE
--    atom_manifestation_kind, DROP TABLE atom_pins, CREATE OR REPLACE
--    auf supabase_admin-owned Funktionen aus Migration 064). Der
--    `postgres`-User reicht NICHT. User muss interaktiv applien:
--      docker exec -it matrix-supabase-db psql -U supabase_admin \
--        -d postgres -v ON_ERROR_STOP=1 \
--        -f 066_consolidate_atom_pins_into_manifestations.sql
--
-- Konsolidierung der Welle-D-`atom_pins`-Tabelle in das polymorphe
-- atom_manifestations-Modell. atom_pins war strukturell redundant —
-- beide sind polymorphe Atom→Container-Junctions, nur mit
-- unterschiedlichen Container-Domains.
--
-- Konzept-Referenz: docs/concepts/widget-vorlagen-foundation.md §9.A.
--
-- Konsolidierungs-Modell:
--   atom_manifestations.kind += 'pinned'
--   atom_manifestations.container_kind text NULL
--     - 'cell' | 'atom' | 'node' bei kind='pinned'
--     - NULL bei kind ∈ ('kanban','checklist','calendar','standalone')
--       (heutige Semantik bleibt: kanban/checklist haben container_id
--       implizit aus kind ableitbar; calendar/standalone NULL)
--
-- Schema-Heptad:
--   - Schema:       diese Migration (Tabelle + Trigger + RPC + Realtime).
--   - Types:        lib/types.ts — AtomManifestationRow.container_kind,
--                   AtomKind unverändert. AtomPin/AtomParentKind entfernt.
--                   (Nachgezogen in WV.WV.1b.)
--   - Mutations:    lib/atom-manifestations.ts — Pin-Methoden ergaenzt.
--                   lib/atom-pins.ts entfaellt. (WV.WV.1c.)
--   - Offline:      offline-cache.ts — atom_pins aus TABLES, DB_VERSION-
--                   Bump. (WV.WV.1d.)
--   - Realtime:     realtime.ts — atom_pins aus DIRECT_TABLES,
--                   atom_manifestations bleibt subscribed. (WV.WV.1e.)
--   - Export:       export.ts + subtree-import.ts — atom_pins-Block
--                   entfaellt, atom_manifestations(kind='pinned') deckt
--                   ab. (WV.WV.1f.)
--   - MCP:          packages/bridge/src/tools/atom-pin.ts — Tool-Namen
--                   bleiben (atom_pin.create/delete/move/list, doc.pin),
--                   nur RPC-Body in dieser Migration umgestellt.
--   - Channel-Bridge: n/a (strukturelle Verankerung, kein User-Inhalt).
--
-- Apply-Strategie:
--   Stage 1: ALTER TYPE atom_manifestation_kind ADD VALUE 'pinned'.
--   Stage 2: Schema-Aenderungen + Backfill + Trigger + RPC + Drop.
--
-- Clean-Cut-Annahme (Memory feedback_clean_cut_no_prod_data.md):
--   ~2 Pins auf Staging, keine Production-Daten. Backfill in derselben
--   Migration, atom_pins gedroppt am Ende. Kein Dual-Write-Window.
-- ═══════════════════════════════════════════════════════════════

-- ─── STAGE 1: Enum-Extend ──────────────────────────────────────
BEGIN;

ALTER TYPE public.atom_manifestation_kind ADD VALUE IF NOT EXISTS 'pinned';

COMMIT;

-- ─── STAGE 2: Schema + Backfill + Trigger + RPC + Drop ─────────
BEGIN;

-- ─── 1. container_kind-Spalte ──────────────────────────────────
ALTER TABLE public.atom_manifestations
  ADD COLUMN IF NOT EXISTS container_kind text NULL;

COMMENT ON COLUMN public.atom_manifestations.container_kind IS
  'WV.WV.1 — Diskriminator fuer kind=''pinned'': cell | atom | node. NULL bei kanban/checklist (implizit aus kind ableitbar) und calendar/standalone (kein Container).';

-- ─── 2. CHECK-Constraint atom_manifestations_container_check ───
-- Bisher: kanban/checklist Pflicht container_id, calendar/standalone NULL.
-- Neu: zusaetzlicher Branch fuer kind='pinned'.
ALTER TABLE public.atom_manifestations
  DROP CONSTRAINT IF EXISTS atom_manifestations_container_check;

ALTER TABLE public.atom_manifestations
  ADD CONSTRAINT atom_manifestations_container_check
  CHECK (
    (kind IN ('kanban','checklist')
       AND container_id IS NOT NULL AND container_kind IS NULL)
    OR (kind IN ('calendar','standalone')
       AND container_id IS NULL AND container_kind IS NULL)
    OR (kind = 'pinned'
       AND container_id IS NOT NULL
       AND container_kind IN ('cell','atom','node'))
  );

-- ─── 3. Backfill atom_pins → atom_manifestations(kind='pinned') ─
-- ID re-use damit der Audit-Pfad nachvollziehbar bleibt. Wenn jemand
-- in der Zwischenzeit eine atom_manifestations-Row mit derselben ID
-- haette (Kollisions-Wahrscheinlichkeit ~0 bei gen_random_uuid),
-- droppen wir den ON-CONFLICT-Pin still — Smoke deckt das ab.
--
-- parent_kind='manifestation' ist V2-deferred (Migration 064:61-64
-- wirft 'feature_not_supported'). Solche Rows wuerden nicht existieren —
-- defensiv gefiltert.
INSERT INTO public.atom_manifestations (
  id, atom_type, atom_id, workspace_id, kind,
  container_id, container_kind, position, level, display_meta, created_at
)
SELECT
  ap.id,
  ap.atom_type,
  ap.atom_id,
  ap.workspace_id,
  'pinned'::public.atom_manifestation_kind,
  ap.parent_id,
  ap.parent_kind::text,
  ap.position,
  NULL,
  '{}'::jsonb,
  ap.created_at
FROM public.atom_pins ap
WHERE ap.parent_kind <> 'manifestation'
ON CONFLICT (id) DO NOTHING;

-- ─── 4. Partial UNIQUE Index fuer kind='pinned'-Doppel ─────────
-- Pendant zu atom_pins.atom_pins_unique (Migration 063:67-69).
-- Doppel-Pin desselben Atoms am selben Container verboten,
-- Multi-Pin (selbes Atom an mehreren Containers) erlaubt.
CREATE UNIQUE INDEX IF NOT EXISTS atom_manifestations_pinned_unique
  ON public.atom_manifestations (atom_type, atom_id, container_kind, container_id)
  WHERE kind = 'pinned';

-- ─── 5. Index fuer container_kind/container_id-Lookups ─────────
-- Reverse-Lookup "alle Pinned-Manifestations an Cell X / Node Y / Atom Z".
CREATE INDEX IF NOT EXISTS atom_manifestations_container_kind_idx
  ON public.atom_manifestations(container_kind, container_id)
  WHERE container_kind IS NOT NULL;

-- ─── 6. Cascade-Trigger erweitern (Source-Side Atoms) ──────────
-- Bisheriges Pattern (Migration 044:113-159, 059:161-176):
-- _atom_manif_purge_for_<atom> purgt nur die Atom-Side.
-- Neu: zusaetzlich Container-Side wenn container_kind='atom' auf das
-- geloeschte Atom verweist. Dadurch fallen Cascade-Trigger fuer
-- atom_pins (Migration 063:190-258) ersatzlos weg.

CREATE OR REPLACE FUNCTION public._atom_manif_purge_for_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Atom-Side: das geloeschte Task ist Owner einer Manifestation
  DELETE FROM public.atom_manifestations
   WHERE atom_type = 'task' AND atom_id = OLD.id;
  -- Container-Side: das geloeschte Task ist Pin-Container fuer fremdes Atom
  DELETE FROM public.atom_manifestations
   WHERE kind = 'pinned' AND container_kind = 'atom' AND container_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_manif_purge_for_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_manifestations
   WHERE atom_type = 'link' AND atom_id = OLD.id;
  DELETE FROM public.atom_manifestations
   WHERE kind = 'pinned' AND container_kind = 'atom' AND container_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_manif_purge_for_doc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_manifestations
   WHERE atom_type = 'doc' AND atom_id = OLD.id;
  DELETE FROM public.atom_manifestations
   WHERE kind = 'pinned' AND container_kind = 'atom' AND container_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_manif_purge_for_checklist()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_manifestations
   WHERE atom_type = 'checklist' AND atom_id = OLD.id;
  DELETE FROM public.atom_manifestations
   WHERE kind = 'pinned' AND container_kind = 'atom' AND container_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_manif_purge_for_imported_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_manifestations
   WHERE atom_type = 'imported_event' AND atom_id = OLD.id;
  DELETE FROM public.atom_manifestations
   WHERE kind = 'pinned' AND container_kind = 'atom' AND container_id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS atom_manif_purge_on_imported_event_delete ON public.external_events;
CREATE TRIGGER atom_manif_purge_on_imported_event_delete
  BEFORE DELETE ON public.external_events
  FOR EACH ROW EXECUTE FUNCTION public._atom_manif_purge_for_imported_event();

-- ─── 7. Cascade-Trigger Container-Side (Cell, Node) ────────────
-- Pendant zu atom_pins_purge_on_cell/node_delete (Migration 063:291-323).
-- Bei DELETE auf cells/nodes alle kind='pinned'-Manifestations purgen.

CREATE OR REPLACE FUNCTION public._atom_manif_purge_for_cell()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_manifestations
   WHERE kind = 'pinned' AND container_kind = 'cell' AND container_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public._atom_manif_purge_for_node()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.atom_manifestations
   WHERE kind = 'pinned' AND container_kind = 'node' AND container_id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS atom_manif_purge_on_cell_delete ON public.cells;
CREATE TRIGGER atom_manif_purge_on_cell_delete
  BEFORE DELETE ON public.cells
  FOR EACH ROW EXECUTE FUNCTION public._atom_manif_purge_for_cell();

DROP TRIGGER IF EXISTS atom_manif_purge_on_node_delete ON public.nodes;
CREATE TRIGGER atom_manif_purge_on_node_delete
  BEFORE DELETE ON public.nodes
  FOR EACH ROW EXECUTE FUNCTION public._atom_manif_purge_for_node();

-- ─── 8. RPCs umstellen — atom_pins → atom_manifestations ───────
-- Tool-Namen bleiben (atom_pin.create / delete / move + doc.pin),
-- damit Bridge-Tool-Schema (packages/bridge/src/tools/atom-pin.ts)
-- unveraendert bleibt. Nur RPC-Body schreibt in atom_manifestations.

-- 8.1 create_atom_pin
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
  v_actor          uuid := auth.uid();
  v_id             uuid;
  v_container_kind text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.can_write_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_parent_kind = 'manifestation' THEN
    RAISE EXCEPTION 'parent_kind_manifestation_not_yet_supported'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  PERFORM public._verify_atom_exists(p_workspace_id, p_atom_type, p_atom_id);
  PERFORM public._verify_atom_pin_parent(p_workspace_id, p_parent_kind, p_parent_id);

  v_container_kind := p_parent_kind::text;

  INSERT INTO public.atom_manifestations (
    atom_type, atom_id, workspace_id, kind,
    container_id, container_kind, position, level, display_meta
  ) VALUES (
    p_atom_type, p_atom_id, p_workspace_id, 'pinned',
    p_parent_id, v_container_kind, p_position, NULL, '{}'::jsonb
  )
  ON CONFLICT (atom_type, atom_id, container_kind, container_id)
    WHERE kind = 'pinned'
    DO UPDATE SET position = EXCLUDED.position
  RETURNING id INTO v_id;

  RETURN (
    SELECT jsonb_build_object(
      'id', id,
      'atom_type', atom_type,
      'atom_id', atom_id,
      'workspace_id', workspace_id,
      'parent_kind', container_kind,
      'parent_id', container_id,
      'position', position,
      'created_at', created_at
    )
    FROM public.atom_manifestations WHERE id = v_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.create_atom_pin(uuid, public.atom_type, uuid, public.atom_parent_kind, uuid, numeric) TO authenticated;

-- 8.2 delete_atom_pin
CREATE OR REPLACE FUNCTION public.delete_atom_pin(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_ws    uuid;
  v_kind  public.atom_manifestation_kind;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT workspace_id, kind INTO v_ws, v_kind
    FROM public.atom_manifestations WHERE id = p_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'pin_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_kind <> 'pinned' THEN
    RAISE EXCEPTION 'not_a_pin' USING ERRCODE = 'check_violation',
      DETAIL = 'atom_manifestation ist kind=' || v_kind::text || ', kein Pin.';
  END IF;
  IF NOT public.can_write_workspace(v_ws) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM public.atom_manifestations WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id, 'deleted', true);
END $$;

GRANT EXECUTE ON FUNCTION public.delete_atom_pin(uuid) TO authenticated;

-- 8.3 move_atom_pin
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
  v_actor          uuid := auth.uid();
  v_pin            public.atom_manifestations%ROWTYPE;
  v_container_kind text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO v_pin FROM public.atom_manifestations WHERE id = p_id;
  IF v_pin.id IS NULL THEN
    RAISE EXCEPTION 'pin_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_pin.kind <> 'pinned' THEN
    RAISE EXCEPTION 'not_a_pin' USING ERRCODE = 'check_violation',
      DETAIL = 'atom_manifestation ist kind=' || v_pin.kind::text || ', kein Pin.';
  END IF;
  IF NOT public.can_write_workspace(v_pin.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_new_parent_kind = 'manifestation' THEN
    RAISE EXCEPTION 'parent_kind_manifestation_not_yet_supported'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  PERFORM public._verify_atom_pin_parent(v_pin.workspace_id, p_new_parent_kind, p_new_parent_id);

  v_container_kind := p_new_parent_kind::text;

  UPDATE public.atom_manifestations
     SET container_kind = v_container_kind,
         container_id   = p_new_parent_id,
         position       = p_new_position
   WHERE id = p_id;

  RETURN (
    SELECT jsonb_build_object(
      'id', id,
      'atom_type', atom_type,
      'atom_id', atom_id,
      'workspace_id', workspace_id,
      'parent_kind', container_kind,
      'parent_id', container_id,
      'position', position,
      'created_at', created_at
    )
    FROM public.atom_manifestations WHERE id = p_id
  );
END $$;

GRANT EXECUTE ON FUNCTION public.move_atom_pin(uuid, public.atom_parent_kind, uuid, numeric) TO authenticated;

-- 8.4 pin_doc_with_create — Atomic Doc + Pinned-Manifestation
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
  v_actor          uuid := auth.uid();
  v_doc_id         uuid;
  v_pin_id         uuid;
  v_container_kind text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.can_write_workspace(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (p_parent_kind IS NULL) <> (p_parent_id IS NULL) THEN
    RAISE EXCEPTION 'pin_args_inconsistent'
      USING ERRCODE = 'check_violation',
            DETAIL  = 'parent_kind und parent_id muessen gemeinsam gesetzt sein';
  END IF;

  IF p_parent_kind = 'manifestation' THEN
    RAISE EXCEPTION 'parent_kind_manifestation_not_yet_supported'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  IF p_parent_kind IS NOT NULL THEN
    PERFORM public._verify_atom_pin_parent(p_workspace_id, p_parent_kind, p_parent_id);
  END IF;

  INSERT INTO public.docs (workspace_id, title, content, alias, source_alias)
  VALUES (p_workspace_id, p_title, COALESCE(p_content, '<p></p>'), p_alias, p_source_alias)
  RETURNING id INTO v_doc_id;

  IF p_parent_kind IS NOT NULL THEN
    v_container_kind := p_parent_kind::text;
    INSERT INTO public.atom_manifestations (
      atom_type, atom_id, workspace_id, kind,
      container_id, container_kind, position, level, display_meta
    ) VALUES (
      'doc', v_doc_id, p_workspace_id, 'pinned',
      p_parent_id, v_container_kind, 0, NULL, '{}'::jsonb
    )
    RETURNING id INTO v_pin_id;
  END IF;

  RETURN jsonb_build_object(
    'doc', (SELECT row_to_json(d.*) FROM public.docs d WHERE d.id = v_doc_id),
    'pin', CASE
             WHEN v_pin_id IS NULL THEN NULL
             ELSE (
               SELECT jsonb_build_object(
                 'id', m.id,
                 'atom_type', m.atom_type,
                 'atom_id', m.atom_id,
                 'workspace_id', m.workspace_id,
                 'parent_kind', m.container_kind,
                 'parent_id', m.container_id,
                 'position', m.position,
                 'created_at', m.created_at
               )
               FROM public.atom_manifestations m WHERE m.id = v_pin_id
             )
           END
  );
END $$;

GRANT EXECUTE ON FUNCTION public.pin_doc_with_create(uuid, text, text, text, text, public.atom_parent_kind, uuid) TO authenticated;

-- ─── 9. atom_pins-Cascade-Trigger droppen (Source + Parent) ────
DROP TRIGGER IF EXISTS atom_pins_purge_on_task_delete ON public.tasks;
DROP TRIGGER IF EXISTS atom_pins_purge_on_link_delete ON public.links;
DROP TRIGGER IF EXISTS atom_pins_purge_on_doc_delete ON public.docs;
DROP TRIGGER IF EXISTS atom_pins_purge_on_checklist_delete ON public.checklists;
DROP TRIGGER IF EXISTS atom_pins_purge_on_imported_event_delete ON public.external_events;
DROP TRIGGER IF EXISTS atom_pins_purge_on_cell_delete ON public.cells;
DROP TRIGGER IF EXISTS atom_pins_purge_on_node_delete ON public.nodes;

-- ─── 10. workspace_tags.usage_count-Trigger lebt unveraendert ──
-- atom_tags bleibt — kein Eingriff. Drift-Audit (WV.WV.3) prueft das.

-- ─── 11. atom_pins aus Realtime-Publication entfernen ──────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'atom_pins'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.atom_pins;
  END IF;
END $$;

-- ─── 12. atom_pins Tabelle droppen ─────────────────────────────
DROP TABLE IF EXISTS public.atom_pins;

-- ─── 13. atom_pins Source-Side-Funktionen droppen ──────────────
DROP FUNCTION IF EXISTS public._atom_pins_purge_for_task();
DROP FUNCTION IF EXISTS public._atom_pins_purge_for_link();
DROP FUNCTION IF EXISTS public._atom_pins_purge_for_doc();
DROP FUNCTION IF EXISTS public._atom_pins_purge_for_checklist();
DROP FUNCTION IF EXISTS public._atom_pins_purge_for_imported_event();
DROP FUNCTION IF EXISTS public._atom_pins_purge_for_cell();
DROP FUNCTION IF EXISTS public._atom_pins_purge_for_node();

-- ─── 14. atom_parent_kind ENUM bleibt erhalten ─────────────────
-- ENUM wird weiterhin von den RPCs als Parameter-Type benutzt
-- (create_atom_pin / move_atom_pin / pin_doc_with_create). DROP TYPE
-- nur wenn keine RPCs mehr davon abhaengen — V2-Aufgabe.

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- Smoke-Verifikation (manuell nach Apply, als supabase_admin):
--
-- 1. Backfill-Count match (vor Apply count, nach Apply count gleich):
--    SELECT count(*) FROM atom_manifestations WHERE kind='pinned';
--    -- == count(*) atom_pins WHERE parent_kind <> 'manifestation' (vor Apply)
--
-- 2. atom_pins-Tabelle weg:
--    SELECT to_regclass('public.atom_pins');  -- NULL erwartet
--
-- 3. ENUM atom_manifestation_kind hat 'pinned':
--    SELECT unnest(enum_range(NULL::public.atom_manifestation_kind));
--    -- erwartet: kanban / checklist / calendar / standalone / pinned
--
-- 4. CHECK-Constraint atom_manifestations_container_check enthaelt pinned:
--    SELECT pg_get_constraintdef(oid)
--      FROM pg_constraint
--     WHERE conname = 'atom_manifestations_container_check';
--
-- 5. Cascade-Trigger Container-Side wirken:
--    -- (testweise auf einer Test-Cell, Test-Node)
--    INSERT INTO atom_manifestations (atom_type, atom_id, workspace_id,
--      kind, container_id, container_kind)
--      VALUES ('doc', '$DOC', '$WS', 'pinned', '$CELL', 'cell');
--    DELETE FROM cells WHERE id = '$CELL';
--    SELECT count(*) FROM atom_manifestations
--      WHERE container_kind='cell' AND container_id='$CELL';
--    -- == 0 erwartet
--
-- 6. RPC-Roundtrip:
--    SELECT pin_doc_with_create('$WS', 'Test', '<p>hi</p>', NULL, NULL,
--                               'cell', '$CELL');
--    -- result.pin.parent_kind = 'cell', .parent_id = $CELL
--    SELECT delete_atom_pin('$PIN_ID');
--
-- 7. Realtime-Publication purged:
--    SELECT 1 FROM pg_publication_tables
--      WHERE pubname='supabase_realtime' AND tablename='atom_pins';
--    -- 0 rows erwartet
-- ═══════════════════════════════════════════════════════════════
