// Wizard-State-Container — Solid-Context fuer den Onboarding-Wizard.
// Lokal pro WizardShell-Mount, Refresh = Reset.
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
// Type-Modell:
//   - WizardSource trennt zwei Lifecycle-Pfade. Initial: bestehender
//     default-Workspace, der wird gefuellt. New: noch kein Workspace,
//     wird in Step 4 angelegt mit createWorkspace(proposal.label).
//   - WizardAnswers sind die 5 Fragen aus Step 2. Bewusst alle Strings
//     (statt Enum) — der LLM soll mit Freitext umgehen koennen, fest
//     verdrahtete Optionen sind hier zu rigide.
//   - WizardProposal ist die Args von wizard_propose_structure +
//     pro Item ein `selected: boolean` (User-Steuerung in Preview).
//     Apply uebernimmt nur abgehakte Items.

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
  goal: string;
  topics: string;
  workStyle: string;
  hurdles: string;
  role: string;
};

// ─── Proposal-Typen ──────────────────────────────────────────
// Alle Items haben `selected: boolean` — User toggelt in Preview,
// Apply nimmt nur selektierte.

export type ProposalChecklist = {
  label: string;
  items: string[];
  selected: boolean;
};

export type ProposalChild = {
  // Genau eines von cell_label oder card_name ist gesetzt — abhaengig
  // vom parent-Node-Type. In der Praxis vom LLM nicht immer sauber
  // gehalten, parseProposal normalisiert.
  cell_label: string | null;
  card_name: string | null;
  card_note: string | null;
  checklists: ProposalChecklist[];
  selected: boolean;
};

export type ProposalNode = {
  label: string;
  type: 'matrix' | 'board';
  alias: string | null;
  children: ProposalChild[];
  selected: boolean;
};

export type WizardProposal = {
  workspace_label: string;
  summary: string;
  nodes: ProposalNode[];
};

// ─── Apply-Progress + Failures ────────────────────────────────

export type ApplyProgress = {
  current: number;
  total: number;
  step: string;
};

export type ApplyFailureScope =
  | 'workspace'
  | 'node'
  | 'col'
  | 'row'
  | 'cell'
  | 'card'
  | 'checklist'
  | 'item';

export type ApplyFailure = {
  scope: ApplyFailureScope;
  label: string;
  error: string;
};

// ─── State-Container ──────────────────────────────────────────

export type WizardState = {
  phase: () => WizardPhase;
  setPhase: Setter<WizardPhase>;

  source: () => WizardSource;

  answers: () => WizardAnswers;
  setAnswers: Setter<WizardAnswers>;

  proposal: () => WizardProposal | null;
  setProposal: Setter<WizardProposal | null>;

  applyProgress: () => ApplyProgress | null;
  setApplyProgress: Setter<ApplyProgress | null>;

  applyFailures: () => ApplyFailure[];
  setApplyFailures: Setter<ApplyFailure[]>;

  resultWorkspaceId: () => string | null;
  setResultWorkspaceId: Setter<string | null>;
  errorMsg: () => string;
  setErrorMsg: Setter<string>;

  // Selection-Toggle-Helfer fuer Preview. Operieren auf der proposal-
  // Signal-Mutation.
  toggleNode: (nodeIdx: number) => void;
  toggleChild: (nodeIdx: number, childIdx: number) => void;
  toggleChecklist: (nodeIdx: number, childIdx: number, clIdx: number) => void;
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
  const [applyFailures, setApplyFailures] = createSignal<ApplyFailure[]>([]);
  const [resultWorkspaceId, setResultWorkspaceId] = createSignal<string | null>(null);
  const [errorMsg, setErrorMsg] = createSignal<string>('');

  // Toggle-Helfer: deep-clone den proposal-State bevor wir ihn mutieren,
  // damit Solid die Aenderung bemerkt. Seitwaerts-Effekte greifen sonst
  // nicht, weil createSignal Identitaets-Vergleich nutzt.
  const toggleNode = (nodeIdx: number): void => {
    const cur = proposal();
    if (!cur || nodeIdx < 0 || nodeIdx >= cur.nodes.length) return;
    const next: WizardProposal = {
      ...cur,
      nodes: cur.nodes.map((n, i) => (i === nodeIdx ? { ...n, selected: !n.selected } : n)),
    };
    setProposal(next);
  };

  const toggleChild = (nodeIdx: number, childIdx: number): void => {
    const cur = proposal();
    if (!cur || nodeIdx < 0 || nodeIdx >= cur.nodes.length) return;
    const node = cur.nodes[nodeIdx];
    if (!node || childIdx < 0 || childIdx >= node.children.length) return;
    const next: WizardProposal = {
      ...cur,
      nodes: cur.nodes.map((n, i) => {
        if (i !== nodeIdx) return n;
        return {
          ...n,
          children: n.children.map((c, j) =>
            j === childIdx ? { ...c, selected: !c.selected } : c,
          ),
        };
      }),
    };
    setProposal(next);
  };

  const toggleChecklist = (nodeIdx: number, childIdx: number, clIdx: number): void => {
    const cur = proposal();
    if (!cur || nodeIdx < 0 || nodeIdx >= cur.nodes.length) return;
    const node = cur.nodes[nodeIdx];
    if (!node || childIdx < 0 || childIdx >= node.children.length) return;
    const child = node.children[childIdx];
    if (!child || clIdx < 0 || clIdx >= child.checklists.length) return;
    const next: WizardProposal = {
      ...cur,
      nodes: cur.nodes.map((n, i) => {
        if (i !== nodeIdx) return n;
        return {
          ...n,
          children: n.children.map((c, j) => {
            if (j !== childIdx) return c;
            return {
              ...c,
              checklists: c.checklists.map((cl, k) =>
                k === clIdx ? { ...cl, selected: !cl.selected } : cl,
              ),
            };
          }),
        };
      }),
    };
    setProposal(next);
  };

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
    applyFailures,
    setApplyFailures,
    resultWorkspaceId,
    setResultWorkspaceId,
    errorMsg,
    setErrorMsg,
    toggleNode,
    toggleChild,
    toggleChecklist,
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
