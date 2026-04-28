// Inline-Help-Drawer State + Hotkey (A.3).
//
// Globaler Toggle-Signal damit der Drawer von Header-Button und
// Hotkey aus geoeffnet werden kann. Default geschlossen, persistent
// per localStorage (User-Preference: wer den Drawer mag, hat ihn
// nach Reload wieder offen).

import { type Accessor, createSignal, onCleanup } from 'solid-js';

const STORAGE_KEY = 'ai-help-drawer-open';

const initial = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
})();

const [open, setOpen] = createSignal(initial);

function persist(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // QuotaExceeded — Persistence ist Bonus.
  }
}

export const useDrawerOpen: Accessor<boolean> = open;

export function openDrawer(): void {
  setOpen(true);
  persist(true);
}

export function closeDrawer(): void {
  setOpen(false);
  persist(false);
}

export function toggleDrawer(): void {
  const next = !open();
  setOpen(next);
  persist(next);
}

// Globaler Hotkey: Ctrl+K (Win/Linux) bzw. Cmd+K (Mac). Wird von
// App.tsx einmal registriert. ESC schliesst den Drawer wenn er offen
// ist — ESC laeuft in Capture-Phase, damit globale Back-Handler den
// Event nicht vorher schlucken.
export function useDrawerHotkey(): void {
  const onKey = (e: KeyboardEvent) => {
    // Toggle: Ctrl+K / Cmd+K
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      // In Inputs/Textareas darf der Browser-Default (z.B. Address-
      // Bar-Search auf manchen Setups) nicht zuschnappen — wir
      // greifen den Hotkey aber trotzdem.
      e.preventDefault();
      toggleDrawer();
      return;
    }
    // ESC schliesst nur wenn offen — und nur wenn der Drawer den
    // Fokus hat (sonst sollten andere Modals zuerst zugehen).
    if (e.key === 'Escape' && open()) {
      const target = e.target as HTMLElement | null;
      const drawer = document.querySelector('.ai-help-drawer');
      if (drawer && target && drawer.contains(target)) {
        e.stopImmediatePropagation();
        closeDrawer();
      }
    }
  };
  // Capture-Phase fuer ESC, damit der Workspace-Back-Handler nicht
  // vorher zugreift (siehe Workspace-Pattern).
  document.addEventListener('keydown', onKey, true);
  onCleanup(() => document.removeEventListener('keydown', onKey, true));
}
