// Schreibende Operationen gegen die DB. Pattern:
//   - Rueckgabe: die frische DB-Row (via .select().single())
//   - Fehler: Original-PostgrestError wird weitergeworfen, der Caller
//     uebersetzt mit translateDbError() + showToast().
//
// Offline-Verhalten (Plan 0g.2d/e/f):
//   - Simple update/insert/delete-Operationen gehen durch run-
//     OptimisticUpdate / -Insert / -Delete aus safe-mutation.ts. Online-
//     Path identisch zu vorher, offline patcht der Wrapper den IDB-
//     Cache + queued die Spec fuer Replay.
//   - mutateCellData / mutateNodeData / readChecklistHistory lesen
//     offline aus dem Cache und schreiben ueber wrapped updateCell /
//     updateChecklist / runOptimisticUpdate — JSONB-Mutationen (info-
//     Fields, cell-links, card-inline-checklist-items, node.data fuer
//     Beschreibungen, checklists.history-Snapshots) sind ebenfalls
//     offline-tauglich.
//   - Multi-Step-Operationen (createChildMatrix/Board, addCellChecklist,
//     createCardFromChecklist, moveCard/moveCardToBoard, applyChecklist-
//     Close, bulkAddChecklistItems, restore*-Pfade) loesen sich offline
//     in mehrere Queue-Specs auf, die in FIFO-Reihenfolge replay'd
//     werden — der Server stellt die korrekte Sequenz wieder her.
//
// Bekannte Concurrency-Limits (online wie offline):
//   - JSONB-history-Read-Modify-Write: zwei parallele Writer auf
//     dieselbe checklists.history koennen sich gegenseitig ueber-
//     schreiben. Single-User-Fall unkritisch; Multi-User-Konflikt
//     wuerde durch Realtime-Refetch sichtbar.
//   - Position-Kollisionen: mehrere Karten/Spalten koennen offline
//     auf dieselbe position+1 landen. Realtime-Refetch beim ersten
//     Online-Sync normalisiert die Reihenfolge.

import { addAtomManifestation, nextAtomManifestationPosition } from './atom-manifestations';
import { currentUserIdSync } from './auth';
import { isNetworkError } from './mutation-queue';
import { getById, getByWorkspace } from './offline-cache';
import { runOptimisticDelete, runOptimisticInsert, runOptimisticUpdate } from './safe-mutation';
import { supabase } from './supabase';

// Offline-Helper: groesste Position im Scope finden, +1. Aufrufer
// reicht den Filter-Pradicat, das aus dem Cache passende Rows raus-
// zieht (z.B. board_id + col_id matchen). Liefert 0 wenn der Scope
// noch leer ist.
async function nextPositionFromCache(
  table: 'rows' | 'cols' | 'kb_cols' | 'checklists' | 'links' | 'atom_manifestations',
  workspaceId: string,
  filter: (r: Record<string, unknown> & { position?: number }) => boolean,
): Promise<number> {
  const rows = await getByWorkspace<
    {
      id: string;
      position?: number;
      workspace_id: string;
    } & Record<string, unknown>
  >(table, workspaceId);
  const filtered = rows.filter(filter);
  if (filtered.length === 0) return 0;
  return filtered.reduce((m, r) => Math.max(m, r.position ?? -1), -1) + 1;
}
import {
  readInfoFieldsFromData as readInfoFields,
  readCellLinksFromData as readInfoLinks,
} from './cell-data';
import {
  type CardPatchInput,
  type ItemPatchInput,
  cardSnapshotToTaskAndManif,
  itemSnapshotToTaskAndManif,
  mergeAttrs,
  splitCardPatch,
  splitItemPatch,
  taskAndManifToCard,
  taskAndManifToItem,
} from './task-projections';
import { addManifestation, createTask, deleteTask, updateManifestation, updateTask } from './tasks';
import type {
  CardRecur,
  CellRow,
  ChecklistCloseMode,
  ChecklistItemRow,
  ChecklistRow,
  ColRow,
  DocRow,
  InfoField,
  InfoLink,
  InlineChecklistItem,
  KbCardRow,
  KbColRow,
  LinkProvider,
  LinkRow,
  NodeRow,
  RowRow,
  TaskManifestationRow,
  TaskRow,
} from './types';
import { sanitizeUrl } from './url';

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

async function nextBoardPosition(
  table: 'kb_cols' | 'checklists' | 'links',
  boardId: string,
  workspaceId: string,
): Promise<number> {
  const q = supabase
    .from(table)
    .select('position')
    .eq('board_id', boardId)
    .eq('workspace_id', workspaceId)
    .order('position', { ascending: false })
    .limit(1);
  const { data, error } = await q;
  if (error) throw error;
  const top = data && data.length > 0 ? (data[0] as { position: number }).position : -1;
  return top + 1;
}

// ─── rows ──────────────────────────────────────────────────────
export async function addRow(args: {
  workspaceId: string;
  matrixId: string;
  label?: string;
  // Phase 3 O.2a: optional Object-Ref. Wenn gesetzt, wird die Zeile
  // direkt mit einem existing Object verknuepft — fuer Auto-Object-
  // Pfad via addRowWithObject (siehe lib/objects.ts).
  objectId?: string | null;
}): Promise<RowRow> {
  return runOptimisticInsert<RowRow>({
    table: 'rows',
    workspaceId: args.workspaceId,
    label: 'Zeile anlegen',
    run: async () => {
      const pos = await nextPosition('rows', args.matrixId, args.workspaceId);
      const { data, error } = await supabase
        .from('rows')
        .insert({
          workspace_id: args.workspaceId,
          matrix_id: args.matrixId,
          label: args.label ?? '',
          position: pos,
          object_id: args.objectId ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as RowRow;
    },
    buildOffline: async (id) => {
      const pos = await nextPositionFromCache(
        'rows',
        args.workspaceId,
        (r) => r.matrix_id === args.matrixId,
      );
      return {
        id,
        workspace_id: args.workspaceId,
        matrix_id: args.matrixId,
        label: args.label ?? '',
        position: pos,
        object_id: args.objectId ?? null,
      } as unknown as RowRow;
    },
  });
}

async function updateRow(
  rowId: string,
  patch: Partial<Pick<RowRow, 'label' | 'position' | 'object_id'>>,
): Promise<RowRow> {
  return runOptimisticUpdate<RowRow>({
    table: 'rows',
    id: rowId,
    patch: patch as Record<string, unknown>,
    label: 'label' in patch ? 'Zeile umbenennen' : 'Zeile verschieben',
    run: async () => {
      const { data, error } = await supabase
        .from('rows')
        .update(patch)
        .eq('id', rowId)
        .select()
        .single();
      if (error) throw error;
      return data as RowRow;
    },
  });
}

export function renameRow(rowId: string, label: string): Promise<RowRow> {
  return updateRow(rowId, { label });
}

// Phase 3 O.2b: Cross-Cut-Pick — Row mit existing Object verlinken
// (statt Auto-Anlage via ensureObjectForRow). Setzt label + object_id
// in einem Update-Pass.
export function renameAndLinkRow(rowId: string, label: string, objectId: string): Promise<RowRow> {
  return updateRow(rowId, { label, object_id: objectId });
}

// AU-B1 K2 (B1-B-001): gewrappte Setter fuer Object-Layer-FK. Loest die
// direkte supabase.from(...).update()-Stelle in lib/objects.ts auf —
// jetzt offline-replay-faehig, IDB-Cache wird mitgepflegt.
export function setRowObjectId(rowId: string, objectId: string | null): Promise<RowRow> {
  return updateRow(rowId, { object_id: objectId });
}

export async function setRowPosition(rowId: string, position: number): Promise<void> {
  await updateRow(rowId, { position });
}

export async function delRow(rowId: string): Promise<void> {
  await runOptimisticDelete({
    table: 'rows',
    id: rowId,
    label: 'Zeile loeschen',
    run: async () => {
      const { error } = await supabase.from('rows').delete().eq('id', rowId);
      if (error) throw error;
    },
  });
}

// ─── cols ──────────────────────────────────────────────────────
export async function addCol(args: {
  workspaceId: string;
  matrixId: string;
  label?: string;
  objectId?: string | null;
}): Promise<ColRow> {
  return runOptimisticInsert<ColRow>({
    table: 'cols',
    workspaceId: args.workspaceId,
    label: 'Spalte anlegen',
    run: async () => {
      const pos = await nextPosition('cols', args.matrixId, args.workspaceId);
      const { data, error } = await supabase
        .from('cols')
        .insert({
          workspace_id: args.workspaceId,
          matrix_id: args.matrixId,
          label: args.label ?? '',
          position: pos,
          object_id: args.objectId ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as ColRow;
    },
    buildOffline: async (id) => {
      const pos = await nextPositionFromCache(
        'cols',
        args.workspaceId,
        (r) => r.matrix_id === args.matrixId,
      );
      return {
        id,
        workspace_id: args.workspaceId,
        matrix_id: args.matrixId,
        label: args.label ?? '',
        position: pos,
        object_id: args.objectId ?? null,
      } as unknown as ColRow;
    },
  });
}

async function updateCol(
  colId: string,
  patch: Partial<Pick<ColRow, 'label' | 'position' | 'object_id'>>,
): Promise<ColRow> {
  return runOptimisticUpdate<ColRow>({
    table: 'cols',
    id: colId,
    patch: patch as Record<string, unknown>,
    label: 'label' in patch ? 'Spalte umbenennen' : 'Spalte verschieben',
    run: async () => {
      const { data, error } = await supabase
        .from('cols')
        .update(patch)
        .eq('id', colId)
        .select()
        .single();
      if (error) throw error;
      return data as ColRow;
    },
  });
}

export function renameCol(colId: string, label: string): Promise<ColRow> {
  return updateCol(colId, { label });
}

export function renameAndLinkCol(colId: string, label: string, objectId: string): Promise<ColRow> {
  return updateCol(colId, { label, object_id: objectId });
}

// AU-B1 K2 (B1-B-001): siehe setRowObjectId.
export function setColObjectId(colId: string, objectId: string | null): Promise<ColRow> {
  return updateCol(colId, { object_id: objectId });
}

export async function setColPosition(colId: string, position: number): Promise<void> {
  await updateCol(colId, { position });
}

export async function delCol(colId: string): Promise<void> {
  await runOptimisticDelete({
    table: 'cols',
    id: colId,
    label: 'Spalte loeschen',
    run: async () => {
      const { error } = await supabase.from('cols').delete().eq('id', colId);
      if (error) throw error;
    },
  });
}

// ─── cells ─────────────────────────────────────────────────────
// Cells werden lazily angelegt: erst beim ersten Mutation-Event (Feature,
// Alias, Sub-Struktur) entsteht eine Row. Die Zelle hat bis dahin nur eine
// logische Existenz als (matrix × row × col)-Koordinate.

type CellPatch = Partial<
  Pick<CellRow, 'alias' | 'features' | 'child_matrix_id' | 'board_id' | 'data'>
>;

export async function insertCell(args: {
  workspaceId: string;
  matrixId: string;
  rowId: string;
  colId: string;
  patch?: CellPatch;
}): Promise<CellRow> {
  const payload = {
    workspace_id: args.workspaceId,
    matrix_id: args.matrixId,
    row_id: args.rowId,
    col_id: args.colId,
    alias: args.patch?.alias ?? null,
    features: args.patch?.features ?? [],
    child_matrix_id: args.patch?.child_matrix_id ?? null,
    board_id: args.patch?.board_id ?? null,
    data: args.patch?.data ?? {},
  };
  return runOptimisticInsert<CellRow>({
    table: 'cells',
    workspaceId: args.workspaceId,
    label: 'Zelle anlegen',
    run: async () => {
      const { data, error } = await supabase.from('cells').insert(payload).select().single();
      if (error) throw error;
      return data as CellRow;
    },
    buildOffline: (id) => {
      const now = new Date().toISOString();
      return {
        id,
        ...payload,
        created_at: now,
        updated_at: now,
      } as unknown as CellRow;
    },
  });
}

export async function updateCell(cellId: string, patch: CellPatch): Promise<CellRow> {
  // Geht durch runOptimisticUpdate — Cell-Patches (alias, features,
  // data.infoFields, data.links etc.) sind haeufige User-Aktionen,
  // entsprechend offline-tauglich gemacht.
  return runOptimisticUpdate<CellRow>({
    table: 'cells',
    id: cellId,
    patch: patch as Record<string, unknown>,
    label: 'Zelle aktualisieren',
    run: async () => {
      const { data, error } = await supabase
        .from('cells')
        .update(patch)
        .eq('id', cellId)
        .select()
        .single();
      if (error) throw error;
      return data as CellRow;
    },
  });
}

export async function delCellRow(cellId: string): Promise<void> {
  // Cascade-Side-Effects (Sub-Matrix/Board, Cell-Daten) liegen DB-
  // seitig und werden beim Replay automatisch ausgefuehrt. Cache-
  // Cleanup wird best-effort: nur die Cell-Row weg, Sub-Strukturen
  // bleiben evtl. orphan im Cache bis zum naechsten online-Refetch.
  await runOptimisticDelete({
    table: 'cells',
    id: cellId,
    label: 'Zelle leeren',
    run: async () => {
      const { error } = await supabase.from('cells').delete().eq('id', cellId);
      if (error) throw error;
    },
  });
}

// ─── Structural Sub-Nodes (Matrix / Board an Zelle) ────────────
// Two-Step: nodes-INSERT + cells-UPSERT. Atomar wird das erst in 0e.2
// als Postgres-RPC. Fuer 0e.1.b: sequenziell, bei Fehler im 2. Schritt
// bleibt ein verwaister nodes-Eintrag — Toast informiert, Cleanup manuell.
//
// Offline (0g.2f): runOptimisticInsert legt den Node mit client-UUID
// an und queued den Insert-Spec. Der zweite Schritt (Cell-Patch mit
// child_matrix_id/board_id) laeuft ueber updateCell und ist bereits
// gewrappt — er queued einen separaten Update-Spec. Replay laeuft
// dann in FIFO: erst Node-Insert, dann Cell-Update. Der Cell-Patch
// referenziert die client-UUID, die der Server beim Replay anlegt.

async function createChildNode(args: {
  workspaceId: string;
  parentCellId: string;
  type: 'matrix' | 'board';
  label: string;
  // Phase 3 O.8: optional separates Template (mit {row.object} etc.).
  // Wenn nicht gesetzt, faellt label_template = label (1:1 Snapshot).
  labelTemplate?: string;
}): Promise<NodeRow> {
  const templateValue = args.labelTemplate ?? args.label;
  return runOptimisticInsert<NodeRow>({
    table: 'nodes',
    workspaceId: args.workspaceId,
    label: args.type === 'matrix' ? 'Sub-Matrix anlegen' : 'Sub-Board anlegen',
    run: async () => {
      const { data, error } = await supabase
        .from('nodes')
        .insert({
          workspace_id: args.workspaceId,
          type: args.type,
          label: args.label,
          label_template: templateValue,
          parent_cell_id: args.parentCellId,
          data: {},
        })
        .select()
        .single();
      if (error) throw error;
      return data as NodeRow;
    },
    buildOffline: (id) => {
      const now = new Date().toISOString();
      return {
        id,
        workspace_id: args.workspaceId,
        type: args.type,
        label: args.label,
        label_template: templateValue,
        alias: null,
        parent_cell_id: args.parentCellId,
        data: {},
        // AU-B1 K9 (B1-H-014): created_by sofort setzen, sonst zeigt der
        // NodeTree-Avatar-Stack nach Reconnect-Replay einen leeren Slot.
        created_by: currentUserIdSync(),
        created_at: now,
        updated_at: now,
      } as unknown as NodeRow;
    },
  });
}

export async function createChildMatrix(args: {
  workspaceId: string;
  parentCellId: string;
  label?: string;
  // Phase 3 O.8: optional Template (mit {row.object}/{column.object}).
  labelTemplate?: string;
}): Promise<NodeRow> {
  return createChildNode({
    workspaceId: args.workspaceId,
    parentCellId: args.parentCellId,
    type: 'matrix',
    label: args.label ?? 'Matrix',
    labelTemplate: args.labelTemplate,
  });
}

// Top-Level-Knoten anlegen (parent_cell_id = null). Heute nur durch
// Wizard / Import erzeugt — der Empty-State im Workspace-Content ruft
// das jetzt ueber + Matrix / + Board-CTA.
export async function createRootNode(args: {
  workspaceId: string;
  type: 'matrix' | 'board';
  label?: string;
  // Phase 3 O.8.N.2: optional Template (Pos 1 statisch oder eigene
  // User-Eingabe — Top-Level hat KEIN parent_cell, dynamische
  // {row.object}-Templates ergeben hier semantisch nichts und werden
  // vom TopLevelWizard auch nicht angeboten).
  labelTemplate?: string;
  // Phase 3 O.8.N.2: optional Alias (TopLevelWizard). Caller validiert
  // vorab via validateAlias.
  alias?: string | null;
}): Promise<NodeRow> {
  const label = args.label ?? (args.type === 'matrix' ? 'Neue Matrix' : 'Neues Board');
  const labelTemplate = args.labelTemplate ?? label;
  const alias = args.alias ?? null;
  return runOptimisticInsert<NodeRow>({
    table: 'nodes',
    workspaceId: args.workspaceId,
    label: args.type === 'matrix' ? 'Matrix anlegen' : 'Board anlegen',
    run: async () => {
      const { data, error } = await supabase
        .from('nodes')
        .insert({
          workspace_id: args.workspaceId,
          type: args.type,
          label,
          label_template: labelTemplate,
          alias,
          parent_cell_id: null,
          data: {},
        })
        .select()
        .single();
      if (error) throw error;
      return data as NodeRow;
    },
    buildOffline: (id) => {
      const now = new Date().toISOString();
      return {
        id,
        workspace_id: args.workspaceId,
        type: args.type,
        label,
        label_template: labelTemplate,
        alias,
        parent_cell_id: null,
        data: {},
        // AU-B1 K9 (B1-H-014): created_by sofort setzen — siehe Begruendung
        // in createChildNode.
        created_by: currentUserIdSync(),
        created_at: now,
        updated_at: now,
      } as unknown as NodeRow;
    },
  });
}

export async function createChildBoard(args: {
  workspaceId: string;
  parentCellId: string;
  label?: string;
  labelTemplate?: string;
}): Promise<NodeRow> {
  return createChildNode({
    workspaceId: args.workspaceId,
    parentCellId: args.parentCellId,
    type: 'board',
    label: args.label ?? 'Board',
    labelTemplate: args.labelTemplate,
  });
}

// "Warm-Start" fuer eine neue Top-Level-Matrix:
//   - Node anlegen
//   - 2 leere Zeilen (default labels)
//   - 2 leere Spalten (default labels)
// Cells werden NICHT vorab angelegt — sie entstehen lazy on-demand
// beim ersten Cell-Klick (existing matrix-cell-Pattern). User landet
// auf einer 2x2-Struktur, kann sofort tippen.
export async function createRootMatrixWithDefaults(args: {
  workspaceId: string;
  label?: string;
  // Phase 3 O.8.N.2: optional Template + Alias (TopLevelWizard).
  labelTemplate?: string;
  alias?: string | null;
}): Promise<NodeRow> {
  const node = await createRootNode({
    workspaceId: args.workspaceId,
    type: 'matrix',
    label: args.label,
    labelTemplate: args.labelTemplate,
    alias: args.alias,
  });
  // 2 rows + 2 cols sequenziell — RLS + FKs moegen Reihenfolge.
  // Best-effort: Fehler werden geloggt damit zumindest die Matrix
  // entsteht. User kann manuell + Zeile / + Spalte nachlegen.
  try {
    await addRow({ workspaceId: args.workspaceId, matrixId: node.id });
    await addRow({ workspaceId: args.workspaceId, matrixId: node.id });
    await addCol({ workspaceId: args.workspaceId, matrixId: node.id });
    await addCol({ workspaceId: args.workspaceId, matrixId: node.id });
  } catch (err) {
    console.warn('createRootMatrixWithDefaults seeds failed:', err);
  }
  return node;
}

// "Warm-Start" fuer ein neues Top-Level-Board:
//   - Node anlegen
//   - 3 default kb_cols ("ToDo" / "In Arbeit" / "Erledigt")
export async function createRootBoardWithDefaults(args: {
  workspaceId: string;
  label?: string;
  // Phase 3 O.8.N.2: optional Template + Alias (TopLevelWizard).
  labelTemplate?: string;
  alias?: string | null;
}): Promise<NodeRow> {
  const node = await createRootNode({
    workspaceId: args.workspaceId,
    type: 'board',
    label: args.label,
    labelTemplate: args.labelTemplate,
    alias: args.alias,
  });
  try {
    await addKbCol({ workspaceId: args.workspaceId, boardId: node.id, label: 'ToDo' });
    await addKbCol({ workspaceId: args.workspaceId, boardId: node.id, label: 'In Arbeit' });
    await addKbCol({ workspaceId: args.workspaceId, boardId: node.id, label: 'Erledigt' });
  } catch (err) {
    console.warn('createRootBoardWithDefaults seeds failed:', err);
  }
  return node;
}

// Phase 3 O.6 — Group→Matrix-Generator. Aus zwei Objekt-Listen (typisch
// Group-Members, kann auch Tag-/Parent-Filter-Resultat sein) eine neue
// Matrix mit den Objects als Achsen erzeugen.
//
// Wichtig: rows/cols werden mit object_id-FK angelegt — die Achsen sind
// also First-Class-Identitaeten, nicht losgeloeste Strings. Cells werden
// NICHT automatisch befuellt (Pfad-Enden bleiben object-frei, User-Regel).
//
// Seeds best-effort: bei Fehler bleibt zumindest der Matrix-Knoten,
// User kann manuell ergaenzen. Reihenfolge sequenziell wegen
// Position-Race im addRow/addCol-Helper.
export async function createMatrixFromGroups(args: {
  workspaceId: string;
  label: string;
  rowObjects: Array<{ id: string; label: string }>;
  colObjects: Array<{ id: string; label: string }>;
}): Promise<NodeRow> {
  const node = await createRootNode({
    workspaceId: args.workspaceId,
    type: 'matrix',
    label: args.label,
  });
  try {
    for (const r of args.rowObjects) {
      await addRow({
        workspaceId: args.workspaceId,
        matrixId: node.id,
        label: r.label,
        objectId: r.id,
      });
    }
    for (const c of args.colObjects) {
      await addCol({
        workspaceId: args.workspaceId,
        matrixId: node.id,
        label: c.label,
        objectId: c.id,
      });
    }
  } catch (err) {
    console.warn('createMatrixFromGroups seeds failed:', err);
  }
  return node;
}

// Cascade via FK ON DELETE CASCADE: alle Kinder (rows/cols/cells/...) gehen mit.
// Read-modify-write auf nodes.data, parallel zu mutateCellData.
// Gleiche Semantik: paralleler Writer mit anderen Keys in node.data
// ueberschreibt nichts Fremdes, weil wir das Gesamt-Object mergen.
async function mutateNodeData<T>(
  nodeId: string,
  mutator: (data: Record<string, unknown>) => { data: Record<string, unknown>; result: T },
): Promise<T> {
  // Read mit Offline-Fallback aus dem Cache, analog zu mutateCellData.
  let nodeData: Record<string, unknown> = {};
  try {
    const { data: cur, error: readErr } = await supabase
      .from('nodes')
      .select('data')
      .eq('id', nodeId)
      .single();
    if (readErr) throw readErr;
    nodeData = (cur?.data ?? {}) as Record<string, unknown>;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getById<NodeRow>('nodes', nodeId);
    if (!cached) throw err;
    nodeData = ((cached as { data?: unknown }).data ?? {}) as Record<string, unknown>;
  }
  const { data: nextData, result } = mutator(nodeData);
  // Write geht ueber den Wrapper, indem wir runOptimisticUpdate
  // aufrufen — damit funktioniert auch setNodeDescription offline.
  await runOptimisticUpdate<NodeRow>({
    table: 'nodes',
    id: nodeId,
    patch: { data: nextData },
    label: 'Beschreibung speichern',
    run: async () => {
      const { data: updated, error: writeErr } = await supabase
        .from('nodes')
        .update({ data: nextData })
        .eq('id', nodeId)
        .select()
        .single();
      if (writeErr) throw writeErr;
      return updated as NodeRow;
    },
  });
  return result;
}

export async function setNodeDescription(nodeId: string, description: string): Promise<void> {
  await mutateNodeData(nodeId, (data) => ({
    data: { ...data, description: description ?? '' },
    result: undefined,
  }));
}

export async function deleteNode(nodeId: string): Promise<void> {
  // Cascade-Side-Effects (rows/cols/cells/kb_*/checklists/items/links)
  // sind beim DB-Server. Wir queue'n nur den Top-Level-Delete; bei
  // Replay raeumt der Server cascadiert. Cache-seitig entfernen wir
  // primaer den Node — orphane Sub-Rows bleiben im Cache liegen, bis
  // beim naechsten online-Refetch sauberer Stand zurueckkommt.
  await runOptimisticDelete({
    table: 'nodes',
    id: nodeId,
    label: 'Element loeschen',
    run: async () => {
      const { error } = await supabase.from('nodes').delete().eq('id', nodeId);
      if (error) throw error;
    },
  });
}

export async function renameNode(
  nodeId: string,
  label: string,
  template?: string,
): Promise<NodeRow> {
  // Phase 3 O.8.L: User-Rename via Plain-Input (Sidebar/NodeTree) ist
  // explicit Template-Override. Wir schreiben label UND label_template
  // mit dem getippten String — sonst rendert der Resolver weiterhin
  // den dynamischen Template (z.B. {row.object}/{column.object}) und
  // ueberschreibt das, was der User gerade eingegeben hat.
  //
  // Phase 3 O.8.N.1: Optional `template` kann einen *anderen* Template
  // setzen (z.B. dynamisch '{row.object}'); `label` ist dann der
  // resolved Snapshot. Genutzt vom NewCellWizard im Edit-Modus.
  const tpl = template ?? label;
  return runOptimisticUpdate<NodeRow>({
    table: 'nodes',
    id: nodeId,
    patch: { label, label_template: tpl },
    label: 'Element umbenennen',
    run: async () => {
      const { data, error } = await supabase
        .from('nodes')
        .update({ label, label_template: tpl })
        .eq('id', nodeId)
        .select()
        .single();
      if (error) throw error;
      return data as NodeRow;
    },
  });
}

// ─── Kanban-Spalten ────────────────────────────────────────────
export async function addKbCol(args: {
  workspaceId: string;
  boardId: string;
  label?: string;
  color?: string | null;
  objectId?: string | null;
}): Promise<KbColRow> {
  return runOptimisticInsert<KbColRow>({
    table: 'kb_cols',
    workspaceId: args.workspaceId,
    label: 'Kanban-Spalte anlegen',
    run: async () => {
      const pos = await nextBoardPosition('kb_cols', args.boardId, args.workspaceId);
      const { data, error } = await supabase
        .from('kb_cols')
        .insert({
          workspace_id: args.workspaceId,
          board_id: args.boardId,
          label: args.label ?? '',
          position: pos,
          color: args.color ?? null,
          object_id: args.objectId ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as KbColRow;
    },
    buildOffline: async (id) => {
      const pos = await nextPositionFromCache(
        'kb_cols',
        args.workspaceId,
        (r) => r.board_id === args.boardId,
      );
      return {
        id,
        workspace_id: args.workspaceId,
        board_id: args.boardId,
        label: args.label ?? '',
        position: pos,
        color: args.color ?? null,
        object_id: args.objectId ?? null,
      } as unknown as KbColRow;
    },
  });
}

async function updateKbCol(
  colId: string,
  patch: Partial<Pick<KbColRow, 'label' | 'color' | 'position' | 'object_id'>>,
): Promise<KbColRow> {
  return runOptimisticUpdate<KbColRow>({
    table: 'kb_cols',
    id: colId,
    patch: patch as Record<string, unknown>,
    label:
      'label' in patch
        ? 'Kanban-Spalte umbenennen'
        : 'color' in patch
          ? 'Spaltenfarbe setzen'
          : 'Spalte verschieben',
    run: async () => {
      const { data, error } = await supabase
        .from('kb_cols')
        .update(patch)
        .eq('id', colId)
        .select()
        .single();
      if (error) throw error;
      return data as KbColRow;
    },
  });
}

export function renameKbCol(colId: string, label: string): Promise<KbColRow> {
  return updateKbCol(colId, { label });
}

export function renameAndLinkKbCol(
  colId: string,
  label: string,
  objectId: string,
): Promise<KbColRow> {
  return updateKbCol(colId, { label, object_id: objectId });
}

// AU-B1 K2 (B1-B-001): siehe setRowObjectId.
export function setKbColObjectId(colId: string, objectId: string | null): Promise<KbColRow> {
  return updateKbCol(colId, { object_id: objectId });
}

export function setKbColColor(colId: string, color: string | null): Promise<KbColRow> {
  return updateKbCol(colId, { color });
}

export async function setKbColPosition(colId: string, position: number): Promise<void> {
  await updateKbCol(colId, { position });
}

export async function delKbCol(colId: string): Promise<void> {
  await runOptimisticDelete({
    table: 'kb_cols',
    id: colId,
    label: 'Kanban-Spalte loeschen',
    run: async () => {
      const { error } = await supabase.from('kb_cols').delete().eq('id', colId);
      if (error) throw error;
    },
  });
}

// ─── Karten ────────────────────────────────────────────────────
// Phase 4 T.1.D: Karten leben als (TaskRow, TaskManifestationRow{kind:
// 'kanban'}). Diese Helper kapseln die Kombination und projizieren die
// Antwort auf die Legacy-KbCardRow-Form fuer bestehende UI-Konsumenten
// (BoardView/CardOverlay; Migration auf compound type folgt T.1.D5).
//
// Schema-Mapping siehe lib/task-projections.ts.

// Naechste Position einer kanban-Manifestation in einer Spalte. Online:
// max(position) der Manifestations + 1. Offline: max aus IDB-Cache.
async function nextManifPosition(containerId: string, workspaceId: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('atom_manifestations')
      .select('position')
      .eq('container_id', containerId)
      .eq('atom_type', 'task')
      .eq('kind', 'kanban')
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: false })
      .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? (data[0] as { position: number }).position + 1 : 0;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return nextPositionFromCache(
      'atom_manifestations',
      workspaceId,
      (r) => r.atom_type === 'task' && r.kind === 'kanban' && r.container_id === containerId,
    );
  }
}

// Findet die kanban-Manifestation einer Task. Wird vor Move/Position-
// Updates gebraucht, weil mutations.ts die Manif-Id explizit kennen
// muss (cardId == taskId nach Migration 041, manif.id ist neu).
async function findKanbanManif(taskId: string): Promise<TaskManifestationRow | null> {
  try {
    const { data, error } = await supabase
      .from('atom_manifestations')
      .select('*')
      .eq('atom_type', 'task')
      .eq('atom_id', taskId)
      .eq('kind', 'kanban')
      .maybeSingle();
    if (error) throw error;
    return (data as TaskManifestationRow) ?? null;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // Offline: Task im IDB lookup um workspace_id zu lernen, dann manif filtern.
    const task = await getById<TaskRow>('tasks', taskId);
    if (!task) return null;
    const cached = await getByWorkspace<TaskManifestationRow>(
      'atom_manifestations',
      task.workspace_id,
    );
    return (
      cached.find((m) => m.atom_type === 'task' && m.atom_id === taskId && m.kind === 'kanban') ??
      null
    );
  }
}

async function fetchTaskFresh(taskId: string): Promise<TaskRow | null> {
  try {
    const { data, error } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
    if (error) throw error;
    return (data as TaskRow) ?? null;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return getById<TaskRow>('tasks', taskId);
  }
}

export async function addCard(args: {
  workspaceId: string;
  boardId: string;
  colId: string;
  name?: string;
}): Promise<KbCardRow> {
  const pos = await nextManifPosition(args.colId, args.workspaceId);
  const task = await createTask(args.workspaceId, { label: args.name ?? '' });
  const manif = await addManifestation(args.workspaceId, {
    atom_id: task.id,
    kind: 'kanban',
    container_id: args.colId,
    position: pos,
    display_meta: { board_id: args.boardId },
  });
  return taskAndManifToCard(task, manif);
}

// Transform-to-Card: legt eine neue Karte auf dem Ziel-Board/Col an,
// deren `checklist_ref` auf eine existierende Standalone-Checkliste
// zeigt. Die Checkliste bleibt unangetastet — sie ist jetzt zusaetzlich
// ueber die Karte auffindbar. Mehrfach-Transform ist erlaubt (mehrere
// Karten auf dieselbe Checkliste sind DB-technisch ok).
//
// Wichtig: der DB-CHECK (Migration 002) verbietet, dass eine Karte
// sowohl `checklist_ref` als auch ein Inline-`checklist` traegt. Beim
// Transform setzen wir nur `checklist_ref`, das Inline-Feld bleibt
// implizit NULL.
export async function createCardFromChecklist(args: {
  workspaceId: string;
  checklistId: string;
  name: string;
  targetBoardId: string;
  targetColId: string;
}): Promise<KbCardRow> {
  const pos = await nextManifPosition(args.targetColId, args.workspaceId);
  // checklist_ref liegt in tasks.attrs (siehe task-projections.ts).
  const task = await createTask(args.workspaceId, {
    label: args.name,
    attrs: { checklist_ref: args.checklistId },
  });
  const manif = await addManifestation(args.workspaceId, {
    atom_id: task.id,
    kind: 'kanban',
    container_id: args.targetColId,
    position: pos,
    display_meta: { board_id: args.targetBoardId },
  });
  return taskAndManifToCard(task, manif);
}

// Update-Pfad einer Karte. Splittet den Patch in Task-, Manifestation-
// und Attrs-Teile (siehe lib/task-projections.ts) und ruft die jeweilige
// Mutation in lib/tasks.ts. Reihenfolge: zuerst Task (haeufigster Fall),
// dann Manifestation falls col_id/position/board_id geaendert wurden.
async function updateCard(cardId: string, patch: CardPatchInput): Promise<KbCardRow> {
  const split = splitCardPatch(patch);

  let updatedTask: TaskRow | null = null;
  if (split.hasTaskChange || split.hasAttrsChange) {
    const taskPatch: Record<string, unknown> = { ...split.taskPatch };
    if (split.hasAttrsChange && split.attrsMerge) {
      // attrs ist Read-Modify-Write: aktuellen Stand lesen, mergen, schreiben.
      const fresh = await fetchTaskFresh(cardId);
      const currentAttrs = (fresh?.attrs ?? {}) as Record<string, unknown>;
      taskPatch.attrs = mergeAttrs(currentAttrs, split.attrsMerge);
    }
    updatedTask = await updateTask(cardId, taskPatch);
  }

  let updatedManif: TaskManifestationRow | null = null;
  if (split.hasManifChange) {
    const manif = await findKanbanManif(cardId);
    if (!manif) {
      throw new Error(`[mutations] kein kanban-Manifest fuer task ${cardId}`);
    }
    const manifPatch: Record<string, unknown> = { ...split.manifPatch };
    if ('__board_id' in manifPatch) {
      const newBoardId = manifPatch.__board_id as string;
      manifPatch.__board_id = undefined;
      const dm = (manif.display_meta ?? {}) as Record<string, unknown>;
      manifPatch.display_meta = { ...dm, board_id: newBoardId };
    }
    updatedManif = await updateManifestation(manif.id, manifPatch);
  }

  // Final-Projection: bevorzugt frische Refs aus den Updates; fallback
  // auf erneutes Lesen der nicht-angefassten Schicht.
  const finalTask = updatedTask ?? (await fetchTaskFresh(cardId));
  const finalManif = updatedManif ?? (await findKanbanManif(cardId));
  if (!finalTask || !finalManif) {
    throw new Error(`[mutations] task ${cardId} oder kanban-Manifest fehlt nach update`);
  }
  return taskAndManifToCard(finalTask, finalManif);
}

export function renameCard(cardId: string, name: string): Promise<KbCardRow> {
  return updateCard(cardId, { name });
}

export function toggleCardDone(cardId: string, done: boolean): Promise<KbCardRow> {
  return updateCard(cardId, { done });
}

export function setCardNote(cardId: string, note: string): Promise<KbCardRow> {
  return updateCard(cardId, { note });
}

export function setCardAlias(cardId: string, alias: string | null): Promise<KbCardRow> {
  return updateCard(cardId, { alias });
}

export function setCardDeadline(cardId: string, deadline: string | null): Promise<KbCardRow> {
  return updateCard(cardId, { deadline });
}

export function setCardPriority(cardId: string, priority: number | null): Promise<KbCardRow> {
  return updateCard(cardId, { priority });
}

export function setCardTags(cardId: string, tags: string[]): Promise<KbCardRow> {
  return updateCard(cardId, { tags });
}

export function setCardWho(cardId: string, who: string[]): Promise<KbCardRow> {
  return updateCard(cardId, { who });
}

export function setCardRecur(cardId: string, recur: CardRecur | null): Promise<KbCardRow> {
  return updateCard(cardId, { recur });
}

export function setCardArchived(cardId: string, archived: boolean): Promise<KbCardRow> {
  return updateCard(cardId, { archived });
}

export function setCardColor(cardId: string, color: string | null): Promise<KbCardRow> {
  return updateCard(cardId, { color });
}

export async function setCardDoneOccurrences(
  cardId: string,
  occurrences: string[],
): Promise<KbCardRow> {
  return updateCard(cardId, { done_occurrences: occurrences });
}

// Move: innerhalb derselben Spalte oder cross-column. Bei cross-column
// bekommt die Karte Position ans Ende der Ziel-Spalte (kein Reorder
// innerhalb — kommt in 0e.1.h).
export async function moveCard(args: {
  cardId: string;
  boardId: string;
  workspaceId: string;
  toColId: string;
}): Promise<KbCardRow> {
  const pos = await nextManifPosition(args.toColId, args.workspaceId);
  return updateCard(args.cardId, { col_id: args.toColId, position: pos });
}

export async function setCardPosition(cardId: string, position: number): Promise<void> {
  await updateCard(cardId, { position });
}

// Cross-Col-Move mit exakter Position. Ein Update statt zweier. Wird
// vom Drag-Reorder gerufen, wenn die Ziel-Spalte von der Quell-Spalte
// abweicht — die umliegenden Karten werden separat durch setCardPosition
// neu nummeriert, damit die gewaehlte Slot-Position passt.
export async function setCardColAndPosition(
  cardId: string,
  toColId: string,
  position: number,
): Promise<void> {
  await updateCard(cardId, { col_id: toColId, position });
}

// Cross-Board-Move: board_id + col_id + position in einem Update.
// Separat von setCardColAndPosition, weil der FK-Scope sich aendert
// und die Aufrufer typischerweise zuerst die Ziel-Spalte auflosen
// muessen (erste/aktive Spalte des Ziel-Boards).
export async function moveCardToBoard(
  cardId: string,
  toBoardId: string,
  toColId: string,
  position: number,
): Promise<void> {
  await updateCard(cardId, { board_id: toBoardId, col_id: toColId, position });
}

export async function delCard(cardId: string): Promise<void> {
  // deleteTask cascadet auch die Manifestation (DB ON DELETE CASCADE).
  // Gibt einen TaskSnapshot zurueck — die existierenden Caller verwenden
  // Undo nicht via delCard direkt (sie haben eigene Snapshots), deshalb
  // verwerfen wir den Rueckgabewert.
  await deleteTask(cardId);
}

// ─── Checklisten (standalone am Board) ─────────────────────────
// Zell-attached Checklisten haengen via cell_id (statt board_id) —
// siehe addCellChecklist unten. DB-XOR-Constraint stellt sicher, dass
// nie beides zugleich gesetzt ist.
export async function addChecklist(args: {
  workspaceId: string;
  boardId: string;
  label?: string;
}): Promise<ChecklistRow> {
  return runOptimisticInsert<ChecklistRow>({
    table: 'checklists',
    workspaceId: args.workspaceId,
    label: 'Checkliste anlegen',
    run: async () => {
      const pos = await nextBoardPosition('checklists', args.boardId, args.workspaceId);
      const { data, error } = await supabase
        .from('checklists')
        .insert({
          workspace_id: args.workspaceId,
          board_id: args.boardId,
          label: args.label ?? '',
          // Phase 3 O.8: Template-Spalte (Snapshot = label).
          label_template: args.label ?? '',
          position: pos,
        })
        .select()
        .single();
      if (error) throw error;
      return data as ChecklistRow;
    },
    buildOffline: async (id) => {
      const pos = await nextPositionFromCache(
        'checklists',
        args.workspaceId,
        (r) => r.board_id === args.boardId,
      );
      const now = new Date().toISOString();
      return {
        id,
        workspace_id: args.workspaceId,
        board_id: args.boardId,
        cell_id: null,
        label: args.label ?? '',
        label_template: args.label ?? '',
        position: pos,
        recur: null,
        close_mode: null,
        action: null,
        history: null,
        alias: null,
        created_at: now,
        updated_at: now,
      } as unknown as ChecklistRow;
    },
  });
}

// Zellen-Checkliste: cell_id statt board_id. Position innerhalb der
// Zelle (eigene Reihenfolge pro cell_id).
async function nextCellChecklistPosition(cellId: string, workspaceId: string): Promise<number> {
  const { data, error } = await supabase
    .from('checklists')
    .select('position')
    .eq('cell_id', cellId)
    .eq('workspace_id', workspaceId)
    .order('position', { ascending: false })
    .limit(1);
  if (error) throw error;
  const top = data && data.length > 0 ? (data[0] as { position: number }).position : -1;
  return top + 1;
}

export async function addCellChecklist(args: {
  workspaceId: string;
  cellId: string;
  label?: string;
  // Phase 3 O.8: optional Template (mit {row.object}/{column.object}).
  labelTemplate?: string;
}): Promise<ChecklistRow> {
  const labelValue = args.label ?? '';
  const templateValue = args.labelTemplate ?? labelValue;
  return runOptimisticInsert<ChecklistRow>({
    table: 'checklists',
    workspaceId: args.workspaceId,
    label: 'Zellen-Checkliste anlegen',
    run: async () => {
      const pos = await nextCellChecklistPosition(args.cellId, args.workspaceId);
      const { data, error } = await supabase
        .from('checklists')
        .insert({
          workspace_id: args.workspaceId,
          cell_id: args.cellId,
          label: labelValue,
          label_template: templateValue,
          position: pos,
        })
        .select()
        .single();
      if (error) throw error;
      return data as ChecklistRow;
    },
    buildOffline: async (id) => {
      const pos = await nextPositionFromCache(
        'checklists',
        args.workspaceId,
        (r) => r.cell_id === args.cellId,
      );
      const now = new Date().toISOString();
      return {
        id,
        workspace_id: args.workspaceId,
        board_id: null,
        cell_id: args.cellId,
        label: labelValue,
        label_template: templateValue,
        position: pos,
        recur: null,
        close_mode: null,
        action: null,
        history: null,
        alias: null,
        created_at: now,
        updated_at: now,
      } as unknown as ChecklistRow;
    },
  });
}

type ChecklistPatch = Partial<
  Pick<
    ChecklistRow,
    'label' | 'label_template' | 'alias' | 'close_mode' | 'recur' | 'action' | 'history'
  >
>;

async function updateChecklist(clId: string, patch: ChecklistPatch): Promise<ChecklistRow> {
  return runOptimisticUpdate<ChecklistRow>({
    table: 'checklists',
    id: clId,
    patch: patch as Record<string, unknown>,
    label: 'label' in patch ? 'Liste umbenennen' : 'Liste aktualisieren',
    run: async () => {
      const { data, error } = await supabase
        .from('checklists')
        .update(patch)
        .eq('id', clId)
        .select()
        .single();
      if (error) throw error;
      return data as ChecklistRow;
    },
  });
}

export function renameChecklist(
  clId: string,
  label: string,
  template?: string,
): Promise<ChecklistRow> {
  // Phase 3 O.8.L: User-Rename schreibt label + label_template
  // (Plain-Override, siehe renameNode-Begruendung).
  // Phase 3 O.8.N.1: Optional `template` separat (Wizard-Edit setzt
  // dynamische Templates mit Snapshot-label).
  return updateChecklist(clId, { label, label_template: template ?? label });
}

export function setChecklistAlias(clId: string, alias: string | null): Promise<ChecklistRow> {
  return updateChecklist(clId, { alias });
}

export function setChecklistCloseMode(
  clId: string,
  mode: ChecklistCloseMode,
): Promise<ChecklistRow> {
  return updateChecklist(clId, { close_mode: mode });
}

export async function delChecklist(clId: string): Promise<void> {
  await runOptimisticDelete({
    table: 'checklists',
    id: clId,
    label: 'Checkliste loeschen',
    run: async () => {
      const { error } = await supabase.from('checklists').delete().eq('id', clId);
      if (error) throw error;
    },
  });
}

// ─── Checklist-Items ───────────────────────────────────────────
// Phase 4 T.1.D: Items leben als (TaskRow, TaskManifestationRow{kind:
// 'checklist'}). Helper kapseln die Kombination, projizieren auf
// Legacy-ChecklistItemRow fuer ChecklistPanel/CellChecklistsPage.

async function nextItemPosition(checklistId: string, workspaceId: string): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('atom_manifestations')
      .select('position')
      .eq('container_id', checklistId)
      .eq('atom_type', 'task')
      .eq('kind', 'checklist')
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: false })
      .limit(1);
    if (error) throw error;
    return data && data.length > 0 ? (data[0] as { position: number }).position + 1 : 0;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    return nextPositionFromCache(
      'atom_manifestations',
      workspaceId,
      (r) => r.atom_type === 'task' && r.kind === 'checklist' && r.container_id === checklistId,
    );
  }
}

async function findChecklistManif(taskId: string): Promise<TaskManifestationRow | null> {
  try {
    const { data, error } = await supabase
      .from('atom_manifestations')
      .select('*')
      .eq('atom_type', 'task')
      .eq('atom_id', taskId)
      .eq('kind', 'checklist')
      .maybeSingle();
    if (error) throw error;
    return (data as TaskManifestationRow) ?? null;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const task = await getById<TaskRow>('tasks', taskId);
    if (!task) return null;
    const cached = await getByWorkspace<TaskManifestationRow>(
      'atom_manifestations',
      task.workspace_id,
    );
    return (
      cached.find(
        (m) => m.atom_type === 'task' && m.atom_id === taskId && m.kind === 'checklist',
      ) ?? null
    );
  }
}

export async function addChecklistItem(args: {
  workspaceId: string;
  checklistId: string;
  text?: string;
  level?: 0 | 1 | 2;
}): Promise<ChecklistItemRow> {
  const pos = await nextItemPosition(args.checklistId, args.workspaceId);
  const task = await createTask(args.workspaceId, { label: args.text ?? '' });
  const manif = await addManifestation(args.workspaceId, {
    atom_id: task.id,
    kind: 'checklist',
    container_id: args.checklistId,
    position: pos,
    level: args.level ?? 0,
  });
  return taskAndManifToItem(task, manif);
}

// Close-Snapshot fuer History: liest die aktuelle history, prepended
// einen neuen Snapshot mit closedAt=now + kopierten Items, schreibt
// zurueck. Nicht concurrency-safe — zwei parallele Closes verlieren
// einen Snapshot. Fuer Single-User-Fall akzeptabel.
//
// Parameter items: der aktuelle Item-Stand, wie ihn das ChecklistPanel
// kennt. Wir speichern nur {text, done, level} — position ist fuer
// Snapshots irrelevant (die Reihenfolge folgt dem uebergebenen Array).
// Liest checklists.history mit Offline-Fallback aus dem Cache. Wird
// von saveChecklistSnapshot/delChecklistSnapshot/restoreChecklist-
// Snapshot benutzt, damit alle drei JSONB-history-Mutationen konsistent
// online wie offline laufen. Concurrency-Hinweis: zwei parallele
// Writer auf dieselbe history verlieren einen Snapshot — dieses
// Risiko existiert online wie offline; akzeptiert.
async function readChecklistHistory(
  checklistId: string,
  workspaceId: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    const { data: cur, error: readErr } = await supabase
      .from('checklists')
      .select('history')
      .eq('id', checklistId)
      .eq('workspace_id', workspaceId)
      .single();
    if (readErr) throw readErr;
    return Array.isArray((cur as { history: unknown[] } | null)?.history)
      ? ((cur as { history: unknown[] }).history as Array<Record<string, unknown>>)
      : [];
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getById<ChecklistRow>('checklists', checklistId);
    if (!cached) throw err;
    const h = (cached as { history?: unknown }).history;
    return Array.isArray(h) ? (h as Array<Record<string, unknown>>) : [];
  }
}

export async function saveChecklistSnapshot(args: {
  workspaceId: string;
  checklistId: string;
  items: Array<{ text: string; done: boolean; level: 0 | 1 | 2 }>;
}): Promise<void> {
  const history = await readChecklistHistory(args.checklistId, args.workspaceId);
  const snapshot = {
    closedAt: new Date().toISOString(),
    items: args.items.map((it) => ({ text: it.text, done: it.done, level: it.level })),
  };
  const next = [snapshot, ...history];
  // Write durch updateChecklist (gewrappt) — JSONB-history-Update geht
  // damit offline durch denselben Optimistic-Cache-Patch.
  await updateChecklist(args.checklistId, {
    history: next as unknown as ChecklistRow['history'],
  });
}

// checklist.action als jsonb setzen (oder NULL bei type='none'). Der
// Wert ist generisch Record<string, unknown> — die typisierte Form lebt
// in lib/checklist-action.ts. Geht durch updateChecklist → safe-mutation,
// damit Offline-Edits (Close-Action umkonfigurieren ohne Netz) als Spec
// in die Queue landen statt silent zu scheitern.
export async function setChecklistAction(
  checklistId: string,
  action: Record<string, unknown> | null,
): Promise<void> {
  await updateChecklist(checklistId, {
    action: action as ChecklistRow['action'],
  });
}

// checklist.recur als jsonb setzen (oder NULL fuer Einmal-Checkliste).
// Das Close-Verhalten (Items reset vs delete) liest dieses Feld via
// isRecurring() — sobald recur ein Objekt mit Type ist, gilt die Liste
// als wiederkehrend. Wrapper-gewrappt analog setChecklistAction.
export async function setChecklistRecur(
  checklistId: string,
  recur: Record<string, unknown> | null,
): Promise<void> {
  await updateChecklist(checklistId, {
    recur: recur as ChecklistRow['recur'],
  });
}

// Close-Action auf der Checkliste anwenden, abhaengig vom recur-Feld:
//   - non-recurring: alle Items loeschen (ein DELETE);
//   - recurring:     alle Items auf done=false zuruecksetzen.
// Wird nach dem saveChecklistSnapshot aus dem ChecklistPanel gerufen.
//
// Konformitaets-Notiz zu Arbeitsprinzip 17 (`docs/audit/A1`):
// Der Online-Pfad ist ein bewusster Bulk-Shortcut ausserhalb von
// safe-mutation.ts — analog zu `workspace-reset.ts:clearBoardContents`.
// Begruendung: bei einer Checkliste mit 100 Items waeren 100 einzelne
// PATCH/DELETE-Requests ein realer Perf-Hit. Sicherheit kommt durch
// Idempotenz: bricht das Netz waehrend des Bulk-Calls, faellt der
// catch auf den Item-fuer-Item-Wrapper-Pfad — beim Reconnect-Replay
// werden bereits durchgefuehrte Operationen erneut ausgefuehrt
// (`updateItem(id, {done:false})` und `delChecklistItem` sind beide
// idempotent). Konsistenz kann nicht brechen.
export async function applyChecklistClose(args: {
  workspaceId: string;
  checklistId: string;
  recurring: boolean;
}): Promise<void> {
  // Phase 4 T.1.D: Bulk-Operation auf tasks (recurring) bzw. tasks via
  // manifestation-cascade (delete). Beim Delete loeschen wir die Tasks —
  // das cascadet auf die Manifestation. Beim Recurring updaten wir die
  // Tasks per kind+container_id Lookup ueber manifestations.
  try {
    // Erst die Tasks ermitteln, deren Manifestation in dieser Liste lebt.
    const { data: manifData, error: manifErr } = await supabase
      .from('atom_manifestations')
      .select('atom_id')
      .eq('container_id', args.checklistId)
      .eq('atom_type', 'task')
      .eq('kind', 'checklist')
      .eq('workspace_id', args.workspaceId);
    if (manifErr) throw manifErr;
    const taskIds = (manifData ?? []).map((m: { atom_id: string }) => m.atom_id);
    if (taskIds.length === 0) return;

    if (args.recurring) {
      const { error } = await supabase
        .from('tasks')
        .update({ status: 'open' })
        .in('id', taskIds)
        .eq('workspace_id', args.workspaceId);
      if (error) throw error;
      return;
    }
    // Non-recurring: Tasks loeschen → CASCADE killt manifestations.
    const { error } = await supabase
      .from('tasks')
      .delete()
      .in('id', taskIds)
      .eq('workspace_id', args.workspaceId);
    if (error) throw error;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // Offline-Fallback: aus dem Cache die Manifestations dieser Liste
    // ziehen und einzeln durch den Wrapper schicken.
    const manifs = await getByWorkspace<TaskManifestationRow>(
      'atom_manifestations',
      args.workspaceId,
    );
    const own = manifs.filter(
      (m) =>
        m.atom_type === 'task' && m.kind === 'checklist' && m.container_id === args.checklistId,
    );
    if (args.recurring) {
      for (const m of own) {
        await updateTask(m.atom_id, { status: 'open' });
      }
    } else {
      for (const m of own) {
        await deleteTask(m.atom_id);
      }
    }
  }
}

// Einzelnen Snapshot aus der History entfernen (identifiziert per
// closedAt-Timestamp — bei uns eindeutig genug, da ISO-Timestamp mit
// Millisekunden).
export async function delChecklistSnapshot(args: {
  workspaceId: string;
  checklistId: string;
  closedAt: string;
}): Promise<void> {
  const history = await readChecklistHistory(args.checklistId, args.workspaceId);
  const next = history.filter((s) => s.closedAt !== args.closedAt);
  await updateChecklist(args.checklistId, {
    history: next as unknown as ChecklistRow['history'],
  });
}

// Undo-Pendant zu delChecklistSnapshot: einzelnen Snapshot wieder in
// die History einreihen. Neu-Prepend statt Chronologie-erhalten — das
// reicht fuer den Undo-Fall und vermeidet einen zusaetzlichen Sort-
// Durchlauf. Falls derselbe closedAt schon drin ist (race), wird der
// neue ignoriert.
export async function restoreChecklistSnapshot(args: {
  workspaceId: string;
  checklistId: string;
  snapshot: { closedAt: string; items: unknown[] };
}): Promise<void> {
  const history = await readChecklistHistory(args.checklistId, args.workspaceId);
  if (history.some((s) => s.closedAt === args.snapshot.closedAt)) return;
  const next = [args.snapshot as unknown as Record<string, unknown>, ...history];
  await updateChecklist(args.checklistId, {
    history: next as unknown as ChecklistRow['history'],
  });
}

// Bulk-Insert mehrerer Items am Ende der Checkliste. Wird vom Paste-
// Popup aufgerufen. Einzelne create-Calls in einer Schleife waeren
// 10-50 Roundtrips bei grossen Pastes; deshalb Batch.
//
// Phase 4 T.1.D: Wir muessen pro Item Task + Manifestation anlegen.
// Online machen wir das mit zwei Bulk-Inserts (1 Roundtrip pro Tabelle).
// Offline laeuft pro-Item ueber addChecklistItem.
export async function bulkAddChecklistItems(args: {
  workspaceId: string;
  checklistId: string;
  items: Array<{ text: string; level: 0 | 1 | 2 }>;
}): Promise<ChecklistItemRow[]> {
  if (args.items.length === 0) return [];
  try {
    const startPos = await nextItemPosition(args.checklistId, args.workspaceId);
    // 1. Bulk-Insert tasks.
    const taskPayload = args.items.map((it) => ({
      workspace_id: args.workspaceId,
      label: it.text,
      attrs: { legacy_kind: 'checklist_item' },
    }));
    const { data: taskData, error: taskErr } = await supabase
      .from('tasks')
      .insert(taskPayload)
      .select();
    if (taskErr) throw taskErr;
    const tasks = (taskData ?? []) as TaskRow[];
    if (tasks.length !== args.items.length) {
      throw new Error('[mutations] bulkAddChecklistItems: task-count mismatch');
    }
    // 2. Bulk-Insert manifestations (eine pro task, gleiche Reihenfolge).
    const manifPayload = tasks.map((t, i) => ({
      atom_type: 'task' as const,
      atom_id: t.id,
      workspace_id: args.workspaceId,
      kind: 'checklist',
      container_id: args.checklistId,
      level: args.items[i].level,
      position: startPos + i,
    }));
    const { data: manifData, error: manifErr } = await supabase
      .from('atom_manifestations')
      .insert(manifPayload)
      .select();
    if (manifErr) throw manifErr;
    const manifs = (manifData ?? []) as TaskManifestationRow[];
    // 3. Projizieren.
    return tasks.map((t, i) => taskAndManifToItem(t, manifs[i]));
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const out: ChecklistItemRow[] = [];
    for (const it of args.items) {
      const row = await addChecklistItem({
        workspaceId: args.workspaceId,
        checklistId: args.checklistId,
        text: it.text,
        level: it.level,
      });
      out.push(row);
    }
    return out;
  }
}

async function updateItem(itemId: string, patch: ItemPatchInput): Promise<ChecklistItemRow> {
  const split = splitItemPatch(patch);

  let updatedTask: TaskRow | null = null;
  if (split.hasTaskChange) {
    updatedTask = await updateTask(itemId, split.taskPatch);
  }

  let updatedManif: TaskManifestationRow | null = null;
  if (split.hasManifChange) {
    const manif = await findChecklistManif(itemId);
    if (!manif) {
      throw new Error(`[mutations] kein checklist-Manifest fuer task ${itemId}`);
    }
    updatedManif = await updateManifestation(manif.id, split.manifPatch);
  }

  const finalTask = updatedTask ?? (await fetchTaskFresh(itemId));
  const finalManif = updatedManif ?? (await findChecklistManif(itemId));
  if (!finalTask || !finalManif) {
    throw new Error(`[mutations] task ${itemId} oder checklist-Manifest fehlt nach update`);
  }
  return taskAndManifToItem(finalTask, finalManif);
}

export function renameChecklistItem(itemId: string, text: string): Promise<ChecklistItemRow> {
  return updateItem(itemId, { text });
}

export function toggleChecklistItemDone(itemId: string, done: boolean): Promise<ChecklistItemRow> {
  return updateItem(itemId, { done });
}

export function setChecklistItemLevel(itemId: string, level: 0 | 1 | 2): Promise<ChecklistItemRow> {
  return updateItem(itemId, { level });
}

export function setChecklistItemPosition(
  itemId: string,
  position: number,
): Promise<ChecklistItemRow> {
  return updateItem(itemId, { position });
}

export async function delChecklistItem(itemId: string): Promise<void> {
  // deleteTask cascadet die Manifestation (DB ON DELETE CASCADE).
  await deleteTask(itemId);
}

// ─── Info-Felder (cell.data.infoFields[]) ──────────────────────
// Read-modify-write auf cell.data. Jede Mutation liest die Zelle frisch,
// merged das Array und schreibt zurueck. Race-Fenster ist eng; ein
// paralleler Writer mit anderen Schluesseln in cell.data ueberschreibt
// nichts Fremdes, weil wir nur infoFields ersetzen.
async function mutateCellData<T>(
  cellId: string,
  mutator: (data: Record<string, unknown>) => { data: Record<string, unknown>; result: T },
): Promise<T> {
  // Read-Step: bei Server-Erreichbarkeit live lesen, sonst aus dem
  // IDB-Cache. Andernfalls waere jede info-Field/Link-Aenderung
  // offline blockiert (Read scheitert vor dem Write). Cache liefert
  // den letzten bekannten Stand der cell.data.
  let cellData: Record<string, unknown> = {};
  try {
    const { data: cur, error: readErr } = await supabase
      .from('cells')
      .select('data')
      .eq('id', cellId)
      .single();
    if (readErr) throw readErr;
    cellData = (cur?.data ?? {}) as Record<string, unknown>;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getById<CellRow>('cells', cellId);
    if (!cached) throw err;
    cellData = ((cached as { data?: unknown }).data ?? {}) as Record<string, unknown>;
  }
  const { data: nextData, result } = mutator(cellData);
  // Write-Step laeuft ueber updateCell — das ist bereits gewrappt
  // und queued bei Network-Error + patcht den Cache, damit naechste
  // mutateCellData-Aufrufe den frischen Stand sehen.
  await updateCell(cellId, { data: nextData });
  return result;
}

function genInfoFieldId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `if_${Math.random().toString(36).slice(2, 10)}`;
}

export async function addCellInfoField(args: {
  cellId: string;
  label?: string;
}): Promise<InfoField> {
  return mutateCellData(args.cellId, (cellData) => {
    const fields = readInfoFields(cellData);
    const field: InfoField = {
      id: genInfoFieldId(),
      label: args.label ?? '',
      value: '',
    };
    const next = { ...cellData, infoFields: [...fields, field] };
    return { data: next, result: field };
  });
}

export async function renameCellInfoField(
  cellId: string,
  fieldId: string,
  label: string,
): Promise<void> {
  await mutateCellData(cellId, (cellData) => {
    const fields = readInfoFields(cellData).map((f) => (f.id === fieldId ? { ...f, label } : f));
    return { data: { ...cellData, infoFields: fields }, result: undefined };
  });
}

export async function setCellInfoFieldValue(
  cellId: string,
  fieldId: string,
  value: string,
): Promise<void> {
  await mutateCellData(cellId, (cellData) => {
    const fields = readInfoFields(cellData).map((f) => (f.id === fieldId ? { ...f, value } : f));
    return { data: { ...cellData, infoFields: fields }, result: undefined };
  });
}

export async function moveCellInfoField(
  cellId: string,
  fieldId: string,
  dir: -1 | 1,
): Promise<void> {
  await mutateCellData(cellId, (cellData) => {
    const fields = readInfoFields(cellData);
    const idx = fields.findIndex((f) => f.id === fieldId);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= fields.length) {
      return { data: cellData, result: undefined };
    }
    const copy = fields.slice();
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    return { data: { ...cellData, infoFields: copy }, result: undefined };
  });
}

export async function delCellInfoField(cellId: string, fieldId: string): Promise<void> {
  await mutateCellData(cellId, (cellData) => {
    const fields = readInfoFields(cellData).filter((f) => f.id !== fieldId);
    return { data: { ...cellData, infoFields: fields }, result: undefined };
  });
}

// ─── Zell-Links (cell.data.links[]) ────────────────────────────
// Analog zu infoFields: JSONB-Array auf cell.data. URL wird per
// sanitizeUrl gefiltert (javascript:/data:/vbscript: werden abgelehnt).
// Kein DB-Unique-Constraint auf Alias — JSONB-Links fuehren (vorerst)
// keinen Alias; siehe types.ts/InfoLink-Kommentar. Reader-Helper liegt
// in lib/cell-data (oben als readInfoLinks importiert).

function genInfoLinkId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `il_${Math.random().toString(36).slice(2, 10)}`;
}

export class InvalidUrlError extends Error {
  constructor() {
    super('URL ungueltig.');
    this.name = 'InvalidUrlError';
  }
}

export async function addCellLink(args: {
  cellId: string;
  label: string;
  url: string;
}): Promise<InfoLink> {
  const safeUrl = sanitizeUrl(args.url);
  if (!safeUrl) throw new InvalidUrlError();
  return mutateCellData(args.cellId, (cellData) => {
    const links = readInfoLinks(cellData);
    const link: InfoLink = {
      id: genInfoLinkId(),
      label: args.label.trim() || safeUrl,
      url: safeUrl,
    };
    const next = { ...cellData, links: [...links, link] };
    return { data: next, result: link };
  });
}

export async function setCellLinkLabel(
  cellId: string,
  linkId: string,
  label: string,
): Promise<void> {
  await mutateCellData(cellId, (cellData) => {
    const links = readInfoLinks(cellData).map((l) => (l.id === linkId ? { ...l, label } : l));
    return { data: { ...cellData, links }, result: undefined };
  });
}

export async function setCellLinkUrl(cellId: string, linkId: string, url: string): Promise<void> {
  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) throw new InvalidUrlError();
  await mutateCellData(cellId, (cellData) => {
    const links = readInfoLinks(cellData).map((l) =>
      l.id === linkId ? { ...l, url: safeUrl } : l,
    );
    return { data: { ...cellData, links }, result: undefined };
  });
}

export async function moveCellLink(cellId: string, linkId: string, dir: -1 | 1): Promise<void> {
  await mutateCellData(cellId, (cellData) => {
    const links = readInfoLinks(cellData);
    const idx = links.findIndex((l) => l.id === linkId);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= links.length) {
      return { data: cellData, result: undefined };
    }
    const copy = links.slice();
    [copy[idx], copy[next]] = [copy[next], copy[idx]];
    return { data: { ...cellData, links: copy }, result: undefined };
  });
}

export async function delCellLink(cellId: string, linkId: string): Promise<void> {
  await mutateCellData(cellId, (cellData) => {
    const links = readInfoLinks(cellData).filter((l) => l.id !== linkId);
    return { data: { ...cellData, links }, result: undefined };
  });
}

// ─── Karten-Inline-Checkliste (tasks.attrs.checklist_inline jsonb) ──
// Phase 4 T.1.D: Inline-Checkliste lebt jetzt in tasks.attrs.checklist_inline.
// Nur relevant wenn die Karte KEINE checklist_ref hat — im Ref-Modus
// gehen alle Aenderungen ueber die normalen checklist_item-Mutations.
async function mutateCardChecklist<T>(
  cardId: string,
  mutator: (items: InlineChecklistItem[]) => {
    items: InlineChecklistItem[];
    result: T;
  },
): Promise<T> {
  // Read-Step: live tasks.attrs lesen, bei NetworkError aus dem IDB-Cache.
  let current: InlineChecklistItem[] = [];
  try {
    const { data: cur, error: readErr } = await supabase
      .from('tasks')
      .select('attrs')
      .eq('id', cardId)
      .single();
    if (readErr) throw readErr;
    const attrs = ((cur as { attrs: Record<string, unknown> } | null)?.attrs ?? {}) as Record<
      string,
      unknown
    >;
    const raw = attrs.checklist_inline;
    current = Array.isArray(raw) ? (raw as InlineChecklistItem[]) : [];
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getById<TaskRow>('tasks', cardId);
    if (!cached) throw err;
    const attrs = (cached.attrs ?? {}) as Record<string, unknown>;
    const raw = attrs.checklist_inline;
    current = Array.isArray(raw) ? (raw as InlineChecklistItem[]) : [];
  }
  const { items, result } = mutator(current);
  // Write-Step ueber updateCard → schreibt attrs.checklist_inline.
  await updateCard(cardId, { checklist: items });
  return result;
}

function genInlineItemId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `ii_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureItemId(it: InlineChecklistItem): InlineChecklistItem {
  return it.id ? it : { ...it, id: genInlineItemId() };
}

export async function addCardInlineItem(args: {
  cardId: string;
  text?: string;
  level?: 0 | 1 | 2;
}): Promise<InlineChecklistItem> {
  return mutateCardChecklist(args.cardId, (items) => {
    const newItem: InlineChecklistItem = {
      id: genInlineItemId(),
      text: args.text ?? '',
      done: false,
      level: args.level ?? 0,
    };
    return { items: [...items.map(ensureItemId), newItem], result: newItem };
  });
}

export async function toggleCardInlineItem(
  cardId: string,
  itemId: string,
  done: boolean,
): Promise<void> {
  await mutateCardChecklist(cardId, (items) => ({
    items: items.map(ensureItemId).map((it) => (it.id === itemId ? { ...it, done } : it)),
    result: undefined,
  }));
}

export async function renameCardInlineItem(
  cardId: string,
  itemId: string,
  text: string,
): Promise<void> {
  await mutateCardChecklist(cardId, (items) => ({
    items: items.map(ensureItemId).map((it) => (it.id === itemId ? { ...it, text } : it)),
    result: undefined,
  }));
}

export async function delCardInlineItem(cardId: string, itemId: string): Promise<void> {
  await mutateCardChecklist(cardId, (items) => ({
    items: items.map(ensureItemId).filter((it) => it.id !== itemId),
    result: undefined,
  }));
}

// ─── Board-Links (links-Tabelle, board_id=X) ───────────────────
// Eigene Tabelle (nicht JSONB): Sortierung per position, Alias moeglich.
// URLs gehen durch sanitizeUrl — 'javascript:' etc. werden abgelehnt.
// WV.B.2: provider statt type. 15 Werte aus Konzept §12.3.2.
// V1-Defaults: 'url' fuer normale Hyperlinks, 'mail' fuer mailto-Adressen.
export async function addBoardLink(args: {
  workspaceId: string;
  boardId: string;
  provider: LinkProvider;
  label?: string;
  url: string;
}): Promise<LinkRow> {
  const safeUrl = sanitizeUrl(args.url);
  if (!safeUrl) throw new InvalidUrlError();
  return runOptimisticInsert<LinkRow>({
    table: 'links',
    workspaceId: args.workspaceId,
    label: 'Link anlegen',
    run: async () => {
      const position = await nextBoardPosition('links', args.boardId, args.workspaceId);
      const { data, error } = await supabase
        .from('links')
        .insert({
          workspace_id: args.workspaceId,
          board_id: args.boardId,
          provider: args.provider,
          label: (args.label ?? '').trim() || safeUrl,
          url: safeUrl,
          position,
        })
        .select()
        .single();
      if (error) throw error;
      return data as LinkRow;
    },
    buildOffline: async (id) => {
      const position = await nextPositionFromCache(
        'links',
        args.workspaceId,
        (r) => r.board_id === args.boardId,
      );
      const now = new Date().toISOString();
      return {
        id,
        workspace_id: args.workspaceId,
        board_id: args.boardId,
        provider: args.provider,
        provider_meta: {},
        symbol_override: null,
        click_count: 0,
        label: (args.label ?? '').trim() || safeUrl,
        url: safeUrl,
        alias: null,
        position,
        data: null,
        created_at: now,
      } as unknown as LinkRow;
    },
  });
}

// Welle WV.C — Cell-Link Atom (board_id NULL): Migration 076 hat board_id
// nullable gemacht. Cell-Links manifestieren sich via atom_manifestation
// (kind='pinned', container_kind='cell') statt ueber board_id.
//
// Naming-Konflikt mit Legacy-addCellLink (cell.data.links): das
// Legacy-API bleibt bis Cell-Renderer auf Atom-Pfad umgestellt ist
// (Welle WV.B Cell-Renderer). Diese neue Funktion fuer den Atom-Pfad
// heisst `addCellAtomLink`.
export async function addCellAtomLink(args: {
  workspaceId: string;
  cellId: string;
  provider: LinkProvider;
  label?: string;
  url: string;
}): Promise<LinkRow> {
  const safeUrl = sanitizeUrl(args.url);
  if (!safeUrl) throw new InvalidUrlError();
  const link = await runOptimisticInsert<LinkRow>({
    table: 'links',
    workspaceId: args.workspaceId,
    label: 'Cell-Link anlegen',
    run: async () => {
      const { data, error } = await supabase
        .from('links')
        .insert({
          workspace_id: args.workspaceId,
          board_id: null,
          provider: args.provider,
          label: (args.label ?? '').trim() || safeUrl,
          url: safeUrl,
          position: 0,
        })
        .select()
        .single();
      if (error) throw error;
      return data as LinkRow;
    },
    buildOffline: (id) => {
      const now = new Date().toISOString();
      return {
        id,
        workspace_id: args.workspaceId,
        board_id: null,
        provider: args.provider,
        provider_meta: {},
        symbol_override: null,
        click_count: 0,
        label: (args.label ?? '').trim() || safeUrl,
        url: safeUrl,
        alias: null,
        position: 0,
        data: null,
        created_at: now,
      } as unknown as LinkRow;
    },
  });

  // Manifestation: cell-pinned. Caller (UI) uebergibt cellId als
  // Container — Sortierung + Reorder erfolgen via atom-manifestations.
  // Position = max+1 in der Cell. P.1 (2026-05-13): in runOptimistic-
  // Insert gewrappt (Architektur §4.1.1 — direkter supabase.from()-
  // Insert ohne Wrapper bricht den Offline-Pfad). Fehler werden hier
  // weiterhin geswallowed (best-effort), damit ein FK-Edge-Case nicht
  // den primary link-Insert blockiert — der Caller hat den LinkRow
  // schon erhalten; die Cell-Manifestation kann notfalls re-applied
  // werden via UI-Refetch.
  try {
    const position = await nextAtomManifestationPosition(args.cellId, 'pinned');
    await addAtomManifestation({
      workspaceId: args.workspaceId,
      atomType: 'link',
      atomId: link.id,
      kind: 'pinned',
      containerId: args.cellId,
      containerKind: 'cell',
      position,
    });
  } catch (err) {
    console.warn('addCellAtomLink: manifestation skipped:', err);
  }

  return link;
}

async function updateBoardLink(
  linkId: string,
  patch: Partial<Pick<LinkRow, 'label' | 'url' | 'provider' | 'position' | 'alias'>>,
): Promise<LinkRow> {
  return runOptimisticUpdate<LinkRow>({
    table: 'links',
    id: linkId,
    patch: patch as Record<string, unknown>,
    label: 'Link aktualisieren',
    run: async () => {
      const { data, error } = await supabase
        .from('links')
        .update(patch)
        .eq('id', linkId)
        .select()
        .single();
      if (error) throw error;
      return data as LinkRow;
    },
  });
}

export async function setBoardLinkLabel(linkId: string, label: string): Promise<void> {
  await updateBoardLink(linkId, { label: label.trim() });
}

export async function setBoardLinkUrl(linkId: string, url: string): Promise<void> {
  const safe = sanitizeUrl(url);
  if (!safe) throw new InvalidUrlError();
  await updateBoardLink(linkId, { url: safe });
}

export async function setBoardLinkProvider(linkId: string, provider: LinkProvider): Promise<void> {
  await updateBoardLink(linkId, { provider });
}

export async function setBoardLinkPosition(linkId: string, position: number): Promise<void> {
  await updateBoardLink(linkId, { position });
}

export async function delBoardLink(linkId: string): Promise<void> {
  await runOptimisticDelete({
    table: 'links',
    id: linkId,
    label: 'Link loeschen',
    run: async () => {
      const { error } = await supabase.from('links').delete().eq('id', linkId);
      if (error) throw error;
    },
  });
}

// ─── Undo-Restore-Helfer ───────────────────────────────────────
// Re-INSERT mit explicit id. RLS erlaubt das, solange der User im
// selben Workspace ist. Wir schreiben die komplette Snapshot-Row
// zurueck — timestamps (created_at/updated_at) neu, alles andere
// unveraendert. "id" bleibt stabil, damit Alias-Index / Cross-Refs
// (child_matrix_id, board_id, parent_cell_id) wieder passen.

type AnyRow = Record<string, unknown>;

// Generisches re-INSERT. Entfernt timestamp-Felder damit der Server
// sie neu vergibt (Undo-Zeitpunkt soll neuer Stand sein, nicht der
// alte). Alle anderen Felder inkl. id landen zurueck.
//
// Offline (0g.2f): laeuft durch runOptimisticInsert. Die snapshot-id
// wird beibehalten (kein crypto.randomUUID, weil Undo per Definition
// die alte id zurueckhaben muss). buildOffline ignoriert das id-
// Argument und nimmt den Snapshot wie er ist — Cache-Sync klappt.
async function restoreRow(
  table: 'kb_cols' | 'nodes' | 'links' | 'rows' | 'cols' | 'cells' | 'checklists' | 'docs',
  row: AnyRow,
): Promise<void> {
  const { created_at: _ca, updated_at: _ua, ...clean } = row;
  const wsId = (clean.workspace_id as string) ?? '';
  if (!wsId) {
    // Snapshot ohne workspace_id (sollte nicht vorkommen) — direkt
    // einreichen, ohne Queue-Scope koennen wir nicht arbeiten.
    const { error } = await supabase.from(table).insert(clean);
    if (error) throw error;
    return;
  }
  await runOptimisticInsert({
    table,
    workspaceId: wsId,
    label: 'Wiederherstellen',
    run: async () => {
      const { data, error } = await supabase.from(table).insert(clean).select().single();
      if (error) throw error;
      return data as { id: string; workspace_id: string };
    },
    // Snapshot als Synth-Row direkt zurueckgeben — der Caller
    // hat die echte id (= snapshot.id), wir koennen sie 1:1
    // weiterreichen, der Server akzeptiert die explizite id beim
    // Insert (wie schon vorher).
    buildOffline: () => clean as unknown as { id: string; workspace_id: string },
  });
}

// Phase 4 T.1.D: Card-Restore baut Task + kanban-Manifestation neu auf.
// Snapshot-Mapping in lib/task-projections.ts:cardSnapshotToTaskAndManif.
export async function restoreCard(snapshot: KbCardRow): Promise<void> {
  const { task, manif } = cardSnapshotToTaskAndManif(snapshot);
  await runOptimisticInsert<TaskRow>({
    table: 'tasks',
    workspaceId: task.workspace_id,
    label: 'Wiederherstellen',
    run: async () => {
      const { created_at: _ca, updated_at: _ua, ...clean } = task;
      const { data, error } = await supabase.from('tasks').insert(clean).select().single();
      if (error) throw error;
      return data as TaskRow;
    },
    buildOffline: () => task,
  });
  await runOptimisticInsert<TaskManifestationRow>({
    table: 'atom_manifestations',
    workspaceId: manif.workspace_id,
    label: 'Wiederherstellen',
    run: async () => {
      const { created_at: _ca, id: _id, ...clean } = manif;
      const { data, error } = await supabase
        .from('atom_manifestations')
        .insert(clean)
        .select()
        .single();
      if (error) throw error;
      return data as TaskManifestationRow;
    },
    buildOffline: () => manif,
  });
}

// AU-B1 K10 (B1-B-003): Node-Restore. Die DB-Cascade beim deleteNode hat
// rows/cols/cells/kb_cols/kb_cards/checklists/items/links/docs mit-
// geloescht — die sind ueber Cascade nicht wiederherstellbar. Diese
// Funktion stellt nur den Top-Level-Node wieder her; der Caller muss
// im Toast klar kommunizieren dass Sub-Inhalte ggf. via Export-Backup
// re-importiert werden muessen.
export async function restoreNode(snapshot: NodeRow): Promise<void> {
  await restoreRow('nodes', snapshot as unknown as AnyRow);
}

// AU-B1 K10 (B1-B-006): KbCol + ihre Cards restore. Reihenfolge:
// erst kb_col (FK-Parent fuer Manifestations.container_id), dann pro
// Karte Task + Manifestation.
export async function restoreKbColWithCards(
  colSnap: KbColRow,
  cardSnaps: KbCardRow[],
): Promise<void> {
  await restoreRow('kb_cols', colSnap as unknown as AnyRow);
  for (const card of cardSnaps) {
    await restoreCard(card);
  }
}

export async function restoreBoardLink(snapshot: LinkRow): Promise<void> {
  await restoreRow('links', snapshot as unknown as AnyRow);
}

// Row + ihre Cells restore: zuerst die Row (FK-Parent), dann die
// Cells (FK-Child). Reihenfolge matters — andere Reihenfolge wirft
// FK-Violation.
export async function restoreRowWithCells(rowSnap: RowRow, cellSnaps: CellRow[]): Promise<void> {
  await restoreRow('rows', rowSnap as unknown as AnyRow);
  for (const cell of cellSnaps) {
    await restoreRow('cells', cell as unknown as AnyRow);
  }
}

export async function restoreColWithCells(colSnap: ColRow, cellSnaps: CellRow[]): Promise<void> {
  await restoreRow('cols', colSnap as unknown as AnyRow);
  for (const cell of cellSnaps) {
    await restoreRow('cells', cell as unknown as AnyRow);
  }
}

export async function restoreChecklistWithItems(
  clSnap: ChecklistRow,
  itemSnaps: ChecklistItemRow[],
): Promise<void> {
  await restoreRow('checklists', clSnap as unknown as AnyRow);
  for (const item of itemSnaps) {
    await restoreChecklistItem(item);
  }
}

// Phase 4 T.1.D: Item-Restore baut Task + checklist-Manifestation neu auf.
export async function restoreChecklistItem(snap: ChecklistItemRow): Promise<void> {
  const { task, manif } = itemSnapshotToTaskAndManif(snap);
  await runOptimisticInsert<TaskRow>({
    table: 'tasks',
    workspaceId: task.workspace_id,
    label: 'Wiederherstellen',
    run: async () => {
      const { created_at: _ca, updated_at: _ua, ...clean } = task;
      const { data, error } = await supabase.from('tasks').insert(clean).select().single();
      if (error) throw error;
      return data as TaskRow;
    },
    buildOffline: () => task,
  });
  await runOptimisticInsert<TaskManifestationRow>({
    table: 'atom_manifestations',
    workspaceId: manif.workspace_id,
    label: 'Wiederherstellen',
    run: async () => {
      const { created_at: _ca, id: _id, ...clean } = manif;
      const { data, error } = await supabase
        .from('atom_manifestations')
        .insert(clean)
        .select()
        .single();
      if (error) throw error;
      return data as TaskManifestationRow;
    },
    buildOffline: () => manif,
  });
}

// ─── Docs ────────────────────────────────────────────────────────
// Welle D + WV.WV.1: Docs sind Atome ohne Parent-Spalte. "Doku gehoert
// zu Cell" lebt in atom_manifestations(kind='pinned') — siehe Pin-CRUD
// in lib/atom-manifestations.ts (createAtomPin / pinDocWithCreate /
// setDocSingleCellPin). Mutations hier touchen nur die docs-Source-
// Tabelle (Title/Content/Alias/Source-Alias).
export async function createDoc(args: {
  workspaceId: string;
  title?: string;
  // Phase 3 O.8: optional Template (mit {row.object}/{column.object}).
  titleTemplate?: string;
  content?: string;
  alias?: string | null;
  source_alias?: string | null;
}): Promise<DocRow> {
  const titleValue = args.title ?? '';
  const templateValue = args.titleTemplate ?? titleValue;
  // Welle D: docs.content enthaelt HTML statt Markdown.
  const contentValue = args.content ?? '<p></p>';
  return runOptimisticInsert<DocRow>({
    table: 'docs',
    workspaceId: args.workspaceId,
    label: 'Dokumentation anlegen',
    run: async () => {
      const { data, error } = await supabase
        .from('docs')
        .insert({
          workspace_id: args.workspaceId,
          title: titleValue,
          title_template: templateValue,
          content: contentValue,
          alias: args.alias ?? null,
          source_alias: args.source_alias ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as DocRow;
    },
    buildOffline: (id) => {
      const now = new Date().toISOString();
      return {
        id,
        workspace_id: args.workspaceId,
        alias: args.alias ?? null,
        title: titleValue,
        title_template: templateValue,
        content: contentValue,
        source_alias: args.source_alias ?? null,
        created_at: now,
        updated_at: now,
      } as unknown as DocRow;
    },
  });
}

async function updateDoc(
  docId: string,
  patch: Partial<Pick<DocRow, 'title' | 'title_template' | 'content' | 'alias' | 'source_alias'>>,
): Promise<DocRow> {
  return runOptimisticUpdate<DocRow>({
    table: 'docs',
    id: docId,
    patch: patch as Record<string, unknown>,
    label:
      'title' in patch
        ? 'Doku-Titel speichern'
        : 'content' in patch
          ? 'Doku-Inhalt speichern'
          : 'Doku aktualisieren',
    run: async () => {
      const { data, error } = await supabase
        .from('docs')
        .update(patch)
        .eq('id', docId)
        .select()
        .single();
      if (error) throw error;
      return data as DocRow;
    },
  });
}

export function setDocTitle(docId: string, title: string, template?: string): Promise<DocRow> {
  // Phase 3 O.8.L: User-Edit ueberschreibt Template + Snapshot.
  // Phase 3 O.8.N.1: Optional `template` separat (Wizard-Edit).
  return updateDoc(docId, { title, title_template: template ?? title });
}

export function setDocContent(docId: string, content: string): Promise<DocRow> {
  return updateDoc(docId, { content });
}

export function setDocAlias(docId: string, alias: string | null): Promise<DocRow> {
  return updateDoc(docId, { alias });
}

export async function delDoc(docId: string): Promise<void> {
  await runOptimisticDelete({
    table: 'docs',
    id: docId,
    label: 'Dokumentation loeschen',
    run: async () => {
      const { error } = await supabase.from('docs').delete().eq('id', docId);
      if (error) throw error;
    },
  });
}

export async function restoreDoc(snap: DocRow): Promise<void> {
  await restoreRow('docs', snap as unknown as AnyRow);
}
