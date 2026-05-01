-- ═══════════════════════════════════════════════════════════════
-- Welle C Folge — list_workspace_events RPC
--
-- workspace_events wurde in einer fruehen Iteration als supabase_admin
-- angelegt; postgres-User kann nachtraeglich keine RLS-Policies setzen
-- (ownership-Block, siehe CLAUDE.md). Stattdessen exposen wir eine
-- SECURITY DEFINER-RPC die intern den admin/owner-Check macht — das
-- liefert dieselbe UX wie eine RLS-Policy, ohne Owner-Wechsel.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.list_workspace_events(
  p_workspace_id uuid,
  p_limit        int DEFAULT 50,
  p_offset       int DEFAULT 0,
  p_event_type   public.workspace_event_kind DEFAULT NULL
)
RETURNS TABLE(
  id           uuid,
  workspace_id uuid,
  event_type   public.workspace_event_kind,
  payload      jsonb,
  actor_id     uuid,
  created_at   timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public._is_workspace_admin(p_workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT e.id, e.workspace_id, e.event_type, e.payload, e.actor_id, e.created_at
      FROM public.workspace_events e
     WHERE e.workspace_id = p_workspace_id
       AND (p_event_type IS NULL OR e.event_type = p_event_type)
     ORDER BY e.created_at DESC
     LIMIT GREATEST(LEAST(COALESCE(p_limit, 50), 500), 1)
     OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END $$;

GRANT EXECUTE ON FUNCTION public.list_workspace_events(uuid, int, int, public.workspace_event_kind)
  TO authenticated;

COMMENT ON FUNCTION public.list_workspace_events IS
  'Welle C — admin/owner-only Read-RPC fuer workspace_events. Ersetzt fehlende RLS-Policy (Tabelle hat supabase_admin als Owner, postgres-User kann sie nicht setzen).';
