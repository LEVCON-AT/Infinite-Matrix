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

// ─── Read: fetchObject (single) ──────────────────────────────
export async function fetchObject(objectId: string): Promise<ObjectRow | null> {
  if (!objectId) return null;
  const { data, error } = await supabase
    .from('objects')
    .select('*')
    .eq('id', objectId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as ObjectRow | null;
}

// ─── Read: fetchObjectChildren (parent_id-Tree) ─────────────
export async function fetchObjectChildren(
  workspaceId: string,
  parentId: string,
): Promise<ObjectRow[]> {
  if (!workspaceId || !parentId) return [];
  const { data, error } = await supabase
    .from('objects')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('parent_id', parentId)
    .order('label', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ObjectRow[];
}

// ─── Read: object_backlinks_v ───────────────────────────────
// Liefert die Vorkommen-Liste fuer ein Object. Pfad-Anzeige + Click-
// Through ueber kind/ref_id/node_id.
export type ObjectBacklink = {
  workspace_id: string;
  object_id: string;
  kind: 'row' | 'col' | 'kb_col' | 'node';
  ref_id: string;
  ref_label: string;
  node_id: string;
  node_label: string;
  node_type: 'matrix' | 'board' | null;
};

export async function fetchObjectBacklinks(
  workspaceId: string,
  objectId: string,
): Promise<ObjectBacklink[]> {
  if (!workspaceId || !objectId) return [];
  const { data, error } = await supabase
    .from('object_backlinks_v')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('object_id', objectId);
  if (error) throw error;
  return (data ?? []) as ObjectBacklink[];
}

// ─── Read: fetchObjectGroups (welche Groups enthalten dieses Object?) ──
export async function fetchObjectGroups(
  workspaceId: string,
  objectId: string,
): Promise<GroupRow[]> {
  if (!workspaceId || !objectId) return [];
  const { data, error } = await supabase
    .from('group_members')
    .select(
      'group_id, groups!inner(id, workspace_id, name, description, created_at, created_by, updated_at)',
    )
    .eq('workspace_id', workspaceId)
    .eq('object_id', objectId);
  if (error) throw error;
  // Inner-Join liefert nested groups. Wir extrahieren auf flach.
  const rows = (data ?? []) as Array<{ groups: GroupRow | GroupRow[] }>;
  return rows.flatMap((r) => (Array.isArray(r.groups) ? r.groups : [r.groups]));
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

// ─── Reads: Groups / Soft-Groups ─────────────────────────────
// Online-only wie fetchObjects — IDB-Cache-Fallback folgt mit O.4
// wenn offline-cache.ts-TABLES-Liste erweitert wird (DB_VERSION-Bump).

export async function fetchGroups(workspaceId: string): Promise<GroupRow[]> {
  if (!workspaceId) return [];
  const { data, error } = await supabase
    .from('groups')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as GroupRow[];
}

export async function fetchGroupMembers(
  workspaceId: string,
  groupId: string,
): Promise<GroupMemberRow[]> {
  if (!workspaceId || !groupId) return [];
  const { data, error } = await supabase
    .from('group_members')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('group_id', groupId);
  if (error) throw error;
  return (data ?? []) as GroupMemberRow[];
}

export async function fetchSoftGroups(workspaceId: string): Promise<SoftGroupRow[]> {
  if (!workspaceId) return [];
  const { data, error } = await supabase
    .from('soft_groups')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('last_used_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SoftGroupRow[];
}

export async function fetchSoftGroupMembers(
  workspaceId: string,
  softGroupId: string,
): Promise<SoftGroupMemberRow[]> {
  if (!workspaceId || !softGroupId) return [];
  const { data, error } = await supabase
    .from('soft_group_members')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('soft_group_id', softGroupId);
  if (error) throw error;
  return (data ?? []) as SoftGroupMemberRow[];
}

// Phase 3 O.4: M:N Object-Tags. Liefert die "tag_object"-Refs des
// gegebenen Objects. Caller resolved tag-Object-Labels via separatem
// fetchObject-Call oder bereits-vorhandenem ObjectMap.
export async function fetchObjectTags(
  workspaceId: string,
  objectId: string,
): Promise<ObjectTagRow[]> {
  if (!workspaceId || !objectId) return [];
  const { data, error } = await supabase
    .from('object_tags')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('object_id', objectId);
  if (error) throw error;
  return (data ?? []) as ObjectTagRow[];
}

// ─── Mutations: Groups / Soft-Groups ─────────────────────────
// Sync-online ohne safe-mutation-Wrapper — Group-Anlage ist eine
// User-getriggerte Single-Action im Bulk-Modal mit eigener Toast-
// Pflege. Pattern wie createObject.

export async function createGroup(args: {
  workspaceId: string;
  name: string;
  description?: string | null;
}): Promise<GroupRow> {
  const { data: rpcData, error: rpcErr } = await supabase.rpc('mcp_create_group', {
    p_workspace_id: args.workspaceId,
    p_name: args.name,
    p_description: args.description ?? null,
  });
  if (rpcErr) throw rpcErr;
  const groupId = (rpcData as { group_id?: string } | null)?.group_id;
  if (!groupId) throw new Error('mcp_create_group: keine group_id zurueck');

  const { data: rowData, error: rowErr } = await supabase
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .single();
  if (rowErr) throw rowErr;
  return rowData as GroupRow;
}

export async function addGroupMembers(
  groupId: string,
  objectIds: string[],
): Promise<{ added: number; total: number }> {
  if (objectIds.length === 0) return { added: 0, total: 0 };
  const { data, error } = await supabase.rpc('mcp_add_group_members', {
    p_group_id: groupId,
    p_object_ids: objectIds,
  });
  if (error) throw error;
  const r = data as { added?: number; total?: number } | null;
  return { added: r?.added ?? 0, total: r?.total ?? objectIds.length };
}

export async function removeGroupMembers(
  groupId: string,
  objectIds: string[],
): Promise<{ removed: number }> {
  if (objectIds.length === 0) return { removed: 0 };
  const { data, error } = await supabase.rpc('mcp_remove_group_members', {
    p_group_id: groupId,
    p_object_ids: objectIds,
  });
  if (error) throw error;
  return { removed: (data as { removed?: number } | null)?.removed ?? 0 };
}

export async function renameGroup(groupId: string, newName: string): Promise<void> {
  const { error } = await supabase.rpc('mcp_rename_group', {
    p_group_id: groupId,
    p_new_name: newName,
  });
  if (error) throw error;
}

export async function deleteGroup(groupId: string): Promise<void> {
  const { error } = await supabase.rpc('mcp_delete_group', { p_group_id: groupId });
  if (error) throw error;
}

// Soft-Gruppe: ephemere Multi-Select-Auswahl. Wird vom BulkAddModal
// im Hintergrund gespeichert wenn der User KEIN "Als Gruppe speichern"
// aktiviert hat — Quick-Vorschlag fuer naechste aehnliche Aktion.
export async function createSoftGroup(args: {
  workspaceId: string;
  name: string;
  sourceNodeId?: string | null;
  objectIds: string[];
}): Promise<SoftGroupRow> {
  const { data: rpcData, error: rpcErr } = await supabase.rpc('mcp_create_soft_group', {
    p_workspace_id: args.workspaceId,
    p_name: args.name,
    p_source_node_id: args.sourceNodeId ?? null,
    p_object_ids: args.objectIds,
  });
  if (rpcErr) throw rpcErr;
  const sgId = (rpcData as { soft_group_id?: string } | null)?.soft_group_id;
  if (!sgId) throw new Error('mcp_create_soft_group: keine soft_group_id zurueck');

  const { data: rowData, error: rowErr } = await supabase
    .from('soft_groups')
    .select('*')
    .eq('id', sgId)
    .single();
  if (rowErr) throw rowErr;
  return rowData as SoftGroupRow;
}

export async function promoteSoftGroup(args: {
  softGroupId: string;
  groupName: string;
  description?: string | null;
}): Promise<{ groupId: string; alreadyPromoted: boolean }> {
  const { data, error } = await supabase.rpc('mcp_promote_soft_group', {
    p_soft_group_id: args.softGroupId,
    p_group_name: args.groupName,
    p_description: args.description ?? null,
  });
  if (error) throw error;
  const r = data as { group_id?: string; already_promoted?: boolean } | null;
  if (!r?.group_id) throw new Error('mcp_promote_soft_group: keine group_id zurueck');
  return { groupId: r.group_id, alreadyPromoted: r.already_promoted === true };
}

// ─── Mutations: Object-Detail (Phase 3 O.4) ──────────────────
// Edit-Pfad fuer label/alias/type/attrs + Hierarchie + Tags + Delete.
// Sync-online ohne safe-mutation-Wrapper — Object-Detail-Page hat
// eigene Toast/Loading-Pflege, kein Bulk-Optimistic.

export async function updateObject(args: {
  objectId: string;
  label?: string;
  alias?: string | null; // '' oder null = clear
  typeLabel?: string | null; // '' oder null = clear
  attrs?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.rpc('mcp_update_object', {
    p_object_id: args.objectId,
    p_label: args.label ?? null,
    p_alias: args.alias ?? null,
    p_type_label: args.typeLabel ?? null,
    p_attrs: args.attrs ?? null,
  });
  if (error) throw error;
}

export async function setObjectParent(objectId: string, parentId: string | null): Promise<void> {
  const { error } = await supabase.rpc('mcp_set_object_parent', {
    p_object_id: objectId,
    p_parent_id: parentId,
  });
  if (error) throw error;
}

export async function addObjectTag(objectId: string, tagObjectId: string): Promise<void> {
  const { error } = await supabase.rpc('mcp_add_object_tag', {
    p_object_id: objectId,
    p_tag_object_id: tagObjectId,
  });
  if (error) throw error;
}

export async function removeObjectTag(objectId: string, tagObjectId: string): Promise<void> {
  const { error } = await supabase.rpc('mcp_remove_object_tag', {
    p_object_id: objectId,
    p_tag_object_id: tagObjectId,
  });
  if (error) throw error;
}

export async function deleteObject(objectId: string): Promise<void> {
  const { error } = await supabase.rpc('mcp_delete_object', { p_object_id: objectId });
  if (error) throw error;
}
