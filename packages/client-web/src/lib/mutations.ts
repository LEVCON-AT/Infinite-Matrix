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

import { isNetworkError } from './mutation-queue';
import { getById, getByWorkspace } from './offline-cache';
import { runOptimisticDelete, runOptimisticInsert, runOptimisticUpdate } from './safe-mutation';
import { supabase } from './supabase';

// Offline-Helper: groesste Position im Scope finden, +1. Aufrufer
// reicht den Filter-Pradicat, das aus dem Cache passende Rows raus-
// zieht (z.B. board_id + col_id matchen). Liefert 0 wenn der Scope
// noch leer ist.
async function nextPositionFromCache(
  table: 'rows' | 'cols' | 'kb_cols' | 'kb_cards' | 'checklists' | 'links' | 'checklist_items',
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
  LinkRow,
  LinkType,
  NodeRow,
  RowRow,
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
  table: 'kb_cols' | 'kb_cards' | 'checklists' | 'links',
  boardId: string,
  workspaceId: string,
  extraEq?: { col_id?: string },
): Promise<number> {
  let q = supabase
    .from(table)
    .select('position')
    .eq('board_id', boardId)
    .eq('workspace_id', workspaceId)
    .order('position', { ascending: false })
    .limit(1);
  if (extraEq?.col_id) q = q.eq('col_id', extraEq.col_id);
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
  patch: Partial<Pick<RowRow, 'label' | 'position'>>,
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
  patch: Partial<Pick<ColRow, 'label' | 'position'>>,
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
}): Promise<NodeRow> {
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
        alias: null,
        parent_cell_id: args.parentCellId,
        data: {},
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
}): Promise<NodeRow> {
  return createChildNode({
    workspaceId: args.workspaceId,
    parentCellId: args.parentCellId,
    type: 'matrix',
    label: args.label ?? 'Neue Matrix',
  });
}

export async function createChildBoard(args: {
  workspaceId: string;
  parentCellId: string;
  label?: string;
}): Promise<NodeRow> {
  return createChildNode({
    workspaceId: args.workspaceId,
    parentCellId: args.parentCellId,
    type: 'board',
    label: args.label ?? 'Neues Board',
  });
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

export async function renameNode(nodeId: string, label: string): Promise<NodeRow> {
  return runOptimisticUpdate<NodeRow>({
    table: 'nodes',
    id: nodeId,
    patch: { label },
    label: 'Element umbenennen',
    run: async () => {
      const { data, error } = await supabase
        .from('nodes')
        .update({ label })
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
  patch: Partial<Pick<KbColRow, 'label' | 'color' | 'position'>>,
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
// Positions-Scoping pro Spalte (col_id), damit Karten innerhalb der
// Spalte eine eigene Reihenfolge haben. Move zwischen Spalten setzt
// die Position neu auf das Ende der Ziel-Spalte.
export async function addCard(args: {
  workspaceId: string;
  boardId: string;
  colId: string;
  name?: string;
}): Promise<KbCardRow> {
  return runOptimisticInsert<KbCardRow>({
    table: 'kb_cards',
    workspaceId: args.workspaceId,
    label: 'Karte anlegen',
    run: async () => {
      const pos = await nextBoardPosition('kb_cards', args.boardId, args.workspaceId, {
        col_id: args.colId,
      });
      const { data, error } = await supabase
        .from('kb_cards')
        .insert({
          workspace_id: args.workspaceId,
          board_id: args.boardId,
          col_id: args.colId,
          name: args.name ?? '',
          position: pos,
        })
        .select()
        .single();
      if (error) throw error;
      return data as KbCardRow;
    },
    buildOffline: async (id) => {
      const pos = await nextPositionFromCache(
        'kb_cards',
        args.workspaceId,
        (r) => r.board_id === args.boardId && r.col_id === args.colId,
      );
      const now = new Date().toISOString();
      // Vollstaendige Default-Row, damit UI-Renderings nicht auf
      // undefined-Felder laufen. Server vergibt beim Replay neue
      // timestamps; wir setzen die clientseitigen jetzt.
      return {
        id,
        workspace_id: args.workspaceId,
        board_id: args.boardId,
        col_id: args.colId,
        name: args.name ?? '',
        note: '',
        tags: [],
        who: [],
        deadline: null,
        priority: null,
        done: false,
        archived: false,
        recur: null,
        position: pos,
        alias: null,
        source_cl_id: null,
        source_label: null,
        checklist_ref: null,
        checklist: null,
        color: null,
        done_occurrences: [],
        created_at: now,
        updated_at: now,
      } as unknown as KbCardRow;
    },
  });
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
  return runOptimisticInsert<KbCardRow>({
    table: 'kb_cards',
    workspaceId: args.workspaceId,
    label: 'Karte aus Checkliste',
    run: async () => {
      const pos = await nextBoardPosition('kb_cards', args.targetBoardId, args.workspaceId, {
        col_id: args.targetColId,
      });
      const { data, error } = await supabase
        .from('kb_cards')
        .insert({
          workspace_id: args.workspaceId,
          board_id: args.targetBoardId,
          col_id: args.targetColId,
          name: args.name,
          position: pos,
          checklist_ref: args.checklistId,
        })
        .select()
        .single();
      if (error) throw error;
      return data as KbCardRow;
    },
    buildOffline: async (id) => {
      const pos = await nextPositionFromCache(
        'kb_cards',
        args.workspaceId,
        (r) => r.board_id === args.targetBoardId && r.col_id === args.targetColId,
      );
      const now = new Date().toISOString();
      return {
        id,
        workspace_id: args.workspaceId,
        board_id: args.targetBoardId,
        col_id: args.targetColId,
        name: args.name,
        note: '',
        tags: [],
        who: [],
        deadline: null,
        priority: null,
        done: false,
        archived: false,
        recur: null,
        position: pos,
        alias: null,
        source_cl_id: null,
        source_label: null,
        checklist_ref: args.checklistId,
        checklist: null,
        color: null,
        done_occurrences: [],
        created_at: now,
        updated_at: now,
      } as unknown as KbCardRow;
    },
  });
}

type CardPatch = Partial<
  Pick<
    KbCardRow,
    | 'name'
    | 'note'
    | 'alias'
    | 'done'
    | 'deadline'
    | 'priority'
    | 'tags'
    | 'who'
    | 'archived'
    | 'color'
    | 'position'
    | 'col_id'
    | 'board_id'
  >
> & {
  recur?: CardRecur | null;
  // Inline-Checkliste (kb_cards.checklist jsonb) wird ueber denselben
  // Wrapper geschrieben — sonst muesste mutateCardChecklist seinen
  // eigenen runOptimisticUpdate-Aufruf bauen, was die Queue-Spec-Form
  // dupliziert.
  checklist?: InlineChecklistItem[];
};

async function updateCard(cardId: string, patch: CardPatch): Promise<KbCardRow> {
  // Geht durch runOptimisticUpdate: online-Path identisch zu vorher,
  // bei NetworkError wird die Mutation in die Queue gelegt + die
  // gecachte Row gepatcht, sodass die UI eine sinnvolle Antwort
  // bekommt. 14 Setter (renameCard, toggleCardDone, setCardNote,
  // setCardAlias, setCardDeadline, setCardPriority, setCardTags,
  // setCardWho, setCardRecur, setCardArchived, setCardColor,
  // setCardDoneOccurrences via separater Funktion) profitieren
  // davon ohne weitere Aenderungen.
  return runOptimisticUpdate<KbCardRow>({
    table: 'kb_cards',
    id: cardId,
    patch: patch as Record<string, unknown>,
    label: cardLabelFromPatch(patch),
    run: async () => {
      const { data, error } = await supabase
        .from('kb_cards')
        .update(patch)
        .eq('id', cardId)
        .select()
        .single();
      if (error) throw error;
      return data as KbCardRow;
    },
  });
}

// Liefert ein User-lesbares Label fuer den Offline-Toast je nach
// Patch-Inhalt — fokussiert auf die haeufigsten Felder, der Rest
// faellt auf "Karte aktualisieren" zurueck.
function cardLabelFromPatch(patch: CardPatch): string {
  if ('done' in patch) return patch.done ? 'Karte erledigen' : 'Karte oeffnen';
  if ('archived' in patch) return patch.archived ? 'Karte archivieren' : 'Karte zurueckholen';
  if ('name' in patch) return 'Karte umbenennen';
  if ('note' in patch) return 'Notiz speichern';
  if ('alias' in patch) return 'Alias setzen';
  if ('deadline' in patch) return 'Deadline setzen';
  if ('priority' in patch) return 'Prioritaet setzen';
  if ('tags' in patch) return 'Tags setzen';
  if ('who' in patch) return 'Verantwortliche setzen';
  if ('recur' in patch) return 'Wiederholung setzen';
  if ('color' in patch) return 'Karten-Farbe setzen';
  return 'Karte aktualisieren';
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
  return runOptimisticUpdate<KbCardRow>({
    table: 'kb_cards',
    id: cardId,
    patch: { done_occurrences: occurrences },
    label: 'Karte erledigen',
    run: async () => {
      const { data, error } = await supabase
        .from('kb_cards')
        .update({ done_occurrences: occurrences })
        .eq('id', cardId)
        .select()
        .single();
      if (error) throw error;
      return data as KbCardRow;
    },
  });
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
  // Online: nextBoardPosition vom Server fuer korrektes Anhaengen.
  // Offline: nextPositionFromCache liefert das letzte gecachte
  // Maximum +1. Position-Konflikte bei Replay sind moeglich (zwei
  // Karten landen evtl. gleich), aber Realtime-Refetch normalisiert.
  // Updates gehen durch updateCard → runOptimisticUpdate.
  let pos: number;
  try {
    pos = await nextBoardPosition('kb_cards', args.boardId, args.workspaceId, {
      col_id: args.toColId,
    });
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    pos = await nextPositionFromCache(
      'kb_cards',
      args.workspaceId,
      (r) => r.board_id === args.boardId && r.col_id === args.toColId,
    );
  }
  return updateCard(args.cardId, { col_id: args.toColId, position: pos });
}

export async function setCardPosition(cardId: string, position: number): Promise<void> {
  await updateCard(cardId, { position } as CardPatch);
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
  // Geht durch updateCard, weil CardPatch board_id/col_id/position
  // alle drei kennt — damit ist die Cross-Board-Verschiebung offline-
  // tauglich identisch zu setCardColAndPosition.
  await updateCard(cardId, { board_id: toBoardId, col_id: toColId, position });
}

export async function delCard(cardId: string): Promise<void> {
  await runOptimisticDelete({
    table: 'kb_cards',
    id: cardId,
    label: 'Karte loeschen',
    run: async () => {
      const { error } = await supabase.from('kb_cards').delete().eq('id', cardId);
      if (error) throw error;
    },
  });
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
}): Promise<ChecklistRow> {
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
          label: args.label ?? '',
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
        label: args.label ?? '',
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
  Pick<ChecklistRow, 'label' | 'alias' | 'close_mode' | 'recur' | 'action' | 'history'>
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

export function renameChecklist(clId: string, label: string): Promise<ChecklistRow> {
  return updateChecklist(clId, { label });
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
async function nextItemPosition(checklistId: string, workspaceId: string): Promise<number> {
  const { data, error } = await supabase
    .from('checklist_items')
    .select('position')
    .eq('checklist_id', checklistId)
    .eq('workspace_id', workspaceId)
    .order('position', { ascending: false })
    .limit(1);
  if (error) throw error;
  const top = data && data.length > 0 ? (data[0] as { position: number }).position : -1;
  return top + 1;
}

export async function addChecklistItem(args: {
  workspaceId: string;
  checklistId: string;
  text?: string;
  level?: 0 | 1 | 2;
}): Promise<ChecklistItemRow> {
  return runOptimisticInsert<ChecklistItemRow>({
    table: 'checklist_items',
    workspaceId: args.workspaceId,
    label: 'Eintrag anlegen',
    run: async () => {
      const pos = await nextItemPosition(args.checklistId, args.workspaceId);
      const { data, error } = await supabase
        .from('checklist_items')
        .insert({
          workspace_id: args.workspaceId,
          checklist_id: args.checklistId,
          text: args.text ?? '',
          level: args.level ?? 0,
          position: pos,
        })
        .select()
        .single();
      if (error) throw error;
      return data as ChecklistItemRow;
    },
    buildOffline: async (id) => {
      const pos = await nextPositionFromCache(
        'checklist_items',
        args.workspaceId,
        (r) => r.checklist_id === args.checklistId,
      );
      return {
        id,
        workspace_id: args.workspaceId,
        checklist_id: args.checklistId,
        text: args.text ?? '',
        done: false,
        level: args.level ?? 0,
        position: pos,
      } as unknown as ChecklistItemRow;
    },
  });
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
  try {
    if (args.recurring) {
      const { error } = await supabase
        .from('checklist_items')
        .update({ done: false })
        .eq('checklist_id', args.checklistId)
        .eq('workspace_id', args.workspaceId);
      if (error) throw error;
      return;
    }
    const { error } = await supabase
      .from('checklist_items')
      .delete()
      .eq('checklist_id', args.checklistId)
      .eq('workspace_id', args.workspaceId);
    if (error) throw error;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    // Offline-Fallback: aus dem Cache die Items dieser Liste ziehen
    // und einzeln durch den Wrapper schicken.
    const items = await getByWorkspace<ChecklistItemRow>('checklist_items', args.workspaceId);
    const own = items.filter((it) => it.checklist_id === args.checklistId);
    if (args.recurring) {
      for (const it of own) {
        if (it.done) await updateItem(it.id, { done: false });
      }
    } else {
      for (const it of own) {
        await delChecklistItem(it.id);
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
// Popup aufgerufen. Einzelne .insert()-Calls in einer Schleife waeren
// 10-50 Roundtrips bei grossen Pastes; deshalb Batch mit einem einzigen
// Request (positions werden lokal berechnet, startend bei nextPos).
export async function bulkAddChecklistItems(args: {
  workspaceId: string;
  checklistId: string;
  items: Array<{ text: string; level: 0 | 1 | 2 }>;
}): Promise<ChecklistItemRow[]> {
  if (args.items.length === 0) return [];
  // Online: ein Bulk-Insert (1 Roundtrip). Offline: pro-Item ueber
  // addChecklistItem (gewrappt). Bei grossen Pastes ist das mehr
  // Queue-Last, aber jede Insert-Spec ist atomar replay-bar.
  try {
    const startPos = await nextItemPosition(args.checklistId, args.workspaceId);
    const payload = args.items.map((it, i) => ({
      workspace_id: args.workspaceId,
      checklist_id: args.checklistId,
      text: it.text,
      level: it.level,
      position: startPos + i,
    }));
    const { data, error } = await supabase.from('checklist_items').insert(payload).select();
    if (error) throw error;
    return (data ?? []) as ChecklistItemRow[];
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

type ItemPatch = Partial<Pick<ChecklistItemRow, 'text' | 'done' | 'level' | 'position'>>;

async function updateItem(itemId: string, patch: ItemPatch): Promise<ChecklistItemRow> {
  // Geht durch runOptimisticUpdate — toggleChecklistItemDone ist eine
  // der haeufigsten Klick-Aktionen, die soll auch offline durchgehen.
  return runOptimisticUpdate<ChecklistItemRow>({
    table: 'checklist_items',
    id: itemId,
    patch: patch as Record<string, unknown>,
    label: 'done' in patch ? 'Eintrag abhaken' : 'Eintrag aktualisieren',
    run: async () => {
      const { data, error } = await supabase
        .from('checklist_items')
        .update(patch)
        .eq('id', itemId)
        .select()
        .single();
      if (error) throw error;
      return data as ChecklistItemRow;
    },
  });
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
  await runOptimisticDelete({
    table: 'checklist_items',
    id: itemId,
    label: 'Eintrag loeschen',
    run: async () => {
      const { error } = await supabase.from('checklist_items').delete().eq('id', itemId);
      if (error) throw error;
    },
  });
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

// ─── Karten-Inline-Checkliste (kb_cards.checklist jsonb) ───────
// Read-modify-write, gleiches Muster wie mutateCellData. Nur relevant,
// wenn die Karte KEINE checklist_ref hat — im Ref-Modus gehen alle
// Aenderungen ueber die normalen checklist_item-Mutations, weil die
// Daten dann in der checklist_items-Tabelle liegen.
async function mutateCardChecklist<T>(
  cardId: string,
  mutator: (items: InlineChecklistItem[]) => {
    items: InlineChecklistItem[];
    result: T;
  },
): Promise<T> {
  // Read-Step analog mutateCellData: live lesen, bei NetworkError aus
  // dem IDB-Cache nachladen. Sonst waeren Inline-Checklist-Edits
  // offline blockiert vor dem Write.
  let current: InlineChecklistItem[] = [];
  try {
    const { data: cur, error: readErr } = await supabase
      .from('kb_cards')
      .select('checklist')
      .eq('id', cardId)
      .single();
    if (readErr) throw readErr;
    const raw = (cur as { checklist: unknown } | null)?.checklist;
    current = Array.isArray(raw) ? (raw as InlineChecklistItem[]) : [];
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const cached = await getById<KbCardRow>('kb_cards', cardId);
    if (!cached) throw err;
    const raw = (cached as { checklist?: unknown }).checklist;
    current = Array.isArray(raw) ? (raw as InlineChecklistItem[]) : [];
  }
  const { items, result } = mutator(current);
  // Write-Step ueber updateCard → safe-mutation-Wrapper. Bei
  // NetworkError landet die Card-Patch-Spec in der Queue + Cache wird
  // gepatcht, damit der naechste Read den frischen Stand sieht.
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
// type: 'url' (normale Hyperlinks) oder 'mail' (url = reine E-Mail-
// Adresse, href wird im UI zu mailto:<addr> gebaut).
export async function addBoardLink(args: {
  workspaceId: string;
  boardId: string;
  type: LinkType;
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
          type: args.type,
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
        type: args.type,
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

async function updateBoardLink(
  linkId: string,
  patch: Partial<Pick<LinkRow, 'label' | 'url' | 'type' | 'position' | 'alias'>>,
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

export async function setBoardLinkType(linkId: string, type: LinkType): Promise<void> {
  await updateBoardLink(linkId, { type });
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
  table:
    | 'kb_cards'
    | 'links'
    | 'rows'
    | 'cols'
    | 'cells'
    | 'checklists'
    | 'checklist_items'
    | 'docs',
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

export async function restoreCard(snapshot: KbCardRow): Promise<void> {
  await restoreRow('kb_cards', snapshot as unknown as AnyRow);
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
    await restoreRow('checklist_items', item as unknown as AnyRow);
  }
}

export async function restoreChecklistItem(snap: ChecklistItemRow): Promise<void> {
  await restoreRow('checklist_items', snap as unknown as AnyRow);
}

// ─── Docs ────────────────────────────────────────────────────────
// Freischwebende Markdown-Light-Notizen. Create ist explizit — weder
// JSONB-Read-Modify-Write noch Position-Dance; Docs haben weder
// position noch Parent-Zwang.
export async function createDoc(args: {
  workspaceId: string;
  title?: string;
  content?: string;
  alias?: string | null;
  source_alias?: string | null;
  attached_cell_id?: string | null;
}): Promise<DocRow> {
  return runOptimisticInsert<DocRow>({
    table: 'docs',
    workspaceId: args.workspaceId,
    label: 'Dokumentation anlegen',
    run: async () => {
      const { data, error } = await supabase
        .from('docs')
        .insert({
          workspace_id: args.workspaceId,
          title: args.title ?? '',
          content: args.content ?? '',
          alias: args.alias ?? null,
          source_alias: args.source_alias ?? null,
          attached_cell_id: args.attached_cell_id ?? null,
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
        title: args.title ?? '',
        content: args.content ?? '',
        source_alias: args.source_alias ?? null,
        attached_cell_id: args.attached_cell_id ?? null,
        created_at: now,
        updated_at: now,
      } as unknown as DocRow;
    },
  });
}

async function updateDoc(
  docId: string,
  patch: Partial<Pick<DocRow, 'title' | 'content' | 'alias' | 'source_alias' | 'attached_cell_id'>>,
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

export function setDocTitle(docId: string, title: string): Promise<DocRow> {
  return updateDoc(docId, { title });
}

export function setDocContent(docId: string, content: string): Promise<DocRow> {
  return updateDoc(docId, { content });
}

export function setDocAlias(docId: string, alias: string | null): Promise<DocRow> {
  return updateDoc(docId, { alias });
}

export function setDocAttachedCell(docId: string, cellId: string | null): Promise<DocRow> {
  return updateDoc(docId, { attached_cell_id: cellId });
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
