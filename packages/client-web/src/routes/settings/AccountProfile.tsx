// Settings → Konto → Profil. Phase 1 (P1.A) Skeleton + Welle F.5/F.6 + D.1.
//
// Welle F.5 — Email-Verification-Status-Badge: `email_confirmed_at`
// aus dem auth.user-Objekt entscheidet zwischen „verifiziert" und
// „bestaetigung ausstehend".
// Welle F.6 — Resend-Verification-Mail-Button: sichtbar wenn
// email_confirmed_at fehlt. supabase.auth.resend({type:'signup',email}).
// Welle D.1 — Display-Name + Email-Aenderung: beide Inline-Edit-Pattern
// analog F.1 Workspace-Rename. Email-Change triggert Supabase-Verify-
// Mail auf die neue Adresse — bis zur Bestaetigung bleibt die alte
// Email aktiv (Supabase-Default, schuetzt vor Tippfehler-Lock).

import { Show, createSignal } from 'solid-js';
import Icon from '../../components/Icon';
import { changeEmail, setDisplayName } from '../../lib/account';
import { useSession } from '../../lib/auth';
import { translateDbError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/toasts';

const AccountProfile = () => {
  const session = useSession();
  const user = () => session()?.user ?? null;
  const displayName = () => {
    const meta = user()?.user_metadata as Record<string, unknown> | undefined;
    const name = meta?.display_name;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  };
  const emailVerified = () => Boolean(user()?.email_confirmed_at);

  const [resending, setResending] = createSignal(false);
  async function onResendVerification() {
    if (resending()) return;
    const email = user()?.email;
    if (!email) return;
    setResending(true);
    try {
      // F.6 — Resend-Verification. type='signup' deckt den Pending-State
      // ab; bei email-change-Flows ist type='email_change' der Pfad.
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (error) throw error;
      showToast('Bestaetigungsmail erneut versendet — Postfach pruefen.', 'success');
    } catch (err) {
      console.error('resendVerification:', err);
      showToast(translateDbError(err, 'Versand fehlgeschlagen.'), 'error');
    } finally {
      setResending(false);
    }
  }

  // ─── D.1 Display-Name Edit ─────────────────────────────────────
  const [nameEditing, setNameEditing] = createSignal(false);
  const [nameDraft, setNameDraft] = createSignal('');
  const [nameSaving, setNameSaving] = createSignal(false);
  function startEditName() {
    setNameDraft(displayName() ?? '');
    setNameEditing(true);
  }
  function cancelEditName() {
    setNameEditing(false);
    setNameDraft('');
  }
  async function saveEditName() {
    if (nameSaving()) return;
    const next = nameDraft().trim();
    if (next === (displayName() ?? '')) {
      cancelEditName();
      return;
    }
    setNameSaving(true);
    try {
      await setDisplayName(next);
      showToast(next ? 'Anzeigename gespeichert.' : 'Anzeigename entfernt.', 'success');
      setNameEditing(false);
    } catch (err) {
      console.error('setDisplayName:', err);
      showToast(translateDbError(err, 'Speichern fehlgeschlagen.'), 'error');
    } finally {
      setNameSaving(false);
    }
  }

  // ─── D.1 Email-Change ──────────────────────────────────────────
  const [emailEditing, setEmailEditing] = createSignal(false);
  const [emailDraft, setEmailDraft] = createSignal('');
  const [emailSaving, setEmailSaving] = createSignal(false);
  function startEditEmail() {
    setEmailDraft(user()?.email ?? '');
    setEmailEditing(true);
  }
  function cancelEditEmail() {
    setEmailEditing(false);
    setEmailDraft('');
  }
  async function saveEditEmail() {
    if (emailSaving()) return;
    const next = emailDraft().trim().toLowerCase();
    const cur = (user()?.email ?? '').toLowerCase();
    if (next === cur) {
      cancelEditEmail();
      return;
    }
    setEmailSaving(true);
    try {
      await changeEmail(next);
      showToast(
        'Bestaetigungs-Mail an neue Adresse versendet. Bis zur Bestaetigung bleibt die alte aktiv.',
        'success',
      );
      setEmailEditing(false);
    } catch (err) {
      console.error('changeEmail:', err);
      showToast(translateDbError(err, 'Aenderung fehlgeschlagen.'), 'error');
    } finally {
      setEmailSaving(false);
    }
  }

  return (
    <article class="settings-pane">
      <header class="settings-pane-head">
        <h2>Profil</h2>
        <p class="hint">
          Anzeigename und E-Mail. Email-Aenderung loest eine Bestaetigungs-Mail an die neue Adresse
          aus — bis du sie bestaetigst, bleibt die alte Email aktiv.
        </p>
      </header>
      <Show when={user()} fallback={<p class="settings-empty">Nicht eingeloggt.</p>}>
        {(u) => (
          <dl class="settings-form-grid">
            <dt>E-Mail</dt>
            <dd>
              <Show
                when={emailEditing()}
                fallback={
                  <span class="account-email-row">
                    <code class="settings-readback">{u().email ?? '—'}</code>
                    <Show
                      when={emailVerified()}
                      fallback={
                        <span
                          class="account-email-badge account-email-badge-pending"
                          title="E-Mail noch nicht bestaetigt"
                        >
                          Bestaetigung ausstehend
                        </span>
                      }
                    >
                      <span
                        class="account-email-badge account-email-badge-verified"
                        title="E-Mail bestaetigt"
                      >
                        Verifiziert
                      </span>
                    </Show>
                    <button
                      type="button"
                      class="btn-subtle settings-name-edit-btn"
                      onClick={startEditEmail}
                      title="E-Mail aendern"
                    >
                      <Icon name="pencil" size={14} />
                      <span>Aendern</span>
                    </button>
                    <Show when={!emailVerified() && u().email}>
                      <button
                        type="button"
                        class="btn-subtle"
                        onClick={onResendVerification}
                        disabled={resending()}
                        title="Bestaetigungs-Mail erneut senden"
                      >
                        {resending() ? 'Sende…' : 'Mail erneut senden'}
                      </button>
                    </Show>
                  </span>
                }
              >
                <form
                  class="settings-name-edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEditEmail();
                  }}
                >
                  <input
                    type="email"
                    class="settings-name-input"
                    value={emailDraft()}
                    onInput={(e) => setEmailDraft(e.currentTarget.value)}
                    maxLength={254}
                    autofocus
                    disabled={emailSaving()}
                    placeholder="neue@beispiel.com"
                  />
                  <button
                    type="submit"
                    class="btn btn-p"
                    disabled={emailSaving() || !emailDraft().trim()}
                  >
                    Bestaetigungs-Mail senden
                  </button>
                  <button
                    type="button"
                    class="btn-subtle"
                    onClick={cancelEditEmail}
                    disabled={emailSaving()}
                  >
                    Abbrechen
                  </button>
                </form>
              </Show>
            </dd>
            <dt>Anzeigename</dt>
            <dd>
              <Show
                when={nameEditing()}
                fallback={
                  <span class="settings-name-row">
                    <Show
                      when={displayName()}
                      fallback={<span class="hint">noch nicht gesetzt</span>}
                    >
                      <code class="settings-readback">{displayName()}</code>
                    </Show>
                    <button
                      type="button"
                      class="btn-subtle settings-name-edit-btn"
                      onClick={startEditName}
                      title="Anzeigename bearbeiten"
                    >
                      <Icon name="pencil" size={14} />
                      <span>{displayName() ? 'Bearbeiten' : 'Hinzufuegen'}</span>
                    </button>
                  </span>
                }
              >
                <form
                  class="settings-name-edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEditName();
                  }}
                >
                  <input
                    type="text"
                    class="settings-name-input"
                    value={nameDraft()}
                    onInput={(e) => setNameDraft(e.currentTarget.value)}
                    maxLength={80}
                    autofocus
                    disabled={nameSaving()}
                    placeholder="Wie sollst du erscheinen?"
                  />
                  <button type="submit" class="btn btn-p" disabled={nameSaving()}>
                    Speichern
                  </button>
                  <button
                    type="button"
                    class="btn-subtle"
                    onClick={cancelEditName}
                    disabled={nameSaving()}
                  >
                    Abbrechen
                  </button>
                </form>
              </Show>
            </dd>
            <dt>User-ID</dt>
            <dd>
              <code class="settings-readback settings-readback-mono">{u().id}</code>
            </dd>
          </dl>
        )}
      </Show>
    </article>
  );
};

export default AccountProfile;
