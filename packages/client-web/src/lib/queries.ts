import { supabase } from './supabase';
import type {
  CellRow,
  ColRow,
  MatrixContent,
  NodeRow,
  RowRow,
  TreeNode,
  WorkspaceWithRole,
} from './types';

// ─── Workspaces ──────────────────────────────────────────────────
// Gibt alle Workspaces zurueck, in denen der aktuelle User Mitglied ist.
// RLS-Query: memberships.user_id = auth.uid() greift automatisch.
export async function fetchMyWorkspaces(): Promise<WorkspaceWithRole[]> {
  const { data, error } = await supabase
    .from('memberships')
    .select('role, workspace:workspaces(*)')
    .order('role', { ascending: true });

  if (error) throw error;
  if (!data) return [];

  return data
    .filter((m) => m.workspace != null)
    .map((m) => {
      const ws = m.workspace as unknown as {
        id: string;
        name: string;
        owner_id: string;
        created_at: string;
        updated_at: string;
      };
      return { ...ws, role: m.role };
    });
}

// ─── Nodes + Cells fuer Tree-Aufbau ──────────────────────────────
export async function fetchNodesForWorkspace(workspaceId: string): Promise<NodeRow[]> {
  const { data, error } = await supabase
    .from('nodes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as NodeRow[];
}

export async function fetchCellsForWorkspace(workspaceId: string): Promise<CellRow[]> {
  const { data, error } = await supabase
    .from('cells')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (error) throw error;
  return (data ?? []) as CellRow[];
}

// ─── Matrix-Inhalt (rows + cols + cells) ─────────────────────────
// Laedt alle drei Tabellen parallel, gefiltert auf die Matrix. RLS
// blockiert Fremd-Workspaces automatisch; workspace_id ist zusaetzlich
// als Guard gesetzt, damit ein falscher Param nicht versehentlich
// Zeilen anderer Matrizen durchschmuggelt.
export async function fetchMatrixContent(
  matrixId: string,
  workspaceId: string,
): Promise<MatrixContent> {
  const [rowsRes, colsRes, cellsRes] = await Promise.all([
    supabase
      .from('rows')
      .select('*')
      .eq('matrix_id', matrixId)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true }),
    supabase
      .from('cols')
      .select('*')
      .eq('matrix_id', matrixId)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true }),
    supabase
      .from('cells')
      .select('*')
      .eq('matrix_id', matrixId)
      .eq('workspace_id', workspaceId),
  ]);

  if (rowsRes.error) throw rowsRes.error;
  if (colsRes.error) throw colsRes.error;
  if (cellsRes.error) throw cellsRes.error;

  return {
    rows: (rowsRes.data ?? []) as RowRow[],
    cols: (colsRes.data ?? []) as ColRow[],
    cells: (cellsRes.data ?? []) as CellRow[],
  };
}

// ─── Tree-Aufbau ─────────────────────────────────────────────────
// Jede Node kann einen parent_cell_id haben (= die Zelle in der sie als
// Sub-Feature lebt). Diese Zelle selbst gehoert zu einer anderen Matrix
// (= der Parent-Node). Fuer den Sidebar-Tree brauchen wir also die Kette:
//   child-node.parent_cell_id -> cell.matrix_id -> parent-node.id
export function buildTree(nodes: NodeRow[], cells: CellRow[]): TreeNode[] {
  const cellToMatrix = new Map<string, string>();
  for (const c of cells) cellToMatrix.set(c.id, c.matrix_id);

  const nodeById = new Map<string, TreeNode>();
  for (const n of nodes) nodeById.set(n.id, { node: n, children: [] });

  const roots: TreeNode[] = [];

  for (const tn of nodeById.values()) {
    const parentCellId = tn.node.parent_cell_id;
    if (!parentCellId) {
      roots.push(tn);
      continue;
    }
    const parentMatrixId = cellToMatrix.get(parentCellId);
    const parent = parentMatrixId ? nodeById.get(parentMatrixId) : undefined;
    if (parent) parent.children.push(tn);
    else roots.push(tn); // verwaiste Node (parent in anderem Workspace / geloescht)
  }

  return roots;
}
