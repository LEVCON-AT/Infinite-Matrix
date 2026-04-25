import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

// Globaler Edit-Mode. Tastatur: Shift+E togglet. Body bekommt .edit-mode-Klasse,
// damit CSS-Regeln "nur wenn Edit aktiv" ohne Prop-Durchreicherei greifen.
const [editMode, setEditMode] = createSignal(false);

export function useEditMode() {
  return editMode;
}

export function toggleEditMode() {
  setEditMode((v) => !v);
}

export function setEditModeValue(v: boolean) {
  setEditMode(v);
}

// Einmal im App-Root mounten. Body-Klasse-Sync + globaler Shift+E-Shortcut.
export function useEditModeHotkey() {
  onMount(() => {
    createEffect(() => {
      document.body.classList.toggle('edit-mode', editMode());
    });

    const handler = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key !== 'E' && e.key !== 'e') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return;
      }
      e.preventDefault();
      toggleEditMode();
    };
    document.addEventListener('keydown', handler);
    onCleanup(() => document.removeEventListener('keydown', handler));
  });
}
