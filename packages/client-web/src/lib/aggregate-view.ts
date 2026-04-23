// Pro-Matrix View-State fuer die Aggregat-Sektion (Aufgabenuebersicht
// / Intervallmatrix). Analog zu lib/tree-expand.ts: Registry pro
// workspaceId-matrixId-Kombination, damit Workspace-Shortcut (Shift+W)
// und die Section denselben State teilen. localStorage persistiert.

import { createEffect, createSignal } from 'solid-js';

export type AggregateView = 'overview' | 'freq';

function storageKey(matrixId: string): string {
  return `matrix-agg-view-${matrixId}`;
}

function loadView(matrixId: string): AggregateView {
  try {
    const raw = localStorage.getItem(storageKey(matrixId));
    return raw === 'freq' ? 'freq' : 'overview';
  } catch {
    return 'overview';
  }
}

function saveView(matrixId: string, v: AggregateView): void {
  try {
    localStorage.setItem(storageKey(matrixId), v);
  } catch {
    /* ignore */
  }
}

const REGISTRY = new Map<string, {
  view: () => AggregateView;
  setView: (v: AggregateView) => void;
}>();

export function useAggregateView(matrixId: string) {
  let entry = REGISTRY.get(matrixId);
  if (!entry) {
    const [view, setView] = createSignal<AggregateView>(loadView(matrixId));
    entry = { view, setView };
    REGISTRY.set(matrixId, entry);
    createEffect(() => {
      saveView(matrixId, view());
    });
  }
  const { view, setView } = entry;

  function toggle(): void {
    setView(view() === 'overview' ? 'freq' : 'overview');
  }

  return { view, setView, toggle };
}
