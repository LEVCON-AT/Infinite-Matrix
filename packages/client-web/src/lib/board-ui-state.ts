// Per-Board-persistierter UI-State. Aktuell: kollabierte Kanban-
// Spalten. Gleiches Muster wie tree-expand.ts: Registry haelt ein
// Signal pro Board, localStorage persistiert zwischen Sessions.

import { createEffect, createSignal } from 'solid-js';

type BoardUi = {
  collapsedCols: Set<string>;
};

function key(boardId: string): string {
  return `matrix-board-ui-${boardId}`;
}

function load(boardId: string): BoardUi {
  try {
    const raw = localStorage.getItem(key(boardId));
    if (!raw) return { collapsedCols: new Set() };
    const parsed = JSON.parse(raw) as { collapsedCols?: string[] };
    return { collapsedCols: new Set(parsed.collapsedCols ?? []) };
  } catch {
    return { collapsedCols: new Set() };
  }
}

function save(boardId: string, ui: BoardUi): void {
  try {
    localStorage.setItem(
      key(boardId),
      JSON.stringify({ collapsedCols: [...ui.collapsedCols] }),
    );
  } catch {
    /* ignore */
  }
}

const REGISTRY = new Map<
  string,
  { state: () => BoardUi; setState: (v: BoardUi) => void }
>();

export function useBoardUi(boardId: string) {
  let entry = REGISTRY.get(boardId);
  if (!entry) {
    const [state, setState] = createSignal<BoardUi>(load(boardId));
    entry = { state, setState };
    REGISTRY.set(boardId, entry);
    createEffect(() => save(boardId, state()));
  }
  const { state, setState } = entry;

  function toggleCol(colId: string): void {
    const cur = state();
    const next = new Set(cur.collapsedCols);
    if (next.has(colId)) next.delete(colId);
    else next.add(colId);
    setState({ collapsedCols: next });
  }

  function isCollapsed(colId: string): boolean {
    return state().collapsedCols.has(colId);
  }

  return { state, toggleCol, isCollapsed };
}
