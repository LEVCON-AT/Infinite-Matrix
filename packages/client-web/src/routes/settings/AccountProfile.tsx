// Settings → Konto → Profil. Phase 1 (P1.A) Skeleton + Welle F.5/F.6.
//
// Aktuell read-only: Email aus auth.user, Display-Name aus
// raw_user_meta_data.display_name. Edit-Pfad ist Phase 1.5+, weil
// Supabase-Auth-Update einen separaten RPC + Recovery-Pfad braucht.
//
// Welle F.5 — Email-Verification-Status-Badge: `email_confirmed_at`
// aus dem auth.user-Objekt entscheidet zwischen „verifiziert" und
// „bestaetigung ausstehend".
// Welle F.6 — Resend-Verification-Mail-Button: sichtbar wenn
// email_confirmed_at fehlt. supabase.auth.resend({type:'signup',email}).

import { Show, createSignal } from 'solid-js';
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

  return (
    <article class="settings-pane">
      <header class="settings-pane-head">
        <h2>Profil</h2>
        <p class="hint">
          Anzeigename und E-Mail. Editieren ist in einer kuenftigen Phase moeglich — aktuell
          read-only.
        </p>
      </header>
      <Show when={user()} fallback={<p class="settings-empty">Nicht eingeloggt.</p>}>
        {(u) => (
          <dl class="settings-form-grid">
            <dt>E-Mail</dt>
            <dd>
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
            </dd>
            <dt>Anzeigename</dt>
            <dd>
              <Show when={displayName()} fallback={<span class="hint">noch nicht gesetzt</span>}>
                <code class="settings-readback">{displayName()}</code>
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
