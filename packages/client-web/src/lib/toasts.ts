import { createSignal } from 'solid-js';

export type ToastKind = 'success' | 'error' | 'info';

export type Toast = {
  id: number;
  kind: ToastKind;
  msg: string;
};

const [toasts, setToasts] = createSignal<Toast[]>([]);
let _id = 0;

export function useToasts() {
  return toasts;
}

export function showToast(msg: string, kind: ToastKind = 'info', ms = 4200) {
  const id = ++_id;
  setToasts((list) => [...list, { id, kind, msg }]);
  window.setTimeout(() => dismissToast(id), ms);
}

export function dismissToast(id: number) {
  setToasts((list) => list.filter((t) => t.id !== id));
}
