import { For, Show, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import type { WorkspaceWithRole } from '../lib/types';

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

const WorkspaceSwitcher: Component<Props> = (props) => {
  const navigate = useNavigate();

  // "Workspace"-Label aus der alten Stack-Variante entfernt — der
  // Switcher sitzt jetzt in der schmalen Sidebar-Head-Leiste inline
  // mit dem Collapse-Button. Multi-Workspace-Support waere ein Dropdown,
  // fuer V1 zeigen wir die Liste als Buttons nacheinander (skip-label).
  return (
    <div class="ws-switcher">
      <Show
        when={props.workspaces && props.workspaces.length > 0}
        fallback={<div class="ws-empty">Kein Workspace.</div>}
      >
        <ul class="ws-list">
          <For each={props.workspaces}>
            {(ws) => (
              <li>
                <button
                  type="button"
                  classList={{ active: ws.id === props.currentWorkspaceId }}
                  onClick={() => navigate(`/w/${ws.id}`)}
                >
                  <span class="ws-name">{ws.name}</span>
                  <span class="ws-role">{roleLabel[ws.role]}</span>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
};

export default WorkspaceSwitcher;
