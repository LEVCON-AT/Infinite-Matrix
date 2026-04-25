import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
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
  let rootEl: HTMLDivElement | undefined;

  const current = createMemo(() =>
    props.workspaces?.find((w) => w.id === props.currentWorkspaceId),
  );

  function close(): void {
    setOpen(false);
  }

  function toggle(e: MouseEvent): void {
    e.stopPropagation();
    setOpen((v) => !v);
  }

  function pick(id: string): void {
    close();
    if (id !== props.currentWorkspaceId) navigate(`/w/${id}`);
  }

  onMount(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!open()) return;
      const target = e.target as Node | null;
      if (rootEl && target && !rootEl.contains(target)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!open()) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => {
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKey, true);
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
          class="ws-switcher-anchor"
          aria-haspopup="listbox"
          aria-expanded={open()}
          onClick={toggle}
        >
          <span class="ws-name">{current()?.name ?? 'Auswaehlen'}</span>
          <Show when={current()}>
            <span class="ws-role">{roleLabel[current()!.role]}</span>
          </Show>
          <Icon
            name={open() ? 'chevron-up' : 'chevron-down'}
            size={14}
            class="ws-switcher-chev"
          />
        </button>
        <Show when={open()}>
          <ul class="ws-switcher-menu" role="listbox">
            <For each={props.workspaces}>
              {(ws) => (
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={ws.id === props.currentWorkspaceId}
                    classList={{ active: ws.id === props.currentWorkspaceId }}
                    onClick={() => pick(ws.id)}
                  >
                    <span class="ws-name">{ws.name}</span>
                    <span class="ws-role">{roleLabel[ws.role]}</span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  );
};

export default WorkspaceSwitcher;
