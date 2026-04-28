-- ═══════════════════════════════════════════════════════════════
-- Phase 3 Welle O.1 — Object-Layer Schema-Foundation
--
-- First-Class-Entities (Objects) als globale Identitaeten ueber
-- rows/cols/kb_cols/nodes. Cells und kb_cards bleiben Pfad-Enden
-- (User-Architektur-Regel 2026-04-29).
--
-- Migration ist KEIN UI-Aufwand: nur Schema + RLS + FK-Erweiterung.
-- O.2 bringt Auto-Object-Anlage + Suggestion-UI.
--
-- Re-Use:
--   - Pattern aus Migration 002 (RLS-DO-Block + can_write_workspace)
--   - is_workspace_member / can_write_workspace existieren
--   - workspace_role_of fuer feinere Rollen-Checks
--
-- Schema-Vier-Artefakte-Regel (siehe checklisten.md): Schema +
-- Mutations + MCP-Tool-Trio + Export/Import. Mutations + MCP +
-- Export folgen in O.2/O.3 — O.1 baut nur das Foundation-Schema.
-- ═══════════════════════════════════════════════════════════════

-- ─── Extensions ──────────────────────────────────────────────
-- pg_trgm fuer Trigram-Index auf objects.label (Autocomplete-
-- Suggestion in O.2). Idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Enum: Home-Ref-Kind ─────────────────────────────────────
-- Objekt-Home = wo das Object zuerst erschienen ist (rows.id /
-- cols.id / kb_cols.id / nodes.id / standalone).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'object_home_ref_kind') THEN
    CREATE TYPE public.object_home_ref_kind AS ENUM
      ('row', 'col', 'kb_col', 'node', 'standalone');
  END IF;
END $$;

-- ─── Tabelle: objects ────────────────────────────────────────
-- Globaler Identity-Speicher pro Workspace. Pfad-Enden (cells,
-- kb_cards, doku, checklists, items) bekommen KEINE object_id —
-- sie sind kontext-spezifisch.
CREATE TABLE IF NOT EXISTS public.objects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  label           text NOT NULL,
  alias           text,                                   -- ^o.<slug> Namespace, ohne Prefix gespeichert
  type_label      text,                                   -- frei: "Kunde", "Hunderasse"; null = ohne Type
  parent_id       uuid REFERENCES public.objects(id) ON DELETE SET NULL,
  attrs           jsonb NOT NULL DEFAULT '{}'::jsonb,
  home_ref_kind   public.object_home_ref_kind,
  home_ref_id     uuid,                                   -- erstes Vorkommen — kein FK weil polymorph
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS objects_ws_idx
  ON public.objects(workspace_id);
CREATE INDEX IF NOT EXISTS objects_parent_idx
  ON public.objects(workspace_id, parent_id);
CREATE INDEX IF NOT EXISTS objects_label_trgm_idx
  ON public.objects USING gin (label gin_trgm_ops);
-- Object-Alias workspace-eindeutig (cross-table-Eindeutigkeit gegenueber
-- cell/card/node/link wird in lib/alias-index.ts ueber Namespace ^o.
-- + Frontend-validateAlias() durchgesetzt — kommt mit O.2).
CREATE UNIQUE INDEX IF NOT EXISTS objects_alias_uq
  ON public.objects(workspace_id, lower(alias))
  WHERE alias IS NOT NULL;

COMMENT ON TABLE public.objects IS
  'Phase 3 O.1 — globale Identities (First-Class-Entities). Pro Workspace, optional typed, optional in Hierarchie via parent_id. Verwendet von rows/cols/kb_cols/nodes via object_id-FK.';
COMMENT ON COLUMN public.objects.alias IS
  'Slug ohne Prefix. UI rendert als ^o.<slug>. Workspace-eindeutig.';
COMMENT ON COLUMN public.objects.home_ref_kind IS
  'Erst-Vorkommen-Kind. Fuer Object-Detail-Page-Strukturpfad ("unter Cell X > Sub-Matrix Y > Row Z").';

-- updated_at-Trigger
DROP TRIGGER IF EXISTS objects_set_updated_at ON public.objects;
CREATE TRIGGER objects_set_updated_at
  BEFORE UPDATE ON public.objects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Tabelle: object_tags (M:N Cross-Cuts) ───────────────────
-- Ein Tag IST ein Object — Polizeihund (object) wird mit Polizei-Asset
-- (object) ge-tagged. Cross-Cut-Filter "alle Polizei-Assets".
CREATE TABLE IF NOT EXISTS public.object_tags (
  object_id     uuid NOT NULL REFERENCES public.objects(id) ON DELETE CASCADE,
  tag_object_id uuid NOT NULL REFERENCES public.objects(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL,                            -- denormalisiert fuer RLS
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (object_id, tag_object_id),
  CHECK (object_id <> tag_object_id)                      -- kein Self-Tag
);

CREATE INDEX IF NOT EXISTS object_tags_tag_idx
  ON public.object_tags(workspace_id, tag_object_id);

COMMENT ON TABLE public.object_tags IS
  'M:N — ein Object kann mit beliebigen anderen Objects ge-tagged werden. Tag IST ein Object (z.B. "B2B" oder "Polizei-Asset").';

-- ─── Tabelle: groups (explizite User-pflegbare Gruppen) ──────
-- Aus Soft-Gruppen promoted oder direkt vom User in der Gruppen-
-- Mgmt-Page angelegt. Globale Sammlung von Object-Refs.
CREATE TABLE IF NOT EXISTS public.groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS groups_ws_idx
  ON public.groups(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS groups_name_uq
  ON public.groups(workspace_id, lower(name));

COMMENT ON TABLE public.groups IS
  'Phase 3 O.1 — globale Object-Gruppen. Quelle fuer Group->Matrix-Generator. User-pflegbar via /w/:wsId/objects/groups.';

DROP TRIGGER IF EXISTS groups_set_updated_at ON public.groups;
CREATE TRIGGER groups_set_updated_at
  BEFORE UPDATE ON public.groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Tabelle: group_members (M:N) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.group_members (
  group_id      uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  object_id     uuid NOT NULL REFERENCES public.objects(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, object_id)
);

CREATE INDEX IF NOT EXISTS group_members_obj_idx
  ON public.group_members(workspace_id, object_id);

-- ─── Tabelle: soft_groups (ephemer, aus Bulk-Dialog) ─────────
-- Wenn User im Bulk-Dialog Multi-Select macht und nicht explizit
-- "Als Gruppe speichern" klickt, sammeln wir die Auswahl als
-- Soft-Gruppe. Bei naechster aehnlicher Aktion: Vorschlag.
-- TTL 60 Tage ohne Re-Use → auto-loeschen (Cleanup-Job in O.7).
CREATE TABLE IF NOT EXISTS public.soft_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,                         -- vorgeschlagen aus Source-Kontext
  source_node_id  uuid REFERENCES public.nodes(id) ON DELETE SET NULL,
  promoted_to     uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS soft_groups_ws_idx
  ON public.soft_groups(workspace_id, last_used_at DESC);

COMMENT ON COLUMN public.soft_groups.promoted_to IS
  'Wenn != NULL: User hat die Soft-Gruppe zu echter groups-Entry promoted. Soft-Group bleibt zum Audit-Trail erhalten.';

CREATE TABLE IF NOT EXISTS public.soft_group_members (
  soft_group_id uuid NOT NULL REFERENCES public.soft_groups(id) ON DELETE CASCADE,
  object_id     uuid NOT NULL REFERENCES public.objects(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL,
  PRIMARY KEY (soft_group_id, object_id)
);

CREATE INDEX IF NOT EXISTS soft_group_members_obj_idx
  ON public.soft_group_members(workspace_id, object_id);

-- ─── ALTER TABLE: object_id-FK in rows / cols / kb_cols / nodes ──
-- Cells und kb_cards bleiben object-frei (User-Regel: Pfad-Enden).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rows' AND column_name = 'object_id'
  ) THEN
    ALTER TABLE public.rows ADD COLUMN object_id uuid REFERENCES public.objects(id) ON DELETE SET NULL;
    CREATE INDEX rows_object_id_idx ON public.rows(workspace_id, object_id) WHERE object_id IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cols' AND column_name = 'object_id'
  ) THEN
    ALTER TABLE public.cols ADD COLUMN object_id uuid REFERENCES public.objects(id) ON DELETE SET NULL;
    CREATE INDEX cols_object_id_idx ON public.cols(workspace_id, object_id) WHERE object_id IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kb_cols' AND column_name = 'object_id'
  ) THEN
    ALTER TABLE public.kb_cols ADD COLUMN object_id uuid REFERENCES public.objects(id) ON DELETE SET NULL;
    CREATE INDEX kb_cols_object_id_idx ON public.kb_cols(workspace_id, object_id) WHERE object_id IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'nodes' AND column_name = 'object_id'
  ) THEN
    ALTER TABLE public.nodes ADD COLUMN object_id uuid REFERENCES public.objects(id) ON DELETE SET NULL;
    CREATE INDEX nodes_object_id_idx ON public.nodes(workspace_id, object_id) WHERE object_id IS NOT NULL;
  END IF;
END $$;

-- ─── RLS aktivieren ──────────────────────────────────────────
ALTER TABLE public.objects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.object_tags         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.soft_groups         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.soft_group_members  ENABLE ROW LEVEL SECURITY;

-- ─── RLS-Policies — uniformes Schema (Pattern aus Migration 002) ──
-- SELECT: jeder Workspace-Member.
-- Schreiben: owner/admin/editor (can_write_workspace).
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'objects','object_tags','groups','group_members','soft_groups','soft_group_members'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON public.%1$s', t);
    EXECUTE format(
      'CREATE POLICY %1$s_select ON public.%1$s
         FOR SELECT USING (public.is_workspace_member(workspace_id))',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS %1$s_write ON public.%1$s', t);
    EXECUTE format(
      'CREATE POLICY %1$s_write ON public.%1$s
         FOR ALL
         USING (public.can_write_workspace(workspace_id))
         WITH CHECK (public.can_write_workspace(workspace_id))',
      t
    );
  END LOOP;
END $$;

-- ─── Grants ──────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'objects','object_tags','groups','group_members','soft_groups','soft_group_members'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ─── Smoke-Verifikation (manuell nach Apply) ─────────────────
-- 1. SELECT * FROM public.objects;        -- empty, no error
-- 2. SELECT column_name FROM information_schema.columns
--      WHERE table_name IN ('rows','cols','kb_cols','nodes')
--      AND column_name = 'object_id';      -- 4 rows
-- 3. INSERT INTO public.objects (workspace_id, label, alias)
--    VALUES ('<owner-ws>', 'Test-Object', 'test-obj');
--    -- erlaubt nur fuer owner/admin/editor; viewer faellt durch.
-- 4. INSERT als nicht-Member → permission denied via RLS.
