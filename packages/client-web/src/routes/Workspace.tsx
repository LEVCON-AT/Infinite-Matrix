import { Show, createEffect, createMemo, createResource, type Component } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { signOut, useUser } from '../lib/auth';
import {
  buildTree,
  fetchCellsForWorkspace,
  fetchMyWorkspaces,
  fetchNodesForWorkspace,
} from '../lib/queries';
import WorkspaceSwitcher from '../components/WorkspaceSwitcher';
import NodeTree from '../components/NodeTree';

const Workspace: Component = () => {
  const user = useUser();
  const params = useParams<{ workspaceId?: string; nodeId?: string }>();
  const navigate = useNavigate();

  const [workspaces] = createResource(() => fetchMyWorkspaces());

  // Default-Workspace auswaehlen, wenn URL keinen fuehrt.
  createEffect(() => {
    if (params.workspaceId) return;
    const list = workspaces();
    if (list && list.length > 0) {
      navigate(`/w/${list[0].id}`, { replace: true });
    }
  });

  const currentWs = createMemo(() => {
    const list = workspaces();
    if (!list || !params.workspaceId) return undefined;
    return list.find((w) => w.id === params.workspaceId);
  });

  const [nodes] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? fetchNodesForWorkspace(wid) : []),
  );

  const [cells] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? fetchCellsForWorkspace(wid) : []),
  );

  const tree = createMemo(() => buildTree(nodes() ?? [], cells() ?? []));

  const currentNode = createMemo(() => {
    if (!params.nodeId) return undefined;
    return (nodes() ?? []).find((n) => n.id === params.nodeId);
  });

  async function onLogout() {
    await signOut();
  }

  return (
    <div class="ws-shell">
      <aside class="ws-sidebar">
        <WorkspaceSwitcher
          workspaces={workspaces()}
          currentWorkspaceId={params.workspaceId}
        />
        <Show when={params.workspaceId}>
          <NodeTree
            workspaceId={params.workspaceId as string}
            tree={tree()}
            currentNodeId={params.nodeId}
          />
        </Show>
        <div class="ws-user-block">
          <span class="ws-email">{user()?.email}</span>
          <button type="button" onClick={onLogout}>
            Abmelden
          </button>
        </div>
      </aside>

      <main class="ws-main">
        <Show
          when={currentWs()}
          fallback={<p class="hint">Workspace waehlen.</p>}
        >
          <header class="ws-main-header">
            <h1>{currentWs()?.name}</h1>
          </header>

          <Show
            when={currentNode()}
            fallback={
              <p class="hint">
                Waehle links eine Matrix oder ein Board. Inhalt erscheint ab 0d.4.
              </p>
            }
          >
            <section class="node-preview">
              <h2>{currentNode()?.label || '(ohne Label)'}</h2>
              <p class="muted">
                Typ: {currentNode()?.type} · ID: <code>{currentNode()?.id}</code>
              </p>
              <p class="hint">Render ab 0d.4 (Matrix) bzw. 0d.5 (Board).</p>
            </section>
          </Show>
        </Show>
      </main>
    </div>
  );
};

export default Workspace;
