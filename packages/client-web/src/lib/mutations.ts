// Schreibende Operationen gegen die DB. Pattern:
//   - Rueckgabe: die frische DB-Row (via .select().single())
//   - Fehler: Original-PostgrestError wird weitergeworfen, der Caller
//     uebersetzt mit translateDbError() + showToast().
//   - Kein Optimistic-Update; Caller ruft refetch() nach Success.
//
// Wird 0e.1 inkrementell fuer alle Tabellen erweitert.

import { supabase } from './supabase';
import type { CellRow, ColRow, NodeRow, RowRow } from './types';

// ─── Helpers ───────────────────────────────────────────────────
async function nextPosition(
  table: 'rows' | 'cols',
  matrixId: string,
  workspaceId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from(table)
    .select('position')
    .eq('matrix_id', matrixId)
    .eq('workspace_id', workspaceId)
    .order('position', { ascending: false })
    .limit(1);
  if (error) throw error;
  const top = data && data.length > 0 ? (data[0] as { position: number }).position : -1;
  return top + 1;
}

// ─── rows ──────────────────────────────────────────────────────
export async function addRow(args: {
  workspaceId: string;
  matrixId: string;
  label?: string;
}): Promise<RowRow> {
  const pos = await nextPosition('rows', args.matrixId, args.workspaceId);
  const { data, error } = await supabase
    .from('rows')
    .insert({
      workspace_id: args.workspaceId,
      matrix_id: args.matrixId,
      label: args.label ?? '',
      position: pos,
    })
    .select()
    .single();
  if (error) throw error;
  return data as RowRow;
}

export async function renameRow(rowId: string, label: string): Promise<RowRow> {
  const { data, error } = await supabase
    .from('rows')
    .update({ label })
    .eq('id', rowId)
    .select()
    .single();
  if (error) throw error;
  return data as RowRow;
}

export async function delRow(rowId: string): Promise<void> {
  const { error } = await supabase.from('rows').delete().eq('id', rowId);
  if (error) throw error;
}

// ─── cols ──────────────────────────────────────────────────────
export async function addCol(args: {
  workspaceId: string;
  matrixId: string;
  label?: string;
}): Promise<ColRow> {
  const pos = await nextPosition('cols', args.matrixId, args.workspaceId);
  const { data, error } = await supabase
    .from('cols')
    .insert({
      workspace_id: args.workspaceId,
      matrix_id: args.matrixId,
      label: args.label ?? '',
      position: pos,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ColRow;
}

export async function renameCol(colId: string, label: string): Promise<ColRow> {
  const { data, error } = await supabase
    .from('cols')
    .update({ label })
    .eq('id', colId)
    .select()
    .single();
  if (error) throw error;
  return data as ColRow;
}

export async function delCol(colId: string): Promise<void> {
  const { error } = await supabase.from('cols').delete().eq('id', colId);
  if (error) throw error;
}

// ─── cells ─────────────────────────────────────────────────────
// Cells werden lazily angelegt: erst beim ersten Mutation-Event (Feature,
// Alias, Sub-Struktur) entsteht eine Row. Die Zelle hat bis dahin nur eine
// logische Existenz als (matrix × row × col)-Koordinate.

type CellPatch = Partial<
  Pick<CellRow, 'alias' | 'features' | 'child_matrix_id' | 'board_id' | 'data'>
>;

export async function insertCell(args: {
  workspaceId: string;
  matrixId: string;
  rowId: string;
  colId: string;
  patch?: CellPatch;
}): Promise<CellRow> {
  const payload = {
    workspace_id: args.workspaceId,
    matrix_id: args.matrixId,
    row_id: args.rowId,
    col_id: args.colId,
    alias: args.patch?.alias ?? null,
    features: args.patch?.features ?? [],
    child_matrix_id: args.patch?.child_matrix_id ?? null,
    board_id: args.patch?.board_id ?? null,
    data: args.patch?.data ?? {},
  };
  const { data, error } = await supabase
    .from('cells')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as CellRow;
}

export async function updateCell(cellId: string, patch: CellPatch): Promise<CellRow> {
  const { data, error } = await supabase
    .from('cells')
    .update(patch)
    .eq('id', cellId)
    .select()
    .single();
  if (error) throw error;
  return data as CellRow;
}

export async function delCellRow(cellId: string): Promise<void> {
  const { error } = await supabase.from('cells').delete().eq('id', cellId);
  if (error) throw error;
}

// ─── Structural Sub-Nodes (Matrix / Board an Zelle) ────────────
// Two-Step: nodes-INSERT + cells-UPSERT. Atomar wird das erst in 0e.2
// als Postgres-RPC. Fuer 0e.1.b: sequenziell, bei Fehler im 2. Schritt
// bleibt ein verwaister nodes-Eintrag — Toast informiert, Cleanup manuell.

async function createChildNode(args: {
  workspaceId: string;
  parentCellId: string;
  type: 'matrix' | 'board';
  label: string;
}): Promise<NodeRow> {
  const { data, error } = await supabase
    .from('nodes')
    .insert({
      workspace_id: args.workspaceId,
      type: args.type,
      label: args.label,
      parent_cell_id: args.parentCellId,
      data: {},
    })
    .select()
    .single();
  if (error) throw error;
  return data as NodeRow;
}

export async function createChildMatrix(args: {
  workspaceId: string;
  parentCellId: string;
  label?: string;
}): Promise<NodeRow> {
  return createChildNode({
    workspaceId: args.workspaceId,
    parentCellId: args.parentCellId,
    type: 'matrix',
    label: args.label ?? 'Neue Matrix',
  });
}

export async function createChildBoard(args: {
  workspaceId: string;
  parentCellId: string;
  label?: string;
}): Promise<NodeRow> {
  return createChildNode({
    workspaceId: args.workspaceId,
    parentCellId: args.parentCellId,
    type: 'board',
    label: args.label ?? 'Neues Board',
  });
}

// Cascade via FK ON DELETE CASCADE: alle Kinder (rows/cols/cells/...) gehen mit.
export async function deleteNode(nodeId: string): Promise<void> {
  const { error } = await supabase.from('nodes').delete().eq('id', nodeId);
  if (error) throw error;
}
