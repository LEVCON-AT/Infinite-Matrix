import { For, Show, type Component } from 'solid-js';
import { dismissToast, useToasts } from '../lib/toasts';

const Toasts: Component = () => {
  const toasts = useToasts();
  return (
    <div class="toast-stack" role="status" aria-live="polite">
      <For each={toasts()}>
        {(t) => (
          <div class="toast" data-kind={t.kind}>
            <span class="toast-msg">{t.msg}</span>
            <Show when={t.action}>
              <button
                type="button"
                class="toast-action"
                onClick={() => {
                  t.action!.onClick();
                  dismissToast(t.id);
                }}
              >
                {t.action!.label}
              </button>
            </Show>
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
