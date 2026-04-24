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

// Payload-Typ-Tag. 'workspace' und 'subtree' haben dieselbe Shape
// (alle Tabellen); 'feature-info' enthaelt genau eine Cell (ohne
// FK-Ziele), deren data.infoFields + .links der eigentliche Inhalt
// sind. 'feature-checklists' enthaelt eine Cell + cell-scoped
// Checklisten + Items.
export type ExportPayloadType =
  | 'workspace'
  | 'subtree'
  | 'feature-info'
  | 'feature-checklists';

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
  };
}

export function formatExportStats(s: ExportStats): string {
  // Nur Zahlen > 0 anzeigen — ein Feature-Export zeigt sonst nutzlose
  // 0-Zeilen.
  const parts: string[] = [];
  if (s.matrixCount)
    parts.push(
      `${s.matrixCount} ${s.matrixCount === 1 ? 'Matrix' : 'Matrizen'}`,
    );
  if (s.boardCount)
    parts.push(`${s.boardCount} ${s.boardCount === 1 ? 'Board' : 'Boards'}`);
  if (s.cells) parts.push(`${s.cells} ${s.cells === 1 ? 'Zelle' : 'Zellen'}`);
  if (s.cards) parts.push(`${s.cards} ${s.cards === 1 ? 'Karte' : 'Karten'}`);
  if (s.checklists)
    parts.push(
      `${s.checklists} ${s.checklists === 1 ? 'Checkliste' : 'Checklisten'}`,
    );
  if (s.checklistItems)
    parts.push(
      `${s.checklistItems} ${s.checklistItems === 1 ? 'Punkt' : 'Punkte'}`,
    );
  if (s.links) parts.push(`${s.links} Board-Links`);
  if (s.infoFields)
    parts.push(
      `${s.infoFields} ${s.infoFields === 1 ? 'Info-Feld' : 'Info-Felder'}`,
    );
  if (s.infoLinks)
    parts.push(
      `${s.infoLinks} ${s.infoLinks === 1 ? 'Info-Link' : 'Info-Links'}`,
    );
  return parts.length === 0 ? '(leer)' : parts.join(' · ');
}

export function summarizeExport(e: WorkspaceExport): string {
  return formatExportStats(statsOf(e));
}

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
    payloadType: 'workspace',
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
    wsRes,
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
    supabase.from('workspaces').select('*').eq('id', workspaceId).single(),
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
    wsRes,
  ]) {
    if (res.error) throw res.error;
  }
  return {
    workspace: wsRes.data as Record<string, unknown>,
    nodes: (nodesRes.data ?? []) as Array<{ id: string; parent_cell_id: string | null; type: string }>,
    rows: (rowsRes.data ?? []) as Array<{ id: string; matrix_id: string }>,
    cols: (colsRes.data ?? []) as Array<{ id: string; matrix_id: string }>,
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
    kb_cols: (kbColsRes.data ?? []) as Array<{ id: string; board_id: string }>,
    kb_cards: (kbCardsRes.data ?? []) as Array<{ id: string; board_id: string }>,
    checklists: (checklistsRes.data ?? []) as Array<{
      id: string;
      board_id: string | null;
      cell_id: string | null;
    }>,
    checklist_items: (checklistItemsRes.data ?? []) as Array<{
      id: string;
      checklist_id: string;
    }>,
    links: (linksRes.data ?? []) as Array<{ id: string; board_id: string }>,
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
    const id = stack.pop()!;
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
  const sub = collectSubtreeIds(
    rootNodeId,
    all.nodes,
    all.cells,
    all.rows,
    all.cols,
  );

  // Pro Tabelle auf Subtree filtern. Board-abhaengige Tabellen
  // (kb_cols, kb_cards, links, checklists mit board_id) ueber
  // nodeIds-Set gegen board_id matchen.
  const inNodes = (id: string) => sub.nodeIds.has(id);
  const inCells = (id: string) => sub.cellIds.has(id);

  const filteredNodes = all.nodes.filter((n) => inNodes(n.id));
  const filteredRows = all.rows.filter((r) => sub.rowIds.has(r.id));
  const filteredCols = all.cols.filter((c) => sub.colIds.has(c.id));
  const filteredCells = all.cells.filter((c) => inCells(c.id));
  const filteredKbCols = all.kb_cols.filter((k) => inNodes(k.board_id));
  const filteredKbCards = all.kb_cards.filter((k) => inNodes(k.board_id));
  const filteredChecklists = all.checklists.filter(
    (cl) =>
      (cl.board_id && inNodes(cl.board_id)) ||
      (cl.cell_id && inCells(cl.cell_id)),
  );
  const filteredChecklistIds = new Set(filteredChecklists.map((cl) => cl.id));
  const filteredChecklistItems = all.checklist_items.filter((it) =>
    filteredChecklistIds.has(it.checklist_id),
  );
  const filteredLinks = all.links.filter((l) => inNodes(l.board_id));

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
    checklist_items:
      filteredChecklistItems as unknown as Record<string, unknown>[],
    links: filteredLinks as unknown as Record<string, unknown>[],
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
  if (!cell)
    throw new Error(
      'Die Zelle konnte nicht geladen werden — wurde sie gerade geloescht?',
    );

  // Sub-Struktur sammeln (nur was unter der Cell haengt, ohne die
  // Cell/Row/Col selbst).
  const sub: SubtreeRowSet = {
    nodeIds: new Set(),
    cellIds: new Set(),
    rowIds: new Set(),
    colIds: new Set(),
  };
  for (const rootId of [cell.child_matrix_id, cell.board_id].filter(
    (x): x is string => !!x,
  )) {
    const sub2 = collectSubtreeIds(
      rootId,
      all.nodes,
      all.cells,
      all.rows,
      all.cols,
    );
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
    checklist_items:
      filteredChecklistItems as unknown as Record<string, unknown>[],
    links: filteredLinks as unknown as Record<string, unknown>[],
    sourceCell: {
      data: cell.data ?? {},
      features: Array.isArray(cell.features) ? cell.features : [],
    },
  };
}

// Subtree-Download mit automatischem Dateinamen-Präfix basierend auf
// Label (Workspace-Name wird vom Workspace-Export-Download verwendet,
// hier leiten wir Kontext aus dem Subtree-Root ab).
export function downloadSubtreeExport(
  exportData: WorkspaceExport,
  filenameLabel: string,
): void {
  const pretty = JSON.stringify(exportData, null, 2);
  const blob = new Blob([pretty], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  const safeLabel = (filenameLabel || 'subtree')
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
  a.download = `${prefix}-${safeLabel}-${date}.json`;
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
  if (!cell)
    throw new Error(
      'Die Zelle konnte nicht geladen werden — wurde sie gerade geloescht?',
    );
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
  };
}

export async function exportFeatureChecklists(
  cellId: string,
  workspaceId: string,
): Promise<WorkspaceExport> {
  const all = await fetchWorkspaceRowsForExport(workspaceId);
  const cell = all.cells.find((c) => c.id === cellId);
  if (!cell)
    throw new Error(
      'Die Zelle konnte nicht geladen werden — wurde sie gerade geloescht?',
    );
  const cellChecklists = all.checklists.filter((cl) => cl.cell_id === cellId);
  const clIds = new Set(cellChecklists.map((cl) => cl.id));
  const items = all.checklist_items.filter((it) => clIds.has(it.checklist_id));
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
  };
}
