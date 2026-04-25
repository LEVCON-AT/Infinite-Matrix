// Settings → Konto → Profil. Phase 1 (P1.A) Skeleton.
//
// Aktuell read-only: Email aus auth.user, Display-Name aus
// raw_user_meta_data.display_name. Edit-Pfad ist Phase 1.5+, weil
// Supabase-Auth-Update einen separaten RPC + Recovery-Pfad braucht.

import { Show } from 'solid-js';
import { useSession } from '../../lib/auth';

const AccountProfile = () => {
  const session = useSession();
  const user = () => session()?.user ?? null;
  const displayName = () => {
    const meta = user()?.user_metadata as Record<string, unknown> | undefined;
    const name = meta?.display_name;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  };

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
              <code class="settings-readback">{u().email ?? '—'}</code>
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
