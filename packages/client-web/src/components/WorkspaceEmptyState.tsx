// Empty-State im Workspace-Content (Phase 3 hilfreich-Polish).
//
// Bisheriges UX: "Waehle links eine Matrix oder ein Board." als
// einzelne hint-Zeile — ohne Hinweis was der User tun soll wenn die
// Sidebar leer ist. Jetzt: warmer Header + CTA-Buttons fuer den
// schnellen "+ Matrix" / "+ Board"-Anlage-Pfad.
//
// Phase 3 O.8.N.2: CTAs oeffnen jetzt den TopLevelWizard (Alias +
// Name-Input) statt direkt anzulegen — einheitlicher Wizard-Pfad
// fuer ALLE Anlagen analog zum Cell-Wizard.

import { type Component, Show, createSignal } from 'solid-js';
import Icon from './Icon';
import { ModalTransition } from './ModalTransition';
import TopLevelWizard from './TopLevelWizard';

type Props = {
  workspaceId: string;
  canCreate: boolean;
  onCreated: (nodeId: string) => void;
};

const WorkspaceEmptyState: Component<Props> = (p) => {
  const [wizardType, setWizardType] = createSignal<'matrix' | 'board' | null>(null);

  return (
    <section class="ws-empty-state" aria-label="Workspace leer">
      <div class="ws-empty-icon" aria-hidden="true">
        <Icon name="sparkles" size={36} />
      </div>
      <h2 class="ws-empty-title">Leg los — bau dir deine Struktur.</h2>
      <p class="ws-empty-hint">
        Waehle links eine Matrix oder ein Board, oder leg direkt eine an. Du kannst spaeter beliebig
        verschachteln, umbenennen und durch Eingabe Objekte erstellen.
      </p>
      <Show
        when={p.canCreate}
        fallback={
          <p class="ws-empty-readonly">
            Du hast in diesem Workspace nur Lesezugriff — frag den Owner ob du Editor werden kannst.
          </p>
        }
      >
        <div class="ws-empty-actions">
          <button
            type="button"
            class="ws-empty-cta ws-empty-cta-matrix"
            onClick={() => setWizardType('matrix')}
            disabled={wizardType() !== null}
          >
            <Icon name="squares-2x2" size={18} />
            <span class="ws-empty-cta-title">+ Matrix anlegen</span>
            <span class="ws-empty-cta-sub">2x2 Starter, du kannst direkt tippen</span>
          </button>
          <button
            type="button"
            class="ws-empty-cta ws-empty-cta-board"
            onClick={() => setWizardType('board')}
            disabled={wizardType() !== null}
          >
            <Icon name="view-columns" size={18} />
            <span class="ws-empty-cta-title">+ Board anlegen</span>
            <span class="ws-empty-cta-sub">3 Spalten ToDo / In Arbeit / Erledigt</span>
          </button>
        </div>
      </Show>
      <ModalTransition when={Boolean(wizardType())}>
        <Show when={wizardType()}>
          {(type) => (
            <TopLevelWizard
              workspaceId={p.workspaceId}
              type={type()}
              onClose={() => setWizardType(null)}
              onCreated={(nodeId) => p.onCreated(nodeId)}
            />
          )}
        </Show>
      </ModalTransition>
    </section>
  );
};

export default WorkspaceEmptyState;
