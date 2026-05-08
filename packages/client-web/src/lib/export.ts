// Native Workspace-Export: fetcht alle Tabellen pro Workspace und
// produziert ein JSON-Blob zum Download. V1 ist bewusst NICHT round-
// trip-kompatibel mit dem Import (der liest die AltPayload-Shape vom
// HTML-Vorbild). Ziel V1: Daten-Hoheit — User kann seinen State
// jederzeit als JSON ziehen und archivieren/diffen. V2 wuerde die
// Transformation in AltPayload-Shape nachliefern.
//
// RLS kuemmert sich um die Authorization: der anonym-JWT sieht nur
// Rows in Workspaces, in denen der User Mitglied ist.

import type { AtomManifestationRow } from './atom-manifestations';
import { encryptPayload } from './crypto';
import { supabase } from './supabase';
import { taskAndManifToCard, taskAndManifToItem } from './task-projections';
import type { TaskManifestationRow, TaskRow } from './types';

// Phase 4 T.1.D: kb_cards + checklist_items leben nicht mehr in
// eigenen Tabellen — wir lesen tasks + atom_manifestations und
// projizieren auf die Legacy-Export-Form (kb_cards[]/checklist_items[]),
// damit das WorkspaceExport-Format rueckwaerts-kompatibel bleibt.
//
// Phase 4 T.1.I: zusaetzlich wandern die nativen Tabellen `tasks` und
// `atom_manifestations` vollstaendig ins Export. Damit ueberleben auch
// Calendar-Manifestationen (kind='calendar') + standalone-Tasks ohne
// Sicht den Round-Trip — die Legacy-Projection allein traegt das nicht.
async function fetchTaskShapesForWorkspace(workspaceId: string): Promise<{
  tasks: TaskRow[];
  manifestations: AtomManifestationRow[];
  kb_cards: Record<string, unknown>[];
  checklist_items: Record<string, unknown>[];
}> {
  // WV.WV.1: atom_manifestations laed alle Atom-Typen (inkl. pinned-
  // Manifestations). Legacy-Shapes (kb_cards / checklist_items) werden
  // weiterhin nur aus task-Manifestations gebaut.
  const [tasksRes, manifsRes] = await Promise.all([
    supabase.from('tasks').select('*').eq('workspace_id', workspaceId),
    supabase.from('atom_manifestations').select('*').eq('workspace_id', workspaceId),
  ]);
  if (tasksRes.error) throw tasksRes.error;
  if (manifsRes.error) throw manifsRes.error;
  const tasks = (tasksRes.data ?? []) as TaskRow[];
  const manifs = (manifsRes.data ?? []) as AtomManifestationRow[];
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const kb_cards: Record<string, unknown>[] = [];
  const checklist_items: Record<string, unknown>[] = [];
  for (const m of manifs) {
    if (m.atom_type !== 'task') continue;
    const t = taskById.get(m.atom_id);
    if (!t) continue;
    if (m.kind === 'kanban') {
      // taskAndManifToCard erwartet TaskManifestationRow (atom_type='task',
      // kind='kanban' garantiert) — Subtype-Cast nach Filter ist safe.
      kb_cards.push(
        taskAndManifToCard(t, m as TaskManifestationRow) as unknown as Record<string, unknown>,
      );
    } else if (m.kind === 'checklist') {
      checklist_items.push(
        taskAndManifToItem(t, m as TaskManifestationRow) as unknown as Record<string, unknown>,
      );
    }
  }
  return { tasks, manifestations: manifs, kb_cards, checklist_items };
}

export const WORKSPACE_EXPORT_VERSION = 1 as const;

// Payload-Typ-Tag. 'workspace' und 'subtree' haben dieselbe Shape
// (alle Tabellen); 'feature-info' enthaelt genau eine Cell (ohne
// FK-Ziele), deren data.infoFields + .links der eigentliche Inhalt
// sind. 'feature-checklists' enthaelt eine Cell + cell-scoped
// Checklisten + Items.
export type ExportPayloadType = 'workspace' | 'subtree' | 'feature-info' | 'feature-checklists';

export type WorkspaceExport = {
  version: typeof WORKSPACE_EXPORT_VERSION;
  payloadType: ExportPayloadType;
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
  // Dokumente die ueber Pinned-Manifestation (container_kind='cell')
  // an Subtree-Cells gepinnt sind. Workspace-freie Docs (ohne Cell-Pin)
  // werden nur vom Full-Workspace-Export erfasst. Default leer, damit
  // alte Parser nichts brechen.
  docs: Record<string, unknown>[];
  // WV.WV.1: atom_pins ist konsolidiert in atom_manifestations
  // (kind='pinned'). Field bleibt optional fuer Backward-Compat-Read
  // alter Export-Files (subtree-import V1-Pfad).
  atom_pins?: Record<string, unknown>[];
  // Welle D — globales Tag-System. workspace_tags ist die Registry pro
  // Workspace (UNIQUE auf workspace_id+kind+value), atom_tags die
  // Junction Atom→Tag. Beide optional fuer V0-Parser-Kompat. Beim
  // Subtree-Export werden atom_tags auf Subtree-Atome gefiltert,
  // workspace_tags wird ueber referenzierte tag_ids verkuerzt.
  workspace_tags?: Record<string, unknown>[];
  atom_tags?: Record<string, unknown>[];
  // AU-B1 K11c.2 (B1-A-006 / B1-F-003 / CC2): Object-Layer-Tabellen.
  // Optional, damit V0-Parser ohne Object-Awareness alte Exports
  // weiterhin lesen koennen. rows/cols/kb_cols/nodes haben
  // `object_id`-FKs in den Object-Layer; ohne diese Tabellen im Export
  // wird der Re-Import zu einem Lueckenexport (FKs zeigen ins Leere).
  // soft_groups/soft_group_members bewusst ausgelassen — ephemer mit
  // 60-Tage-TTL.
  objects?: Record<string, unknown>[];
  object_tags?: Record<string, unknown>[];
  groups?: Record<string, unknown>[];
  group_members?: Record<string, unknown>[];
  // Phase 4 T.1.I + Q.2: Native Task-Layer-Tabellen (Layer 0 + Layer 1).
  // Optional fuer V0-Parser-Kompatibilitaet — alte Exports tragen
  // sie nicht; der Importer faellt auf die Legacy-Projection
  // (kb_cards/checklist_items) zurueck, wenn diese Felder fehlen.
  // `tasks` traegt auch standalone-Tasks ohne Manifestation,
  // `atom_manifestations` traegt alle Manifestations (poly. atom_type,
  // inkl. kind='calendar' fuer Range/Time) — beide gehen sonst beim
  // Round-Trip verloren.
  tasks?: Record<string, unknown>[];
  atom_manifestations?: Record<string, unknown>[];
  // Nur bei Cell-Subtree-Exports gesetzt: Meta-Info zur Quell-Zelle,
  // damit der Importer ihre info-Felder/Links und Feature-Flags in
  // die Ziel-Zelle mergen kann — ohne die Zelle selbst in cells[]
  // zu duplizieren.
  sourceCell?: {
    data: Record<string, unknown>;
    features: string[];
  };
};

// Zahlen fuer den Sanity-Toast nach Export. "nodes" wird bewusst in
// matrixCount + boardCount aufgeteilt, damit die UI-Zusammenfassung
// ohne Fachbegriff ("Nodes") auskommt.
export type ExportStats = {
  matrixCount: number;
  boardCount: number;
  cells: number;
  cards: number;
  checklists: number;
  checklistItems: number;
  links: number;
  infoFields: number;
  infoLinks: number;
  docs: number;
  // AU-B1 K11c.2: Object-Layer-Counts.
  objects: number;
  groups: number;
};

function statsOf(e: WorkspaceExport): ExportStats {
  let infoFields = 0;
  let infoLinks = 0;
  for (const c of e.cells) {
    const data = (c as { data?: unknown }).data;
    if (data && typeof data === 'object') {
      const f = (data as { infoFields?: unknown }).infoFields;
      if (Array.isArray(f)) infoFields += f.length;
      const l = (data as { links?: unknown }).links;
      if (Array.isArray(l)) infoLinks += l.length;
    }
  }
  let matrixCount = 0;
  let boardCount = 0;
  for (const n of e.nodes) {
    const t = (n as { type?: unknown }).type;
    if (t === 'matrix') matrixCount += 1;
    else if (t === 'board') boardCount += 1;
  }
  return {
    matrixCount,
    boardCount,
    cells: e.cells.length,
    cards: e.kb_cards.length,
    checklists: e.checklists.length,
    checklistItems: e.checklist_items.length,
    links: e.links.length,
    infoFields,
    infoLinks,
    docs: e.docs.length,
    objects: (e.objects ?? []).length,
    groups: (e.groups ?? []).length,
  };
}

export function formatExportStats(s: ExportStats): string {
  // Nur Zahlen > 0 anzeigen — ein Feature-Export zeigt sonst nutzlose
  // 0-Zeilen.
  const parts: string[] = [];
  if (s.matrixCount) parts.push(`${s.matrixCount} ${s.matrixCount === 1 ? 'Matrix' : 'Matrizen'}`);
  if (s.boardCount) parts.push(`${s.boardCount} ${s.boardCount === 1 ? 'Board' : 'Boards'}`);
  if (s.cells) parts.push(`${s.cells} ${s.cells === 1 ? 'Zelle' : 'Zellen'}`);
  if (s.cards) parts.push(`${s.cards} ${s.cards === 1 ? 'Karte' : 'Karten'}`);
  if (s.checklists)
    parts.push(`${s.checklists} ${s.checklists === 1 ? 'Checkliste' : 'Checklisten'}`);
  if (s.checklistItems)
    parts.push(`${s.checklistItems} ${s.checklistItems === 1 ? 'Punkt' : 'Punkte'}`);
  if (s.links) parts.push(`${s.links} Board-Links`);
  if (s.infoFields)
    parts.push(`${s.infoFields} ${s.infoFields === 1 ? 'Info-Feld' : 'Info-Felder'}`);
  if (s.infoLinks) parts.push(`${s.infoLinks} ${s.infoLinks === 1 ? 'Info-Link' : 'Info-Links'}`);
  if (s.docs) parts.push(`${s.docs} ${s.docs === 1 ? 'Doku' : 'Dokus'}`);
  if (s.objects) parts.push(`${s.objects} ${s.objects === 1 ? 'Object' : 'Objects'}`);
  if (s.groups) parts.push(`${s.groups} ${s.groups === 1 ? 'Gruppe' : 'Gruppen'}`);
  return parts.length === 0 ? '(leer)' : parts.join(' · ');
}

export function summarizeExport(e: WorkspaceExport): string {
  return formatExportStats(statsOf(e));
}

export async function exportWorkspace(workspaceId: string): Promise<WorkspaceExport> {
  // Workspace-Stammdaten (Name, Owner, Timestamps) — RLS erlaubt nur
  // Read auf Memberships-Workspaces.
  const wsRes = await supabase.from('workspaces').select('*').eq('id', workspaceId).single();
  if (wsRes.error) throw wsRes.error;

  // Alle Kind-Tabellen parallel laden. workspace_id-Filter zusaetzlich
  // zur RLS als Guard. atom_pins ist seit WV.WV.1 konsolidiert in
  // atom_manifestations(kind='pinned') — kein separater Fetch.
  const [
    nodesRes,
    rowsRes,
    colsRes,
    cellsRes,
    kbColsRes,
    legacyShapes,
    checklistsRes,
    linksRes,
    docsRes,
    workspaceTagsRes,
    atomTagsRes,
    objectsRes,
    objectTagsRes,
    groupsRes,
    groupMembersRes,
  ] = await Promise.all([
    supabase.from('nodes').select('*').eq('workspace_id', workspaceId),
    supabase.from('rows').select('*').eq('workspace_id', workspaceId),
    supabase.from('cols').select('*').eq('workspace_id', workspaceId),
    supabase.from('cells').select('*').eq('workspace_id', workspaceId),
    supabase.from('kb_cols').select('*').eq('workspace_id', workspaceId),
    fetchTaskShapesForWorkspace(workspaceId),
    supabase.from('checklists').select('*').eq('workspace_id', workspaceId),
    supabase.from('links').select('*').eq('workspace_id', workspaceId),
    supabase.from('docs').select('*').eq('workspace_id', workspaceId),
    supabase.from('workspace_tags').select('*').eq('workspace_id', workspaceId),
    supabase.from('atom_tags').select('*').eq('workspace_id', workspaceId),
    supabase.from('objects').select('*').eq('workspace_id', workspaceId),
    supabase.from('object_tags').select('*').eq('workspace_id', workspaceId),
    supabase.from('groups').select('*').eq('workspace_id', workspaceId),
    supabase.from('group_members').select('*').eq('workspace_id', workspaceId),
  ]);

  for (const res of [
    nodesRes,
    rowsRes,
    colsRes,
    cellsRes,
    kbColsRes,
    checklistsRes,
    linksRes,
    docsRes,
    workspaceTagsRes,
    atomTagsRes,
    objectsRes,
    objectTagsRes,
    groupsRes,
    groupMembersRes,
  ]) {
    if (res.error) throw res.error;
  }

  return {
    version: WORKSPACE_EXPORT_VERSION,
    payloadType: 'workspace',
    exportedAt: new Date().toISOString(),
    workspace: wsRes.data as Record<string, unknown>,
    nodes: (nodesRes.data ?? []) as Record<string, unknown>[],
    rows: (rowsRes.data ?? []) as Record<string, unknown>[],
    cols: (colsRes.data ?? []) as Record<string, unknown>[],
    cells: (cellsRes.data ?? []) as Record<string, unknown>[],
    kb_cols: (kbColsRes.data ?? []) as Record<string, unknown>[],
    kb_cards: legacyShapes.kb_cards,
    checklists: (checklistsRes.data ?? []) as Record<string, unknown>[],
    checklist_items: legacyShapes.checklist_items,
    links: (linksRes.data ?? []) as Record<string, unknown>[],
    docs: (docsRes.data ?? []) as Record<string, unknown>[],
    workspace_tags: (workspaceTagsRes.data ?? []) as Record<string, unknown>[],
    atom_tags: (atomTagsRes.data ?? []) as Record<string, unknown>[],
    objects: (objectsRes.data ?? []) as Record<string, unknown>[],
    object_tags: (objectTagsRes.data ?? []) as Record<string, unknown>[],
    groups: (groupsRes.data ?? []) as Record<string, unknown>[],
    group_members: (groupMembersRes.data ?? []) as Record<string, unknown>[],
    tasks: legacyShapes.tasks as unknown as Record<string, unknown>[],
    atom_manifestations: legacyShapes.manifestations as unknown as Record<string, unknown>[],
  };
}

// Triggert den Browser-Download des Export-JSON. Blob + ObjectURL +
// temporaerer Anchor. Filename mit Datum, damit Mehrfach-Exports
// nicht ueberschrieben werden.
//
// encrypt.passphrase gesetzt -> AES-GCM-Ciphertext via crypto.ts,
// Endung wird .imx statt .json. MIME bleibt application/json-ish;
// application/octet-stream ist hier korrekter fuer die Ciphertext-
// Rohdaten, aber wir halten Text-MIME fuer Editor-Kompat (User
// kann .imx im Editor oeffnen und den Ciphertext sehen).
export async function downloadWorkspaceExport(
  exportData: WorkspaceExport,
  workspaceName: string,
  encrypt?: { passphrase: string },
): Promise<void> {
  const pretty = JSON.stringify(exportData, null, 2);
  const content = encrypt ? await encryptPayload(pretty, encrypt.passphrase) : pretty;
  const blob = new Blob([content], {
    type: encrypt ? 'application/octet-stream' : 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  const safeName = (workspaceName || 'workspace')
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  a.href = url;
  a.download = `${safeName}-${date}.${encrypt ? 'imx' : 'json'}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Cleanup nach naechstem Paint — sonst revocet Chrome den Download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ─── Subtree-Export ────────────────────────────────────────────
// Dasselbe Payload-Format wie der volle Workspace-Export, aber
// gefiltert auf den Subtree unter einem Root-Node (Matrix/Board) oder
// einer Cell. So kann der User Teile rauslösen (archivieren, auf
// anderen Workspace re-importieren). Round-trip-Import ist SB.1d —
// V1 liefert nur die Download-Seite.

type SubtreeRowSet = {
  nodeIds: Set<string>;
  cellIds: Set<string>;
  rowIds: Set<string>;
  colIds: Set<string>;
};

async function fetchWorkspaceRowsForExport(workspaceId: string) {
  // Dieselben Tabellen wie exportWorkspace, aber ohne workspace-Row.
  // Nur einmal laden + danach filtern — spart runden gegen Supabase.
  // AU-B1 K11c.2: Object-Layer-Tabellen (objects, object_tags, groups,
  // group_members) ergaenzt, damit Subtree-Export sie pro Subtree
  // filtern kann.
  const [
    nodesRes,
    rowsRes,
    colsRes,
    cellsRes,
    kbColsRes,
    legacyShapes,
    checklistsRes,
    linksRes,
    docsRes,
    workspaceTagsRes,
    atomTagsRes,
    objectsRes,
    objectTagsRes,
    groupsRes,
    groupMembersRes,
    wsRes,
  ] = await Promise.all([
    supabase.from('nodes').select('*').eq('workspace_id', workspaceId),
    supabase.from('rows').select('*').eq('workspace_id', workspaceId),
    supabase.from('cols').select('*').eq('workspace_id', workspaceId),
    supabase.from('cells').select('*').eq('workspace_id', workspaceId),
    supabase.from('kb_cols').select('*').eq('workspace_id', workspaceId),
    fetchTaskShapesForWorkspace(workspaceId),
    supabase.from('checklists').select('*').eq('workspace_id', workspaceId),
    supabase.from('links').select('*').eq('workspace_id', workspaceId),
    supabase.from('docs').select('*').eq('workspace_id', workspaceId),
    supabase.from('workspace_tags').select('*').eq('workspace_id', workspaceId),
    supabase.from('atom_tags').select('*').eq('workspace_id', workspaceId),
    supabase.from('objects').select('*').eq('workspace_id', workspaceId),
    supabase.from('object_tags').select('*').eq('workspace_id', workspaceId),
    supabase.from('groups').select('*').eq('workspace_id', workspaceId),
    supabase.from('group_members').select('*').eq('workspace_id', workspaceId),
    supabase.from('workspaces').select('*').eq('id', workspaceId).single(),
  ]);
  for (const res of [
    nodesRes,
    rowsRes,
    colsRes,
    cellsRes,
    kbColsRes,
    checklistsRes,
    linksRes,
    docsRes,
    workspaceTagsRes,
    atomTagsRes,
    objectsRes,
    objectTagsRes,
    groupsRes,
    groupMembersRes,
    wsRes,
  ]) {
    if (res.error) throw res.error;
  }
  return {
    workspace: wsRes.data as Record<string, unknown>,
    nodes: (nodesRes.data ?? []) as Array<{
      id: string;
      parent_cell_id: string | null;
      type: string;
      object_id?: string | null;
    }>,
    rows: (rowsRes.data ?? []) as Array<{
      id: string;
      matrix_id: string;
      object_id?: string | null;
    }>,
    cols: (colsRes.data ?? []) as Array<{
      id: string;
      matrix_id: string;
      object_id?: string | null;
    }>,
    cells: (cellsRes.data ?? []) as Array<{
      id: string;
      matrix_id: string;
      row_id: string;
      col_id: string;
      child_matrix_id: string | null;
      board_id: string | null;
      data: Record<string, unknown>;
      features: string[];
    }>,
    kb_cols: (kbColsRes.data ?? []) as Array<{
      id: string;
      board_id: string;
      object_id?: string | null;
    }>,
    kb_cards: legacyShapes.kb_cards as unknown as Array<{ id: string; board_id: string }>,
    tasks: legacyShapes.tasks,
    atom_manifestations: legacyShapes.manifestations,
    checklists: (checklistsRes.data ?? []) as Array<{
      id: string;
      board_id: string | null;
      cell_id: string | null;
    }>,
    checklist_items: legacyShapes.checklist_items as unknown as Array<{
      id: string;
      checklist_id: string;
    }>,
    links: (linksRes.data ?? []) as Array<{ id: string; board_id: string }>,
    // WV.WV.1: docs.attached_cell_id existiert nicht mehr. Subtree-
    // Filter nutzt atom_manifestations(kind='pinned') (siehe Aufrufer).
    docs: (docsRes.data ?? []) as Array<{ id: string }>,
    workspace_tags: (workspaceTagsRes.data ?? []) as Array<{
      id: string;
      kind: string;
      value: string;
    }>,
    atom_tags: (atomTagsRes.data ?? []) as Array<{
      id: string;
      atom_type: string;
      atom_id: string;
      tag_id: string;
    }>,
    objects: (objectsRes.data ?? []) as Array<{ id: string }>,
    object_tags: (objectTagsRes.data ?? []) as Array<{
      object_id: string;
      tag_object_id: string;
    }>,
    groups: (groupsRes.data ?? []) as Array<{ id: string }>,
    group_members: (groupMembersRes.data ?? []) as Array<{
      group_id: string;
      object_id: string;
    }>,
  };
}

// Sammelt alle IDs, die zum Subtree unter rootNodeId gehoeren.
// Walk-Strategie: starte bei rootNodeId, fuege alle matrix-Cells dazu,
// folge deren child_matrix_id/board_id als neue Root-Nodes, rekursiv.
function collectSubtreeIds(
  rootNodeId: string,
  nodes: Array<{ id: string; parent_cell_id: string | null; type: string }>,
  cells: Array<{
    id: string;
    matrix_id: string;
    row_id: string;
    col_id: string;
    child_matrix_id: string | null;
    board_id: string | null;
  }>,
  rows: Array<{ id: string; matrix_id: string }>,
  cols: Array<{ id: string; matrix_id: string }>,
): SubtreeRowSet {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const set: SubtreeRowSet = {
    nodeIds: new Set(),
    cellIds: new Set(),
    rowIds: new Set(),
    colIds: new Set(),
  };
  const stack = [rootNodeId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) break;
    if (set.nodeIds.has(id)) continue;
    const node = nodeById.get(id);
    if (!node) continue;
    set.nodeIds.add(id);
    if (node.type === 'matrix') {
      // Rows + Cols dieser Matrix
      for (const r of rows) if (r.matrix_id === id) set.rowIds.add(r.id);
      for (const c of cols) if (c.matrix_id === id) set.colIds.add(c.id);
      // Cells + FKs auf Sub-Nodes
      for (const cell of cells) {
        if (cell.matrix_id !== id) continue;
        set.cellIds.add(cell.id);
        if (cell.child_matrix_id) stack.push(cell.child_matrix_id);
        if (cell.board_id) stack.push(cell.board_id);
      }
    }
    // Boards haben keine eigenen sub-nodes — sie sind Blaetter im Tree
    // (Cards/Checklists haengen direkt dran, per board_id FK).
  }
  return set;
}

export async function exportSubtree(
  rootNodeId: string,
  workspaceId: string,
): Promise<WorkspaceExport> {
  const all = await fetchWorkspaceRowsForExport(workspaceId);
  const sub = collectSubtreeIds(rootNodeId, all.nodes, all.cells, all.rows, all.cols);

  // Pro Tabelle auf Subtree filtern. Board-abhaengige Tabellen
  // (kb_cols, kb_cards, links, checklists mit board_id) ueber
  // nodeIds-Set gegen board_id matchen.
  const inNodes = (id: string) => sub.nodeIds.has(id);
  const inCells = (id: string) => sub.cellIds.has(id);

  // Root-Node im Export als "kontext-frei" markieren: parent_cell_id
  // wird auf null gesetzt, damit der Importer den Root erkennt — auch
  // wenn der Quell-Node im Ursprungs-Workspace eine Sub-Matrix (mit
  // parent_cell_id) war. Ohne diesen Strip findet die Import-Seite
  // keinen Start-Punkt und meldet "Export unvollstaendig".
  const filteredNodes = all.nodes
    .filter((n) => inNodes(n.id))
    .map((n) => (n.id === rootNodeId ? { ...n, parent_cell_id: null } : n));
  const filteredRows = all.rows.filter((r) => sub.rowIds.has(r.id));
  const filteredCols = all.cols.filter((c) => sub.colIds.has(c.id));
  const filteredCells = all.cells.filter((c) => inCells(c.id));
  const filteredKbCols = all.kb_cols.filter((k) => inNodes(k.board_id));
  const filteredKbCards = all.kb_cards.filter((k) => inNodes(k.board_id));
  const filteredChecklists = all.checklists.filter(
    (cl) => (cl.board_id && inNodes(cl.board_id)) || (cl.cell_id && inCells(cl.cell_id)),
  );
  const filteredChecklistIds = new Set(filteredChecklists.map((cl) => cl.id));
  const filteredChecklistItems = all.checklist_items.filter((it) =>
    filteredChecklistIds.has(it.checklist_id),
  );

  // Phase 4 T.1.I: Task-Layer-Subtree-Filter. Eine Task gehoert zum
  // Subtree, wenn mindestens eine ihrer Manifestations einen Container
  // im Subtree referenziert (oder sie kanban/checklist-projiziert auf
  // einen subtree-Card/Item ist). Standalone-Tasks (keine Manif) sind
  // workspace-global — Subtree-Export traegt sie nicht mit.
  // WV.WV.1: pinned-Manifestations am Subtree (container_kind='cell'
  // mit cell im Subtree, container_kind='node' mit node im Subtree)
  // wandern mit. atom-Pins (container_kind='atom') bleiben workspace-
  // global; Subtree-Export traegt sie nicht automatisch mit.
  const filteredKbColIds = new Set(filteredKbCols.map((k) => k.id));
  const filteredManifestations = all.atom_manifestations.filter((m) => {
    if (m.kind === 'pinned') {
      if (m.container_kind === 'cell') return m.container_id != null && inCells(m.container_id);
      if (m.container_kind === 'node') return m.container_id != null && inNodes(m.container_id);
      return false;
    }
    if (m.atom_type !== 'task') return false;
    if (m.kind === 'kanban') return m.container_id != null && filteredKbColIds.has(m.container_id);
    if (m.kind === 'checklist')
      return m.container_id != null && filteredChecklistIds.has(m.container_id);
    // calendar/standalone: workspace-global, im Subtree-Export nicht
    // automatisch enthalten — der User exportiert hier Struktur, nicht
    // den Kalender.
    return false;
  });
  const filteredTaskIds = new Set(
    filteredManifestations.filter((m) => m.atom_type === 'task').map((m) => m.atom_id),
  );
  const filteredTasks = all.tasks.filter((t) => filteredTaskIds.has(t.id));
  const filteredLinks = all.links.filter((l) => inNodes(l.board_id));
  // WV.WV.1: Doc-Subtree-Filter aus den pinned-Manifestations ableiten.
  // Eine Doku wandert mit, wenn mind. ein cell-Pin im Subtree liegt.
  const docIdsInSubtree = new Set<string>();
  for (const m of filteredManifestations) {
    if (m.kind === 'pinned' && m.atom_type === 'doc' && m.container_kind === 'cell') {
      docIdsInSubtree.add(m.atom_id);
    }
  }
  const filteredDocs = all.docs.filter((d) => docIdsInSubtree.has(d.id));

  // Welle D — atom_tags-Subtree-Filter. Tag-Owner = Atom; ein Tag
  // wandert nur mit, wenn der Owner-Atom im Subtree liegt. Owner-Atome:
  // Tasks (filteredTaskIds), Docs (docIdsInSubtree), Links (filteredLinks-
  // ids), Checklists (filteredChecklistIds). Imported-Events sind
  // workspace-global → im Subtree-Export raus. Referenced workspace_tags
  // werden ueber tag_id gesammelt — Registry-Rows wandern mit, damit
  // Imports ohne dangling-FK funktionieren.
  const filteredLinkIds = new Set(filteredLinks.map((l) => l.id));
  const filteredAtomTags = all.atom_tags.filter((t) => {
    if (t.atom_type === 'task') return filteredTaskIds.has(t.atom_id);
    if (t.atom_type === 'doc') return docIdsInSubtree.has(t.atom_id);
    if (t.atom_type === 'link') return filteredLinkIds.has(t.atom_id);
    if (t.atom_type === 'checklist') return filteredChecklistIds.has(t.atom_id);
    return false;
  });
  const referencedTagIds = new Set(filteredAtomTags.map((t) => t.tag_id));
  const filteredWorkspaceTags = all.workspace_tags.filter((t) => referencedTagIds.has(t.id));

  // AU-B1 K11c.2 (B1-A-006): Object-Layer-Subtree-Filter. Sammeln alle
  // object_ids, die von Subtree-Rows/Cols/KbCols/Nodes referenziert
  // werden — diese Objects + ihre Tags + Group-Memberships gehoeren
  // zum Subtree-Export.
  const referencedObjectIds = new Set<string>();
  for (const r of filteredRows) if (r.object_id) referencedObjectIds.add(r.object_id);
  for (const c of filteredCols) if (c.object_id) referencedObjectIds.add(c.object_id);
  for (const k of filteredKbCols) if (k.object_id) referencedObjectIds.add(k.object_id);
  for (const n of filteredNodes) if (n.object_id) referencedObjectIds.add(n.object_id);
  const filteredObjectTags = all.object_tags.filter(
    (t) => referencedObjectIds.has(t.object_id) || referencedObjectIds.has(t.tag_object_id),
  );
  // Tag-Pfeile koennen auf Objects ausserhalb des Subtree zeigen — die
  // muessen wir mit-exportieren, sonst zerreisst der Import die Tag-Kette.
  for (const t of filteredObjectTags) {
    referencedObjectIds.add(t.object_id);
    referencedObjectIds.add(t.tag_object_id);
  }
  const filteredObjects = all.objects.filter((o) => referencedObjectIds.has(o.id));
  const filteredGroupMembers = all.group_members.filter((m) =>
    referencedObjectIds.has(m.object_id),
  );
  const referencedGroupIds = new Set(filteredGroupMembers.map((m) => m.group_id));
  const filteredGroups = all.groups.filter((g) => referencedGroupIds.has(g.id));

  return {
    version: WORKSPACE_EXPORT_VERSION,
    payloadType: 'subtree',
    exportedAt: new Date().toISOString(),
    workspace: all.workspace,
    nodes: filteredNodes as unknown as Record<string, unknown>[],
    rows: filteredRows as unknown as Record<string, unknown>[],
    cols: filteredCols as unknown as Record<string, unknown>[],
    cells: filteredCells as unknown as Record<string, unknown>[],
    kb_cols: filteredKbCols as unknown as Record<string, unknown>[],
    kb_cards: filteredKbCards as unknown as Record<string, unknown>[],
    checklists: filteredChecklists as unknown as Record<string, unknown>[],
    checklist_items: filteredChecklistItems as unknown as Record<string, unknown>[],
    links: filteredLinks as unknown as Record<string, unknown>[],
    docs: filteredDocs as unknown as Record<string, unknown>[],
    workspace_tags: filteredWorkspaceTags as unknown as Record<string, unknown>[],
    atom_tags: filteredAtomTags as unknown as Record<string, unknown>[],
    objects: filteredObjects as unknown as Record<string, unknown>[],
    object_tags: filteredObjectTags as unknown as Record<string, unknown>[],
    groups: filteredGroups as unknown as Record<string, unknown>[],
    group_members: filteredGroupMembers as unknown as Record<string, unknown>[],
    tasks: filteredTasks as unknown as Record<string, unknown>[],
    atom_manifestations: filteredManifestations as unknown as Record<string, unknown>[],
  };
}

// Cell-Subtree: die Sub-Matrix/Sub-Board-Struktur der Zelle + ihre
// Info-Daten + Checklisten als "Paket" — so dass der Importer bei
// einer Ziel-Zelle mergen kann (Info-Felder/Links/Checklisten
// uebernehmen, Sub-Struktur anhaengen).
//
// Gestaltung:
// - Die Quell-Zelle selbst ist NICHT in payload.cells — sie ist der
//   Container, ihre Daten leben in payload.sourceCell.
// - Die Quell-Row/Col werden ebenfalls NICHT exportiert (sie gehoeren
//   zur Parent-Matrix, wuerden den Import verwirren).
// - Der Top-Sub-Node (sub_matrix bzw. sub_board) bekommt im Payload
//   parent_cell_id=null, damit der Importer ihn als neuen Root
//   erkennt.
// - Checklisten mit cell_id === sourceCellId werden mit-exportiert
//   (ihr cell_id bleibt stehen; der Importer faengt den "fremden"
//   cell_id ab und haengt sie an die Ziel-Zelle).
export async function exportCellSubtree(
  cellId: string,
  workspaceId: string,
): Promise<WorkspaceExport> {
  const all = await fetchWorkspaceRowsForExport(workspaceId);
  const cell = all.cells.find((c) => c.id === cellId);
  if (!cell) throw new Error('Die Zelle konnte nicht geladen werden — wurde sie gerade geloescht?');

  // Sub-Struktur sammeln (nur was unter der Cell haengt, ohne die
  // Cell/Row/Col selbst).
  const sub: SubtreeRowSet = {
    nodeIds: new Set(),
    cellIds: new Set(),
    rowIds: new Set(),
    colIds: new Set(),
  };
  for (const rootId of [cell.child_matrix_id, cell.board_id].filter((x): x is string => !!x)) {
    const sub2 = collectSubtreeIds(rootId, all.nodes, all.cells, all.rows, all.cols);
    for (const id of sub2.nodeIds) sub.nodeIds.add(id);
    for (const id of sub2.cellIds) sub.cellIds.add(id);
    for (const id of sub2.rowIds) sub.rowIds.add(id);
    for (const id of sub2.colIds) sub.colIds.add(id);
  }

  const inNodes = (id: string) => sub.nodeIds.has(id);
  const inCells = (id: string) => sub.cellIds.has(id);

  // Nodes: die, deren parent_cell_id == sourceCellId ist, werden im
  // Export zu Roots (parent_cell_id=null). Der Importer entscheidet
  // dann, wo sie hingehaengt werden.
  const filteredNodes = all.nodes
    .filter((n) => inNodes(n.id))
    .map((n) => (n.parent_cell_id === cellId ? { ...n, parent_cell_id: null } : n));

  const filteredRows = all.rows.filter((r) => sub.rowIds.has(r.id));
  const filteredCols = all.cols.filter((c) => sub.colIds.has(c.id));
  const filteredCells = all.cells.filter((c) => inCells(c.id));
  const filteredKbCols = all.kb_cols.filter((k) => inNodes(k.board_id));
  const filteredKbCards = all.kb_cards.filter((k) => inNodes(k.board_id));
  // Checklisten: board-scoped (in exportierten Boards) UND solche,
  // die direkt an der Quell-Zelle haengen (cell_id === cellId).
  const filteredChecklists = all.checklists.filter(
    (cl) =>
      (cl.board_id && inNodes(cl.board_id)) ||
      cl.cell_id === cellId ||
      (cl.cell_id && inCells(cl.cell_id)),
  );
  const filteredChecklistIds = new Set(filteredChecklists.map((cl) => cl.id));
  const filteredChecklistItems = all.checklist_items.filter((it) =>
    filteredChecklistIds.has(it.checklist_id),
  );
  const filteredLinks = all.links.filter((l) => inNodes(l.board_id));

  // Phase 4 T.1.I + Q.2: Task-Layer-Subtree-Filter (analog exportSubtree).
  // WV.WV.1: pinned-Manifestations am Subtree (container_kind='cell' mit
  // cellId selbst oder Cell im Subtree, container_kind='node' mit node
  // im Subtree) wandern mit. atom-Pins (container_kind='atom') bleiben
  // workspace-global.
  const filteredKbColIdsCell = new Set(filteredKbCols.map((k) => k.id));
  const filteredManifestationsCell = all.atom_manifestations.filter((m) => {
    if (m.kind === 'pinned') {
      if (m.container_kind === 'cell') {
        return m.container_id != null && (m.container_id === cellId || inCells(m.container_id));
      }
      if (m.container_kind === 'node') return m.container_id != null && inNodes(m.container_id);
      return false;
    }
    if (m.atom_type !== 'task') return false;
    if (m.kind === 'kanban')
      return m.container_id != null && filteredKbColIdsCell.has(m.container_id);
    if (m.kind === 'checklist')
      return m.container_id != null && filteredChecklistIds.has(m.container_id);
    return false;
  });
  const filteredTaskIdsCell = new Set(
    filteredManifestationsCell.filter((m) => m.atom_type === 'task').map((m) => m.atom_id),
  );
  const filteredTasksCell = all.tasks.filter((t) => filteredTaskIdsCell.has(t.id));
  // WV.WV.1: Doc-Subtree-Filter aus pinned-Manifestations.
  const docIdsInSubtreeCell = new Set<string>();
  for (const m of filteredManifestationsCell) {
    if (m.kind === 'pinned' && m.atom_type === 'doc' && m.container_kind === 'cell') {
      docIdsInSubtreeCell.add(m.atom_id);
    }
  }
  const filteredDocs = all.docs.filter((d) => docIdsInSubtreeCell.has(d.id));

  // Welle D — atom_tags + workspace_tags fuer Cell-Subtree (analog
  // exportSubtree, aber mit den Cell-Subtree-Owner-Sets).
  const filteredLinkIdsCell = new Set(filteredLinks.map((l) => l.id));
  const filteredAtomTagsCell = all.atom_tags.filter((t) => {
    if (t.atom_type === 'task') return filteredTaskIdsCell.has(t.atom_id);
    if (t.atom_type === 'doc') return docIdsInSubtreeCell.has(t.atom_id);
    if (t.atom_type === 'link') return filteredLinkIdsCell.has(t.atom_id);
    if (t.atom_type === 'checklist') return filteredChecklistIds.has(t.atom_id);
    return false;
  });
  const referencedTagIdsCell = new Set(filteredAtomTagsCell.map((t) => t.tag_id));
  const filteredWorkspaceTagsCell = all.workspace_tags.filter((t) =>
    referencedTagIdsCell.has(t.id),
  );

  return {
    version: WORKSPACE_EXPORT_VERSION,
    payloadType: 'subtree',
    exportedAt: new Date().toISOString(),
    workspace: all.workspace,
    nodes: filteredNodes as unknown as Record<string, unknown>[],
    rows: filteredRows as unknown as Record<string, unknown>[],
    cols: filteredCols as unknown as Record<string, unknown>[],
    cells: filteredCells as unknown as Record<string, unknown>[],
    kb_cols: filteredKbCols as unknown as Record<string, unknown>[],
    kb_cards: filteredKbCards as unknown as Record<string, unknown>[],
    checklists: filteredChecklists as unknown as Record<string, unknown>[],
    checklist_items: filteredChecklistItems as unknown as Record<string, unknown>[],
    links: filteredLinks as unknown as Record<string, unknown>[],
    docs: filteredDocs as unknown as Record<string, unknown>[],
    workspace_tags: filteredWorkspaceTagsCell as unknown as Record<string, unknown>[],
    atom_tags: filteredAtomTagsCell as unknown as Record<string, unknown>[],
    tasks: filteredTasksCell as unknown as Record<string, unknown>[],
    atom_manifestations: filteredManifestationsCell as unknown as Record<string, unknown>[],
    sourceCell: {
      data: cell.data ?? {},
      features: Array.isArray(cell.features) ? cell.features : [],
    },
  };
}

// Subtree-Download mit automatischem Dateinamen-Präfix basierend auf
// Label (Workspace-Name wird vom Workspace-Export-Download verwendet,
// hier leiten wir Kontext aus dem Subtree-Root ab).
export async function downloadSubtreeExport(
  exportData: WorkspaceExport,
  filenameLabel: string,
  encrypt?: { passphrase: string },
): Promise<void> {
  const pretty = JSON.stringify(exportData, null, 2);
  const content = encrypt ? await encryptPayload(pretty, encrypt.passphrase) : pretty;
  const blob = new Blob([content], {
    type: encrypt ? 'application/octet-stream' : 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  const safeLabel =
    (filenameLabel || 'subtree')
      .replace(/[^a-z0-9-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'subtree';
  // Dateinamen-Prefix unterscheidet die Payload-Typen, damit der User
  // spaeter beim Import-Flow erkennt was er gerade offen hat.
  const prefix =
    exportData.payloadType === 'feature-info'
      ? 'info'
      : exportData.payloadType === 'feature-checklists'
        ? 'checklists'
        : 'subtree';
  a.href = url;
  a.download = `${prefix}-${safeLabel}-${date}.${encrypt ? 'imx' : 'json'}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ─── Feature-Export ────────────────────────────────────────────
// Feature-spezifische Exports liefern genau die minimalen Tabellen-
// Rows, die der Import-Seite reichen, um Felder/Links bzw. Listen
// anzuhaengen. Die Cell-Row selbst ist enthalten, aber nur als
// Container fuer cell.data.infoFields/links. Der Importer nutzt die
// Cell-Row *nicht* zum Erzeugen einer neuen Zelle — die Target-
// Zelle wird vom Import-Menue gewaehlt.

export async function exportFeatureInfo(
  cellId: string,
  workspaceId: string,
): Promise<WorkspaceExport> {
  const all = await fetchWorkspaceRowsForExport(workspaceId);
  const cell = all.cells.find((c) => c.id === cellId);
  if (!cell) throw new Error('Die Zelle konnte nicht geladen werden — wurde sie gerade geloescht?');
  return {
    version: WORKSPACE_EXPORT_VERSION,
    payloadType: 'feature-info',
    exportedAt: new Date().toISOString(),
    workspace: all.workspace,
    nodes: [],
    rows: [],
    cols: [],
    // Nur diese eine Cell-Row — ihre data.infoFields + .links sind
    // der Inhalt. Der Importer liest nur diese Felder aus.
    cells: [cell as unknown as Record<string, unknown>],
    kb_cols: [],
    kb_cards: [],
    checklists: [],
    checklist_items: [],
    links: [],
    docs: [],
  };
}

export async function exportFeatureChecklists(
  cellId: string,
  workspaceId: string,
): Promise<WorkspaceExport> {
  const all = await fetchWorkspaceRowsForExport(workspaceId);
  const cell = all.cells.find((c) => c.id === cellId);
  if (!cell) throw new Error('Die Zelle konnte nicht geladen werden — wurde sie gerade geloescht?');
  const cellChecklists = all.checklists.filter((cl) => cl.cell_id === cellId);
  const clIds = new Set(cellChecklists.map((cl) => cl.id));
  const items = all.checklist_items.filter((it) => clIds.has(it.checklist_id));
  // Welle D — atom_tags fuer die Checklist-Atoms mit-exportieren.
  // workspace_tags-Registry ueber referenced tag_ids verkuerzen.
  const checklistTags = all.atom_tags.filter(
    (t) => t.atom_type === 'checklist' && clIds.has(t.atom_id),
  );
  const refTagIds = new Set(checklistTags.map((t) => t.tag_id));
  const checklistRegistryTags = all.workspace_tags.filter((t) => refTagIds.has(t.id));
  return {
    version: WORKSPACE_EXPORT_VERSION,
    payloadType: 'feature-checklists',
    exportedAt: new Date().toISOString(),
    workspace: all.workspace,
    nodes: [],
    rows: [],
    cols: [],
    cells: [cell as unknown as Record<string, unknown>],
    kb_cols: [],
    kb_cards: [],
    checklists: cellChecklists as unknown as Record<string, unknown>[],
    checklist_items: items as unknown as Record<string, unknown>[],
    links: [],
    docs: [],
    workspace_tags: checklistRegistryTags as unknown as Record<string, unknown>[],
    atom_tags: checklistTags as unknown as Record<string, unknown>[],
  };
}
