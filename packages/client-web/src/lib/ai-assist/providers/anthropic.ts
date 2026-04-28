// Anthropic-Provider-Adapter — Browser-direct mit
// `anthropic-dangerous-direct-browser-access: true`-Header.
//
// API-Endpoint: https://api.anthropic.com/v1/messages
// Spec: https://docs.anthropic.com/en/api/messages-streaming
//
// Streaming-Events (SSE):
//   event: message_start
//   event: content_block_start  (text oder tool_use)
//   event: content_block_delta  (text_delta oder input_json_delta)
//   event: content_block_stop
//   event: message_delta        (mit stop_reason + usage)
//   event: message_stop
//
// Wir konvertieren das zu unseren AssistEvents. Tool-Use-Blocks werden
// akkumuliert: input_json_delta liefert chunks von JSON, content_block_
// stop heisst der tool_use-Block ist komplett — dann emittieren wir
// ein einziges 'tool_call'-Event mit den vollstaendigen Args.
//
// Das hier ist EIN Outbound-Call an Anthropic. Der Tool-Use-Loop
// (mehrere LLM-Aufrufe nach jedem tool_result) lebt in index.ts —
// dieser Adapter weiss nichts davon.

import type { AssistEvent, AssistMessage, AssistToolUse, ToolDef } from '../types';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096;

type AnthropicTool = {
  name: string;
  description: string;
  input_schema: ToolDef['inputSchema'];
};

type AnthropicMessage = {
  role: 'user' | 'assistant';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
        | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
      >;
};

export type AnthropicCallInput = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: AssistMessage[];
  tools: ReadonlyArray<ToolDef>;
  signal?: AbortSignal;
};

// Konvertiere unsere AssistMessage zu Anthropic-Message-Shape.
// - 'user'/'assistant' direkt 1:1.
// - 'tool_result' wird zu user-message mit content-Block tool_result
//   (das ist Anthropic-Convention).
function toAnthropicMessages(messages: AssistMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const blocks: AnthropicMessage['content'] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      if (m.toolUses) {
        for (const tu of m.toolUses) {
          blocks.push({ type: 'tool_use', id: tu.toolUseId, name: tu.name, input: tu.args });
        }
      }
      out.push({ role: 'assistant', content: blocks.length === 0 ? '' : blocks });
    } else {
      // tool_result: wird als user-message gepackt
      const text = m.ok
        ? typeof m.result === 'string'
          ? m.result
          : JSON.stringify(m.result ?? null)
        : `ERROR: ${m.error ?? 'unknown'}`;
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.toolUseId,
            content: text,
            is_error: !m.ok,
          },
        ],
      });
    }
  }
  return out;
}

function toAnthropicTools(tools: ReadonlyArray<ToolDef>): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  }));
}

// Streaming-State pro Call.
type StreamState = {
  // Aktive content_blocks per index. Bei content_block_start wird der
  // Index registriert; delta-Events fuegen Daten an; content_block_stop
  // emittiert das fertige Event und entfernt den Block.
  blocks: Map<
    number,
    { type: 'text' | 'tool_use'; toolUseId?: string; toolName?: string; jsonBuf?: string }
  >;
  // Akkumulierte assistant-tool-Uses fuer Caller (return-Wert).
  toolUses: AssistToolUse[];
  // Akkumulierter Text fuer den Caller (final assistant-message).
  assistantText: string;
  // Stop-reason aus message_delta.
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error' | null;
  // Token-Usage aus message_delta.
  usage: { inputTokens: number; outputTokens: number } | null;
};

export type AnthropicCallResult = {
  assistantText: string;
  toolUses: AssistToolUse[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error';
  usage: { inputTokens: number; outputTokens: number } | null;
};

export async function callAnthropicStream(
  input: AnthropicCallInput,
  onEvent: (e: AssistEvent) => void,
): Promise<AnthropicCallResult> {
  const body = {
    model: input.model,
    max_tokens: DEFAULT_MAX_TOKENS,
    system: input.systemPrompt,
    messages: toAnthropicMessages(input.messages),
    tools: toAnthropicTools(input.tools),
    stream: true,
  };

  const resp = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': input.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });

  if (!resp.ok || !resp.body) {
    let errMsg = `Anthropic ${resp.status}`;
    try {
      const j = await resp.json();
      if (j?.error?.message) errMsg = `Anthropic ${resp.status}: ${j.error.message}`;
    } catch {
      // ignore parse-fail
    }
    onEvent({ type: 'error', message: errMsg });
    throw new Error(errMsg);
  }

  onEvent({ type: 'start', provider: 'anthropic', model: input.model });

  const state: StreamState = {
    blocks: new Map(),
    toolUses: [],
    assistantText: '',
    stopReason: null,
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

      // SSE-Frames sind durch \n\n getrennt. Innerhalb eines Frames:
      //   event: <name>\n
      //   data: <json>\n
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

  return {
    assistantText: state.assistantText,
    toolUses: state.toolUses,
    stopReason: state.stopReason ?? 'end_turn',
    usage: state.usage,
  };
}

function handleSseFrame(
  frame: string,
  state: StreamState,
  onEvent: (e: AssistEvent) => void,
): void {
  // event: foo\ndata: {...}
  let event = '';
  let data = '';
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!event || !data) return;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(data);
  } catch {
    return;
  }

  switch (event) {
    case 'message_start': {
      // payload.message.usage.input_tokens existiert hier schon
      const m = payload.message as
        | { usage?: { input_tokens?: number; output_tokens?: number } }
        | undefined;
      if (m?.usage) {
        state.usage = {
          inputTokens: m.usage.input_tokens ?? 0,
          outputTokens: m.usage.output_tokens ?? 0,
        };
      }
      break;
    }
    case 'content_block_start': {
      const idx = payload.index as number;
      const block = payload.content_block as
        | { type: 'text'; text?: string }
        | { type: 'tool_use'; id: string; name: string; input?: Record<string, unknown> }
        | undefined;
      if (!block) break;
      if (block.type === 'text') {
        state.blocks.set(idx, { type: 'text' });
      } else if (block.type === 'tool_use') {
        state.blocks.set(idx, {
          type: 'tool_use',
          toolUseId: block.id,
          toolName: block.name,
          jsonBuf: '',
        });
      }
      break;
    }
    case 'content_block_delta': {
      const idx = payload.index as number;
      const delta = payload.delta as
        | { type: string; text?: string; partial_json?: string }
        | undefined;
      const blk = state.blocks.get(idx);
      if (!blk || !delta) break;
      if (delta.type === 'text_delta' && delta.text) {
        state.assistantText += delta.text;
        onEvent({ type: 'text_delta', text: delta.text });
      } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
        blk.jsonBuf = (blk.jsonBuf ?? '') + delta.partial_json;
      }
      break;
    }
    case 'content_block_stop': {
      const idx = payload.index as number;
      const blk = state.blocks.get(idx);
      if (!blk) break;
      if (blk.type === 'tool_use' && blk.toolUseId && blk.toolName) {
        let args: Record<string, unknown> = {};
        if (blk.jsonBuf && blk.jsonBuf.length > 0) {
          try {
            args = JSON.parse(blk.jsonBuf) as Record<string, unknown>;
          } catch {
            // Defekte Args — wir signalisieren den Tool-Call trotzdem,
            // der Dispatcher wird einen Args-Validation-Error werfen
            // den der LLM als tool_result sieht.
            args = {};
          }
        }
        state.toolUses.push({ toolUseId: blk.toolUseId, name: blk.toolName, args });
        onEvent({
          type: 'tool_call',
          tool: blk.toolName,
          toolUseId: blk.toolUseId,
          args,
        });
      }
      state.blocks.delete(idx);
      break;
    }
    case 'message_delta': {
      const delta = payload.delta as { stop_reason?: string } | undefined;
      const usage = payload.usage as { output_tokens?: number } | undefined;
      if (delta?.stop_reason) {
        const sr = delta.stop_reason;
        state.stopReason =
          sr === 'end_turn'
            ? 'end_turn'
            : sr === 'tool_use'
              ? 'tool_use'
              : sr === 'max_tokens'
                ? 'max_tokens'
                : 'error';
      }
      if (usage?.output_tokens != null && state.usage) {
        state.usage.outputTokens = usage.output_tokens;
      }
      break;
    }
    case 'message_stop':
      // Final — kein eigenes Event hier, weil index.ts den Loop steuert.
      break;
    case 'error': {
      const err = payload.error as { message?: string } | undefined;
      const msg = err?.message ?? 'Anthropic-Stream-Error';
      onEvent({ type: 'error', message: msg });
      state.stopReason = 'error';
      break;
    }
  }
}
