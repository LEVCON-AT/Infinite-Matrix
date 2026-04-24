// Renders die aktive Dialog-Queue aus lib/dialog.ts. Ein Dialog auf
// einmal sichtbar (der juengste, top-of-stack). Aeltere bleiben in
// der Queue und tauchen auf, wenn der aktuelle schliesst.
//
// Das overlay-scrim/overlay-card-Pattern ist dasselbe wie in
// KeyboardHelp und SettingsModal — damit Look+Feel konsistent.

import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import { dialogQueue, type DialogRequest } from '../lib/dialog';
import Icon from './Icon';

const DialogHost: Component = () => {
  const top = () => {
    const q = dialogQueue();
    return q.length > 0 ? q[q.length - 1] : null;
  };

  // Prompt-Input-State pro Dialog. Bei Dialog-Wechsel wird der Wert
  // auf initialValue zurueckgesetzt.
  const [promptValue, setPromptValue] = createSignal('');
  createEffect(() => {
    const d = top();
    if (d?.kind === 'prompt') {
      setPromptValue(d.initialValue);
    }
  });

  let primaryBtnRef: HTMLButtonElement | undefined;
  let promptInputRef: HTMLInputElement | undefined;

  // Fokus auf primary Button / Input beim Open. Micro-task-Defer, damit
  // das Element im DOM ist.
  createEffect(() => {
    const d = top();
    if (!d) return;
    requestAnimationFrame(() => {
      if (d.kind === 'prompt' && promptInputRef) {
        promptInputRef.focus();
        promptInputRef.select();
      } else if (primaryBtnRef) {
        primaryBtnRef.focus();
      }
    });
  });

  // ESC in Capture, um andere ESC-Handler nicht zu schlucken (die
  // rufen selbst stopImmediatePropagation in ihrem Scope auf).
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      const d = top();
      if (!d) return;
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        cancelTop();
      } else if (e.key === 'Enter' && d.kind !== 'choice') {
        // Choice-Dialoge sollen nicht versehentlich per Enter den
        // ersten Button ausloesen — User muss bewusst waehlen.
        e.preventDefault();
        confirmTop();
      }
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  function cancelTop() {
    const d = top();
    if (!d) return;
    if (d.kind === 'confirm') d.resolve(false);
    else d.resolve(null);
  }

  function confirmTop() {
    const d = top();
    if (!d) return;
    if (d.kind === 'confirm') d.resolve(true);
    else if (d.kind === 'prompt') d.resolve(promptValue());
    // Choice hat keine Enter-Default-Route.
  }

  function variantClass(
    d: DialogRequest,
    variant: 'primary' | 'danger' | 'default' | undefined,
  ): string {
    if (variant === 'danger') return 'btn-danger';
    if (variant === 'primary') return 'btn-c';
    if (d.kind === 'confirm' && d.variant === 'danger')
      return variant === 'default' ? 'btn-subtle' : 'btn-danger';
    return variant === 'default' ? 'btn-subtle' : 'btn-c';
  }

  return (
    <Show when={top()}>
      {(accessor) => {
        const d = () => accessor();
        return (
          <div
            class="overlay-scrim"
            onClick={(e) => {
              if (e.target === e.currentTarget) cancelTop();
            }}
          >
            <div
              class="overlay-card dialog-card"
              role="dialog"
              aria-modal="true"
              aria-label={d().title}
            >
              <header class="overlay-head">
                <h3>{d().title}</h3>
                <button
                  type="button"
                  class="overlay-close"
                  onClick={cancelTop}
                  aria-label="Schliessen"
                >
                  <Icon name="x" size={18} />
                </button>
              </header>
              <div class="overlay-body dialog-body">
                <p class="dialog-message">{d().message}</p>
                <Show when={d().kind === 'prompt'}>
                  <input
                    ref={promptInputRef}
                    type="text"
                    class="dialog-input"
                    value={promptValue()}
                    placeholder={
                      (d() as Extract<DialogRequest, { kind: 'prompt' }>)
                        .placeholder
                    }
                    onInput={(e) => setPromptValue(e.currentTarget.value)}
                  />
                </Show>
              </div>
              <footer class="overlay-foot dialog-foot">
                <Show when={d().kind === 'confirm'}>
                  {(() => {
                    const dd = d() as Extract<DialogRequest, { kind: 'confirm' }>;
                    return (
                      <>
                        <button
                          type="button"
                          class="btn-subtle"
                          onClick={() => dd.resolve(false)}
                        >
                          {dd.cancelLabel}
                        </button>
                        <button
                          ref={primaryBtnRef}
                          type="button"
                          class={variantClass(dd, undefined)}
                          onClick={() => dd.resolve(true)}
                        >
                          {dd.confirmLabel}
                        </button>
                      </>
                    );
                  })()}
                </Show>
                <Show when={d().kind === 'prompt'}>
                  {(() => {
                    const dd = d() as Extract<DialogRequest, { kind: 'prompt' }>;
                    return (
                      <>
                        <button
                          type="button"
                          class="btn-subtle"
                          onClick={() => dd.resolve(null)}
                        >
                          {dd.cancelLabel}
                        </button>
                        <button
                          ref={primaryBtnRef}
                          type="button"
                          class="btn-c"
                          onClick={() => dd.resolve(promptValue())}
                        >
                          {dd.confirmLabel}
                        </button>
                      </>
                    );
                  })()}
                </Show>
                <Show when={d().kind === 'choice'}>
                  {(() => {
                    const dd = d() as Extract<DialogRequest, { kind: 'choice' }>;
                    return (
                      <div class="dialog-choices">
                        <For each={dd.choices}>
                          {(c, idx) => (
                            <button
                              ref={idx() === 0 ? primaryBtnRef : undefined}
                              type="button"
                              class={variantClass(dd, c.variant)}
                              onClick={() => dd.resolve(c.id)}
                            >
                              {c.label}
                            </button>
                          )}
                        </For>
                      </div>
                    );
                  })()}
                </Show>
              </footer>
            </div>
          </div>
        );
      }}
    </Show>
  );
};

export default DialogHost;
