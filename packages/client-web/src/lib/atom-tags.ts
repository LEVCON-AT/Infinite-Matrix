// Welle D — Atom-Tag Helper.
//
// atom_tags ist die Junction Atom→Tag. Tag-Owner = ausschliesslich Atom
// (Manifestation erbt vom Atom). Vier Tag-Kinds via separaten RPCs:
// freetext / atom_ref / object_ref / alias_ref.
//
// Read-Pfad: fetchAtomTagsByWorkspace + Cache-Fallback.
// Write-Pfad: pro Tag-Kind ein eigener RPC (lecker spezifisch). Server
// macht das Bundling von register_workspace_tag + atom_tags.insert
// in einer Transaktion + dekrementiert usage_count via Trigger.

import { isNetworkError } from './mutation-queue';
import { type CacheTable, getByWorkspace, mergeRows } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { runOptimisticDelete } from './safe-mutation';
import { supabase } from './supabase';
import type { AtomTag, AtomTagWithTag, WorkspaceTag } from './types';
import type { AtomKind } from './atom-manifestations';

const TABLE: CacheTable = 'atom_tags';

// ─── Read ──────────────────────────────────────────────────────
export async function fetchAtomTagsByWorkspace(workspaceId: string): Promise<AtomTag[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('atom_tags')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const rows = (data ?? []) as AtomTag[];
    void mergeRows(TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<AtomTag>(TABLE, workspaceId);
    markCacheFallback();
    return cached;
  }
}

// Tags fuer einen einzelnen Atom holen (joined). Liefert AtomTagWithTag
// fuer direkte Render-Konsumption. Nutzt PostgREST-Embed ueber den
// FK atom_tags.tag_id → workspace_tags.id (real FK, Embed safe).
export async function fetchAtomTagsForAtom(args: {
  workspaceId: string;
  atomType: AtomKind;
  atomId: string;
}): Promise<AtomTagWithTag[]> {
  try {
    const { data, error } = await supabase
      .from('atom_tags')
      .select('*, workspace_tags(*)')
      .eq('workspace_id', args.workspaceId)
      .eq('atom_type', args.atomType)
      .eq('atom_id', args.atomId);
    if (error) throw error;
    const rows = (data ?? []) as Array<
      AtomTag & { workspace_tags: WorkspaceTag | null }
    >;
    markLiveSuccess();
    return rows.flatMap((r) => {
      const reg = r.workspace_tags;
      if (!reg) return [];
      return [
        {
          id: r.id,
          atom_type: r.atom_type,
          atom_id: r.atom_id,
          workspace_id: r.workspace_id,
          tag_id: r.tag_id,
          position: r.position,
          created_at: r.created_at,
          tag_kind: reg.kind,
          tag_value: reg.value,
          tag_display_label: reg.display_label,
        } as AtomTagWithTag,
      ];
    });
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // Offline: ueber zwei Stores joinen.
    const [atomTags, wsTags] = await Promise.all([
      getByWorkspace<AtomTag>(TABLE, args.workspaceId),
      getByWorkspace<WorkspaceTag>('workspace_tags', args.workspaceId),
    ]);
    markCacheFallback();
    const atomScoped = atomTags.filter(
      (t) => t.atom_type === args.atomType && t.atom_id === args.atomId,
    );
    return joinAtomTagsWithRegistry(atomScoped, wsTags);
  }
}

// Joint AtomTag + WorkspaceTag — was die TagPills-Render-Pfade brauchen.
// In-Memory-Join, aufgerufen aus Workspace-Resolver.
export function joinAtomTagsWithRegistry(
  atomTags: AtomTag[],
  workspaceTags: WorkspaceTag[],
): AtomTagWithTag[] {
  const tagById = new Map(workspaceTags.map((t) => [t.id, t]));
  return atomTags.flatMap((at) => {
    const reg = tagById.get(at.tag_id);
    if (!reg) return []; // dangling — Registry-Tag wurde geGCt aber Junction-Trigger nicht durchgelaufen
    return [
      {
        ...at,
        tag_kind: reg.kind,
        tag_value: reg.value,
        tag_display_label: reg.display_label,
      },
    ];
  });
}

// Filter auf einen konkreten Atom — Pills-Render auf Karte.
export function filterTagsForAtom(
  enriched: AtomTagWithTag[],
  atomType: AtomKind,
  atomId: string,
): AtomTagWithTag[] {
  return enriched.filter((t) => t.atom_type === atomType && t.atom_id === atomId);
}

// ─── Write ─────────────────────────────────────────────────────
export async function addAtomTagFreetext(args: {
  workspaceId: string;
  atomType: AtomKind;
  atomId: string;
  value: string;
}): Promise<AtomTagWithTag> {
  const { data, error } = await supabase.rpc('add_atom_tag_freetext', {
    p_workspace_id: args.workspaceId,
    p_atom_type: args.atomType,
    p_atom_id: args.atomId,
    p_value: args.value,
  });
  if (error) throw error;
  return data as AtomTagWithTag;
}

export async function addAtomTagAlias(args: {
  workspaceId: string;
  atomType: AtomKind;
  atomId: string;
  alias: string;
}): Promise<AtomTagWithTag> {
  const { data, error } = await supabase.rpc('add_atom_tag_alias', {
    p_workspace_id: args.workspaceId,
    p_atom_type: args.atomType,
    p_atom_id: args.atomId,
    p_alias: args.alias,
  });
  if (error) throw error;
  return data as AtomTagWithTag;
}

export async function addAtomTagAtomRef(args: {
  workspaceId: string;
  atomType: AtomKind;
  atomId: string;
  targetAtomType: AtomKind;
  targetAtomId: string;
}): Promise<AtomTagWithTag> {
  const { data, error } = await supabase.rpc('add_atom_tag_atomref', {
    p_workspace_id: args.workspaceId,
    p_atom_type: args.atomType,
    p_atom_id: args.atomId,
    p_target_atom_type: args.targetAtomType,
    p_target_atom_id: args.targetAtomId,
  });
  if (error) throw error;
  return data as AtomTagWithTag;
}

export async function addAtomTagObjectRef(args: {
  workspaceId: string;
  atomType: AtomKind;
  atomId: string;
  objectKind: 'cell' | 'node';
  objectId: string;
}): Promise<AtomTagWithTag> {
  const { data, error } = await supabase.rpc('add_atom_tag_objectref', {
    p_workspace_id: args.workspaceId,
    p_atom_type: args.atomType,
    p_atom_id: args.atomId,
    p_object_kind: args.objectKind,
    p_object_id: args.objectId,
  });
  if (error) throw error;
  return data as AtomTagWithTag;
}

export async function removeAtomTag(id: string): Promise<void> {
  await runOptimisticDelete({
    table: TABLE,
    id,
    label: 'Tag entfernen',
    run: async () => {
      const { error } = await supabase.rpc('remove_atom_tag', { p_id: id });
      if (error) throw error;
    },
  });
}

export async function gcWorkspaceTags(workspaceId: string): Promise<number> {
  const { data, error } = await supabase.rpc('gc_workspace_tags', {
    p_workspace_id: workspaceId,
  });
  if (error) throw error;
  return data as number;
}
