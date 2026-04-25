// Settings-Page-Layout — Phase 1 (P1.A).
//
// Linke Sub-Nav (220px desktop, kollabiert auf Mobile zu Bottom-Sheet
// < 960px) plus Outlet fuer das aktive Tab. Der Workspace-Kontext
// kommt aus dem Route-Param /w/:workspaceId/settings/... — ohne
// Workspace ist die Workspace-Section irrelevant, aber das Account-
// Section bleibt benutzbar.

import { A, useParams } from '@solidjs/router';
import { For, type ParentComponent, Show, createResource } from 'solid-js';
import Icon, { type IconName } from '../components/Icon';
import { useSession } from '../lib/auth';
import { fetchMyWorkspaces } from '../lib/queries';
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
          {(ws) => <span class="settings-ws-chip">{ws().name}</span>}
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
