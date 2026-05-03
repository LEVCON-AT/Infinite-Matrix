// Welle D — Workspace-Tag-Registry (Cache + Realtime).
//
// workspace_tags-Rows pro Workspace im Memory + IDB cached. Realtime-
// Subscription updated den Cache. Konsumenten:
//   - TagInput-Autocomplete (`#`-Trigger zeigt registry-eintraege)
//   - TagPills-Display-Label-Resolve
//   - alias_ref Live-Resolve gegen alias-index (mit Fallback auf Snapshot)
//
// API-Mapping zur Workspace-Resolver-Layer (Workspace.tsx):
//   getWorkspaceTags(wsId) -> WorkspaceTag[] (alle Kinds)
//   getTagMatches(wsId, query, kinds?) -> WorkspaceTag[] (Autocomplete)

import { isNetworkError } from './mutation-queue';
import { type CacheTable, getByWorkspace, mergeRows } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { supabase } from './supabase';
import type { TagKind, WorkspaceTag } from './types';

const TABLE: CacheTable = 'workspace_tags';

// ─── Read ──────────────────────────────────────────────────────
export async function fetchWorkspaceTagsByWorkspace(workspaceId: string): Promise<WorkspaceTag[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('workspace_tags')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (error) throw error;
    const rows = (data ?? []) as WorkspaceTag[];
    void mergeRows(TABLE, rows).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<WorkspaceTag>(TABLE, workspaceId);
    markCacheFallback();
    return cached;
  }
}

// Autocomplete-Helper. Filtert nach Kind(s) + Substring im display_label
// bzw. value (case-insensitive). Sortiert nach usage_count DESC, dann
// alphabetisch — populaere Tags zuerst.
export function getTagMatches(
  registry: WorkspaceTag[],
  query: string,
  opts?: { kinds?: TagKind[]; limit?: number },
): WorkspaceTag[] {
  const kinds = opts?.kinds;
  const limit = opts?.limit ?? 8;
  const q = query.trim().toLowerCase();
  const filtered = registry
    .filter((t) => (kinds ? kinds.includes(t.kind) : true))
    .filter((t) => {
      if (!q) return true;
      const value = (t.value ?? '').toLowerCase();
      const label = (t.display_label ?? '').toLowerCase();
      return value.includes(q) || label.includes(q);
    });
  filtered.sort((a, b) => {
    if (b.usage_count !== a.usage_count) return b.usage_count - a.usage_count;
    return (a.display_label ?? a.value).localeCompare(b.display_label ?? b.value);
  });
  return filtered.slice(0, limit);
}
