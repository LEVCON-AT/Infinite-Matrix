import { createSignal } from 'solid-js';

export type ToastKind = 'success' | 'error' | 'info';

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type Toast = {
  id: number;
  kind: ToastKind;
  msg: string;
  action?: ToastAction;
};

type ShowToastOptions = {
  ms?: number;
  action?: ToastAction;
};

const [toasts, setToasts] = createSignal<Toast[]>([]);
let _id = 0;

export function useToasts() {
  return toasts;
}

// Rueckwaerts-kompatibel: `showToast('msg', 'error')` oder
// `showToast('msg', 'info', { ms: 10000, action: {...} })`.
// Numerische ms als 3. Arg bleibt zugelassen.
export function showToast(
  msg: string,
  kind: ToastKind = 'info',
  msOrOpts: number | ShowToastOptions = 4200,
): number {
  const opts: ShowToastOptions =
    typeof msOrOpts === 'number' ? { ms: msOrOpts } : msOrOpts;
  const ms = opts.ms ?? (opts.action ? 10000 : 4200);
  const id = ++_id;
  setToasts((list) => [...list, { id, kind, msg, action: opts.action }]);
  window.setTimeout(() => dismissToast(id), ms);
  return id;
}

// Bequem-Wrapper fuer Undo-Flows. Der Callback wird genau einmal
// aufgerufen — wir dismissen den Toast sofort nach dem Click, damit
// man nicht doppelt rueckgaengig macht.
export function showUndoToast(
  label: string,
  onUndo: () => void,
): number {
  return showToast(label, 'info', {
    ms: 10000,
    action: {
      label: 'Rueckgaengig',
      onClick: onUndo,
    },
  });
}

export function dismissToast(id: number) {
  setToasts((list) => list.filter((t) => t.id !== id));
}
