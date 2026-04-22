// Minimale DB-Typen fuer den Read-Only-Client. Erweitert sich nach Bedarf.
// Entspricht 1:1 den Tabellen aus infra/supabase/migrations/002_matrix_schema.sql.

export type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

export type Membership = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
};

export type WorkspaceWithRole = Workspace & { role: WorkspaceRole };

export type NodeType = 'matrix' | 'board';

export type NodeRow = {
  id: string;
  workspace_id: string;
  type: NodeType;
  label: string;
  alias: string | null;
  parent_cell_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type CellRow = {
  id: string;
  workspace_id: string;
  matrix_id: string;
  row_id: string;
  col_id: string;
  alias: string | null;
  features: string[];
  child_matrix_id: string | null;
  board_id: string | null;
  data: Record<string, unknown>;
};

export type RowRow = {
  id: string;
  matrix_id: string;
  workspace_id: string;
  label: string;
  position: number;
};

export type ColRow = {
  id: string;
  matrix_id: string;
  workspace_id: string;
  label: string;
  position: number;
};

export type MatrixContent = {
  rows: RowRow[];
  cols: ColRow[];
  cells: CellRow[];
};

export type CellFeature = 'matrix' | 'board' | 'info' | 'checklists';

// Info-Feld auf einer Zelle. Lebt in cell.data.infoFields[].
// value ist plain text (newlines preserved); HTML-Rendering kommt spaeter
// mit sanitizeHtml-Port — fuer V0 reicht Textarea, kein XSS-Risiko.
export type InfoField = {
  id: string;
  label: string;
  value: string;
};

// URL-Link auf einer Zelle. Lebt in cell.data.links[].
// Bewusst OHNE Alias-Feld: cell-JSONB-Links koennen nicht am DB-Unique-
// Constraint der board-scoped links-Tabelle teilnehmen; Alias-Quicknav
// zu JSONB-Links wuerde einen Workspace-weiten Tree-Scan erfordern,
// was den aliasIndex-Pfad sprengt. Wird bei Bedarf nach einer Migration
// auf eine eigene Tabelle (cell_links) nachgeruestet.
export type InfoLink = {
  id: string;
  label: string;
  url: string;
};

// ─── Kanban ─────────────────────────────────────────────────────
export type KbColRow = {
  id: string;
  workspace_id: string;
  board_id: string;
  label: string;
  position: number;
  color: string | null;
};

// Inline-Checkliste auf einer Karte (kb_cards.checklist jsonb).
// Entspricht dem Item-Shape aus dem Alt-Client (V2.1: +level).
export type InlineChecklistItem = {
  id?: string;
  text: string;
  done: boolean;
  level?: 0 | 1 | 2;
};

export type KbCardRow = {
  id: string;
  workspace_id: string;
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
  checklist: InlineChecklistItem[] | null;
  created_at: string;
  updated_at: string;
};

export type ChecklistCloseMode = 'manual' | 'auto-prompt' | 'auto-silent';

// XOR-Invariante (DB-enforced): genau eines von board_id | cell_id ist gesetzt.
// Client-Code, der eine neue Checkliste anlegt, setzt entsprechend nur einen Parent.
export type ChecklistRow = {
  id: string;
  workspace_id: string;
  board_id: string | null;
  cell_id: string | null;
  label: string;
  position: number;
  recur: Record<string, unknown> | null;
  close_mode: ChecklistCloseMode;
  action: Record<string, unknown> | null;
  history: unknown[];
  alias: string | null;
  created_at: string;
  updated_at: string;
};

export type ChecklistItemRow = {
  id: string;
  workspace_id: string;
  checklist_id: string;
  text: string;
  done: boolean;
  level: 0 | 1 | 2;
  position: number;
};

export type LinkType = 'url' | 'mail';

export type LinkRow = {
  id: string;
  workspace_id: string;
  board_id: string;
  type: LinkType;
  label: string;
  url: string;
  alias: string | null;
  position: number;
  data: Record<string, unknown>;
  created_at: string;
};

export type BoardContent = {
  kbCols: KbColRow[];
  kbCards: KbCardRow[];
  checklists: ChecklistRow[];
  checklistItems: ChecklistItemRow[];
  links: LinkRow[];
};

// Checklisten einer einzelnen Zelle (cell_id=X, board_id=NULL).
// Wird lazy geladen, wenn der User den Checklist-Chip einer Zelle oeffnet.
export type CellChecklistsContent = {
  checklists: ChecklistRow[];
  checklistItems: ChecklistItemRow[];
};

// Hilfs-Shape fuer den Sidebar-Tree. Nodes werden nach parent_cell_id
// verschachtelt; die Zelle wiederum kennt ihre Matrix (= parent-Node).
export type TreeNode = {
  node: NodeRow;
  children: TreeNode[];
};
