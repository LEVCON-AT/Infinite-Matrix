// Step 3b — Preview. Read-only Tree-Render des Vorschlags (A.4c).
//
// Custom-Renderer (NodeTree.tsx ist zu RW-pfaden-bound). Zeigt
// Workspace-Label + summary + flachen Tree der nodes. Bei matrix-
// Parent: Cells als Sub-Items, Checklists indented. Bei board-
// Parent: Karten als Sub-Items.
//
// Buttons: "Anlegen" → phase='applying' (kommt mit A.4d).
//          "Andere Variante" → phase='proposing' (re-roll).
//          "Verwerfen" → phase='questions' (zurueck zu Antworten).

import { type Component, For, Show } from 'solid-js';
import { useWizard } from '../../lib/wizard-state';
import Icon from '../Icon';

const StepPreview: Component = () => {
  const w = useWizard();
  const proposal = () => w.proposal();

  function handleCommit(): void {
    w.setPhase('applying');
  }

  function handleReroll(): void {
    w.setProposal(null);
    w.setPhase('proposing');
  }

  function handleDiscard(): void {
    w.setProposal(null);
    w.setPhase('questions');
  }

  return (
    <>
      <header class="wizard-step-head">
        <h2>Vorschau</h2>
        <p class="hint">
          Hier ist der KI-Vorschlag. Anlegen, Variante neu erzeugen oder zu den Antworten zurueck.
        </p>
      </header>

      <div class="wizard-step-body">
        <Show
          when={proposal()}
          fallback={<p class="error">Kein Vorschlag verfuegbar — bitte zurueck.</p>}
        >
          {(p) => (
            <div class="wizard-preview">
              <section class="wizard-preview-summary">
                <h3 class="wizard-preview-ws-label">{p().workspace_label}</h3>
                <p class="hint">{p().summary}</p>
              </section>
              <ul class="wizard-tree-preview">
                <For each={p().nodes}>{(node) => <NodeRow node={node} />}</For>
              </ul>
            </div>
          )}
        </Show>
      </div>

      <div class="wizard-footer">
        <button type="button" class="btn-secondary" onClick={handleDiscard}>
          Verwerfen
        </button>
        <button type="button" class="btn-secondary" onClick={handleReroll}>
          Andere Variante
        </button>
        <button type="button" onClick={handleCommit}>
          Anlegen
        </button>
      </div>
    </>
  );
};

const NodeRow: Component<{
  node: { label: string; type: 'matrix' | 'board'; children?: unknown[] };
}> = (p) => (
  <li class="wizard-tree-node">
    <div class="wizard-tree-node-head">
      <Icon name={p.node.type === 'matrix' ? 'squares-2x2' : 'view-columns'} size={14} />
      <span class="wizard-tree-node-label">{p.node.label}</span>
      <span class="wizard-tree-node-kind">{p.node.type === 'matrix' ? 'Matrix' : 'Board'}</span>
    </div>
    <Show when={p.node.children && p.node.children.length > 0}>
      <ul class="wizard-tree-children">
        <For each={p.node.children}>{(child) => <ChildRow child={child} />}</For>
      </ul>
    </Show>
  </li>
);

const ChildRow: Component<{ child: unknown }> = (p) => {
  const c = (p.child ?? {}) as Record<string, unknown>;
  const cellLabel = typeof c.cell_label === 'string' ? c.cell_label : null;
  const cardName = typeof c.card_name === 'string' ? c.card_name : null;
  const cardNote = typeof c.card_note === 'string' ? c.card_note : null;
  const checklists = Array.isArray(c.checklists) ? (c.checklists as unknown[]) : [];

  return (
    <li class="wizard-tree-child">
      <Show when={cellLabel}>
        {(label) => (
          <div class="wizard-tree-child-head">
            <Icon name="information-circle" size={12} />
            <span>{label()}</span>
          </div>
        )}
      </Show>
      <Show when={cardName}>
        {(name) => (
          <div class="wizard-tree-child-head">
            <Icon name="document-text" size={12} />
            <span>{name()}</span>
            <Show when={cardNote}>
              {(note) => <span class="wizard-tree-child-note">— {note()}</span>}
            </Show>
          </div>
        )}
      </Show>
      <Show when={checklists.length > 0}>
        <ul class="wizard-tree-checklists">
          <For each={checklists}>
            {(cl) => {
              const obj = (cl ?? {}) as Record<string, unknown>;
              const label = typeof obj.label === 'string' ? obj.label : '(Liste)';
              const items = Array.isArray(obj.items) ? (obj.items as unknown[]) : [];
              return (
                <li>
                  <div class="wizard-tree-checklist-label">
                    <Icon name="check-circle" size={11} />
                    <span>{label}</span>
                  </div>
                  <Show when={items.length > 0}>
                    <ul class="wizard-tree-checklist-items">
                      <For each={items}>
                        {(it) => <li>{typeof it === 'string' ? it : '(Item)'}</li>}
                      </For>
                    </ul>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>
    </li>
  );
};

export default StepPreview;
