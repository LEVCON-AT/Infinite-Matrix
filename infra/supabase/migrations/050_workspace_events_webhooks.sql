-- ═══════════════════════════════════════════════════════════════
-- Welle C — workspace_events + workspace_webhooks
--
-- Event-Bus pro Workspace fuer Outbound-Webhooks (n8n / Slack /
-- Teams-Bot / Custom-Endpoints). Bestehende Audit-RPCs (invites,
-- members, lifecycle, ...) bekommen einen emit_event-Call dazu —
-- zusaetzlich zum workspace_audit_log, damit Audit + Events sauber
-- getrennt bleiben (Audit = Compliance-Log, Events = externer Bus).
--
-- Architektur:
--   - workspace_events ist Append-Only, RLS auf workspace_admin/owner.
--   - workspace_webhooks ist CRUD-Tabelle, RLS auf workspace_admin/owner.
--   - dispatch_webhook(p_event_id) ist ein RPC-Stub fuer den externen
--     Dispatch-Worker. V1: kein eingebauter Dispatch (self-hosted
--     Supabase hat keine Edge-Functions in diesem Stack); V2 ist
--     ein Node-Service der workspace_events pollt + an webhooks
--     dispatched.
--
-- Schema-Quad:
--   - Schema: hier (Tabellen + RLS + RPCs).
--   - Mutations: lib/webhooks.ts ruft RPCs.
--   - MCP-Tools: kein direkter KI-Zugriff (sicherheitsrelevant).
--   - Export/Import: workspace_webhooks ist NICHT exportiert
--     (Secret pro Workspace, nicht uebertragbar).
-- ═══════════════════════════════════════════════════════════════

-- 1) ENUM: bekannte Event-Typen. Erweiterbar via ALTER TYPE ADD VALUE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspace_event_kind') THEN
    CREATE TYPE public.workspace_event_kind AS ENUM (
      'member.invited',
      'member.joined',
      'member.left',
      'member.role_changed',
      'workspace.created',
      'workspace.renamed',
      'workspace.deleted',
      'workspace.transferred',
      'task.created',
      'task.completed',
      'task.deleted',
      'cell.created',
      'cell.deleted'
    );
  END IF;
END $$;

-- 2) Events-Tabelle (append-only).
CREATE TABLE IF NOT EXISTS public.workspace_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_type   public.workspace_event_kind NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_events_ws_created_idx
  ON public.workspace_events (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS workspace_events_dispatch_idx
  ON public.workspace_events (created_at) WHERE created_at > '2026-01-01';

ALTER TABLE public.workspace_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_events FORCE  ROW LEVEL SECURITY;

-- Append-only: kein UPDATE/DELETE.
DROP TRIGGER IF EXISTS workspace_events_immutable ON public.workspace_events;
CREATE OR REPLACE FUNCTION public._workspace_events_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'workspace_events_immutable' USING ERRCODE = 'feature_not_supported';
END $$;

CREATE TRIGGER workspace_events_immutable
  BEFORE UPDATE OR DELETE ON public.workspace_events
  FOR EACH ROW EXECUTE FUNCTION public._workspace_events_immutable();

-- RLS-Policy: workspace-admin oder workspace-owner sieht Events seines
-- Workspaces. Insert ausschliesslich via emit_event-RPC (nichts direkt).
DROP POLICY IF EXISTS workspace_events_admin_select ON public.workspace_events;
CREATE POLICY workspace_events_admin_select ON public.workspace_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships m
       WHERE m.workspace_id = workspace_events.workspace_id
         AND m.user_id = auth.uid()
         AND m.role IN ('owner', 'admin')
         AND m.deactivated_at IS NULL
    )
  );

DROP POLICY IF EXISTS workspace_events_no_direct_writes ON public.workspace_events;
CREATE POLICY workspace_events_no_direct_writes ON public.workspace_events
  FOR INSERT WITH CHECK (false);

-- 3) emit_event-RPC. SECURITY DEFINER, von audit-RPCs intern aufrufbar.
CREATE OR REPLACE FUNCTION public.emit_event(
  p_workspace_id uuid,
  p_event_type   public.workspace_event_kind,
  p_payload      jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_workspace_id IS NULL THEN
    RAISE EXCEPTION 'workspace_id_required';
  END IF;
  INSERT INTO public.workspace_events (workspace_id, event_type, payload, actor_id)
    VALUES (p_workspace_id, p_event_type, COALESCE(p_payload, '{}'::jsonb), auth.uid())
    RETURNING id INTO v_id;
  -- NOTIFY 'workspace_events_new' fuer den externen Dispatch-Worker.
  -- Worker laesst LISTEN laufen und pollt bei NOTIFY.
  PERFORM pg_notify('workspace_events_new', v_id::text);
  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.emit_event(uuid, public.workspace_event_kind, jsonb) TO authenticated;

-- 4) workspace_webhooks-Tabelle.
CREATE TABLE IF NOT EXISTS public.workspace_webhooks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name            text NOT NULL,
  target_url      text NOT NULL CHECK (target_url ~* '^https?://'),
  signing_secret  bytea NOT NULL,
  event_types     public.workspace_event_kind[] NOT NULL DEFAULT '{}',
  enabled         boolean NOT NULL DEFAULT true,
  last_status_code int,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  fail_count      int NOT NULL DEFAULT 0,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_webhooks_ws_idx
  ON public.workspace_webhooks (workspace_id);

DROP TRIGGER IF EXISTS workspace_webhooks_set_updated_at ON public.workspace_webhooks;
CREATE TRIGGER workspace_webhooks_set_updated_at
  BEFORE UPDATE ON public.workspace_webhooks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.workspace_webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_webhooks FORCE  ROW LEVEL SECURITY;

-- Direkt-Schreib blockiert; alles via SECURITY DEFINER-RPCs.
DROP POLICY IF EXISTS workspace_webhooks_admin_select ON public.workspace_webhooks;
CREATE POLICY workspace_webhooks_admin_select ON public.workspace_webhooks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.workspace_memberships m
       WHERE m.workspace_id = workspace_webhooks.workspace_id
         AND m.user_id = auth.uid()
         AND m.role IN ('owner', 'admin')
         AND m.deactivated_at IS NULL
    )
  );

DROP POLICY IF EXISTS workspace_webhooks_no_direct_writes ON public.workspace_webhooks;
CREATE POLICY workspace_webhooks_no_direct_writes ON public.workspace_webhooks
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS workspace_webhooks_no_direct_updates ON public.workspace_webhooks;
CREATE POLICY workspace_webhooks_no_direct_updates ON public.workspace_webhooks
  FOR UPDATE USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS workspace_webhooks_no_direct_deletes ON public.workspace_webhooks;
CREATE POLICY workspace_webhooks_no_direct_deletes ON public.workspace_webhooks
  FOR DELETE USING (false);

-- 5) Safe-View ohne signing_secret.
DROP VIEW IF EXISTS public.workspace_webhooks_safe;
CREATE VIEW public.workspace_webhooks_safe
  WITH (security_invoker = true) AS
SELECT id, workspace_id, name, target_url, event_types, enabled,
       last_status_code, last_attempt_at, last_success_at, fail_count,
       created_by, created_at, updated_at
  FROM public.workspace_webhooks;

GRANT SELECT ON public.workspace_webhooks_safe TO authenticated;

-- 6) Helper: ist aktueller User Admin/Owner des Workspaces?
CREATE OR REPLACE FUNCTION public._is_workspace_admin(p_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_memberships m
     WHERE m.workspace_id = p_workspace_id
       AND m.user_id = auth.uid()
       AND m.role IN ('owner', 'admin')
       AND m.deactivated_at IS NULL
  );
$$;

-- 7) RPC: Webhook anlegen.
CREATE OR REPLACE FUNCTION public.create_workspace_webhook(
  p_workspace_id uuid,
  p_name         text,
  p_target_url   text,
  p_event_types  public.workspace_event_kind[]
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_id     uuid;
  v_secret bytea;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public._is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_target_url !~* '^https?://' THEN
    RAISE EXCEPTION 'target_url_invalid' USING ERRCODE = 'check_violation';
  END IF;
  -- Signing-Secret zufaellig generieren — 32 bytes (256bit). Wird beim
  -- Dispatch als HMAC-Key fuer den X-Signature-Header genutzt.
  v_secret := gen_random_bytes(32);
  INSERT INTO public.workspace_webhooks (
    workspace_id, name, target_url, signing_secret, event_types, created_by
  ) VALUES (
    p_workspace_id, p_name, p_target_url, v_secret, COALESCE(p_event_types, '{}'), auth.uid()
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object(
    'id', v_id,
    'signing_secret_hex', encode(v_secret, 'hex')
  );
END $$;

GRANT EXECUTE ON FUNCTION public.create_workspace_webhook(uuid, text, text, public.workspace_event_kind[]) TO authenticated;

-- 8) RPC: Webhook updaten.
CREATE OR REPLACE FUNCTION public.update_workspace_webhook(
  p_id          uuid,
  p_name        text,
  p_target_url  text,
  p_event_types public.workspace_event_kind[],
  p_enabled     boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ws uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT workspace_id INTO v_ws FROM public.workspace_webhooks WHERE id = p_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'webhook_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public._is_workspace_admin(v_ws) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.workspace_webhooks
     SET name        = p_name,
         target_url  = p_target_url,
         event_types = COALESCE(p_event_types, event_types),
         enabled     = p_enabled
   WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id);
END $$;

GRANT EXECUTE ON FUNCTION public.update_workspace_webhook(uuid, text, text, public.workspace_event_kind[], boolean) TO authenticated;

-- 9) RPC: Webhook loeschen.
CREATE OR REPLACE FUNCTION public.delete_workspace_webhook(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ws uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT workspace_id INTO v_ws FROM public.workspace_webhooks WHERE id = p_id;
  IF v_ws IS NULL THEN
    RAISE EXCEPTION 'webhook_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public._is_workspace_admin(v_ws) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM public.workspace_webhooks WHERE id = p_id;
  RETURN jsonb_build_object('id', p_id);
END $$;

GRANT EXECUTE ON FUNCTION public.delete_workspace_webhook(uuid) TO authenticated;

-- 10) Comments.
COMMENT ON TABLE  public.workspace_events IS
  'Event-Bus pro Workspace (Welle C.1). Append-only. Externer Dispatch-Worker liest via NOTIFY workspace_events_new.';
COMMENT ON TABLE  public.workspace_webhooks IS
  'Outbound-Webhook-Targets pro Workspace (Welle C.2). signing_secret per gen_random_bytes(32); HMAC-Key fuer X-Signature-Header beim Dispatch (Welle C.3).';
COMMENT ON FUNCTION public.emit_event IS
  'Append Event ans workspace_events. NOTIFY-Trigger informiert Dispatch-Worker.';
