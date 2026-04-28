// Step 2 — Fixes Script. 5 Fragen, alle Pflicht (min 2 Zeichen).
// "Weiter" geht zu phase=proposing (kommt mit A.4c — bis dahin
// Placeholder).

import { type Component, For, createMemo } from 'solid-js';
import type { WizardAnswers } from '../../lib/wizard-state';
import { useWizard } from '../../lib/wizard-state';

const QUESTIONS: ReadonlyArray<{
  key: keyof WizardAnswers;
  label: string;
  hint: string;
  rows: number;
}> = [
  {
    key: 'goal',
    label: 'Was ist dein Hauptziel mit Matrix?',
    hint: 'Z.B. Projekt-Management, Wissens-Organisation, persoenliche Aufgaben, Team-Koordination …',
    rows: 2,
  },
  {
    key: 'topics',
    label: 'Welche Themen willst du strukturieren?',
    hint: 'Z.B. Kunden, Code-Module, Lernplan, Roadmap-Quartale, Reise-Planung …',
    rows: 3,
  },
  {
    key: 'workStyle',
    label: 'Wie arbeitest du?',
    hint: 'Solo, kleines Team, verteiltes Team, asynchron, in Workshops …',
    rows: 1,
  },
  {
    key: 'hurdles',
    label: 'Was sind deine Huerden mit aktuellen Tools?',
    hint: 'Z.B. zu starr, zu chaotisch, zu viele Klicks, kein Offline-Pfad, kein Cross-Linking …',
    rows: 3,
  },
  {
    key: 'role',
    label: 'Welche Rolle hast du?',
    hint: 'Z.B. Manager, Entwickler, Researcher, Designer, Solo-Founder, Student …',
    rows: 1,
  },
];

const StepQuestions: Component = () => {
  const w = useWizard();

  function update<K extends keyof WizardAnswers>(key: K, value: string): void {
    w.setAnswers({ ...w.answers(), [key]: value });
  }

  const allFilled = createMemo(() => {
    const a = w.answers();
    return QUESTIONS.every((q) => a[q.key].trim().length >= 2);
  });

  return (
    <>
      <header class="wizard-step-head">
        <h2>Deine Antworten</h2>
        <p class="hint">
          Auf Basis deiner Antworten schlaegt die KI gleich eine konkrete Workspace-Struktur vor. Du
          siehst den Vorschlag erst — entschieden wird nichts ohne deinen Klick.
        </p>
      </header>

      <div class="wizard-step-body wizard-questions-body">
        <For each={QUESTIONS}>
          {(q) => (
            <label class="wizard-question">
              <span class="wizard-question-label">{q.label}</span>
              <span class="wizard-question-hint">{q.hint}</span>
              <textarea
                class="wizard-question-input"
                rows={q.rows}
                value={w.answers()[q.key]}
                onInput={(e) => update(q.key, e.currentTarget.value)}
              />
            </label>
          )}
        </For>
      </div>

      <div class="wizard-footer">
        <button type="button" class="btn-secondary" onClick={() => w.setPhase('provider')}>
          Zurueck
        </button>
        <button
          type="button"
          disabled={!allFilled()}
          onClick={() => w.setPhase('proposing')}
          title={
            allFilled() ? '' : 'Bitte alle Fragen kurz beantworten (mindestens 2 Zeichen pro Feld).'
          }
        >
          Vorschlag erzeugen
        </button>
      </div>
    </>
  );
};

export default StepQuestions;
