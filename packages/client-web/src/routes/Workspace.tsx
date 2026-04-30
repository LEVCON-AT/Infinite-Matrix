import { useLocation, useNavigate, useParams } from '@solidjs/router';
import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import AliasAutocomplete from '../components/AliasAutocomplete';
import BoardView from '../components/BoardView';
import CellChecklistsPage from '../components/CellChecklistsPage';
import CellDocsPage from '../components/CellDocsPage';
import CellInfoPage from '../components/CellInfoPage';
import CommandPalette from '../components/CommandPalette';
import ContextMenu from '../components/ContextMenu';
import DocsPopup from '../components/DocsPopup';
import GlobalSearch from '../components/GlobalSearch';
import HeaderSearchBar from '../components/HeaderSearchBar';
import Icon from '../components/Icon';
import KeyboardHelp from '../components/KeyboardHelp';
import MatrixView from '../components/MatrixView';
import NodeDescription from '../components/NodeDescription';
import NodeTree from '../components/NodeTree';
import ObjectSuggestion from '../components/ObjectSuggestion';
import PresenceStack from '../components/PresenceStack';
import WorkspaceEmptyState from '../components/WorkspaceEmptyState';
import WorkspaceSwitcher from '../components/WorkspaceSwitcher';
import { useAggregateView } from '../lib/aggregate-view';
import { aliasChipMenuState, closeAliasChipMenu } from '../lib/alias-chip-menu';
import { clearAliasIndex, fetchAliasIndex, scheduleAliasRefresh } from '../lib/alias-index';
import { signOut, useUser } from '../lib/auth';
import { clearDocsRequest, openDocsPopup, useDocsRequest } from '../lib/docs-ui';
import { setEditModeValue, toggleEditMode, useEditMode } from '../lib/edit-mode';
import { toggleIncognito, useIncognito } from '../lib/incognito';
import { resolveNodeLabel } from '../lib/label-template';
import { fetchMembers } from '../lib/members';
import { pendingMutationCount, refreshCountForWorkspace, replayQueue } from '../lib/mutation-queue';
import { fetchObjects } from '../lib/objects';
import { offlineState } from '../lib/offline-state';
import { type PresencePosition, type PresenceUser, usePresence } from '../lib/presence';
import { installPromptSignal, triggerInstallPrompt } from '../lib/pwa';
import {
  type SidebarChipData,
  buildSidebarTree,
  fetchBoardContent,
  fetchCellIdsWithDocs,
  fetchCellsForWorkspace,
  fetchColsForWorkspace,
  fetchMatrixContent,
  fetchMyWorkspaces,
  fetchNodesForWorkspace,
  fetchRowsForWorkspace,
  fetchWorkspaceAttachedDocs,
  fetchWorkspaceLinks,
} from '../lib/queries';
import { subscribeWorkspace } from '../lib/realtime';
import { useSettingsBodyClassSync } from '../lib/settings';
import { useSidebarChips } from '../lib/sidebar-chips';
import { useSidebarMode } from '../lib/sidebar-mode';
import { toggleTheme, useTheme } from '../lib/theme';
import { showToast } from '../lib/toasts';
import { useTreeExpand } from '../lib/tree-expand';
import type { DocRow, LinkRow } from '../lib/types';
import { canWrite, isViewer, setViewerActiveValue } from '../lib/workspace-role';

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
  const incognito = useIncognito();
  const theme = useTheme();
  // PWA-Install: deferredPrompt ist nur gesetzt, wenn der Browser die
  // App fuer Install kandidiert (Chromium-/Edge-basierte Desktops +
  // Android). Safari-iOS feuert das Event nicht — dort bleibt der
  // Button unsichtbar und der User muss ueber Share-Menue installieren.
  const { deferredPrompt, installed } = installPromptSignal();
  // Mutation-Queue: pendingCount-Signal fuer das Header-Badge,
  // online-Event triggert Auto-Replay. Initial-Hydration der Count-
  // Anzeige passiert per refreshCountForWorkspace im Effect unten.
  // AU-B1 K11d (B1-H-007): pendingMutationCount ist jetzt workspace-
  // spezifisch — Multi-Tab-Cross-Kontamination geschlossen.
  const pendingMuts = () => pendingMutationCount(params.workspaceId ?? '');

  // Sidebar-Modus pro Workspace. Bei fehlendem workspaceId wird die
  // Registry mit einem leeren String angelegt — die Funktionen sind
  // idempotent und toleriert. Reales Toggle passiert nur wenn die
  // Workspace-Shell tatsaechlich gerendert wird.
  const sidebar = useSidebarMode(params.workspaceId ?? '');

  // Focus-Tracking fuer den "s"-Swap zwischen Sidebar und Canvas.
  // Portiert _lastSidebarFocus / _lastCanvasFocus aus dem HTML-Vorbild:
  // wir merken uns pro Region das zuletzt fokussierte Element und
  // springen dorthin zurueck, wenn der Nutzer zwischen den Regionen
  // wechselt. focusin-Listener wird global registriert (capture false),
  // weil wir nur den letzten Zielzustand brauchen.
  let lastSidebarFocus: HTMLElement | null = null;
  let lastCanvasFocus: HTMLElement | null = null;
  onMount(() => {
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest) return;
      if (t.closest('.ws-sidebar')) lastSidebarFocus = t;
      else if (t.closest('.ws-main')) lastCanvasFocus = t;
    };
    document.addEventListener('focusin', onFocusIn);
    onCleanup(() => document.removeEventListener('focusin', onFocusIn));
  });

  function swapFocus() {
    const ae = document.activeElement as HTMLElement | null;
    const inSidebar = !!ae?.closest?.('.ws-sidebar');
    if (inSidebar) {
      const target =
        (lastCanvasFocus && document.contains(lastCanvasFocus) && lastCanvasFocus) ||
        (document.querySelector<HTMLElement>('.ws-main [tabindex="0"]') ??
          document.querySelector<HTMLElement>('.mx-cell') ??
          document.querySelector<HTMLElement>('.ws-main button'));
      target?.focus?.();
      return;
    }
    // Nicht in Sidebar → dorthin. Bei collapsed erst auf full hochschalten,
    // sonst gibt es kein Ziel.
    if (sidebar.mode() === 'collapsed') sidebar.setMode('full');
    // setTimeout(0), damit SolidJS + DOM den Sidebar-Modus-Switch applied
    // hat bevor wir focusen.
    setTimeout(() => {
      const target =
        (lastSidebarFocus && document.contains(lastSidebarFocus) && lastSidebarFocus) ||
        (document.querySelector<HTMLElement>('.ws-sidebar .tree-link.active') ??
          document.querySelector<HTMLElement>('.ws-sidebar .tree-link') ??
          document.querySelector<HTMLElement>('.ws-sidebar button'));
      target?.focus?.();
    }, 0);
  }

  // Zell-Page-Section: der letzte URL-Segment hinter /c/:cellId/ entscheidet,
  // welches Feature-Panel gerendert wird.
  const cellSection = createMemo<'checklists' | 'info' | 'docs' | null>(() => {
    const p = location.pathname;
    if (!params.cellId) return null;
    if (p.endsWith('/checklists')) return 'checklists';
    if (p.endsWith('/info')) return 'info';
    if (p.endsWith('/docs')) return 'docs';
    return null;
  });

  const [workspaces] = createResource(() => fetchMyWorkspaces());
  const [showSearch, setShowSearch] = createSignal(false);
  // `^` bleibt Modal-Trigger fuer CommandPalette (DeadKey-Sicherheit auf
  // DE-Layouts). Die neue HeaderSearchBar (Focus via `f`) deckt Suche +
  // Commands + Alias-Navigation in einem persistenten Input-Feld ab.
  const [showCommand, setShowCommand] = createSignal(false);
  const [showDocs, setShowDocs] = createSignal(false);
  const [showHelp, setShowHelp] = createSignal(false);
  useSettingsBodyClassSync();
  // Callback, das die HeaderSearchBar beim Mount registriert — `f`-Keybind
  // benutzt es, um den Input zu fokussieren.
  let focusHeaderSearch: (() => void) | null = null;
  const docsRequest = useDocsRequest();

  // Docs-Popup wird ueber die shared Request-Signal gesteuert. Jede
  // openDocsPopup()-Call pushed einen neuen Request; der Effect hier
  // setzt daraufhin showDocs(true). Close-Side (onClose) setzt
  // showDocs(false) und clearDocsRequest(). Der Effect reagiert auf
  // `tick`, damit aufeinanderfolgende Requests auf denselben DocId
  // ebenfalls das Popup oeffnen (z.B. wenn es gerade geschlossen wurde).
  createEffect(() => {
    const req = docsRequest();
    if (!req) return;
    void req.tick; // dependency registrieren
    if (!showDocs()) setShowDocs(true);
  });
  // Default-Workspace auswaehlen, wenn URL keinen fuehrt.
  createEffect(() => {
    if (params.workspaceId) return;
    const list = workspaces();
    if (list && list.length > 0) {
      navigate(`/w/${list[0].id}`, { replace: true });
    }
  });

  // Mutation-Queue-Lifecycle: pro Workspace einmal das Pending-Count-
  // Signal hydrieren + 'online'-Event abonnieren. Beim Wechsel werden
  // alte Listener via onCleanup entfernt — sonst replay'n wir bei
  // mehreren Workspace-Wechseln das alte Pending-Set.
  createEffect(() => {
    const wsId = params.workspaceId;
    if (!wsId) return;
    void refreshCountForWorkspace(wsId);
    const onOnline = () => {
      void (async () => {
        const res = await replayQueue(wsId);
        if (res.skippedBusy) return;
        if (res.succeeded > 0) {
          showToast(
            `${res.succeeded} ${res.succeeded === 1 ? 'Aenderung' : 'Aenderungen'} synchronisiert.`,
            'success',
          );
        }
        if (res.staled > 0) {
          showToast(
            `${res.staled} ${res.staled === 1 ? 'Eintrag' : 'Eintraege'} veraltet — bitte pruefen (Einstellungen / Cache leeren).`,
            'error',
          );
        }
        if (res.failed > 0) {
          showToast(
            `${res.failed} ${res.failed === 1 ? 'Sync-Fehler' : 'Sync-Fehler'} — siehe Einstellungen.`,
            'error',
          );
        }
      })();
    };
    window.addEventListener('online', onOnline);
    onCleanup(() => window.removeEventListener('online', onOnline));
  });

  const currentWs = createMemo(() => {
    const list = workspaces();
    if (!list || !params.workspaceId) return undefined;
    return list.find((w) => w.id === params.workspaceId);
  });

  // Phase 1 P1.B.3: Rolle des Users im aktuellen Workspace. Quelle ist das
  // bestehende workspaces-Resource (mit role per Membership-Join). undefined
  // bedeutet "noch nicht geladen / keine Membership". Wird per Prop an
  // NodeTree, MatrixView, BoardView, CellInfoPage etc. weitergereicht; die
  // Helpers canWrite() / isViewer() entscheiden ueber Edit-UI-Sichtbarkeit.
  const myRole = createMemo(() => currentWs()?.role);

  // Sicherheitsnetz: wenn die eigene Rolle auf viewer wechselt (z.B. nach
  // Demote durch Admin + workspaces-Refetch), Edit-Mode-Signal hart
  // aussetzen. Sonst kann eine alte editMode=true die UI verwirren —
  // Body bekommt die .edit-mode-Klasse, obwohl alle Edit-Buttons hidden
  // sind. RLS blockt ohnehin, das ist reine UX-Hygiene.
  createEffect(() => {
    if (isViewer(myRole())) {
      setEditModeValue(false);
    }
  });

  // Body-Klasse + Module-Signal fuer Tiefen-Komponenten (CardOverlay,
  // CellOverlay, NodeTree-Drag-Drop), wo Prop-Drilling der myRole zu
  // invasiv waere. Beide spiegeln dieselbe Information — Body-Klasse
  // fuer CSS-Selektoren, Signal fuer JS-Guards. RLS bleibt authoritativ.
  createEffect(() => {
    const viewer = isViewer(myRole());
    document.body.classList.toggle('workspace-viewer', viewer);
    setViewerActiveValue(viewer);
  });
  onCleanup(() => {
    document.body.classList.remove('workspace-viewer');
    setViewerActiveValue(false);
  });

  const [nodes, { refetch: refetchNodes }] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? fetchNodesForWorkspace(wid) : []),
  );

  const [cells, { refetch: refetchCells }] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? fetchCellsForWorkspace(wid) : []),
  );

  const [rows, { refetch: refetchRows }] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? fetchRowsForWorkspace(wid) : []),
  );

  const [colsData, { refetch: refetchCols }] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? fetchColsForWorkspace(wid) : []),
  );

  // Phase 3 O.8: Objects workspace-weit fuer Live-Resolver der
  // Name-Templates (`{row.object}` / `{column.object}`). Object-Rename
  // schlaegt via Realtime-Bump (objects-Tabelle) durch und triggert
  // den hier verkabelten Refetch.
  const [objects, { refetch: refetchObjects }] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? fetchObjects(wid) : []),
  );

  // Maps fuer Resolver. Reaktiv ueber alle Resource-Accessoren —
  // recomputed bei jedem nodes/cells/rows/cols/objects-Bump.
  // Konsumiert in NodeTree (labelOf), MatrixView (Header), Breadcrumb.
  const resolverMaps = createMemo(() => ({
    cellsById: new Map((cells() ?? []).map((c) => [c.id, c])),
    rowsById: new Map((rows() ?? []).map((r) => [r.id, r])),
    colsById: new Map((colsData() ?? []).map((c) => [c.id, c])),
    objectsById: new Map((objects() ?? []).map((o) => [o.id, o])),
  }));

  // Set der cells, an denen Dokus haengen — fuer die derived Doku-
  // Pill in der Matrix-Ansicht. Reagiert auf rtDocs-Bumps ueber den
  // createEffect unten.
  const [cellsWithDocs, { refetch: refetchCellsWithDocs }] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? fetchCellIdsWithDocs(wid) : new Set<string>()),
  );

  // Deep-Dive-Chips (SB.2): opt-in Tree-Extras. State pro Workspace
  // persistiert. Fetches nur aktiv, wenn der passende Chip auch an ist —
  // sonst bleibt die Sidebar schlank.
  const chips = params.workspaceId ? useSidebarChips(params.workspaceId as string) : null;

  const [wsLinks] = createResource(
    () =>
      params.workspaceId && chips && (chips.isOn('links') || chips.isOn('mails'))
        ? { workspaceId: params.workspaceId as string }
        : null,
    async (key) => (key ? fetchWorkspaceLinks(key.workspaceId) : []),
  );
  const [wsDocs] = createResource(
    () =>
      params.workspaceId && chips && chips.isOn('docs')
        ? { workspaceId: params.workspaceId as string }
        : null,
    async (key) => (key ? fetchWorkspaceAttachedDocs(key.workspaceId) : []),
  );

  const chipData = createMemo<SidebarChipData | undefined>(() => {
    if (!chips) return undefined;
    const linkTypes = new Set<'url' | 'mail'>();
    if (chips.isOn('links')) linkTypes.add('url');
    if (chips.isOn('mails')) linkTypes.add('mail');
    const showDocs = chips.isOn('docs');
    if (linkTypes.size === 0 && !showDocs) return undefined;

    const linksByBoardId = new Map<string, LinkRow[]>();
    for (const l of wsLinks() ?? []) {
      const arr = linksByBoardId.get(l.board_id) ?? [];
      arr.push(l);
      linksByBoardId.set(l.board_id, arr);
    }
    const docsByCellId = new Map<string, DocRow[]>();
    for (const d of wsDocs() ?? []) {
      if (!d.attached_cell_id) continue;
      const arr = docsByCellId.get(d.attached_cell_id) ?? [];
      arr.push(d);
      docsByCellId.set(d.attached_cell_id, arr);
    }
    return {
      linksByBoardId,
      docsByCellId,
      linkTypes,
      showInfoLinks: linkTypes.size > 0,
    };
  });

  const tree = createMemo(() =>
    buildSidebarTree(nodes() ?? [], cells() ?? [], rows() ?? [], colsData() ?? [], chipData()),
  );

  // Path-Focus Expand: bei jeder Route-Change den Weg vom aktuellen
  // Target (Cell oder Node) bis zur Root-Matrix ins Expanded-Set
  // injizieren. Additiv — nichts wird geschlossen, bestehende manuelle
  // Expansionen bleiben. Browser-Back/Forward triggert die Effect
  // genauso wie Sidebar-Clicks, weil params reaktiv sind.
  createEffect(() => {
    const wsId = params.workspaceId;
    if (!wsId) return;
    const nodesList = nodes();
    const cellsList = cells();
    if (!nodesList || !cellsList) return;
    const byNodeId = new Map(nodesList.map((n) => [n.id, n]));
    const byCellId = new Map(cellsList.map((c) => [c.id, c]));

    const ids: string[] = [];
    // Upward-Walk: Node → Parent-Cell → Parent-Matrix (= Node), jeweils
    // deren IDs ins Expanded-Set. Structural Sub-Nodes haengen direkt
    // unter der Cell (keine Zwischen-Feature-Row), daher nur Cell + Node.
    // seen-Set verhindert Endlosschleifen bei Datenbug (Zyklus).
    function walkUp(startNodeId: string): void {
      const seen = new Set<string>();
      let cursor = byNodeId.get(startNodeId);
      while (cursor && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        ids.push(cursor.id);
        if (!cursor.parent_cell_id) break;
        const pc = byCellId.get(cursor.parent_cell_id);
        if (!pc) break;
        ids.push(pc.id);
        cursor = byNodeId.get(pc.matrix_id);
      }
    }

    if (params.cellId) {
      const c = byCellId.get(params.cellId);
      if (c) {
        ids.push(c.id);
        walkUp(c.matrix_id);
      }
    } else if (params.nodeId) {
      walkUp(params.nodeId);
    }

    if (ids.length > 0) {
      useTreeExpand(wsId).addToExpanded(ids);
    }
  });

  const currentNode = createMemo(() => {
    if (!params.nodeId) return undefined;
    return (nodes() ?? []).find((n) => n.id === params.nodeId);
  });

  // Aktuelle Zelle bei /c/:cellId-Routen (z.B. Cell-Checklisten-Page).
  const currentCell = createMemo(() => {
    if (!params.cellId) return undefined;
    return (cells() ?? []).find((c) => c.id === params.cellId);
  });

  // Phase-1.C: Position-Label fuer PresenceStack-Tooltips. Nimmt die
  // im Presence-Payload geteilten {nodeId, cellId, feature} und baut
  // einen menschen-lesbaren String "schaut: <Matrix> · <Cell> · <Section>".
  // Reagiert reaktiv auf nodes/cells/rows/cols-Resources — wenn der
  // gesuchte Node im lokalen Cache (noch) fehlt, liefert "(im Workspace)"
  // als Fallback. Der Empfaenger hat ggf. eine andere Sub-Matrix offen
  // und das Backend hat sie noch nicht in seinen Cache geholt — kein
  // Fehler, nur etwas weniger spezifisch.
  const FEATURE_LABELS: Record<string, string> = {
    info: 'Info',
    checklists: 'Checklisten',
    docs: 'Anhaenge',
  };
  const resolvePresenceLabel = (u: PresenceUser): string | undefined => {
    if (!u.nodeId && !u.cellId) return undefined;
    const parts: string[] = [];
    const nodesList = nodes() ?? [];
    const cellsList = cells() ?? [];
    const rowsList = rows() ?? [];
    const colsList = colsData() ?? [];
    const node = u.nodeId ? nodesList.find((n) => n.id === u.nodeId) : undefined;
    if (node) parts.push(resolveNodeLabel(node, resolverMaps()));
    if (u.cellId) {
      const cell = cellsList.find((c) => c.id === u.cellId);
      if (cell) {
        const row = rowsList.find((r) => r.id === cell.row_id);
        const col = colsList.find((c) => c.id === cell.col_id);
        if (row && col) parts.push(`${row.label} / ${col.label}`);
        else parts.push('Cell');
      }
    }
    if (u.feature) {
      const featureLabel = FEATURE_LABELS[u.feature];
      if (featureLabel) parts.push(featureLabel);
    }
    if (parts.length === 0) return 'im Workspace';
    return `schaut: ${parts.join(' · ')}`;
  };

  // NT.1: Presence-Subscription wird hier *einmal* angelegt und an
  // PresenceStack (Header) + NodeTree (Sidebar-Avatare) gereicht. Vorher
  // hat PresenceStack selbst subscribed; ein zweiter Aufruf in NodeTree
  // wuerde einen zweiten Channel pro User erzeugen — unnoetig + gegen
  // Supabase-Quota.
  //
  // P1.D: Live-Cursor-Hover-Signals. Vier separate Felder, weil sich
  // die Hover-Targets pro Page-Typ unterscheiden — Matrix hat Cells,
  // Board hat Cards, Cell hat Checklist-Items oder Info-Felder. Jede
  // Page meldet via ihrem onXxxHover-Callback, andere Felder bleiben
  // dabei NICHT geleert (man kann zwar nur auf einer Page sein, aber
  // das Cleanup macht das jeweilige Component beim Unmount).
  const [hoverCellId, setHoverCellId] = createSignal<string | undefined>(undefined);
  const [hoverCardId, setHoverCardId] = createSignal<string | undefined>(undefined);
  const [hoverItemId, setHoverItemId] = createSignal<string | undefined>(undefined);
  const [hoverFieldId, setHoverFieldId] = createSignal<string | undefined>(undefined);
  const presencePosition = createMemo<PresencePosition>(() => ({
    nodeId: currentNode()?.id,
    cellId: params.cellId,
    feature: cellSection() ?? undefined,
    hoverCellId: hoverCellId(),
    hoverCardId: hoverCardId(),
    hoverItemId: hoverItemId(),
    hoverFieldId: hoverFieldId(),
  }));
  const presenceUsers = usePresence(
    () => params.workspaceId ?? '',
    () => user()?.id ?? '',
    () => user()?.email ?? '',
    presencePosition,
  );

  // NT.3: Workspace-Members einmal laden — fuer den Creator-Avatar im
  // NodeTree (Resolver: created_by-uuid -> Member-Record fuer Initial+
  // Tooltip+Color). fetchMembers hat localStorage-Read-Cache; offline
  // kommt der zuletzt gesehene Snapshot durch.
  const [workspaceMembers] = createResource(
    () => params.workspaceId ?? null,
    async (wsId) => {
      try {
        return await fetchMembers(wsId);
      } catch (err) {
        console.error('fetchMembers (Workspace):', err);
        return [];
      }
    },
  );

  // Breadcrumb vom aktuellen Node aufwaerts. Geht von Node zu Parent-
  // Cell (via node.parent_cell_id) und von dort zur Parent-Matrix
  // (cell.matrix_id = Node-ID der Matrix, in der die Cell lebt).
  // Stoppt wenn parent_cell_id NULL ist (Root) oder die Parent-Cell
  // nicht gefunden wird (Orphan — buildTree macht das zu einem Root).
  //
  // Bei Cell-Routen (/c/:cellId) ist der Start die Parent-Matrix der
  // Zelle. Die Zelle selbst wird nicht eigens als Crumb gerendert;
  // das aktuelle Section-Label steht ohnehin auf der Cell-Page.
  const breadcrumb = createMemo<Array<{ id: string; label: string; type: 'matrix' | 'board' }>>(
    () => {
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
      const maps = resolverMaps();
      while (cursor && !seen.has(cursor.id)) {
        seen.add(cursor.id);
        chain.unshift({
          id: cursor.id,
          // Phase 3 O.8: Template-Resolver fuer Breadcrumb-Labels.
          label: resolveNodeLabel(cursor, maps) || '(ohne Label)',
          type: cursor.type,
        });
        if (!cursor.parent_cell_id) break;
        const pc = byCellId.get(cursor.parent_cell_id);
        if (!pc) break;
        cursor = byNodeId.get(pc.matrix_id);
      }
      return chain;
    },
  );

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
  const [rtDocs, setRtDocs] = createSignal(0);
  // Bump bei kb_cards-Realtime, damit die Aggregat-Sektion unter
  // Matrix-Ansichten (Intervallmatrix / Aufgabenuebersicht) neu
  // lauft. refetchBoard allein reicht nicht — die Aggregat-Section
  // fetcht ueber board_id IN (subtree), unabhaengig vom aktuellen
  // Board-Context.
  const [rtCards, setRtCards] = createSignal(0);

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

  // Palette-Shortcut: `^` ist der einzige Entry-Point (Ctrl+K und Shift+P
  // entfernt auf User-Wunsch 2026-04-24). Die Palette macht sowohl
  // Alias-Navigation als auch Commands — siehe CommandPalette.tsx.
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
  // mehr setzen.
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
      if (showSearch() || showCommand()) return;

      // "/" oeffnet Global-Search-Modal. Parallel zur HeaderSearchBar
      // erreichbar. Auf DE-Layout ist "/" = Shift+7; e.key ist '/' in
      // beiden Faellen. In Inputs ignorieren.
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        setShowSearch(true);
        return;
      }

      // "f" fokussiert die HeaderSearchBar (zentrales Such-/Steuerfeld).
      // Primaerer Weg seit 2026-04-24 — `/` + `^` bleiben als Modal-
      // Alternativen. In Inputs ignorieren, sonst kann User kein "f"
      // tippen.
      if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (isTextInput(e.target)) return;
        if (!focusHeaderSearch) return;
        e.preventDefault();
        focusHeaderSearch();
        return;
      }

      // Shift+A: Expand-All-Tree togglen (sticky pro Workspace).
      // In Text-Inputs ignorieren — sonst kann man kein A eintippen.
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'A' || e.key === 'a')) {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        useTreeExpand(params.workspaceId).toggleExpandAll();
        return;
      }

      // Shift+D: Dokumentations-Popup oeffnen.
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'D' || e.key === 'd')) {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        openDocsPopup();
        return;
      }

      // Shift+N: Sidebar-Modus zyklen (full → rails → collapsed → full).
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'N' || e.key === 'n')) {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        sidebar.cycle();
        return;
      }

      // Shift+W: Aggregat-Sektion unter der Matrix umschalten zwischen
      // Aufgabenuebersicht und Intervallmatrix. Nur wenn aktuell eine
      // Matrix im Fokus ist.
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'W' || e.key === 'w')) {
        if (isTextInput(e.target)) return;
        const n = currentNode();
        if (!n || n.type !== 'matrix') return;
        e.preventDefault();
        useAggregateView(n.id).toggle();
        return;
      }

      // "s" (kein Modifier): Fokus zwischen Sidebar und Canvas swappen.
      // In Text-Inputs ignorieren (sonst kann man kein s tippen). Wenn
      // Sidebar collapsed ist, erst auf full promoten, damit der Focus-
      // Restore ein Ziel hat.
      if (e.key === 's' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        swapFocus();
        return;
      }

      // ? oeffnet/schliesst die Shortcut-Hilfe. Auf DE-Layout ist
      // ? = Shift+ß, auf US Shift+/. e.key ist '?' in beiden Faellen.
      // In Inputs ignorieren — sonst kann man kein ? eintippen.
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }

      // ^ direkt (ohne Modifier ausser evtl. Shift fuer US-Tastatur) —
      // oeffnet die einheitliche Palette fuer Alias-Navigation + Commands.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const isCaret = e.key === '^' || (e.key === 'Dead' && e.code === 'Backquote');
      if (!isCaret) return;
      if (isTextInput(e.target)) return;
      e.preventDefault();
      setShowCommand(true);
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
    // Alias-Index initial laden. Wird bei jedem Event einer der 6 Alias-
    // Tabellen via `scheduleAliasRefresh` debounced neu gezogen.
    void fetchAliasIndex(wid);
    onCleanup(() => clearAliasIndex(wid));
    subscribeWorkspace(wid, {
      nodes: () => {
        void refetchNodes();
        scheduleAliasRefresh(wid);
      },
      cells: () => {
        void refetchCells();
        // Eine Cell-Mutation kann Feature-Pills in der aktuellen
        // Matrix/Board-Ansicht veraendern (z.B. child_matrix_id
        // gesetzt). Falls die betroffene Matrix gerade offen ist,
        // braucht sie frische Daten.
        void refetchMatrix();
        void refetchCellMatrix();
        scheduleAliasRefresh(wid);
      },
      rows: () => {
        void refetchRows();
        void refetchMatrix();
        void refetchCellMatrix();
      },
      cols: () => {
        void refetchCols();
        void refetchMatrix();
        void refetchCellMatrix();
      },
      kb_cols: () => void refetchBoard(),
      kb_cards: () => {
        void refetchBoard();
        setRtCards((v) => v + 1);
        scheduleAliasRefresh(wid);
      },
      checklists: () => {
        void refetchBoard();
        setRtCellChecklists((v) => v + 1);
        scheduleAliasRefresh(wid);
      },
      checklist_items: () => {
        void refetchBoard();
        setRtCellChecklists((v) => v + 1);
      },
      links: () => {
        void refetchBoard();
        scheduleAliasRefresh(wid);
      },
      docs: () => {
        setRtDocs((v) => v + 1);
        void refetchCellsWithDocs();
        scheduleAliasRefresh(wid);
      },
      // Phase 3 O.8: Object-Rename → Templates re-resolven. Refetch
      // triggert die Solid-Resource, deren Memo-Konsumenten in
      // NodeTree/MatrixView/BoardView automatisch neu rendern.
      objects: () => {
        void refetchObjects();
      },
    });
  });

  return (
    <div class="ws-shell" data-sb-mode={sidebar.mode()}>
      <aside class="ws-sidebar" data-sb-mode={sidebar.mode()}>
        {/* Schmale Top-Bar — Pendant zur ws-main-header. Workspace-
            Switcher-Chip links (flex:1), Collapse-Button rechts.
            Beide Seiten auf derselben Y-Linie mit dem Main-Header-
            Content rechts. */}
        <div class="ws-sidebar-head">
          <WorkspaceSwitcher workspaces={workspaces()} currentWorkspaceId={params.workspaceId} />
          <button
            type="button"
            class="ws-sidebar-mode-btn"
            onClick={() => sidebar.cycle()}
            title={
              sidebar.mode() === 'full'
                ? 'Sidebar einklappen (Shift+N)'
                : sidebar.mode() === 'rails'
                  ? 'Sidebar ausblenden (Shift+N)'
                  : 'Sidebar aufklappen (Shift+N)'
            }
            aria-label="Sidebar-Modus"
          >
            <Show
              when={sidebar.mode() === 'full'}
              fallback={
                <Show
                  when={sidebar.mode() === 'rails'}
                  fallback={<Icon name="chevron-right" size={16} />}
                >
                  <Icon name="chevron-double-left" size={16} />
                </Show>
              }
            >
              <Icon name="chevron-left" size={16} />
            </Show>
          </button>
        </div>
        <Show when={params.workspaceId}>
          <NodeTree
            workspaceId={params.workspaceId as string}
            tree={tree()}
            currentNodeId={params.nodeId ?? params.cellId}
            currentFeature={cellSection() ?? undefined}
            presence={presenceUsers}
            selfUserId={user()?.id}
            members={() => workspaceMembers() ?? []}
            resolverMaps={resolverMaps}
            onChanged={() => {
              void refetchCells();
              void refetchCellsWithDocs();
            }}
          />
        </Show>
        {/* Workspace-Level Import/Export haben wir entfernt — Import +
            Export laufen ausschliesslich ueber das Sidebar-Kontextmenue
            jeder Ebene (Matrix, Board, Zelle, Feature). Fuer komplette
            Workspace-Operationen gibt es das `^reset -all`-Command. */}

        <div class="ws-user-block">
          <span class="ws-email">{user()?.email}</span>
          <button type="button" onClick={onLogout}>
            Abmelden
          </button>
        </div>
      </aside>

      <Show when={sidebar.mode() === 'collapsed'}>
        <button
          type="button"
          class="ws-sidebar-edge-toggle"
          onClick={() => sidebar.open()}
          title="Sidebar aufklappen (Shift+N)"
          aria-label="Sidebar aufklappen"
        >
          ›
        </button>
      </Show>

      {/* Singleton-Dropdown fuer Alias-Autocomplete. Sichtbarkeit steuert
          lib/use-alias-autocomplete; Inputs binden sich per ref an den Hook. */}
      <AliasAutocomplete />

      {/* Singleton-Dropdown fuer Object-Suggestion (Phase 3 O.2b).
          Wird beim Tippen einer Row/Col/KbCol-Header-Input geoeffnet —
          bietet existing Objects als Cross-Cut-Pick. Sichtbarkeit steuert
          lib/use-object-suggest. */}
      <ObjectSuggestion />

      {/* Singleton-Context-Menu fuer Alias-Chips (Click/+/Rechtsklick).
          Jeder AliasChip triggert openAliasChipMenu — nur eine Instanz
          im DOM, egal wie viele Chips gerade gerendert sind. */}
      <ContextMenu state={aliasChipMenuState()} onClose={closeAliasChipMenu} />

      <Show when={showSearch() && params.workspaceId}>
        <GlobalSearch
          workspaceId={params.workspaceId as string}
          onClose={() => setShowSearch(false)}
        />
      </Show>

      <Show when={showCommand() && params.workspaceId}>
        <CommandPalette
          workspaceId={params.workspaceId as string}
          currentNode={currentNode()}
          currentCellId={params.cellId}
          currentFeature={cellSection() ?? undefined}
          onClose={() => setShowCommand(false)}
          onShowHelp={() => setShowHelp(true)}
        />
      </Show>

      <Show when={showDocs() && params.workspaceId}>
        <DocsPopup
          workspaceId={params.workspaceId as string}
          request={docsRequest()}
          realtimeVersion={rtDocs()}
          onClose={() => {
            setShowDocs(false);
            clearDocsRequest();
          }}
        />
      </Show>

      <Show when={showHelp()}>
        <KeyboardHelp onClose={() => setShowHelp(false)} />
      </Show>

      <main class="ws-main">
        <Show when={currentWs()} fallback={<p class="hint">Workspace waehlen.</p>}>
          <Show when={isViewer(myRole())}>
            <output class="workspace-readonly-banner" aria-live="polite">
              <Icon name="eye" size={16} />
              <span>
                Read-only: du bist Viewer in diesem Workspace. Owner und Admins koennen dich
                jederzeit zum Editor heraufstufen.
              </span>
            </output>
          </Show>
          <header class="ws-main-header">
            <nav class="ws-breadcrumb" aria-label="Breadcrumb">
              {/* Workspace-Ebene entfernt — der WorkspaceSwitcher-Chip
                  oben links in der Sidebar zeigt den Workspace-Namen
                  bereits auf gleicher Y-Linie. Doppelung raus. */}
              <For each={breadcrumb()}>
                {(crumb, i) => {
                  // Wenn auf /c/:cellId — die Cell-Row/Col-Span folgt NACH
                  // dem For-Loop und ist die eigentliche "current". Dann
                  // duerfen alle Matrix/Board-Crumbs Links bleiben.
                  const isLast = () => !currentCell() && i() === breadcrumb().length - 1;
                  return (
                    <>
                      {/* Kein Separator vor dem ersten Crumb — der
                          Workspace-Eintrag ist aus dem Breadcrumb raus,
                          der erste Matrix/Board-Eintrag startet sauber. */}
                      <Show when={i() > 0}>
                        <span class="ws-breadcrumb-sep" aria-hidden>
                          <Icon name="chevron-right" size={14} />
                        </span>
                      </Show>
                      <Show
                        when={!isLast()}
                        fallback={
                          <span class="ws-breadcrumb-current" data-type={crumb.type}>
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
                  ›
                </span>
                <span class="ws-breadcrumb-current" data-type="cell">
                  {cellRow()?.label || '(Zeile)'} × {cellCol()?.label || '(Spalte)'}
                </span>
              </Show>
            </nav>
            <Show when={params.workspaceId}>
              <HeaderSearchBar
                workspaceId={params.workspaceId as string}
                currentNode={currentNode()}
                currentCellId={params.cellId}
                currentFeature={cellSection() ?? undefined}
                onShowHelp={() => setShowHelp(true)}
                registerFocus={(fn) => {
                  focusHeaderSearch = fn;
                }}
              />
            </Show>
            <Show when={params.workspaceId ? user() : null}>
              {(u) => (
                <PresenceStack
                  users={presenceUsers}
                  selfUserId={u().id}
                  resolveLabel={resolvePresenceLabel}
                />
              )}
            </Show>
            <Show when={params.workspaceId}>
              <button
                type="button"
                class="incognito-toggle"
                classList={{ 'incognito-active': incognito() }}
                title={
                  incognito()
                    ? 'Incognito aktiv — fuer andere unsichtbar. Klick beendet den Modus.'
                    : 'Incognito an — fuer andere kurz unsichtbar werden.'
                }
                aria-pressed={incognito()}
                aria-label="Incognito-Modus umschalten"
                onClick={() => toggleIncognito()}
              >
                <Icon name={incognito() ? 'eye-slash' : 'eye'} size={14} />
              </button>
            </Show>
            <Show when={offlineState()}>
              <span
                class="offline-badge"
                title="Offline — Daten kommen aus dem lokalen Cache und sind evtl. nicht aktuell."
              >
                <Icon name="no-symbol" size={14} />
                <span>Offline</span>
              </span>
            </Show>
            <Show when={pendingMuts() > 0 && params.workspaceId}>
              <button
                type="button"
                class="pending-badge"
                title={`${pendingMuts()} Aenderungen warten auf Synchronisation. Klick: jetzt versuchen.`}
                onClick={() => {
                  void (async () => {
                    const res = await replayQueue(params.workspaceId as string);
                    if (res.skippedBusy) {
                      showToast('Sync laeuft bereits.', 'info');
                      return;
                    }
                    if (res.succeeded === 0 && res.staled === 0 && res.failed === 0) {
                      showToast(
                        'Keine Aenderungen synchronisierbar — wahrscheinlich offline.',
                        'info',
                      );
                    } else if (res.succeeded > 0) {
                      showToast(`${res.succeeded} Aenderungen synchronisiert.`, 'success');
                    }
                  })();
                }}
              >
                <Icon name="arrow-path" size={14} />
                <span>{pendingMuts()} pending</span>
              </button>
            </Show>
            <button
              type="button"
              class="theme-toggle-btn"
              onClick={() => setShowHelp(true)}
              title="Tastatur-Shortcuts (?)"
              aria-label="Tastatur-Shortcuts"
            >
              <Icon name="question-mark" size={18} />
            </button>
            <button
              type="button"
              class="theme-toggle-btn"
              onClick={() => {
                const wsId = params.workspaceId;
                if (wsId) navigate(`/w/${wsId}/settings/account/visibility`);
              }}
              title="Einstellungen"
              aria-label="Einstellungen"
              disabled={!params.workspaceId}
            >
              <Icon name="cog" size={18} />
            </button>
            <Show when={deferredPrompt() && !installed()}>
              <button
                type="button"
                class="theme-toggle-btn"
                onClick={() => void triggerInstallPrompt()}
                title="Als App installieren"
                aria-label="Als App installieren"
              >
                <Icon name="arrow-down-tray" size={18} />
              </button>
            </Show>
            <button
              type="button"
              class="theme-toggle-btn"
              onClick={() => {
                const wsId = params.workspaceId;
                if (wsId) navigate(`/w/${wsId}/objects`);
              }}
              title="Objekte"
              aria-label="Objekte"
              disabled={!params.workspaceId}
            >
              <Icon name="tag" size={18} />
            </button>
            <button
              type="button"
              class="theme-toggle-btn"
              onClick={() => toggleTheme()}
              title={theme() === 'dark' ? 'Light-Mode' : 'Dark-Mode'}
              aria-label={theme() === 'dark' ? 'Light-Mode' : 'Dark-Mode'}
            >
              <Icon name={theme() === 'dark' ? 'sun' : 'moon'} size={18} />
            </button>
            <Show when={canWrite(myRole())}>
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
            </Show>
          </header>

          <Show
            when={currentCell() || currentNode()}
            fallback={
              <WorkspaceEmptyState
                workspaceId={params.workspaceId ?? ''}
                canCreate={canWrite(myRole())}
                onCreated={(nodeId) => navigate(`/w/${params.workspaceId}/n/${nodeId}`)}
              />
            }
          >
            <Show when={currentCell()}>
              {(cell) => (
                <section class="node-view">
                  <Show when={cellSection() === 'checklists'}>
                    <CellChecklistsPage
                      workspaceId={cell().workspace_id}
                      cell={cell()}
                      row={cellRow()}
                      col={cellCol()}
                      realtimeVersion={rtCellChecklists()}
                      realtimeDocsVersion={rtDocs()}
                      presence={presenceUsers}
                      selfUserId={user()?.id}
                      onItemHover={setHoverItemId}
                      resolverMaps={resolverMaps}
                    />
                  </Show>
                  <Show when={cellSection() === 'info'}>
                    <CellInfoPage
                      workspaceId={cell().workspace_id}
                      cell={cell()}
                      row={cellRow()}
                      col={cellCol()}
                      realtimeDocsVersion={rtDocs()}
                      presence={presenceUsers}
                      selfUserId={user()?.id}
                      onFieldHover={setHoverFieldId}
                      resolverMaps={resolverMaps}
                      onChanged={() => {
                        void refetchCells();
                      }}
                    />
                  </Show>
                  <Show when={cellSection() === 'docs'}>
                    <CellDocsPage
                      workspaceId={cell().workspace_id}
                      cell={cell()}
                      row={cellRow()}
                      col={cellCol()}
                      realtimeDocsVersion={rtDocs()}
                      resolverMaps={resolverMaps}
                    />
                  </Show>
                </section>
              )}
            </Show>

            <Show when={!currentCell() && currentNode()}>
              {(node) => (
                <section class="node-view">
                  <div class="node-view-head">
                    <h2>{resolveNodeLabel(node(), resolverMaps()) || '(ohne Label)'}</h2>
                    <Show when={node().alias}>
                      {(alias) => <span class="node-alias">^{alias()}</span>}
                    </Show>
                    <span class="node-type-badge" data-type={node().type}>
                      {node().type}
                    </span>
                    <button
                      type="button"
                      class="btn-subtle node-view-head-doc-btn"
                      onClick={() =>
                        openDocsPopup({
                          sourceAlias: node().alias ?? null,
                        })
                      }
                      title="Neue Doku mit dieser Matrix/diesem Board als Quelle"
                    >
                      + In Doku erfassen
                    </button>
                  </div>

                  <NodeDescription node={node()} onChanged={() => void refetchNodes()} />

                  <Show when={node().type === 'matrix'}>
                    <MatrixView
                      workspaceId={node().workspace_id}
                      matrixId={node().id}
                      content={matrixContent()}
                      cellsWithDocs={cellsWithDocs() ?? new Set<string>()}
                      wsNodes={nodes() ?? []}
                      wsCells={cells() ?? []}
                      wsRows={rows() ?? []}
                      wsCols={colsData() ?? []}
                      cardsRealtimeVersion={rtCards()}
                      presence={presenceUsers}
                      selfUserId={user()?.id}
                      onCellHover={setHoverCellId}
                      resolverMaps={resolverMaps}
                      onChanged={() => {
                        // Nach strukturellen Aenderungen koennen neue/entfernte Sub-Nodes
                        // im Tree sichtbar werden, und cells.child_matrix_id/board_id
                        // aendern sich. Daher: nodes+cells auch refetchen.
                        // Phase 3 O.8.M.7: rows + cols auch — bei Row-/Col-Header-
                        // Rename via MatrixView wuerden sonst Sidebar-Tree und
                        // workspace-globale Listen veraltete Labels zeigen, bis
                        // der Realtime-Bump (asynchron) ankommt.
                        void refetchMatrix();
                        void refetchNodes();
                        void refetchCells();
                        void refetchRows();
                        void refetchCols();
                      }}
                    />
                  </Show>

                  <Show when={node().type === 'board'}>
                    <BoardView
                      workspaceId={node().workspace_id}
                      boardId={node().id}
                      content={boardContent()}
                      presence={presenceUsers}
                      selfUserId={user()?.id}
                      onCardHover={setHoverCardId}
                      onChanged={() => {
                        void refetchBoard();
                      }}
                    />
                  </Show>
                </section>
              )}
            </Show>
          </Show>
        </Show>
      </main>
    </div>
  );
};

export default Workspace;
