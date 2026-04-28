// Step 5 — Done. Erfolgsmeldung + Button zum Workspace.

import type { Component } from 'solid-js';
import { useWizard } from '../../lib/wizard-state';
import Icon from '../Icon';

type Props = {
  onFinish: () => void;
};

const StepDone: Component<Props> = (p) => {
  const w = useWizard();
  const proposal = () => w.proposal();
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
              Die KI hat dir Top-Level-Knoten angelegt. Cells, Karten und Checklisten kannst du
              jederzeit selbst hinzufuegen — oder ueber den Hilfe-Drawer rechts oben (Funkelchen-
              Icon oder <kbd>Ctrl</kbd>+<kbd>K</kbd>) per Chat-Anfrage.
            </p>
          </div>
        </div>
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
