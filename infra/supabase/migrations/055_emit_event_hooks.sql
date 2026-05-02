-- ═══════════════════════════════════════════════════════════════
-- Welle C Folge — emit_event-Hooks in existing Audit-RPCs
--
-- Audit-RPCs (create_invite, redeem_invite, change_member_role,
-- transfer_workspace_ownership, delete_workspace, deactivate_member,
-- remove_member, reactivate_member) bekommen einen emit_event-Aufruf
-- am Ende des Happy-Path. Damit feuert der webhook-dispatcher
-- (Welle C.3) tatsaechlich, wenn der User Webhooks abonniert hat.
--
-- Pattern: am Ende der RPC, NACH der eigentlichen Mutation, NACH dem
-- workspace_audit_log-INSERT. emit_event ist Best-Effort — wenn es
-- fehlschlaegt, soll die Mutation trotzdem committed sein (Trigger
-- haengen am NOTIFY ohne Throw).
--
-- Schema-Quad:
--   - Schema: hier (RPCs aktualisiert).
--   - Mutations: bestehende lib/* unveraendert — RPCs sind transparent.
--   - MCP-Tools: nicht betroffen (lesen nicht direkt).
--   - Export/Import: workspace_events sind nicht exportiert.
--
-- Task-Lifecycle-Events (task.created/.completed/.deleted) folgen in
-- einem Folge-Sub-Sprint, weil die existing Task-Mutations im Frontend
-- direkt SQL absetzen (kein RPC-Wrapper). Migration 056 wird einen
-- Trigger AFTER INSERT/UPDATE/DELETE auf tasks anlegen und damit auch
-- Cell-Events koordinieren.
-- ═══════════════════════════════════════════════════════════════

-- ─── 1) create_invite ───────────────────────────────────────────
-- Migration 011 + 012/013-Patches. Wir lesen die existing Definition
-- aus pg_proc und ergaenzen den emit_event-Call im Body.
-- Statt CREATE OR REPLACE mit dupliziertem Body machen wir es als
-- DO-Block, der auf den RPC-Tail patcht.
--
-- Defensive Kopie: existing-RPC-Body liegt in Migration 011/012; wir
-- duplizieren NICHT, sondern wickeln den RPC in einen Trigger-aehnlichen
-- Wrapper. Der saubere Weg ist OR REPLACE mit voller Body — ich kopiere
-- den exakt aus Migration 011 + ergaenze emit_event.

CREATE OR REPLACE FUNCTION public.create_invite(
  p_workspace_id uuid,
  p_role text,
  p_invited_email text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_token text;
  v_token_hash bytea;
  v_token_lookup text;
  v_id uuid;
  v_expires timestamptz;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Caller muss owner/admin in der Workspace sein.
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships
    WHERE workspace_id = p_workspace_id
      AND user_id = v_actor
      AND role IN ('owner', 'admin')
      AND deactivated_at IS NULL
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_role NOT IN ('editor', 'viewer') THEN
    RAISE EXCEPTION 'invalid_role' USING ERRCODE = 'check_violation';
  END IF;

  -- 32 byte token, hex-encoded → 64 char URL-safe.
  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := digest(v_token, 'sha256');
  v_token_lookup := substring(v_token from 1 for 16);
  v_expires := now() + interval '7 days';

  INSERT INTO public.workspace_invites (
    workspace_id, token_hash, token_lookup, role, expires_at, invited_by, invited_email
  ) VALUES (
    p_workspace_id, v_token_hash, v_token_lookup, p_role, v_expires, v_actor, p_invited_email
  ) RETURNING id INTO v_id;

  INSERT INTO public.workspace_audit_log (workspace_id, actor_id, action, payload)
    VALUES (p_workspace_id, v_actor, 'invite.created',
            jsonb_build_object('invite_id', v_id, 'role', p_role, 'email', p_invited_email));

  -- Welle C: Webhook-Event.
  PERFORM public.emit_event(p_workspace_id, 'member.invited',
    jsonb_build_object('invite_id', v_id, 'role', p_role, 'invited_email', p_invited_email));

  RETURN jsonb_build_object('invite_id', v_id, 'token', v_token, 'expires_at', v_expires);
END $$;

GRANT EXECUTE ON FUNCTION public.create_invite(uuid, text, text) TO authenticated;

-- ─── 2) redeem_invite (Migration 012 hat email_match-Guard) ────
-- Wir leeren NICHT die existing Logic; wir wrap'en die emit_event-Zeile
-- nach dem erfolgreichen UPDATE. Lass die complete RPC stehen und
-- ergaenze nur am Ende:
--
-- Pragmatic: ich kopiere die exakte Body aus 012_invite_redeem_guards
-- und haenge den emit_event an. Da die Migration aber komplex ist
-- (Email-Match-Check, Already-Member-Check), verzichte ich hier auf
-- Vollkopie und nutze stattdessen einen TRIGGER auf workspace_memberships
-- als sicheren Indikator dass ein Member dazukam.

DROP TRIGGER IF EXISTS workspace_membership_insert_emit_event ON public.workspace_memberships;
CREATE OR REPLACE FUNCTION public._membership_insert_emit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Nur 'member.joined' wenn auth.uid() der neue User selbst ist
  -- (= via redeem_invite). Owner-Bootstrap-Inserts (Workspace-Anlage)
  -- emittieren bereits 'workspace.created' woanders.
  IF NEW.user_id = auth.uid() AND NEW.role <> 'owner' THEN
    PERFORM public.emit_event(NEW.workspace_id, 'member.joined',
      jsonb_build_object('user_id', NEW.user_id, 'role', NEW.role));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Best-Effort — Trigger-Fail darf den INSERT nicht blockieren.
  RETURN NEW;
END $$;

CREATE TRIGGER workspace_membership_insert_emit_event
  AFTER INSERT ON public.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION public._membership_insert_emit_event();

-- ─── 3) change_member_role (Migration 014) ──────────────────────
-- Auch hier: existing RPC ist umfangreich (Last-Owner-Demote-Schutz).
-- Statt Vollkopie: TRIGGER AFTER UPDATE OF role.
DROP TRIGGER IF EXISTS workspace_membership_role_emit_event ON public.workspace_memberships;
CREATE OR REPLACE FUNCTION public._membership_role_emit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    PERFORM public.emit_event(NEW.workspace_id, 'member.role_changed',
      jsonb_build_object(
        'user_id', NEW.user_id,
        'old_role', OLD.role,
        'new_role', NEW.role
      ));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

CREATE TRIGGER workspace_membership_role_emit_event
  AFTER UPDATE OF role ON public.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION public._membership_role_emit_event();

-- ─── 4) member.left (deactivated_at gesetzt ODER Row-Delete) ───
-- Wir nutzen einen UPDATE-Trigger fuer deactivated_at (soft-delete)
-- + DELETE-Trigger fuer hard-remove.
DROP TRIGGER IF EXISTS workspace_membership_deactivate_emit_event ON public.workspace_memberships;
CREATE OR REPLACE FUNCTION public._membership_deactivate_emit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.deactivated_at IS NOT NULL AND OLD.deactivated_at IS NULL THEN
    PERFORM public.emit_event(NEW.workspace_id, 'member.left',
      jsonb_build_object('user_id', NEW.user_id, 'soft_delete', true));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

CREATE TRIGGER workspace_membership_deactivate_emit_event
  AFTER UPDATE OF deactivated_at ON public.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION public._membership_deactivate_emit_event();

DROP TRIGGER IF EXISTS workspace_membership_delete_emit_event ON public.workspace_memberships;
CREATE OR REPLACE FUNCTION public._membership_delete_emit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.emit_event(OLD.workspace_id, 'member.left',
    jsonb_build_object('user_id', OLD.user_id, 'hard_delete', true));
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RETURN OLD;
END $$;

CREATE TRIGGER workspace_membership_delete_emit_event
  AFTER DELETE ON public.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION public._membership_delete_emit_event();

-- ─── 5) workspace.created (Migration 023) ──────────────────────
-- Trigger AFTER INSERT auf workspaces.
DROP TRIGGER IF EXISTS workspace_insert_emit_event ON public.workspaces;
CREATE OR REPLACE FUNCTION public._workspace_insert_emit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.emit_event(NEW.id, 'workspace.created',
    jsonb_build_object('name', NEW.name, 'owner_id', NEW.owner_id));
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

CREATE TRIGGER workspace_insert_emit_event
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public._workspace_insert_emit_event();

-- ─── 6) workspace.renamed (Migration 023+) ─────────────────────
DROP TRIGGER IF EXISTS workspace_update_emit_event ON public.workspaces;
CREATE OR REPLACE FUNCTION public._workspace_update_emit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    PERFORM public.emit_event(NEW.id, 'workspace.renamed',
      jsonb_build_object('old_name', OLD.name, 'new_name', NEW.name));
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    PERFORM public.emit_event(NEW.id, 'workspace.transferred',
      jsonb_build_object('old_owner_id', OLD.owner_id, 'new_owner_id', NEW.owner_id));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END $$;

CREATE TRIGGER workspace_update_emit_event
  AFTER UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public._workspace_update_emit_event();

-- ─── 7) workspace.deleted ──────────────────────────────────────
-- BEFORE DELETE damit emit_event noch FK-resolved auf workspaces.
-- (Nach DELETE waere workspace_id im FK-Constraint problematisch.)
-- workspace_events FK hat ON DELETE CASCADE — egal wann emittiert,
-- die Event-Row fliegt mit raus. Also AFTER DELETE muss der
-- webhook-dispatcher das innerhalb des kurzen Window aufgreifen.
-- Stattdessen: emittieren BEFORE DELETE, Worker dispatched bevor
-- der CASCADE die Event-Row mitnimmt.
DROP TRIGGER IF EXISTS workspace_delete_emit_event ON public.workspaces;
CREATE OR REPLACE FUNCTION public._workspace_delete_emit_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.emit_event(OLD.id, 'workspace.deleted',
    jsonb_build_object('name', OLD.name, 'owner_id', OLD.owner_id));
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RETURN OLD;
END $$;

CREATE TRIGGER workspace_delete_emit_event
  BEFORE DELETE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public._workspace_delete_emit_event();

-- ─── Kommentare ────────────────────────────────────────────────
COMMENT ON FUNCTION public._membership_insert_emit_event IS
  'Welle C Folge — emit_event(member.joined) bei redeem_invite-Insert.';
COMMENT ON FUNCTION public._membership_role_emit_event IS
  'Welle C Folge — emit_event(member.role_changed) bei UPDATE OF role.';
COMMENT ON FUNCTION public._workspace_insert_emit_event IS
  'Welle C Folge — emit_event(workspace.created) AFTER INSERT.';
COMMENT ON FUNCTION public._workspace_update_emit_event IS
  'Welle C Folge — emit_event(workspace.renamed/transferred) AFTER UPDATE.';
COMMENT ON FUNCTION public._workspace_delete_emit_event IS
  'Welle C Folge — emit_event(workspace.deleted) BEFORE DELETE (vor CASCADE).';
