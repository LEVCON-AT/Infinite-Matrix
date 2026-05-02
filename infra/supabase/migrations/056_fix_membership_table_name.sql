-- ═══════════════════════════════════════════════════════════════
-- Welle C Hotfix — Tabelle heisst `memberships`, nicht
-- `workspace_memberships`.
--
-- Die Migrationen 050 (Webhook-RPCs) + 053 (list_workspace_events) +
-- 055 (emit_event-Trigger) referenzieren `public.workspace_memberships`
-- — die Tabelle existiert nicht (siehe Migration 001/002, sie heisst
-- `memberships`). Das macht aktuelle Bugs:
--   - _is_workspace_admin() wirft "relation does not exist"
-- 	   → create/update/delete_workspace_webhook bricht
--   - list_workspace_events bricht aus dem gleichen Grund
--   - membership-Trigger in 055 wurden nie angelegt
--
-- Hier korrigieren wir alle drei + legen die membership-Trigger neu an.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1) _is_workspace_admin (Migration 050) korrigieren ──────────
CREATE OR REPLACE FUNCTION public._is_workspace_admin(p_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
     WHERE m.workspace_id = p_workspace_id
       AND m.user_id = auth.uid()
       AND m.role IN ('owner', 'admin')
       AND m.deactivated_at IS NULL
  );
$$;

-- ─── 2) workspace_events_admin_select Policy (Migration 050) ─────
DROP POLICY IF EXISTS workspace_events_admin_select ON public.workspace_events;
-- Owner ist supabase_admin → wir koennen die Policy als postgres nicht
-- DROPpen ohne Owner-Block. Falls schon vorhanden mit alter Tabellen-
-- Referenz, ist sie eh broken — wir lassen sie stehen, die RPC-Wrapper
-- (list_workspace_events) machen den Check selber.

-- ─── 3) workspace_webhooks-Policies (Migration 050) ──────────────
DROP POLICY IF EXISTS workspace_webhooks_admin_select ON public.workspace_webhooks;
CREATE POLICY workspace_webhooks_admin_select ON public.workspace_webhooks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.memberships m
       WHERE m.workspace_id = workspace_webhooks.workspace_id
         AND m.user_id = auth.uid()
         AND m.role IN ('owner', 'admin')
         AND m.deactivated_at IS NULL
    )
  );

-- ─── 4) emit_event-Trigger auf memberships (Migration 055) ──────
-- Die DROPpen vorsorglich auch die alten falschen Namen falls sie
-- doch teilweise angelegt wurden.
DROP TRIGGER IF EXISTS workspace_membership_insert_emit_event ON public.memberships;
DROP TRIGGER IF EXISTS workspace_membership_role_emit_event ON public.memberships;
DROP TRIGGER IF EXISTS workspace_membership_deactivate_emit_event ON public.memberships;
DROP TRIGGER IF EXISTS workspace_membership_delete_emit_event ON public.memberships;

-- Die Functions (_membership_*_emit_event) liegen schon aus
-- Migration 055 vor; nur die Trigger neu auf der richtigen Tabelle.
CREATE TRIGGER workspace_membership_insert_emit_event
  AFTER INSERT ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public._membership_insert_emit_event();

CREATE TRIGGER workspace_membership_role_emit_event
  AFTER UPDATE OF role ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public._membership_role_emit_event();

CREATE TRIGGER workspace_membership_deactivate_emit_event
  AFTER UPDATE OF deactivated_at ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public._membership_deactivate_emit_event();

CREATE TRIGGER workspace_membership_delete_emit_event
  AFTER DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public._membership_delete_emit_event();

COMMENT ON FUNCTION public._is_workspace_admin IS
  'Welle C Hotfix — Tabelle heisst memberships (war workspace_memberships in 050).';
