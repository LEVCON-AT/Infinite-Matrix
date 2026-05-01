// Gemini-Provider-Adapter (Welle A.2 Folge — vollstaendig).
//
// Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/
//           {model}:streamGenerateContent?alt=sse&key={api_key}
// Spec: ai.google.dev/api/generate-content
//
// Schema (anders als Anthropic/OpenAI):
//   - contents: [{role: 'user'|'model', parts: [{text} | {functionCall} | {functionResponse}]}]
//   - tools: [{functionDeclarations: [{name, description, parameters}]}]
//   - systemInstruction: {parts: [{text}]}
//
// Streaming: SSE mit alt=sse Query-Param. data:-Frames mit JSON-Chunks
// die candidates[].content.parts[] mit text-deltas oder functionCall-
// Blocks enthalten. finish_reason via candidates[].finishReason
// (STOP / MAX_TOKENS / SAFETY / TOOL_USE).
//
// Output-Shape ist identisch zu callAnthropicStream / callOpenAiStream
// — der ai-assist-Orchestrator kann austauschbar konsumieren.

import type { AssistEvent, AssistMessage, AssistToolUse, ToolDef } from '../types';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MAX_TOKENS = 4096;

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

type GeminiContent = {
  role: 'user' | 'model';
  parts: GeminiPart[];
};

type GeminiTool = {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: ToolDef['inputSchema'];
  }>;
};

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

function toGeminiContents(messages: AssistMessage[]): GeminiContent[] {
  const out: GeminiContent[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', parts: [{ text: m.content }] });
    } else if (m.role === 'assistant') {
      const parts: GeminiPart[] = [];
      if (m.content) parts.push({ text: m.content });
      if (m.toolUses) {
        for (const tu of m.toolUses) {
          parts.push({ functionCall: { name: tu.name, args: tu.args } });
        }
      }
      out.push({ role: 'model', parts: parts.length > 0 ? parts : [{ text: '' }] });
    } else {
      // tool_result als user-message mit functionResponse-Part
      const ok = m.ok;
      const response: Record<string, unknown> = ok
        ? typeof m.result === 'string'
          ? { result: m.result }
          : ((m.result as Record<string, unknown>) ?? {})
        : { error: m.error ?? 'unknown' };
      out.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              // Gemini matched per name + Position — funktioniert solange
              // wir die FunctionCall-Reihenfolge im History wahren (das ist
              // implizit durch toolUses-Array gegeben).
              name: m.toolUseId.replace(/^call_/, '') || 'tool',
              response,
            },
          },
        ],
      });
    }
  }
  return out;
}

function toGeminiTools(tools: ReadonlyArray<ToolDef>): GeminiTool[] {
  if (tools.length === 0) return [];
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      })),
    },
  ];
}

type StreamState = {
  toolUses: AssistToolUse[];
  assistantText: string;
  finishReason: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
};

export async function callGeminiStream(
  input: GeminiCallInput,
  onEvent: (e: AssistEvent) => void,
): Promise<GeminiCallResult> {
  const url = `${GEMINI_BASE}/${encodeURIComponent(input.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(input.apiKey)}`;
  const body = {
    contents: toGeminiContents(input.messages),
    systemInstruction: { parts: [{ text: input.systemPrompt }] },
    tools: toGeminiTools(input.tools),
    generationConfig: {
      maxOutputTokens: DEFAULT_MAX_TOKENS,
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: input.signal,
  });

  if (!resp.ok || !resp.body) {
    let errMsg = `Gemini ${resp.status}`;
    try {
      const j = await resp.json();
      if (j?.error?.message) errMsg = `Gemini ${resp.status}: ${j.error.message}`;
    } catch {
      // ignore
    }
    onEvent({ type: 'error', message: errMsg });
    throw new Error(errMsg);
  }

  onEvent({ type: 'start', provider: 'gemini', model: input.model });

  const state: StreamState = {
    toolUses: [],
    assistantText: '',
    finishReason: null,
    usage: null,
  };

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let toolCallCounter = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let nl = buf.indexOf('\n\n');
      while (nl !== -1) {
        const frame = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        toolCallCounter = handleSseFrame(frame, state, onEvent, toolCallCounter);
        nl = buf.indexOf('\n\n');
      }
    }
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    onEvent({ type: 'error', message: msg });
    throw e;
  }

  // finish_reason mappen.
  let stop: GeminiCallResult['stopReason'] = 'end_turn';
  if (state.toolUses.length > 0) stop = 'tool_use';
  else if (state.finishReason === 'MAX_TOKENS') stop = 'max_tokens';

  return {
    assistantText: state.assistantText,
    toolUses: state.toolUses,
    stopReason: stop,
    usage: state.usage,
  };
}

function handleSseFrame(
  frame: string,
  state: StreamState,
  onEvent: (e: AssistEvent) => void,
  toolCallCounter: number,
): number {
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return toolCallCounter;

  let chunk: {
    candidates?: Array<{
      content?: { role?: string; parts?: GeminiPart[] };
      finishReason?: string;
    }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  try {
    chunk = JSON.parse(data);
  } catch {
    return toolCallCounter;
  }

  if (chunk.usageMetadata) {
    state.usage = {
      inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
      outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
    };
  }

  const cand = chunk.candidates?.[0];
  if (!cand) return toolCallCounter;

  const parts = cand.content?.parts ?? [];
  let counter = toolCallCounter;
  for (const part of parts) {
    if ('text' in part && part.text) {
      state.assistantText += part.text;
      onEvent({ type: 'text_delta', text: part.text });
    } else if ('functionCall' in part && part.functionCall) {
      counter += 1;
      const fc = part.functionCall;
      const tu: AssistToolUse = {
        toolUseId: `call_${counter}`,
        name: fc.name,
        args: fc.args ?? {},
      };
      state.toolUses.push(tu);
      onEvent({ type: 'tool_call', tool: tu.name, toolUseId: tu.toolUseId, args: tu.args });
    }
  }

  if (cand.finishReason) {
    state.finishReason = cand.finishReason;
  }
  return counter;
}
