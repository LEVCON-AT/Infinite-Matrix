import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import type { CellFeature, CellRow, ColRow, MatrixContent, RowRow } from '../lib/types';
import { useEditMode } from '../lib/edit-mode';
import { addCol, addRow, delCol, delRow, renameCol, renameRow } from '../lib/mutations';
import { showToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';

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

const MatrixView: Component<Props> = (p) => {
  const navigate = useNavigate();
  const editMode = useEditMode();

  const [busy, setBusy] = createSignal(false);

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
    const prompt = used
      ? `Zeile "${row.label || '(leer)'}" loeschen? Enthaelt Zellen mit Inhalt.`
      : `Zeile "${row.label || '(leer)'}" loeschen?`;
    if (!window.confirm(prompt)) return;
    await wrap(() => delRow(row.id), 'Zeile geloescht.');
  }

  async function onDelCol(col: ColRow) {
    const used = (p.content?.cells ?? []).some((c) => c.col_id === col.id);
    const prompt = used
      ? `Spalte "${col.label || '(leer)'}" loeschen? Enthaelt Zellen mit Inhalt.`
      : `Spalte "${col.label || '(leer)'}" loeschen?`;
    if (!window.confirm(prompt)) return;
    await wrap(() => delCol(col.id), 'Spalte geloescht.');
  }

  return (
    <div class="matrix-wrap">
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
                        const isClickable = () => targetNode() != null && !editMode();
                        return (
                          <div
                            class="mx-cell"
                            classList={{
                              'mx-cell-empty': !cell(),
                              'mx-cell-clickable': isClickable(),
                            }}
                            role={isClickable() ? 'button' : undefined}
                            tabIndex={isClickable() ? 0 : -1}
                            onClick={() => !editMode() && onCellClick(cell())}
                            onKeyDown={(e) => {
                              if (!isClickable()) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onCellClick(cell());
                              }
                            }}
                          >
                            <Show when={cell()?.alias}>
                              <span class="mx-cell-alias">^{cell()!.alias}</span>
                            </Show>
                            <Show when={features().length > 0}>
                              <div class="mx-cell-feats">
                                <For each={features()}>
                                  {(f) => (
                                    <span
                                      class="mx-feat-chip"
                                      data-feat={f}
                                      title={FEATURE_LABEL[f]}
                                    >
                                      {FEATURE_ICON[f]}
                                    </span>
                                  )}
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
