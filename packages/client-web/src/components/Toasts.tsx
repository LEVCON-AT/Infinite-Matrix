import { type Component, For, Show } from 'solid-js';
import { dismissToast, useToasts } from '../lib/toasts';

const Toasts: Component = () => {
  const toasts = useToasts();
  return (
    <div
      class="toast-stack"
      // biome-ignore lint/a11y/useSemanticElements: bewusst <div role="status"> — div ist Container fuer mehrere Toast-Karten, role auf parent macht alle Toasts fuer Screen-Reader live.
      role="status"
      aria-live="polite"
    >
      <For each={toasts()}>
        {(t) => (
          <div class="toast" data-kind={t.kind}>
            <span class="toast-msg">{t.msg}</span>
            <Show when={t.action}>
              {(action) => (
                <button
                  type="button"
                  class="toast-action"
                  onClick={() => {
                    action().onClick();
                    dismissToast(t.id);
                  }}
                >
                  {action().label}
                </button>
              )}
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
