-- ═══════════════════════════════════════════════════════════════
-- Phase 3 O.8.A — Name-Templates fuer nameable Cell-Features
--
-- Drei nameable Tabellen bekommen jeweils eine `*_template`-Spalte
-- als neue Source-of-Truth. Die bestehenden `label`/`title`-Spalten
-- bleiben als Plain-Snapshot/Fallback erhalten (Dual-Pattern, vom
-- User 2026-04-29 explizit gewaehlt — keine DB-Trigger-Kaskade).
--
--   nodes        : label_template   (Matrix + Board)
--   docs         : title_template   (Doku)
--   checklists   : label_template   (Checkliste)
--
-- Der Render-Resolver lebt im Client (`lib/label-template.ts`) und
-- erkennt Templates am `{`-Pattern. Plain-Strings ohne `{}` rendern
-- 1:1 — existing Daten sehen unveraendert aus.
--
-- Audit-Trigger (siehe Migration 020) werden um Template-Aenderungen
-- erweitert, damit Audit-Diffs nach dem Frontend-Roll-out
-- nachvollziehbar bleiben. Checklists hat heute keinen Audit-Trigger
-- (out-of-scope dieser Migration).
--
-- Idempotent via IF NOT EXISTS / CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. nodes.label_template ─────────────────────────────────
-- DEFAULT '' zusaetzlich zu NOT NULL: bestehende Insert-Pfade, die
-- das Feld noch nicht kennen (legacy Imports, Bridge-RPCs ohne Update),
-- erzeugen ein leeres Template. Der Client-Resolver erkennt das und
-- faellt auf label zurueck — kein Sichtbarkeits-Drift.
ALTER TABLE public.nodes
  ADD COLUMN IF NOT EXISTS label_template text;

UPDATE public.nodes
   SET label_template = label
 WHERE label_template IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='nodes'
       AND column_name='label_template' AND is_nullable='YES'
  ) THEN
    ALTER TABLE public.nodes
      ALTER COLUMN label_template SET DEFAULT '';
    ALTER TABLE public.nodes
      ALTER COLUMN label_template SET NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.nodes.label_template IS
  'Source-of-Truth fuer Display-Name. Plain-Strings rendern wie label; mit {row.object}/{column.object} resolved der Client zur Render-Zeit (Phase 3 O.8). label bleibt als Snapshot-Fallback.';

-- ─── 2. docs.title_template ───────────────────────────────────
ALTER TABLE public.docs
  ADD COLUMN IF NOT EXISTS title_template text;

UPDATE public.docs
   SET title_template = title
 WHERE title_template IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='docs'
       AND column_name='title_template' AND is_nullable='YES'
  ) THEN
    ALTER TABLE public.docs
      ALTER COLUMN title_template SET DEFAULT '';
    ALTER TABLE public.docs
      ALTER COLUMN title_template SET NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.docs.title_template IS
  'Source-of-Truth fuer Doku-Title. Analog nodes.label_template (Phase 3 O.8).';

-- ─── 3. checklists.label_template ─────────────────────────────
ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS label_template text;

UPDATE public.checklists
   SET label_template = label
 WHERE label_template IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='checklists'
       AND column_name='label_template' AND is_nullable='YES'
  ) THEN
    ALTER TABLE public.checklists
      ALTER COLUMN label_template SET DEFAULT '';
    ALTER TABLE public.checklists
      ALTER COLUMN label_template SET NOT NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.checklists.label_template IS
  'Source-of-Truth fuer Checklist-Label. Analog nodes.label_template (Phase 3 O.8).';

-- ─── 4. Audit-Trigger Patch: nodes ─────────────────────────────
-- Erweitert nodes_audit_emit um node.template_changed, sodass Audit-
-- Log Template-Renames sichtbar macht. Bestehende node.renamed-Events
-- (auf label) bleiben zusaetzlich.
CREATE OR REPLACE FUNCTION public.nodes_audit_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_audit_log(
      NEW.workspace_id,
      'node.created',
      jsonb_build_object(
        'node_id', NEW.id,
        'type', NEW.type,
        'label', NEW.label,
        'label_template', NEW.label_template,
        'parent_cell_id', NEW.parent_cell_id
      )
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.emit_audit_log(
      OLD.workspace_id,
      'node.deleted',
      jsonb_build_object(
        'node_id', OLD.id,
        'type', OLD.type,
        'label', OLD.label
      )
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.label IS DISTINCT FROM NEW.label THEN
      PERFORM public.emit_audit_log(
        NEW.workspace_id,
        'node.renamed',
        jsonb_build_object(
          'node_id', NEW.id,
          'old_label', OLD.label,
          'new_label', NEW.label
        )
      );
    END IF;
    IF OLD.label_template IS DISTINCT FROM NEW.label_template THEN
      PERFORM public.emit_audit_log(
        NEW.workspace_id,
        'node.template_changed',
        jsonb_build_object(
          'node_id', NEW.id,
          'old_template', OLD.label_template,
          'new_template', NEW.label_template
        )
      );
    END IF;
    IF OLD.alias IS DISTINCT FROM NEW.alias THEN
      PERFORM public.emit_audit_log(
        NEW.workspace_id,
        'node.alias_changed',
        jsonb_build_object(
          'node_id', NEW.id,
          'old_alias', OLD.alias,
          'new_alias', NEW.alias
        )
      );
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END $$;

COMMENT ON FUNCTION public.nodes_audit_emit IS
  'AFTER-Trigger fuer nodes: emittiert node.created/.deleted/.renamed/.template_changed/.alias_changed (Phase 3 O.8 erweitert um template_changed).';

-- ─── 5. Audit-Trigger Patch: docs ──────────────────────────────
CREATE OR REPLACE FUNCTION public.docs_audit_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_audit_log(
      NEW.workspace_id,
      'doc.created',
      jsonb_build_object(
        'doc_id', NEW.id,
        'title', NEW.title,
        'title_template', NEW.title_template,
        'alias', NEW.alias,
        'attached_cell_id', NEW.attached_cell_id
      )
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.emit_audit_log(
      OLD.workspace_id,
      'doc.deleted',
      jsonb_build_object('doc_id', OLD.id, 'title', OLD.title)
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.title IS DISTINCT FROM NEW.title THEN
      PERFORM public.emit_audit_log(
        NEW.workspace_id,
        'doc.renamed',
        jsonb_build_object(
          'doc_id', NEW.id,
          'old_title', OLD.title,
          'new_title', NEW.title
        )
      );
    END IF;
    IF OLD.title_template IS DISTINCT FROM NEW.title_template THEN
      PERFORM public.emit_audit_log(
        NEW.workspace_id,
        'doc.template_changed',
        jsonb_build_object(
          'doc_id', NEW.id,
          'old_template', OLD.title_template,
          'new_template', NEW.title_template
        )
      );
    END IF;
    IF OLD.alias IS DISTINCT FROM NEW.alias THEN
      PERFORM public.emit_audit_log(
        NEW.workspace_id,
        'doc.alias_changed',
        jsonb_build_object(
          'doc_id', NEW.id,
          'old_alias', OLD.alias,
          'new_alias', NEW.alias
        )
      );
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END $$;

COMMENT ON FUNCTION public.docs_audit_emit IS
  'AFTER-Trigger fuer docs: emittiert doc.created/.deleted/.renamed/.template_changed/.alias_changed. Content-Edits NICHT geloggt (Volume-Risk).';

-- Hinweis: checklists haben heute keinen Audit-Trigger (kein Eintrag
-- in Migration 020). Checklist-Template-Audit ist out-of-scope dieser
-- Migration; ein dedicated checklists_audit_emit-Trigger waere ein
-- separater Sprint.

COMMIT;
