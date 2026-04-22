// Theme-Signal + Persistenz. Vorbild: matrix_tool_beta.html setzt
// document.documentElement.dataset.theme = 'light'|'dark'. Styles greifen
// ueber [data-theme="dark"]-Overrides in styles.css.
//
// Boot: localStorage.matrix-theme oder system-preference (prefers-color-
// scheme). Persistenz: jeder Toggle schreibt localStorage zurueck.

import { createSignal, onMount } from 'solid-js';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'matrix-theme';

function readInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage blockiert (private mode) — system fallback unten
  }
  if (typeof matchMedia === 'function') {
    try {
      if (matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch {
      // egal
    }
  }
  return 'light';
}

const [theme, setTheme] = createSignal<Theme>(readInitialTheme());

export function useTheme() {
  return theme;
}

function applyTheme(t: Theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = t;
}

export function setThemeValue(t: Theme) {
  setTheme(t);
  applyTheme(t);
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    // egal
  }
}

export function toggleTheme() {
  setThemeValue(theme() === 'dark' ? 'light' : 'dark');
}

// Einmal im App-Root mounten — appliciert das initial gelesene Theme ans
// <html>-Element. Ohne das bleibt data-theme nach Reload leer.
export function useThemeBootstrap() {
  onMount(() => {
    applyTheme(theme());
  });
}
