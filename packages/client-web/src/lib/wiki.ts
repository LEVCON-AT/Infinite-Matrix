// Wiki/Doku-Layer (Welle E.1) — V1 Schema + Mutations.
//
// Zwei Welten:
//   - Plattform-Pages (workspace_id IS NULL) — Read fuer alle, Write
//     fuer platform_admin (RLS in Migration 090).
//   - Workspace-Pages — Read fuer Member, Write fuer Editor+.
//
// Slug + Title sind frontend-validiert; Server raised CHECK-Violations
// bei Format-Verstoss. Hierarchie ueber parent_id (self-referential).
//
// Offline: IDB-Cache `wiki_pages`, normale runOptimistic*-Wrapper.
// Plattform-Pages werden mit workspace_id='' im Cache abgelegt (der
// CacheTable-Key by_workspace nutzt den leeren String als Default-
// Scope) — V1 reicht das; V2 koennte den Plattform-Scope explizit
// trennen, wenn Workspace + Plattform parallel offline sein muessen.

import { isNetworkError } from './mutation-queue';
import { type CacheTable, getByWorkspace, mergeRows } from './offline-cache';
import { markCacheFallback, markLiveSuccess } from './offline-state';
import { runOptimisticDelete, runOptimisticInsert, runOptimisticUpdate } from './safe-mutation';
import { supabase } from './supabase';
import type { WikiPageInput, WikiPageRow } from './types';

export type { WikiPageInput, WikiPageRow } from './types';

const TABLE: CacheTable = 'wiki_pages';

// Cache-Scope: '' steht fuer Plattform-Pages (workspace_id IS NULL in DB).
// Der safe-mutation-Wrapper erwartet einen string-Workspace fuer die
// Cache-by_workspace-Indexierung; '' ist der V1-Sonderwert.
type WikiCacheRow = Omit<WikiPageRow, 'workspace_id'> & { workspace_id: string };

function toCacheRow(row: WikiPageRow): WikiCacheRow {
  return { ...row, workspace_id: row.workspace_id ?? '' };
}

function fromCacheRow(row: WikiCacheRow, originalWorkspaceId: string | null): WikiPageRow {
  return { ...row, workspace_id: originalWorkspaceId };
}

// Workspace-Pages eines Workspaces — Tree-View laedt das in einem Read.
export async function fetchWorkspaceWikiPages(workspaceId: string): Promise<WikiPageRow[]> {
  if (!workspaceId) return [];
  try {
    const { data, error } = await supabase
      .from('wiki_pages')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as WikiPageRow[];
    void mergeRows(TABLE, rows.map(toCacheRow)).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getByWorkspace<WikiCacheRow>(TABLE, workspaceId);
    markCacheFallback();
    return cached
      .map((c) => fromCacheRow(c, c.workspace_id || null))
      .sort((a, b) => a.position - b.position);
  }
}

// Plattform-Pages (workspace_id IS NULL). Get-only fuer normale User.
export async function fetchPlatformWikiPages(): Promise<WikiPageRow[]> {
  try {
    const { data, error } = await supabase
      .from('wiki_pages')
      .select('*')
      .is('workspace_id', null)
      .order('position', { ascending: true });
    if (error) throw error;
    const rows = (data ?? []) as WikiPageRow[];
    void mergeRows(TABLE, rows.map(toCacheRow)).catch(() => {});
    markLiveSuccess();
    return rows;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // Plattform-Cache lebt unter dem leeren Workspace-Key. Bei Tree-Joins
    // muss der Aufrufer eh wissen welche Welt — also kein Misch-Risk.
    const all = await getByWorkspace<WikiCacheRow>(TABLE, '');
    markCacheFallback();
    return all
      .filter((p) => !p.workspace_id)
      .map((c) => fromCacheRow(c, null))
      .sort((a, b) => a.position - b.position);
  }
}

export async function fetchWikiPage(pageId: string): Promise<WikiPageRow | null> {
  if (!pageId) return null;
  try {
    const { data, error } = await supabase
      .from('wiki_pages')
      .select('*')
      .eq('id', pageId)
      .maybeSingle();
    if (error) throw error;
    return (data ?? null) as WikiPageRow | null;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // V1: kein dedizierter by_id-Read, Cache wird ueber by_workspace
    // hydriert. Nicht-gefunden = null.
    markCacheFallback();
    return null;
  }
}

// Slug-Helper: Title → URL-safe slug (a-z0-9-). Server-Side CHECK
// regex matches; wir bringen den Title hier in Form damit der erste
// Submit nicht raised.
export function slugify(title: string): string {
  const lower = title.trim().toLowerCase();
  const replaced = lower
    // Umlaute + Sonderzeichen → ASCII-Aequivalente.
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    // Andere Diakritika (é, ñ, …) fallen ueber den `[^a-z0-9]+`-Filter
    // unten auf "-" — V1-Tradeoff (E.2 koennte NFD-Normalize ergaenzen).
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return replaced.slice(0, 80) || 'seite';
}

export async function createWikiPage(input: WikiPageInput): Promise<WikiPageRow> {
  const wsKey = input.workspace_id ?? '';
  const cacheRow = await runOptimisticInsert<WikiCacheRow>({
    table: TABLE,
    workspaceId: wsKey,
    label: 'Wiki-Seite',
    buildOffline: (id) => ({
      id,
      workspace_id: wsKey,
      parent_id: input.parent_id,
      title: input.title,
      slug: input.slug,
      content_md: input.content_md ?? '',
      position: input.position ?? 0,
      created_by: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
    run: async () => {
      const { data, error } = await supabase
        .from('wiki_pages')
        .insert({
          workspace_id: input.workspace_id,
          parent_id: input.parent_id,
          title: input.title.trim(),
          slug: input.slug,
          content_md: input.content_md ?? '',
          position: input.position ?? 0,
        })
        .select('*')
        .single();
      if (error) throw error;
      return toCacheRow(data as WikiPageRow);
    },
  });
  return fromCacheRow(cacheRow, input.workspace_id);
}

export async function updateWikiPage(
  pageId: string,
  patch: Partial<Pick<WikiPageRow, 'title' | 'slug' | 'content_md' | 'position' | 'parent_id'>>,
): Promise<void> {
  await runOptimisticUpdate<WikiCacheRow>({
    table: TABLE,
    id: pageId,
    label: 'Wiki-Seite',
    patch: patch as Record<string, unknown>,
    run: async () => {
      const { data, error } = await supabase
        .from('wiki_pages')
        .update(patch)
        .eq('id', pageId)
        .select('*')
        .single();
      if (error) throw error;
      return toCacheRow(data as WikiPageRow);
    },
  });
}

export async function deleteWikiPage(pageId: string): Promise<void> {
  await runOptimisticDelete({
    table: TABLE,
    id: pageId,
    label: 'Wiki-Seite',
    run: async () => {
      const { error } = await supabase.from('wiki_pages').delete().eq('id', pageId);
      if (error) throw error;
    },
  });
}
