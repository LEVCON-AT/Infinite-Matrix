// Sidebar-Modus-State (portiert aus dem HTML-Vorbild `sbState`).
//
// Drei Modi, zyklisch umschaltbar via Shift+N:
//   full      — volle Breite, Labels + Filter sichtbar (Default)
//   rails     — schmal, nur Icons/Chevrons sichtbar, Labels versteckt
//   collapsed — komplett weg, Edge-Toggle-Knopf sichtbar am Rand
//
// Persistiert pro Workspace in localStorage unter `matrix-sb-mode-<wsId>`,
// damit der Modus auch ueber Sessions + Tab-Wechsel ueberlebt.
//
// Analog zu tree-expand.ts gibt es eine Registry pro Workspace, damit
// mehrere Komponenten (Workspace-Shell, Shortcut-Handler, NodeTree)
// denselben State lesen.

import { createEffect, createSignal } from 'solid-js';

export type SidebarMode = 'full' | 'rails' | 'collapsed';

const DEFAULT_MODE: SidebarMode = 'full';
const CYCLE: Record<SidebarMode, SidebarMode> = {
  full: 'rails',
  rails: 'collapsed',
  collapsed: 'full',
};

function storageKey(workspaceId: string): string {
  return `matrix-sb-mode-${workspaceId}`;
}

function loadMode(workspaceId: string): SidebarMode {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    if (raw === 'full' || raw === 'rails' || raw === 'collapsed') return raw;
    return DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

function saveMode(workspaceId: string, m: SidebarMode): void {
  try {
    localStorage.setItem(storageKey(workspaceId), m);
  } catch {
    /* ignore quota */
  }
}

const REGISTRY = new Map<string, {
  mode: () => SidebarMode;
  setMode: (v: SidebarMode) => void;
}>();

export function useSidebarMode(workspaceId: string) {
  let entry = REGISTRY.get(workspaceId);
  if (!entry) {
    const [mode, setMode] = createSignal<SidebarMode>(loadMode(workspaceId));
    entry = { mode, setMode };
    REGISTRY.set(workspaceId, entry);

    createEffect(() => {
      saveMode(workspaceId, mode());
    });
  }

  const { mode, setMode } = entry;

  // Zyklet durch die drei Modi: full -> rails -> collapsed -> full.
  function cycle(): void {
    setMode(CYCLE[mode()]);
  }

  // Direkter Sprung, z.B. aus dem Edge-Toggle ("wieder aufmachen").
  function open(): void {
    if (mode() === 'collapsed') setMode('full');
  }

  return { mode, setMode, cycle, open };
}
