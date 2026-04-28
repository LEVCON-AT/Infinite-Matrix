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
import {
  type ProposalChecklist,
  type ProposalChild,
  type ProposalNode,
  type WizardProposal,
  useWizard,
} from '../../lib/wizard-state';
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
        // Defensiv: Wizard arbeitet auf leerem/eigenem Workspace, der
        // Read-Only-Modus der A.3-UI greift hier nicht. Explizit setzen
        // damit ein etwaiges Default-Verhalten nicht greift.
        readOnly: false,
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
// validieren + normalisieren — children-Items werden auf cell_label/
// card_name/card_note/checklists gemappt. selected:true als Default
// (User toggelt in Preview ab).
//
// Bei kaputtem Format: null returnen, UI zeigt "Format-Fehler".
function parseProposal(args: unknown): WizardProposal | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  if (typeof a.workspace_label !== 'string') return null;
  if (typeof a.summary !== 'string') return null;
  if (!Array.isArray(a.nodes)) return null;

  const nodes: ProposalNode[] = a.nodes
    .map((n): ProposalNode | null => parseNode(n))
    .filter((n): n is ProposalNode => n !== null);
  if (nodes.length === 0) return null;
  return {
    workspace_label: a.workspace_label,
    summary: a.summary,
    nodes,
  };
}

function parseNode(n: unknown): ProposalNode | null {
  if (!n || typeof n !== 'object') return null;
  const obj = n as Record<string, unknown>;
  if (typeof obj.label !== 'string') return null;
  if (obj.type !== 'matrix' && obj.type !== 'board') return null;
  const childrenRaw = Array.isArray(obj.children) ? (obj.children as unknown[]) : [];
  const children: ProposalChild[] = childrenRaw
    .map((c) => parseChild(c, obj.type as 'matrix' | 'board'))
    .filter((c): c is ProposalChild => c !== null);
  return {
    label: obj.label,
    type: obj.type,
    alias: typeof obj.alias === 'string' && obj.alias.trim().length > 0 ? obj.alias : null,
    children,
    selected: true,
  };
}

function parseChild(c: unknown, parentType: 'matrix' | 'board'): ProposalChild | null {
  if (!c || typeof c !== 'object') return null;
  const obj = c as Record<string, unknown>;
  // Normalisierung: bei matrix-Parent das card_name verwerfen, bei
  // board-Parent das cell_label verwerfen — der LLM mischt manchmal.
  const rawCellLabel = typeof obj.cell_label === 'string' ? obj.cell_label : null;
  const rawCardName = typeof obj.card_name === 'string' ? obj.card_name : null;
  const cellLabel = parentType === 'matrix' ? rawCellLabel : null;
  const cardName = parentType === 'board' ? rawCardName : null;
  // Bei matrix wenn keine cell_label → kein verwertbarer Child. Skip.
  // Bei board wenn keine card_name → ggf. nur Checklisten-Carrier (board-
  // level), aber das Schema sieht das nicht vor. Skip wenn nichts da.
  if (parentType === 'matrix' && !cellLabel) return null;
  if (parentType === 'board' && !cardName) return null;

  const cardNote = typeof obj.card_note === 'string' ? obj.card_note : null;
  const checklistsRaw = Array.isArray(obj.checklists) ? (obj.checklists as unknown[]) : [];
  const checklists: ProposalChecklist[] = checklistsRaw
    .map((cl) => parseChecklist(cl))
    .filter((cl): cl is ProposalChecklist => cl !== null);

  return {
    cell_label: cellLabel,
    card_name: cardName,
    card_note: cardNote,
    checklists,
    selected: true,
  };
}

function parseChecklist(cl: unknown): ProposalChecklist | null {
  if (!cl || typeof cl !== 'object') return null;
  const obj = cl as Record<string, unknown>;
  const label = typeof obj.label === 'string' ? obj.label.trim() : '';
  if (!label) return null;
  const itemsRaw = Array.isArray(obj.items) ? (obj.items as unknown[]) : [];
  const items = itemsRaw
    .map((it) => (typeof it === 'string' ? it.trim() : ''))
    .filter((it) => it.length > 0);
  return { label, items, selected: true };
}

export default StepProposing;
