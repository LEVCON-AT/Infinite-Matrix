// Native Workspace-Export: fetcht alle Tabellen pro Workspace und
// produziert ein JSON-Blob zum Download. V1 ist bewusst NICHT round-
// trip-kompatibel mit dem Import (der liest die AltPayload-Shape vom
// HTML-Vorbild). Ziel V1: Daten-Hoheit — User kann seinen State
// jederzeit als JSON ziehen und archivieren/diffen. V2 wuerde die
// Transformation in AltPayload-Shape nachliefern.
//
// RLS kuemmert sich um die Authorization: der anonym-JWT sieht nur
// Rows in Workspaces, in denen der User Mitglied ist.

import { supabase } from './supabase';

export const WORKSPACE_EXPORT_VERSION = 1 as const;

export type WorkspaceExport = {
  version: typeof WORKSPACE_EXPORT_VERSION;
  exportedAt: string;
  workspace: Record<string, unknown>;
  nodes: Record<string, unknown>[];
  rows: Record<string, unknown>[];
  cols: Record<string, unknown>[];
  cells: Record<string, unknown>[];
  kb_cols: Record<string, unknown>[];
  kb_cards: Record<string, unknown>[];
  checklists: Record<string, unknown>[];
  checklist_items: Record<string, unknown>[];
  links: Record<string, unknown>[];
};

export async function exportWorkspace(
  workspaceId: string,
): Promise<WorkspaceExport> {
  // Workspace-Stammdaten (Name, Owner, Timestamps) — RLS erlaubt nur
  // Read auf Memberships-Workspaces.
  const wsRes = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', workspaceId)
    .single();
  if (wsRes.error) throw wsRes.error;

  // Alle Kind-Tabellen parallel laden. workspace_id-Filter zusaetzlich
  // zur RLS als Guard.
  const [
    nodesRes,
    rowsRes,
    colsRes,
    cellsRes,
    kbColsRes,
    kbCardsRes,
    checklistsRes,
    checklistItemsRes,
    linksRes,
  ] = await Promise.all([
    supabase.from('nodes').select('*').eq('workspace_id', workspaceId),
    supabase.from('rows').select('*').eq('workspace_id', workspaceId),
    supabase.from('cols').select('*').eq('workspace_id', workspaceId),
    supabase.from('cells').select('*').eq('workspace_id', workspaceId),
    supabase.from('kb_cols').select('*').eq('workspace_id', workspaceId),
    supabase.from('kb_cards').select('*').eq('workspace_id', workspaceId),
    supabase.from('checklists').select('*').eq('workspace_id', workspaceId),
    supabase
      .from('checklist_items')
      .select('*')
      .eq('workspace_id', workspaceId),
    supabase.from('links').select('*').eq('workspace_id', workspaceId),
  ]);

  for (const res of [
    nodesRes,
    rowsRes,
    colsRes,
    cellsRes,
    kbColsRes,
    kbCardsRes,
    checklistsRes,
    checklistItemsRes,
    linksRes,
  ]) {
    if (res.error) throw res.error;
  }

  return {
    version: WORKSPACE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: wsRes.data as Record<string, unknown>,
    nodes: (nodesRes.data ?? []) as Record<string, unknown>[],
    rows: (rowsRes.data ?? []) as Record<string, unknown>[],
    cols: (colsRes.data ?? []) as Record<string, unknown>[],
    cells: (cellsRes.data ?? []) as Record<string, unknown>[],
    kb_cols: (kbColsRes.data ?? []) as Record<string, unknown>[],
    kb_cards: (kbCardsRes.data ?? []) as Record<string, unknown>[],
    checklists: (checklistsRes.data ?? []) as Record<string, unknown>[],
    checklist_items: (checklistItemsRes.data ?? []) as Record<
      string,
      unknown
    >[],
    links: (linksRes.data ?? []) as Record<string, unknown>[],
  };
}

// Triggert den Browser-Download des Export-JSON. Blob + ObjectURL +
// temporaerer Anchor. Filename mit Datum, damit Mehrfach-Exports
// nicht ueberschrieben werden.
export function downloadWorkspaceExport(
  exportData: WorkspaceExport,
  workspaceName: string,
): void {
  const pretty = JSON.stringify(exportData, null, 2);
  const blob = new Blob([pretty], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  const safeName = (workspaceName || 'workspace')
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  a.href = url;
  a.download = `${safeName}-${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Cleanup nach naechstem Paint — sonst revocet Chrome den Download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
