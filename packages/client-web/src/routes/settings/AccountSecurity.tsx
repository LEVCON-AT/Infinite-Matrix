// Settings → Konto → Sicherheit. Phase 1 (P1.A) Skeleton.
//
// Aktuell nur Logout-Button + Hinweis. Multi-Session-Management
// (Sessions auflisten, einzeln widerrufen, "Alle abmelden") kommt
// Phase 2+ wenn Supabase-Auth-Admin-API exposed wird.

import { useNavigate } from '@solidjs/router';
import { signOut } from '../../lib/auth';
import { translateDbError } from '../../lib/errors';
import { showToast } from '../../lib/toasts';

const AccountSecurity = () => {
  const navigate = useNavigate();

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
        <p class="hint">
          Aktuelle Session abmelden. Multi-Session-Management (alle Geraete abmelden) kommt in einer
          kuenftigen Phase.
        </p>
      </header>
      <section class="settings-form-section">
        <button
          type="button"
          class="btn-c"
          onClick={() => {
            void handleLogout();
          }}
        >
          Abmelden
        </button>
      </section>
    </article>
  );
};

export default AccountSecurity;
