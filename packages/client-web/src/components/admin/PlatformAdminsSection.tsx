// Plattform-Admins-Sektion (Welle B B.0.D).
//
// Liste aller Plattform-Admins via list_platform_admins() — joint
// auth.users.email an. Grant per Email-Input → find_user_id_by_email +
// grant_platform_admin. Revoke direkt per User-Id.
//
// Schutz fuer letzten Admin: revoke_platform_admin RPC throwt
// 'last_admin_protected' wenn nur noch 1 Admin uebrig ist — Frontend
// zeigt translated-Toast.
//
// Step-Up-Auth (AAL2) fuer grant/revoke kommt mit B.3 — V1 nur
// is_platform_admin()-Gating.

import { type Component, For, Show, createResource, createSignal } from 'solid-js';
import {
  type PlatformAdminEntry,
  findUserIdByEmail,
  grantPlatformAdmin,
  listPlatformAdmins,
  revokePlatformAdmin,
} from '../../lib/admin';
import { useUser } from '../../lib/auth';
import { showConfirm } from '../../lib/dialog';
import { translateDbError } from '../../lib/errors';
import { showToast } from '../../lib/toasts';
import Icon from '../Icon';

const PlatformAdminsSection: Component = () => {
  const me = useUser();
  const [admins, { refetch }] = createResource(async () => {
    try {
      return await listPlatformAdmins();
    } catch (err) {
      console.error('listPlatformAdmins:', err);
      showToast(translateDbError(err, 'Liste nicht ladbar.'), 'error');
      return [] as PlatformAdminEntry[];
    }
  });

  const [grantEmail, setGrantEmail] = createSignal('');
  const [grantNote, setGrantNote] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  async function onGrant(e: Event) {
    e.preventDefault();
    if (busy()) return;
    const email = grantEmail().trim();
    if (!email) {
      showToast('Email fehlt.', 'error');
      return;
    }
    setBusy(true);
    try {
      const userId = await findUserIdByEmail(email);
      if (!userId) {
        showToast(`Kein User mit "${email}". Einladungs-Flow kommt mit B.1.`, 'info');
        return;
      }
      await grantPlatformAdmin(userId, grantNote().trim() || null);
      showToast(`${email} ist jetzt Plattform-Admin.`, 'success');
      setGrantEmail('');
      setGrantNote('');
      void refetch();
    } catch (err) {
      console.error('grantPlatformAdmin:', err);
      showToast(translateDbError(err, 'Befoerderung fehlgeschlagen.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(entry: PlatformAdminEntry) {
    if (busy()) return;
    const isSelf = entry.user_id === me()?.id;
    const ok = await showConfirm({
      title: 'Admin-Rolle entfernen?',
      message: isSelf
        ? 'Du entfernst dich SELBST aus den Plattform-Admins. Du kommst dann nicht mehr ohne service_role-SQL ins Admin-Dashboard. Sicher?'
        : `${entry.email} ist dann kein Plattform-Admin mehr. Sicher?`,
      variant: 'danger',
      confirmLabel: 'Entfernen',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await revokePlatformAdmin(entry.user_id);
      showToast('Admin-Rolle entfernt.', 'success');
      void refetch();
    } catch (err) {
      console.error('revokePlatformAdmin:', err);
      // last_admin_protected wird DB-seitig geworfen — translateDbError
      // matched es nicht generisch; Custom-Hint hier.
      const msg = String((err as { message?: string }).message ?? '');
      if (msg.includes('last_admin_protected')) {
        showToast('Der letzte Plattform-Admin kann nicht entfernt werden.', 'error');
      } else {
        showToast(translateDbError(err, 'Entfernen fehlgeschlagen.'), 'error');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section class="admin-section">
      <header class="admin-section-head">
        <h3>Plattform-Admins</h3>
      </header>

      <form class="admin-grant-form" onSubmit={onGrant}>
        <h4>Neuen Admin befoerdern</h4>
        <div class="admin-grant-row">
          <input
            type="email"
            value={grantEmail()}
            onInput={(e) => setGrantEmail(e.currentTarget.value)}
            placeholder="email@beispiel.com"
            required
            disabled={busy()}
          />
          <input
            type="text"
            value={grantNote()}
            onInput={(e) => setGrantNote(e.currentTarget.value)}
            placeholder="Notiz (optional)"
            disabled={busy()}
          />
          <button type="submit" class="btn-primary" disabled={busy()}>
            {busy() ? 'Speichere…' : 'Befoerdern'}
          </button>
        </div>
        <p class="hint">
          Setzt voraus dass der User schon einen Account hat. Einladungs-Flow kommt mit B.1.
        </p>
      </form>

      <Show when={!admins.loading} fallback={<p class="admin-loading">Lade Liste…</p>}>
        <Show when={(admins() ?? []).length > 0} fallback={<p class="hint">Keine Admins.</p>}>
          <ul class="admin-admins-list">
            <For each={admins() ?? []}>
              {(a) => (
                <li class="admin-admins-item">
                  <div class="admin-admins-info">
                    <strong>{a.email}</strong>
                    <Show when={a.note}>
                      <span class="admin-admins-note">— {a.note}</span>
                    </Show>
                    <span class="admin-admins-meta">
                      seit {new Date(a.granted_at).toLocaleDateString('de-DE')}
                      <Show when={a.user_id === me()?.id}>
                        <span class="admin-admins-self"> · du</span>
                      </Show>
                    </span>
                  </div>
                  <button
                    type="button"
                    class="btn-subtle admin-admins-revoke"
                    onClick={() => void onRevoke(a)}
                    disabled={busy()}
                  >
                    <Icon name="trash" size={14} />
                    <span>Entfernen</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </section>
  );
};

export default PlatformAdminsSection;
