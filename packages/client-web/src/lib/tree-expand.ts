// Per-Workspace-persistierter Expand-State fuer die Sidebar.
//
// Default-Verhalten: Root-Ebene ist offen, tiefere Ebenen sind zu.
// Die expliziten User-Toggles landen in localStorage (`matrix-tree-
// expand-<wsId>`), damit der State auch ueber Sessions + Tab-Wechsel
// ueberlebt.
//
// Das ExpandAll-Flag (Shift+A) haengt daneben: wenn true, ignorieren
// alle Nodes das Set und rendern auf. Sticky, bis der User es wieder
// ausmacht.

import { createEffect, createSignal } from 'solid-js';

type State = {
  expanded: Set<string>; // Node-IDs, die aufgeklappt sind
  all: boolean; // Sticky "alles expanded"
};

function storageKey(workspaceId: string): string {
  return `matrix-tree-expand-${workspaceId}`;
}

function loadState(workspaceId: string): State {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    if (!raw) return { expanded: new Set(), all: false };
    const parsed = JSON.parse(raw) as { expanded?: string[]; all?: boolean };
    return {
      expanded: new Set(parsed.expanded ?? []),
      all: !!parsed.all,
    };
  } catch {
    return { expanded: new Set(), all: false };
  }
}

function saveState(workspaceId: string, s: State): void {
  try {
    localStorage.setItem(
      storageKey(workspaceId),
      JSON.stringify({ expanded: [...s.expanded], all: s.all }),
    );
  } catch {
    /* ignore quota */
  }
}

// Ein Signal-Paar pro Workspace. Mehrfach-Aufruf mit derselben ID
// liefert denselben State-Speicher — so bleiben verschiedene
// Komponenten (NodeTree, Shortcut-Handler) synchron.
const REGISTRY = new Map<
  string,
  {
    state: () => State;
    setState: (v: State) => void;
  }
>();

export function useTreeExpand(workspaceId: string) {
  let entry = REGISTRY.get(workspaceId);
  if (!entry) {
    const [state, setState] = createSignal<State>(loadState(workspaceId));
    entry = { state, setState };
    REGISTRY.set(workspaceId, entry);

    createEffect(() => {
      saveState(workspaceId, state());
    });
  }

  const { state, setState } = entry;

  function toggle(nodeId: string): void {
    const cur = state();
    const next = new Set(cur.expanded);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    setState({ expanded: next, all: cur.all });
  }

  // Path-Focus-Helper: fuegt mehrere IDs in einem Rutsch ins Set, ohne
  // etwas zu entfernen. Gebraucht bei Navigation — der Weg zur aktuellen
  // Zelle/Feature-Row wird aufgeklappt, vorherige Expansions bleiben
  // unangetastet. Nur setState wenn sich wirklich etwas aendert, damit
  // der persist-Effect nicht bei jedem Nav-Tick feuert.
  function addToExpanded(ids: string[]): void {
    if (ids.length === 0) return;
    const cur = state();
    const next = new Set(cur.expanded);
    let changed = false;
    for (const id of ids) {
      if (!next.has(id)) {
        next.add(id);
        changed = true;
      }
    }
    if (!changed) return;
    setState({ expanded: next, all: cur.all });
  }

  function setExpandAll(v: boolean): void {
    const cur = state();
    setState({ expanded: cur.expanded, all: v });
  }

  function toggleExpandAll(): void {
    setExpandAll(!state().all);
  }

  function isExpanded(nodeId: string): boolean {
    const s = state();
    if (s.all) return true;
    return s.expanded.has(nodeId);
  }

  // Einmalig beim ersten Besuch eines Workspaces: Root-IDs als
  // Default-Expansion setzen, damit der User nicht erst alles
  // aufklappen muss. Kriterium: kein localStorage-Eintrag vorhanden
  // (nicht "Set leer" — das koennte eine bewusste Kollabierung sein).
  function seedIfFresh(rootIds: string[]): void {
    if (localStorage.getItem(storageKey(workspaceId)) !== null) return;
    if (rootIds.length === 0) return;
    const cur = state();
    const next = new Set(cur.expanded);
    for (const id of rootIds) next.add(id);
    setState({ expanded: next, all: cur.all });
  }

  return {
    state,
    isExpanded,
    toggle,
    addToExpanded,
    setExpandAll,
    toggleExpandAll,
    seedIfFresh,
  };
}
