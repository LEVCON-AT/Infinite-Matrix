// AI-Assist — Shared Types fuer Phase 2 Welle A.2.
//
// Browser-direct LLM-Pipe (siehe docs/plan-user-backend.md). Diese
// Types werden von providers/anthropic.ts (spaeter openai/gemini),
// tools.ts, system-prompt.ts und index.ts gemeinsam benutzt.

import type { AiProviderKind } from '../types';

// ─── Modes ─────────────────────────────────────────────────────
// Pro Mode unterschiedliche Tool-Allowlist, Context-Min und System-
// Prompt (siehe Plan, Promptinj-Mitigationen B/E/F).
//
//   wizard       — Onboarding-Wizard (A.4): NUR creates, kein
//                  Workspace-Inhalt im Context (Mitigation E).
//   help         — Inline-Help-Drawer (A.3): alle Tools, destructive
//                  mit Confirm-Modal (kommt mit A.3-UI).
//   cell-suggest — Mini-Modal in leerer Cell (A.6): scoped auf
//                  diese eine Cell + Parent-Knoten.
export type AssistMode = 'wizard' | 'help' | 'cell-suggest';

// ─── Tool-Definitionen ────────────────────────────────────────
// Eine ToolDef beschreibt EINEN MCP-Tool-RPC (z.B. mcp_create_node)
// in einer Form die LLM-Provider verstehen UND die das Frontend zum
// supabase.rpc-Dispatch nutzen kann.
//
// risk_level steuert ob die Mitigation C (Confirm-Modal) eingreift.
// "destructive" → Frontend faengt den tool_use ab, oeffnet Modal,
// ruft den RPC erst nach User-Bestaetigung. "safe" → direkter Call.
//
// allowedInModes ist die Promptinj-Mitigation B: pro Mode nur eine
// Subset der Tools.
export type ToolRiskLevel = 'safe' | 'destructive';

export type ToolDef = {
  name: string; // 'mcp_create_node'
  description: string; // fuer LLM-Tool-Liste
  // Anthropic-/OpenAI-/Gemini-kompatibles JSON-Schema fuer Tool-Args.
  // input_schema in Anthropic-Sprech, parameters in OpenAI/Gemini —
  // wir nutzen Anthropic-Naming, Adapter konvertieren bei Bedarf.
  inputSchema: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
  riskLevel: ToolRiskLevel;
  allowedInModes: AssistMode[];
};

export type JsonSchemaProperty = {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'null' | Array<'string' | 'null'>;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
};

// ─── Events vom Provider-Adapter (SSE-Stream) ─────────────────
// Der Adapter normalisiert den Provider-Stream zu diesen Events.
// runAssist konsumiert die und reicht sie an onEvent-Callback weiter
// (Mitigation K Live-Tool-Counter im UI).

export type AssistEvent =
  // Provider hat angefangen — message_start im Anthropic-Stream.
  | { type: 'start'; provider: AiProviderKind; model: string }
  // Text-Delta (incremental Content). Frontend kann das streamen.
  | { type: 'text_delta'; text: string }
  // LLM hat beschlossen einen Tool-Call zu machen. Args sind komplett
  // (input_json_delta wurde aufgesammelt). runAssist ruft jetzt den
  // RPC.
  | { type: 'tool_call'; tool: string; toolUseId: string; args: Record<string, unknown> }
  // Tool-Result eingespeist (nach RPC-Call). Frontend kann den
  // Status anzeigen.
  | {
      type: 'tool_result';
      tool: string;
      toolUseId: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }
  // Iter-Cap-Warnung — wenn der Loop seine 10/50-Grenze erreicht.
  | { type: 'iter_cap'; reached: number; cap: number }
  // Finales Done — runAssist returns danach.
  | {
      type: 'done';
      stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'iter_cap' | 'error';
      usage?: TokenUsage;
    }
  // Error im LLM-Call selbst (Netz, 401, Quota). runAssist returns.
  | { type: 'error'; message: string };

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

// ─── Conversation-Messages ────────────────────────────────────
// LLM-providerneutrale Message-Struktur. Adapter-spezifische Felder
// (z.B. Anthropic-content-blocks) werden im Adapter aufgebaut.

export type AssistMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolUses?: AssistToolUse[] }
  | { role: 'tool_result'; toolUseId: string; ok: boolean; result?: unknown; error?: string };

export type AssistToolUse = {
  toolUseId: string;
  name: string;
  args: Record<string, unknown>;
};

// ─── runAssist-Optionen ───────────────────────────────────────

export type RunAssistOptions = {
  mode: AssistMode;
  // workspace_id ist Pflicht ausser im Wizard (da hat User noch keinen).
  // null = Wizard-Bootstrap (mode='wizard'). Sonst: aktueller Workspace.
  workspaceId: string | null;
  // Conversation-History. Erste Message muss role='user' sein.
  messages: AssistMessage[];
  // Optionale Context-Daten die als zusaetzliche user-message vorne
  // eingefuegt werden (Promptinj-sicher: nicht im system-prompt).
  // help: aktuelle Cell + sichtbare Karten. cell-suggest: cell-Label.
  // wizard: nur Wizard-Antworten — kein workspace_context (Mitigation E).
  contextSnapshot?: string;
  // Callback fuer Live-Updates (Mitigation K). Der UI-Layer rendert
  // damit Streaming-Text + Tool-Counter + Cancel-Button.
  onEvent: (e: AssistEvent) => void;
  // AbortController.signal um vom UI aus abzubrechen.
  signal?: AbortSignal;
  // Promptinj-Mitigation C: vor jedem destructive-Tool-Aufruf wird
  // dieser Callback gerufen. Returnt true → ausfuehren, false →
  // ablehnen mit Error an LLM. UI-Layer rendert ein Confirm-Modal.
  // Wenn nicht gesetzt: destructive Tools werden hart abgelehnt.
  confirmDestructive?: (toolName: string, args: Record<string, unknown>) => Promise<boolean>;
  // Promptinj-Mitigation G: Read-Only-Modus. Wenn true werden ALLE
  // Tool-Calls abgelehnt — der LLM darf nur antworten, nichts tun.
  // Drawer-UI setzt das wenn die aktuelle Cell von einem anderen
  // User in einem Multi-Member-Workspace stammt.
  readOnly?: boolean;
};
