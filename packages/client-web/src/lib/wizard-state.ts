// Wizard-State-Container (A.4b) — Solid-Context fuer den Onboarding-
// Wizard. Lokal pro WizardShell-Mount, Refresh = Reset.
//
// Phasen orientieren sich an ImportDialog.tsx — `phase`-Signal +
// <Show when=phase()===...> in der Shell.
//
// State-Container nicht global, weil:
//   - Wizard ist single-shot (nach Skip oder Done = vorbei)
//   - Wenn der User die Page refresht, soll der Wizard von vorn
//     beginnen (Step 0). Ein global persistiertes State waere hier
//     nur Verwirrung.
//
// Type-Diskussion:
//   - WizardSource trennt zwei Lifecycle-Pfade. Initial: bestehender
//     default-Workspace, der wird gefuellt. New: noch kein Workspace,
//     wird in Step 4 angelegt mit createWorkspace(proposal.label).
//   - WizardAnswers sind die 5 Fragen aus Step 2. Bewusst alle Strings
//     (statt Enum) — der LLM soll mit Freitext umgehen koennen, fest
//     verdrahtete Optionen sind hier zu rigide.
//   - WizardProposal kommt vom wizard_propose_structure-Tool (kommt
//     mit A.4c). Hier nur als optional<unknown>-Slot.

import { type Setter, createContext, createSignal, useContext } from 'solid-js';

export type WizardPhase =
  | 'welcome'
  | 'provider'
  | 'questions'
  | 'proposing'
  | 'preview'
  | 'applying'
  | 'done'
  | 'error';

export type WizardSource =
  | { kind: 'initial'; workspaceId: string }
  | { kind: 'new'; pendingName: string };

export type WizardAnswers = {
  goal: string; // Hauptziel
  topics: string; // Themen
  workStyle: string; // Arbeitsweise (Solo / Team / verteilt)
  hurdles: string; // Huerden mit aktuellen Tools
  role: string; // Rolle (Manager / Entwickler / …)
};

// Type des Vorschlags vom wizard_propose_structure-Tool. Bewusst
// loose getypt fuer A.4b — die Struktur kommt mit A.4c, hier nur
// als Daten-Slot.
export type WizardProposal = {
  workspace_label: string;
  summary: string;
  nodes: Array<{
    label: string;
    type: 'matrix' | 'board';
    alias?: string | null;
    children?: Array<unknown>;
  }>;
};

export type ApplyProgress = {
  current: number;
  total: number;
  step: string;
};

export type WizardState = {
  // Phase
  phase: () => WizardPhase;
  setPhase: Setter<WizardPhase>;

  // Source (initial vs new)
  source: () => WizardSource;

  // Step 2 — Antworten
  answers: () => WizardAnswers;
  setAnswers: Setter<WizardAnswers>;

  // Step 3 — Vorschlag
  proposal: () => WizardProposal | null;
  setProposal: Setter<WizardProposal | null>;

  // Step 4 — Apply-Progress
  applyProgress: () => ApplyProgress | null;
  setApplyProgress: Setter<ApplyProgress | null>;

  // Resultate / Fehler
  resultWorkspaceId: () => string | null;
  setResultWorkspaceId: Setter<string | null>;
  errorMsg: () => string;
  setErrorMsg: Setter<string>;
};

const EMPTY_ANSWERS: WizardAnswers = {
  goal: '',
  topics: '',
  workStyle: '',
  hurdles: '',
  role: '',
};

export function createWizardState(source: WizardSource): WizardState {
  const [phase, setPhase] = createSignal<WizardPhase>('welcome');
  const [answers, setAnswers] = createSignal<WizardAnswers>(EMPTY_ANSWERS);
  const [proposal, setProposal] = createSignal<WizardProposal | null>(null);
  const [applyProgress, setApplyProgress] = createSignal<ApplyProgress | null>(null);
  const [resultWorkspaceId, setResultWorkspaceId] = createSignal<string | null>(null);
  const [errorMsg, setErrorMsg] = createSignal<string>('');

  return {
    phase,
    setPhase,
    source: () => source,
    answers,
    setAnswers,
    proposal,
    setProposal,
    applyProgress,
    setApplyProgress,
    resultWorkspaceId,
    setResultWorkspaceId,
    errorMsg,
    setErrorMsg,
  };
}

export const WizardContext = createContext<WizardState>();

export function useWizard(): WizardState {
  const v = useContext(WizardContext);
  if (!v) throw new Error('useWizard() ausserhalb WizardContext aufgerufen.');
  return v;
}

// Step-Reihenfolge fuer den Indicator. proposing/preview/applying
// sind technische Phasen — der Indicator zeigt sie als "Step 4: KI
// arbeitet…" zusammen.
export const VISIBLE_STEPS: ReadonlyArray<{ key: string; phases: WizardPhase[]; label: string }> = [
  { key: 'welcome', phases: ['welcome'], label: 'Willkommen' },
  { key: 'provider', phases: ['provider'], label: 'AI-Anbindung' },
  { key: 'questions', phases: ['questions'], label: 'Deine Antworten' },
  { key: 'proposing', phases: ['proposing', 'preview'], label: 'KI-Vorschlag' },
  { key: 'apply', phases: ['applying', 'done'], label: 'Anlegen' },
];

export function visibleStepIndex(phase: WizardPhase): number {
  const idx = VISIBLE_STEPS.findIndex((s) => s.phases.includes(phase));
  return idx >= 0 ? idx : 0;
}
