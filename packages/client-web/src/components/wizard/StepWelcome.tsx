// Step 0 — Begruessung. Statisch, keine Eingabe noetig.
//
// Buttons: "Verstanden, weiter" → phase=provider. "Spaeter ohne KI"
// → onSkip-Callback (markOnboardingSkipped + close).

import type { Component } from 'solid-js';
import { useWizard } from '../../lib/wizard-state';

type Props = {
  onSkip: () => void;
};

const StepWelcome: Component<Props> = (p) => {
  const w = useWizard();
  return (
    <>
      <header class="wizard-step-head">
        <h2>Willkommen bei Matrix</h2>
      </header>
      <div class="wizard-step-body">
        <p>
          Matrix organisiert dein Wissen in <strong>verschachtelten Strukturen</strong>: jede Zelle
          einer Matrix kann selbst wieder eine Matrix sein, ein Kanban-Board, eine Checkliste oder
          ein Info-Text. Du kannst beliebig tief denken — vom groben Lebens-Layout bis zum einzelnen
          Task.
        </p>
        <p>
          Damit dir die KI dabei hilft, brauchst du einen <strong>API-Key</strong> bei einem
          Provider deiner Wahl (Anthropic, OpenAI oder Google Gemini). Die Kosten gehen direkt an
          den Provider — Matrix selbst speichert nur den Key verschluesselt und schickt deine
          Anfragen weiter.
        </p>
        <p class="hint">
          Wenn du jetzt keinen Key einrichten willst, kannst du das auch spaeter unter Einstellungen
          → AI-Anbindung nachholen. Dann zeigt der Wizard sich nicht mehr — aber Inline-Hilfe und
          Vorschlaege wirst du erst mit Provider sehen.
        </p>
      </div>
      <div class="wizard-footer">
        <button type="button" class="btn-secondary" onClick={p.onSkip}>
          Spaeter ohne KI
        </button>
        <button type="button" onClick={() => w.setPhase('provider')}>
          Verstanden, weiter
        </button>
      </div>
    </>
  );
};

export default StepWelcome;
