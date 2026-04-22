import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import type { CellFeature, CellRow, ColRow, MatrixContent, RowRow } from '../lib/types';
import { useEditMode } from '../lib/edit-mode';
import { addCol, addRow, delCol, delRow, renameCol, renameRow } from '../lib/mutations';
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

  function onCellClick(cell: CellRow | undefined) {
    if (!cell) return;
    const targetNode = cell.child_matrix_id ?? cell.board_id;
    if (!targetNode) return;
    navigate(`/w/${p.workspaceId}/n/${targetNode}`);
  }

  function onChipClick(e: MouseEvent, cell: CellRow | undefined, featKey: string) {
    if (!cell) return;
    // Chips im Edit-Mode sollen NICHT das Cell-Overlay oeffnen, sondern
    // direkt zum Ziel-Node navigieren (Alt-Client-Muster). stopPropagation
    // verhindert den Cell-Click-Handler.
    const targetNode =
      featKey === 'matrix'
        ? cell.child_matrix_id
        : featKey === 'board'
          ? cell.board_id
          : null;
    if (!targetNode) return;
    e.stopPropagation();
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
    setOverlayTarget({ row, col, cell });
  }

  return (
    <div class="matrix-wrap">
      <Show when={overlayTarget()}>
        {(t) => (
          <CellOverlay
            workspaceId={p.workspaceId}
            matrixId={p.matrixId}
            row={t().row}
            col={t().col}
            cell={t().cell}
            onClose={() => setOverlayTarget(null)}
            onChanged={() => p.onChanged?.()}
          />
        )}
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
                        const isReadClickable = () => targetNode() != null && !editMode();
                        const isEditClickable = () => editMode();
                        const isClickable = () => isReadClickable() || isEditClickable();
                        return (
                          <div
                            class="mx-cell"
                            classList={{
                              'mx-cell-empty': !cell(),
                              'mx-cell-clickable': isClickable(),
                              'mx-cell-editable': isEditClickable(),
                            }}
                            role={isClickable() ? 'button' : undefined}
                            tabIndex={isClickable() ? 0 : -1}
                            onClick={() => {
                              if (editMode()) onCellEdit(row, col, cell());
                              else if (isReadClickable()) onCellClick(cell());
                            }}
                            onKeyDown={(e) => {
                              if (!isClickable()) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                if (editMode()) onCellEdit(row, col, cell());
                                else onCellClick(cell());
                              }
                            }}
                          >
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
                                        onClick={(e) => onChipClick(e, cell(), f)}
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
