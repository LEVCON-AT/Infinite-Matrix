// OpenAI-Provider-Adapter (Welle A.2 Folge).
//
// Endpoint: https://api.openai.com/v1/chat/completions
// Auth: Authorization: Bearer <key>
// Spec: platform.openai.com/docs/api-reference/chat/streaming
//
// Konvertiert unsere AssistMessage / ToolDef in OpenAI-Schema und
// streamt SSE zurueck. Tool-Use-Blocks werden aus delta.tool_calls
// akkumuliert (function.arguments kommt in JSON-Chunks).
//
// Output-Shape ist identisch zu callAnthropicStream — der ai-assist-
// Orchestrator kann beide austauschbar konsumieren.

import type { AssistEvent, AssistMessage, AssistToolUse, ToolDef } from '../types';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MAX_TOKENS = 4096;

type OpenAiToolDef = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolDef['inputSchema'];
  };
};

type OpenAiMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

export type OpenAiCallInput = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: AssistMessage[];
  tools: ReadonlyArray<ToolDef>;
  signal?: AbortSignal;
};

export type OpenAiCallResult = {
  assistantText: string;
  toolUses: AssistToolUse[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
  usage: { inputTokens: number; outputTokens: number } | null;
};

function toOpenAiMessages(systemPrompt: string, messages: AssistMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: 'system', content: systemPrompt }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const msg: OpenAiMessage = { role: 'assistant', content: m.content || null };
      if (m.toolUses && m.toolUses.length > 0) {
        msg.tool_calls = m.toolUses.map((tu) => ({
          id: tu.toolUseId,
          type: 'function',
          function: { name: tu.name, arguments: JSON.stringify(tu.args) },
        }));
      }
      out.push(msg);
    } else {
      // tool_result-message → 'tool' role mit tool_call_id
      const text = m.ok
        ? typeof m.result === 'string'
          ? m.result
          : JSON.stringify(m.result ?? null)
        : `ERROR: ${m.error ?? 'unknown'}`;
      out.push({ role: 'tool', content: text, tool_call_id: m.toolUseId });
    }
  }
  return out;
}

function toOpenAiTools(tools: ReadonlyArray<ToolDef>): OpenAiToolDef[] {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

type StreamState = {
  // Aktive tool_call-Indizes (kommen incremental im stream).
  toolCalls: Map<number, { id: string; name: string; argsBuf: string }>;
  assistantText: string;
  finishReason: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
};

export async function callOpenAiStream(
  input: OpenAiCallInput,
  onEvent: (e: AssistEvent) => void,
): Promise<OpenAiCallResult> {
  const body = {
    model: input.model,
    max_tokens: DEFAULT_MAX_TOKENS,
    messages: toOpenAiMessages(input.systemPrompt, input.messages),
    tools: input.tools.length > 0 ? toOpenAiTools(input.tools) : undefined,
    stream: true,
    stream_options: { include_usage: true },
  };

  const resp = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });

  if (!resp.ok || !resp.body) {
    let errMsg = `OpenAI ${resp.status}`;
    try {
      const j = await resp.json();
      if (j?.error?.message) errMsg = `OpenAI ${resp.status}: ${j.error.message}`;
    } catch {
      // ignore
    }
    onEvent({ type: 'error', message: errMsg });
    throw new Error(errMsg);
  }

  onEvent({ type: 'start', provider: 'openai', model: input.model });

  const state: StreamState = {
    toolCalls: new Map(),
    assistantText: '',
    finishReason: null,
    usage: null,
  };

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let nl = buf.indexOf('\n\n');
      while (nl !== -1) {
        const frame = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        handleSseFrame(frame, state, onEvent);
        nl = buf.indexOf('\n\n');
      }
    }
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    onEvent({ type: 'error', message: msg });
    throw e;
  }

  // Tool-Calls finalisieren — JSON parsen + an Caller emittieren.
  const toolUses: AssistToolUse[] = [];
  for (const tc of state.toolCalls.values()) {
    let args: Record<string, unknown> = {};
    try {
      args = tc.argsBuf ? JSON.parse(tc.argsBuf) : {};
    } catch {
      args = {};
    }
    const tu: AssistToolUse = {
      toolUseId: tc.id,
      name: tc.name,
      args,
    };
    toolUses.push(tu);
    onEvent({ type: 'tool_call', tool: tu.name, toolUseId: tu.toolUseId, args: tu.args });
  }

  // finish_reason mappen.
  let stop: OpenAiCallResult['stopReason'] = 'end_turn';
  if (state.finishReason === 'tool_calls') stop = 'tool_use';
  else if (state.finishReason === 'length') stop = 'max_tokens';

  return {
    assistantText: state.assistantText,
    toolUses,
    stopReason: stop,
    usage: state.usage,
  };
}

function handleSseFrame(
  frame: string,
  state: StreamState,
  onEvent: (e: AssistEvent) => void,
): void {
  // OpenAI sendet "data: <json>" oder "data: [DONE]".
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data || data === '[DONE]') return;

  let chunk: {
    choices?: Array<{
      index?: number;
      delta?: {
        content?: string;
        tool_calls?: Array<{
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    chunk = JSON.parse(data);
  } catch {
    return;
  }

  if (chunk.usage) {
    state.usage = {
      inputTokens: chunk.usage.prompt_tokens ?? 0,
      outputTokens: chunk.usage.completion_tokens ?? 0,
    };
  }

  const choice = chunk.choices?.[0];
  if (!choice) return;

  const delta = choice.delta;
  if (delta?.content) {
    state.assistantText += delta.content;
    onEvent({ type: 'text_delta', text: delta.content });
  }

  if (delta?.tool_calls) {
    for (const tc of delta.tool_calls) {
      const idx = tc.index ?? 0;
      let entry = state.toolCalls.get(idx);
      if (!entry) {
        entry = { id: tc.id ?? `call_${idx}`, name: tc.function?.name ?? '', argsBuf: '' };
        state.toolCalls.set(idx, entry);
      }
      if (tc.id) entry.id = tc.id;
      if (tc.function?.name) entry.name = tc.function.name;
      if (tc.function?.arguments) entry.argsBuf += tc.function.arguments;
    }
  }

  if (choice.finish_reason) {
    state.finishReason = choice.finish_reason;
  }
}
