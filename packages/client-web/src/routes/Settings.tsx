// Settings-Page-Layout — Phase 1 (P1.A).
//
// Linke Sub-Nav (220px desktop, kollabiert auf Mobile zu Bottom-Sheet
// < 960px) plus Outlet fuer das aktive Tab. Der Workspace-Kontext
// kommt aus dem Route-Param /w/:workspaceId/settings/... — ohne
// Workspace ist die Workspace-Section irrelevant, aber das Account-
// Section bleibt benutzbar.

import { A, useNavigate, useParams } from '@solidjs/router';
import { For, type ParentComponent, Show, createMemo, createResource } from 'solid-js';
import Icon, { type IconName } from '../components/Icon';
import { signOut, useSession } from '../lib/auth';
import { translateDbError } from '../lib/errors';
import { fetchMyWorkspaces } from '../lib/queries';
import { showToast } from '../lib/toasts';
import type { WorkspaceWithRole } from '../lib/types';

type NavItem = {
  to: string;
  label: string;
  icon: IconName;
  hint?: string;
};

const Settings: ParentComponent = (props) => {
  const params = useParams<{ workspaceId: string }>();
  const session = useSession();
  const navigate = useNavigate();

  // Identitaet fuer den User-Chip oben rechts. Email ist die zuverlaessige
  // Quelle (display_name kann leer sein); Avatar-Initial ist 1. Zeichen
  // davon. Bei fehlender Session laeuft das Layout durch — Auth-Guard auf
  // App-Ebene fangt das ab.
  const userEmail = createMemo<string | null>(() => session()?.user?.email ?? null);
  const userInitial = createMemo<string>(() => {
    const email = userEmail();
    return (email?.[0] ?? '?').toUpperCase();
  });

  const handleSignOut = async (): Promise<void> => {
    try {
      await signOut();
      navigate('/login');
    } catch (err) {
      showToast(translateDbError(err, 'Abmelden fehlgeschlagen.'), 'error');
    }
  };

  // Workspace-Liste fuer den Switcher in der Sub-Nav. Read-only Trigger
  // — fetchMyWorkspaces hat eigenes localStorage-Cache-Fallback.
  const [workspaces] = createResource(
    () => session()?.user?.id ?? null,
    () => fetchMyWorkspaces(),
  );

  const wsBase = () => `/w/${params.workspaceId}/settings`;

  const accountItems = (): NavItem[] => [
    {
      to: `${wsBase()}/account/profile`,
      label: 'Profil',
      icon: 'user',
      hint: 'Anzeigename, E-Mail, Avatar',
    },
    {
      to: `${wsBase()}/account/security`,
      label: 'Sicherheit',
      icon: 'lock-closed',
      hint: 'Sessions, Logout',
    },
    {
      to: `${wsBase()}/account/visibility`,
      label: 'Sichtbarkeit',
      icon: 'eye',
      hint: 'Bedienelemente ein/aus',
    },
  ];

  const workspaceItems = (): NavItem[] => [
    {
      to: `${wsBase()}/workspace/general`,
      label: 'Allgemein',
      icon: 'cog',
      hint: 'Name, Default-Rolle',
    },
    {
      to: `${wsBase()}/workspace/members`,
      label: 'Mitglieder',
      icon: 'users',
      hint: 'Einladen, Rollen, Audit',
    },
    {
      to: `${wsBase()}/workspace/audit`,
      label: 'Audit-Log',
      icon: 'list-bullet',
      hint: 'Mitglieder-Historie',
    },
  ];

  const currentWorkspace = (): WorkspaceWithRole | undefined =>
    workspaces()?.find((w) => w.id === params.workspaceId);

  return (
    <div class="settings-shell">
      <header class="settings-shell-head">
        <A
          href={`/w/${params.workspaceId}`}
          class="settings-back"
          aria-label="Zurueck zum Workspace"
        >
          <Icon name="arrow-left" size={16} />
          <span>Zurueck</span>
        </A>
        <h1 class="settings-title">Einstellungen</h1>
        <Show when={currentWorkspace()}>
          {(ws) => (
            <div class="settings-shell-head-ws">
              <span class="settings-ws-chip">{ws().name}</span>
              <span class={`settings-role-chip role-${ws().role}`}>{ws().role}</span>
              <Show when={ws().role !== 'owner' && ws().owner_email}>
                <span class="settings-owner-hint">Owner: {ws().owner_email}</span>
              </Show>
            </div>
          )}
        </Show>
        <Show when={userEmail()}>
          {(email) => (
            <div class="settings-userchip" aria-label="Eingeloggt als">
              <span class="settings-userchip-avatar" aria-hidden="true">
                {userInitial()}
              </span>
              <span class="settings-userchip-email" title={email()}>
                {email()}
              </span>
              <button
                type="button"
                class="settings-userchip-signout"
                onClick={() => void handleSignOut()}
                title="Abmelden"
                aria-label="Abmelden"
              >
                <Icon name="arrow-left" size={14} />
                <span>Abmelden</span>
              </button>
            </div>
          )}
        </Show>
      </header>

      <div class="settings-body-shell">
        <nav class="settings-nav" aria-label="Settings-Navigation">
          <section class="settings-nav-section">
            <h2 class="settings-nav-h">Konto</h2>
            <ul class="settings-nav-list">
              <For each={accountItems()}>
                {(item) => (
                  <li>
                    <A href={item.to} class="settings-nav-item" activeClass="active" end>
                      <Icon name={item.icon} size={16} />
                      <span class="settings-nav-label">{item.label}</span>
                      <Show when={item.hint}>
                        <span class="settings-nav-hint">{item.hint}</span>
                      </Show>
                    </A>
                  </li>
                )}
              </For>
            </ul>
          </section>
          <section class="settings-nav-section">
            <h2 class="settings-nav-h">Workspace</h2>
            <ul class="settings-nav-list">
              <For each={workspaceItems()}>
                {(item) => (
                  <li>
                    <A href={item.to} class="settings-nav-item" activeClass="active" end>
                      <Icon name={item.icon} size={16} />
                      <span class="settings-nav-label">{item.label}</span>
                      <Show when={item.hint}>
                        <span class="settings-nav-hint">{item.hint}</span>
                      </Show>
                    </A>
                  </li>
                )}
              </For>
            </ul>
          </section>
        </nav>

        <main class="settings-main" id="settings-main" tabIndex={-1}>
          {props.children}
        </main>
      </div>
    </div>
  );
};

export default Settings;
