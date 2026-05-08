import { useSearchParams } from '@solidjs/router';
import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import type { AtomManifestationRow } from '../lib/atom-manifestations';
import { useBoardUi } from '../lib/board-ui-state';
import { showConfirm, showPrompt } from '../lib/dialog';
import { openDokuForContext, shouldIgnoreDKey } from '../lib/docs-open';
import { openDocsPopup } from '../lib/docs-ui';
import { activeDrag, endDrag, startDrag } from '../lib/drag-context';
import { translateDbError } from '../lib/errors';
import { dropOnKanbanCol } from '../lib/manifestation-cross-view';
import {
  InvalidUrlError,
  addBoardLink,
  addCard,
  addChecklist,
  addKbCol,
  delBoardLink,
  delCard,
  delKbCol,
  moveCard,
  renameAndLinkKbCol,
  renameKbCol,
  restoreBoardLink,
  restoreCard,
  restoreKbColWithCards,
  setBoardLinkLabel,
  setBoardLinkProvider,
  setBoardLinkUrl,
  setCardColAndPosition,
  setCardDoneOccurrences,
  setCardPosition,
  setKbColColor,
  setKbColPosition,
  toggleCardDone,
} from '../lib/mutations';
import { ensureObjectForKbCol } from '../lib/objects';
import type { PresenceUser } from '../lib/presence';
import { isCardDone, isRecurCard, todayIso, toggleOccurrence } from '../lib/recur';
import { useVis } from '../lib/settings';
import { showToast, showUndoToast } from '../lib/toasts';
import type {
  AtomTagWithTag,
  BoardContent,
  CellRow,
  DocRow,
  KbCardRow,
  KbColRow,
  LinkProvider,
  LinkRow,
  NodeRow,
  TaskManifestationRow,
} from '../lib/types';
import { sanitizeUrl } from '../lib/url';
import {
  closeObjectSuggest,
  commitObjectSuggest,
  navigateObjectSuggest,
  objectSuggestState,
  openObjectSuggest,
} from '../lib/use-object-suggest';
import { useViewerActive } from '../lib/workspace-role';
import BulkAddModal from './BulkAddModal';
import CardOverlay from './CardOverlay';
import ChecklistPanel from './ChecklistPanel';
import DocsIndicator from './DocsIndicator';
import Icon from './Icon';
import { ModalTransition } from './ModalTransition';
import PresenceMini from './PresenceMini';
import TagPills from './TagPills';

type Props = {
  workspaceId: string;
  boardId: string;
  content: BoardContent | undefined;
  onChanged?: () => void;
  // P1.D Live-Cursor.
  presence?: () => PresenceUser[];
  selfUserId?: string;
  onCardHover?: (cardId: string | undefined) => void;
  // Phase 4 T.1.G.2.C: Workspace-weite Manifestations fuer Cross-View-
  // Drop-Idempotenz (Move-vs-Add-Detect).
  wsManifestations?: TaskManifestationRow[];
  // Welle D.9 + WV.WV.1: Pinned-Manifestations fuer DocsIndicator-Render
  // auf Kanban-Cards. Liest atom_manifestations WHERE kind='pinned' AND
  // atom_type='doc' AND container_kind='atom' AND container_id=card.atom_id
  // (Task-Atoms sind die Karten selbst).
  wsAtomPins?: AtomManifestationRow[];
  // Welle D.9: Doc-Rows fuer AtomDocsSection im CardOverlay (Title +
  // Vorschau-Snippet). Pure Daten; werden ueber Workspace-Resource gefuettert.
  wsDocs?: DocRow[];
  // Welle D.9: Atom-Tags (joined mit workspace_tags-Registry) fuer
  // TagPills-Render auf Kanban-Cards. Filter pro Card client-seitig.
  wsAtomTagsEnriched?: AtomTagWithTag[];
  // Welle D.7c: Bundle der Workspace-Resources fuer den Tag-Editor +
  // Picker-Modals im CardOverlay. Optional durchgeleitet — Caller
  // (Workspace.tsx) reicht alles als atomPickerEntries-Memo + cells/nodes.
  atomPickerEntries?: import('./AtomPickerModal').AtomPickerEntry[];
  wsCells?: CellRow[];
  wsNodes?: NodeRow[];
  cellLabelById?: Map<string, string>;
  tagsRealtimeVersion?: number;
};

// Liefert N/M fuer eine Karte — inline-Checkliste oder resolved via ref.
function checklistProgress(
  card: KbCardRow,
  content: BoardContent,
): { done: number; total: number } | null {
  if (card.checklist_ref) {
    const items = content.checklistItems.filter((it) => it.checklist_id === card.checklist_ref);
    if (items.length === 0) return null;
    return { done: items.filter((i) => i.done).length, total: items.length };
  }
  const inline = card.checklist;
  if (Array.isArray(inline) && inline.length > 0) {
    return {
      done: inline.filter((i) => i.done).length,
      total: inline.length,
    };
  }
  return null;
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

// Deadline-State relativ zu heute:
//   overdue  = strikt vor heute
//   today    = heute
//   soon     = innerhalb der naechsten 3 Tage (heute exklusiv)
//   future   = spaeter
// Donecards bekommen keinen State — "erledigt" ueberschreibt
// das Dringlichkeitssignal.
function deadlineState(
  iso: string | null,
  done: boolean,
): 'overdue' | 'today' | 'soon' | 'future' | null {
  if (!iso || done) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays <= 3) return 'soon';
  return 'future';
}

// Comparator-Factory fuer Card-Sort. In allen Modi sortieren wir
// done-Karten ans Ende (erledigt = weniger relevant). Null-Werte
// (kein Deadline, keine Prio) landen ebenfalls hinten.
function sortComparator(
  mode: 'deadline' | 'priority' | 'name',
): (a: KbCardRow, b: KbCardRow) => number {
  return (a, b) => {
    const aDone = isCardDone(a);
    const bDone = isCardDone(b);
    if (aDone !== bDone) return aDone ? 1 : -1;
    if (mode === 'deadline') {
      const aHas = !!a.deadline;
      const bHas = !!b.deadline;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && a.deadline && b.deadline && a.deadline !== b.deadline) {
        return a.deadline < b.deadline ? -1 : 1;
      }
    } else if (mode === 'priority') {
      const ap = a.priority;
      const bp = b.priority;
      const aHas = ap != null;
      const bHas = bp != null;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && ap !== bp) return (ap as number) - (bp as number);
    } else if (mode === 'name') {
      const cmp = a.name.localeCompare(b.name);
      if (cmp !== 0) return cmp;
    }
    // Tiebreaker: bestehende Position, stabil.
    return a.position - b.position;
  };
}

const BoardView: Component<Props> = (p) => {
  const viewerActive = useViewerActive();

  // Welle D.9 + WV.WV.1: doc-Pin-Count pro Task-Atom (card.id = task.id).
  // Card-Map einmal aus pinned-Manifestations berechnen, dann in der
  // Render-Schleife O(1)-Lookup.
  const docPinCountByCard = createMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    for (const pin of p.wsAtomPins ?? []) {
      if (pin.atom_type !== 'doc') continue;
      if (pin.container_kind !== 'atom') continue;
      if (pin.container_id == null) continue;
      map.set(pin.container_id, (map.get(pin.container_id) ?? 0) + 1);
    }
    return map;
  });

  // Welle D.9 + WV.WV.1: Erste gepinnte Doc-ID pro Task — wird beim
  // DocsIndicator-Click direkt geoeffnet (statt Detail-Modal-Umweg).
  // Mehrere Docs werden im Doc-Popup-Tab-Switcher sichtbar.
  const firstDocIdByCard = createMemo<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const pin of p.wsAtomPins ?? []) {
      if (pin.atom_type !== 'doc') continue;
      if (pin.container_kind !== 'atom') continue;
      if (pin.container_id == null) continue;
      if (map.has(pin.container_id)) continue;
      map.set(pin.container_id, pin.atom_id);
    }
    return map;
  });

  // Welle D.9: AtomTagWithTag-Liste pro Task. Filtert die enriched
  // Workspace-Liste auf atom_type='task' + atom_id=card.id.
  const tagsByCard = createMemo<Map<string, AtomTagWithTag[]>>(() => {
    const map = new Map<string, AtomTagWithTag[]>();
    for (const t of p.wsAtomTagsEnriched ?? []) {
      if (t.atom_type !== 'task') continue;
      const arr = map.get(t.atom_id);
      if (arr) arr.push(t);
      else map.set(t.atom_id, [t]);
    }
    return map;
  });

  // P1.D Live-Cursor-Map: Card-ID -> User-Liste (gehoverte Cards).
  const presenceByCard = createMemo<Map<string, PresenceUser[]>>(() => {
    const map = new Map<string, PresenceUser[]>();
    const all = p.presence?.() ?? [];
    for (const u of all) {
      if (u.userId === p.selfUserId) continue;
      const cid = u.hoverCardId;
      if (!cid) continue;
      const arr = map.get(cid);
      if (arr) arr.push(u);
      else map.set(cid, [u]);
    }
    return map;
  });

  onCleanup(() => {
    p.onCardHover?.(undefined);
  });
  // Kanban-Struktur: + Spalte / Link-Leiste / Checklisten-Anlage, Color-
  // Picker, Spalte umbenennen, Spalte verschieben, Spalte loeschen.
  // Karten-Aktionen (Move/Del) bleiben immer sichtbar — Karten sind kein
  // Struktur-Level.
  const canAddKbCol = useVis('addKbCol');
  const canColorPicker = useVis('colorPicker');
  const canRenameHeaders = useVis('renameHeaders');
  const canMoveRowCol = useVis('moveArrows');
  const canDeleteRowCol = useVis('deleteRowCol');
  const canAddInfoField = useVis('addInfoField');
  const colHeadEditable = () =>
    canRenameHeaders() || canMoveRowCol() || canDeleteRowCol() || canColorPicker();
  const boardUi = useBoardUi(p.boardId);

  // Drag-State: welche Card wird gerade gezogen, welcher Col-Container
  // ist gerade der Hover-Drop-Target. Plus: welche Card ist Slot-Target
  // (dragOverCardId) und ob die Insertion vor oder nach ihr passieren
  // soll (dragOverBefore — bestimmt aus Maus-Y vs Card-Mittelpunkt).
  // Keine DOM-Klasse anfassen — reaktive Signale treiben classList.
  const [draggingCardId, setDraggingCardId] = createSignal<string | null>(null);
  const [dragOverColId, setDragOverColId] = createSignal<string | null>(null);
  const [dragOverCardId, setDragOverCardId] = createSignal<string | null>(null);
  const [dragOverBefore, setDragOverBefore] = createSignal(true);

  function clearDragState() {
    setDraggingCardId(null);
    setDragOverColId(null);
    setDragOverCardId(null);
  }

  function onCardDragStart(card: KbCardRow, e: DragEvent) {
    if (!e.dataTransfer) return;
    // Reorder via Drag setzt voraus, dass die manuelle Sortierung aktiv
    // ist. Bei automatischem Sort waere das Drop-Ergebnis sofort
    // weg-sortiert — irritierend. Daher early-abort, kein drag.
    if (boardUi.sort() !== 'manual') {
      e.preventDefault();
      showToast('Drag nur bei manueller Sortierung.', 'info');
      return;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/matrix-card-id', card.id);
    // Fallback fuer Browser die den custom-type ignorieren.
    e.dataTransfer.setData('text/plain', card.id);
    setDraggingCardId(card.id);
    // Phase 4 T.1.G.2.D: Cross-View-Drag aktivieren — auch fuer Kanban-
    // Karten. Damit akzeptieren Sidebar-Calendar / Mini-Calendar / Day-
    // View die Karte als Quelle. KbCardRow.id IS die task_id (Projection-
    // Shape). Die zugehoerige Kanban-Manifestation suchen wir via
    // wsManifestations, damit Drop-Targets Move-vs-Add erkennen koennen.
    const kanbanManif = (p.wsManifestations ?? []).find(
      (m) => m.kind === 'kanban' && m.atom_id === card.id,
    );
    startDrag({
      atom: 'task',
      atomId: card.id,
      label: card.name,
      sourceManifId: kanbanManif?.id,
      workspaceId: card.workspace_id,
    });
  }

  function onCardDragEnd() {
    clearDragState();
    endDrag();
  }

  function onColDragOver(colId: string, e: DragEvent) {
    // Akzeptiert zwei Quellen:
    //   (a) interner Card-Drag (draggingCardId gesetzt) — Reorder.
    //   (b) externer Task-Drag aus Sidebar/Calendar/etc. (activeDrag()
    //       atom='task') — Cross-View-Drop fuegt eine Kanban-Manifestation
    //       hinzu (T.1.G.2.C).
    const externalTask = activeDrag()?.atom === 'task';
    if (!draggingCardId() && !externalTask) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dragOverColId() !== colId) setDragOverColId(colId);
  }

  function onColDragLeave(colId: string, e: DragEvent) {
    // Nur wenn wir wirklich den Container verlassen (nicht ein Child
    // betreten). relatedTarget ist das neu-fokussierte Element;
    // wenn es ausserhalb des aktuellen Col-Divs liegt, leaven.
    const related = e.relatedTarget as Node | null;
    const current = e.currentTarget as HTMLElement;
    if (related && current.contains(related)) return;
    if (dragOverColId() === colId) {
      setDragOverColId(null);
      setDragOverCardId(null);
    }
  }

  // Card-level DragOver fuer Slot-Vorschau. Nur auf den Karten gebunden,
  // damit die Berechnung pro Karte lokal bleibt.
  function onCardDragOver(card: KbCardRow, e: DragEvent) {
    const src = draggingCardId();
    if (!src) return;
    if (src === card.id) return; // auf sich selbst kein Slot
    e.preventDefault();
    // Event nicht bubblen lassen — sonst uebersteuert onColDragOver
    // unsere feinere Slot-Berechnung.
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const before = e.clientY < midY;
    if (dragOverColId() !== card.col_id) setDragOverColId(card.col_id);
    if (dragOverCardId() !== card.id) setDragOverCardId(card.id);
    if (dragOverBefore() !== before) setDragOverBefore(before);
  }

  // Re-nummerierung einer Spalte — setzt alle position-Werte linear auf
  // 0, 1, 2, … gemaess orderedIds. Bestehende Werte werden ueberschrieben.
  // Sequenziell statt Promise.all, damit kein konkurrierender UPDATE-Storm
  // an RLS/Policy-Zaehler stoert (nebenbei: Reihenfolge der Logs bleibt
  // nachvollziehbar).
  async function writeColOrder(orderedIds: string[]): Promise<void> {
    for (let i = 0; i < orderedIds.length; i++) {
      await setCardPosition(orderedIds[i], i);
    }
  }

  // Bestimmt die Ziel-Reihenfolge der Spalte toColId, nachdem srcCard
  // an Slot `anchorIdx` (before) / `anchorIdx+1` (after) eingefuegt
  // wurde. In-Col-Fall: die Karte wird aus der Liste entfernt, dann
  // neu eingesetzt. Cross-Col: nur Einfuege-Seite.
  function computeInsertOrder(
    srcCard: KbCardRow,
    toColId: string,
    anchorCardId: string | null,
    before: boolean,
  ): string[] {
    const listAll = cardsByCol().get(toColId) ?? [];
    // Src entfernen, damit wir eine saubere Referenz fuer den Ziel-
    // Index haben (andernfalls waere der anchor-Index falsch, wenn src
    // vor dem anchor lag).
    const list = listAll.filter((c) => c.id !== srcCard.id);
    let insertAt = list.length;
    if (anchorCardId) {
      const idx = list.findIndex((c) => c.id === anchorCardId);
      if (idx >= 0) insertAt = before ? idx : idx + 1;
    }
    const ids = list.map((c) => c.id);
    ids.splice(insertAt, 0, srcCard.id);
    return ids;
  }

  // Reorder-Handler. Ziel: `toColId` an Slot vor/nach `anchorCardId`.
  // Wenn kein anchor: ans Ende.
  async function performReorder(
    srcCard: KbCardRow,
    toColId: string,
    anchorCardId: string | null,
    before: boolean,
  ) {
    const fromColId = srcCard.col_id;
    const isCrossCol = fromColId !== toColId;
    const targetOrder = computeInsertOrder(srcCard, toColId, anchorCardId, before);
    const insertPos = targetOrder.indexOf(srcCard.id);

    // Quell-Spalte (falls cross-col) zuerst neu nummerieren — dann
    // cascaded die Src-Card mit neuer col_id+position in die Ziel-Spalte.
    // Zuletzt: Ziel-Spalte re-nummerieren (ohne Src, weil die schon
    // explizit auf insertPos gesetzt wird).
    await wrap(async () => {
      if (isCrossCol) {
        const fromList = (cardsByCol().get(fromColId) ?? []).filter((c) => c.id !== srcCard.id);
        for (let i = 0; i < fromList.length; i++) {
          await setCardPosition(fromList[i].id, i);
        }
        await setCardColAndPosition(srcCard.id, toColId, insertPos);
        for (let i = 0; i < targetOrder.length; i++) {
          const id = targetOrder[i];
          if (id === srcCard.id) continue;
          await setCardPosition(id, i);
        }
      } else {
        await writeColOrder(targetOrder);
      }
    });
  }

  async function onCardDrop(targetCard: KbCardRow, e: DragEvent) {
    const srcId =
      e.dataTransfer?.getData('text/matrix-card-id') ||
      e.dataTransfer?.getData('text/plain') ||
      draggingCardId();
    const before = dragOverBefore();
    clearDragState();
    if (!srcId || srcId === targetCard.id) return;
    e.preventDefault();
    e.stopPropagation();
    const srcCard = (p.content?.kbCards ?? []).find((c) => c.id === srcId);
    if (!srcCard) return;
    await performReorder(srcCard, targetCard.col_id, targetCard.id, before);
  }

  async function onColDrop(colId: string, e: DragEvent) {
    // Cross-View-Drop (T.1.G.2.C): externe Task-Manifestation aus
    // Sidebar/Calendar landet hier → kanban-Manifestation an die Spalte
    // anfuegen (oder bestehende Kanban-Manif moven). Hat Vorrang vor dem
    // internen Reorder, weil externe Drags kein draggingCardId haben.
    const ext = activeDrag();
    if (ext?.atom === 'task' && !draggingCardId()) {
      e.preventDefault();
      e.stopPropagation();
      clearDragState();
      const list = cardsByCol().get(colId) ?? [];
      const tail = list.reduce((max, c) => (c.position > max ? c.position : max), -1) + 1;
      const taskExisting = (p.wsManifestations ?? []).filter((m) => m.atom_id === ext.atomId);
      void dropOnKanbanCol({
        workspaceId: p.workspaceId,
        taskId: ext.atomId,
        taskLabel: ext.label,
        targetColId: colId,
        targetPosition: tail,
        existingForTask: taskExisting,
      });
      return;
    }
    // Wenn ein Card-Slot-Drop aktiv war, hat onCardDrop das schon
    // abgehandelt. Das Col-Drop-Event feuert bei manchen Browsern
    // zusaetzlich (Drag-Target-Bubble). Guard via dragOverCardId:
    // wenn gesetzt, ist der Card-Handler zustaendig.
    const anchorCardId = dragOverCardId();
    const cardId =
      e.dataTransfer?.getData('text/matrix-card-id') ||
      e.dataTransfer?.getData('text/plain') ||
      draggingCardId();
    const before = dragOverBefore();
    clearDragState();
    if (!cardId) return;
    e.preventDefault();
    const card = (p.content?.kbCards ?? []).find((c) => c.id === cardId);
    if (!card) return;
    if (anchorCardId) {
      // Card-Drop-Pfad uebernahm bereits — hier nur state cleanup.
      return;
    }
    await performReorder(card, colId, null, before);
  }
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedCardId, setSelectedCardId] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  // Phase 3 O.3: Bulk-Add fuer Kb-Spalten (Shift+Klick auf "+ Spalte").
  const [bulkAddOpen, setBulkAddOpen] = createSignal(false);

  // Deep-Link ?card=<id> → CardOverlay direkt oeffnen (Quicknav).
  // Erst wenn content vorhanden ist und die Karte wirklich existiert.
  // Query-Param danach aufraeumen, damit ein Refresh die Karte nicht
  // erneut oeffnet und die URL sauber bleibt.
  createEffect(() => {
    const content = p.content;
    if (!content) return;
    const want = searchParams.card;
    if (!want || typeof want !== 'string') return;
    const exists = content.kbCards.some((c) => c.id === want);
    if (!exists) return;
    setSelectedCardId(want);
    setSearchParams({ card: undefined }, { replace: true });
  });

  const [showArchived, setShowArchived] = createSignal(false);
  const [filter, setFilter] = createSignal('');
  let filterInputRef: HTMLInputElement | undefined;

  const visibleCols = createMemo<KbColRow[]>(() => p.content?.kbCols ?? []);
  // Archiv-Filter: per Default ausgeblendet. Toggle-Button im Board-Head
  // setzt showArchived — dann kommen die archivierten Karten mit
  // kb-card-archived-Klasse sichtbar rein.
  const activeCards = createMemo<KbCardRow[]>(() => {
    const all = showArchived()
      ? (p.content?.kbCards ?? [])
      : (p.content?.kbCards ?? []).filter((c) => !c.archived);
    const q = filter().trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (c.alias?.toLowerCase().includes(q)) return true;
      if ((c.tags ?? []).some((t) => t.toLowerCase().includes(q))) return true;
      if ((c.who ?? []).some((w) => w.toLowerCase().includes(q))) return true;
      return false;
    });
  });
  const archivedCount = createMemo(
    () => (p.content?.kbCards ?? []).filter((c) => c.archived).length,
  );

  const cardsByCol = createMemo(() => {
    const map = new Map<string, KbCardRow[]>();
    for (const c of activeCards()) {
      const arr = map.get(c.col_id);
      if (arr) arr.push(c);
      else map.set(c.col_id, [c]);
    }
    // Sort pro Spalte. Position-Order kommt schon sortiert aus der
    // Query — nichts zu tun im 'manual'-Modus.
    const mode = boardUi.sort();
    if (mode !== 'manual') {
      const cmp = sortComparator(mode);
      for (const list of map.values()) list.sort(cmp);
    }
    return map;
  });

  // Treffer-Counter fuer den Filter: ueber cardsByCol zaehlen, damit
  // die Zahl genau dem entspricht, was gerendert wird.
  const totalCardsShown = createMemo(() =>
    Array.from(cardsByCol().values()).reduce((n, l) => n + l.length, 0),
  );
  const totalCardsAll = createMemo(
    () =>
      (showArchived()
        ? (p.content?.kbCards ?? [])
        : (p.content?.kbCards ?? []).filter((c) => !c.archived)
      ).length,
  );

  const selectedCard = createMemo(() => {
    const id = selectedCardId();
    if (!id) return undefined;
    return (p.content?.kbCards ?? []).find((c) => c.id === id);
  });

  async function wrap<T>(fn: () => Promise<T>, successMsg?: string) {
    if (busy()) return;
    if (viewerActive()) {
      showToast('Read-only: Board-Aenderungen sind als Viewer nicht moeglich.', 'info');
      return;
    }
    setBusy(true);
    try {
      await fn();
      if (successMsg) showToast(successMsg, 'success');
      p.onChanged?.();
    } catch (err) {
      // AU-B1 K5 (B1-F-001 / CC3): console.error fuer Production-Debug.
      console.error('BoardView.wrap:', err);
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onAddCol(e?: MouseEvent | KeyboardEvent) {
    if (e?.shiftKey) {
      setBulkAddOpen(true);
      return;
    }
    await wrap(() => addKbCol({ workspaceId: p.workspaceId, boardId: p.boardId }));
  }

  async function onRenameCol(col: KbColRow, newLabel: string, pickedObjectId: string | null) {
    if (newLabel === col.label && !pickedObjectId) return;
    if (pickedObjectId && pickedObjectId !== col.object_id) {
      // Cross-Cut-Pick: KbCol mit existing Object verlinken
      await wrap(() => renameAndLinkKbCol(col.id, newLabel, pickedObjectId));
    } else {
      await wrap(() => renameKbCol(col.id, newLabel));
      void ensureObjectForKbCol({
        id: col.id,
        workspace_id: col.workspace_id,
        label: newLabel,
        object_id: col.object_id ?? null,
      });
    }
  }

  // Helper: gemeinsames Set-Up fuer KbCol-Header-Input (analog
  // MatrixView.makeHeaderHandlers). Liefert onInput/onKeyDown/onBlur.
  function makeKbColHeaderHandlers(args: {
    getLabel: () => string;
    getObjectId: () => string | null;
    commit: (label: string, pickedObjectId: string | null) => void | Promise<void>;
  }) {
    const onPick = (hit: { id: string; label: string } | null) => {
      if (hit) void args.commit(hit.label, hit.id);
    };

    return {
      onInput: (e: InputEvent & { currentTarget: HTMLInputElement }) => {
        if (!canRenameHeaders()) return;
        const v = e.currentTarget.value;
        if (v.trim().length >= 2) {
          openObjectSuggest({
            anchor: e.currentTarget,
            workspaceId: p.workspaceId,
            query: v,
            currentObjectId: args.getObjectId(),
            onPick,
          });
        } else {
          closeObjectSuggest();
        }
      },
      onKeyDown: (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
        if (!canRenameHeaders()) return;
        if (e.key === 'ArrowDown' && objectSuggestState().open) {
          e.preventDefault();
          navigateObjectSuggest('down');
          return;
        }
        if (e.key === 'ArrowUp' && objectSuggestState().open) {
          e.preventDefault();
          navigateObjectSuggest('up');
          return;
        }
        if (e.key === 'Escape' && objectSuggestState().open) {
          e.preventDefault();
          closeObjectSuggest();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const picked = commitObjectSuggest();
          const finalLabel = picked ? picked.label : e.currentTarget.value.trim();
          e.currentTarget.blur();
          if (!picked) {
            void args.commit(finalLabel, null);
          }
        }
      },
      onBlur: (e: FocusEvent & { currentTarget: HTMLInputElement }) => {
        if (!canRenameHeaders()) return;
        setTimeout(() => closeObjectSuggest(), 100);
        const finalLabel = e.currentTarget.value.trim();
        if (finalLabel !== args.getLabel()) {
          void args.commit(finalLabel, null);
        }
      },
    };
  }

  async function onColorCol(col: KbColRow, color: string | null) {
    if ((color ?? null) === (col.color ?? null)) return;
    await wrap(() => setKbColColor(col.id, color));
  }

  async function onMoveCol(col: KbColRow, direction: 'left' | 'right') {
    const list = visibleCols();
    const idx = list.findIndex((c) => c.id === col.id);
    if (idx < 0) return;
    const neighbourIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (neighbourIdx < 0 || neighbourIdx >= list.length) return;
    const neighbour = list[neighbourIdx];
    await wrap(async () => {
      await setKbColPosition(col.id, neighbour.position);
      await setKbColPosition(neighbour.id, col.position);
    });
  }

  async function onDelCol(col: KbColRow) {
    const count = (cardsByCol().get(col.id) ?? []).length;
    if (count > 0) {
      const ok = await showConfirm({
        title: 'Spalte loeschen?',
        message: `Spalte "${col.label || '(leer)'}" loeschen? Enthaelt ${count} Karte(n) — werden mitgeloescht.`,
        variant: 'danger',
        confirmLabel: 'Loeschen',
      });
      if (!ok) return;
    }
    // AU-B1 K10 (B1-B-006): Snapshot der Spalte + ihrer Karten fuer Undo.
    // Reihenfolge im Restore: erst kb_col (FK-Parent), dann kb_cards.
    const colSnap = { ...col };
    const cardSnaps = (cardsByCol().get(col.id) ?? []).map((c) => ({ ...c }));
    await wrap(() => delKbCol(col.id));
    showUndoToast(`Spalte "${col.label || '(leer)'}" geloescht.`, () => {
      void (async () => {
        try {
          await restoreKbColWithCards(colSnap, cardSnaps);
          showToast('Spalte wiederhergestellt.', 'success');
          p.onChanged?.();
        } catch (err) {
          console.error('restoreKbColWithCards:', err);
          showToast(translateDbError(err), 'error');
        }
      })();
    });
  }

  async function onAddCard(col: KbColRow) {
    await wrap(() =>
      addCard({
        workspaceId: p.workspaceId,
        boardId: p.boardId,
        colId: col.id,
      }),
    );
  }

  async function onDelCard(card: KbCardRow) {
    const ok = await showConfirm({
      title: 'Karte loeschen?',
      message: `Karte "${card.name || '(ohne Titel)'}" loeschen?`,
      variant: 'danger',
      confirmLabel: 'Loeschen',
    });
    if (!ok) return;
    const snap: KbCardRow = { ...card };
    await wrap(() => delCard(card.id));
    showUndoToast(`Karte "${snap.name || '(ohne Titel)'}" geloescht.`, () => {
      void (async () => {
        try {
          await restoreCard(snap);
          showToast('Karte wiederhergestellt.', 'success');
          p.onChanged?.();
        } catch (err) {
          showToast(translateDbError(err), 'error');
        }
      })();
    });
  }

  async function onMoveCard(card: KbCardRow, toColId: string) {
    if (toColId === card.col_id) return;
    await wrap(() =>
      moveCard({
        cardId: card.id,
        boardId: p.boardId,
        workspaceId: p.workspaceId,
        toColId,
      }),
    );
  }

  // Within-column-Reorder: Swap mit direktem Listen-Nachbarn. Positionen
  // sind pro Spalte eindeutig nicht garantiert, aber auch nicht per UNIQUE
  // erzwungen — Swap bleibt also safe. cardsByCol() ist bereits nach
  // position sortiert (fetchBoardContent ordnet kb_cards aufsteigend).
  async function onMoveCardWithin(card: KbCardRow, direction: 'up' | 'down') {
    const list = cardsByCol().get(card.col_id) ?? [];
    const idx = list.findIndex((c) => c.id === card.id);
    if (idx < 0) return;
    const neighbourIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (neighbourIdx < 0 || neighbourIdx >= list.length) return;
    const neighbour = list[neighbourIdx];
    await wrap(async () => {
      await setCardPosition(card.id, neighbour.position);
      await setCardPosition(neighbour.id, card.position);
    });
  }

  async function onAddChecklist() {
    await wrap(() => addChecklist({ workspaceId: p.workspaceId, boardId: p.boardId }));
  }

  // Board-Links: Add via Prompt (URL dann Label). Invalid-URL liefert
  // eine freundliche Fehler-Toast, Sanitization greift im
  // Mutations-Layer.
  async function onAddLink() {
    const rawUrl = await showPrompt({
      title: 'Link hinzufuegen',
      message: 'URL oder E-Mail-Adresse:',
      initialValue: 'https://',
    });
    if (!rawUrl) return;
    const raw = rawUrl.trim();
    if (!raw) return;
    // Simple Heuristik: enthaelt @ ohne :// → wohl eine Mail.
    const looksLikeMail = raw.includes('@') && !/^[a-z]+:\/\//i.test(raw);
    const provider: LinkProvider = looksLikeMail ? 'mail' : 'url';
    const label =
      (await showPrompt({
        title: 'Anzeigetext',
        message: 'Anzeigetext (optional):',
      })) ?? '';
    try {
      await addBoardLink({
        workspaceId: p.workspaceId,
        boardId: p.boardId,
        provider,
        label,
        url: raw,
      });
      p.onChanged?.();
    } catch (err) {
      if (err instanceof InvalidUrlError) {
        showToast('URL ist ungueltig.', 'error');
      } else {
        showToast(translateDbError(err), 'error');
      }
    }
  }

  async function onDelLink(link: LinkRow) {
    const ok = await showConfirm({
      title: 'Link loeschen?',
      message: `Link "${link.label || link.url}" loeschen?`,
      variant: 'danger',
      confirmLabel: 'Loeschen',
    });
    if (!ok) {
      return;
    }
    const snap: LinkRow = { ...link };
    await wrap(() => delBoardLink(link.id));
    showUndoToast(`Link "${snap.label || snap.url}" geloescht.`, () => {
      void (async () => {
        try {
          await restoreBoardLink(snap);
          showToast('Link wiederhergestellt.', 'success');
          p.onChanged?.();
        } catch (err) {
          showToast(translateDbError(err), 'error');
        }
      })();
    });
  }

  async function onRenameLink(link: LinkRow, label: string) {
    if (label.trim() === link.label) return;
    await wrap(() => setBoardLinkLabel(link.id, label));
  }

  async function onLinkUrl(link: LinkRow, url: string) {
    if (url.trim() === link.url) return;
    try {
      await setBoardLinkUrl(link.id, url);
      p.onChanged?.();
    } catch (err) {
      if (err instanceof InvalidUrlError) {
        showToast('URL ist ungueltig.', 'error');
      } else {
        showToast(translateDbError(err), 'error');
      }
    }
  }

  async function onLinkProvider(link: LinkRow, provider: LinkProvider) {
    if (provider === link.provider) return;
    await wrap(() => setBoardLinkProvider(link.id, provider));
  }

  async function onToggleCardDone(card: KbCardRow, done: boolean) {
    const current = isCardDone(card);
    if (done === current) return;
    if (isRecurCard(card)) {
      const next = toggleOccurrence(card.done_occurrences, todayIso(), done);
      await wrap(() => setCardDoneOccurrences(card.id, next));
    } else {
      await wrap(() => toggleCardDone(card.id, done));
    }
  }

  return (
    <Show when={p.content} fallback={<p class="hint">Lade Board…</p>}>
      {(content) => (
        <div class="board">
          {/* Board-Header: Filter-Suche + Archiv-Toggle. Immer sichtbar,
              sobald das Board Karten hat — Suche sparen sich leere
              Boards. */}
          <Show when={(content().kbCards ?? []).length > 0}>
            <div class="board-header-bar">
              <div class="board-filter-wrap">
                <span class="board-filter-icon" aria-hidden="true">
                  <Icon name="search" size={14} />
                </span>
                <input
                  ref={filterInputRef}
                  type="text"
                  class="board-filter-input"
                  placeholder="Suche (Name, Alias, #Tag, @Person)…"
                  value={filter()}
                  onInput={(e) => setFilter(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && filter()) {
                      e.preventDefault();
                      e.stopPropagation();
                      setFilter('');
                    }
                  }}
                />
                <Show when={filter()}>
                  <span class="board-filter-count hint">
                    {totalCardsShown()}/{totalCardsAll()}
                  </span>
                  <button
                    type="button"
                    class="board-filter-clear"
                    onClick={() => {
                      setFilter('');
                      filterInputRef?.focus();
                    }}
                    title="Filter loeschen"
                    aria-label="Filter loeschen"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </Show>
              </div>
              <select
                class="board-sort-select"
                value={boardUi.sort()}
                title="Sortierung"
                onChange={(e) =>
                  boardUi.setSort(
                    (e.currentTarget as HTMLSelectElement).value as
                      | 'manual'
                      | 'deadline'
                      | 'priority'
                      | 'name',
                  )
                }
              >
                <option value="manual">Manuell</option>
                <option value="deadline">Deadline</option>
                <option value="priority">Prioritaet</option>
                <option value="name">Name</option>
              </select>
              <Show when={archivedCount() > 0}>
                <button
                  type="button"
                  class="btn-subtle board-archive-toggle"
                  classList={{ active: showArchived() }}
                  onClick={() => setShowArchived((v) => !v)}
                  aria-pressed={showArchived()}
                  title={
                    showArchived() ? 'Archivierte Karten ausblenden' : 'Archivierte Karten anzeigen'
                  }
                >
                  <Icon name="archive-box" size={14} />
                  <span>{showArchived() ? 'Archiv: an' : 'Archiv: aus'}</span>
                  <span class="hint">({archivedCount()})</span>
                </button>
              </Show>
            </div>
          </Show>

          {/* Links-Leiste. Im View-Mode Chips als <a>, im Edit-Mode
              Inline-Edit: Typ, Label, URL + Delete. */}
          <Show when={(content().links ?? []).length > 0 || canAddInfoField()}>
            <div class="board-links">
              <For each={content().links ?? []}>
                {(link) => (
                  <Show
                    when={canAddInfoField()}
                    fallback={
                      <a
                        class="board-link-chip"
                        data-link-type={link.provider}
                        href={(() => {
                          // Render-Pfad-Sanitization analog NodeTree.hrefOf.
                          const safe = sanitizeUrl(link.url) ?? '';
                          return link.provider === 'mail' ? `mailto:${safe}` : safe;
                        })()}
                        target={link.provider === 'url' ? '_blank' : undefined}
                        rel={link.provider === 'url' ? 'noopener noreferrer' : undefined}
                        title={link.url}
                      >
                        <span class="link-ico">
                          <Icon
                            name={
                              link.provider === 'mail' ? 'envelope' : 'arrow-top-right-on-square'
                            }
                            size={12}
                          />
                        </span>
                        <span>{link.label || link.url}</span>
                        <Show when={link.alias}>
                          <span class="link-alias">^{link.alias}</span>
                        </Show>
                      </a>
                    }
                  >
                    <div class="board-link-edit" data-link-type={link.provider}>
                      <select
                        class="board-link-type"
                        value={link.provider}
                        title="Link-Typ"
                        onChange={(e) =>
                          onLinkProvider(
                            link,
                            (e.currentTarget as HTMLSelectElement).value as LinkProvider,
                          )
                        }
                      >
                        <option value="url">URL</option>
                        <option value="mail">Mail</option>
                      </select>
                      <input
                        class="board-link-label"
                        type="text"
                        value={link.label}
                        placeholder="Label"
                        onBlur={(e) => onRenameLink(link, e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                      />
                      <input
                        class="board-link-url"
                        type="text"
                        value={link.url}
                        placeholder={link.provider === 'mail' ? 'name@example.com' : 'https://...'}
                        onBlur={(e) => onLinkUrl(link, e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                      />
                      <button
                        type="button"
                        class="mx-del-btn"
                        title="Link loeschen"
                        aria-label="Link loeschen"
                        onClick={() => onDelLink(link)}
                        disabled={busy()}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </div>
                  </Show>
                )}
              </For>
              <Show when={canAddInfoField()}>
                <button
                  type="button"
                  class="btn-subtle board-link-add-btn"
                  onClick={onAddLink}
                  disabled={busy()}
                >
                  <Icon name="plus" size={14} />
                  <span>Link</span>
                </button>
              </Show>
            </div>
          </Show>

          {/* Kanban-Spalten */}
          <Show
            when={visibleCols().length > 0}
            fallback={
              <div class="board-empty">
                <p class="hint">
                  Board ohne Spalten.
                  <Show when={canAddKbCol()}> + Spalte, um zu starten.</Show>
                </p>
                <Show when={canAddKbCol()}>
                  <button
                    type="button"
                    class="btn-subtle"
                    onClick={(e) => onAddCol(e)}
                    disabled={busy()}
                    title="Spalte hinzufuegen (Shift+Klick: mehrere)"
                  >
                    <Icon name="plus" size={14} />
                    <span>Spalte</span>
                  </button>
                </Show>
              </div>
            }
          >
            <div class="board-cols">
              <For each={visibleCols()}>
                {(col, colIdx) => {
                  const list = () => cardsByCol().get(col.id) ?? [];
                  const collapsed = () => boardUi.isCollapsed(col.id);
                  const headerHandlers = makeKbColHeaderHandlers({
                    getLabel: () => col.label,
                    getObjectId: () => col.object_id ?? null,
                    commit: (label, pickedId) => onRenameCol(col, label, pickedId),
                  });
                  return (
                    <div
                      class="kb-col"
                      classList={{
                        'kb-col-collapsed': collapsed(),
                        'kb-col-drag-over': dragOverColId() === col.id,
                      }}
                      style={col.color ? { '--kb-col-color': col.color } : undefined}
                      data-has-color={col.color ? 'yes' : 'no'}
                      onDragOver={(e) => onColDragOver(col.id, e)}
                      onDragLeave={(e) => onColDragLeave(col.id, e)}
                      onDrop={(e) => onColDrop(col.id, e)}
                    >
                      <header class="kb-col-head" classList={{ 'mx-editable': colHeadEditable() }}>
                        <button
                          type="button"
                          class="kb-col-collapse-btn"
                          title={collapsed() ? 'Spalte aufklappen' : 'Spalte kollabieren'}
                          aria-label={collapsed() ? 'Spalte aufklappen' : 'Spalte kollabieren'}
                          aria-expanded={!collapsed()}
                          onClick={() => boardUi.toggleCol(col.id)}
                        >
                          <Icon name={collapsed() ? 'chevron-right' : 'chevron-down'} size={14} />
                        </button>
                        <input
                          class="mx-head-input"
                          type="text"
                          value={col.label}
                          placeholder="(Spalte)"
                          readOnly={!canRenameHeaders()}
                          tabIndex={canRenameHeaders() ? 0 : -1}
                          onInput={headerHandlers.onInput}
                          onKeyDown={headerHandlers.onKeyDown}
                          onBlur={headerHandlers.onBlur}
                        />
                        <input
                          type="color"
                          class="kb-col-color-picker"
                          value={col.color ?? '#888888'}
                          title="Spalten-Farbe"
                          disabled={!canColorPicker()}
                          tabIndex={canColorPicker() ? 0 : -1}
                          onChange={(e) => onColorCol(col, e.currentTarget.value)}
                        />
                        <button
                          type="button"
                          class="mx-del-btn"
                          title="Farbe entfernen"
                          aria-label="Farbe entfernen"
                          tabIndex={canColorPicker() && col.color ? 0 : -1}
                          onClick={() => onColorCol(col, null)}
                          disabled={!canColorPicker() || !col.color}
                        >
                          <Icon name="no-symbol" size={12} />
                        </button>
                        <button
                          type="button"
                          class="mx-move-btn"
                          title="Spalte nach links"
                          aria-label="Spalte nach links"
                          tabIndex={canMoveRowCol() ? 0 : -1}
                          onClick={() => onMoveCol(col, 'left')}
                          disabled={busy() || !canMoveRowCol() || colIdx() === 0}
                        >
                          <Icon name="chevron-left" size={12} />
                        </button>
                        <button
                          type="button"
                          class="mx-move-btn"
                          title="Spalte nach rechts"
                          aria-label="Spalte nach rechts"
                          tabIndex={canMoveRowCol() ? 0 : -1}
                          onClick={() => onMoveCol(col, 'right')}
                          disabled={
                            busy() || !canMoveRowCol() || colIdx() === visibleCols().length - 1
                          }
                        >
                          <Icon name="chevron-right" size={12} />
                        </button>
                        <button
                          type="button"
                          class="mx-del-btn"
                          title="Spalte loeschen"
                          aria-label="Spalte loeschen"
                          tabIndex={canDeleteRowCol() ? 0 : -1}
                          onClick={() => onDelCol(col)}
                          disabled={busy() || !canDeleteRowCol()}
                        >
                          <Icon name="x" size={12} />
                        </button>
                        <span class="kb-col-count">{list().length}</span>
                      </header>

                      <Show
                        when={!collapsed() && list().length > 0}
                        fallback={
                          <Show when={!collapsed()}>
                            <p class="kb-col-empty hint">leer</p>
                          </Show>
                        }
                      >
                        <ul class="kb-cards">
                          <For each={list()}>
                            {(card, cardIdx) => {
                              const progress = createMemo(() => checklistProgress(card, content()));
                              const deadline = fmtDate(card.deadline);
                              const dropBefore = () =>
                                dragOverCardId() === card.id &&
                                draggingCardId() !== card.id &&
                                dragOverBefore();
                              const dropAfter = () =>
                                dragOverCardId() === card.id &&
                                draggingCardId() !== card.id &&
                                !dragOverBefore();
                              return (
                                <li
                                  class="kb-card"
                                  classList={{
                                    'kb-card-done': isCardDone(card),
                                    'kb-card-archived': card.archived,
                                    'kb-card-dragging': draggingCardId() === card.id,
                                    'kb-card-drop-before': dropBefore(),
                                    'kb-card-drop-after': dropAfter(),
                                  }}
                                  style={card.color ? { '--kb-card-color': card.color } : undefined}
                                  data-has-color={card.color ? 'yes' : 'no'}
                                  // biome-ignore lint/a11y/useSemanticElements: <li role="button"> — Karte enthaelt klickbare Aktions-Buttons (Move/Del) als nested children, <button>-in-<button> waere invalid.
                                  // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA-Listitem-mit-button-Pattern fuer DnD-Karten.
                                  role="button"
                                  tabIndex={0}
                                  draggable={true}
                                  onDragStart={(e) => onCardDragStart(card, e)}
                                  onDragEnd={onCardDragEnd}
                                  onDragOver={(e) => onCardDragOver(card, e)}
                                  onDrop={(e) => onCardDrop(card, e)}
                                  onMouseEnter={() => p.onCardHover?.(card.id)}
                                  onMouseLeave={() => p.onCardHover?.(undefined)}
                                  onClick={() => setSelectedCardId(card.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setSelectedCardId(card.id);
                                      return;
                                    }
                                    // Welle D: 'd' auf Card → atom-Doku.
                                    if (
                                      (e.key === 'd' || e.key === 'D') &&
                                      !e.shiftKey &&
                                      !e.ctrlKey &&
                                      !e.metaKey &&
                                      !e.altKey
                                    ) {
                                      if (shouldIgnoreDKey(e.target)) return;
                                      e.preventDefault();
                                      e.stopPropagation();
                                      openDokuForContext({
                                        kind: 'atom',
                                        atomType: 'task',
                                        atomId: card.id,
                                        atomTitle: card.name ?? null,
                                      });
                                    }
                                  }}
                                >
                                  <PresenceMini users={presenceByCard().get(card.id) ?? []} />
                                  <div class="kb-card-name">
                                    <input
                                      type="checkbox"
                                      class="kb-card-done-checkbox"
                                      checked={isCardDone(card)}
                                      aria-label="Erledigt"
                                      title={
                                        isCardDone(card) ? 'Wieder offen' : 'Als erledigt markieren'
                                      }
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        onToggleCardDone(card, e.currentTarget.checked);
                                      }}
                                    />
                                    <span class="kb-card-title-text">
                                      {card.name || '(ohne Titel)'}
                                    </span>
                                    <Show when={card.alias}>
                                      <span class="kb-card-alias">^{card.alias}</span>
                                    </Show>
                                  </div>

                                  <Show
                                    when={
                                      (card.tags?.length ?? 0) > 0 ||
                                      (card.who?.length ?? 0) > 0 ||
                                      deadline ||
                                      card.priority != null ||
                                      card.recur != null ||
                                      progress() ||
                                      (docPinCountByCard().get(card.id) ?? 0) > 0 ||
                                      (tagsByCard().get(card.id)?.length ?? 0) > 0
                                    }
                                  >
                                    <div class="kb-card-meta">
                                      <For each={card.tags ?? []}>
                                        {(t) => <span class="kb-tag">#{t}</span>}
                                      </For>
                                      <For each={card.who ?? []}>
                                        {(w) => <span class="kb-who">@{w}</span>}
                                      </For>
                                      <Show when={(tagsByCard().get(card.id)?.length ?? 0) > 0}>
                                        <TagPills
                                          tags={tagsByCard().get(card.id) ?? []}
                                          onShowAll={() => setSelectedCardId(card.id)}
                                        />
                                      </Show>
                                      <DocsIndicator
                                        count={docPinCountByCard().get(card.id) ?? 0}
                                        onClick={() => {
                                          const docId = firstDocIdByCard().get(card.id);
                                          if (docId) openDocsPopup({ initialDocId: docId });
                                        }}
                                      />
                                      <Show when={deadline}>
                                        <span
                                          class="kb-deadline"
                                          data-deadline-state={
                                            deadlineState(card.deadline, isCardDone(card)) ?? 'none'
                                          }
                                        >
                                          <Icon name="clock" size={11} />
                                          <span>{deadline}</span>
                                        </span>
                                      </Show>
                                      <Show when={card.priority != null}>
                                        <span class="kb-prio">
                                          <Icon name="flag" size={11} />
                                          <span>P{card.priority}</span>
                                        </span>
                                      </Show>
                                      <Show when={card.recur != null}>
                                        <span class="kb-recur" title="Wiederkehrend">
                                          <Icon name="arrow-path" size={12} />
                                        </span>
                                      </Show>
                                      <Show when={progress()}>
                                        {(prog) => (
                                          <span class="kb-cl-progress">
                                            <Icon name="check-circle" size={11} />
                                            <span>
                                              {prog().done}/{prog().total}
                                            </span>
                                          </span>
                                        )}
                                      </Show>
                                    </div>
                                  </Show>

                                  {/* Karten-Aktionen (Move/Del) immer sichtbar —
                                      Karten sind keine strukturellen Daten. */}
                                  {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation-Wrapper, kein interaktives Element — verhindert dass Klick auf Move/Del-Buttons die Karte oeffnet. */}
                                  <div
                                    class="kb-card-edit-bar"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      class="mx-move-btn"
                                      title={
                                        boardUi.sort() !== 'manual'
                                          ? 'Sortierung aktiv — Reihenfolge automatisch'
                                          : 'Karte nach oben'
                                      }
                                      aria-label="Karte nach oben"
                                      onClick={() => onMoveCardWithin(card, 'up')}
                                      disabled={
                                        busy() || cardIdx() === 0 || boardUi.sort() !== 'manual'
                                      }
                                    >
                                      <Icon name="arrow-up" size={12} />
                                    </button>
                                    <button
                                      type="button"
                                      class="mx-move-btn"
                                      title={
                                        boardUi.sort() !== 'manual'
                                          ? 'Sortierung aktiv — Reihenfolge automatisch'
                                          : 'Karte nach unten'
                                      }
                                      aria-label="Karte nach unten"
                                      onClick={() => onMoveCardWithin(card, 'down')}
                                      disabled={
                                        busy() ||
                                        cardIdx() === list().length - 1 ||
                                        boardUi.sort() !== 'manual'
                                      }
                                    >
                                      <Icon name="arrow-down" size={12} />
                                    </button>
                                    <select
                                      class="kb-card-move"
                                      value={card.col_id}
                                      title="In andere Spalte verschieben"
                                      onChange={(e) =>
                                        onMoveCard(
                                          card,
                                          (e.currentTarget as HTMLSelectElement).value,
                                        )
                                      }
                                    >
                                      <For each={visibleCols()}>
                                        {(opt) => (
                                          <option value={opt.id}>
                                            → {opt.label || '(Spalte)'}
                                          </option>
                                        )}
                                      </For>
                                    </select>
                                    <button
                                      type="button"
                                      class="mx-del-btn"
                                      title="Karte loeschen"
                                      aria-label="Karte loeschen"
                                      onClick={() => onDelCard(card)}
                                      disabled={busy()}
                                    >
                                      <Icon name="x" size={12} />
                                    </button>
                                  </div>
                                </li>
                              );
                            }}
                          </For>
                        </ul>
                      </Show>

                      {/* "+ Karte" immer verfuegbar — Karten sind keine Struktur. */}
                      <Show when={!collapsed()}>
                        <button
                          type="button"
                          class="kb-card-add-btn"
                          onClick={() => onAddCard(col)}
                          disabled={busy()}
                          title="Karte hinzufuegen"
                        >
                          <Icon name="plus" size={14} />
                          <span>Karte</span>
                        </button>
                      </Show>
                    </div>
                  );
                }}
              </For>

              {/* Letzte Spalte im Edit-Mode: "+ Spalte" (Shift+Klick = Bulk) */}
              <Show when={canAddKbCol()}>
                <div class="kb-col kb-col-add">
                  <button
                    type="button"
                    class="kb-col-add-btn"
                    onClick={(e) => onAddCol(e)}
                    disabled={busy()}
                    title="Spalte hinzufuegen (Shift+Klick: mehrere)"
                  >
                    <Icon name="plus" size={14} />
                    <span>Spalte</span>
                  </button>
                </div>
              </Show>
            </div>
          </Show>

          {/* Standalone-Checklisten. Section wird gerendert, sobald
              Listen da sind ODER der Edit-Mode aktiv ist (damit der
              "+ Checkliste"-Button erreichbar bleibt). */}
          <Show when={(content().checklists ?? []).length > 0 || canAddInfoField()}>
            <section class="board-checklists">
              <h3 class="board-section-title">Checklisten</h3>
              <Show when={(content().checklists ?? []).length > 0}>
                <ul class="cl-list">
                  <For each={content().checklists}>
                    {(cl) => {
                      const items = () =>
                        content()
                          .checklistItems.filter((it) => it.checklist_id === cl.id)
                          .sort((a, b) => a.position - b.position);
                      return (
                        <ChecklistPanel
                          checklist={cl}
                          items={items()}
                          workspaceId={p.workspaceId}
                          wsManifestations={p.wsManifestations ?? []}
                          onChanged={() => p.onChanged?.()}
                        />
                      );
                    }}
                  </For>
                </ul>
              </Show>
              <Show when={canAddInfoField()}>
                <button
                  type="button"
                  class="btn-subtle cl-add-btn"
                  onClick={onAddChecklist}
                  disabled={busy()}
                >
                  <Icon name="plus" size={14} />
                  <span>Checkliste</span>
                </button>
              </Show>
            </section>
          </Show>

          <ModalTransition when={Boolean(selectedCard())}>
            <Show when={selectedCard()}>
              {(card) => (
                <CardOverlay
                  card={card()}
                  content={content()}
                  onClose={() => setSelectedCardId(null)}
                  onChanged={() => p.onChanged?.()}
                  wsAtomPins={p.wsAtomPins}
                  wsDocs={p.wsDocs}
                  wsAtomTagsEnriched={p.wsAtomTagsEnriched}
                  workspaceId={p.workspaceId}
                  atomPickerEntries={p.atomPickerEntries}
                  wsCells={p.wsCells}
                  wsNodes={p.wsNodes}
                  cellLabelById={p.cellLabelById}
                  tagsRealtimeVersion={p.tagsRealtimeVersion}
                />
              )}
            </Show>
          </ModalTransition>

          <ModalTransition when={bulkAddOpen()}>
            <BulkAddModal
              workspaceId={p.workspaceId}
              mode="board-cols"
              parentId={p.boardId}
              sourceNodeId={p.boardId}
              onClose={() => setBulkAddOpen(false)}
              onCreated={() => p.onChanged?.()}
            />
          </ModalTransition>
        </div>
      )}
    </Show>
  );
};

export default BoardView;
