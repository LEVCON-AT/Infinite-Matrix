// Step 3a — Proposing. KI generiert den Vorschlag (A.4c).
//
// Ruft runAssist({ mode: 'wizard', ... }). Faengt das tool_call-Event
// fuer wizard_propose_structure ab und stored die args als
// proposal()-Signal. Bei done → wenn proposal: phase='preview'.
//
// Andere tool_calls (LLM ignoriert System-Prompt-Constraint) werden
// als Toast gewarnt. Der Dispatcher in lib/ai-assist/index.ts lehnt
// nicht-allowed Tools sowieso ab — der Toast hier ist nur User-
// Feedback.

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { runAssist } from '../../lib/ai-assist';
import type { AssistEvent } from '../../lib/ai-assist';
import { showToast } from '../../lib/toasts';
import { buildWizardPrompt } from '../../lib/wizard-prompt';
import { type WizardProposal, useWizard } from '../../lib/wizard-state';
import Icon from '../Icon';

const StepProposing: Component = () => {
  const w = useWizard();

  const [streamingText, setStreamingText] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [didCallProposeTool, setDidCallProposeTool] = createSignal(false);

  let abortCtrl: AbortController | null = null;

  onMount(() => {
    void start();
  });

  onCleanup(() => {
    abortCtrl?.abort();
  });

  async function start(): Promise<void> {
    setError(null);
    setStreamingText('');
    setDidCallProposeTool(false);
    abortCtrl?.abort();
    abortCtrl = new AbortController();

    const sourceWsId = (() => {
      const src = w.source();
      return src.kind === 'initial' ? src.workspaceId : null;
    })();

    const onEvent = (e: AssistEvent): void => {
      switch (e.type) {
        case 'text_delta':
          setStreamingText((prev) => prev + e.text);
          return;
        case 'tool_call':
          if (e.tool === 'wizard_propose_structure') {
            // Args sind selbst der Vorschlag (Mitigation H).
            setDidCallProposeTool(true);
            const proposal = parseProposal(e.args);
            if (proposal) {
              w.setProposal(proposal);
            } else {
              setError(
                'Der Vorschlag konnte nicht gelesen werden — die KI hat ein unerwartetes Format zurueckgegeben.',
              );
            }
          } else {
            // Wird vom Dispatcher hart abgelehnt — wir warnen den User.
            console.warn('Unerlaubter Wizard-Tool-Call:', e.tool);
            showToast(
              `KI hat versucht ${e.tool} zu rufen — wird im Wizard-Modus blockiert. Falls der Vorschlag nicht passt, bitte "Andere Variante" probieren.`,
              'error',
            );
          }
          return;
        case 'iter_cap':
          setError(
            `Die KI hat den Tool-Call-Limit erreicht (${e.reached}/${e.cap}) ohne einen Vorschlag zu liefern.`,
          );
          return;
        case 'error':
          setError(e.message);
          return;
        case 'done':
          if (w.proposal()) {
            // Transition in den Preview-Step.
            w.setPhase('preview');
          } else if (!error() && !didCallProposeTool()) {
            setError(
              'Die KI hat keinen Vorschlag generiert. Bitte versuche es nochmal — eventuell andere Antworten formulieren.',
            );
          }
          return;
      }
    };

    try {
      await runAssist({
        mode: 'wizard',
        workspaceId: sourceWsId,
        messages: [{ role: 'user', content: buildWizardPrompt(w.answers()) }],
        onEvent,
        signal: abortCtrl.signal,
      });
    } catch (err) {
      console.error('runAssist (wizard):', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleCancel(): void {
    abortCtrl?.abort();
    w.setPhase('questions');
  }

  function handleRetry(): void {
    void start();
  }

  return (
    <>
      <header class="wizard-step-head">
        <h2>KI-Vorschlag</h2>
        <p class="hint">
          Die KI baut gleich einen Vorschlag basierend auf deinen Antworten. Du siehst ihn als
          Vorschau und entscheidest dann selbst.
        </p>
      </header>

      <div class="wizard-step-body wizard-proposing-body">
        <Show when={!error()}>
          <div class="wizard-streaming">
            <div class="wizard-streaming-indicator" aria-live="polite">
              <Icon name="sparkles" size={16} />
              <span>KI denkt nach…</span>
            </div>
            <Show when={streamingText()}>
              <div class="wizard-streaming-text">{streamingText()}</div>
            </Show>
          </div>
        </Show>
        <Show when={error()}>
          {(msg) => (
            <div class="wizard-error">
              <p class="error">{msg()}</p>
            </div>
          )}
        </Show>
      </div>

      <div class="wizard-footer">
        <Show when={!error()}>
          <button type="button" class="btn-secondary" onClick={handleCancel}>
            Abbrechen
          </button>
        </Show>
        <Show when={error()}>
          <button type="button" class="btn-secondary" onClick={() => w.setPhase('questions')}>
            Zurueck
          </button>
          <button type="button" onClick={handleRetry}>
            Nochmal versuchen
          </button>
        </Show>
      </div>
    </>
  );
};

// Args von wizard_propose_structure ist Record<string, unknown>. Wir
// validieren minimal — wenn Felder fehlen/falsch typed, returnen wir
// null und der UI zeigt "Format-Fehler".
function parseProposal(args: unknown): WizardProposal | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  if (typeof a.workspace_label !== 'string') return null;
  if (typeof a.summary !== 'string') return null;
  if (!Array.isArray(a.nodes)) return null;
  const nodes = a.nodes
    .map((n): WizardProposal['nodes'][number] | null => {
      if (!n || typeof n !== 'object') return null;
      const obj = n as Record<string, unknown>;
      if (typeof obj.label !== 'string') return null;
      if (obj.type !== 'matrix' && obj.type !== 'board') return null;
      return {
        label: obj.label,
        type: obj.type,
        alias: typeof obj.alias === 'string' ? obj.alias : null,
        children: Array.isArray(obj.children) ? obj.children : [],
      };
    })
    .filter((n): n is WizardProposal['nodes'][number] => n !== null);
  if (nodes.length === 0) return null;
  return {
    workspace_label: a.workspace_label,
    summary: a.summary,
    nodes,
  };
}

export default StepProposing;
