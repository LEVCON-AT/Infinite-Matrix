// Audit-Helper — best-effort Insert in ai_call_log via log_ai_call-RPC
// (Migration 022). Promptinj-Mitigation I: jeder LLM-Call landet im
// Log mit Token-Counts + Tool-Calls + ggf. Error.
//
// Best-effort: bei Fehler nur console.warn, kein Throw — der Audit-
// Log darf den eigentlichen Pipe-Lauf nie blockieren.

import { supabase } from '../supabase';
import type { AiProviderKind } from '../types';

export type LogAiCallInput = {
  workspaceId: string | null;
  provider: AiProviderKind;
  modelName: string;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
  toolCalls: number;
  error: string | null;
};

export async function logAiCall(input: LogAiCallInput): Promise<void> {
  try {
    const { error } = await supabase.rpc('log_ai_call', {
      p_workspace_id: input.workspaceId,
      p_provider: input.provider,
      p_model_name: input.modelName || null,
      p_input_tokens: input.inputTokens ?? 0,
      p_output_tokens: input.outputTokens ?? 0,
      p_duration_ms: input.durationMs,
      p_tool_calls: input.toolCalls,
      p_error: input.error,
    });
    if (error) {
      console.warn('logAiCall RPC fehlgeschlagen:', error);
    }
  } catch (e) {
    console.warn('logAiCall threw:', e);
  }
}
