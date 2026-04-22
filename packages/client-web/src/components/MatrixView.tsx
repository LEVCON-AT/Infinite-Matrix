import { For, Show, createMemo, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import type { CellFeature, CellRow, MatrixContent } from '../lib/types';

// Feature-Prioritaet: das "erste" aktive Feature bestimmt den Klick-Fallback,
// wenn die Zelle kein child_matrix_id/board_id hat (dann ist der Klick inert).
// Reihenfolge entspricht der Anzeige-Reihenfolge der Chips.
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
};

const MatrixView: Component<Props> = (p) => {
  const navigate = useNavigate();

  // Lookup: (rowId, colId) -> Cell.
  const cellMap = createMemo(() => {
    const m = new Map<string, CellRow>();
    for (const c of p.content?.cells ?? []) m.set(`${c.row_id}::${c.col_id}`, c);
    return m;
  });

  function onCellClick(cell: CellRow | undefined) {
    if (!cell) return;
    const targetNode = cell.child_matrix_id ?? cell.board_id;
    if (!targetNode) return; // kein Sub-Node -> Klick ohne Wirkung (Edit-Modus kommt in 0e)
    navigate(`/w/${p.workspaceId}/n/${targetNode}`);
  }

  return (
    <Show
      when={p.content && p.content.rows.length > 0 && p.content.cols.length > 0}
      fallback={
        <div class="matrix-empty">
          <Show
            when={p.content}
            fallback={<p class="hint">Lade Matrix…</p>}
          >
            <p class="hint">
              Leere Matrix — Zeilen und Spalten kommen ab 0e (Edit-Mode).
            </p>
          </Show>
        </div>
      }
    >
      {(_) => {
        const rows = () => p.content!.rows;
        const cols = () => p.content!.cols;

        // Grid-Template: Erste Spalte = Row-Header (min-content), Rest 1fr pro Col.
        const gridStyle = () =>
          `grid-template-columns: minmax(120px, max-content) repeat(${cols().length}, minmax(140px, 1fr));`;

        return (
          <div class="matrix-grid" style={gridStyle()}>
            {/* Header-Ecke oben links */}
            <div class="mx-corner" />

            {/* Col-Header */}
            <For each={cols()}>
              {(col) => (
                <div class="mx-col-head">
                  <span class="mx-col-label">{col.label || '(Spalte)'}</span>
                </div>
              )}
            </For>

            {/* Zeilen */}
            <For each={rows()}>
              {(row) => (
                <>
                  <div class="mx-row-head">
                    <span class="mx-row-label">{row.label || '(Zeile)'}</span>
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
                      const isClickable = () => targetNode() != null;
                      return (
                        <div
                          class="mx-cell"
                          classList={{
                            'mx-cell-empty': !cell(),
                            'mx-cell-clickable': isClickable(),
                          }}
                          role={isClickable() ? 'button' : undefined}
                          tabIndex={isClickable() ? 0 : -1}
                          onClick={() => onCellClick(cell())}
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
                </>
              )}
            </For>
          </div>
        );
      }}
    </Show>
  );
};

export default MatrixView;
