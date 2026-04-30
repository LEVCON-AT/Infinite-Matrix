// Keyboard-Navigation-Helper (Phase 4 T.1.X — Projekt-Standard).
//
// CLAUDE.md-Konvention "Kein globales ESC ohne Capture-Kontrolle"
// (Prinzip aus den Was-NICHT-tun-Hinweisen): wir nutzen den
// document-keydown-Listener mit `capture: false` und `stopPropagation`
// nur wenn die Taste tatsaechlich konsumiert wurde. Globale Handler
// (z.B. Sidebar-ESC fuer Stack-Pop) bekommen die nicht-konsumierten
// Events weiter.
//
// Verwendung im Solid-Component:
//   onMount(() => installEscReturn(() => navigate('/parent')));
//   <ul ref={(el) => useArrowListNav(el, 'button.row')}>…</ul>

import { onCleanup, onMount } from 'solid-js';

// ESC auf der Page → Eltern-Route navigieren. handler() darf sync
// oder async sein. Returns Cleanup-Function fuer manuellen Teardown,
// aber registriert sich automatisch via onCleanup.
export function installEscReturn(handler: () => void): () => void {
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    // Wenn ein Modal offen ist (data-modal-open im body), nicht
    // konsumieren — der Modal-eigene ESC-Handler hat Vorrang.
    if (typeof document !== 'undefined' && document.body.dataset.modalOpen === '1') return;
    // Wenn der Fokus in einem Input/Textarea/contenteditable steckt,
    // ESC erstmal blur-en (Standardverhalten). Erst beim zweiten ESC
    // navigieren — User kann sonst nicht aus einer Eingabe raus.
    const a = document.activeElement as HTMLElement | null;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) {
      a.blur();
      e.preventDefault();
      return;
    }
    e.preventDefault();
    handler();
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKey);
  }
  const cleanup = () => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', onKey);
    }
  };
  onCleanup(cleanup);
  return cleanup;
}

// Pfeil-↑↓-Navigation in Listen. Item-Selector liefert die fokussier-
// baren Eintraege im Container. Wraparound am Ende (Down beim letzten
// → erster, Up beim ersten → letzter). Enter/Space bleiben Default
// (native button click).
export function useArrowListNav(container: HTMLElement | null, itemSelector: string): void {
  if (!container) return;
  function items(): HTMLElement[] {
    if (!container) return [];
    return Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
  }
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const list = items();
    if (list.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? list.indexOf(active) : -1;
    let next: number;
    if (e.key === 'ArrowDown') {
      next = idx < 0 ? 0 : (idx + 1) % list.length;
    } else {
      next = idx <= 0 ? list.length - 1 : idx - 1;
    }
    e.preventDefault();
    list[next]?.focus();
  }
  container.addEventListener('keydown', onKey);
  onCleanup(() => container.removeEventListener('keydown', onKey));
}

// 4-direktionale Grid-Navigation. `cols` ist die Anzahl Spalten;
// itemSelector liefert alle Tag-Buttons in DOM-Reihenfolge (zeilen-
// weise, links→rechts, oben→unten). Pfeile bewegen Focus +/-1
// horizontal oder +/- cols vertikal. Wraparound am Anfang/Ende.
//
// Plus optionale Page-Hooks: PageDown/PageUp triggern handlers.onPageNext
// / onPagePrev — fuer Calendar-Monats-Wechsel ueber Bild-auf/-ab.
export type GridNavOptions = {
  onPageNext?: () => void;
  onPagePrev?: () => void;
  onHome?: () => void; // z.B. „T" → Heute
};

export function useGridNav(
  container: HTMLElement | null,
  itemSelector: string,
  cols: number,
  opts?: GridNavOptions,
): void {
  if (!container) return;
  function items(): HTMLElement[] {
    if (!container) return [];
    return Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'PageDown') {
      e.preventDefault();
      opts?.onPageNext?.();
      return;
    }
    if (e.key === 'PageUp') {
      e.preventDefault();
      opts?.onPagePrev?.();
      return;
    }
    if (e.key === 't' || e.key === 'T' || e.key === 'h' || e.key === 'H') {
      // T = Today, H = Home — beide setzen den Anchor zurueck.
      // Nur wenn Fokus im Grid-Container, sonst nicht greifen
      // (User koennte „T" in einem Input tippen wollen).
      const a = document.activeElement as HTMLElement | null;
      if (!a || !container?.contains(a)) return;
      if (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') return;
      e.preventDefault();
      opts?.onHome?.();
      return;
    }
    if (
      e.key !== 'ArrowDown' &&
      e.key !== 'ArrowUp' &&
      e.key !== 'ArrowLeft' &&
      e.key !== 'ArrowRight'
    ) {
      return;
    }
    const list = items();
    if (list.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? list.indexOf(active) : -1;
    let next: number;
    const total = list.length;
    if (idx < 0) {
      // Kein Item fokussiert — beim ersten Pfeil das erste fokussieren.
      next = 0;
    } else if (e.key === 'ArrowRight') {
      next = (idx + 1) % total;
    } else if (e.key === 'ArrowLeft') {
      next = idx === 0 ? total - 1 : idx - 1;
    } else if (e.key === 'ArrowDown') {
      next = idx + cols;
      if (next >= total) next = next % cols;
    } else {
      // ArrowUp
      next = idx - cols;
      if (next < 0) {
        const lastRowStart = total - (total % cols || cols);
        next = lastRowStart + (idx % cols);
        if (next >= total) next = total - 1;
      }
    }
    e.preventDefault();
    list[next]?.focus();
  }
  container.addEventListener('keydown', onKey);
  onCleanup(() => container.removeEventListener('keydown', onKey));
}

// Kleiner Helfer: nach Mount einen Solid-`onMount`-Wrapper bauen, der
// den ref-Element fuer Tastatur-Initialisierung nutzt. Reduziert
// Boilerplate in Routes.
export function whenMounted(fn: () => void): void {
  onMount(fn);
}
