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
const [queue, setQueue] = createSignal<Array<DialogRequest & { id: string }>>(
  [],
);

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
}): Promise<string | null> {
  return pushDialog<string | null>({
    kind: 'prompt',
    title: opts.title ?? 'Eingabe',
    message: opts.message,
    initialValue: opts.initialValue ?? '',
    placeholder: opts.placeholder ?? '',
    confirmLabel: opts.confirmLabel ?? 'OK',
    cancelLabel: opts.cancelLabel ?? 'Abbrechen',
    resolve: () => {},
  });
}
