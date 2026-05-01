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
    const c = code().trim();
    // Beide Formate: 6-stellig TOTP oder 14-Zeichen Backup-Code (12 + 2 -)
    const isTotp = /^\d{6}$/.test(c);
    const isBackup = /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(c);
    if (!isTotp && !isBackup) {
      showToast('6-stelligen Code aus der App ODER 12-stelligen Backup-Code eingeben.', 'error');
      return;
    }
    setBusy(true);
    try {
      await submitMfaGateCode(c);
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
              <span>Code (6-stellig aus App ODER Backup-Code)</span>
              <input
                class="input"
                type="text"
                inputmode="text"
                autocomplete="one-time-code"
                maxLength={14}
                autofocus
                value={code()}
                onInput={(e) => setCode(e.currentTarget.value)}
                disabled={busy()}
              />
            </label>
            <div class="mfa-gate-actions">
              <button
                type="submit"
                class="btn btn-primary lift"
                disabled={busy() || code().length < 6}
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
