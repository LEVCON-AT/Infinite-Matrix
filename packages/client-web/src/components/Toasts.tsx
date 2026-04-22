import { For, type Component } from 'solid-js';
import { dismissToast, useToasts } from '../lib/toasts';

const Toasts: Component = () => {
  const toasts = useToasts();
  return (
    <div class="toast-stack" role="status" aria-live="polite">
      <For each={toasts()}>
        {(t) => (
          <div class="toast" data-kind={t.kind}>
            <span class="toast-msg">{t.msg}</span>
            <button
              type="button"
              class="toast-close"
              aria-label="Schliessen"
              onClick={() => dismissToast(t.id)}
            >
              ✕
            </button>
          </div>
        )}
      </For>
    </div>
  );
};

export default Toasts;
