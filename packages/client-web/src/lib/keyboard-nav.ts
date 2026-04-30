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
//
// Listener auf DOCUMENT: container.addEventListener feuert nur wenn
// Focus *innerhalb* des Containers ist — das verlangt vom User dass er
// vorher per Tab reingegangen ist UND dass kein Outer-Layer das Event
// schluckt. Document-Listener mit activeElement-Filter ist robust.
// Plus: wenn Pfeil-Down/Up gedrueckt wird und gar nichts fokussiert ist
// (oder Focus auf body/<App>-Wrapper), focussieren wir das erste Item
// — der User kommt dann sofort in die Listen-Navigation rein.
export function useArrowListNav(container: HTMLElement | null, itemSelector: string): void {
  if (!container) return;
  function items(): HTMLElement[] {
    if (!container) return [];
    return Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
  }
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (!container) return;
    const active = document.activeElement as HTMLElement | null;
    const focusInside =
      !!active &&
      active !== document.body &&
      active !== document.documentElement &&
      container.contains(active);
    // Wenn Focus weder im Container noch nirgendwo (body), uns ignorieren.
    // Damit klauen wir nicht die Pfeile, wenn der User in einem Input
    // oder anderen Widget arbeitet.
    const focusNowhere = !active || active === document.body || active === document.documentElement;
    if (!focusInside && !focusNowhere) return;
    const list = items();
    if (list.length === 0) return;
    const idx = focusInside ? list.indexOf(active as HTMLElement) : -1;
    let next: number;
    if (e.key === 'ArrowDown') {
      next = idx < 0 ? 0 : (idx + 1) % list.length;
    } else {
      next = idx <= 0 ? list.length - 1 : idx - 1;
    }
    e.preventDefault();
    list[next]?.focus();
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKey);
  }
  onCleanup(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', onKey);
    }
  });
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
  function isInputLike(el: HTMLElement | null): boolean {
    if (!el) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  }
  function focusContext(): { focusInside: boolean; focusNowhere: boolean } {
    if (!container) return { focusInside: false, focusNowhere: true };
    const active = document.activeElement as HTMLElement | null;
    const focusInside =
      !!active &&
      active !== document.body &&
      active !== document.documentElement &&
      container.contains(active);
    const focusNowhere = !active || active === document.body || active === document.documentElement;
    return { focusInside, focusNowhere };
  }
  function onKey(e: KeyboardEvent) {
    // Page-Tasten: nur reagieren wenn Focus im Grid oder nirgendwo —
    // nicht wenn der User in einem Input tippt.
    const ctx = focusContext();
    if (!ctx.focusInside && !ctx.focusNowhere) return;
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
      // T/H nur wenn Focus im Grid (nicht wenn nirgendwo — sonst klauen
      // wir Tastatur-Tippen das der User vielleicht woanders haben will).
      if (!ctx.focusInside) return;
      const a = document.activeElement as HTMLElement | null;
      if (isInputLike(a)) return;
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
    const idx = ctx.focusInside ? list.indexOf(active as HTMLElement) : -1;
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
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKey);
  }
  onCleanup(() => {
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', onKey);
    }
  });
}

// Kleiner Helfer: nach Mount einen Solid-`onMount`-Wrapper bauen, der
// den ref-Element fuer Tastatur-Initialisierung nutzt. Reduziert
// Boilerplate in Routes.
export function whenMounted(fn: () => void): void {
  onMount(fn);
}
