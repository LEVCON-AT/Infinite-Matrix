-- ═══════════════════════════════════════════════════════════════
-- Phase 2 Welle A.2 — log_ai_call RPC
--
-- ai_call_log (Migration 018) hat eine Block-Insert-Policy fuer
-- alle Rollen — User koennen nicht direkt schreiben. Damit der
-- Browser-direct-Audit-Pfad aus lib/ai-assist.ts (Mitigation I) den
-- Log fuellen kann, brauchts einen SECURITY-DEFINER-RPC der die Row
-- mit auth.uid() einfuegt.
--
-- Best-effort: Frontend ruft das nach jedem LLM-Call. Falls der RPC
-- failed (Netz, RLS): console.warn, der Hauptcall blockiert nicht.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.log_ai_call(
  p_workspace_id   uuid,           -- NULL erlaubt (Wizard hat noch keinen)
  p_provider       public.ai_provider_kind,
  p_model_name     text,
  p_input_tokens   int,
  p_output_tokens  int,
  p_duration_ms    int,
  p_tool_calls     int,
  p_error          text             -- NULL bei Erfolg
)
RETURNS uuid
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

  -- Wenn workspace_id gesetzt: pruefen ob User Mitglied ist (sonst kein Logging im fremden Scope).
  IF p_workspace_id IS NOT NULL
     AND public.workspace_role_of(p_workspace_id) IS NULL THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Length-Caps: error-string max 2000 Zeichen (Volume-Schutz).
  IF p_error IS NOT NULL AND length(p_error) > 2000 THEN
    p_error := substring(p_error from 1 for 2000) || '… [truncated]';
  END IF;

  INSERT INTO public.ai_call_log (
    user_id, workspace_id, provider, model_name,
    input_tokens, output_tokens, duration_ms, tool_calls, error
  ) VALUES (
    v_actor, p_workspace_id, p_provider, p_model_name,
    p_input_tokens, p_output_tokens, p_duration_ms, COALESCE(p_tool_calls, 0), p_error
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.log_ai_call(
  uuid, public.ai_provider_kind, text, int, int, int, int, text
) TO authenticated;

COMMENT ON FUNCTION public.log_ai_call IS
  'Best-effort Audit-Logging fuer Browser-direct-LLM-Calls. lib/ai-assist.ts ruft das nach jedem Call.';
