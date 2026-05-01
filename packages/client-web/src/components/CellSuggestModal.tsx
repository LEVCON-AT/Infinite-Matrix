// CellSuggest-Modal (A.6 Skeleton). Ruft AI-Assist mit mode='cell-
// suggest' auf, dispatcht mcp_create_*-Tools direkt (kein Confirm —
// User hat den Vorschlag explizit angefordert).

import { type Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { runAssist } from '../lib/ai-assist';
import type { AssistEvent } from '../lib/ai-assist/types';
import { closeCellSuggest, onCellSuggestRequest } from '../lib/cell-suggest';
import { showToast } from '../lib/toasts';

type Phase = 'idle' | 'streaming' | 'done' | 'error';

const CellSuggestModal: Component = () => {
  const [active, setActive] = createSignal<{
    workspaceId: string;
    parentCellId: string | null;
    parentLabel: string;
  } | null>(null);
  const [prompt, setPrompt] = createSignal('');
  const [phase, setPhase] = createSignal<Phase>('idle');
  const [output, setOutput] = createSignal('');
  const [toolEvents, setToolEvents] = createSignal<string[]>([]);
  const [errorMsg, setErrorMsg] = createSignal<string | null>(null);
  let abortCtrl: AbortController | null = null;

  onMount(() => {
    const off = onCellSuggestRequest((req) => {
      setActive(req);
      setPrompt('');
      setPhase('idle');
      setOutput('');
      setToolEvents([]);
      setErrorMsg(null);
    });
    onCleanup(() => {
      off();
      abortCtrl?.abort();
    });
  });

  function close() {
    abortCtrl?.abort();
    closeCellSuggest();
  }

  async function start() {
    const req = active();
    if (!req) return;
    if (!prompt().trim()) {
      showToast('Bitte beschreibe was die Zelle enthalten soll.', 'error');
      return;
    }
    setPhase('streaming');
    setOutput('');
    setToolEvents([]);
    setErrorMsg(null);
    abortCtrl = new AbortController();

    const onEvent = (e: AssistEvent) => {
      if (e.type === 'text_delta') {
        setOutput(output() + e.text);
      } else if (e.type === 'tool_call') {
        setToolEvents([...toolEvents(), `→ ${e.tool}`]);
      } else if (e.type === 'tool_result') {
        setToolEvents([
          ...toolEvents(),
          e.ok ? `✓ ${e.tool}` : `✗ ${e.tool}: ${e.error ?? 'Fehler'}`,
        ]);
      } else if (e.type === 'error') {
        setErrorMsg(e.message);
      } else if (e.type === 'done') {
        setPhase(e.stopReason === 'error' ? 'error' : 'done');
      }
    };

    try {
      const contextSnapshot = `Parent-Zelle: ${req.parentLabel || '(Workspace-Root)'}${req.parentCellId ? ` (id: ${req.parentCellId})` : ''}`;
      await runAssist({
        mode: 'cell-suggest',
        workspaceId: req.workspaceId,
        contextSnapshot,
        messages: [{ role: 'user', content: prompt().trim() }],
        readOnly: false,
        onEvent,
        signal: abortCtrl.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setErrorMsg((err as Error).message ?? String(err));
      setPhase('error');
    }
  }

  return (
    <Show when={active()}>
      {(req) => (
        <div class="overlay-scrim">
          <div
            class="overlay-card cell-suggest-card"
            // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> bewusst.
            role="dialog"
            aria-modal="true"
            aria-labelledby="cell-suggest-title"
          >
            <header class="overlay-head">
              <div class="overlay-head-text">
                <h2 id="cell-suggest-title">AI-Vorschlag fuer Zelle</h2>
                <p class="overlay-sub">Parent: {req().parentLabel || 'Workspace-Root'}</p>
              </div>
              <button type="button" class="overlay-close" onClick={close} aria-label="Schliessen">
                ✕
              </button>
            </header>

            <div class="overlay-body cell-suggest-body">
              <Show when={phase() === 'idle'}>
                <label class="login-field">
                  <span>Was soll diese Zelle enthalten?</span>
                  <textarea
                    class="input cell-suggest-prompt"
                    rows={3}
                    placeholder="z.B. Sub-Matrix fuer Quartalsplanung mit 4 Zeilen (Q1-Q4) und 3 Spalten (Ziele, Aufgaben, Notes)"
                    value={prompt()}
                    onInput={(e) => setPrompt(e.currentTarget.value)}
                  />
                </label>
                <div class="cell-suggest-actions">
                  <button type="button" class="btn btn-primary lift" onClick={() => void start()}>
                    Vorschlag generieren
                  </button>
                  <button type="button" class="btn-subtle" onClick={close}>
                    Abbrechen
                  </button>
                </div>
              </Show>

              <Show when={phase() !== 'idle'}>
                <div class="cell-suggest-output">
                  <Show when={output()}>
                    <pre>{output()}</pre>
                  </Show>
                  <Show when={toolEvents().length > 0}>
                    <ul class="cell-suggest-tools">
                      <For each={toolEvents()}>{(t) => <li>{t}</li>}</For>
                    </ul>
                  </Show>
                  <Show when={errorMsg()}>
                    <p class="login-error">{errorMsg()}</p>
                  </Show>
                </div>
                <div class="cell-suggest-actions">
                  <Show when={phase() === 'streaming'}>
                    <button type="button" class="btn-subtle" onClick={close}>
                      Stop
                    </button>
                  </Show>
                  <Show when={phase() !== 'streaming'}>
                    <button type="button" class="btn btn-primary lift" onClick={close}>
                      Schliessen
                    </button>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
};

export default CellSuggestModal;
