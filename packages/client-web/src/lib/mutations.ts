// Schreibende Operationen gegen die DB. Pattern:
//   - Rueckgabe: die frische DB-Row (via .select().single())
//   - Fehler: Original-PostgrestError wird weitergeworfen, der Caller
//     uebersetzt mit translateDbError() + showToast().
//   - Kein Optimistic-Update; Caller ruft refetch() nach Success.
//
// Wird 0e.1 inkrementell fuer alle Tabellen erweitert.

import { supabase } from './supabase';
import type {
  CellRow,
  ChecklistCloseMode,
  ChecklistItemRow,
  ChecklistRow,
  ColRow,
  InfoField,
  InfoLink,
  InlineChecklistItem,
  KbCardRow,
  KbColRow,
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
}): Promise<RowRow> {
  const pos = await nextPosition('rows', args.matrixId, args.workspaceId);
  const { data, error } = await supabase
    .from('rows')
    .insert({
      workspace_id: args.workspaceId,
      matrix_id: args.matrixId,
      label: args.label ?? '',
      position: pos,
    })
    .select()
    .single();
  if (error) throw error;
  return data as RowRow;
}

export async function renameRow(rowId: string, label: string): Promise<RowRow> {
  const { data, error } = await supabase
    .from('rows')
    .update({ label })
    .eq('id', rowId)
    .select()
    .single();
  if (error) throw error;
  return data as RowRow;
}

export async function delRow(rowId: string): Promise<void> {
  const { error } = await supabase.from('rows').delete().eq('id', rowId);
  if (error) throw error;
}

// ─── cols ──────────────────────────────────────────────────────
export async function addCol(args: {
  workspaceId: string;
  matrixId: string;
  label?: string;
}): Promise<ColRow> {
  const pos = await nextPosition('cols', args.matrixId, args.workspaceId);
  const { data, error } = await supabase
    .from('cols')
    .insert({
      workspace_id: args.workspaceId,
      matrix_id: args.matrixId,
      label: args.label ?? '',
      position: pos,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ColRow;
}

export async function renameCol(colId: string, label: string): Promise<ColRow> {
  const { data, error } = await supabase
    .from('cols')
    .update({ label })
    .eq('id', colId)
    .select()
    .single();
  if (error) throw error;
  return data as ColRow;
}

export async function delCol(colId: string): Promise<void> {
  const { error } = await supabase.from('cols').delete().eq('id', colId);
  if (error) throw error;
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
  const { data, error } = await supabase
    .from('cells')
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  return data as CellRow;
}

export async function updateCell(cellId: string, patch: CellPatch): Promise<CellRow> {
  const { data, error } = await supabase
    .from('cells')
    .update(patch)
    .eq('id', cellId)
    .select()
    .single();
  if (error) throw error;
  return data as CellRow;
}

export async function delCellRow(cellId: string): Promise<void> {
  const { error } = await supabase.from('cells').delete().eq('id', cellId);
  if (error) throw error;
}

// ─── Structural Sub-Nodes (Matrix / Board an Zelle) ────────────
// Two-Step: nodes-INSERT + cells-UPSERT. Atomar wird das erst in 0e.2
// als Postgres-RPC. Fuer 0e.1.b: sequenziell, bei Fehler im 2. Schritt
// bleibt ein verwaister nodes-Eintrag — Toast informiert, Cleanup manuell.

async function createChildNode(args: {
  workspaceId: string;
  parentCellId: string;
  type: 'matrix' | 'board';
  label: string;
}): Promise<NodeRow> {
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
export async function deleteNode(nodeId: string): Promise<void> {
  const { error } = await supabase.from('nodes').delete().eq('id', nodeId);
  if (error) throw error;
}

// ─── Kanban-Spalten ────────────────────────────────────────────
export async function addKbCol(args: {
  workspaceId: string;
  boardId: string;
  label?: string;
  color?: string | null;
}): Promise<KbColRow> {
  const pos = await nextBoardPosition('kb_cols', args.boardId, args.workspaceId);
  const { data, error } = await supabase
    .from('kb_cols')
    .insert({
      workspace_id: args.workspaceId,
      board_id: args.boardId,
      label: args.label ?? '',
      position: pos,
      color: args.color ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as KbColRow;
}

export async function renameKbCol(colId: string, label: string): Promise<KbColRow> {
  const { data, error } = await supabase
    .from('kb_cols')
    .update({ label })
    .eq('id', colId)
    .select()
    .single();
  if (error) throw error;
  return data as KbColRow;
}

export async function setKbColColor(
  colId: string,
  color: string | null,
): Promise<KbColRow> {
  const { data, error } = await supabase
    .from('kb_cols')
    .update({ color })
    .eq('id', colId)
    .select()
    .single();
  if (error) throw error;
  return data as KbColRow;
}

export async function delKbCol(colId: string): Promise<void> {
  const { error } = await supabase.from('kb_cols').delete().eq('id', colId);
  if (error) throw error;
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
  >
>;

async function updateCard(cardId: string, patch: CardPatch): Promise<KbCardRow> {
  const { data, error } = await supabase
    .from('kb_cards')
    .update(patch)
    .eq('id', cardId)
    .select()
    .single();
  if (error) throw error;
  return data as KbCardRow;
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

export function setCardAlias(
  cardId: string,
  alias: string | null,
): Promise<KbCardRow> {
  return updateCard(cardId, { alias });
}

export function setCardDeadline(
  cardId: string,
  deadline: string | null,
): Promise<KbCardRow> {
  return updateCard(cardId, { deadline });
}

export function setCardPriority(
  cardId: string,
  priority: number | null,
): Promise<KbCardRow> {
  return updateCard(cardId, { priority });
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
  const pos = await nextBoardPosition(
    'kb_cards',
    args.boardId,
    args.workspaceId,
    { col_id: args.toColId },
  );
  const { data, error } = await supabase
    .from('kb_cards')
    .update({ col_id: args.toColId, position: pos })
    .eq('id', args.cardId)
    .select()
    .single();
  if (error) throw error;
  return data as KbCardRow;
}

export async function delCard(cardId: string): Promise<void> {
  const { error } = await supabase.from('kb_cards').delete().eq('id', cardId);
  if (error) throw error;
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
}

// Zellen-Checkliste: cell_id statt board_id. Position innerhalb der
// Zelle (eigene Reihenfolge pro cell_id).
async function nextCellChecklistPosition(
  cellId: string,
  workspaceId: string,
): Promise<number> {
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
}

type ChecklistPatch = Partial<
  Pick<ChecklistRow, 'label' | 'alias' | 'close_mode'>
>;

async function updateChecklist(
  clId: string,
  patch: ChecklistPatch,
): Promise<ChecklistRow> {
  const { data, error } = await supabase
    .from('checklists')
    .update(patch)
    .eq('id', clId)
    .select()
    .single();
  if (error) throw error;
  return data as ChecklistRow;
}

export function renameChecklist(
  clId: string,
  label: string,
): Promise<ChecklistRow> {
  return updateChecklist(clId, { label });
}

export function setChecklistAlias(
  clId: string,
  alias: string | null,
): Promise<ChecklistRow> {
  return updateChecklist(clId, { alias });
}

export function setChecklistCloseMode(
  clId: string,
  mode: ChecklistCloseMode,
): Promise<ChecklistRow> {
  return updateChecklist(clId, { close_mode: mode });
}

export async function delChecklist(clId: string): Promise<void> {
  const { error } = await supabase.from('checklists').delete().eq('id', clId);
  if (error) throw error;
}

// ─── Checklist-Items ───────────────────────────────────────────
async function nextItemPosition(
  checklistId: string,
  workspaceId: string,
): Promise<number> {
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
}

type ItemPatch = Partial<Pick<ChecklistItemRow, 'text' | 'done' | 'level' | 'position'>>;

async function updateItem(itemId: string, patch: ItemPatch): Promise<ChecklistItemRow> {
  const { data, error } = await supabase
    .from('checklist_items')
    .update(patch)
    .eq('id', itemId)
    .select()
    .single();
  if (error) throw error;
  return data as ChecklistItemRow;
}

export function renameChecklistItem(
  itemId: string,
  text: string,
): Promise<ChecklistItemRow> {
  return updateItem(itemId, { text });
}

export function toggleChecklistItemDone(
  itemId: string,
  done: boolean,
): Promise<ChecklistItemRow> {
  return updateItem(itemId, { done });
}

export function setChecklistItemLevel(
  itemId: string,
  level: 0 | 1 | 2,
): Promise<ChecklistItemRow> {
  return updateItem(itemId, { level });
}

export function setChecklistItemPosition(
  itemId: string,
  position: number,
): Promise<ChecklistItemRow> {
  return updateItem(itemId, { position });
}

export async function delChecklistItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('checklist_items').delete().eq('id', itemId);
  if (error) throw error;
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
  const { data: cur, error: readErr } = await supabase
    .from('cells')
    .select('data')
    .eq('id', cellId)
    .single();
  if (readErr) throw readErr;
  const cellData = (cur?.data ?? {}) as Record<string, unknown>;
  const { data: nextData, result } = mutator(cellData);
  const { error: writeErr } = await supabase
    .from('cells')
    .update({ data: nextData })
    .eq('id', cellId);
  if (writeErr) throw writeErr;
  return result;
}

function readInfoFields(data: Record<string, unknown>): InfoField[] {
  const raw = (data as { infoFields?: unknown }).infoFields;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f): f is InfoField =>
      !!f &&
      typeof f === 'object' &&
      typeof (f as InfoField).id === 'string' &&
      typeof (f as InfoField).label === 'string' &&
      typeof (f as InfoField).value === 'string',
  );
}

function genInfoFieldId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'if_' + Math.random().toString(36).slice(2, 10);
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
    const fields = readInfoFields(cellData).map((f) =>
      f.id === fieldId ? { ...f, label } : f,
    );
    return { data: { ...cellData, infoFields: fields }, result: undefined };
  });
}

export async function setCellInfoFieldValue(
  cellId: string,
  fieldId: string,
  value: string,
): Promise<void> {
  await mutateCellData(cellId, (cellData) => {
    const fields = readInfoFields(cellData).map((f) =>
      f.id === fieldId ? { ...f, value } : f,
    );
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

export async function delCellInfoField(
  cellId: string,
  fieldId: string,
): Promise<void> {
  await mutateCellData(cellId, (cellData) => {
    const fields = readInfoFields(cellData).filter((f) => f.id !== fieldId);
    return { data: { ...cellData, infoFields: fields }, result: undefined };
  });
}

// ─── Zell-Links (cell.data.links[]) ────────────────────────────
// Analog zu infoFields: JSONB-Array auf cell.data. URL wird per
// sanitizeUrl gefiltert (javascript:/data:/vbscript: werden abgelehnt).
// Kein DB-Unique-Constraint auf Alias — JSONB-Links fuehren (vorerst)
// keinen Alias; siehe types.ts/InfoLink-Kommentar.
function readInfoLinks(data: Record<string, unknown>): InfoLink[] {
  const raw = (data as { links?: unknown }).links;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (l): l is InfoLink =>
      !!l &&
      typeof l === 'object' &&
      typeof (l as InfoLink).id === 'string' &&
      typeof (l as InfoLink).label === 'string' &&
      typeof (l as InfoLink).url === 'string',
  );
}

function genInfoLinkId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'il_' + Math.random().toString(36).slice(2, 10);
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
    const links = readInfoLinks(cellData).map((l) =>
      l.id === linkId ? { ...l, label } : l,
    );
    return { data: { ...cellData, links }, result: undefined };
  });
}

export async function setCellLinkUrl(
  cellId: string,
  linkId: string,
  url: string,
): Promise<void> {
  const safeUrl = sanitizeUrl(url);
  if (!safeUrl) throw new InvalidUrlError();
  await mutateCellData(cellId, (cellData) => {
    const links = readInfoLinks(cellData).map((l) =>
      l.id === linkId ? { ...l, url: safeUrl } : l,
    );
    return { data: { ...cellData, links }, result: undefined };
  });
}

export async function moveCellLink(
  cellId: string,
  linkId: string,
  dir: -1 | 1,
): Promise<void> {
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

export async function delCellLink(
  cellId: string,
  linkId: string,
): Promise<void> {
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
  const { data: cur, error: readErr } = await supabase
    .from('kb_cards')
    .select('checklist')
    .eq('id', cardId)
    .single();
  if (readErr) throw readErr;
  const raw = (cur as { checklist: unknown } | null)?.checklist;
  const current: InlineChecklistItem[] = Array.isArray(raw)
    ? (raw as InlineChecklistItem[])
    : [];
  const { items, result } = mutator(current);
  const { error: writeErr } = await supabase
    .from('kb_cards')
    .update({ checklist: items })
    .eq('id', cardId);
  if (writeErr) throw writeErr;
  return result;
}

function genInlineItemId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'ii_' + Math.random().toString(36).slice(2, 10);
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
    items: items
      .map(ensureItemId)
      .map((it) => (it.id === itemId ? { ...it, done } : it)),
    result: undefined,
  }));
}

export async function renameCardInlineItem(
  cardId: string,
  itemId: string,
  text: string,
): Promise<void> {
  await mutateCardChecklist(cardId, (items) => ({
    items: items
      .map(ensureItemId)
      .map((it) => (it.id === itemId ? { ...it, text } : it)),
    result: undefined,
  }));
}

export async function delCardInlineItem(
  cardId: string,
  itemId: string,
): Promise<void> {
  await mutateCardChecklist(cardId, (items) => ({
    items: items.map(ensureItemId).filter((it) => it.id !== itemId),
    result: undefined,
  }));
}
