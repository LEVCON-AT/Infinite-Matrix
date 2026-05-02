// Settings → Konto → Sicherheit (Welle B.2 + B.1).
//
// Sektionen:
//   - MFA (TOTP-Enrollment + Liste + Unenroll).
//   - Logout (Phase 1 P1.A).
// Multi-Session-Management ist deferred.

import { useNavigate } from '@solidjs/router';
import { type Component, For, Show, createResource, createSignal } from 'solid-js';
import { signOut, signOutAllSessions, signOutOtherSessions } from '../../lib/auth';
import {
  type BackupCodesStatus,
  generateBackupCodes,
  getBackupCodesStatus,
} from '../../lib/backup-codes';
import { formatDateDE } from '../../lib/dates';
import { showConfirm } from '../../lib/dialog';
import { translateDbError } from '../../lib/errors';
import {
  type EnrollmentInit,
  type MfaFactor,
  enrollTotp,
  listMfaFactors,
  unenrollMfa,
  verifyTotpEnrollment,
} from '../../lib/mfa';
import { showToast } from '../../lib/toasts';

const AccountSecurity: Component = () => {
  const navigate = useNavigate();

  const [factors, { refetch }] = createResource(async () => {
    try {
      return await listMfaFactors();
    } catch (err) {
      console.error('listMfaFactors:', err);
      showToast(translateDbError(err, 'MFA-Faktoren nicht ladbar.'), 'error');
      return [] as MfaFactor[];
    }
  });

  const [enrollment, setEnrollment] = createSignal<EnrollmentInit | null>(null);
  const [verifyCode, setVerifyCode] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  async function startEnrollment() {
    setBusy(true);
    try {
      const init = await enrollTotp('Authenticator');
      setEnrollment(init);
      setVerifyCode('');
    } catch (err) {
      showToast(translateDbError(err, 'TOTP-Enrollment fehlgeschlagen.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function finishEnrollment() {
    const init = enrollment();
    if (!init) return;
    if (!/^\d{6}$/.test(verifyCode())) {
      showToast('Bitte 6-stelligen Code eingeben.', 'error');
      return;
    }
    setBusy(true);
    try {
      await verifyTotpEnrollment(init.factorId, verifyCode());
      setEnrollment(null);
      setVerifyCode('');
      showToast('TOTP aktiviert.', 'success');
      void refetch();
    } catch (err) {
      showToast(translateDbError(err, 'Code ungueltig.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function cancelEnrollment() {
    const init = enrollment();
    if (init) {
      try {
        await unenrollMfa(init.factorId);
      } catch {
        // ignore — Cleanup-Best-Effort
      }
    }
    setEnrollment(null);
    setVerifyCode('');
  }

  async function removeFactor(f: MfaFactor) {
    const ok = await showConfirm({
      title: 'TOTP entfernen?',
      message: `Authenticator "${f.friendlyName ?? 'Authenticator'}" deaktivieren? Du kannst ihn jederzeit neu einrichten.`,
      confirmLabel: 'Entfernen',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await unenrollMfa(f.id);
      showToast('TOTP entfernt.', 'success');
      void refetch();
    } catch (err) {
      showToast(translateDbError(err, 'Entfernen fehlgeschlagen.'), 'error');
    }
  }

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (err) {
      showToast(translateDbError(err, 'Logout fehlgeschlagen.'), 'error');
    }
  };

  return (
    <article class="settings-pane">
      <header class="settings-pane-head">
        <h2>Sicherheit</h2>
        <p class="hint">Multi-Faktor-Authentifizierung und Session-Management.</p>
      </header>

      <section class="settings-form-section">
        <h3>Zwei-Faktor (TOTP)</h3>
        <p class="hint">
          Authenticator-App (Google Authenticator, 1Password, Authy, ...) als zweiter Faktor.
        </p>

        <Show when={!enrollment()}>
          <Show
            when={!factors.loading && (factors() ?? []).length > 0}
            fallback={
              <button
                type="button"
                class="btn btn-primary lift"
                onClick={() => void startEnrollment()}
                disabled={busy() || factors.loading}
              >
                TOTP einrichten
              </button>
            }
          >
            <ul class="mfa-factor-list">
              <For each={factors()}>
                {(f) => (
                  <li class="mfa-factor-row">
                    <div class="mfa-factor-meta">
                      <strong>{f.friendlyName ?? 'Authenticator'}</strong>
                      <span class="hint">
                        {f.status === 'verified' ? 'aktiv' : 'pending'} · seit{' '}
                        {formatDateDE(f.createdAt)}
                      </span>
                    </div>
                    <button type="button" class="btn-subtle" onClick={() => void removeFactor(f)}>
                      Entfernen
                    </button>
                  </li>
                )}
              </For>
            </ul>
            <button
              type="button"
              class="btn btn-subtle"
              onClick={() => void startEnrollment()}
              disabled={busy()}
            >
              Weiteren Authenticator hinzufuegen
            </button>
          </Show>
        </Show>

        <Show when={enrollment()}>
          {(init) => (
            <div class="mfa-enroll">
              <p class="hint">
                Scanne den QR mit deiner Authenticator-App oder gib das Secret manuell ein.
              </p>
              <div class="mfa-qr" innerHTML={init().qrCode} aria-label="TOTP QR-Code" />
              <details class="mfa-secret">
                <summary>Secret manuell eingeben</summary>
                <code>{init().secret}</code>
              </details>
              <label class="login-field">
                <span>6-stelliger Code aus der App</span>
                <input
                  class="input"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={verifyCode()}
                  onInput={(e) => setVerifyCode(e.currentTarget.value.replace(/\D/g, ''))}
                  disabled={busy()}
                />
              </label>
              <div class="mfa-enroll-actions">
                <button
                  type="button"
                  class="btn btn-primary lift"
                  onClick={() => void finishEnrollment()}
                  disabled={busy() || verifyCode().length !== 6}
                >
                  Bestaetigen
                </button>
                <button
                  type="button"
                  class="btn-subtle"
                  onClick={() => void cancelEnrollment()}
                  disabled={busy()}
                >
                  Abbrechen
                </button>
              </div>
            </div>
          )}
        </Show>
      </section>

      <BackupCodesPane />

      <section class="settings-form-section">
        <h3>Sessions</h3>
        <p class="hint">
          Du bist auf diesem Geraet eingeloggt. "Andere Geraete abmelden" invalidiert die JWTs aller
          anderen offenen Sessions; sie muessen sich neu anmelden.
        </p>
        <div class="settings-foot">
          <button type="button" class="btn-c" onClick={() => void handleLogout()}>
            Abmelden (nur dieses Geraet)
          </button>
          <button
            type="button"
            class="btn-c"
            onClick={async () => {
              try {
                await signOutOtherSessions();
                showToast('Andere Sessions abgemeldet.', 'success');
              } catch (err) {
                showToast(translateDbError(err, 'Aktion fehlgeschlagen.'), 'error');
              }
            }}
          >
            Andere Geraete abmelden
          </button>
          <button
            type="button"
            class="btn btn-danger"
            onClick={async () => {
              const ok = await showConfirm({
                title: 'Alle Sessions abmelden?',
                message:
                  'Auch diese Session wird beendet. Du landest auf der Login-Seite und musst dich neu anmelden.',
                confirmLabel: 'Alle abmelden',
                variant: 'danger',
              });
              if (!ok) return;
              try {
                await signOutAllSessions();
                navigate('/login', { replace: true });
              } catch (err) {
                showToast(translateDbError(err, 'Aktion fehlgeschlagen.'), 'error');
              }
            }}
          >
            Alle Sessions abmelden
          </button>
        </div>
      </section>
    </article>
  );
};

// Backup-Codes-Sektion. Eigene Komponente weil mehrere Resources +
// Generate-Modal-State.
const BackupCodesPane: Component = () => {
  const [status, { refetch }] = createResource(async () => {
    try {
      return await getBackupCodesStatus();
    } catch (err) {
      console.error('getBackupCodesStatus:', err);
      return { total: 0, remaining: 0, used: 0 } as BackupCodesStatus;
    }
  });

  const [busy, setBusy] = createSignal(false);
  const [freshCodes, setFreshCodes] = createSignal<string[] | null>(null);

  async function generate() {
    const ok = await showConfirm({
      title: 'Backup-Codes neu generieren?',
      message:
        'Existing Codes werden ungueltig. Die neuen Codes siehst du nur einmal — bitte sofort sicher kopieren.',
      confirmLabel: 'Generieren',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const codes = await generateBackupCodes();
      setFreshCodes(codes);
      void refetch();
    } catch (err) {
      showToast(translateDbError(err, 'Generieren fehlgeschlagen.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  function copyAll() {
    const codes = freshCodes();
    if (!codes) return;
    void navigator.clipboard.writeText(codes.join('\n'));
    showToast('Codes in die Zwischenablage kopiert.', 'success');
  }

  return (
    <section class="settings-form-section">
      <h3>Backup-Codes</h3>
      <p class="hint">
        Single-use Codes als Fallback fuer den Authenticator. 10 Stueck pro Generierung; jeder Code
        ist nach Verwendung verbraucht.
      </p>

      <Show when={!freshCodes()}>
        <p class="hint">
          <Show when={!status.loading} fallback="Lade…">
            {status()?.remaining ?? 0} von {status()?.total ?? 0} Codes unbenutzt.
          </Show>
        </p>
        <button
          type="button"
          class="btn btn-subtle"
          onClick={() => void generate()}
          disabled={busy()}
        >
          {(status()?.total ?? 0) === 0 ? 'Codes erstellen' : 'Codes neu generieren'}
        </button>
      </Show>

      <Show when={freshCodes()}>
        {(codes) => (
          <div class="backup-codes-banner">
            <strong>Bitte sofort kopieren — die Codes erscheinen nur einmal.</strong>
            <ol class="backup-codes-list">
              <For each={codes()}>
                {(c) => (
                  <li>
                    <code>{c}</code>
                  </li>
                )}
              </For>
            </ol>
            <div class="backup-codes-actions">
              <button type="button" class="btn-subtle" onClick={copyAll}>
                Alle kopieren
              </button>
              <button type="button" class="btn-subtle" onClick={() => setFreshCodes(null)}>
                Ich habe sie gespeichert
              </button>
            </div>
          </div>
        )}
      </Show>
    </section>
  );
};

export default AccountSecurity;
