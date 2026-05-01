// Step-Up-Dialog (Welle B.3).
//
// Wird global in App.tsx gerendert. Hoert auf onStepUpRequest aus
// lib/auth-step-up.ts. Bei aktivem Request: Modal mit TOTP-Code-
// Eingabe. Cancel resolved den Request mit 'cancelled'.

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { cancelStepUp, onStepUpRequest, submitStepUpCode } from '../lib/auth-step-up';
import { translateDbError } from '../lib/errors';
import { showToast } from '../lib/toasts';

const StepUpDialog: Component = () => {
  const [active, setActive] = createSignal<{ reason?: string } | null>(null);
  const [code, setCode] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    const off = onStepUpRequest((req) => {
      setActive(req ? { reason: req.reason } : null);
      setCode('');
    });
    onCleanup(off);
  });

  async function onSubmit(e: Event) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code())) {
      showToast('Bitte 6-stelligen Code eingeben.', 'error');
      return;
    }
    setBusy(true);
    try {
      await submitStepUpCode(code());
    } catch (err) {
      showToast(translateDbError(err, 'Code ungueltig.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  function onCancel() {
    cancelStepUp();
  }

  return (
    <Show when={active()}>
      {(req) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop-Klick — ESC-Capture im Form via key=Escape unten.
        <div class="overlay-scrim" onClick={(e) => e.target === e.currentTarget && onCancel()}>
          <div
            class="overlay-card step-up-card"
            // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> bewusst (siehe CardOverlay/CommandPalette).
            role="dialog"
            aria-modal="true"
            aria-labelledby="step-up-title"
          >
            <header class="overlay-head">
              <div class="overlay-head-text">
                <h2 id="step-up-title">Bestaetigung</h2>
                <p class="overlay-sub">
                  {req().reason ?? 'Sensitive Aktion — TOTP-Code erforderlich.'}
                </p>
              </div>
            </header>
            <form
              class="overlay-body step-up-form"
              onSubmit={onSubmit}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onCancel();
              }}
            >
              <label class="login-field">
                <span>6-stelliger Code aus deiner Authenticator-App</span>
                <input
                  class="input"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  autofocus
                  value={code()}
                  onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))}
                  disabled={busy()}
                />
              </label>
              <div class="step-up-actions">
                <button
                  type="submit"
                  class="btn btn-primary lift"
                  disabled={busy() || code().length !== 6}
                >
                  Bestaetigen
                </button>
                <button type="button" class="btn-subtle" onClick={onCancel} disabled={busy()}>
                  Abbrechen
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Show>
  );
};

export default StepUpDialog;
