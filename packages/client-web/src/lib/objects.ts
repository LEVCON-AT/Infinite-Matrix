// Object-Layer (Phase 3 Welle O.2a) — Real-Implementations.
//
// O.2a bringt:
//   - createObject ueber mcp_create_object-RPC
//   - setObjectHomeRef ueber mcp_set_object_home_ref-RPC
//   - searchObjects ueber mcp_search_objects-RPC (Trigram-Fuzzy fuer
//     Autocomplete-Dropdown in O.2b)
//   - fetchObjects: direkte Read mit IDB-Cache-Fallback
//
// Die Mutations sind sync-online ohne safe-mutation-Wrapper —
// Pattern wie ai-providers.ts. Auto-Object-Anlage bei Row-Insert
// ist kein User-Mutation-Pfad mit pushUndo, sondern Hintergrund-
// Hilfsmechanik.
//
// Kommt mit O.2b: Autocomplete-Dropdown + UI-Integration in
// MatrixView/BoardView Row/Col/Kb_col-Edit.

import { addCol, addKbCol, addRow } from './mutations';
import { supabase } from './supabase';
import type {
  ColRow,
  GroupMemberRow,
  GroupRow,
  KbColRow,
  ObjectHomeRefKind,
  ObjectRow,
  ObjectTagRow,
  RowRow,
  SoftGroupMemberRow,
  SoftGroupRow,
} from './types';

// Re-Export der Types fuer Konsumenten.
export type {
  ObjectHomeRefKind,
  ObjectRow,
  ObjectInput,
  ObjectTagRow,
  GroupRow,
  GroupMemberRow,
  SoftGroupRow,
  SoftGroupMemberRow,
} from './types';

// ─── Alias-Namespace-Konstanten ──────────────────────────────
export const OBJECT_ALIAS_PREFIX = '^o.';

export function stripObjectAliasPrefix(alias: string): string {
  if (alias.startsWith(OBJECT_ALIAS_PREFIX)) {
    return alias.slice(OBJECT_ALIAS_PREFIX.length);
  }
  return alias;
}

export function withObjectAliasPrefix(slug: string): string {
  return OBJECT_ALIAS_PREFIX + slug;
}

// ─── Search-Result-Type ───────────────────────────────────────
// mcp_search_objects-RPC liefert nur ein Subset der ObjectRow-Felder
// — die fuers Autocomplete-Render reichen.
export type ObjectSearchHit = {
  id: string;
  label: string;
  type_label: string | null;
  alias: string | null;
  similarity: number;
};

// ─── Read: fetchObjects ──────────────────────────────────────
// Workspace-scoped Liste. Online-only in O.2a — IDB-Cache-Fallback
// folgt mit O.4 wenn die offline-cache.ts-TABLES-Liste um 'objects'
// erweitert wird (DB_VERSION-Bump).
export async function fetchObjects(workspaceId: string): Promise<ObjectRow[]> {
  if (!workspaceId) return [];
  const { data, error } = await supabase
    .from('objects')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ObjectRow[];
}

// ─── Mutation: createObject ──────────────────────────────────
// RPC: mcp_create_object. Gibt {object_id, workspace_id, label, alias}
// als jsonb zurueck. Wir holen die volle ObjectRow danach mit einem
// SELECT — sonst muesste die RPC alle Felder zurueckgeben (unflexibel).
//
// Nicht via safe-mutation-Wrapper: Object-Anlage ist Hintergrund-
// Mechanik (z.B. beim Row-Insert), kein User-sichtbarer Mutation-
// Punkt mit Undo.
export async function createObject(args: {
  workspaceId: string;
  label: string;
  alias?: string | null;
  typeLabel?: string | null;
  parentId?: string | null;
  attrs?: Record<string, unknown>;
  homeRefKind?: ObjectHomeRefKind;
  homeRefId?: string;
}): Promise<ObjectRow> {
  const { data: rpcData, error: rpcErr } = await supabase.rpc('mcp_create_object', {
    p_workspace_id: args.workspaceId,
    p_label: args.label,
    p_alias: args.alias ?? null,
    p_type_label: args.typeLabel ?? null,
    p_parent_id: args.parentId ?? null,
    p_attrs: args.attrs ?? {},
    p_home_ref_kind: args.homeRefKind ?? null,
    p_home_ref_id: args.homeRefId ?? null,
  });
  if (rpcErr) throw rpcErr;
  const obj = rpcData as { object_id?: string } | null;
  const objectId = obj?.object_id;
  if (!objectId) {
    throw new Error('mcp_create_object: keine object_id zurueck');
  }

  const { data: rowData, error: rowErr } = await supabase
    .from('objects')
    .select('*')
    .eq('id', objectId)
    .single();
  if (rowErr) throw rowErr;
  return rowData as ObjectRow;
}

// ─── Mutation: setObjectHomeRef ──────────────────────────────
// Backfill-Pfad: nach Row-/Col-/Kb_col-Insert wissen wir die ref_id.
// RPC ueberschreibt den Anker. Best-Effort — wenn das schief geht
// bleibt Object einfach ohne home_ref (Object-Detail-Page zeigt dann
// "Standalone").
export async function setObjectHomeRef(
  objectId: string,
  homeRefKind: ObjectHomeRefKind,
  homeRefId: string,
): Promise<void> {
  const { error } = await supabase.rpc('mcp_set_object_home_ref', {
    p_object_id: objectId,
    p_home_ref_kind: homeRefKind,
    p_home_ref_id: homeRefId,
  });
  if (error) throw error;
}

// ─── Auto-Object-Wrapper fuer Row/Col/Kb_col-Insert ──────────
// 3-Schritt-Pattern (atomic per Step, nicht per Tx):
//   1. createObject → object_id
//   2. addRow/addCol/addKbCol mit objectId → row_id
//   3. setObjectHomeRef(object_id, kind, row_id) (best-effort)
//
// Wenn Step 2 fehl-schlaegt: Object bleibt orphan in der DB. User-
// sichtbarer Schaden = none (Object erscheint nicht in der UI bis
// O.4 Object-Detail-Page). Aufraeumen kann via spaeterem Cleanup-
// Job oder manuellem Loeschen.
//
// Wenn Step 3 fehl-schlaegt: Object hat kein home_ref — Object-
// Detail zeigt "Standalone" als Pfad. Akzeptabel.

export async function addRowWithObject(args: {
  workspaceId: string;
  matrixId: string;
  label: string;
}): Promise<{ row: RowRow; object: ObjectRow }> {
  const object = await createObject({
    workspaceId: args.workspaceId,
    label: args.label,
  });
  const row = await addRow({
    workspaceId: args.workspaceId,
    matrixId: args.matrixId,
    label: args.label,
    objectId: object.id,
  });
  try {
    await setObjectHomeRef(object.id, 'row', row.id);
  } catch (err) {
    console.warn('setObjectHomeRef (row) failed:', err);
  }
  return { row, object };
}

export async function addColWithObject(args: {
  workspaceId: string;
  matrixId: string;
  label: string;
}): Promise<{ col: ColRow; object: ObjectRow }> {
  const object = await createObject({
    workspaceId: args.workspaceId,
    label: args.label,
  });
  const col = await addCol({
    workspaceId: args.workspaceId,
    matrixId: args.matrixId,
    label: args.label,
    objectId: object.id,
  });
  try {
    await setObjectHomeRef(object.id, 'col', col.id);
  } catch (err) {
    console.warn('setObjectHomeRef (col) failed:', err);
  }
  return { col, object };
}

// ─── Ensure-Object-Pfad fuer existing Row/Col/Kb_col ────────
// Idempotent: wenn das Item bereits einen object_id hat ODER label
// leer ist, no-op. Sonst: Object anlegen + verlinken + home_ref
// setzen. Aufruf vom Caller nach renameRow/renameCol-Mutation
// (Background-Task, kein Wait).

async function ensureObjectFor(args: {
  table: 'rows' | 'cols' | 'kb_cols';
  row: { id: string; workspace_id: string; label: string; object_id?: string | null };
  homeRefKind: ObjectHomeRefKind;
}): Promise<ObjectRow | null> {
  if (args.row.object_id) return null;
  const label = args.row.label.trim();
  if (!label) return null;

  const object = await createObject({
    workspaceId: args.row.workspace_id,
    label,
  });

  const { error } = await supabase
    .from(args.table)
    .update({ object_id: object.id })
    .eq('id', args.row.id);
  if (error) {
    console.warn(`ensureObjectFor (${args.table}) link failed:`, error);
    return object;
  }

  try {
    await setObjectHomeRef(object.id, args.homeRefKind, args.row.id);
  } catch (err) {
    console.warn(`ensureObjectFor (${args.table}) home_ref failed:`, err);
  }

  return object;
}

export function ensureObjectForRow(row: {
  id: string;
  workspace_id: string;
  label: string;
  object_id?: string | null;
}): Promise<ObjectRow | null> {
  return ensureObjectFor({ table: 'rows', row, homeRefKind: 'row' });
}

export function ensureObjectForCol(col: {
  id: string;
  workspace_id: string;
  label: string;
  object_id?: string | null;
}): Promise<ObjectRow | null> {
  return ensureObjectFor({ table: 'cols', row: col, homeRefKind: 'col' });
}

export function ensureObjectForKbCol(kbCol: {
  id: string;
  workspace_id: string;
  label: string;
  object_id?: string | null;
}): Promise<ObjectRow | null> {
  return ensureObjectFor({ table: 'kb_cols', row: kbCol, homeRefKind: 'kb_col' });
}

export async function addKbColWithObject(args: {
  workspaceId: string;
  boardId: string;
  label: string;
  color?: string | null;
}): Promise<{ kbCol: KbColRow; object: ObjectRow }> {
  const object = await createObject({
    workspaceId: args.workspaceId,
    label: args.label,
  });
  const kbCol = await addKbCol({
    workspaceId: args.workspaceId,
    boardId: args.boardId,
    label: args.label,
    color: args.color ?? null,
    objectId: object.id,
  });
  try {
    await setObjectHomeRef(object.id, 'kb_col', kbCol.id);
  } catch (err) {
    console.warn('setObjectHomeRef (kb_col) failed:', err);
  }
  return { kbCol, object };
}

// ─── Search: searchObjects ───────────────────────────────────
// Trigram-Fuzzy fuer Autocomplete-Dropdown (O.2b). Empty query →
// top-N nach Aktualitaet (created_at DESC).
export async function searchObjects(
  workspaceId: string,
  query: string,
  limit = 8,
): Promise<ObjectSearchHit[]> {
  const { data, error } = await supabase.rpc('mcp_search_objects', {
    p_workspace_id: workspaceId,
    p_query: query,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as ObjectSearchHit[];
}

// ─── Stubs fuer Tags / Groups / Soft-Groups ──────────────────
// Werden in O.4 (Hierarchie + Tags) und O.3 (Bulk-Modal + Soft-
// Groups) implementiert. Hier nur Signaturen damit andere Module
// schon importieren koennen ohne Type-Errors.

export async function fetchGroups(_workspaceId: string): Promise<GroupRow[]> {
  return [];
}

export async function fetchObjectTags(
  _workspaceId: string,
  _objectId: string,
): Promise<ObjectTagRow[]> {
  return [];
}

export async function fetchGroupMembers(
  _workspaceId: string,
  _groupId: string,
): Promise<GroupMemberRow[]> {
  return [];
}

export async function fetchSoftGroups(_workspaceId: string): Promise<SoftGroupRow[]> {
  return [];
}

export async function fetchSoftGroupMembers(
  _workspaceId: string,
  _softGroupId: string,
): Promise<SoftGroupMemberRow[]> {
  return [];
}
