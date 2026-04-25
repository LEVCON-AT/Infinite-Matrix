// Globales Dialog-System als Ersatz fuer window.confirm/prompt/alert.
// Promise-basiert: Caller bekommt boolean / string / choice-id zurueck.
// Render-Seite: DialogHost (einmal am App-Root gemountet) liest das
// Queue-Signal und zeigt den Head-of-Queue im overlay-scrim/overlay-
// card-Pattern. Stack-Semantik: mehrere gleichzeitige Dialoge sind OK,
// ESC schliesst den obersten. Fokus wird auf den Primary-Button
// gesetzt.

import { createSignal } from 'solid-js';

export type DialogVariant = 'info' | 'warning' | 'danger';

export type DialogChoice = {
  id: string;
  label: string;
  variant?: 'primary' | 'danger' | 'default';
};

type ConfirmRequest = {
  kind: 'confirm';
  title: string;
  message: string;
  variant: DialogVariant;
  confirmLabel: string;
  cancelLabel: string;
  resolve: (ok: boolean) => void;
};

type ChoiceRequest = {
  kind: 'choice';
  title: string;
  message: string;
  choices: DialogChoice[];
  resolve: (id: string | null) => void;
};

type PromptRequest = {
  kind: 'prompt';
  title: string;
  message: string;
  initialValue: string;
  placeholder: string;
  confirmLabel: string;
  cancelLabel: string;
  // 'password' maskiert die Eingabe + schaltet Autocomplete aus (fuer
  // IMX-Passphrasen). 'text' ist der Standard fuer Umbenennen u.ae.
  inputType: 'text' | 'password';
  resolve: (value: string | null) => void;
};

export type DialogRequest = ConfirmRequest | ChoiceRequest | PromptRequest;

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `dlg-${idCounter}`;
}

// Queue der aktiven Dialoge. Neue Dialoge kommen hinten rein; DialogHost
// rendert das letzte Element (LIFO — so erscheint der neu geoeffnete
// oben auf dem Stapel).
const [queue, setQueue] = createSignal<Array<DialogRequest & { id: string }>>([]);

export function dialogQueue() {
  return queue();
}

function pushDialog<T>(req: DialogRequest): Promise<T> {
  return new Promise<T>((resolveOuter) => {
    // Wir tauschen resolve() aus, damit wir nach resolve() auch die
    // Queue aufraeumen. So kann der Caller einfach await showConfirm()
    // nutzen; wir pflegen intern Stack-State.
    const innerResolve = (value: unknown) => {
      setQueue((q) => q.filter((item) => item.id !== id));
      resolveOuter(value as T);
    };
    const id = nextId();
    const patched: DialogRequest = { ...req, resolve: innerResolve as never };
    setQueue((q) => [...q, { ...patched, id }]);
  });
}

export function showConfirm(opts: {
  title?: string;
  message: string;
  variant?: DialogVariant;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<boolean> {
  return pushDialog<boolean>({
    kind: 'confirm',
    title: opts.title ?? 'Bestaetigen',
    message: opts.message,
    variant: opts.variant ?? 'info',
    confirmLabel: opts.confirmLabel ?? 'OK',
    cancelLabel: opts.cancelLabel ?? 'Abbrechen',
    resolve: () => {},
  });
}

export function showChoice(opts: {
  title?: string;
  message: string;
  choices: DialogChoice[];
}): Promise<string | null> {
  return pushDialog<string | null>({
    kind: 'choice',
    title: opts.title ?? 'Auswahl',
    message: opts.message,
    choices: opts.choices,
    resolve: () => {},
  });
}

export function showPrompt(opts: {
  title?: string;
  message: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  inputType?: 'text' | 'password';
}): Promise<string | null> {
  return pushDialog<string | null>({
    kind: 'prompt',
    title: opts.title ?? 'Eingabe',
    message: opts.message,
    initialValue: opts.initialValue ?? '',
    placeholder: opts.placeholder ?? '',
    confirmLabel: opts.confirmLabel ?? 'OK',
    cancelLabel: opts.cancelLabel ?? 'Abbrechen',
    inputType: opts.inputType ?? 'text',
    resolve: () => {},
  });
}

// Focus-Trap fuer Modals (WCAG 2.1.2). Tab/Shift+Tab werden auf den
// Container eingefangen — wer den letzten Focusable-Knoten verlaesst,
// landet wieder auf dem ersten und umgekehrt. Ohne den Trap kann der
// Browser-Default-Tab-Order in die Untergrund-UI durchsickern, was bei
// einem aria-modal="true"-Dialog falsch ist.
//
// Selektor deckt die nativen Interaktiven plus alle Elemente mit
// explizitem tabindex>=0. tabindex="-1" ist programmatisch fokussierbar
// aber NICHT in der Tab-Reihenfolge — also korrekt ausgeschlossen.
// disabled/hidden-Elemente sind durch :not(...) gefiltert; Visibility-
// driven hidden (display:none) liefert offsetParent===null, das wird
// in getFocusable() final geprueft.
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function getFocusable(container: HTMLElement): HTMLElement[] {
  const list = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return list.filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    // offsetParent ist null fuer display:none Elements (oder fixed-
    // positioned, aber innerhalb eines Modals praktisch immer relevant
    // gestyled). Reicht fuer unsere Modal-Struktur.
    if (el.offsetParent === null && el.tagName !== 'BODY') return false;
    return true;
  });
}

// Focus-Restore (WCAG 2.4.3, Sprint AU-A4.3). Beim Modal-Open das
// derzeit fokussierte Element merken; beim Modal-Close den Fokus
// zuruecksetzen. Ohne Restore landet der Fokus nach Close auf <body>,
// der naechste Tab springt nach ganz vorne — Tastatur-Flow bricht.
//
// Aufruf-Pattern (in jedem Modal):
//   onMount(() => {
//     const restore = installFocusRestore();
//     onCleanup(restore);
//   });
//
// Schutz gegen Edge-Cases:
// - previous kann null sein (kein vorheriger Fokus, z.B. direkter
//   Modal-Open via URL-Hash). Dann wird einfach nichts gemacht.
// - previous kann inzwischen aus dem DOM entfernt worden sein
//   (z.B. das Element war in einer geschlossenen Sub-Liste). Dann
//   wuerde focus() ins Leere laufen — wir pruefen document.contains.
// - .focus?.() optional, weil manche Pseudo-Elemente (svg, foreignObject)
//   unter aelteren Browsern keine focus-Methode haben.
export function installFocusRestore(): () => void {
  const previous = document.activeElement as HTMLElement | null;
  return () => {
    if (previous && document.contains(previous)) {
      previous.focus?.();
    }
  };
}

export function installFocusTrap(container: HTMLElement): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const focusables = getFocusable(container);
    if (focusables.length === 0) {
      // Keine fokussierbaren Knoten — Container selbst nehmen, damit
      // der Fokus nicht in die Untergrund-UI rutscht.
      e.preventDefault();
      container.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    // Edge-Case: Fokus liegt aktuell ausserhalb des Containers (z.B.
    // weil ein Submit den Fokus verloren hat). Dann auf erstes Element
    // zuruecksetzen.
    if (!active || !container.contains(active)) {
      e.preventDefault();
      first.focus();
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  container.addEventListener('keydown', onKeyDown);
  return () => container.removeEventListener('keydown', onKeyDown);
}
