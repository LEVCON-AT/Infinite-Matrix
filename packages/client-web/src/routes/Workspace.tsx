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
  type SidebarChipData,
} from '../lib/queries';
import { useSidebarChips } from '../lib/sidebar-chips';
import type { DocRow, LinkRow } from '../lib/types';
import { toggleEditMode, useEditMode } from '../lib/edit-mode';
import { useSidebarMode } from '../lib/sidebar-mode';
import { useAggregateView } from '../lib/aggregate-view';
import { toggleTheme, useTheme } from '../lib/theme';
import { subscribeWorkspace } from '../lib/realtime';
import { clearAliasIndex, fetchAliasIndex, scheduleAliasRefresh } from '../lib/alias-index';
import { useTreeExpand } from '../lib/tree-expand';
import { downloadWorkspaceExport, exportWorkspace } from '../lib/export';
import { showToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';
import WorkspaceSwitcher from '../components/WorkspaceSwitcher';
import NodeTree from '../components/NodeTree';
import MatrixView from '../components/MatrixView';
import BoardView from '../components/BoardView';
import CellChecklistsPage from '../components/CellChecklistsPage';
import CellDocsPage from '../components/CellDocsPage';
import CellInfoPage from '../components/CellInfoPage';
import AliasAutocomplete from '../components/AliasAutocomplete';
import ContextMenu from '../components/ContextMenu';
import HeaderSearchBar from '../components/HeaderSearchBar';
import Icon from '../components/Icon';
import { aliasChipMenuState, closeAliasChipMenu } from '../lib/alias-chip-menu';
import CommandPalette from '../components/CommandPalette';
import DocsPopup from '../components/DocsPopup';
import GlobalSearch from '../components/GlobalSearch';
import ImportDialog from '../components/ImportDialog';
import KeyboardHelp from '../components/KeyboardHelp';
import SettingsModal from '../components/SettingsModal';
import { useSettingsBodyClassSync } from '../lib/settings';
import NodeDescription from '../components/NodeDescription';
import PresenceStack from '../components/PresenceStack';
import { clearDocsRequest, openDocsPopup, useDocsRequest } from '../lib/docs-ui';

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
  const [showImport, setShowImport] = createSignal(false);
  const [showSearch, setShowSearch] = createSignal(false);
  // `^` bleibt Modal-Trigger fuer CommandPalette (DeadKey-Sicherheit auf
  // DE-Layouts). Die neue HeaderSearchBar (Focus via `f`) deckt Suche +
  // Commands + Alias-Navigation in einem persistenten Input-Feld ab.
  const [showCommand, setShowCommand] = createSignal(false);
  const [showDocs, setShowDocs] = createSignal(false);
  const [showHelp, setShowHelp] = createSignal(false);
  const [showSettings, setShowSettings] = createSignal(false);
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

  const [rows, { refetch: refetchRows }] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? fetchRowsForWorkspace(wid) : []),
  );

  const [colsData, { refetch: refetchCols }] = createResource(
    () => params.workspaceId,
    async (wid) => (wid ? fetchColsForWorkspace(wid) : []),
  );

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
  const chips = params.workspaceId
    ? useSidebarChips(params.workspaceId as string)
    : null;

  const [wsLinks] = createResource(
    () =>
      params.workspaceId &&
      chips &&
      (chips.isOn('links') || chips.isOn('mails'))
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
    buildSidebarTree(
      nodes() ?? [],
      cells() ?? [],
      rows() ?? [],
      colsData() ?? [],
      chipData(),
    ),
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
      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        setShowSearch(true);
        return;
      }

      // "f" fokussiert die HeaderSearchBar (zentrales Such-/Steuerfeld).
      // Primaerer Weg seit 2026-04-24 — `/` + `^` bleiben als Modal-
      // Alternativen. In Inputs ignorieren, sonst kann User kein "f"
      // tippen.
      if (
        e.key === 'f' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        if (isTextInput(e.target)) return;
        if (!focusHeaderSearch) return;
        e.preventDefault();
        focusHeaderSearch();
        return;
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

      // Shift+D: Dokumentations-Popup oeffnen.
      if (
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === 'D' || e.key === 'd')
      ) {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        openDocsPopup();
        return;
      }

      // Shift+N: Sidebar-Modus zyklen (full → rails → collapsed → full).
      if (
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === 'N' || e.key === 'n')
      ) {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        sidebar.cycle();
        return;
      }

      // Shift+W: Aggregat-Sektion unter der Matrix umschalten zwischen
      // Aufgabenuebersicht und Intervallmatrix. Nur wenn aktuell eine
      // Matrix im Fokus ist.
      if (
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === 'W' || e.key === 'w')
      ) {
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
      if (
        e.key === 's' &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        if (isTextInput(e.target)) return;
        e.preventDefault();
        swapFocus();
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

      // ^ direkt (ohne Modifier ausser evtl. Shift fuer US-Tastatur) —
      // oeffnet die einheitliche Palette fuer Alias-Navigation + Commands.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const isCaret =
        e.key === '^' || (e.key === 'Dead' && e.code === 'Backquote');
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
    });
  });

  async function onImported(rootNodeId: string) {
    // Tree neu laden, damit der Import im Sidebar sichtbar wird,
    // dann zur neuen Root-Node navigieren.
    await Promise.all([
      refetchNodes(),
      refetchCells(),
      refetchRows(),
      refetchCols(),
    ]);
    setShowImport(false);
    if (params.workspaceId) {
      navigate(`/w/${params.workspaceId}/n/${rootNodeId}`);
    }
  }

  return (
    <div class="ws-shell" data-sb-mode={sidebar.mode()}>
      <aside class="ws-sidebar" data-sb-mode={sidebar.mode()}>
        {/* Schmale Top-Bar — Pendant zur ws-main-header. Workspace-
            Switcher-Chip links (flex:1), Collapse-Button rechts.
            Beide Seiten auf derselben Y-Linie mit dem Main-Header-
            Content rechts. */}
        <div class="ws-sidebar-head">
          <WorkspaceSwitcher
            workspaces={workspaces()}
            currentWorkspaceId={params.workspaceId}
          />
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
            onChanged={() => {
              void refetchCells();
              void refetchCellsWithDocs();
            }}
          />
        </Show>
        <div class="ws-actions">
          <Show when={params.workspaceId}>
            <button
              type="button"
              class="btn-subtle"
              onClick={() => setShowImport(true)}
            >
              <Icon name="plus" size={14} />
              JSON importieren
            </button>
            <button
              type="button"
              class="btn-subtle"
              onClick={onExport}
              disabled={exporting()}
              title="Kompletten Workspace als JSON herunterladen"
            >
              <Icon name="arrow-down-tray" size={14} />
              Export
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

      <Show when={showImport() && params.workspaceId}>
        <ImportDialog
          workspaceId={params.workspaceId as string}
          onClose={() => setShowImport(false)}
          onImported={onImported}
        />
      </Show>

      {/* Singleton-Dropdown fuer Alias-Autocomplete. Sichtbarkeit steuert
          lib/use-alias-autocomplete; Inputs binden sich per ref an den Hook. */}
      <AliasAutocomplete />

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

      <Show when={showSettings()}>
        <SettingsModal onClose={() => setShowSettings(false)} />
      </Show>

      <main class="ws-main">
        <Show
          when={currentWs()}
          fallback={<p class="hint">Workspace waehlen.</p>}
        >
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
                  const isLast = () =>
                    !currentCell() && i() === breadcrumb().length - 1;
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
              <Icon name="question-mark" size={18} />
            </button>
            <button
              type="button"
              class="theme-toggle-btn"
              onClick={() => setShowSettings(true)}
              title="Einstellungen"
              aria-label="Einstellungen"
            >
              <Icon name="cog" size={18} />
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
                    realtimeDocsVersion={rtDocs()}
                  />
                </Show>
                <Show when={cellSection() === 'info'}>
                  <CellInfoPage
                    workspaceId={currentCell()!.workspace_id}
                    cell={currentCell()!}
                    row={cellRow()}
                    col={cellCol()}
                    realtimeDocsVersion={rtDocs()}
                    onChanged={() => {
                      void refetchCells();
                    }}
                  />
                </Show>
                <Show when={cellSection() === 'docs'}>
                  <CellDocsPage
                    workspaceId={currentCell()!.workspace_id}
                    cell={currentCell()!}
                    row={cellRow()}
                    col={cellCol()}
                    realtimeDocsVersion={rtDocs()}
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
                  <button
                    type="button"
                    class="btn-subtle node-view-head-doc-btn"
                    onClick={() =>
                      openDocsPopup({
                        sourceAlias: currentNode()?.alias ?? null,
                      })
                    }
                    title="Neue Doku mit dieser Matrix/diesem Board als Quelle"
                  >
                    + In Doku erfassen
                  </button>
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
                    cellsWithDocs={cellsWithDocs() ?? new Set<string>()}
                    wsNodes={nodes() ?? []}
                    wsCells={cells() ?? []}
                    wsRows={rows() ?? []}
                    wsCols={colsData() ?? []}
                    cardsRealtimeVersion={rtCards()}
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
