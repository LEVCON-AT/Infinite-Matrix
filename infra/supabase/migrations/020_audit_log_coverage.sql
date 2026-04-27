-- ═══════════════════════════════════════════════════════════════
-- Phase 2 Polish-Welle 1 — Audit-Log-Coverage-Erweiterung
--
-- Audit (docs/audit/B0-audit-log-coverage.md, 2026-04-28) hat
-- Compliance-kritische Luecken gefunden:
--   - node.created / .deleted / .renamed
--   - card.created / .moved / .deleted
--   - doc.created / .deleted / .renamed / .alias_changed
--
-- Nice-to-have (Phase D Follow-up, NICHT in 020):
--   - row/col create/rename/delete
--   - kb_col create/rename/delete
--   - checklist created/closed/deleted
--
-- Bewusst SKIPPED (Volume-Risk):
--   - cell.data-JSONB-Aenderungen (Inline-Editor-Tippen)
--   - card.name / .note (Inline-Edit-Floods)
--   - checklist_items.done-Toggle (100+/min bei aktiver Liste)
--   - kb_cards.position bei col-internem Sort (nur cross-col-Move loggen)
--
-- Strategie: AFTER-Trigger pro Tabelle. SECURITY DEFINER-Helper
-- emit_audit_log() umgeht das deny-all-Policy von workspace_audit_log
-- und setzt actor_id auf auth.uid() (wenn vorhanden).
-- ═══════════════════════════════════════════════════════════════

-- ─── Helper: emit_audit_log ─────────────────────────────────────
-- SECURITY DEFINER, weil workspace_audit_log INSERT per Policy
-- blockiert ist (nur via SECURITY DEFINER-Pfade erlaubt).
-- actor_id = auth.uid() — bei Trigger-Lauf in einer User-Session
-- gesetzt; bei Service-Role-Mutationen (Bridge/Admin-Scripts) NULL.
-- search_path explizit, weil SECURITY DEFINER (Hausnorm aus 014).
CREATE OR REPLACE FUNCTION public.emit_audit_log(
  p_workspace_id uuid,
  p_action       text,
  p_payload      jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO public.workspace_audit_log (workspace_id, actor_id, action, payload)
  VALUES (p_workspace_id, auth.uid(), p_action, p_payload);
END $$;

-- emit_audit_log selbst rufen Trigger — kein User-direct-call noetig.
-- GRANT auf authenticated dennoch fuer ggf. spaetere RPCs die explizit
-- audit-loggen wollen.
GRANT EXECUTE ON FUNCTION public.emit_audit_log(uuid, text, jsonb)
  TO authenticated, service_role;

-- ─── Nodes: created / deleted / renamed ─────────────────────────
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
    -- Nur strukturelle Changes loggen — content (data-JSONB) ist Volume.
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

DROP TRIGGER IF EXISTS nodes_audit_insert ON public.nodes;
CREATE TRIGGER nodes_audit_insert AFTER INSERT ON public.nodes
  FOR EACH ROW EXECUTE FUNCTION public.nodes_audit_emit();

DROP TRIGGER IF EXISTS nodes_audit_update ON public.nodes;
CREATE TRIGGER nodes_audit_update AFTER UPDATE ON public.nodes
  FOR EACH ROW EXECUTE FUNCTION public.nodes_audit_emit();

DROP TRIGGER IF EXISTS nodes_audit_delete ON public.nodes;
CREATE TRIGGER nodes_audit_delete AFTER DELETE ON public.nodes
  FOR EACH ROW EXECUTE FUNCTION public.nodes_audit_emit();

-- ─── KB-Cards: created / moved / deleted ────────────────────────
-- card.moved triggert nur bei col-Wechsel (cross-column-move).
-- Position-Change innerhalb derselben Spalte loggen wir nicht — das
-- waere Volume-Risk bei haeufigem Reordering.
CREATE OR REPLACE FUNCTION public.kb_cards_audit_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.emit_audit_log(
      NEW.workspace_id,
      'card.created',
      jsonb_build_object(
        'card_id', NEW.id,
        'board_id', NEW.board_id,
        'col_id', NEW.col_id,
        'name', NEW.name
      )
    );
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.emit_audit_log(
      OLD.workspace_id,
      'card.deleted',
      jsonb_build_object(
        'card_id', OLD.id,
        'board_id', OLD.board_id,
        'name', OLD.name
      )
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.col_id IS DISTINCT FROM NEW.col_id THEN
      PERFORM public.emit_audit_log(
        NEW.workspace_id,
        'card.moved',
        jsonb_build_object(
          'card_id', NEW.id,
          'old_col_id', OLD.col_id,
          'new_col_id', NEW.col_id
        )
      );
    END IF;
    IF OLD.archived IS DISTINCT FROM NEW.archived AND NEW.archived THEN
      PERFORM public.emit_audit_log(
        NEW.workspace_id,
        'card.archived',
        jsonb_build_object('card_id', NEW.id, 'name', NEW.name)
      );
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS kb_cards_audit_insert ON public.kb_cards;
CREATE TRIGGER kb_cards_audit_insert AFTER INSERT ON public.kb_cards
  FOR EACH ROW EXECUTE FUNCTION public.kb_cards_audit_emit();

DROP TRIGGER IF EXISTS kb_cards_audit_update ON public.kb_cards;
CREATE TRIGGER kb_cards_audit_update AFTER UPDATE ON public.kb_cards
  FOR EACH ROW EXECUTE FUNCTION public.kb_cards_audit_emit();

DROP TRIGGER IF EXISTS kb_cards_audit_delete ON public.kb_cards;
CREATE TRIGGER kb_cards_audit_delete AFTER DELETE ON public.kb_cards
  FOR EACH ROW EXECUTE FUNCTION public.kb_cards_audit_emit();

-- ─── Docs: created / deleted / renamed / alias_changed ──────────
-- Content-Edits (docs.content) NICHT loggen — Wiki-Editor-Tippen
-- waere Volume-Risk. Nur Title + Alias als strukturelle Changes.
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

DROP TRIGGER IF EXISTS docs_audit_insert ON public.docs;
CREATE TRIGGER docs_audit_insert AFTER INSERT ON public.docs
  FOR EACH ROW EXECUTE FUNCTION public.docs_audit_emit();

DROP TRIGGER IF EXISTS docs_audit_update ON public.docs;
CREATE TRIGGER docs_audit_update AFTER UPDATE ON public.docs
  FOR EACH ROW EXECUTE FUNCTION public.docs_audit_emit();

DROP TRIGGER IF EXISTS docs_audit_delete ON public.docs;
CREATE TRIGGER docs_audit_delete AFTER DELETE ON public.docs
  FOR EACH ROW EXECUTE FUNCTION public.docs_audit_emit();

COMMENT ON FUNCTION public.emit_audit_log IS
  'SECURITY-DEFINER-Helper fuer Trigger + zukuenftige RPCs. Schreibt in workspace_audit_log mit actor_id = auth.uid().';
COMMENT ON FUNCTION public.nodes_audit_emit IS
  'AFTER-Trigger fuer nodes: emittiert node.created/.deleted/.renamed/.alias_changed.';
COMMENT ON FUNCTION public.kb_cards_audit_emit IS
  'AFTER-Trigger fuer kb_cards: emittiert card.created/.deleted/.moved/.archived. Position-Changes innerhalb gleicher Col bewusst NICHT geloggt (Volume-Risk).';
COMMENT ON FUNCTION public.docs_audit_emit IS
  'AFTER-Trigger fuer docs: emittiert doc.created/.deleted/.renamed/.alias_changed. Content-Edits NICHT geloggt (Volume-Risk).';
