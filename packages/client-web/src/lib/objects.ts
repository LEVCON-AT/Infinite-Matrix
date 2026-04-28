// Object-Layer (Phase 3 Welle O.1) — Skeleton.
//
// O.1 ist Schema-Foundation + Frontend-Types. Hier liegt die noch
// leere Lib-Datei als Anker fuer die kommenden Wellen O.2 (Auto-Object
// + Suggestion), O.3 (Bulk-Dialog + Gruppen), O.4 (Hierarchie + Detail-
// Page), O.5 (Backlinks-Index), O.6 (Group→Matrix-Generator), O.7
// (Sidebar-Tab + Mgmt-Page), O.8 (Name-Templates).
//
// Heute (O.1) ist die Tabelle leer und wird nicht aus der UI heraus
// gefuellt — fuer manuelle Smoke-Tests ueber psql / Supabase-Studio
// reicht das. Frontend-Mutations + RPCs kommen mit O.2.
//
// Pattern wenn der Code kommt: analog zu lib/ai-providers.ts —
// fetchObjects mit IDB-Cache-Fallback (isNetworkError → markCacheFallback),
// setObject / deleteObject ueber spaetere SECURITY DEFINER RPCs in
// Migration 033 (mcp_create_object, mcp_link_to_object, ...).

import type {
  GroupMemberRow,
  GroupRow,
  ObjectRow,
  ObjectTagRow,
  SoftGroupMemberRow,
  SoftGroupRow,
} from './types';

// Re-Export der Types fuer Konsumenten (bequem ohne tief in types.ts
// zu greifen — Pattern wie bei lib/ai-assist).
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
// Object-Aliase werden mit ^o.<slug>-Prefix in der UI gerendert.
// Im DB-Storage liegt nur der <slug>. validateAlias() (lib/aliases.ts)
// und der Autocomplete-Dropdown muessen das beim Vergleich beachten.
export const OBJECT_ALIAS_PREFIX = '^o.';

// Helper: ^o.kunde-mueller → kunde-mueller. Token-loese Variante fuer
// Vergleich gegen DB-stored alias.
export function stripObjectAliasPrefix(alias: string): string {
  if (alias.startsWith(OBJECT_ALIAS_PREFIX)) {
    return alias.slice(OBJECT_ALIAS_PREFIX.length);
  }
  return alias;
}

// Helper: kunde-mueller → ^o.kunde-mueller. Fuer Display in Tree /
// Object-Detail / Backlinks.
export function withObjectAliasPrefix(slug: string): string {
  return OBJECT_ALIAS_PREFIX + slug;
}

// ─── Stub-Funktionen (nicht aufgerufen in O.1) ────────────────
// Werden in O.2 implementiert. Hier nur die Signaturen damit andere
// Module schon importieren koennen ohne Type-Errors.

export async function fetchObjects(_workspaceId: string): Promise<ObjectRow[]> {
  // O.1: nicht implementiert. Empty Array haelt das UI ruhig.
  return [];
}

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
