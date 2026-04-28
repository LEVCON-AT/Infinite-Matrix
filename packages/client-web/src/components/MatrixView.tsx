import { useNavigate, useSearchParams } from '@solidjs/router';
import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { showConfirm } from '../lib/dialog';
import { openDocsPopup } from '../lib/docs-ui';
import { useEditMode } from '../lib/edit-mode';
import { translateDbError } from '../lib/errors';
import { findFeatureByHotkey } from '../lib/features';
import {
  addCol,
  addRow,
  delCol,
  delRow,
  renameAndLinkCol,
  renameAndLinkRow,
  renameCol,
  renameRow,
  restoreColWithCells,
  restoreRowWithCells,
  setColPosition,
  setRowPosition,
} from '../lib/mutations';
import { rememberFocus, useLastFocus } from '../lib/navigation-focus';
import { ensureObjectForCol, ensureObjectForRow } from '../lib/objects';
import type { PresenceUser } from '../lib/presence';
import { useVis } from '../lib/settings';
import { showToast, showUndoToast } from '../lib/toasts';
import type { CellFeature, CellRow, ColRow, MatrixContent, NodeRow, RowRow } from '../lib/types';
import {
  closeObjectSuggest,
  commitObjectSuggest,
  navigateObjectSuggest,
  objectSuggestState,
  openObjectSuggest,
} from '../lib/use-object-suggest';
import CellOverlay from './CellOverlay';
import Icon, { type IconName } from './Icon';
import MatrixAggregateSection from './MatrixAggregateSection';
import PresenceMini from './PresenceMini';

const FEATURE_ORDER: CellFeature[] = ['matrix', 'board', 'info', 'checklists'];

const FEATURE_ICON: Record<CellFeature, IconName> = {
  matrix: 'squares-2x2',
  board: 'view-columns',
  info: 'information-circle',
  checklists: 'check-circle',
};

const FEATURE_LABEL: Record<CellFeature, string> = {
  matrix: 'Sub-Matrix',
  board: 'Board',
  info: 'Info',
  checklists: 'Checklisten',
};

type Props = {
  workspaceId: string;
  matrixId: string;
  content: MatrixContent | undefined;
  // Set der cell_ids mit angehaengten Docs — fuer die derived
  // Doku-Pill. Workspace-weit; Matrix filtert clientseitig.
  cellsWithDocs: Set<string>;
  // Workspace-weite Daten fuer die Aggregat-Sektion unter der
  // Matrix (Intervallmatrix / Aufgabenuebersicht). Koennen
  // undefined sein, wenn die Resources noch laden — die Sektion
  // rendert dann einfach nichts.
  wsNodes: NodeRow[];
  wsCells: CellRow[];
  wsRows: RowRow[];
  wsCols: ColRow[];
  // Realtime-Version fuer Cards-Fetch in der Aggregat-Sektion.
  cardsRealtimeVersion: number;
  onChanged?: () => void;
  // P1.D: Live-Cursor-Indikator. presence/selfUserId aus Workspace.tsx-
  // Hoist, onCellHover meldet die aktuelle Hover-Cell zurueck (in den
  // Presence-Payload).
  presence?: () => PresenceUser[];
  selfUserId?: string;
  onCellHover?: (cellId: string | undefined) => void;
};

type OverlayTarget = { row: RowRow; col: ColRow; cell: CellRow | undefined };

const MatrixView: Component<Props> = (p) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const editMode = useEditMode();

  // P1.D: Live-Cursor-Map. Bei jedem Presence-Update einmal eine
  // Map<cellId, PresenceUser[]> aufbauen statt pro Cell zu filtern —
  // sonst sind das bei 200 Cells × 10 Usern 200 createMemos.
  const presenceByCell = createMemo<Map<string, PresenceUser[]>>(() => {
    const map = new Map<string, PresenceUser[]>();
    const all = p.presence?.() ?? [];
    for (const u of all) {
      if (u.userId === p.selfUserId) continue;
      const cid = u.hoverCellId;
      if (!cid) continue;
      const arr = map.get(cid);
      if (arr) arr.push(u);
      else map.set(cid, [u]);
    }
    return map;
  });

  // Cleanup: bei Component-Unmount eigenen Hover clearen, sonst bleibt
  // der Cursor fuer andere User auf der letzten Cell stehen — auch
  // nach Page-Wechsel.
  onCleanup(() => {
    p.onCellHover?.(undefined);
  });

  // Fein granulierte Sichtbarkeits-Flags — Default 'edit' verhaelt sich
  // identisch zu editMode(), User kann aber per Settings-Modal einzeln
  // auf 'always' / 'never' stellen.
  const canAddRowCol = useVis('addRowCol');
  const canDeleteRowCol = useVis('deleteRowCol');
  const canRenameHeaders = useVis('renameHeaders');
  const canMoveRowCol = useVis('moveArrows');
  // Kombinierter Trigger fuer den Hover-Reveal-Parent (.mx-editable).
  // Wenn mindestens eine Header-Aktion sichtbar ist, soll der Hover-Rahmen
  // die Buttons zeigen; ohne bleibt der Header „nur-lesen".
  const headerEditable = () => canDeleteRowCol() || canRenameHeaders() || canMoveRowCol();

  const [busy, setBusy] = createSignal(false);
  const [overlayTarget, setOverlayTarget] = createSignal<OverlayTarget | null>(null);
  // Guard: Initial-Focus (0,0) nur einmal pro Matrix-Besuch. Verhindert,
  // dass jede Content-Mutation den Fokus auf (0,0) zurueckreisst.
  const [initialFocusedFor, setInitialFocusedFor] = createSignal<string | null>(null);

  const cellMap = createMemo(() => {
    const m = new Map<string, CellRow>();
    for (const c of p.content?.cells ?? []) m.set(`${c.row_id}::${c.col_id}`, c);
    return m;
  });

  // Race-Schutz: Beim Matrix-Wechsel via Sidebar wird p.matrixId sofort
  // vom Router auf das neue Ziel gesetzt, aber createResource
  // (matrixContent) haelt waehrend des Refetches den alten Wert. In diesem
  // Zwischenzustand haette MatrixView rows/cols der ALTEN Matrix unter
  // NEUER matrixId — onFocus wuerde die focusMap der Ziel-Matrix mit
  // fremden Row-/Col-IDs vergiften, und der Restore nach Sidebar-Nav
  // landet ewig auf (0,0). Also: Content-Matrix-Fingerprint vergleichen
  // und stale Content ignorieren.
  const contentMatches = createMemo(() => {
    const c = p.content;
    if (!c) return false;
    const ref = c.rows[0]?.matrix_id ?? c.cols[0]?.matrix_id;
    // Leere Matrix (keine Rows + Cols) — nichts zu vergleichen, passt.
    if (!ref) return true;
    return ref === p.matrixId;
  });

  // Fokus-Koordinate der Zelle fuer Back-Navigation merken, BEVOR navigiert
  // wird. Wird auch bei jedem onFocus der Zelle gerufen (Pfeiltasten/Tab/
  // Maus) — so ueberlebt die Position einen Matrix-Wechsel via Sidebar
  // und Rueckkehr landet auf derselben Zelle.
  function rememberCellFocus(rowId: string, colId: string) {
    rememberFocus(p.matrixId, rowId, colId);
  }

  function onChipClick(
    e: MouseEvent,
    cell: CellRow | undefined,
    featKey: string,
    row: RowRow,
    col: ColRow,
  ) {
    // stopPropagation IMMER — damit der Zell-Hintergrund-Handler nicht
    // zusaetzlich feuert (der macht im Edit-Mode das Overlay).
    e.stopPropagation();
    if (!cell) return;
    if (featKey === 'matrix' && cell.child_matrix_id) {
      rememberCellFocus(row.id, col.id);
      navigate(`/w/${p.workspaceId}/n/${cell.child_matrix_id}`);
      return;
    }
    if (featKey === 'board' && cell.board_id) {
      rememberCellFocus(row.id, col.id);
      navigate(`/w/${p.workspaceId}/n/${cell.board_id}`);
      return;
    }
    // Flag-Features (info/checklists): eigene Zell-Seite als Vollbild,
    // analog zu Sub-Matrix/Sub-Board. ESC auf der Page bringt zurueck.
    if (featKey === 'checklists') {
      rememberCellFocus(row.id, col.id);
      navigate(`/w/${p.workspaceId}/c/${cell.id}/checklists`);
      return;
    }
    if (featKey === 'info') {
      rememberCellFocus(row.id, col.id);
      navigate(`/w/${p.workspaceId}/c/${cell.id}/info`);
      return;
    }
  }

  async function wrap<T>(fn: () => Promise<T>, successMsg?: string) {
    if (busy()) return;
    setBusy(true);
    try {
      await fn();
      if (successMsg) showToast(successMsg, 'success');
      p.onChanged?.();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onAddRow() {
    await wrap(() => addRow({ workspaceId: p.workspaceId, matrixId: p.matrixId }));
  }

  async function onAddCol() {
    await wrap(() => addCol({ workspaceId: p.workspaceId, matrixId: p.matrixId }));
  }

  async function onRenameRow(row: RowRow, newLabel: string, pickedObjectId: string | null) {
    if (newLabel === row.label && !pickedObjectId) return;
    if (pickedObjectId && pickedObjectId !== row.object_id) {
      // Phase 3 O.2b: User hat einen existing Object aus dem
      // Suggestion-Dropdown gepickt → Cross-Cut. Direkt label +
      // object_id in einem Update.
      await wrap(() => renameAndLinkRow(row.id, newLabel, pickedObjectId));
    } else {
      await wrap(() => renameRow(row.id, newLabel));
      // Phase 3 O.2a: bei erstmaligem Label-Set Auto-Object on-the-fly
      // anlegen + linken. Idempotent (no-op wenn schon object_id).
      void ensureObjectForRow({
        id: row.id,
        workspace_id: row.workspace_id,
        label: newLabel,
        object_id: row.object_id ?? null,
      });
    }
  }

  async function onRenameCol(col: ColRow, newLabel: string, pickedObjectId: string | null) {
    if (newLabel === col.label && !pickedObjectId) return;
    if (pickedObjectId && pickedObjectId !== col.object_id) {
      await wrap(() => renameAndLinkCol(col.id, newLabel, pickedObjectId));
    } else {
      await wrap(() => renameCol(col.id, newLabel));
      void ensureObjectForCol({
        id: col.id,
        workspace_id: col.workspace_id,
        label: newLabel,
        object_id: col.object_id ?? null,
      });
    }
  }

  // Helper: gemeinsames Set-Up fuer Row/Col-Header-Input. Liefert
  // onInput/onKeyDown/onBlur-Handler die das Object-Suggest-Singleton
  // bedienen und am Ende args.commit(label, pickedObjectId) rufen.
  //
  // Drei User-Pfade muenden in args.commit:
  //   1. Click auf Dropdown-Item → onPick-Callback ruft commit
  //   2. Enter mit highlight → commitObjectSuggest gibt hit zurueck,
  //      onKeyDown ruft commit
  //   3. Blur ohne Pick → onBlur ruft commit mit pickedObjectId=null
  function makeHeaderHandlers(args: {
    getLabel: () => string;
    getObjectId: () => string | null;
    workspaceId: string;
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
            workspaceId: args.workspaceId,
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
          // commitObjectSuggest hat onPick bereits gerufen wenn picked.
          // Bei picked: haben wir den commit schon ueber onPick. Nur
          // Plain-Rename-Pfad braucht expliziten commit.
          if (!picked) {
            void args.commit(finalLabel, null);
          }
        }
      },
      onBlur: (e: FocusEvent & { currentTarget: HTMLInputElement }) => {
        if (!canRenameHeaders()) return;
        // Defer um onMouseDown im Dropdown-Item zuzulassen.
        setTimeout(() => closeObjectSuggest(), 100);
        const finalLabel = e.currentTarget.value.trim();
        if (finalLabel !== args.getLabel()) {
          void args.commit(finalLabel, null);
        }
      },
    };
  }

  async function onDelRow(row: RowRow) {
    const rowCells = (p.content?.cells ?? []).filter((c) => c.row_id === row.id);
    if (rowCells.length > 0) {
      const ok = await showConfirm({
        title: 'Zeile loeschen?',
        message: `Zeile "${row.label || '(leer)'}" loeschen? Enthaelt Zellen mit Inhalt.`,
        variant: 'danger',
        confirmLabel: 'Loeschen',
      });
      if (!ok) return;
    }
    const rowSnap: RowRow = { ...row };
    const cellSnaps: CellRow[] = rowCells.map((c) => ({ ...c }));
    await wrap(() => delRow(row.id));
    showUndoToast(`Zeile "${rowSnap.label || '(leer)'}" geloescht.`, () => {
      void (async () => {
        try {
          await restoreRowWithCells(rowSnap, cellSnaps);
          showToast('Zeile wiederhergestellt.', 'success');
          p.onChanged?.();
        } catch (err) {
          showToast(translateDbError(err), 'error');
        }
      })();
    });
  }

  async function onDelCol(col: ColRow) {
    const colCells = (p.content?.cells ?? []).filter((c) => c.col_id === col.id);
    if (colCells.length > 0) {
      const ok = await showConfirm({
        title: 'Spalte loeschen?',
        message: `Spalte "${col.label || '(leer)'}" loeschen? Enthaelt Zellen mit Inhalt.`,
        variant: 'danger',
        confirmLabel: 'Loeschen',
      });
      if (!ok) return;
    }
    const colSnap: ColRow = { ...col };
    const cellSnaps: CellRow[] = colCells.map((c) => ({ ...c }));
    await wrap(() => delCol(col.id));
    showUndoToast(`Spalte "${colSnap.label || '(leer)'}" geloescht.`, () => {
      void (async () => {
        try {
          await restoreColWithCells(colSnap, cellSnaps);
          showToast('Spalte wiederhergestellt.', 'success');
          p.onChanged?.();
        } catch (err) {
          showToast(translateDbError(err), 'error');
        }
      })();
    });
  }

  // Reorder: Swap mit dem direkten Nachbarn (positionsbezogen). Zwei
  // Updates hintereinander — es gibt keine UNIQUE(matrix_id, position)-
  // Constraint, also ist die temporaere Kollision der Zwischenschritte
  // unkritisch. Nach Erfolg refetcht onChanged() und der Re-Render
  // greift die neuen Positionen.
  async function onMoveRow(row: RowRow, direction: 'up' | 'down') {
    const list = p.content?.rows ?? [];
    const idx = list.findIndex((r: RowRow) => r.id === row.id);
    if (idx < 0) return;
    const neighbourIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (neighbourIdx < 0 || neighbourIdx >= list.length) return;
    const neighbour = list[neighbourIdx];
    await wrap(async () => {
      await setRowPosition(row.id, neighbour.position);
      await setRowPosition(neighbour.id, row.position);
    });
  }

  async function onMoveCol(col: ColRow, direction: 'left' | 'right') {
    const list = p.content?.cols ?? [];
    const idx = list.findIndex((c: ColRow) => c.id === col.id);
    if (idx < 0) return;
    const neighbourIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (neighbourIdx < 0 || neighbourIdx >= list.length) return;
    const neighbour = list[neighbourIdx];
    await wrap(async () => {
      await setColPosition(col.id, neighbour.position);
      await setColPosition(neighbour.id, col.position);
    });
  }

  function onCellEdit(row: RowRow, col: ColRow, cell: CellRow | undefined) {
    // KEIN rememberCellFocus hier — sonst triggert der Focus-Restore-
    // Effect parallel zum Overlay-onMount und klaut den Alias-Autofocus
    // (Race). Den Focus-Rueckweg erledigt der Overlay selbst via
    // onCleanup (fokussiert die data-row-id/data-col-id-Zelle).
    setOverlayTarget({ row, col, cell });
  }

  // ─── Keyboard auf fokussierter Zelle ─────────────────────────
  // 1/2       : Sub-Matrix / Sub-Board oeffnen (structural Hotkey)
  // Arrows    : Focus auf Nachbar-Zelle verschieben (clamp am Rand)
  // Greift nur wenn Fokus auf einer .mx-cell und ohne Modifier.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const ae = document.activeElement as HTMLElement | null;
      if (!ae || !ae.classList.contains('mx-cell')) return;

      const rowId = ae.getAttribute('data-row-id');
      const colId = ae.getAttribute('data-col-id');
      if (!rowId || !colId) return;

      // Pfeiltasten — Nachbar-Zelle fokussieren.
      if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight'
      ) {
        const rows = p.content?.rows ?? [];
        const cols = p.content?.cols ?? [];
        const ri = rows.findIndex((r) => r.id === rowId);
        const ci = cols.findIndex((c) => c.id === colId);
        if (ri < 0 || ci < 0) return;

        let nr = ri;
        let nc = ci;
        if (e.key === 'ArrowUp') nr = Math.max(0, ri - 1);
        else if (e.key === 'ArrowDown') nr = Math.min(rows.length - 1, ri + 1);
        else if (e.key === 'ArrowLeft') nc = Math.max(0, ci - 1);
        else if (e.key === 'ArrowRight') nc = Math.min(cols.length - 1, ci + 1);
        if (nr === ri && nc === ci) return;

        e.preventDefault();
        const nrow = rows[nr];
        const ncol = cols[nc];
        if (!nrow || !ncol) return;
        const el = document.querySelector(
          `.mx-cell[data-row-id="${nrow.id}"][data-col-id="${ncol.id}"]`,
        ) as HTMLElement | null;
        el?.focus({ preventScroll: false });
        return;
      }

      // "d" — Doku-Popup fuer diese Zelle oeffnen. source_alias +
      // attachedCellId werden vorausgefuellt, damit die Doku direkt
      // mit der Quelle verknuepft entsteht. Klappt auch auf Zellen
      // ohne Alias: source_alias ist dann null, der Doc bleibt
      // trotzdem via attached_cell_id und Doku-Pill auffindbar.
      if (e.key === 'd' || e.key === 'D') {
        const cell = cellMap().get(`${rowId}::${colId}`);
        e.preventDefault();
        openDocsPopup({
          sourceAlias: cell?.alias ?? null,
          attachedCellId: cell?.id ?? null,
        });
        return;
      }

      // 1/2 — Sub-Feature direkt oeffnen.
      const def = findFeatureByHotkey(e.key);
      if (!def || def.kind !== 'structural') return;

      const cell = cellMap().get(`${rowId}::${colId}`);
      if (!cell) return;
      const targetNode = def.key === 'matrix' ? cell.child_matrix_id : cell.board_id;
      if (!targetNode) return;

      e.preventDefault();
      rememberCellFocus(rowId, colId);
      navigate(`/w/${p.workspaceId}/n/${targetNode}`);
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  // ─── Deep-Link ?cell=<id> → CellOverlay direkt oeffnen ─────────
  // Quicknav setzt diesen Query-Param, wenn eine Zelle mehrere oder
  // keine Sub-Features hat (sonst navigiert sie direkt ins Feature).
  // Wir holen die Zelle aus p.content, bauen overlayTarget auf, und
  // loeschen den Param aus der URL — so dass ein Refresh das Overlay
  // nicht nochmal aufmacht und die URL sauber bleibt.
  createEffect(() => {
    const content = p.content;
    if (!content || !contentMatches()) return;
    const want = searchParams.cell;
    if (!want || typeof want !== 'string') return;
    const cell = content.cells.find((x) => x.id === want);
    if (!cell) return;
    const row = content.rows.find((r) => r.id === cell.row_id);
    const col = content.cols.find((c) => c.id === cell.col_id);
    if (!row || !col) return;
    setOverlayTarget({ row, col, cell });
    setSearchParams({ cell: undefined }, { replace: true });
  });

  // ─── Focus: Initial + Restore nach Navigation ─────────────────
  // Zwei Faelle gemeinsam behandelt:
  //   a) Neu geladene Matrix ohne vorherigen Besuch → Fokus auf (0,0),
  //      damit Pfeiltasten-Nav sofort funktioniert.
  //   b) Rueckkehr via Sidebar ODER ESC-Back aus Sub-Node → letzte
  //      Zelle derselben Matrix aus focusMap wiederherstellen.
  // queueMicrotask stellt sicher, dass das DOM gerendert ist.
  createEffect(() => {
    const content = p.content;
    if (!content) return;
    // Stale content (alte Matrix unter neuer matrixId) — Restore darf
    // nicht auf fremden rows/cols laufen, sonst faelscht der folgende
    // onFocus die focusMap des neuen Ziels.
    if (!contentMatches()) return;
    const currentMid = p.matrixId;
    const rows = content.rows;
    const cols = content.cols;
    if (rows.length === 0 || cols.length === 0) return;

    const saved = useLastFocus(currentMid);
    const hasRestore = !!saved;
    if (!hasRestore && initialFocusedFor() === currentMid) return;

    queueMicrotask(() => {
      // Schutz: wenn ein Overlay offen ist oder gerade ein Input/Textarea
      // fokussiert ist (z.B. Alias im CellOverlay), nicht in die Zelle
      // zurueckspringen.
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) {
        return;
      }
      if (document.querySelector('.overlay-scrim')) return;

      // Gespeicherte Zelle kann durch Row/Col-Delete verschwunden sein —
      // Fallback: (0,0).
      let rowId = rows[0].id;
      let colId = cols[0].id;
      if (saved) {
        const rowStill = rows.some((r) => r.id === saved.rowId);
        const colStill = cols.some((c) => c.id === saved.colId);
        if (rowStill && colStill) {
          rowId = saved.rowId;
          colId = saved.colId;
        }
      }
      const el = document.querySelector(
        `.mx-cell[data-row-id="${rowId}"][data-col-id="${colId}"]`,
      ) as HTMLElement | null;
      if (el && document.activeElement !== el) {
        el.focus({ preventScroll: true });
      }
      if (!hasRestore) {
        setInitialFocusedFor(currentMid);
      }
    });
  });

  return (
    <div class="matrix-wrap">
      <Show when={overlayTarget()}>
        {(target) => (
          <CellOverlay
            workspaceId={p.workspaceId}
            matrixId={p.matrixId}
            row={target().row}
            col={target().col}
            cell={target().cell}
            onClose={() => setOverlayTarget(null)}
            onChanged={() => p.onChanged?.()}
          />
        )}
      </Show>

      <Show
        when={
          contentMatches() && (p.content?.rows.length ?? 0) > 0 && (p.content?.cols.length ?? 0) > 0
            ? p.content
            : null
        }
        fallback={
          <div class="matrix-empty">
            <Show when={p.content && contentMatches()} fallback={<p class="hint">Lade Matrix…</p>}>
              <p class="hint">
                Leere Matrix.
                <Show when={canAddRowCol()}> Zeile und Spalte anlegen, um zu starten.</Show>
              </p>
              <Show when={canAddRowCol()}>
                <div class="mx-toolbar">
                  <button type="button" onClick={onAddRow} disabled={busy()}>
                    + Zeile
                  </button>
                  <button type="button" onClick={onAddCol} disabled={busy()}>
                    + Spalte
                  </button>
                </div>
              </Show>
            </Show>
          </div>
        }
      >
        {(content) => {
          const rows = () => content().rows;
          const cols = () => content().cols;

          // Eine Extra-Spalte rechts fuer "+ Spalte"-Button im Edit-Mode.
          const gridStyle = () => {
            const colCount = cols().length;
            const extra = canAddRowCol() ? ' minmax(60px, auto)' : '';
            return `grid-template-columns: minmax(140px, max-content) repeat(${colCount}, minmax(160px, 1fr))${extra};`;
          };

          return (
            <div class="matrix-grid" style={gridStyle()}>
              {/* Header-Ecke */}
              <div class="mx-corner" />

              <For each={cols()}>
                {(col, colIdx) => {
                  const handlers = makeHeaderHandlers({
                    getLabel: () => col.label,
                    getObjectId: () => col.object_id ?? null,
                    workspaceId: p.workspaceId,
                    commit: (label, pickedId) => onRenameCol(col, label, pickedId),
                  });
                  return (
                    <div class="mx-col-head" classList={{ 'mx-editable': headerEditable() }}>
                      {/* IMMER Input: readOnly togglet statt span-swap — so
                        bleibt die Kopfzeile beim Edit-Toggle formstabil. */}
                      <input
                        class="mx-head-input"
                        type="text"
                        value={col.label}
                        placeholder="(Spalte)"
                        readOnly={!canRenameHeaders()}
                        tabIndex={canRenameHeaders() ? 0 : -1}
                        onInput={handlers.onInput}
                        onKeyDown={handlers.onKeyDown}
                        onBlur={handlers.onBlur}
                      />
                      <button
                        type="button"
                        class="mx-move-btn"
                        title="Spalte nach links"
                        aria-label="Spalte nach links"
                        tabIndex={canMoveRowCol() ? 0 : -1}
                        onClick={() => onMoveCol(col, 'left')}
                        disabled={busy() || !canMoveRowCol() || colIdx() === 0}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        class="mx-move-btn"
                        title="Spalte nach rechts"
                        aria-label="Spalte nach rechts"
                        tabIndex={canMoveRowCol() ? 0 : -1}
                        onClick={() => onMoveCol(col, 'right')}
                        disabled={busy() || !canMoveRowCol() || colIdx() === cols().length - 1}
                      >
                        ›
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
                        ✕
                      </button>
                    </div>
                  );
                }}
              </For>

              {/* Ecke rechts oben: "+ Spalte" */}
              <Show when={canAddRowCol()}>
                <div class="mx-add-col-cell">
                  <button
                    type="button"
                    class="mx-add-btn"
                    onClick={onAddCol}
                    disabled={busy()}
                    title="Spalte hinzufuegen"
                  >
                    +
                  </button>
                </div>
              </Show>

              {/* Zeilen */}
              <For each={rows()}>
                {(row, rowIdx) => {
                  const handlers = makeHeaderHandlers({
                    getLabel: () => row.label,
                    getObjectId: () => row.object_id ?? null,
                    workspaceId: p.workspaceId,
                    commit: (label, pickedId) => onRenameRow(row, label, pickedId),
                  });
                  return (
                    <>
                      <div class="mx-row-head" classList={{ 'mx-editable': headerEditable() }}>
                        <input
                          class="mx-head-input"
                          type="text"
                          value={row.label}
                          placeholder="(Zeile)"
                          readOnly={!canRenameHeaders()}
                          tabIndex={canRenameHeaders() ? 0 : -1}
                          onInput={handlers.onInput}
                          onKeyDown={handlers.onKeyDown}
                          onBlur={handlers.onBlur}
                        />
                        <button
                          type="button"
                          class="mx-move-btn"
                          title="Zeile nach oben"
                          aria-label="Zeile nach oben"
                          tabIndex={canMoveRowCol() ? 0 : -1}
                          onClick={() => onMoveRow(row, 'up')}
                          disabled={busy() || !canMoveRowCol() || rowIdx() === 0}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          class="mx-move-btn"
                          title="Zeile nach unten"
                          aria-label="Zeile nach unten"
                          tabIndex={canMoveRowCol() ? 0 : -1}
                          onClick={() => onMoveRow(row, 'down')}
                          disabled={busy() || !canMoveRowCol() || rowIdx() === rows().length - 1}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          class="mx-del-btn"
                          title="Zeile loeschen"
                          aria-label="Zeile loeschen"
                          tabIndex={canDeleteRowCol() ? 0 : -1}
                          onClick={() => onDelRow(row)}
                          disabled={busy() || !canDeleteRowCol()}
                        >
                          ✕
                        </button>
                      </div>
                      <For each={cols()}>
                        {(col) => {
                          const cell = () => cellMap().get(`${row.id}::${col.id}`);
                          const features = () =>
                            (cell()?.features ?? []).filter((f): f is CellFeature =>
                              (FEATURE_ORDER as string[]).includes(f),
                            );
                          // Klare Trennung:
                          //   - Hintergrund-Click:
                          //       View  → nichts
                          //       Edit  → Overlay (Konfiguration)
                          //   - Chip-Click:
                          //       Matrix/Board → navigiere zum Sub-Node
                          //       Info/Checklisten → Panel (WIP, siehe onChipClick)
                          // tabIndex=0 immer, damit der User per Tab/Arrow durch
                          // die Matrix navigieren kann (auch im View-Mode).
                          return (
                            <div
                              class="mx-cell"
                              classList={{
                                'mx-cell-empty': !cell(),
                                'mx-cell-clickable': editMode(),
                                'mx-cell-editable': editMode(),
                              }}
                              role={editMode() ? 'button' : 'gridcell'}
                              tabIndex={0}
                              data-row-id={row.id}
                              data-col-id={col.id}
                              onFocus={() => {
                                // Jeder Cell-Focus (Pfeiltasten, Tab, Maus)
                                // aktualisiert lastFocusCell. So kann der
                                // User die Matrix via Sidebar verlassen und
                                // beim Zurueckkommen auf derselben Zelle
                                // landen. Ohne das greift nur der Chip-Click-
                                // oder 1/2-Hotkey-Setter.
                                rememberCellFocus(row.id, col.id);
                              }}
                              onMouseEnter={() => {
                                // P1.D: Live-Cursor — broadcaste die
                                // gehoverte Cell-ID. Leere Zellen haben
                                // keine cell()?.id, dort bleibt der Indi-
                                // kator aus.
                                const cid = cell()?.id;
                                if (cid) p.onCellHover?.(cid);
                              }}
                              onMouseLeave={() => {
                                p.onCellHover?.(undefined);
                              }}
                              onClick={() => {
                                if (editMode()) onCellEdit(row, col, cell());
                              }}
                              onKeyDown={(e) => {
                                if (!editMode()) return;
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  onCellEdit(row, col, cell());
                                }
                              }}
                            >
                              <PresenceMini
                                users={(() => {
                                  const c = cell();
                                  return c ? (presenceByCell().get(c.id) ?? []) : [];
                                })()}
                              />
                              <Show when={cell()?.alias}>
                                {(alias) => <span class="mx-cell-alias">^{alias()}</span>}
                              </Show>
                              <Show
                                when={(() => {
                                  const c = cell();
                                  return features().length > 0 || (c && p.cellsWithDocs.has(c.id));
                                })()}
                              >
                                <div class="mx-cell-feats">
                                  <For each={features()}>
                                    {(f) => {
                                      // Alle Features sind klickbar, sobald die
                                      // Zelle existiert: Strukturelle (matrix/
                                      // board) navigieren zum Sub-Node, Flag-
                                      // Features (info/checklists) auf die
                                      // Zell-Page.
                                      const chipClickable = () => !!cell();
                                      return (
                                        // biome-ignore lint/a11y/useKeyWithClickEvents: Chip-Klick offen-Feature; Tastatur-Bedienung erfolgt via globaler Matrix-Navigation (Pfeiltasten + Enter auf Zelle, dann 1-9 fuer Features).
                                        <span
                                          class="mx-feat-chip"
                                          classList={{
                                            'mx-feat-chip-link': chipClickable(),
                                          }}
                                          data-feat={f}
                                          title={`${FEATURE_LABEL[f]} oeffnen`}
                                          onClick={(e) => onChipClick(e, cell(), f, row, col)}
                                        >
                                          <Icon name={FEATURE_ICON[f]} size={14} />
                                        </span>
                                      );
                                    }}
                                  </For>
                                  <Show
                                    when={(() => {
                                      const c = cell();
                                      return c ? p.cellsWithDocs.has(c.id) : false;
                                    })()}
                                  >
                                    {/* biome-ignore lint/a11y/useKeyWithClickEvents: Chip-Klick offen-Doku; Tastatur-Bedienung via Matrix-Navigation + 'd'-Shortcut (siehe KeyboardHelp). */}
                                    <span
                                      class="mx-feat-chip mx-feat-chip-link"
                                      data-feat="doc"
                                      title="Dokumentation dieser Zelle oeffnen"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const c = cell();
                                        if (!c) return;
                                        navigate(`/w/${p.workspaceId}/c/${c.id}/docs`);
                                      }}
                                    >
                                      <Icon name="document-text" size={14} />
                                    </span>
                                  </Show>
                                </div>
                              </Show>
                            </div>
                          );
                        }}
                      </For>
                      <Show when={canAddRowCol()}>
                        <div class="mx-row-tail" />
                      </Show>
                    </>
                  );
                }}
              </For>

              {/* Ecke unten links: "+ Zeile" */}
              <Show when={canAddRowCol()}>
                <div class="mx-add-row-cell">
                  <button
                    type="button"
                    class="mx-add-btn"
                    onClick={onAddRow}
                    disabled={busy()}
                    title="Zeile hinzufuegen"
                  >
                    +
                  </button>
                </div>
                <For each={cols()}>{() => <div class="mx-add-row-filler" />}</For>
                <div class="mx-add-row-filler" />
              </Show>
            </div>
          );
        }}
      </Show>

      {/* Aggregat-Sektion unter der Matrix: Intervallmatrix +
          (ab FREQ-2) Aufgabenuebersicht. Nur sichtbar wenn aktive
          Karten im Subtree existieren. */}
      <MatrixAggregateSection
        workspaceId={p.workspaceId}
        matrixId={p.matrixId}
        nodes={p.wsNodes}
        cells={p.wsCells}
        rows={p.wsRows}
        cols={p.wsCols}
        realtimeVersion={p.cardsRealtimeVersion}
      />
    </div>
  );
};

export default MatrixView;
