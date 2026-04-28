// Step 5 — Done. Erfolgsmeldung + Button zum Workspace.
//
// Bei partial-success (failedItems.length > 0): dezentes Warning-Banner
// mit Liste, damit der User weiss dass nicht alles geklappt hat.

import { type Component, For, Show } from 'solid-js';
import { useWizard } from '../../lib/wizard-state';
import Icon from '../Icon';

type Props = {
  onFinish: () => void;
};

const StepDone: Component<Props> = (p) => {
  const w = useWizard();
  const proposal = () => w.proposal();
  const failures = () => w.applyFailures();
  return (
    <>
      <header class="wizard-step-head">
        <h2>Fertig</h2>
      </header>
      <div class="wizard-step-body wizard-done-body">
        <div class="wizard-done-banner">
          <Icon name="check-circle" size={32} />
          <div>
            <p>
              <strong>Dein Workspace ist startklar.</strong>
            </p>
            <p class="hint">
              Was nicht abgehakt war oder hier nicht ausgefuehrt wurde, kannst du jederzeit
              hinzufuegen — ueber den Hilfe-Drawer rechts oben (Funkelchen-Icon oder <kbd>Ctrl</kbd>
              +<kbd>K</kbd>) per Chat-Anfrage.
            </p>
          </div>
        </div>

        <Show when={failures().length > 0}>
          <div class="wizard-warning-banner">
            <p>
              <strong>Hinweis:</strong> {failures().length}{' '}
              {failures().length === 1 ? 'Eintrag konnte' : 'Eintraege konnten'} nicht angelegt
              werden:
            </p>
            <ul class="wizard-failure-list">
              <For each={failures()}>
                {(f) => (
                  <li>
                    <span class="wizard-failure-scope">{f.scope}</span>
                    <span class="wizard-failure-label">{f.label}</span>
                    <span class="wizard-failure-error">{f.error}</span>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Show>

        <p class="hint">
          Wenn dir die Struktur spaeter doch nicht passt: du kannst jederzeit unter dem
          Workspace-Switcher links oben "+ Neuer Workspace mit Wizard" auswaehlen, einen weiteren
          Workspace bauen und den alten in den Settings loeschen.
        </p>
        <p class="hint">KI-Vorschlag-Zusammenfassung:</p>
        <blockquote class="wizard-done-summary">{proposal()?.summary ?? '—'}</blockquote>
      </div>
      <div class="wizard-footer">
        <button type="button" onClick={p.onFinish}>
          Workspace oeffnen
        </button>
      </div>
    </>
  );
};

export default StepDone;
