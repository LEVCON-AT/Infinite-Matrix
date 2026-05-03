// MatrixLinearList — Mobile-Variante des Matrix-Grids.
//
// Statt 2D-Grid wird die Matrix linearisiert: pro Spalte eine Sektion mit
// sticky-Header oben und horizontalem Snap-Karusell der Cell-Cards.
// Vertikales Scrollen wandert durch die Spalten; horizontales Snap-
// Wischen wandert durch die Cells einer Spalte.
//
// Single-Source: dieselbe Datenbasis wie der Desktop-Grid (rows, cols,
// cellMap, cellSummaries, cellsWithDocs, presenceByCell). Die Mutationen
// (onChipClick, onCardTap) werden vom MatrixView durchgereicht.

import { type Component, For } from 'solid-js';
import type { PresenceUser } from '../../lib/presence';
import type { CellTaskSummary } from '../../lib/task-aggregate';
import type { CellFeature, CellRow, ColRow, RowRow } from '../../lib/types';
import MobileCellCard from './MobileCellCard';

type MatrixLinearListProps = {
  workspaceId: string;
  rows: RowRow[];
  cols: ColRow[];
  cellMap: Map<string, CellRow>;
  cellSummaries: Map<string, CellTaskSummary>;
  cellsWithDocs: Set<string>;
  presenceByCell: Map<string, PresenceUser[]>;
  editMode: boolean;
  onChipClick: (
    e: MouseEvent,
    cell: CellRow | undefined,
    feat: CellFeature | 'doc',
    row: RowRow,
    col: ColRow,
  ) => void;
  onCardTap: (row: RowRow, col: ColRow, cell: CellRow | undefined) => void;
  onCellHover?: (cellId: string | undefined) => void;
};

const MatrixLinearList: Component<MatrixLinearListProps> = (props) => {
  return (
    <div class="matrix-linear-list" role="list">
      <For
        each={props.cols}
        fallback={<p class="hint">Leere Matrix.</p>}
      >
        {(col) => (
          <section class="matrix-linear-section" role="listitem">
            <header class="matrix-linear-section-head">
              <h2 class="matrix-linear-section-title">{col.label || '—'}</h2>
            </header>
            <div
              class="matrix-linear-section-rail"
              role="list"
              aria-label={`Zellen in Spalte ${col.label || ''}`}
            >
              <For each={props.rows}>
                {(row) => {
                  const key = (): string => `${row.id}::${col.id}`;
                  const cell = (): CellRow | undefined => props.cellMap.get(key());
                  const summary = (): CellTaskSummary | undefined => {
                    const c = cell();
                    return c ? props.cellSummaries.get(c.id) : undefined;
                  };
                  const hasDoc = (): boolean => {
                    const c = cell();
                    return c ? props.cellsWithDocs.has(c.id) : false;
                  };
                  const presence = (): PresenceUser[] => {
                    const c = cell();
                    return c ? (props.presenceByCell.get(c.id) ?? []) : [];
                  };
                  return (
                    <div
                      class="matrix-linear-cell-wrap"
                      role="listitem"
                      onPointerEnter={() => props.onCellHover?.(cell()?.id)}
                      onPointerLeave={() => props.onCellHover?.(undefined)}
                    >
                      <MobileCellCard
                        row={row}
                        col={col}
                        cell={cell()}
                        summary={summary()}
                        hasDoc={hasDoc()}
                        presence={presence()}
                        editMode={props.editMode}
                        workspaceId={props.workspaceId}
                        onChipClick={(e, feat) =>
                          props.onChipClick(e, cell(), feat, row, col)
                        }
                        onCardTap={() => props.onCardTap(row, col, cell())}
                      />
                    </div>
                  );
                }}
              </For>
            </div>
          </section>
        )}
      </For>
    </div>
  );
};

export default MatrixLinearList;
