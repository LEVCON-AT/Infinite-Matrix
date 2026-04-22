// Schreibende Operationen gegen die DB. Pattern:
//   - Rueckgabe: die frische DB-Row (via .select().single())
//   - Fehler: Original-PostgrestError wird weitergeworfen, der Caller
//     uebersetzt mit translateDbError() + showToast().
//   - Kein Optimistic-Update; Caller ruft refetch() nach Success.
//
// Wird 0e.1 inkrementell fuer alle Tabellen erweitert.

import { supabase } from './supabase';
import type { CellRow, ColRow, KbCardRow, KbColRow, NodeRow, RowRow } from './types';

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

async function nextBoardPosition(
  table: 'kb_cols' | 'kb_cards' | 'checklists' | 'links',
  boardId: string,
  workspaceId: string,
  extraEq?: { col_id?: string },
): Promise<number> {
  let q = supabase
    .from(table)
    .select('position')
    .eq('board_id', boardId)
    .eq('workspace_id', workspaceId)
    .order('position', { ascending: false })
    .limit(1);
  if (extraEq?.col_id) q = q.eq('col_id', extraEq.col_id);
  const { data, error } = await q;
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

// ─── Kanban-Spalten ────────────────────────────────────────────
export async function addKbCol(args: {
  workspaceId: string;
  boardId: string;
  label?: string;
  color?: string | null;
}): Promise<KbColRow> {
  const pos = await nextBoardPosition('kb_cols', args.boardId, args.workspaceId);
  const { data, error } = await supabase
    .from('kb_cols')
    .insert({
      workspace_id: args.workspaceId,
      board_id: args.boardId,
      label: args.label ?? '',
      position: pos,
      color: args.color ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as KbColRow;
}

export async function renameKbCol(colId: string, label: string): Promise<KbColRow> {
  const { data, error } = await supabase
    .from('kb_cols')
    .update({ label })
    .eq('id', colId)
    .select()
    .single();
  if (error) throw error;
  return data as KbColRow;
}

export async function setKbColColor(
  colId: string,
  color: string | null,
): Promise<KbColRow> {
  const { data, error } = await supabase
    .from('kb_cols')
    .update({ color })
    .eq('id', colId)
    .select()
    .single();
  if (error) throw error;
  return data as KbColRow;
}

export async function delKbCol(colId: string): Promise<void> {
  const { error } = await supabase.from('kb_cols').delete().eq('id', colId);
  if (error) throw error;
}

// ─── Karten ────────────────────────────────────────────────────
// Positions-Scoping pro Spalte (col_id), damit Karten innerhalb der
// Spalte eine eigene Reihenfolge haben. Move zwischen Spalten setzt
// die Position neu auf das Ende der Ziel-Spalte.
export async function addCard(args: {
  workspaceId: string;
  boardId: string;
  colId: string;
  name?: string;
}): Promise<KbCardRow> {
  const pos = await nextBoardPosition('kb_cards', args.boardId, args.workspaceId, {
    col_id: args.colId,
  });
  const { data, error } = await supabase
    .from('kb_cards')
    .insert({
      workspace_id: args.workspaceId,
      board_id: args.boardId,
      col_id: args.colId,
      name: args.name ?? '',
      position: pos,
    })
    .select()
    .single();
  if (error) throw error;
  return data as KbCardRow;
}

type CardPatch = Partial<
  Pick<
    KbCardRow,
    | 'name'
    | 'note'
    | 'alias'
    | 'done'
    | 'deadline'
    | 'priority'
    | 'tags'
    | 'who'
    | 'archived'
  >
>;

async function updateCard(cardId: string, patch: CardPatch): Promise<KbCardRow> {
  const { data, error } = await supabase
    .from('kb_cards')
    .update(patch)
    .eq('id', cardId)
    .select()
    .single();
  if (error) throw error;
  return data as KbCardRow;
}

export function renameCard(cardId: string, name: string): Promise<KbCardRow> {
  return updateCard(cardId, { name });
}

export function toggleCardDone(cardId: string, done: boolean): Promise<KbCardRow> {
  return updateCard(cardId, { done });
}

export function setCardNote(cardId: string, note: string): Promise<KbCardRow> {
  return updateCard(cardId, { note });
}

export function setCardAlias(
  cardId: string,
  alias: string | null,
): Promise<KbCardRow> {
  return updateCard(cardId, { alias });
}

export function setCardDeadline(
  cardId: string,
  deadline: string | null,
): Promise<KbCardRow> {
  return updateCard(cardId, { deadline });
}

export function setCardPriority(
  cardId: string,
  priority: number | null,
): Promise<KbCardRow> {
  return updateCard(cardId, { priority });
}

// Move: innerhalb derselben Spalte oder cross-column. Bei cross-column
// bekommt die Karte Position ans Ende der Ziel-Spalte (kein Reorder
// innerhalb — kommt in 0e.1.h).
export async function moveCard(args: {
  cardId: string;
  boardId: string;
  workspaceId: string;
  toColId: string;
}): Promise<KbCardRow> {
  const pos = await nextBoardPosition(
    'kb_cards',
    args.boardId,
    args.workspaceId,
    { col_id: args.toColId },
  );
  const { data, error } = await supabase
    .from('kb_cards')
    .update({ col_id: args.toColId, position: pos })
    .eq('id', args.cardId)
    .select()
    .single();
  if (error) throw error;
  return data as KbCardRow;
}

export async function delCard(cardId: string): Promise<void> {
  const { error } = await supabase.from('kb_cards').delete().eq('id', cardId);
  if (error) throw error;
}
