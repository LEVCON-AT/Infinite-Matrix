// MFA-Gate-Dialog (Login-Flow). Zwingt User mit verifiziertem TOTP-
// Faktor nach Login zur Code-Eingabe → AAL2-Upgrade. Cancel = signOut.

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { signOut } from '../lib/auth';
import { dismissMfaGate, onMfaGateRequest, submitMfaGateCode } from '../lib/auth-mfa-gate';
import { translateDbError } from '../lib/errors';
import { showToast } from '../lib/toasts';

const MfaGateDialog: Component = () => {
  const [active, setActive] = createSignal<boolean>(false);
  const [code, setCode] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    const off = onMfaGateRequest((req) => {
      setActive(req !== null);
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
      await submitMfaGateCode(code());
      showToast('Anmeldung bestaetigt.', 'success');
    } catch (err) {
      showToast(translateDbError(err, 'Code ungueltig.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    dismissMfaGate();
    try {
      await signOut();
    } catch {
      // ignore — Local-Cleanup ist trotzdem gelaufen
    }
  }

  return (
    <Show when={active()}>
      <div class="overlay-scrim" aria-hidden={!active()}>
        <div
          class="overlay-card mfa-gate-card"
          // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> bewusst.
          role="dialog"
          aria-modal="true"
          aria-labelledby="mfa-gate-title"
        >
          <header class="overlay-head">
            <div class="overlay-head-text">
              <h2 id="mfa-gate-title">Zwei-Faktor erforderlich</h2>
              <p class="overlay-sub">
                Gib den 6-stelligen Code aus deiner Authenticator-App ein, um die Anmeldung
                abzuschliessen.
              </p>
            </div>
          </header>
          <form
            class="overlay-body mfa-gate-form"
            onSubmit={onSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') void onCancel();
            }}
          >
            <label class="login-field">
              <span>Code</span>
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
            <div class="mfa-gate-actions">
              <button
                type="submit"
                class="btn btn-primary lift"
                disabled={busy() || code().length !== 6}
              >
                Bestaetigen
              </button>
              <button
                type="button"
                class="btn-subtle"
                onClick={() => void onCancel()}
                disabled={busy()}
              >
                Abmelden
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
};

export default MfaGateDialog;
