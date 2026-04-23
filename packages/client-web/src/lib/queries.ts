import { supabase } from './supabase';
import type {
  BoardContent,
  CellChecklistsContent,
  CellRow,
  ChecklistItemRow,
  ChecklistRow,
  ColRow,
  DocRow,
  KbCardRow,
  KbColRow,
  LinkRow,
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

// ─── Board-Inhalt (Kanban-Spalten + Karten + Checklisten + Links) ─
// 4 parallele Queries. checklist_items werden via in-Filter auf die
// Board-Checklisten eingeschraenkt — nicht via RLS-only, weil es sonst
// alle items ueber den Workspace laedt.
export async function fetchBoardContent(
  boardId: string,
  workspaceId: string,
): Promise<BoardContent> {
  const [colsRes, cardsRes, checklistsRes, linksRes] = await Promise.all([
    supabase
      .from('kb_cols')
      .select('*')
      .eq('board_id', boardId)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true }),
    supabase
      .from('kb_cards')
      .select('*')
      .eq('board_id', boardId)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true }),
    supabase
      .from('checklists')
      .select('*')
      .eq('board_id', boardId)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true }),
    supabase
      .from('links')
      .select('*')
      .eq('board_id', boardId)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true }),
  ]);

  if (colsRes.error) throw colsRes.error;
  if (cardsRes.error) throw cardsRes.error;
  if (checklistsRes.error) throw checklistsRes.error;
  if (linksRes.error) throw linksRes.error;

  const checklists = (checklistsRes.data ?? []) as ChecklistRow[];

  let checklistItems: ChecklistItemRow[] = [];
  if (checklists.length > 0) {
    const ids = checklists.map((c) => c.id);
    const itemsRes = await supabase
      .from('checklist_items')
      .select('*')
      .in('checklist_id', ids)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true });
    if (itemsRes.error) throw itemsRes.error;
    checklistItems = (itemsRes.data ?? []) as ChecklistItemRow[];
  }

  return {
    kbCols: (colsRes.data ?? []) as KbColRow[],
    kbCards: (cardsRes.data ?? []) as KbCardRow[],
    checklists,
    checklistItems,
    links: (linksRes.data ?? []) as LinkRow[],
  };
}

// ─── Cell-Checklisten (cell_id=X, board_id=NULL) ──────────────────
// Wie der Board-Pfad, aber gefiltert auf eine Zelle. RLS + workspace_id
// als Guard.
export async function fetchCellChecklists(
  cellId: string,
  workspaceId: string,
): Promise<CellChecklistsContent> {
  const { data: clData, error: clErr } = await supabase
    .from('checklists')
    .select('*')
    .eq('cell_id', cellId)
    .eq('workspace_id', workspaceId)
    .order('position', { ascending: true });
  if (clErr) throw clErr;

  const checklists = (clData ?? []) as ChecklistRow[];
  let checklistItems: ChecklistItemRow[] = [];
  if (checklists.length > 0) {
    const ids = checklists.map((c) => c.id);
    const { data: itData, error: itErr } = await supabase
      .from('checklist_items')
      .select('*')
      .in('checklist_id', ids)
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true });
    if (itErr) throw itErr;
    checklistItems = (itData ?? []) as ChecklistItemRow[];
  }

  return { checklists, checklistItems };
}

// ─── Node-Leer-Probe (fuer Confirm-vor-Delete) ────────────────────
// Gibt true zurueck, wenn der Node weder strukturelle Kinder (rows/cols
// bzw. kb_cols/kb_cards/checklists/links) hat. Ein leerer Sub-Node
// kann ohne Rueckfrage geloescht werden — User hat nichts zu verlieren.
export async function isNodeEmpty(
  nodeId: string,
  nodeType: 'matrix' | 'board',
): Promise<boolean> {
  if (nodeType === 'matrix') {
    const [r, c] = await Promise.all([
      supabase
        .from('rows')
        .select('id', { head: true, count: 'exact' })
        .eq('matrix_id', nodeId),
      supabase
        .from('cols')
        .select('id', { head: true, count: 'exact' })
        .eq('matrix_id', nodeId),
    ]);
    return (r.count ?? 0) === 0 && (c.count ?? 0) === 0;
  }
  const [cards, cols, cls, links] = await Promise.all([
    supabase
      .from('kb_cards')
      .select('id', { head: true, count: 'exact' })
      .eq('board_id', nodeId),
    supabase
      .from('kb_cols')
      .select('id', { head: true, count: 'exact' })
      .eq('board_id', nodeId),
    supabase
      .from('checklists')
      .select('id', { head: true, count: 'exact' })
      .eq('board_id', nodeId),
    supabase
      .from('links')
      .select('id', { head: true, count: 'exact' })
      .eq('board_id', nodeId),
  ]);
  return [cards, cols, cls, links].every((res) => (res.count ?? 0) === 0);
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

// ─── Dokumentation ─────────────────────────────────────────────
// Laedt die n zuletzt geaenderten Docs (Recent-Liste im Popup).
// Sort nach updated_at DESC, Limit einstellbar (default 20 — genug
// fuer die sichtbare Recent-Sektion ohne Scroll).
export async function fetchDocsRecent(
  workspaceId: string,
  limit = 20,
): Promise<DocRow[]> {
  const { data, error } = await supabase
    .from('docs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as DocRow[];
}

// Einzel-Doc fetch — fuer Tab-Restore via ^alias.
export async function fetchDocById(
  docId: string,
  workspaceId: string,
): Promise<DocRow | null> {
  const { data, error } = await supabase
    .from('docs')
    .select('*')
    .eq('id', docId)
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (data as DocRow | null) ?? null;
}

// Alle Dokus, die an eine bestimmte Zelle angehaengt sind. Fuer die
// Cell-Info/Checklists-Pages — zeigt dem User "welche Dokus liegen
// hier". Sort nach updated_at DESC (zuletzt geaenderte zuerst, wie
// im Alt-Client-Vorbild).
export async function fetchDocsForCell(
  cellId: string,
  workspaceId: string,
): Promise<DocRow[]> {
  const { data, error } = await supabase
    .from('docs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('attached_cell_id', cellId)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as DocRow[];
}
