// Sidebar-Deep-Dive-Chips: opt-in Tree-Eintraege fuer Links, Mails, Docs.
// Default aus. Aktivierung wird per Workspace in localStorage persistiert,
// damit der User die Chips nicht bei jedem Tab-Wechsel neu setzen muss.
//
// Data-Fetch passiert in Workspace.tsx auf Basis der hier hinterlegten
// Chip-Flags (createResource-key abhaengig davon).

import { type Accessor, createEffect, createSignal } from 'solid-js';

export type SidebarChipKey = 'links' | 'mails' | 'docs';

export type SidebarChipsState = {
  links: boolean;
  mails: boolean;
  docs: boolean;
};

const DEFAULT_STATE: SidebarChipsState = {
  links: false,
  mails: false,
  docs: false,
};

function storageKey(workspaceId: string): string {
  return `matrix-sidebar-chips-${workspaceId}`;
}

function loadState(workspaceId: string): SidebarChipsState {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_STATE };
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw) as Partial<SidebarChipsState>;
    return {
      links: parsed.links === true,
      mails: parsed.mails === true,
      docs: parsed.docs === true,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(workspaceId: string, s: SidebarChipsState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(s));
  } catch {
    /* quota ignored */
  }
}

const REGISTRY = new Map<
  string,
  { state: Accessor<SidebarChipsState>; setState: (v: SidebarChipsState) => void }
>();

export function useSidebarChips(workspaceId: string) {
  let entry = REGISTRY.get(workspaceId);
  if (!entry) {
    const [state, setState] = createSignal<SidebarChipsState>(loadState(workspaceId));
    entry = { state, setState };
    REGISTRY.set(workspaceId, entry);
    createEffect(() => saveState(workspaceId, state()));
  }
  const { state, setState } = entry;

  function toggle(key: SidebarChipKey): void {
    const cur = state();
    setState({ ...cur, [key]: !cur[key] });
  }

  function isOn(key: SidebarChipKey): boolean {
    return state()[key];
  }

  return { state, isOn, toggle };
}
