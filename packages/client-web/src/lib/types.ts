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

// Hilfs-Shape fuer den Sidebar-Tree. Nodes werden nach parent_cell_id
// verschachtelt; die Zelle wiederum kennt ihre Matrix (= parent-Node).
export type TreeNode = {
  node: NodeRow;
  children: TreeNode[];
};
