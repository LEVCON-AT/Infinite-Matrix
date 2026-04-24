// Subtree/Feature-Import fuer das Client-Web. Liest die
// WorkspaceExport-Shape aus lib/export.ts (nicht die AltPayload-Shape
// aus lib/import.ts — das ist der HTML-Client-Round-Trip) und fuegt
// den Inhalt in einen bestehenden Workspace ein.
//
// Target-Arten:
//   - 'matrix'           payloadType muss 'subtree' sein; Subtree wird
//                        als NEUE Zelle in der Target-Matrix angehaengt
//                        (erste freie Row/Col oder am Ende, neue Cell
//                        mit child_matrix_id/board_id des Roots).
//   - 'cell'             payloadType 'subtree' haengt an die Cell als
//                        child_matrix_id oder board_id (je nach Root-
//                        Typ). payloadType 'feature-info' oder
//                        'feature-checklists' mergt die Inhalte in die
//                        Target-Cell.
//   - 'feature-info'     nur payloadType 'feature-info'; Felder/Links
//                        aus Source.cells[0].data werden an Target-
//                        Cell.data angehaengt.
//   - 'feature-checklists' nur payloadType 'feature-checklists';
//                        Checklisten + Items werden an Target-Cell
//                        gehaengt.
//
// Type-Mismatch -> Error. UUID-Remap gegen Kollision + Alias-Dedup.

import { supabase } from './supabase';
import type { ExportPayloadType, WorkspaceExport } from './export';
import { WORKSPACE_EXPORT_VERSION } from './export';

export class ImportError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ImportError';
  }
}

export type ImportTarget =
  | { kind: 'matrix'; matrixNodeId: string }
  | { kind: 'cell'; cellId: string }
  | { kind: 'feature-info'; cellId: string }
  | { kind: 'feature-checklists'; cellId: string };

export function parseImportPayload(rawJson: string): WorkspaceExport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new ImportError(
      'Diese Datei ist keine gueltige JSON-Datei. Waehle einen Infinite-Matrix-Export.',
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ImportError(
      'Diese Datei sieht nicht wie ein Infinite-Matrix-Export aus.',
    );
  }
  const p = parsed as Record<string, unknown>;
  if (p.version !== WORKSPACE_EXPORT_VERSION) {
    throw new ImportError(
      `Diese Export-Datei kommt aus einer anderen Version (${String(p.version)}). Unterstuetzt wird aktuell nur Version ${WORKSPACE_EXPORT_VERSION}.`,
    );
  }
  const payloadType = p.payloadType as ExportPayloadType | undefined;
  if (
    payloadType !== 'workspace' &&
    payloadType !== 'subtree' &&
    payloadType !== 'feature-info' &&
    payloadType !== 'feature-checklists'
  ) {
    throw new ImportError(
      'Diese Datei hat keinen erkennbaren Export-Typ. Vielleicht stammt sie aus einem anderen Tool?',
    );
  }
  // Minimale Struktur-Checks — fehlende Arrays werden auf [] ersetzt
  // (robust gegen Schema-Evolution der Export-Seite).
  const arr = (key: string): Record<string, unknown>[] => {
    const v = p[key];
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  };
  return {
    version: WORKSPACE_EXPORT_VERSION,
    payloadType,
    exportedAt: typeof p.exportedAt === 'string' ? p.exportedAt : '',
    workspace:
      p.workspace && typeof p.workspace === 'object'
        ? (p.workspace as Record<string, unknown>)
        : {},
    nodes: arr('nodes'),
    rows: arr('rows'),
    cols: arr('cols'),
    cells: arr('cells'),
    kb_cols: arr('kb_cols'),
    kb_cards: arr('kb_cards'),
    checklists: arr('checklists'),
    checklist_items: arr('checklist_items'),
    links: arr('links'),
  };
}

// Checkt, ob der Payload-Typ zum Target passt, und formatiert eine
// deutsche Mismatch-Meldung falls nicht.
export function checkTypeCompatibility(
  payload: WorkspaceExport,
  target: ImportTarget,
): string | null {
  const p = payload.payloadType;
  switch (target.kind) {
    case 'matrix':
      if (p !== 'subtree' && p !== 'workspace') {
        return 'In eine Matrix kannst du nur einen Bereichs-Export laden (eine komplette Matrix oder ein komplettes Board). Einzelne Info- oder Checklisten-Exporte gehoeren in eine Zelle.';
      }
      return null;
    case 'cell':
      if (
        p !== 'subtree' &&
        p !== 'feature-info' &&
        p !== 'feature-checklists'
      ) {
        return 'In eine Zelle passt nur ein Bereichs-Export (Matrix/Board) oder ein Feature-Export (Info/Checklisten). Diese Datei hat einen anderen Typ.';
      }
      return null;
    case 'feature-info':
      if (p !== 'feature-info') {
        return 'Hier kannst du nur Info-Exporte einfuegen (Felder + Links). Bitte waehle eine passende Datei.';
      }
      return null;
    case 'feature-checklists':
      if (p !== 'feature-checklists') {
        return 'Hier kannst du nur Checklisten-Exporte einfuegen. Bitte waehle eine passende Datei.';
      }
      return null;
  }
}

function newUuid(): string {
  return crypto.randomUUID();
}

// UUID-Remap: alle alten IDs werden auf neue UUIDs gemappt. Die Map
// wird schrittweise aufgebaut, damit FK-Felder aufgeloest werden
// koennen. Tabellen-FKs: node.parent_cell_id, cells.matrix_id/row_id/
// col_id/child_matrix_id/board_id, kb_cols/kb_cards/links.board_id,
// kb_cards.col_id, checklists.board_id/cell_id, checklist_items.
// checklist_id, info-field-ids und info-link-ids (bleiben, weil sie
// lokal zur Cell sind — aber mit der neuen Cell-ID zusammen).

type RemapMap = Map<string, string>;

function remap(id: string | null | undefined, map: RemapMap): string | null {
  if (!id) return null;
  const mapped = map.get(id);
  if (!mapped) {
    // Unbekannte ID: neue UUID vergeben + merken. Kommt vor, wenn
    // eine Tabelle FKs auf etwas hat, das nicht in derselben Payload
    // liegt (defensiv).
    const fresh = newUuid();
    map.set(id, fresh);
    return fresh;
  }
  return mapped;
}

// Alias-Dedup: wenn alias in Target-Workspace schon existiert, Suffix
// '-2', '-3' etc. anhaengen. Lookup via alias_index-Table (wenn
// vorhanden) oder alternativ direktes Query.
async function reserveAliases(
  workspaceId: string,
  aliases: string[],
): Promise<Map<string, string>> {
  if (aliases.length === 0) return new Map();
  const out = new Map<string, string>();
  // Alle Aliase im Workspace laden (union ueber alle Tabellen). Wir
  // nehmen eine einzige aliasIndex-Query an — im Projekt existiert
  // alias_index als Materialized Aggregate, aber fuer V1 nutzen wir
  // direkten Union-Call.
  const tables = ['nodes', 'cells', 'kb_cards', 'checklists', 'links'];
  const existing = new Set<string>();
  for (const t of tables) {
    const { data, error } = await supabase
      .from(t)
      .select('alias')
      .eq('workspace_id', workspaceId)
      .not('alias', 'is', null);
    if (error) continue;
    for (const row of (data ?? []) as Array<{ alias: string | null }>) {
      if (row.alias) existing.add(row.alias.toLowerCase());
    }
  }
  for (const a of aliases) {
    const lower = a.toLowerCase();
    if (!existing.has(lower)) {
      out.set(a, a);
      existing.add(lower);
      continue;
    }
    // Suffix '-2', '-3' ... bis frei
    let i = 2;
    while (existing.has(`${lower}-${i}`)) i++;
    const fresh = `${a}-${i}`;
    out.set(a, fresh);
    existing.add(fresh.toLowerCase());
  }
  return out;
}

function collectAliases(p: WorkspaceExport): string[] {
  const out: string[] = [];
  for (const n of p.nodes) {
    const a = (n as { alias?: unknown }).alias;
    if (typeof a === 'string' && a) out.push(a);
  }
  for (const c of p.cells) {
    const a = (c as { alias?: unknown }).alias;
    if (typeof a === 'string' && a) out.push(a);
  }
  for (const c of p.kb_cards) {
    const a = (c as { alias?: unknown }).alias;
    if (typeof a === 'string' && a) out.push(a);
  }
  for (const cl of p.checklists) {
    const a = (cl as { alias?: unknown }).alias;
    if (typeof a === 'string' && a) out.push(a);
  }
  for (const l of p.links) {
    const a = (l as { alias?: unknown }).alias;
    if (typeof a === 'string' && a) out.push(a);
  }
  return out;
}

// Wendet die Alias-Map auf ein Row-Objekt an (mutiert eine Kopie).
function applyAliasMap<T extends Record<string, unknown>>(
  row: T,
  aliasMap: Map<string, string>,
): T {
  const cur = (row as { alias?: unknown }).alias;
  if (typeof cur === 'string' && aliasMap.has(cur)) {
    return { ...row, alias: aliasMap.get(cur) } as T;
  }
  return row;
}

// ─── Insert-Helpers ────────────────────────────────────────────
async function insertBatch(
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  // Postgres REST limits batch size ~ 1k rows; fuer V1 splitten wir
  // bei 500, um RLS-Trigger nicht zu ueberfordern.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw error;
  }
}

// ─── Haupt-Import-Funktionen ───────────────────────────────────

export async function executeSubtreeImportIntoCell(args: {
  payload: WorkspaceExport;
  workspaceId: string;
  targetCellId: string;
}): Promise<{ rootNodeId: string; aliasMap: Map<string, string> }> {
  const { payload, workspaceId, targetCellId } = args;
  if (payload.payloadType !== 'subtree' && payload.payloadType !== 'workspace') {
    throw new ImportError(
      'In eine Zelle mit Sub-Struktur passt nur ein Bereichs-Export. Diese Datei ist ein anderer Typ.',
    );
  }

  // Root-Node finden: der erste Node, dessen parent_cell_id NULL ist.
  const rootRow = (payload.nodes as Array<{ id: string; type: string; parent_cell_id: string | null }>).find(
    (n) => !n.parent_cell_id,
  );
  if (!rootRow) {
    throw new ImportError(
      'Der Export ist unvollstaendig — es fehlt der Start-Punkt. Die Datei ist vermutlich beschaedigt.',
    );
  }

  // Target-Cell einmal laden, damit wir FK-Slot (child_matrix_id /
  // board_id) setzen koennen. Bei bereits belegtem Slot abbrechen.
  const { data: targetCell, error: tcErr } = await supabase
    .from('cells')
    .select('id, child_matrix_id, board_id, features')
    .eq('id', targetCellId)
    .single();
  if (tcErr || !targetCell) {
    throw new ImportError(
      'Die Ziel-Zelle konnte nicht geladen werden — wurde sie gerade geloescht?',
    );
  }
  if (rootRow.type === 'matrix' && targetCell.child_matrix_id) {
    throw new ImportError(
      'Diese Zelle hat schon eine Sub-Matrix. Entferne sie zuerst oder waehle eine leere Zelle.',
    );
  }
  if (rootRow.type === 'board' && targetCell.board_id) {
    throw new ImportError(
      'Diese Zelle hat schon ein Sub-Board. Entferne es zuerst oder waehle eine leere Zelle.',
    );
  }

  const remapMap: RemapMap = new Map();
  const aliasMap = await reserveAliases(workspaceId, collectAliases(payload));

  // Alle Primary-Keys pre-mappen, damit FK-Aufloesung danach klappt.
  for (const n of payload.nodes) remap((n as { id: string }).id, remapMap);
  for (const r of payload.rows) remap((r as { id: string }).id, remapMap);
  for (const c of payload.cols) remap((c as { id: string }).id, remapMap);
  for (const c of payload.cells) remap((c as { id: string }).id, remapMap);
  for (const k of payload.kb_cols) remap((k as { id: string }).id, remapMap);
  for (const k of payload.kb_cards) remap((k as { id: string }).id, remapMap);
  for (const cl of payload.checklists)
    remap((cl as { id: string }).id, remapMap);
  for (const it of payload.checklist_items)
    remap((it as { id: string }).id, remapMap);
  for (const l of payload.links) remap((l as { id: string }).id, remapMap);

  // Rows mappen + FKs auf neue IDs umbiegen + workspace_id setzen.
  const nodesOut = (payload.nodes as Array<Record<string, unknown>>).map((n) => {
    const id = (n as { id: string }).id;
    const parent = (n as { parent_cell_id: string | null }).parent_cell_id;
    return applyAliasMap(
      {
        ...n,
        id: remapMap.get(id)!,
        workspace_id: workspaceId,
        // Root-Node haengt an targetCell, alle anderen behalten ihren
        // Parent-Link (remapped).
        parent_cell_id:
          id === rootRow.id ? targetCellId : parent ? remap(parent, remapMap) : null,
      },
      aliasMap,
    );
  });

  const rowsOut = (payload.rows as Array<Record<string, unknown>>).map((r) => ({
    ...r,
    id: remapMap.get((r as { id: string }).id)!,
    workspace_id: workspaceId,
    matrix_id: remap((r as { matrix_id: string }).matrix_id, remapMap),
  }));

  const colsOut = (payload.cols as Array<Record<string, unknown>>).map((c) => ({
    ...c,
    id: remapMap.get((c as { id: string }).id)!,
    workspace_id: workspaceId,
    matrix_id: remap((c as { matrix_id: string }).matrix_id, remapMap),
  }));

  const cellsOut = (payload.cells as Array<Record<string, unknown>>).map((c) => {
    const raw = c as {
      id: string;
      matrix_id: string;
      row_id: string;
      col_id: string;
      child_matrix_id: string | null;
      board_id: string | null;
    };
    return applyAliasMap(
      {
        ...c,
        id: remapMap.get(raw.id)!,
        workspace_id: workspaceId,
        matrix_id: remap(raw.matrix_id, remapMap),
        row_id: remap(raw.row_id, remapMap),
        col_id: remap(raw.col_id, remapMap),
        child_matrix_id: remap(raw.child_matrix_id, remapMap),
        board_id: remap(raw.board_id, remapMap),
      },
      aliasMap,
    );
  });

  const kbColsOut = (payload.kb_cols as Array<Record<string, unknown>>).map(
    (k) => ({
      ...k,
      id: remapMap.get((k as { id: string }).id)!,
      workspace_id: workspaceId,
      board_id: remap((k as { board_id: string }).board_id, remapMap),
    }),
  );

  const kbCardsOut = (payload.kb_cards as Array<Record<string, unknown>>).map(
    (k) => {
      const raw = k as { id: string; board_id: string; col_id: string };
      return applyAliasMap(
        {
          ...k,
          id: remapMap.get(raw.id)!,
          workspace_id: workspaceId,
          board_id: remap(raw.board_id, remapMap),
          col_id: remap(raw.col_id, remapMap),
        },
        aliasMap,
      );
    },
  );

  const checklistsOut = (
    payload.checklists as Array<Record<string, unknown>>
  ).map((cl) => {
    const raw = cl as {
      id: string;
      board_id: string | null;
      cell_id: string | null;
    };
    return applyAliasMap(
      {
        ...cl,
        id: remapMap.get(raw.id)!,
        workspace_id: workspaceId,
        board_id: remap(raw.board_id, remapMap),
        cell_id: remap(raw.cell_id, remapMap),
      },
      aliasMap,
    );
  });

  const checklistItemsOut = (
    payload.checklist_items as Array<Record<string, unknown>>
  ).map((it) => ({
    ...it,
    id: remapMap.get((it as { id: string }).id)!,
    workspace_id: workspaceId,
    checklist_id: remap(
      (it as { checklist_id: string }).checklist_id,
      remapMap,
    ),
  }));

  const linksOut = (payload.links as Array<Record<string, unknown>>).map(
    (l) => {
      const raw = l as { id: string; board_id: string };
      return applyAliasMap(
        {
          ...l,
          id: remapMap.get(raw.id)!,
          workspace_id: workspaceId,
          board_id: remap(raw.board_id, remapMap),
        },
        aliasMap,
      );
    },
  );

  // Insert in FK-sicherer Reihenfolge. Nodes zuerst (ohne
  // parent_cell_id bei Sub-Nodes — das ist ein FK auf cells, die noch
  // nicht existieren). Wir teilen in zwei Phasen: erst Root-Node +
  // Top-Level ohne parent_cell_id, dann Cells, dann Sub-Nodes mit
  // parent_cell_id. Einfacher: Pfad in zwei Schritten via
  // parent_cell_id=null-Insert + spaeterem Update ist aber komplex.
  //
  // Statdessen: wir schieben alle Nodes ohne parent_cell_id zuerst
  // rein, dann rows/cols, dann cells, dann die verbleibenden Nodes
  // (die parent_cell_id setzen, und die ist jetzt bekannt).

  const nodesRootless: Record<string, unknown>[] = [];
  const nodesWithParent: Record<string, unknown>[] = [];
  for (const n of nodesOut) {
    if ((n as { parent_cell_id: string | null }).parent_cell_id) {
      nodesWithParent.push(n);
    } else {
      nodesRootless.push(n);
    }
  }

  // Root-Node haengt an targetCell — das ist aber eine *existierende*
  // Cell im Zielsystem, kein Import. Root-Node geht daher in Phase 1.
  // Also: Root-Node unterscheidet sich von rootless (parent_cell_id
  // ist gesetzt, aber auf externe Cell). Wir reklassifizieren:
  const rootNewId = remapMap.get(rootRow.id)!;
  const nodesPhase1: Record<string, unknown>[] = [];
  const nodesPhase2: Record<string, unknown>[] = [];
  for (const n of nodesOut) {
    if ((n as { id: string }).id === rootNewId) {
      // Root: parent zeigt auf targetCell (existiert bereits) → Phase 1
      nodesPhase1.push(n);
    } else if ((n as { parent_cell_id: string | null }).parent_cell_id) {
      nodesPhase2.push(n);
    } else {
      // Waise ohne parent — kann vorkommen, wenn der Export kaputt
      // ist. Wir lassen's durch, Phase 1.
      nodesPhase1.push(n);
    }
  }

  await insertBatch('nodes', nodesPhase1);
  await insertBatch('rows', rowsOut);
  await insertBatch('cols', colsOut);
  await insertBatch('cells', cellsOut);
  await insertBatch('nodes', nodesPhase2);
  await insertBatch('kb_cols', kbColsOut);
  await insertBatch('kb_cards', kbCardsOut);
  await insertBatch('checklists', checklistsOut);
  await insertBatch('checklist_items', checklistItemsOut);
  await insertBatch('links', linksOut);

  // Target-Cell final patchen: FK-Slot auf neuen Root-Node, Feature-
  // Flag anheben.
  const featKey = rootRow.type === 'matrix' ? 'matrix' : 'board';
  const curFeatures = (targetCell.features ?? []) as string[];
  const nextFeatures = curFeatures.includes(featKey)
    ? curFeatures
    : [...curFeatures, featKey];
  const patch =
    rootRow.type === 'matrix'
      ? { child_matrix_id: rootNewId, features: nextFeatures }
      : { board_id: rootNewId, features: nextFeatures };
  const { error: patchErr } = await supabase
    .from('cells')
    .update(patch)
    .eq('id', targetCellId);
  if (patchErr) throw patchErr;

  return { rootNodeId: rootNewId, aliasMap };
}

// Feature-Info-Merge: Felder + Links aus Source.cells[0].data an
// Target-Cell.data anhaengen. Keine UUIDs zu remappen fuer infoFields/
// links — die haben eigene IDs (lokal zur Cell), wir deduplizieren
// per ID-Kollision mit neuem genInfoFieldId.
export async function executeFeatureInfoImport(args: {
  payload: WorkspaceExport;
  workspaceId: string;
  targetCellId: string;
}): Promise<{ fieldsAdded: number; linksAdded: number }> {
  const { payload, targetCellId } = args;
  if (payload.payloadType !== 'feature-info') {
    throw new ImportError(
      'Das ist kein Info-Export. Bitte waehle eine Info-Datei (enthaelt Felder und Links).',
    );
  }
  const sourceCell = payload.cells[0];
  if (!sourceCell) {
    throw new ImportError(
      'Die Info-Export-Datei ist leer — keine Felder oder Links drin.',
    );
  }
  const sourceData =
    ((sourceCell as { data?: unknown }).data as Record<string, unknown>) ?? {};
  const sourceFields =
    (Array.isArray(sourceData.infoFields) ? sourceData.infoFields : []) as Array<{
      id?: unknown;
      label?: unknown;
      value?: unknown;
    }>;
  const sourceLinks = (Array.isArray(sourceData.links) ? sourceData.links : []) as Array<{
    id?: unknown;
    label?: unknown;
    url?: unknown;
  }>;

  const { data: targetCell, error: tcErr } = await supabase
    .from('cells')
    .select('id, data, features')
    .eq('id', targetCellId)
    .single();
  if (tcErr || !targetCell) {
    throw new ImportError(
      'Die Ziel-Zelle konnte nicht geladen werden — wurde sie gerade geloescht?',
    );
  }
  const targetData =
    ((targetCell.data as unknown) as Record<string, unknown>) ?? {};
  const existingFields = Array.isArray(targetData.infoFields)
    ? (targetData.infoFields as unknown[])
    : [];
  const existingLinks = Array.isArray(targetData.links)
    ? (targetData.links as unknown[])
    : [];

  // IDs mit neuen UUIDs; labels + values unveraendert durchreichen.
  const newFields = sourceFields
    .filter((f) => typeof f.label === 'string' && typeof f.value === 'string')
    .map((f) => ({
      id: newUuid(),
      label: f.label as string,
      value: f.value as string,
    }));
  const newLinks = sourceLinks
    .filter((l) => typeof l.url === 'string')
    .map((l) => ({
      id: newUuid(),
      label: typeof l.label === 'string' ? l.label : '',
      url: l.url as string,
    }));

  const features = ((targetCell.features ?? []) as string[]).includes('info')
    ? (targetCell.features as string[])
    : [...((targetCell.features ?? []) as string[]), 'info'];
  const nextData = {
    ...targetData,
    infoFields: [...existingFields, ...newFields],
    links: [...existingLinks, ...newLinks],
  };

  const { error: upErr } = await supabase
    .from('cells')
    .update({ data: nextData, features })
    .eq('id', targetCellId);
  if (upErr) throw upErr;
  return { fieldsAdded: newFields.length, linksAdded: newLinks.length };
}

// Feature-Checklists-Merge: Source-Checklisten + Items anhaengen.
// Alias-Dedup wie bei Subtree.
export async function executeFeatureChecklistsImport(args: {
  payload: WorkspaceExport;
  workspaceId: string;
  targetCellId: string;
}): Promise<{ checklistsAdded: number; itemsAdded: number }> {
  const { payload, workspaceId, targetCellId } = args;
  if (payload.payloadType !== 'feature-checklists') {
    throw new ImportError(
      'Das ist kein Checklisten-Export. Bitte waehle eine Checklisten-Datei.',
    );
  }
  const aliasMap = await reserveAliases(workspaceId, collectAliases(payload));
  const remapMap: RemapMap = new Map();
  for (const cl of payload.checklists)
    remap((cl as { id: string }).id, remapMap);
  for (const it of payload.checklist_items)
    remap((it as { id: string }).id, remapMap);

  // Position-Offset: wir haengen hinter die letzte existierende Liste
  // in dieser Cell.
  const { data: existing } = await supabase
    .from('checklists')
    .select('position')
    .eq('cell_id', targetCellId)
    .order('position', { ascending: false })
    .limit(1);
  const offset =
    Array.isArray(existing) && existing.length > 0
      ? ((existing[0].position as number) ?? 0) + 1
      : 0;

  const checklistsOut = (
    payload.checklists as Array<Record<string, unknown>>
  ).map((cl, idx) => {
    const raw = cl as { id: string };
    return applyAliasMap(
      {
        ...cl,
        id: remapMap.get(raw.id)!,
        workspace_id: workspaceId,
        board_id: null,
        cell_id: targetCellId,
        position: offset + idx,
      },
      aliasMap,
    );
  });

  const itemsOut = (
    payload.checklist_items as Array<Record<string, unknown>>
  ).map((it) => ({
    ...it,
    id: remapMap.get((it as { id: string }).id)!,
    workspace_id: workspaceId,
    checklist_id: remap(
      (it as { checklist_id: string }).checklist_id,
      remapMap,
    ),
  }));

  await insertBatch('checklists', checklistsOut);
  await insertBatch('checklist_items', itemsOut);

  // Cell-Feature-Flag sicherstellen.
  const { data: targetCell } = await supabase
    .from('cells')
    .select('features')
    .eq('id', targetCellId)
    .single();
  const features = ((targetCell?.features ?? []) as string[]).includes(
    'checklists',
  )
    ? (targetCell?.features as string[])
    : [...((targetCell?.features ?? []) as string[]), 'checklists'];
  if (!((targetCell?.features ?? []) as string[]).includes('checklists')) {
    await supabase
      .from('cells')
      .update({ features })
      .eq('id', targetCellId);
  }

  return {
    checklistsAdded: checklistsOut.length,
    itemsAdded: itemsOut.length,
  };
}

// Subtree-in-Matrix: haengt den Subtree-Root als neue Cell unter der
// Target-Matrix an (neue Row + Col, neue Cell mit FK auf Subtree-
// Root). Einfachste Semantik: am Ende der Matrix.
export async function executeSubtreeImportIntoMatrix(args: {
  payload: WorkspaceExport;
  workspaceId: string;
  targetMatrixId: string;
}): Promise<{ rootNodeId: string; cellId: string }> {
  const { payload, workspaceId, targetMatrixId } = args;
  if (payload.payloadType !== 'subtree' && payload.payloadType !== 'workspace') {
    throw new ImportError(
      'In eine Matrix kannst du nur einen Bereichs-Export einfuegen (Matrix oder Board).',
    );
  }

  // 1. Neue Row + Col unten rechts anlegen.
  const [rowsRes, colsRes] = await Promise.all([
    supabase
      .from('rows')
      .select('position')
      .eq('matrix_id', targetMatrixId)
      .order('position', { ascending: false })
      .limit(1),
    supabase
      .from('cols')
      .select('position')
      .eq('matrix_id', targetMatrixId)
      .order('position', { ascending: false })
      .limit(1),
  ]);
  const rowPos =
    Array.isArray(rowsRes.data) && rowsRes.data.length > 0
      ? ((rowsRes.data[0].position as number) ?? 0) + 1
      : 0;
  const colPos =
    Array.isArray(colsRes.data) && colsRes.data.length > 0
      ? ((colsRes.data[0].position as number) ?? 0) + 1
      : 0;

  const rootRow = (payload.nodes as Array<{ id: string; type: string; parent_cell_id: string | null; label?: string }>).find(
    (n) => !n.parent_cell_id,
  );
  if (!rootRow)
    throw new ImportError(
      'Der Export ist unvollstaendig — es fehlt der Start-Punkt. Die Datei ist vermutlich beschaedigt.',
    );
  const label = typeof rootRow.label === 'string' ? rootRow.label : 'Import';

  const newRowId = newUuid();
  const newColId = newUuid();
  const newCellId = newUuid();

  // Row + Col anlegen
  const { error: rErr } = await supabase.from('rows').insert({
    id: newRowId,
    workspace_id: workspaceId,
    matrix_id: targetMatrixId,
    label,
    position: rowPos,
  });
  if (rErr) throw rErr;
  const { error: cErr } = await supabase.from('cols').insert({
    id: newColId,
    workspace_id: workspaceId,
    matrix_id: targetMatrixId,
    label,
    position: colPos,
  });
  if (cErr) throw cErr;

  // Platzhalter-Cell anlegen, ohne Features. Feature-Flag + FK kommen
  // beim Import-Haengen.
  const { error: cellErr } = await supabase.from('cells').insert({
    id: newCellId,
    workspace_id: workspaceId,
    matrix_id: targetMatrixId,
    row_id: newRowId,
    col_id: newColId,
    features: [],
  });
  if (cellErr) throw cellErr;

  const res = await executeSubtreeImportIntoCell({
    payload,
    workspaceId,
    targetCellId: newCellId,
  });
  return { rootNodeId: res.rootNodeId, cellId: newCellId };
}
