import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
import type { CellFeature, CellRow, ColRow, MatrixContent, RowRow } from '../lib/types';
import { useEditMode } from '../lib/edit-mode';
import { findFeatureByHotkey } from '../lib/features';
import { addCol, addRow, delCol, delRow, renameCol, renameRow } from '../lib/mutations';
import { lastFocusCell, setLastFocusCell } from '../lib/navigation-focus';
import { showToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';
import CellOverlay from './CellOverlay';

const FEATURE_ORDER: CellFeature[] = ['matrix', 'board', 'info', 'checklists'];

const FEATURE_ICON: Record<CellFeature, string> = {
  matrix: '▦',
  board: '▤',
  info: 'i',
  checklists: '✓',
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
  onChanged?: () => void;
};

type OverlayTarget = { row: RowRow; col: ColRow; cell: CellRow | undefined };

const MatrixView: Component<Props> = (p) => {
  const navigate = useNavigate();
  const editMode = useEditMode();

  const [busy, setBusy] = createSignal(false);
  const [overlayTarget, setOverlayTarget] = createSignal<OverlayTarget | null>(null);

  const cellMap = createMemo(() => {
    const m = new Map<string, CellRow>();
    for (const c of p.content?.cells ?? []) m.set(`${c.row_id}::${c.col_id}`, c);
    return m;
  });

  // Fokus-Koordinate der Zelle fuer Back-Navigation merken, BEVOR navigiert
  // wird. Nach ESC-zurueck fokussiert Matrix-View die Zelle wieder — User
  // kann ohne weitere Klicks mit 1/2 in ein anderes Feature derselben Zelle.
  function rememberCellFocus(rowId: string, colId: string) {
    setLastFocusCell({ matrixId: p.matrixId, rowId, colId });
  }

  function onCellClick(cell: CellRow | undefined, row: RowRow, col: ColRow) {
    if (!cell) return;
    const targetNode = cell.child_matrix_id ?? cell.board_id;
    if (!targetNode) return;
    rememberCellFocus(row.id, col.id);
    navigate(`/w/${p.workspaceId}/n/${targetNode}`);
  }

  function onChipClick(
    e: MouseEvent,
    cell: CellRow | undefined,
    featKey: string,
    row: RowRow,
    col: ColRow,
  ) {
    // stopPropagation IMMER — sonst bubbelt der Click zur Cell und
    // navigiert faelschlich zum child_matrix_id, wenn der Chip ein
    // Flag-Feature (info/checklists) ohne eigenes Nav-Target ist.
    e.stopPropagation();
    if (!cell) return;
    const targetNode =
      featKey === 'matrix'
        ? cell.child_matrix_id
        : featKey === 'board'
          ? cell.board_id
          : null;
    if (!targetNode) {
      // Flag-Chip ohne Sub-Node → Zell-Overlay oeffnen, damit der User
      // die Feature-Konfiguration sieht. (Ein echtes Checklist-Panel
      // kommt separat in 0e.1.d.x.)
      onCellEdit(row, col, cell);
      return;
    }
    rememberCellFocus(row.id, col.id);
    navigate(`/w/${p.workspaceId}/n/${targetNode}`);
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

  async function onRenameRow(row: RowRow, newLabel: string) {
    if (newLabel === row.label) return;
    await wrap(() => renameRow(row.id, newLabel));
  }

  async function onRenameCol(col: ColRow, newLabel: string) {
    if (newLabel === col.label) return;
    await wrap(() => renameCol(col.id, newLabel));
  }

  async function onDelRow(row: RowRow) {
    const used = (p.content?.cells ?? []).some((c) => c.row_id === row.id);
    if (used) {
      if (!window.confirm(`Zeile "${row.label || '(leer)'}" loeschen? Enthaelt Zellen mit Inhalt.`)) {
        return;
      }
    }
    await wrap(() => delRow(row.id), 'Zeile geloescht.');
  }

  async function onDelCol(col: ColRow) {
    const used = (p.content?.cells ?? []).some((c) => c.col_id === col.id);
    if (used) {
      if (!window.confirm(`Spalte "${col.label || '(leer)'}" loeschen? Enthaelt Zellen mit Inhalt.`)) {
        return;
      }
    }
    await wrap(() => delCol(col.id), 'Spalte geloescht.');
  }

  function onCellEdit(row: RowRow, col: ColRow, cell: CellRow | undefined) {
    // KEIN rememberCellFocus hier — sonst triggert der Focus-Restore-
    // Effect parallel zum Overlay-onMount und klaut den Alias-Autofocus
    // (Race). Den Focus-Rueckweg erledigt der Overlay selbst via
    // onCleanup (fokussiert die data-row-id/data-col-id-Zelle).
    setOverlayTarget({ row, col, cell });
  }

  // ─── Hotkeys 1/2 auf fokussierter Zelle: direkt zum Sub-Feature ──
  // Wenn die fokussierte Zelle eine Sub-Matrix/Board hat, springt der
  // entsprechende Hotkey (aus CELL_FEATURES) dorthin. Flag-Features
  // (info/checklists) haben keine Navigation; nichts passiert.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const ae = document.activeElement as HTMLElement | null;
      if (!ae || !ae.classList.contains('mx-cell')) return;

      const def = findFeatureByHotkey(e.key);
      if (!def || def.kind !== 'structural') return;

      const rowId = ae.getAttribute('data-row-id');
      const colId = ae.getAttribute('data-col-id');
      if (!rowId || !colId) return;
      const cell = cellMap().get(`${rowId}::${colId}`);
      if (!cell) return;

      const targetNode =
        def.key === 'matrix' ? cell.child_matrix_id : cell.board_id;
      if (!targetNode) return;

      e.preventDefault();
      rememberCellFocus(rowId, colId);
      navigate(`/w/${p.workspaceId}/n/${targetNode}`);
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  // ─── Focus-Restore nach Back-Navigation ─────────────────────────
  // Nach Navigate -> Sub-Node -> ESC zurueck: wenn die Zelle im neuen
  // Content existiert und matrixId passt, focus zurueck. queueMicrotask
  // stellt sicher, dass das DOM gerendert ist.
  createEffect(() => {
    const target = lastFocusCell();
    if (!target) return;
    if (target.matrixId !== p.matrixId) return;
    if (!p.content) return;
    queueMicrotask(() => {
      // Schutz: wenn ein Overlay offen ist oder gerade ein Input/Textarea
      // fokussiert ist (z.B. Alias im CellOverlay), nicht in die Zelle
      // zurueckspringen.
      const ae = document.activeElement as HTMLElement | null;
      if (
        ae &&
        (ae.tagName === 'INPUT' ||
          ae.tagName === 'TEXTAREA' ||
          ae.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('.overlay-scrim')) return;
      const el = document.querySelector(
        `.mx-cell[data-row-id="${target.rowId}"][data-col-id="${target.colId}"]`,
      ) as HTMLElement | null;
      if (el && document.activeElement !== el) {
        el.focus({ preventScroll: true });
      }
    });
  });

  return (
    <div class="matrix-wrap">
      <Show when={overlayTarget()}>
        <CellOverlay
          workspaceId={p.workspaceId}
          matrixId={p.matrixId}
          row={overlayTarget()!.row}
          col={overlayTarget()!.col}
          cell={overlayTarget()!.cell}
          onClose={() => setOverlayTarget(null)}
          onChanged={() => p.onChanged?.()}
        />
      </Show>

      <Show
        when={(p.content?.rows.length ?? 0) > 0 && (p.content?.cols.length ?? 0) > 0}
        fallback={
          <div class="matrix-empty">
            <Show when={p.content} fallback={<p class="hint">Lade Matrix…</p>}>
              <p class="hint">
                Leere Matrix.
                <Show when={editMode()}>
                  {' '}Zeile und Spalte anlegen, um zu starten.
                </Show>
              </p>
              <Show when={editMode()}>
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
        {(_) => {
          const rows = () => p.content!.rows;
          const cols = () => p.content!.cols;

          // Eine Extra-Spalte rechts fuer "+ Spalte"-Button im Edit-Mode.
          const gridStyle = () => {
            const colCount = cols().length;
            const extra = editMode() ? ' minmax(60px, auto)' : '';
            return `grid-template-columns: minmax(140px, max-content) repeat(${colCount}, minmax(160px, 1fr))${extra};`;
          };

          return (
            <div class="matrix-grid" style={gridStyle()}>
              {/* Header-Ecke */}
              <div class="mx-corner" />

              <For each={cols()}>
                {(col) => (
                  <div class="mx-col-head" classList={{ 'mx-editable': editMode() }}>
                    <Show
                      when={editMode()}
                      fallback={<span class="mx-col-label">{col.label || '(Spalte)'}</span>}
                    >
                      <input
                        class="mx-head-input"
                        type="text"
                        value={col.label}
                        placeholder="(Spalte)"
                        onBlur={(e) => onRenameCol(col, e.currentTarget.value.trim())}
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
                        title="Spalte loeschen"
                        aria-label="Spalte loeschen"
                        onClick={() => onDelCol(col)}
                        disabled={busy()}
                      >
                        ✕
                      </button>
                    </Show>
                  </div>
                )}
              </For>

              {/* Ecke rechts oben: "+ Spalte" */}
              <Show when={editMode()}>
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
                {(row) => (
                  <>
                    <div class="mx-row-head" classList={{ 'mx-editable': editMode() }}>
                      <Show
                        when={editMode()}
                        fallback={
                          <span class="mx-row-label">{row.label || '(Zeile)'}</span>
                        }
                      >
                        <input
                          class="mx-head-input"
                          type="text"
                          value={row.label}
                          placeholder="(Zeile)"
                          onBlur={(e) => onRenameRow(row, e.currentTarget.value.trim())}
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
                          title="Zeile loeschen"
                          aria-label="Zeile loeschen"
                          onClick={() => onDelRow(row)}
                          disabled={busy()}
                        >
                          ✕
                        </button>
                      </Show>
                    </div>
                    <For each={cols()}>
                      {(col) => {
                        const cell = () => cellMap().get(`${row.id}::${col.id}`);
                        const features = () =>
                          (cell()?.features ?? []).filter((f): f is CellFeature =>
                            (FEATURE_ORDER as string[]).includes(f),
                          );
                        const targetNode = () =>
                          cell()?.child_matrix_id ?? cell()?.board_id ?? null;
                        // Navigation hat Vorrang — auch im Edit-Mode. Zelle
                        // mit Sub-Node navigiert dorthin; Zelle ohne Sub-Node
                        // oeffnet im Edit-Mode das Overlay (Konfiguration).
                        // Fuer Konfiguration einer Zelle MIT Sub-Node gibts
                        // den ⚙-Button rechts oben.
                        const isNavigable = () => targetNode() != null;
                        const isClickable = () => isNavigable() || editMode();
                        return (
                          <div
                            class="mx-cell"
                            classList={{
                              'mx-cell-empty': !cell(),
                              'mx-cell-clickable': isClickable(),
                              'mx-cell-editable': editMode(),
                            }}
                            role={isClickable() ? 'button' : undefined}
                            tabIndex={isClickable() ? 0 : -1}
                            data-row-id={row.id}
                            data-col-id={col.id}
                            onClick={() => {
                              if (isNavigable()) onCellClick(cell(), row, col);
                              else if (editMode()) onCellEdit(row, col, cell());
                            }}
                            onKeyDown={(e) => {
                              if (!isClickable()) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                if (isNavigable()) onCellClick(cell(), row, col);
                                else onCellEdit(row, col, cell());
                              }
                            }}
                          >
                            <Show when={editMode()}>
                              <button
                                type="button"
                                class="mx-cell-edit-btn"
                                title="Zelle bearbeiten"
                                aria-label="Zelle bearbeiten"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onCellEdit(row, col, cell());
                                }}
                              >
                                ⚙
                              </button>
                            </Show>
                            <Show when={cell()?.alias}>
                              <span class="mx-cell-alias">^{cell()!.alias}</span>
                            </Show>
                            <Show when={features().length > 0}>
                              <div class="mx-cell-feats">
                                <For each={features()}>
                                  {(f) => {
                                    const navTarget =
                                      f === 'matrix'
                                        ? cell()?.child_matrix_id
                                        : f === 'board'
                                          ? cell()?.board_id
                                          : null;
                                    const chipClickable = () => !!navTarget;
                                    return (
                                      <span
                                        class="mx-feat-chip"
                                        classList={{
                                          'mx-feat-chip-link': chipClickable(),
                                        }}
                                        data-feat={f}
                                        title={
                                          navTarget
                                            ? `${FEATURE_LABEL[f]} oeffnen`
                                            : FEATURE_LABEL[f]
                                        }
                                        onClick={(e) =>
                                          onChipClick(e, cell(), f, row, col)
                                        }
                                      >
                                        {FEATURE_ICON[f]}
                                      </span>
                                    );
                                  }}
                                </For>
                              </div>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                    <Show when={editMode()}>
                      <div class="mx-row-tail" />
                    </Show>
                  </>
                )}
              </For>

              {/* Ecke unten links: "+ Zeile" */}
              <Show when={editMode()}>
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
    </div>
  );
};

export default MatrixView;
