// Welle WV.A.4 — Saved-Filter Mutations + Reads.
//
// CRUD-Layer fuer saved_filters (Migration 070). body-jsonb folgt
// SavedFilterBody aus lib/atom-filter-attrs.ts (WV.Y) — defensiver
// Decoder isSavedFilterBody validiert beim Read.
//
// Konsumenten:
//   - FilterBuilderModal (WV.A.7) — schreibt SavedFilterBody als body.
//   - BoardView FilterBox + ChecklistPanel-Filter + Sidebar-Trees +
//     Command-Palette (Welle B+C) — lesen SavedFilterRow.
//   - MCP-Tool atoms.filter (Welle A.8) — nimmt body als Payload.

import { type SavedFilterBody, isSavedFilterBody } from './atom-filter-attrs';
import { isNetworkError } from './mutation-queue';
import { type CacheTable, getByWorkspace, mergeRows } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { runOptimisticDelete, runOptimisticInsert, runOptimisticUpdate } from './safe-mutation';
import { supabase } from './supabase';
import type { SavedFilterRow } from './types';

const SAVED_FILTERS_TABLE: CacheTable = 'saved_filters';

// ─── Reads ─────────────────────────────────────────────────────

export async function fetchSavedFiltersForWorkspace(
  workspaceId: string,
): Promise<SavedFilterRow[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('saved_filters')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const rows = (data ?? []) as SavedFilterRow[];
    void mergeRows(SAVED_FILTERS_TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<SavedFilterRow>(SAVED_FILTERS_TABLE, workspaceId);
    markCacheFallback();
    return cached;
  }
}

// Decoder-Wrapper: wirft wenn body schema-broken ist.
export function decodeFilterBody(row: SavedFilterRow): SavedFilterBody {
  if (!isSavedFilterBody(row.body)) {
    throw new Error(
      `Saved-Filter ${row.id} hat ungueltigen body (Schema-Drift?). atom_kind=${row.atom_kind}`,
    );
  }
  return row.body;
}

// ─── Mutations ──────────────────────────────────────────────

export type AddSavedFilterInput = {
  workspaceId: string;
  ownerUserId?: string | null; // NULL = Workspace-shared
  name: string;
  body: SavedFilterBody;
};

export async function addSavedFilter(input: AddSavedFilterInput): Promise<SavedFilterRow> {
  if (!input.name?.trim()) throw new Error('Filter-Name ist Pflicht.');
  if (!isSavedFilterBody(input.body)) {
    throw new Error('Filter-Body entspricht nicht dem SavedFilterBody-Schema.');
  }
  return runOptimisticInsert<SavedFilterRow>({
    table: SAVED_FILTERS_TABLE,
    workspaceId: input.workspaceId,
    label: 'Filter speichern',
    run: async () => {
      const { data, error } = await supabase
        .from('saved_filters')
        .insert({
          workspace_id: input.workspaceId,
          owner_user_id: input.ownerUserId ?? null,
          name: input.name,
          atom_kind: input.body.atomKind,
          body: input.body,
        })
        .select()
        .single();
      if (error) throw error;
      return data as SavedFilterRow;
    },
    buildOffline: (id) => ({
      id,
      workspace_id: input.workspaceId,
      owner_user_id: input.ownerUserId ?? null,
      name: input.name,
      atom_kind: input.body.atomKind,
      body: input.body,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
}

export type SavedFilterPatch = Partial<{
  name: string;
  body: SavedFilterBody;
}>;

export async function updateSavedFilter(
  id: string,
  patch: SavedFilterPatch,
): Promise<SavedFilterRow> {
  if (patch.body && !isSavedFilterBody(patch.body)) {
    throw new Error('Filter-Body entspricht nicht dem SavedFilterBody-Schema.');
  }
  // Wenn body geaendert: atom_kind muss synchron mit body.atomKind sein.
  const dbPatch: Record<string, unknown> = {};
  if (patch.name !== undefined) dbPatch.name = patch.name;
  if (patch.body !== undefined) {
    dbPatch.body = patch.body;
    dbPatch.atom_kind = patch.body.atomKind;
  }
  return runOptimisticUpdate<SavedFilterRow>({
    table: SAVED_FILTERS_TABLE,
    id,
    patch: dbPatch,
    label: 'Filter aendern',
    run: async () => {
      const { data, error } = await supabase
        .from('saved_filters')
        .update(dbPatch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as SavedFilterRow;
    },
  });
}

export async function deleteSavedFilter(id: string): Promise<void> {
  await runOptimisticDelete({
    table: SAVED_FILTERS_TABLE,
    id,
    label: 'Filter loeschen',
    run: async () => {
      const { error } = await supabase.from('saved_filters').delete().eq('id', id);
      if (error) throw error;
    },
  });
}
