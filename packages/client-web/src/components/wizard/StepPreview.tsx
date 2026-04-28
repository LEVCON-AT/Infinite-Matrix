// Step 3b — Preview. Tree-Render des Vorschlags mit Checkbox-Selection.
//
// Pro Knoten / Child / Checkliste eine Checkbox. Default: alles
// abgehakt. User kann gezielt deselektieren — Apply nimmt nur
// abgehakte Items.
//
// Disabled-State: wenn der Parent (Node oder Child) deselektiert ist,
// werden seine sub-Checkboxen optisch ausgegraut UND ihre Checkbox-
// State bleibt zwar erhalten, ist aber im Apply-Loop irrelevant
// (Parent nicht selected → kein Sub-Apply).
//
// Buttons: "Anlegen" → phase='applying'.
//          "Andere Variante" → phase='proposing' (re-roll).
//          "Verwerfen" → phase='questions' (zurueck zu Antworten).

import { type Component, For, Show } from 'solid-js';
import {
  type ProposalChecklist,
  type ProposalChild,
  type ProposalNode,
  useWizard,
} from '../../lib/wizard-state';
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
          Hier ist der KI-Vorschlag. Hak ab, was angelegt werden soll. Standard: alles aktiviert —
          deselektierte Eintraege werden uebersprungen.
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
                <For each={p().nodes}>{(node, i) => <NodeRow node={node} nodeIdx={i()} />}</For>
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

const NodeRow: Component<{ node: ProposalNode; nodeIdx: number }> = (p) => {
  const w = useWizard();
  return (
    <li class="wizard-tree-node" classList={{ 'wizard-tree-deselected': !p.node.selected }}>
      <label class="wizard-tree-node-head wizard-tree-row">
        <input
          type="checkbox"
          class="wizard-checkbox"
          checked={p.node.selected}
          onChange={() => w.toggleNode(p.nodeIdx)}
          aria-label={`${p.node.label} anlegen`}
        />
        <Icon name={p.node.type === 'matrix' ? 'squares-2x2' : 'view-columns'} size={14} />
        <span class="wizard-tree-node-label">{p.node.label}</span>
        <span class="wizard-tree-node-kind">{p.node.type === 'matrix' ? 'Matrix' : 'Board'}</span>
        <Show when={p.node.alias}>
          {(alias) => <span class="wizard-tree-alias">^{alias()}</span>}
        </Show>
      </label>
      <Show when={p.node.children.length > 0}>
        <ul class="wizard-tree-children">
          <For each={p.node.children}>
            {(child, j) => (
              <ChildRow
                child={child}
                childIdx={j()}
                nodeIdx={p.nodeIdx}
                parentSelected={p.node.selected}
                parentType={p.node.type}
              />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
};

const ChildRow: Component<{
  child: ProposalChild;
  childIdx: number;
  nodeIdx: number;
  parentSelected: boolean;
  parentType: 'matrix' | 'board';
}> = (p) => {
  const w = useWizard();
  const effectivelySelected = () => p.parentSelected && p.child.selected;
  const label = () => p.child.cell_label ?? p.child.card_name ?? '(Eintrag)';
  const icon = () => (p.parentType === 'matrix' ? 'information-circle' : 'document-text');

  return (
    <li class="wizard-tree-child" classList={{ 'wizard-tree-deselected': !effectivelySelected() }}>
      <label class="wizard-tree-row">
        <input
          type="checkbox"
          class="wizard-checkbox"
          checked={p.child.selected}
          disabled={!p.parentSelected}
          onChange={() => w.toggleChild(p.nodeIdx, p.childIdx)}
          aria-label={`${label()} anlegen`}
        />
        <Icon name={icon()} size={12} />
        <span class="wizard-tree-child-label">{label()}</span>
        <Show when={p.child.card_note}>
          {(note) => <span class="wizard-tree-child-note">— {note()}</span>}
        </Show>
      </label>
      <Show when={p.child.checklists.length > 0}>
        <ul class="wizard-tree-checklists">
          <For each={p.child.checklists}>
            {(cl, k) => (
              <ChecklistRow
                checklist={cl}
                clIdx={k()}
                childIdx={p.childIdx}
                nodeIdx={p.nodeIdx}
                parentSelected={effectivelySelected()}
              />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
};

const ChecklistRow: Component<{
  checklist: ProposalChecklist;
  clIdx: number;
  childIdx: number;
  nodeIdx: number;
  parentSelected: boolean;
}> = (p) => {
  const w = useWizard();
  const effectivelySelected = () => p.parentSelected && p.checklist.selected;
  return (
    <li
      class="wizard-tree-checklist"
      classList={{ 'wizard-tree-deselected': !effectivelySelected() }}
    >
      <label class="wizard-tree-row">
        <input
          type="checkbox"
          class="wizard-checkbox"
          checked={p.checklist.selected}
          disabled={!p.parentSelected}
          onChange={() => w.toggleChecklist(p.nodeIdx, p.childIdx, p.clIdx)}
          aria-label={`Checkliste ${p.checklist.label} anlegen`}
        />
        <Icon name="check-circle" size={11} />
        <span class="wizard-tree-checklist-label">{p.checklist.label}</span>
      </label>
      <Show when={p.checklist.items.length > 0}>
        <ul class="wizard-tree-checklist-items">
          <For each={p.checklist.items}>{(it) => <li>{it}</li>}</For>
        </ul>
      </Show>
    </li>
  );
};

export default StepPreview;
