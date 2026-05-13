import { useNavigate } from '@solidjs/router';
import { type Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { WorkspaceWithRole } from '../lib/types';
import Icon from './Icon';

type Props = {
  workspaces: WorkspaceWithRole[] | undefined;
  currentWorkspaceId: string | undefined;
};

const roleLabel: Record<WorkspaceWithRole['role'], string> = {
  owner: 'Eigentuemer',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Betrachter',
};

// Click-to-open Dropdown statt vertikaler Stack — bei mehr als zwei
// Workspaces gehen die Buttons sonst aus der 44px-hohen Sidebar-Head
// hinaus und werden oben/unten abgeschnitten.
//
// Anchor zeigt den aktiven Workspace + chevron-down. Klick toggelt
// das Menue. ESC + Click-Outside schliessen. Tastatur: Anchor ist
// fokussierbar, Items im Menue auch — Pfeiltasten ueberlassen wir
// dem Browser-Default (Tab-Reihenfolge reicht fuer V1).
const WorkspaceSwitcher: Component<Props> = (props) => {
  const navigate = useNavigate();
  const [open, setOpen] = createSignal(false);
  // Portal-Render-Pos: gemessen vom Anchor-Button via getBoundingClientRect.
  // Wird beim Open-Trigger gesetzt + bei resize/scroll aktualisiert.
  const [pos, setPos] = createSignal<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  let rootEl: HTMLDivElement | undefined;
  let anchorEl: HTMLButtonElement | undefined;
  let menuEl: HTMLUListElement | undefined;

  const current = createMemo(() =>
    props.workspaces?.find((w) => w.id === props.currentWorkspaceId),
  );

  function close(): void {
    setOpen(false);
    setPos(null);
  }

  function measure(): void {
    if (!anchorEl) return;
    const r = anchorEl.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 4, width: r.width });
  }

  function toggle(e: MouseEvent): void {
    e.stopPropagation();
    if (open()) {
      close();
    } else {
      measure();
      setOpen(true);
    }
  }

  function pick(id: string): void {
    close();
    if (id !== props.currentWorkspaceId) navigate(`/w/${id}`);
  }

  function pickNewWorkspace(): void {
    close();
    // Re-Run-Pfad: Onboarding-Wizard mit kind='new' — createWorkspace
    // laeuft im Apply-Step. Siehe routes/Onboarding.tsx.
    navigate('/onboarding?fresh=1');
  }

  onMount(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!open()) return;
      const target = e.target as Node | null;
      // Click muss ausserhalb von Anchor UND Menu sein. Menu liegt im
      // Portal, also nicht in rootEl-contains-Reichweite — daher
      // separater Check auf menuEl.
      const insideAnchor = !!(rootEl && target && rootEl.contains(target));
      const insideMenu = !!(menuEl && target && menuEl.contains(target));
      if (!insideAnchor && !insideMenu) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!open()) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onResize = () => {
      if (open()) measure();
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    onCleanup(() => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    });
  });

  return (
    <div class="ws-switcher" ref={rootEl}>
      <Show
        when={props.workspaces && props.workspaces.length > 0}
        fallback={<div class="ws-empty">Kein Workspace.</div>}
      >
        <button
          type="button"
          ref={anchorEl}
          class="ws-switcher-anchor"
          aria-haspopup="listbox"
          aria-expanded={open()}
          onClick={toggle}
          title={current()?.description ?? undefined}
        >
          {/* F.3 — Logo-Mini (16x16) im Anchor; Fallback: kein Element
              (Anchor bleibt kompakt wenn kein Logo). */}
          <Show when={current()?.logo_url}>
            <img
              src={current()?.logo_url ?? ''}
              alt=""
              class="ws-switcher-logo"
              width={16}
              height={16}
              aria-hidden="true"
            />
          </Show>
          <span class="ws-name">{current()?.name ?? 'Auswaehlen'}</span>
          <Show when={current()}>{(c) => <span class="ws-role">{roleLabel[c().role]}</span>}</Show>
          <Icon name={open() ? 'chevron-up' : 'chevron-down'} size={14} class="ws-switcher-chev" />
        </button>
        <Show when={open() && pos()}>
          {(menuPos) => (
            <Portal mount={document.body}>
              <ul
                class="ws-switcher-menu"
                // biome-ignore lint/a11y/useSemanticElements: bewusst <ul role="listbox"> statt <select> — nativer <select> kann nicht via Portal gerendert werden und stylet uneinheitlich.
                // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA-Listbox auf ul ist Standard-Pattern fuer custom dropdowns.
                role="listbox"
                ref={menuEl}
                tabIndex={-1}
                style={{
                  '--ws-menu-x': `${menuPos().left}px`,
                  '--ws-menu-y': `${menuPos().top}px`,
                  '--ws-menu-min-w': `${menuPos().width}px`,
                }}
              >
                <For each={props.workspaces}>
                  {(ws) => (
                    <li>
                      <button
                        type="button"
                        // biome-ignore lint/a11y/useSemanticElements: bewusst <button role="option"> — option-element ist nur in <select> valide.
                        role="option"
                        aria-selected={ws.id === props.currentWorkspaceId}
                        classList={{ active: ws.id === props.currentWorkspaceId }}
                        onClick={() => pick(ws.id)}
                        title={ws.description ?? undefined}
                      >
                        {/* F.3 — Logo-Mini links in der Liste. */}
                        <Show when={ws.logo_url}>
                          <img
                            src={ws.logo_url ?? ''}
                            alt=""
                            class="ws-switcher-logo"
                            width={16}
                            height={16}
                            aria-hidden="true"
                          />
                        </Show>
                        <span class="ws-name">{ws.name}</span>
                        <span class="ws-role">{roleLabel[ws.role]}</span>
                        <Show when={ws.role !== 'owner' && ws.owner_email}>
                          <span class="ws-owner-sub">Owner: {ws.owner_email}</span>
                        </Show>
                      </button>
                    </li>
                  )}
                </For>
                <li class="ws-switcher-action-row">
                  <button
                    type="button"
                    class="ws-switcher-action"
                    onClick={pickNewWorkspace}
                    title="Mit dem KI-Wizard einen neuen Workspace bauen"
                  >
                    <Icon name="plus" size={12} />
                    <span>Neuer Workspace mit Wizard</span>
                  </button>
                </li>
              </ul>
            </Portal>
          )}
        </Show>
      </Show>
    </div>
  );
};

export default WorkspaceSwitcher;
