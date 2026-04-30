// AiHelpDrawer — Inline-Help-Drawer fuer A.3.
//
// Drawer rechts ausklappbar. Toggle ueber Header-Button (Sparkles)
// oder Ctrl+K-Hotkey (siehe lib/ai-help-state.ts).
//
// Renders eine Chat-View mit Streaming, Tool-Call-Indikatoren und
// Live-Tool-Counter (Promptinj-Mitigation K). Bei foreign-Cells in
// Multi-Member-Workspaces wird der Read-Only-Modus aktiviert
// (Mitigation G); destructive Tools haben Confirm-Modal vor RPC-
// Call (Mitigation C).
//
// Lebt in App.tsx, also workspace-agnostisch — workspace_id wird via
// useParams gelesen. Wenn keine workspace_id da: leerer Drawer mit
// Hinweis "Bitte Workspace oeffnen".

import { useLocation, useParams } from '@solidjs/router';
import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { runAssist } from '../lib/ai-assist';
import type { AssistEvent, AssistMessage } from '../lib/ai-assist';
import { closeDrawer, toggleDrawer, useDrawerOpen } from '../lib/ai-help-state';
import { useUser } from '../lib/auth';
import { installFocusRestore, showConfirm } from '../lib/dialog';
import { fetchMembers } from '../lib/members';
import { fetchNodesForWorkspace } from '../lib/queries';
import { showToast } from '../lib/toasts';
import Icon from './Icon';

// ─── Drawer-State ────────────────────────────────────────────
// Wir haelten messages + active tool calls als Solid-Signals, damit
// der Stream direkt re-rendert.

type ChatMessage =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; toolCalls: ChatToolCall[] }
  | { kind: 'system'; text: string };

type ChatToolCall = {
  toolUseId: string;
  name: string;
  status: 'pending' | 'ok' | 'error';
  errorMsg?: string;
};

const AiHelpDrawer: Component = () => {
  const open = useDrawerOpen;
  const params = useParams<{ workspaceId?: string }>();
  const location = useLocation();
  const user = useUser();

  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = createSignal('');
  const [activeTools, setActiveTools] = createSignal<ChatToolCall[]>([]);
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [toolCount, setToolCount] = createSignal(0);
  const [input, setInput] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [readOnly, setReadOnly] = createSignal(false);
  const [readOnlyForced, setReadOnlyForced] = createSignal(false); // Mitigation G

  let abortCtrl: AbortController | null = null;
  let scrollerEl: HTMLDivElement | undefined;
  let inputEl: HTMLTextAreaElement | undefined;
  let restoreFocus: (() => void) | null = null;

  // Cap pro Mode (matcht ITER_CAP in lib/ai-assist/index.ts)
  const ITER_CAP_HELP = 10;

  // ─── Read-Only-Detection (Mitigation G) ─────────────────────
  // Beim Drawer-Open: pruefen ob aktueller Knoten von anderem User
  // ist UND Workspace > 2 Mitglieder. Wenn ja → readOnlyForced=true,
  // User muss explicit "Action-Mode" aktivieren.
  //
  // AU-B1 K7 (B1-H-003 / B1-H-010): Effect liest jetzt zusaetzlich
  // location.pathname reaktiv (vorher nur open()), damit Navigation
  // bei offenem Drawer den Read-Only-State neu evaluiert. Plus
  // Mount-Check nach await — bei schnellem Toggle/Workspace-Wechsel
  // werden Signale eines bereits-geschlossenen Drawer-Renders nicht
  // mehr ueberschrieben.
  createEffect(() => {
    if (!open()) return;
    const wsId = params.workspaceId;
    if (!wsId) return;
    const selfId = user()?.id ?? null;
    if (!selfId) return;
    // Reaktiv: location.pathname auch lesen, damit Navigation den
    // Effect neu triggert.
    const path = location.pathname;
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    void (async () => {
      try {
        const nodeId = extractNodeIdFromPath(path);
        if (cancelled) return;
        if (!nodeId) {
          setReadOnlyForced(false);
          setReadOnly(false);
          return;
        }
        const nodes = await fetchNodesForWorkspace(wsId);
        if (cancelled) return;
        const node = nodes.find((n: { id: string }) => n.id === nodeId);
        if (!node || !node.created_by || node.created_by === selfId) {
          setReadOnlyForced(false);
          setReadOnly(false);
          return;
        }
        const members = await fetchMembers(wsId);
        if (cancelled) return;
        const activeCount = members.filter((m) => !m.deactivated_at).length;
        const force = activeCount > 2;
        setReadOnlyForced(force);
        setReadOnly(force);
      } catch {
        if (cancelled) return;
        setReadOnlyForced(true);
        setReadOnly(true);
      }
    })();
  });

  // ─── Auto-scroll ans Ende ───────────────────────────────────
  createEffect(() => {
    void messages();
    void streamingText();
    void activeTools();
    if (!scrollerEl) return;
    queueMicrotask(() => {
      scrollerEl?.scrollTo({ top: scrollerEl.scrollHeight, behavior: 'smooth' });
    });
  });

  // ─── Focus-Restore wenn Drawer geoeffnet/geschlossen ─────────
  createEffect(() => {
    if (open()) {
      // Drawer offen → Fokus aufs Input
      restoreFocus = installFocusRestore();
      queueMicrotask(() => inputEl?.focus());
    } else {
      // Drawer zu → vorherigen Fokus wiederherstellen
      restoreFocus?.();
      restoreFocus = null;
    }
  });

  // AU-B1 K7 (B1-D-004): ESC-Handler in Capture-Phase, schliesst den
  // Drawer wenn er offen ist. stopImmediatePropagation verhindert dass
  // ein anderer ESC-Handler (z.B. Matrix-Navigation) das Event mit-
  // schluckt. Der Handler ist nur registriert wenn open() — sonst
  // koennte ESC auf der Hauptseite andere ESC-konsumierende Modals
  // stoeren.
  createEffect(() => {
    if (!open()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      closeDrawer();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  onMount(() => {
    onCleanup(() => {
      // AU-B1 K7 (B1-D-004): nur restoreFocus wenn noch nicht durch
      // den open()-Effect geschlossen-Pfad aufgerufen.
      if (restoreFocus !== null) {
        restoreFocus();
        restoreFocus = null;
      }
      abortCtrl?.abort();
    });
  });

  // ─── Send-Handler ────────────────────────────────────────────
  const send = async () => {
    const text = input().trim();
    if (!text || isStreaming()) return;
    const wsId = params.workspaceId;
    if (!wsId) {
      showToast('Bitte zuerst einen Workspace oeffnen.', 'error');
      return;
    }

    setError(null);
    // AU-B1 K4 (B1-D-002 / B1-H-004): Conversation-Snapshot VOR dem
    // setMessages bauen, sonst wird die neue User-Message doppelt
    // angehaengt (einmal im setMessages, einmal in der for-Loop, weil
    // messages() den aktualisierten Wert liefert). Konsequenz war:
    // Anthropic-API bekam die letzte User-Message zweimal.
    const prevMessages = messages();
    const conversation: AssistMessage[] = [];
    for (const m of prevMessages) {
      if (m.kind === 'user') conversation.push({ role: 'user', content: m.text });
      else if (m.kind === 'assistant') conversation.push({ role: 'assistant', content: m.text });
    }
    conversation.push({ role: 'user', content: text });

    setMessages((prev) => [...prev, { kind: 'user', text }]);
    setInput('');
    setStreamingText('');
    setActiveTools([]);
    setToolCount(0);
    setIsStreaming(true);
    abortCtrl = new AbortController();

    // Mitigation E: Context-Snapshot kompakt aufbauen (kein
    // Workspace-Inhalt — der LLM kann mcp_get_workspace_context
    // selber rufen).
    const ctxParts: string[] = [`Aktueller Workspace: ${wsId}`];
    const cellId = extractCellIdFromPath(location.pathname);
    const nodeId = extractNodeIdFromPath(location.pathname);
    if (nodeId) ctxParts.push(`Aktueller Knoten: ${nodeId}`);
    if (cellId) ctxParts.push(`Aktuelle Zelle: ${cellId}`);
    if (readOnly()) ctxParts.push('Hinweis: Read-Only-Modus aktiv — keine Tool-Calls erlaubt.');
    const contextSnapshot = ctxParts.join('\n');

    // Confirm-Pattern fuer destructive Tools (Mitigation C).
    const confirmDestructive = async (toolName: string, args: Record<string, unknown>) => {
      const ok = await showConfirm({
        title: 'Aktion bestaetigen',
        message: `Die KI moechte "${toolName}" ausfuehren mit folgenden Argumenten:\n\n${JSON.stringify(args, null, 2)}\n\nAusfuehren?`,
        variant: 'danger',
        confirmLabel: 'Ja, ausfuehren',
        cancelLabel: 'Abbrechen',
      });
      return ok;
    };

    try {
      await runAssist({
        mode: 'help',
        workspaceId: wsId,
        messages: conversation,
        contextSnapshot,
        confirmDestructive,
        readOnly: readOnly(),
        signal: abortCtrl.signal,
        onEvent: handleEvent,
      });
    } catch (e) {
      // AU-B1 K4 (B1-H-001): User-Cancel via abortCtrl.abort() wirft
      // einen DOMException 'AbortError' — das ist eine bewusste User-
      // Aktion, kein Systemfehler. Silent-stop statt Error-Toast.
      if ((e as Error).name === 'AbortError') {
        // nichts tun — finally-Block flush'ed Streaming-Text + Tools
      } else {
        console.error('runAssist threw:', e);
        setError((e as Error).message ?? String(e));
      }
    } finally {
      // Final-Flush: streaming-text + tool-calls in messages packen.
      const finalText = streamingText();
      const finalTools = activeTools();
      if (finalText.length > 0 || finalTools.length > 0) {
        setMessages((prev) => [
          ...prev,
          { kind: 'assistant', text: finalText, toolCalls: finalTools },
        ]);
      }
      setStreamingText('');
      setActiveTools([]);
      setIsStreaming(false);
      abortCtrl = null;
    }
  };

  const handleEvent = (e: AssistEvent) => {
    switch (e.type) {
      case 'start':
        setStreamingText('');
        setActiveTools([]);
        setError(null);
        break;
      case 'text_delta':
        setStreamingText((prev) => prev + e.text);
        break;
      case 'tool_call':
        setActiveTools((prev) => [
          ...prev,
          { toolUseId: e.toolUseId, name: e.tool, status: 'pending' },
        ]);
        setToolCount((c) => c + 1);
        break;
      case 'tool_result':
        setActiveTools((prev) =>
          prev.map((t) =>
            t.toolUseId === e.toolUseId
              ? { ...t, status: e.ok ? 'ok' : 'error', errorMsg: e.error }
              : t,
          ),
        );
        break;
      case 'iter_cap':
        showToast(
          `KI hat das Iterations-Limit (${e.cap}) erreicht. Bitte praezisiere die Anfrage.`,
          'info',
        );
        break;
      case 'error':
        setError(e.message);
        break;
      case 'done':
        // Stop-reason wird im finally-Block gehandhabt.
        break;
    }
  };

  const cancel = () => {
    abortCtrl?.abort();
  };

  const reset = () => {
    setMessages([]);
    setStreamingText('');
    setActiveTools([]);
    setError(null);
    setToolCount(0);
  };

  const onInputKey = (e: KeyboardEvent) => {
    // Cmd/Ctrl+Enter sendet
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void send();
    }
  };

  const wsId = createMemo(() => params.workspaceId);
  const noWorkspace = () => !wsId();

  return (
    <Show when={open()}>
      <aside class="ai-help-drawer" aria-label="KI-Hilfe">
        <header class="ai-help-head">
          <span class="ai-help-title">
            <Icon name="sparkles" size={16} />
            <span>KI-Hilfe</span>
          </span>
          <Show when={readOnlyForced()}>
            <button
              type="button"
              class="ai-help-mode-toggle"
              onClick={() => setReadOnly((v) => !v)}
              title={
                readOnly()
                  ? 'Aktion-Modus aktivieren (Tool-Calls erlauben)'
                  : 'Read-Only-Modus aktivieren'
              }
            >
              {readOnly() ? '🔒 Read-Only' : '⚡ Action'}
            </button>
          </Show>
          <button
            type="button"
            class="ai-help-close"
            onClick={() => closeDrawer()}
            aria-label="Schliessen"
          >
            <Icon name="x" size={16} />
          </button>
        </header>

        <Show when={readOnlyForced() && readOnly()}>
          <div class="ai-help-banner ai-help-banner-warn">
            <Icon name="lock-closed" size={12} />
            <span>
              Du bist auf einem Knoten den ein anderes Mitglied erstellt hat. Tool-Calls sind aus
              Sicherheitsgruenden deaktiviert. "Action" oben rechts klicken um sie freizuschalten.
            </span>
          </div>
        </Show>

        <Show when={noWorkspace()}>
          <div class="ai-help-empty">
            <Icon name="information-circle" size={20} />
            <p>Bitte zuerst einen Workspace oeffnen.</p>
          </div>
        </Show>

        <Show when={!noWorkspace()}>
          <div
            class="ai-help-body"
            ref={(el) => {
              scrollerEl = el;
            }}
          >
            {/* AU-B1 K7 (B1-D-005 / B1-H-004): EIN For-Loop in
                Konversations-Reihenfolge. Vorher zwei separate Loops
                (User dann Assistant) brachen den DOM-Order — Chat zeigte
                erst alle Fragen, dann alle Antworten als Block. */}
            <For each={messages()}>
              {(m) => (
                <>
                  <Show when={m.kind === 'user' ? (m as { text: string }) : null}>
                    {(u) => <div class="ai-help-msg ai-help-msg-user">{u().text}</div>}
                  </Show>
                  <Show
                    when={
                      m.kind === 'assistant'
                        ? (m as { text: string; toolCalls: ChatToolCall[] })
                        : null
                    }
                  >
                    {(am) => (
                      <div class="ai-help-msg ai-help-msg-assistant">
                        <Show when={am().text}>
                          <div class="ai-help-msg-text">{am().text}</div>
                        </Show>
                        <For each={am().toolCalls}>
                          {(tc) => (
                            <div class={`ai-help-tool ai-help-tool-${tc.status}`}>
                              <Icon
                                name={
                                  tc.status === 'ok'
                                    ? 'check-circle'
                                    : tc.status === 'error'
                                      ? 'x-circle'
                                      : 'arrow-path'
                                }
                                size={12}
                              />
                              <span class="ai-help-tool-name">{tc.name}</span>
                              <Show when={tc.errorMsg}>
                                <span class="ai-help-tool-err">— {tc.errorMsg}</span>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    )}
                  </Show>
                </>
              )}
            </For>
            <Show when={isStreaming()}>
              <div class="ai-help-msg ai-help-msg-assistant ai-help-msg-streaming">
                <Show when={streamingText()}>
                  <div class="ai-help-msg-text">{streamingText()}</div>
                </Show>
                <For each={activeTools()}>
                  {(tc) => (
                    <div class={`ai-help-tool ai-help-tool-${tc.status}`}>
                      <Icon
                        name={
                          tc.status === 'ok'
                            ? 'check-circle'
                            : tc.status === 'error'
                              ? 'x-circle'
                              : 'arrow-path'
                        }
                        size={12}
                      />
                      <span class="ai-help-tool-name">{tc.name}</span>
                    </div>
                  )}
                </For>
                <div class="ai-help-streaming-dot">…</div>
              </div>
            </Show>
            <Show when={error()}>
              <div class="ai-help-banner ai-help-banner-error">
                <Icon name="x-circle" size={12} />
                <span>{error()}</span>
              </div>
            </Show>
          </div>

          <Show when={isStreaming()}>
            <div class="ai-help-status">
              <span class="ai-help-status-counter">
                Tool {toolCount()} / {ITER_CAP_HELP}
              </span>
              <button type="button" class="btn-c btn-small" onClick={cancel}>
                Abbrechen
              </button>
            </div>
          </Show>

          <form
            class="ai-help-form"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              ref={(el) => {
                inputEl = el;
              }}
              class="ai-help-input"
              value={input()}
              onInput={(e) => setInput(e.currentTarget.value)}
              onKeyDown={onInputKey}
              placeholder="Frag mich was — Cmd/Ctrl+Enter zum Senden"
              rows={2}
              disabled={isStreaming()}
              maxlength={4000}
            />
            <div class="ai-help-form-actions">
              <button
                type="button"
                class="btn-subtle btn-small"
                onClick={reset}
                disabled={isStreaming() || messages().length === 0}
              >
                Verlauf loeschen
              </button>
              <button
                type="submit"
                class="btn-p btn-small"
                disabled={isStreaming() || !input().trim()}
              >
                Senden
              </button>
            </div>
          </form>
        </Show>
      </aside>
    </Show>
  );
};

export default AiHelpDrawer;

// ─── Helpers ────────────────────────────────────────────────
function extractNodeIdFromPath(pathname: string): string | null {
  const m = pathname.match(/\/n\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

function extractCellIdFromPath(pathname: string): string | null {
  const m = pathname.match(/\/c\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

// Public Toggle-Button-Component fuer die Workspace-Header-Zeile.
export const AiHelpDrawerToggle: Component = () => {
  return (
    <button
      type="button"
      class="ai-help-toggle"
      onClick={() => toggleDrawer()}
      title="KI-Hilfe oeffnen (Ctrl+K)"
      aria-label="KI-Hilfe oeffnen"
    >
      <Icon name="sparkles" size={14} />
    </button>
  );
};
