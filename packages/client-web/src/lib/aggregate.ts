// Matrix-Subtree-Aggregation fuer Intervallmatrix (Frequency) und
// Aufgabenuebersicht (TaskOverview). Portiert _freqAggregateCell /
// _freqBuildAggregates / renderTaskOverview-collectBoards aus dem
// HTML-Vorbild (packages/client-standalone/matrix.html Zeile 6210-6470).
//
// Kernmodell:
//  - Ausgangspunkt ist eine Matrix-Node. Die "Zellen" dieser Matrix
//    werden traversiert; jede Zelle kann einen child-Node (Board oder
//    Sub-Matrix) tragen.
//  - Aggregiert wird rekursiv: die Zelle "enthaelt" alle Karten in
//    ihrem Board + alle Karten aller Boards/Matrices darunter.
//  - Eine Zelle wird in die Ausgabe aufgenommen, wenn sie **irgendwo**
//    im Subtree aktive Karten hat.
//
// Eine Karte zaehlt als aktiv, wenn:
//  - nicht archiviert, nicht done
//  - falls recur.endType='count' und endCount erreicht: inaktiv
//
// `recurFiresOn` wird hier NICHT voll portiert (das sind ~90 Zeilen
// Edge-Cases im HTML). Die Frequency-Aggregation braucht nur den
// Typen-Check (`recur.type`), nicht ob heute gerade gefeuert wird.
// End-Count-Check wird fuer Sprint FREQ-1 pauschal deaktiviert
// (`isCountFinished` liefert `false`); wenn wir recurFiresOn spaeter
// portieren, aktivieren wir das.

import type { CellRow, ColRow, KbCardRow, NodeRow, RowRow } from './types';

// Kategorien fuer die Intervallmatrix. Identisch zum HTML-Vorbild.
export type FreqCategoryKey = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'once' | 'nodate';

export const FREQ_CATEGORIES: Array<{
  key: FreqCategoryKey;
  label: string;
  test: (c: KbCardRow) => boolean;
}> = [
  {
    key: 'daily',
    label: 'Taeglich',
    test: (c) => !!c.recur && (c.recur as { type?: string }).type === 'daily',
  },
  {
    key: 'weekly',
    label: 'Woechentl.',
    test: (c) => !!c.recur && (c.recur as { type?: string }).type === 'weekly',
  },
  {
    key: 'monthly',
    label: 'Monatl.',
    test: (c) => !!c.recur && (c.recur as { type?: string }).type === 'monthly',
  },
  {
    key: 'yearly',
    label: 'Jaehrl.',
    test: (c) => !!c.recur && (c.recur as { type?: string }).type === 'yearly',
  },
  {
    key: 'once',
    label: 'Einmalig',
    test: (c) => !!c.deadline && !recurActive(c),
  },
  {
    key: 'nodate',
    label: 'Ohne Zeit',
    test: (c) => !c.deadline && !recurActive(c),
  },
];

function recurActive(c: KbCardRow): boolean {
  const r = c.recur as { type?: string } | null;
  return !!r && typeof r.type === 'string' && r.type !== 'none';
}

// Filter: welche Karten zaehlen? Archivierte + done raus. End-Count
// wird in Sprint FREQ-1 nicht evaluiert (siehe Kommentar oben).
export function isFreqCardActive(c: KbCardRow): boolean {
  if (c.archived) return false;
  if (c.done) return false;
  return true;
}

// Einzelne aggregierte Zellen-Info fuer die Intervallmatrix. Eine
// Zelle enthaelt alle Karten ihres direkten Boards und ihrer
// Descendant-Boards (rekursiv). Kinder sind andere AggregateCells,
// deren Daten bereits in `cards` mit enthalten sind — `children`
// dient nur der Tree-Darstellung (expand/collapse).
export type AggregateCell = {
  dataId: string; // cell-<matrixId>-<rowId>-<colId>
  cellId: string;
  matrixId: string; // Parent-Matrix, in der die Zelle lebt
  rowId: string;
  colId: string;
  label: string; // "rowLabel / colLabel"
  alias: string | null;
  depth: number;
  cards: KbCardRow[];
  children: AggregateCell[];
  expandable: boolean;
};

// Hauptfunktion: liefert den Aggregat-Tree fuer eine Matrix.
// Nutzt die bereits im Workspace geladenen nodes + cells + rows +
// cols, plus die separat gefetchten cards im Subtree (board_id-gefiltert).
//
// Zellen ohne aktive Karten im Subtree werden ausgefiltert.
export function buildFrequencyAggregates(args: {
  matrixId: string;
  nodes: NodeRow[];
  cells: CellRow[];
  rows: RowRow[];
  cols: ColRow[];
  cards: KbCardRow[];
}): AggregateCell[] {
  const { matrixId, nodes, cells, rows, cols, cards } = args;

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const colById = new Map(cols.map((c) => [c.id, c]));
  const cellsByMatrix = new Map<string, CellRow[]>();
  for (const c of cells) {
    const arr = cellsByMatrix.get(c.matrix_id) ?? [];
    arr.push(c);
    cellsByMatrix.set(c.matrix_id, arr);
  }
  const cardsByBoard = new Map<string, KbCardRow[]>();
  for (const c of cards) {
    if (!isFreqCardActive(c)) continue;
    const arr = cardsByBoard.get(c.board_id) ?? [];
    arr.push(c);
    cardsByBoard.set(c.board_id, arr);
  }

  // Alle Karten im Subtree einer Zelle: direktes Board + Descendants.
  function aggregateCell(cell: CellRow): KbCardRow[] {
    const out: KbCardRow[] = [];
    if (cell.board_id) {
      const bc = cardsByBoard.get(cell.board_id);
      if (bc) out.push(...bc);
    }
    if (cell.child_matrix_id) {
      const sub = nodeById.get(cell.child_matrix_id);
      if (sub && sub.type === 'matrix') {
        const subCells = cellsByMatrix.get(sub.id) ?? [];
        for (const sc of subCells) out.push(...aggregateCell(sc));
      }
    }
    return out;
  }

  function build(mid: string, depth: number): AggregateCell[] {
    const n = nodeById.get(mid);
    if (!n || n.type !== 'matrix') return [];

    const myCells = cellsByMatrix.get(mid) ?? [];
    // Sort rows-first (by row position), within same row by col position.
    const decorated = myCells
      .map((c) => ({
        cell: c,
        row: rowById.get(c.row_id),
        col: colById.get(c.col_id),
      }))
      .filter(
        (d): d is { cell: CellRow; row: RowRow; col: ColRow } => d.row != null && d.col != null,
      );
    decorated.sort((a, b) => {
      const ra = a.row.position ?? 0;
      const rb = b.row.position ?? 0;
      if (ra !== rb) return ra - rb;
      const ca = a.col.position ?? 0;
      const cb = b.col.position ?? 0;
      return ca - cb;
    });

    const out: AggregateCell[] = [];
    for (const { cell, row, col } of decorated) {
      const subCards = aggregateCell(cell);
      if (subCards.length === 0) continue;
      const children = cell.child_matrix_id ? build(cell.child_matrix_id, depth + 1) : [];
      out.push({
        dataId: `cell-${mid}-${cell.row_id}-${cell.col_id}`,
        cellId: cell.id,
        matrixId: mid,
        rowId: cell.row_id,
        colId: cell.col_id,
        label: `${row.label || '(Zeile)'} / ${col.label || '(Spalte)'}`,
        alias: cell.alias,
        depth,
        cards: subCards,
        children,
        expandable: children.length > 0,
      });
    }
    return out;
  }

  return build(matrixId, 0);
}

// Sammelt alle Board-IDs, die unter einer Matrix (inkl. Descendants)
// liegen. Wird genutzt, um kb_cards per `.in('board_id', ...)` in
// einem einzigen Query zu laden.
export function collectBoardIdsInMatrixTree(args: {
  matrixId: string;
  nodes: NodeRow[];
  cells: CellRow[];
}): string[] {
  const { matrixId, nodes, cells } = args;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const cellsByMatrix = new Map<string, CellRow[]>();
  for (const c of cells) {
    const arr = cellsByMatrix.get(c.matrix_id) ?? [];
    arr.push(c);
    cellsByMatrix.set(c.matrix_id, arr);
  }

  const boards = new Set<string>();
  function walk(mid: string) {
    const n = nodeById.get(mid);
    if (!n || n.type !== 'matrix') return;
    const myCells = cellsByMatrix.get(mid) ?? [];
    for (const c of myCells) {
      if (c.board_id) boards.add(c.board_id);
      if (c.child_matrix_id) walk(c.child_matrix_id);
    }
  }
  walk(matrixId);
  return [...boards];
}
