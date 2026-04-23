import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import { useLocation, useNavigate, useParams } from '@solidjs/router';
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
import { toggleTheme, useTheme } from '../lib/theme';
import { subscribeWorkspace } from '../lib/realtime';
import { useTreeExpand } from '../lib/tree-expand';
import { downloadWorkspaceExport, exportWorkspace } from '../lib/export';
import { showToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';
import WorkspaceSwitcher from '../components/WorkspaceSwitcher';
import NodeTree from '../components/NodeTree';
import MatrixView from '../components/MatrixView';
import BoardView from '../components/BoardView';
import CellChecklistsPage from '../components/CellChecklistsPage';
import CellInfoPage from '../components/CellInfoPage';
import AliasQuicknav from '../components/AliasQuicknav';
import ImportDialog from '../components/ImportDialog';
import KeyboardHelp from '../components/KeyboardHelp';
import NodeDescription from '../components/NodeDescription';
import PresenceStack from '../components/PresenceStack';

const Workspace: Component = () => {
  const user = useUser();
  const params = useParams<{
    workspaceId?: string;
    nodeId?: string;
    cellId?: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  const editMode = useEditMode();
  const theme = useTheme();

  // Zell-Page-Section: der letzte URL-Segment hinter /c/:cellId/ entscheidet,
  // welches Feature-Panel gerendert wird. "checklists" | "info" | sonst leer.
  const cellSection = createMemo<'checklists' | 'info' | null>(() => {
    const p = location.pathname;
    if (!params.cellId) return null;
    if (p.endsWith('/checklists')) return 'checklists';
    if (p.endsWith('/info')) return 'info';
    return null;
  });

  const [workspaces] = createResource(() => fetchMyWorkspaces());
  const [showImport, setShowImport] = createSignal(false);
  const [showQuicknav, setShowQuicknav] = createSignal(false);
  const [showHelp, setShowHelp] = createSignal(false);
  const [exporting, setExporting] = createSignal(false);

  async function onExport() {
    if (!params.workspaceId || exporting()) return;
    setExporting(true);
    try {
      const data = await exportWorkspace(params.workspaceId);
      const name = currentWs()?.name ?? 'workspace';
      downloadWorkspaceExport(data, name);
      showToast('Export heruntergeladen.', 'success');
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setExporting(false);
    }
  }

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

  // Aktuelle Zelle bei /c/:cellId-Routen (z.B. Cell-Checklisten-Page).
  const currentCell = createMemo(() => {
    if (!params.cellId) return undefined;
    return (cells() ?? []).find((c) => c.id === params.cellId);
  });

  // Breadcrumb vom aktuellen Node aufwaerts. Geht von Node zu Parent-
  // Cell (via node.parent_cell_id) und von dort zur Parent-Matrix
  // (cell.matrix_id = Node-ID der Matrix, in der die Cell lebt).
  // Stoppt wenn parent_cell_id NULL ist (Root) oder die Parent-Cell
  // nicht gefunden wird (Orphan — buildTree macht das zu einem Root).
  //
  // Bei Cell-Routen (/c/:cellId) ist der Start die Parent-Matrix der
  // Zelle. Die Zelle selbst wird nicht eigens als Crumb gerendert;
  // das aktuelle Section-Label steht ohnehin auf der Cell-Page.
  const breadcrumb = createMemo<
    Array<{ id: string; label: string; type: 'matrix' | 'board' }>
  >(() => {
    const nodesList = nodes() ?? [];
    const cellsList = cells() ?? [];
    const byNodeId = new Map(nodesList.map((n) => [n.id, n]));
    const byCellId = new Map(cellsList.map((c) => [c.id, c]));

    let startNodeId: string | undefined;
    const c = currentCell();
    if (c) {
      startNodeId = c.matrix_id;
    } else {
      startNodeId = currentNode()?.id;
    }
    if (!startNodeId) return [];

    const chain: Array<{ id: string; label: string; type: 'matrix' | 'board' }> = [];
    let cursor = byNodeId.get(startNodeId);
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      chain.unshift({
        id: cursor.id,
        label: cursor.label || '(ohne Label)',
        type: cursor.type,
      });
      if (!cursor.parent_cell_id) break;
      const pc = byCellId.get(cursor.parent_cell_id);
      if (!pc) break;
      cursor = byNodeId.get(pc.matrix_id);
    }
    return chain;
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
  const [boardContent, { refetch: refetchBoard }] = createResource(
    () => {
      const n = currentNode();
      if (!n || n.type !== 'board') return null;
      return { boardId: n.id, workspaceId: n.workspace_id };
    },
    async (key) => (key ? fetchBoardContent(key.boardId, key.workspaceId) : undefined),
  );

  // Rows + Cols der Parent-Matrix der aktuellen Zelle — fuer den
  // Breadcrumb (Row × Col) auf der Zell-Page. Greift nur bei /c/:cellId-
  // Routen; sonst null.
  const [cellMatrixContent, { refetch: refetchCellMatrix }] = createResource(
    () => {
      const c = currentCell();
      if (!c) return null;
      return { matrixId: c.matrix_id, workspaceId: c.workspace_id };
    },
    async (key) => (key ? fetchMatrixContent(key.matrixId, key.workspaceId) : undefined),
  );

  // Realtime-Version-Zaehler fuer Tabellen, deren Daten in Kind-
  // Komponenten gefetcht werden. Die Kinder beobachten die Signale
  // und refetchen selbst. Ein Zaehler pro Tabelle reicht — wir
  // brauchen keine Detail-Payload, die Komponente weiss selbst was
  // sie zu laden hat. Getrennt fuer checklists + checklist_items,
  // weil die Cell-Checklisten-Seite beide interessiert, die
  // Board-View aber schon ueber refetchBoard abgedeckt ist.
  const [rtCellChecklists, setRtCellChecklists] = createSignal(0);

  const cellRow = createMemo(() => {
    const c = currentCell();
    const mc = cellMatrixContent();
    if (!c || !mc) return undefined;
    return mc.rows.find((r) => r.id === c.row_id);
  });

  const cellCol = createMemo(() => {
    const c = currentCell();
    const mc = cellMatrixContent();
    if (!c || !mc) return undefined;
    return mc.cols.find((cl) => cl.id === c.col_id);
  });

  async function onLogout() {
    await signOut();
  }

  // ESC = eine Ebene hoch. Drei Pfade:
  //   a) Sub-Matrix/Board (Node mit parent_cell_id) → Parent-Matrix
  //   b) Cell-Page (/c/:cellId) → zur Matrix der Zelle
  //   c) Root-Matrix → nichts (kein Hoch mehr)
  // Bubble-Phase — Modals (CellOverlay, ImportDialog) haengen in Capture
  // mit stopImmediatePropagation, schlucken ihr ESC vor uns weg.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!params.workspaceId) return;
      const c = currentCell();
      if (c) {
        navigate(`/w/${params.workspaceId}/n/${c.matrix_id}`);
        return;
      }
      const n = currentNode();
      if (!n || !n.parent_cell_id) return;
      const parentCell = (cells() ?? []).find((pc) => pc.id === n.parent_cell_id);
      if (!parentCell) return;
      navigate(`/w/${params.workspaceId}/n/${parentCell.matrix_id}`);
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  // Quicknav: Ctrl+K / Cmd+K ODER direktes ^ oeffnen das Alias-Modal.
  //
  // ^-Erkennung cross-layout:
  //   - US-Tastatur: Shift+6 liefert e.key = '^'
  //   - Deutsche Tastatur: e.key = '^' direkt (kein Shift)
  //   - Mit aktiver Dead-Key-Semantik (Firefox/Chrome auf Linux/Win DE):
  //     e.key = 'Dead' + e.code = 'Backquote' — der Tote-Akzent, der
  //     sonst das naechste Zeichen modifizieren wuerde
  //
  // Wenn der User in einem Input/Textarea tippt, lassen wir ^ als
  // normales Zeichen durch — sonst kann er kein Zirkumflex im Text
  // mehr setzen. Gleiche Regel fuer Cmd+K (OS-Konvention: in Inputs
  // ignorieren).
  onMount(() => {
    const isTextInput = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
      if (el.isContentEditable) return true;
      return false;
    };

    const onKey = (e: KeyboardEvent) => {
      if (!params.workspaceId) return;
      if (showQuicknav()) return;

      // Cmd/Ctrl+K
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        if (e.key === 'k' || e.key === 'K') {
          if (isTextInput(e.target)) return;
          e.preventDefault();
          setShowQuicknav(true);
          return;
        }
      }

      // Shift+A: Expand-All-Tree togglen (sticky pro Workspace).
      // In Text-Inputs ignorieren — sonst kann man kein A eintippen.
      if (
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === 'A' || e.key === 'a')
      ) {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        useTreeExpand(params.workspaceId).toggleExpandAll();
        return;
      }

      // ? oeffnet/schliesst die Shortcut-Hilfe. Auf DE-Layout ist
      // ? = Shift+ß, auf US Shift+/. e.key ist '?' in beiden Faellen.
      // In Inputs ignorieren — sonst kann man kein ? eintippen.
      if (
        e.key === '?' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }

      // ^ direkt (ohne Modifier ausser evtl. Shift fuer US-Tastatur)
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const isCaret =
        e.key === '^' || (e.key === 'Dead' && e.code === 'Backquote');
      if (!isCaret) return;
      if (isTextInput(e.target)) return;
      e.preventDefault();
      setShowQuicknav(true);
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  // Realtime: pro Workspace einen Channel, der alle 9 Tabellen auf
  // der Postgres-Publication `supabase_realtime` broadcastet. Events
  // mappen wir 1:1 auf refetch-Calls. Der Channel wird beim
  // Workspace-Wechsel neu aufgebaut (createEffect haengt an
  // params.workspaceId), die Cleanup-Logik stammt aus
  // subscribeWorkspace (registriert onCleanup selbst).
  createEffect(() => {
    const wid = params.workspaceId;
    if (!wid) return;
    subscribeWorkspace(wid, {
      nodes: () => void refetchNodes(),
      cells: () => {
        void refetchCells();
        // Eine Cell-Mutation kann Feature-Pills in der aktuellen
        // Matrix/Board-Ansicht veraendern (z.B. child_matrix_id
        // gesetzt). Falls die betroffene Matrix gerade offen ist,
        // braucht sie frische Daten.
        void refetchMatrix();
        void refetchCellMatrix();
      },
      rows: () => {
        void refetchMatrix();
        void refetchCellMatrix();
      },
      cols: () => {
        void refetchMatrix();
        void refetchCellMatrix();
      },
      kb_cols: () => void refetchBoard(),
      kb_cards: () => void refetchBoard(),
      checklists: () => {
        void refetchBoard();
        setRtCellChecklists((v) => v + 1);
      },
      checklist_items: () => {
        void refetchBoard();
        setRtCellChecklists((v) => v + 1);
      },
      links: () => void refetchBoard(),
    });
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
            <button
              type="button"
              class="btn-subtle"
              onClick={onExport}
              disabled={exporting()}
              title="Kompletten Workspace als JSON herunterladen"
            >
              ⇩ Export
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

      <Show when={showQuicknav() && params.workspaceId}>
        <AliasQuicknav
          workspaceId={params.workspaceId as string}
          onClose={() => setShowQuicknav(false)}
        />
      </Show>

      <Show when={showHelp()}>
        <KeyboardHelp onClose={() => setShowHelp(false)} />
      </Show>

      <main class="ws-main">
        <Show
          when={currentWs()}
          fallback={<p class="hint">Workspace waehlen.</p>}
        >
          <header class="ws-main-header">
            <nav class="ws-breadcrumb" aria-label="Breadcrumb">
              <span class="ws-breadcrumb-ws">{currentWs()?.name}</span>
              <For each={breadcrumb()}>
                {(crumb, i) => {
                  const isLast = () => i() === breadcrumb().length - 1;
                  return (
                    <>
                      <span class="ws-breadcrumb-sep" aria-hidden>
                        /
                      </span>
                      <Show
                        when={!isLast()}
                        fallback={
                          <span
                            class="ws-breadcrumb-current"
                            data-type={crumb.type}
                          >
                            {crumb.label}
                          </span>
                        }
                      >
                        <a
                          class="ws-breadcrumb-link"
                          data-type={crumb.type}
                          href={`/w/${params.workspaceId}/n/${crumb.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            navigate(`/w/${params.workspaceId}/n/${crumb.id}`);
                          }}
                        >
                          {crumb.label}
                        </a>
                      </Show>
                    </>
                  );
                }}
              </For>
              <Show when={currentCell()}>
                <span class="ws-breadcrumb-sep" aria-hidden>
                  /
                </span>
                <span class="ws-breadcrumb-current" data-type="cell">
                  {cellRow()?.label || '(Zeile)'} × {cellCol()?.label || '(Spalte)'}
                </span>
              </Show>
            </nav>
            <Show when={params.workspaceId && user()}>
              <PresenceStack
                workspaceId={params.workspaceId as string}
                selfUserId={user()!.id}
                selfEmail={user()!.email ?? '(anon)'}
              />
            </Show>
            <button
              type="button"
              class="theme-toggle-btn"
              onClick={() => setShowHelp(true)}
              title="Tastatur-Shortcuts (?)"
              aria-label="Tastatur-Shortcuts"
            >
              ?
            </button>
            <button
              type="button"
              class="theme-toggle-btn"
              onClick={() => toggleTheme()}
              title={theme() === 'dark' ? 'Light-Mode' : 'Dark-Mode'}
              aria-label={theme() === 'dark' ? 'Light-Mode' : 'Dark-Mode'}
            >
              {theme() === 'dark' ? '☀' : '☾'}
            </button>
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
            when={currentCell() || currentNode()}
            fallback={
              <p class="hint">Waehle links eine Matrix oder ein Board.</p>
            }
          >
            <Show when={currentCell()}>
              <section class="node-view">
                <Show when={cellSection() === 'checklists'}>
                  <CellChecklistsPage
                    workspaceId={currentCell()!.workspace_id}
                    cell={currentCell()!}
                    row={cellRow()}
                    col={cellCol()}
                    realtimeVersion={rtCellChecklists()}
                  />
                </Show>
                <Show when={cellSection() === 'info'}>
                  <CellInfoPage
                    workspaceId={currentCell()!.workspace_id}
                    cell={currentCell()!}
                    row={cellRow()}
                    col={cellCol()}
                    onChanged={() => {
                      void refetchCells();
                    }}
                  />
                </Show>
              </section>
            </Show>

            <Show when={!currentCell() && currentNode()}>
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

                <NodeDescription
                  node={currentNode()!}
                  onChanged={() => void refetchNodes()}
                />

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
                    onChanged={() => {
                      void refetchBoard();
                    }}
                  />
                </Show>
              </section>
            </Show>
          </Show>
        </Show>
      </main>
    </div>
  );
};

export default Workspace;
