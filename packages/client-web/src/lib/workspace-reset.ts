// Reset-Helpers fuer das Command-Verb `^reset` und das Sidebar-
// Kontextmenue "Leeren".
//
// Scope-Varianten:
//   - matrix            Matrix-Inhalt weg, Matrix-Node bleibt (Name/Alias).
//   - board             Board-Inhalt (Karten, Checklisten, Links) weg,
//                       Board-Node bleibt.
//   - cell              Zelle komplett leer (Sub-Struktur + Info + Checklisten
//                       + Docs). Der Cell-Row bleibt bestehen (matrix_id /
//                       row_id / col_id), damit die Matrix-Ansicht die
//                       Position nicht verschiebt.
//   - feature-info      Nur Info-Felder + Info-Links der Zelle weg, sonst
//                       alles unveraendert.
//   - feature-checklists Nur Checklisten (+ Items) der Zelle weg.
//
// Workspace-weit:
//   resetAllWorkspace(workspaceId) loescht ALLES und legt eine frische
//   leere Matrix an. Danach ist der Workspace in einem "wie neu" Zustand.
//
// Die eigentliche Clear-Mechanik stammt aus subtree-import.ts
// (clearCellCompletely, clearMatrixContents, etc.) — wir re-exporten
// sie hier als Helper. Fuer Board gibt es noch keinen Helper, wird
// lokal implementiert.

import { showChoice } from './dialog';
import {
  downloadSubtreeExport,
  downloadWorkspaceExport,
  exportCellSubtree,
  exportFeatureChecklists,
  exportFeatureInfo,
  exportSubtree,
  exportWorkspace,
  summarizeExport,
} from './export';
import {
  clearCellChecklistsData,
  clearCellCompletely,
  clearCellInfoData,
  clearMatrixContents,
} from './subtree-import';
import { supabase } from './supabase';
import type { NodeRow } from './types';

export type ResetScope =
  | { kind: 'matrix'; matrixNodeId: string }
  | { kind: 'board'; boardNodeId: string }
  | { kind: 'cell'; cellId: string }
  | { kind: 'feature-info'; cellId: string }
  | { kind: 'feature-checklists'; cellId: string };

// Board-Inhalt leeren: alle Karten + kb_cols + Checklisten + Links
// mit board_id=target. Board-Node + Label + Alias bleiben.
//
// Phase 4 T.1.D: Karten = task_manifestations(kind='kanban',
// display_meta.board_id=board). Items = task_manifestations(kind=
// 'checklist', container_id IN board.checklists). Wir loeschen die
// Tasks der jeweiligen Manifestations (CASCADE killt die Manifestations
// selbst), dann kb_cols / checklists / links via FK.
async function clearBoardContents(boardNodeId: string): Promise<void> {
  // 1. Tasks mit kanban-Manif auf diesem Board.
  const { data: kbManifs, error: kbErr } = await supabase
    .from('task_manifestations')
    .select('task_id, display_meta')
    .eq('kind', 'kanban');
  if (kbErr) throw kbErr;
  const cardTaskIds = (kbManifs ?? [])
    .filter(
      (m: { task_id: string; display_meta: Record<string, unknown> | null }) =>
        (m.display_meta as Record<string, unknown> | null)?.board_id === boardNodeId,
    )
    .map((m: { task_id: string }) => m.task_id);

  // 2. Tasks mit checklist-Manif in einer Checkliste dieses Boards.
  const { data: cls, error: clQErr } = await supabase
    .from('checklists')
    .select('id')
    .eq('board_id', boardNodeId);
  if (clQErr) throw clQErr;
  const clIds = (cls ?? []).map((c: { id: string }) => c.id);
  let itemTaskIds: string[] = [];
  if (clIds.length > 0) {
    const { data: itManifs, error: imErr } = await supabase
      .from('task_manifestations')
      .select('task_id')
      .eq('kind', 'checklist')
      .in('container_id', clIds);
    if (imErr) throw imErr;
    itemTaskIds = (itManifs ?? []).map((m: { task_id: string }) => m.task_id);
  }

  // 3. Tasks-Bulk-Delete (CASCADE entfernt manifestations).
  const allTaskIds = [...cardTaskIds, ...itemTaskIds];
  if (allTaskIds.length > 0) {
    const { error: tasksErr } = await supabase.from('tasks').delete().in('id', allTaskIds);
    if (tasksErr) throw tasksErr;
  }

  // 4. kb_cols + checklists + links.
  const { error: colsErr } = await supabase.from('kb_cols').delete().eq('board_id', boardNodeId);
  if (colsErr) throw colsErr;
  const { error: clErr } = await supabase.from('checklists').delete().eq('board_id', boardNodeId);
  if (clErr) throw clErr;
  const { error: linksErr } = await supabase.from('links').delete().eq('board_id', boardNodeId);
  if (linksErr) throw linksErr;
}

export async function resetScope(scope: ResetScope): Promise<void> {
  switch (scope.kind) {
    case 'matrix':
      await clearMatrixContents(scope.matrixNodeId);
      return;
    case 'board':
      await clearBoardContents(scope.boardNodeId);
      return;
    case 'cell':
      await clearCellCompletely(scope.cellId);
      return;
    case 'feature-info':
      await clearCellInfoData(scope.cellId);
      return;
    case 'feature-checklists':
      await clearCellChecklistsData(scope.cellId);
      return;
  }
}

// Kompletter Workspace-Reset: alle User-Daten wegwerfen, dann eine
// frische Root-Matrix anlegen. Gibt die neue Matrix-Node-ID zurueck,
// damit der Caller nach dem Reset zu ihr navigieren kann.
export async function resetAllWorkspace(workspaceId: string): Promise<{ rootMatrixId: string }> {
  // 1. Alle Nodes loeschen — Cascade entfernt rows/cols/cells/kb_cols/
  //    kb_cards/checklists/checklist_items/links per FK-Kette.
  //    Docs haben docs.workspace_id → workspaces CASCADE, aber
  //    workspace bleibt; attached_cell_id wird durch Cell-Delete auf
  //    NULL gesetzt. Wir loeschen docs deshalb explizit.
  const { error: docsErr } = await supabase.from('docs').delete().eq('workspace_id', workspaceId);
  if (docsErr) throw docsErr;
  const { error: nodesErr } = await supabase.from('nodes').delete().eq('workspace_id', workspaceId);
  if (nodesErr) throw nodesErr;

  // 2. Frische Root-Matrix anlegen — neuer Start-Punkt.
  const { data, error } = await supabase
    .from('nodes')
    .insert({
      workspace_id: workspaceId,
      type: 'matrix',
      label: 'Neue Matrix',
      // Phase 3 O.8: Template-Spalte (Snapshot = label).
      label_template: 'Neue Matrix',
      parent_cell_id: null,
      data: {},
    })
    .select()
    .single();
  if (error) throw error;
  return { rootMatrixId: (data as NodeRow).id };
}

// ─── High-Level-Runner (mit Export-Prompt + Dialog) ──────────────
// Diese Funktionen werden aus dem Command-Handler + Kontextmenue
// aufgerufen. Sie kapseln den kompletten Flow: Scope bestimmen,
// optional Backup exportieren, bestaetigen, ausfuehren.

export type ResetScopeLabel = {
  kind: ResetScope['kind'];
  label: string; // Endkundenlabel, z.B. "Matrix \"Produkte\""
};

function labelForScope(scope: ResetScope, nodeLabel?: string): string {
  switch (scope.kind) {
    case 'matrix':
      return nodeLabel ? `Matrix "${nodeLabel}"` : 'Matrix';
    case 'board':
      return nodeLabel ? `Board "${nodeLabel}"` : 'Board';
    case 'cell':
      return 'Zelle';
    case 'feature-info':
      return 'Info-Felder';
    case 'feature-checklists':
      return 'Checklisten';
  }
}

async function exportForScope(scope: ResetScope, workspaceId: string): Promise<void> {
  // Jeweilige Export-Funktion + Download mit sinnvollem Dateinamen.
  switch (scope.kind) {
    case 'matrix': {
      const data = await exportSubtree(scope.matrixNodeId, workspaceId);
      await downloadSubtreeExport(data, 'backup-matrix');
      return;
    }
    case 'board': {
      const data = await exportSubtree(scope.boardNodeId, workspaceId);
      await downloadSubtreeExport(data, 'backup-board');
      return;
    }
    case 'cell': {
      const data = await exportCellSubtree(scope.cellId, workspaceId);
      await downloadSubtreeExport(data, 'backup-zelle');
      return;
    }
    case 'feature-info': {
      const data = await exportFeatureInfo(scope.cellId, workspaceId);
      await downloadSubtreeExport(data, 'backup-info');
      return;
    }
    case 'feature-checklists': {
      const data = await exportFeatureChecklists(scope.cellId, workspaceId);
      await downloadSubtreeExport(data, 'backup-checklists');
      return;
    }
  }
}

// Scope-Reset mit 3-Weg-Dialog (Abbrechen / Export + Leeren / Nur
// Leeren). Rueckgabe true, wenn ausgefuehrt.
export async function runResetScope(args: {
  workspaceId: string;
  scope: ResetScope;
  nodeLabel?: string;
}): Promise<boolean> {
  const { workspaceId, scope, nodeLabel } = args;
  const label = labelForScope(scope, nodeLabel);
  const choice = await showChoice({
    title: 'Leeren',
    message: `${label} leeren? Alle darin enthaltenen Daten werden geloescht. Du kannst vorher einen Sicherungs-Export ziehen.`,
    choices: [
      {
        id: 'export-clear',
        label: 'Sichern + Leeren',
        variant: 'default',
      },
      { id: 'clear', label: 'Leeren', variant: 'danger' },
      { id: 'cancel', label: 'Abbrechen', variant: 'default' },
    ],
  });
  if (!choice || choice === 'cancel') return false;
  if (choice === 'export-clear') {
    await exportForScope(scope, workspaceId);
  }
  await resetScope(scope);
  return true;
}

// Workspace-Reset mit optionalem Export-Prompt. Bei skipConfirm=true
// wird weder Export angeboten noch bestaetigt — harte Wipe, sofort.
// Rueckgabe: neue Root-Matrix-ID wenn ausgefuehrt, null bei Abbruch.
export async function runResetAll(args: {
  workspaceId: string;
  skipConfirm: boolean;
}): Promise<{ rootMatrixId: string } | null> {
  const { workspaceId, skipConfirm } = args;
  if (skipConfirm) {
    return await resetAllWorkspace(workspaceId);
  }
  // 3-Weg-Choice wie Scope-Reset.
  const choice = await showChoice({
    title: 'Workspace leeren',
    message:
      'Das loescht ALLE Matrizen, Boards, Zellen, Karten, Checklisten, Docs und Links in diesem Workspace. Danach steht nur eine leere Matrix bereit. Willst du vorher einen Sicherungs-Export ziehen?',
    choices: [
      {
        id: 'export-clear',
        label: 'Sichern + Alles Leeren',
        variant: 'default',
      },
      { id: 'clear', label: 'Alles Leeren', variant: 'danger' },
      { id: 'cancel', label: 'Abbrechen', variant: 'default' },
    ],
  });
  if (!choice || choice === 'cancel') return null;
  if (choice === 'export-clear') {
    const data = await exportWorkspace(workspaceId);
    const wsName =
      typeof (data.workspace as { name?: unknown }).name === 'string'
        ? (data.workspace as { name: string }).name
        : 'workspace';
    await downloadWorkspaceExport(data, `backup-${wsName}`);
  }
  return await resetAllWorkspace(workspaceId);
}

// Hilfs-Builder fuer Context-Menue-Scope: aus einem Tree-Entry den
// passenden ResetScope ableiten. Undefined = keine Reset-Aktion
// moeglich (z.B. link/doc-Rows).
export function scopeFromNodeRow(nodeId: string, type: 'matrix' | 'board'): ResetScope {
  return type === 'matrix'
    ? { kind: 'matrix', matrixNodeId: nodeId }
    : { kind: 'board', boardNodeId: nodeId };
}

// Workaround fuer `summarizeExport`-Nutzung in Callern — re-export,
// damit workspace-reset als einzige Import-Quelle reicht.
export { summarizeExport };
