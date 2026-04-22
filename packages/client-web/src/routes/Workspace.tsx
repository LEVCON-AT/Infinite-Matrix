import {
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { signOut, useUser } from '../lib/auth';
import {
  buildTree,
  fetchBoardContent,
  fetchCellsForWorkspace,
  fetchMatrixContent,
  fetchMyWorkspaces,
  fetchNodesForWorkspace,
} from '../lib/queries';
import { toggleEditMode, useEditMode } from '../lib/edit-mode';
import WorkspaceSwitcher from '../components/WorkspaceSwitcher';
import NodeTree from '../components/NodeTree';
import MatrixView from '../components/MatrixView';
import BoardView from '../components/BoardView';
import ImportDialog from '../components/ImportDialog';

const Workspace: Component = () => {
  const user = useUser();
  const params = useParams<{ workspaceId?: string; nodeId?: string }>();
  const navigate = useNavigate();
  const editMode = useEditMode();

  const [workspaces] = createResource(() => fetchMyWorkspaces());
  const [showImport, setShowImport] = createSignal(false);

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

  const [nodes, { refetch: refetchNodes }] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? fetchNodesForWorkspace(wid) : []),
  );

  const [cells, { refetch: refetchCells }] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? fetchCellsForWorkspace(wid) : []),
  );

  const tree = createMemo(() => buildTree(nodes() ?? [], cells() ?? []));

  const currentNode = createMemo(() => {
    if (!params.nodeId) return undefined;
    return (nodes() ?? []).find((n) => n.id === params.nodeId);
  });

  // Matrix-Content fuer die aktuelle Node (nur wenn Typ=matrix).
  const [matrixContent, { refetch: refetchMatrix }] = createResource(
    () => {
      const n = currentNode();
      if (!n || n.type !== 'matrix') return null;
      return { matrixId: n.id, workspaceId: n.workspace_id };
    },
    async (key) => (key ? fetchMatrixContent(key.matrixId, key.workspaceId) : undefined),
  );

  // Board-Content fuer die aktuelle Node (nur wenn Typ=board).
  const [boardContent] = createResource(
    () => {
      const n = currentNode();
      if (!n || n.type !== 'board') return null;
      return { boardId: n.id, workspaceId: n.workspace_id };
    },
    async (key) => (key ? fetchBoardContent(key.boardId, key.workspaceId) : undefined),
  );

  async function onLogout() {
    await signOut();
  }

  // ESC in Matrix/Board-View = eine Ebene hoch (zur Parent-Matrix).
  // Bubble-Phase — Modals (CellOverlay, ImportDialog) haengen in Capture
  // mit stopImmediatePropagation, schlucken ihr ESC vor uns weg.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.isContentEditable)
      ) {
        return;
      }
      const n = currentNode();
      if (!n || !n.parent_cell_id) return;
      const parentCell = (cells() ?? []).find((c) => c.id === n.parent_cell_id);
      if (!parentCell) return;
      if (params.workspaceId) {
        navigate(`/w/${params.workspaceId}/n/${parentCell.matrix_id}`);
      }
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  async function onImported(rootNodeId: string) {
    // Tree neu laden, damit der Import im Sidebar sichtbar wird,
    // dann zur neuen Root-Node navigieren.
    await Promise.all([refetchNodes(), refetchCells()]);
    setShowImport(false);
    if (params.workspaceId) {
      navigate(`/w/${params.workspaceId}/n/${rootNodeId}`);
    }
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
        <div class="ws-actions">
          <Show when={params.workspaceId}>
            <button
              type="button"
              class="btn-subtle"
              onClick={() => setShowImport(true)}
            >
              + JSON importieren
            </button>
          </Show>
        </div>

        <div class="ws-user-block">
          <span class="ws-email">{user()?.email}</span>
          <button type="button" onClick={onLogout}>
            Abmelden
          </button>
        </div>
      </aside>

      <Show when={showImport() && params.workspaceId}>
        <ImportDialog
          workspaceId={params.workspaceId as string}
          onClose={() => setShowImport(false)}
          onImported={onImported}
        />
      </Show>

      <main class="ws-main">
        <Show
          when={currentWs()}
          fallback={<p class="hint">Workspace waehlen.</p>}
        >
          <header class="ws-main-header">
            <h1>{currentWs()?.name}</h1>
            <button
              type="button"
              class="edit-mode-btn"
              classList={{ active: editMode() }}
              onClick={() => toggleEditMode()}
              title="Edit-Mode (Shift+E)"
              aria-pressed={editMode()}
            >
              {editMode() ? 'Edit: an' : 'Edit: aus'}
            </button>
          </header>

          <Show
            when={currentNode()}
            fallback={
              <p class="hint">Waehle links eine Matrix oder ein Board.</p>
            }
          >
            <section class="node-view">
              <div class="node-view-head">
                <h2>{currentNode()?.label || '(ohne Label)'}</h2>
                <Show when={currentNode()?.alias}>
                  <span class="node-alias">^{currentNode()!.alias}</span>
                </Show>
                <span class="node-type-badge" data-type={currentNode()?.type}>
                  {currentNode()?.type}
                </span>
              </div>

              <Show when={currentNode()?.type === 'matrix'}>
                <MatrixView
                  workspaceId={currentNode()!.workspace_id}
                  matrixId={currentNode()!.id}
                  content={matrixContent()}
                  onChanged={() => {
                    // Nach strukturellen Aenderungen koennen neue/entfernte Sub-Nodes
                    // im Tree sichtbar werden, und cells.child_matrix_id/board_id
                    // aendern sich. Daher: nodes+cells auch refetchen.
                    void refetchMatrix();
                    void refetchNodes();
                    void refetchCells();
                  }}
                />
              </Show>

              <Show when={currentNode()?.type === 'board'}>
                <BoardView
                  workspaceId={currentNode()!.workspace_id}
                  boardId={currentNode()!.id}
                  content={boardContent()}
                />
              </Show>
            </section>
          </Show>
        </Show>
      </main>
    </div>
  );
};

export default Workspace;
