// Settings-Page-Layout — Phase 1 (P1.A) + Settings-Suchbar (P1.S).
//
// Linke Sub-Nav (220px desktop, kollabiert auf Mobile zu Bottom-Sheet
// < 960px) plus Outlet fuer das aktive Tab. Der Workspace-Kontext
// kommt aus dem Route-Param /w/:workspaceId/settings/... — ohne
// Workspace ist die Workspace-Section irrelevant, aber das Account-
// Section bleibt benutzbar.
//
// P1.S: Fuzzy-Suchbar im Header (F-Hotkey). Bei non-empty Query
// rendert die Sub-Nav einen Trefferliste statt der Default-Tabs.
// Hash-Scroll: bei /settings/<tab>#<anchorId> scrollt nach Mount
// zum Element + 1.5s Highlight-Pulse.

import { A, useLocation, useNavigate, useParams } from '@solidjs/router';
import {
  For,
  type ParentComponent,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import Icon, { type IconName } from '../components/Icon';
import { signOut, useSession } from '../lib/auth';
import { translateDbError } from '../lib/errors';
import { fetchMyWorkspaces } from '../lib/queries';
import { matchSettings, tabIcon, tabLabel } from '../lib/settings-search';
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
  const location = useLocation();

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
      console.error('signOut:', err);
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
    {
      to: `${wsBase()}/account/ai`,
      label: 'AI-Anbindung',
      icon: 'sparkles',
      hint: 'API-Key fuer Onboarding & Hilfe',
    },
    {
      to: `${wsBase()}/account/working-hours`,
      label: 'Arbeitszeiten',
      icon: 'clock',
      hint: 'Pro Wochentag Start/Ende + Buffer',
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

  // ─── Settings-Suchbar (P1.S) ─────────────────────────────────
  const [query, setQuery] = createSignal('');
  let searchInputEl: HTMLInputElement | undefined;

  const matches = createMemo(() => matchSettings(query()));

  // F-Hotkey wie in Workspace.tsx:614 — Buchstabe "f" fokussiert das
  // Suchfeld, ausser User tippt gerade in einem Input/Textarea/
  // contenteditable.
  onMount(() => {
    const isTextInput = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
      if (el.isContentEditable) return true;
      return false;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'f') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isTextInput(e.target)) return;
      e.preventDefault();
      searchInputEl?.focus();
      searchInputEl?.select();
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  // Hash-Scroll: bei /settings/<tab>#<anchor> nach Mount-Tick zur
  // Section scrollen + Pulse. Reagiert auf Pathname- und Hash-Wechsel.
  createEffect(() => {
    // Track beide Aenderungen.
    void location.pathname;
    const hash = location.hash;
    if (!hash) return;
    requestAnimationFrame(() => {
      const id = hash.replace(/^#/, '');
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('settings-search-highlight');
      setTimeout(() => el.classList.remove('settings-search-highlight'), 1500);
    });
  });

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
        <div class="settings-search">
          <Icon name="search" size={14} />
          <input
            ref={(el) => {
              searchInputEl = el;
            }}
            type="search"
            class="settings-search-input"
            placeholder="Einstellung suchen… (F)"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                if (query()) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery('');
                  return;
                }
                searchInputEl?.blur();
              }
            }}
            aria-label="Einstellungen durchsuchen"
            spellcheck={false}
            autocomplete="off"
          />
          <Show when={query()}>
            <button
              type="button"
              class="settings-search-clear"
              onClick={() => {
                setQuery('');
                searchInputEl?.focus();
              }}
              aria-label="Suche leeren"
            >
              <Icon name="x" size={12} />
            </button>
          </Show>
        </div>
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
          <Show
            when={query().trim()}
            fallback={
              <>
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
              </>
            }
          >
            <section class="settings-nav-section">
              <h2 class="settings-nav-h">Treffer</h2>
              <Show
                when={matches().length > 0}
                fallback={
                  <p class="settings-search-empty">
                    Keine Einstellung passt zu „<strong>{query()}</strong>".
                  </p>
                }
              >
                <ul class="settings-nav-list settings-nav-results">
                  <For each={matches()}>
                    {(hit) => {
                      const href = hit.anchorId
                        ? `${wsBase()}/${hit.tab}#${hit.anchorId}`
                        : `${wsBase()}/${hit.tab}`;
                      return (
                        <li>
                          <A href={href} class="settings-nav-item" activeClass="active" end>
                            <Icon name={tabIcon(hit.tab)} size={16} />
                            <span class="settings-nav-label">{hit.label}</span>
                            <span class="settings-nav-hint">{tabLabel(hit.tab)}</span>
                          </A>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </Show>
            </section>
          </Show>
        </nav>

        <main class="settings-main" id="settings-main" tabIndex={-1}>
          {props.children}
        </main>
      </div>
    </div>
  );
};

export default Settings;
