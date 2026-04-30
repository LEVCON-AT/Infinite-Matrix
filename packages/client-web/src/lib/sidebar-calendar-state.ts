// Sidebar-Calendar-State (Phase 4 T.1.G.B Stufe 1).
//
// Mini-Calendar-Persistenz pro Workspace: pastCount, futureCount,
// selectedDay, isOpen. Im localStorage gehalten — der Mini-Calendar
// ist UI-State, nicht user-content (anders als working-hours, das
// am User-Profil haengt).
//
// Keys: matrix:sidebar-calendar:{workspaceId}.

import { type Accessor, createSignal } from 'solid-js';

export type SidebarCalendarState = {
  pastCount: number; // 0..5 (jeweils +2 Monate vor dem current)
  futureCount: number; // 0..11 (jeweils +2 Monate nach dem current; max 12 sichtbar inkl current)
  anchorIso: string; // 'YYYY-MM-DD' — Anker-Monat (wird vom 1. dieses Monats verwendet)
  selectedDay: string; // 'YYYY-MM-DD' — Tag in der Tagesansicht
  isOpen: boolean; // Calendar-Sektion offen?
};

const MAX_PAST = 5;
const MAX_FUTURE = 11;

export function clampPastCount(n: number): number {
  return Math.max(0, Math.min(MAX_PAST, n));
}

export function clampFutureCount(n: number): number {
  return Math.max(0, Math.min(MAX_FUTURE, n));
}

function storageKey(workspaceId: string): string {
  return `matrix:sidebar-calendar:${workspaceId}`;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultState(): SidebarCalendarState {
  const t = todayIso();
  return {
    pastCount: 0,
    futureCount: 0,
    anchorIso: t,
    selectedDay: t,
    isOpen: false,
  };
}

function load(workspaceId: string): SidebarCalendarState {
  if (!workspaceId) return defaultState();
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<SidebarCalendarState>;
    const def = defaultState();
    return {
      pastCount: clampPastCount(parsed.pastCount ?? def.pastCount),
      futureCount: clampFutureCount(parsed.futureCount ?? def.futureCount),
      anchorIso: typeof parsed.anchorIso === 'string' ? parsed.anchorIso : def.anchorIso,
      selectedDay: typeof parsed.selectedDay === 'string' ? parsed.selectedDay : def.selectedDay,
      isOpen: typeof parsed.isOpen === 'boolean' ? parsed.isOpen : def.isOpen,
    };
  } catch {
    return defaultState();
  }
}

function save(workspaceId: string, s: SidebarCalendarState): void {
  if (!workspaceId) return;
  try {
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(s));
  } catch {
    /* Quota — silent. */
  }
}

// Registry: pro workspaceId genau ein Signal — damit Sidebar +
// SidebarCalendarMini denselben State teilen.
const REGISTRY = new Map<
  string,
  {
    state: Accessor<SidebarCalendarState>;
    setState: (s: SidebarCalendarState) => void;
  }
>();

export function useSidebarCalendarState(workspaceId: string): {
  state: Accessor<SidebarCalendarState>;
  update: (patch: Partial<SidebarCalendarState>) => void;
} {
  let entry = REGISTRY.get(workspaceId);
  if (!entry) {
    const [state, setState] = createSignal<SidebarCalendarState>(load(workspaceId));
    entry = { state, setState };
    REGISTRY.set(workspaceId, entry);
  }
  const { state, setState } = entry;
  function update(patch: Partial<SidebarCalendarState>): void {
    const next = { ...state(), ...patch };
    if (typeof next.pastCount === 'number') next.pastCount = clampPastCount(next.pastCount);
    if (typeof next.futureCount === 'number') {
      next.futureCount = clampFutureCount(next.futureCount);
    }
    setState(next);
    save(workspaceId, next);
  }
  return { state, update };
}
