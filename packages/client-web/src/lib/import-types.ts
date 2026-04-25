// Shape eines Payload aus dem Alt-Client (getPayload()).
// Nur die Felder, die wir fuer den Import lesen. Unbekannte Felder werden ignoriert.
//
// Quelle: packages/client-standalone/matrix.html ~1721 (getPayload), ~1916 (loadData).

export type AltCellFeature = 'info' | 'board' | 'matrix' | 'checklists' | string;

export type AltInfoField = {
  id?: string;
  label?: string;
  value?: string;
};

export type AltLink = {
  id: string;
  label?: string;
  url?: string;
  type?: 'url' | 'mail';
  alias?: string;
  data?: Record<string, unknown>;
};

export type AltRowCol = {
  id: string;
  label?: string;
};

export type AltCell = {
  alias?: string;
  features?: AltCellFeature[];
  boardId?: string | null;
  matrixId?: string | null;
  infoFields?: AltInfoField[];
  // alles andere (Freitext etc.) landet in data.
  [k: string]: unknown;
};

export type AltChecklistItem = {
  id?: string;
  text?: string;
  done?: boolean;
  level?: 0 | 1 | 2 | number;
};

export type AltChecklist = {
  id: string;
  label?: string;
  items?: AltChecklistItem[];
  recur?: Record<string, unknown> | null;
  closeMode?: 'manual' | 'auto-prompt' | 'auto-silent';
  action?: Record<string, unknown> | null;
  history?: unknown[];
  alias?: string;
};

export type AltKbCol = {
  id: string;
  label?: string;
  color?: string;
};

export type AltKbCard = {
  id: string;
  colId: string;
  name?: string;
  note?: string;
  tags?: string[];
  who?: string[];
  deadline?: string | null;
  priority?: number | null;
  recur?: Record<string, unknown> | null;
  checklist?: AltChecklistItem[] | null;
  checklistRef?: string | null;
  sourceClId?: string | null;
  sourceLabel?: string | null;
  archived?: boolean;
  done?: boolean;
  doneOccurrences?: string[];
  alias?: string;
};

export type AltMatrixData = {
  rows?: AltRowCol[];
  cols?: AltRowCol[];
  cells?: Record<string, AltCell>;
};

export type AltBoardData = {
  infoFields?: AltInfoField[];
  links?: AltLink[];
  kbCols?: AltKbCol[];
  kbCards?: AltKbCard[];
  checklists?: AltChecklist[];
};

export type AltNode = {
  id: string;
  type: 'matrix' | 'board';
  label?: string;
  alias?: string;
  data?: AltMatrixData | AltBoardData;
};

export type AltPayload = {
  version?: number;
  nodes: Record<string, AltNode>;
  rootId: string;
  nid?: number;
  globalTags?: string[];
  globalPeople?: string[];
  dailyCols?: unknown[];
  keyBindings?: Record<string, unknown>;
  searchHistory?: string[];
  currentTab?: Record<string, string>;
};

// ─── Parsed Import-Plan (fertig zum Einfuegen) ──────────────────
// Alle IDs sind schon als Ziel-UUIDs gemappt.

export type PlannedNode = {
  id: string; // ziel-UUID
  type: 'matrix' | 'board';
  label: string;
  alias: string | null;
  data: Record<string, unknown>;
  parentCellId: string | null; // wird in Phase 3 gesetzt, am Anfang null
};

export type PlannedRow = {
  id: string;
  matrix_id: string;
  label: string;
  position: number;
};

export type PlannedCol = {
  id: string;
  matrix_id: string;
  label: string;
  position: number;
};

export type PlannedCell = {
  id: string;
  matrix_id: string;
  row_id: string;
  col_id: string;
  alias: string | null;
  features: string[];
  child_matrix_id: string | null;
  board_id: string | null;
  data: Record<string, unknown>;
};

export type PlannedKbCol = {
  id: string;
  board_id: string;
  label: string;
  position: number;
  color: string | null;
};

export type PlannedChecklistItem = {
  id: string;
  checklist_id: string;
  text: string;
  done: boolean;
  level: 0 | 1 | 2;
  position: number;
};

export type PlannedChecklist = {
  id: string;
  board_id: string;
  label: string;
  position: number;
  recur: Record<string, unknown> | null;
  close_mode: 'manual' | 'auto-prompt' | 'auto-silent';
  action: Record<string, unknown> | null;
  history: unknown[];
  alias: string | null;
};

export type PlannedKbCard = {
  id: string;
  board_id: string;
  col_id: string;
  alias: string | null;
  name: string;
  note: string;
  tags: string[];
  who: string[];
  deadline: string | null;
  priority: number | null;
  done: boolean;
  archived: boolean;
  position: number;
  recur: Record<string, unknown> | null;
  done_occurrences: string[];
  source_cl_id: string | null;
  source_label: string | null;
  checklist_ref: string | null;
  checklist: AltChecklistItem[] | null;
};

export type PlannedLink = {
  id: string;
  board_id: string;
  type: 'url' | 'mail';
  label: string;
  url: string;
  alias: string | null;
  position: number;
  data: Record<string, unknown>;
};

export type ImportPlan = {
  rootNodeId: string; // ziel-UUID des Root-Matrix
  nodes: PlannedNode[];
  rows: PlannedRow[];
  cols: PlannedCol[];
  cells: PlannedCell[];
  kbCols: PlannedKbCol[];
  checklists: PlannedChecklist[];
  checklistItems: PlannedChecklistItem[];
  kbCards: PlannedKbCard[];
  links: PlannedLink[];
  // Node-Updates fuer parent_cell_id (nach cells-Insert).
  parentCellUpdates: { nodeId: string; parentCellId: string }[];
};

export type ImportStats = {
  nodes: number;
  rows: number;
  cols: number;
  cells: number;
  kbCols: number;
  checklists: number;
  checklistItems: number;
  kbCards: number;
  links: number;
};

export function planStats(p: ImportPlan): ImportStats {
  return {
    nodes: p.nodes.length,
    rows: p.rows.length,
    cols: p.cols.length,
    cells: p.cells.length,
    kbCols: p.kbCols.length,
    checklists: p.checklists.length,
    checklistItems: p.checklistItems.length,
    kbCards: p.kbCards.length,
    links: p.links.length,
  };
}
