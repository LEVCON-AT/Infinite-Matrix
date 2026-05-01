// Gemini-Provider-Adapter (Welle A.2 Folge — Stub).
//
// Endpoint: https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent
// Auth: ?key=<api_key> als URL-Param ODER Authorization-Bearer (V2)
// Spec: ai.google.dev/api/generate-content
//
// Gemini-Schema unterscheidet sich substantiell von Anthropic/OpenAI:
//   - contents: [{role, parts: [{text} | {functionCall} | {functionResponse}]}]
//   - tools: [{functionDeclarations: [{name, description, parameters}]}]
//   - Stream: SSE mit data:-Frames; chunks haben candidates[].content.parts
//
// V1 Stub: wirft klaren Error wenn aufgerufen. Wer Gemini wirklich
// braucht, implementiert hier die toGeminiContents/fromGeminiResponse-
// Mapper analog zu providers/openai.ts.

import type { AssistEvent, AssistMessage, AssistToolUse, ToolDef } from '../types';

export type GeminiCallInput = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: AssistMessage[];
  tools: ReadonlyArray<ToolDef>;
  signal?: AbortSignal;
};

export type GeminiCallResult = {
  assistantText: string;
  toolUses: AssistToolUse[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
  usage: { inputTokens: number; outputTokens: number } | null;
};

export async function callGeminiStream(
  _input: GeminiCallInput,
  onEvent: (e: AssistEvent) => void,
): Promise<GeminiCallResult> {
  const msg =
    'Gemini-Adapter ist noch nicht implementiert. Bitte unter Settings → Konto → AI-Anbindung den Standard auf Anthropic oder OpenAI stellen.';
  onEvent({ type: 'error', message: msg });
  throw new Error(msg);
}
