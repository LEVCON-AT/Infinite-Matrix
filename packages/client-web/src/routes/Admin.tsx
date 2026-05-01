// Admin-Dashboard (Welle B B.0.B).
//
// Route-Guard: nur Plattform-Admins (is_platform_admin()-RPC) sehen
// die Page. Non-Admins werden zu /workspace zurueck-redirected.
//
// Layout: Sidebar mit Sektionen (System-Config / Plattform-Admins /
// Audit-Log / Stats — V1 nur Stub-Tabs). Body je nach activeSection.
//
// Sub-Sprints:
// - B.0.B (this) — Shell, Auth-Guard, Sektion-Navigation, leere Bodies.
// - B.0.C — System-Config-Editor mit Provider-Slots (Google / GitHub /
//           LinkedIn / Microsoft / SMTP).
// - B.0.D — Plattform-Admins-Liste + Grant/Revoke (mit Step-Up in B.3).
// - B.0.E — Audit-Log-Viewer.
// - B.0.F — Stats-Section (User-Counts / Workspace-Counts).

import { useNavigate } from '@solidjs/router';
import { type Component, Show, createResource, createSignal } from 'solid-js';
import Icon from '../components/Icon';
import AuditLogSection from '../components/admin/AuditLogSection';
import PlatformAdminsSection from '../components/admin/PlatformAdminsSection';
import SystemConfigSection from '../components/admin/SystemConfigSection';
import { isPlatformAdmin } from '../lib/admin';
import { useUser } from '../lib/auth';
import { showToast } from '../lib/toasts';

type AdminSection = 'config' | 'admins' | 'audit' | 'stats';

const Admin: Component = () => {
  const user = useUser();
  const navigate = useNavigate();

  const [section, setSection] = createSignal<AdminSection>('config');

  // Auth-Guard: Plattform-Admin-Check via RPC. Nicht-Admins kriegen
  // einen Toast + Redirect zu / (Workspace-Default).
  const [authCheck] = createResource(
    () => user()?.id ?? null,
    async (uid) => {
      if (!uid) return false;
      return await isPlatformAdmin();
    },
  );

  // Side-Effect: Redirect wenn der Auth-Check ergeben hat dass User
  // kein Plattform-Admin ist. Wir nutzen kein createEffect mit early-
  // return, weil Resource-loading-State selbst falsy ist.
  function checkAndRedirect() {
    if (authCheck.loading) return;
    if (authCheck() === false) {
      showToast('Nur Plattform-Admins koennen das Dashboard oeffnen.', 'error');
      navigate('/', { replace: true });
    }
  }
  // Watcher als Render-Side-Effect laeuft bei jedem Render.
  // (Solid: createEffect waere sauberer, aber Resource-Loading-Toggling
  // mit einem Effect-Body fuehrt zu Doppel-Toasts. So wird's nur
  // gefeuert wenn checkAndRedirect explizit aufgerufen wird — siehe
  // Show-Block unten.)

  return (
    <div class="admin-shell">
      <Show when={!authCheck.loading} fallback={<p class="admin-loading">Lade Admin-Status…</p>}>
        <Show
          when={authCheck() === true}
          fallback={(() => {
            // false → redirect
            checkAndRedirect();
            return <p class="admin-loading">Weiterleitung…</p>;
          })()}
        >
          <aside class="admin-sidebar">
            <header class="admin-sidebar-head">
              <h2>Admin</h2>
              <span class="admin-email">{user()?.email}</span>
            </header>
            <nav class="admin-nav">
              <SectionButton
                active={section() === 'config'}
                onClick={() => setSection('config')}
                icon="cog"
                label="System-Config"
              />
              <SectionButton
                active={section() === 'admins'}
                onClick={() => setSection('admins')}
                icon="users"
                label="Plattform-Admins"
              />
              <SectionButton
                active={section() === 'audit'}
                onClick={() => setSection('audit')}
                icon="document-text"
                label="Audit-Log"
              />
              <SectionButton
                active={section() === 'stats'}
                onClick={() => setSection('stats')}
                icon="information-circle"
                label="Statistik"
              />
            </nav>
            <footer class="admin-sidebar-foot">
              <button
                type="button"
                class="btn-subtle"
                onClick={() => navigate('/', { replace: false })}
              >
                <Icon name="arrow-left" size={14} />
                <span>Zur App</span>
              </button>
            </footer>
          </aside>

          <main class="admin-main">
            <Show when={section() === 'config'}>
              <SystemConfigSection />
            </Show>
            <Show when={section() === 'admins'}>
              <PlatformAdminsSection />
            </Show>
            <Show when={section() === 'audit'}>
              <AuditLogSection />
            </Show>
            <Show when={section() === 'stats'}>
              <SectionStub
                title="Statistik"
                hint="User-Counts, Workspace-Counts, Aktivitaet. V1 reine Counts. Kommt mit B.0.F."
              />
            </Show>
          </main>
        </Show>
      </Show>
    </div>
  );
};

const SectionButton: Component<{
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}> = (p) => {
  return (
    <button
      type="button"
      class="admin-nav-btn"
      classList={{ 'admin-nav-btn-active': p.active }}
      onClick={p.onClick}
    >
      {/* Icon-name darf string sein — die Icon-Component dispatcht intern
          + tolerant. */}
      <Icon name={p.icon as never} size={16} />
      <span>{p.label}</span>
    </button>
  );
};

const SectionStub: Component<{ title: string; hint: string }> = (p) => {
  return (
    <section class="admin-section admin-section-stub">
      <header class="admin-section-head">
        <h3>{p.title}</h3>
      </header>
      <p class="hint">{p.hint}</p>
    </section>
  );
};

export default Admin;
