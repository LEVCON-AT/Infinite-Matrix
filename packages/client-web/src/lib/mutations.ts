// Schreibende Operationen gegen die DB. Pattern:
//   - Rueckgabe: die frische DB-Row (via .select().single())
//   - Fehler: Original-PostgrestError wird weitergeworfen, der Caller
//     uebersetzt mit translateDbError() + showToast().
//   - Kein Optimistic-Update; Caller ruft refetch() nach Success.
//
// Wird 0e.1 inkrementell fuer alle Tabellen erweitert.

import { supabase } from './supabase';
import type { ColRow, RowRow } from './types';

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
