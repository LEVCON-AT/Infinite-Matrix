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
  // sourceCell kann bei Cell-Subtree-Exports vorhanden sein — optional
  // uebernehmen, sonst weglassen.
  let sourceCell: { data: Record<string, unknown>; features: string[] } | undefined;
  if (p.sourceCell && typeof p.sourceCell === 'object') {
    const sc = p.sourceCell as Record<string, unknown>;
    sourceCell = {
      data:
        sc.data && typeof sc.data === 'object'
          ? (sc.data as Record<string, unknown>)
          : {},
      features: Array.isArray(sc.features)
        ? (sc.features as unknown[]).filter(
            (x): x is string => typeof x === 'string',
          )
        : [],
    };
  }

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
    sourceCell,
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

  // Sonderfall: Cell-Export ohne Sub-Matrix/Sub-Board. Dann enthaelt
  // der Payload nur die eine Cell als Container (Info-Daten + Check-
  // listen). Wir leiten auf den Merge-Flow um — dort werden Felder,
  // Links und Checklisten in die Target-Zelle gemerged, ohne neuen
  // Node anzulegen.
  if ((payload.nodes as unknown[]).length === 0) {
    await executeCellContainerMerge({
      payload,
      workspaceId,
      targetCellId,
    });
    // rootNodeId gibt es hier nicht — wir retournieren die Target-
    // Cell-ID als Pseudo-Root fuer Caller-Kompatibilitaet.
    return { rootNodeId: targetCellId, aliasMap: new Map() };
  }

  // Root-Node finden: der erste Node, dessen parent_cell_id NULL ist.
  // Bei Cell-Subtree-Exports haben wir parent_cell_id=null auf dem
  // Top-Sub-Node gesetzt (damit er als Root erkennbar ist).
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
  // Wichtig: nodes.parent_cell_id wird IM INSERT auf NULL gesetzt,
  // weil die gezielten cells erst in einer spaeteren Phase existieren
  // (FK-Schleife: nodes -> cells -> nodes). Die korrekten Parent-
  // Verweise werden nach den cells per UPDATE nachgezogen.
  const rootNewId = remapMap.get(rootRow.id)!;
  const nodesOut = (payload.nodes as Array<Record<string, unknown>>).map((n) => {
    const id = (n as { id: string }).id;
    return applyAliasMap(
      {
        ...n,
        id: remapMap.get(id)!,
        workspace_id: workspaceId,
        // Im Insert zunaechst NULL. Root-Node und alle Sub-Nodes
        // bekommen ihren parent_cell_id erst im UPDATE-Schritt
        // (siehe Phase D unten).
        parent_cell_id: null,
      },
      aliasMap,
    );
  });
  // Mapping Old-Node-ID -> gewuenschter finaler parent_cell_id
  // (Target-Cell fuer Root, remapped cell-id fuer Sub-Nodes).
  const nodeParentUpdates: Array<{ id: string; parent_cell_id: string }> = [];
  for (const n of payload.nodes as Array<{ id: string; parent_cell_id: string | null }>) {
    const newId = remapMap.get(n.id)!;
    if (n.id === rootRow.id) {
      nodeParentUpdates.push({ id: newId, parent_cell_id: targetCellId });
    } else if (n.parent_cell_id) {
      const mappedParent = remapMap.get(n.parent_cell_id);
      if (mappedParent) {
        nodeParentUpdates.push({ id: newId, parent_cell_id: mappedParent });
      }
    }
  }

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

  // Checklisten-cell_id: wenn eine Liste im Export cell_id gesetzt
  // hat, aber diese Cell NICHT unter den remappten Cells ist, dann
  // kam sie vom Quell-Container (Cell-Subtree-Export). Wir haengen
  // sie an die Ziel-Zelle.
  const checklistsOut = (
    payload.checklists as Array<Record<string, unknown>>
  ).map((cl) => {
    const raw = cl as {
      id: string;
      board_id: string | null;
      cell_id: string | null;
    };
    let mappedCellId: string | null = null;
    if (raw.cell_id) {
      if (remapMap.has(raw.cell_id)) {
        mappedCellId = remapMap.get(raw.cell_id)!;
      } else {
        // cell_id gehoert zu einer Cell, die nicht im Export drin ist —
        // das ist die Container-Zelle des Exports. Ziel-Zelle nehmen.
        mappedCellId = targetCellId;
      }
    }
    return applyAliasMap(
      {
        ...cl,
        id: remapMap.get(raw.id)!,
        workspace_id: workspaceId,
        board_id: remap(raw.board_id, remapMap),
        cell_id: mappedCellId,
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

  // Insert-Reihenfolge loest die FK-Schleife nodes<->cells so auf:
  //   Phase A: alle Nodes mit parent_cell_id=NULL einfuegen.
  //   Phase B: Rows + Cols (haengen an Matrix-Nodes, existieren).
  //   Phase C: Cells inkl. child_matrix_id / board_id — die
  //            referenzierten Sub-Nodes wurden in Phase A angelegt.
  //   Phase D: UPDATE nodes.parent_cell_id aus nodeParentUpdates
  //            (Target-Cell fuer Root, remapped cells fuer Sub-Nodes).
  //   Phase E: Board-interne Tabellen (kb_cols, kb_cards, links) +
  //            Checklisten + Items.
  await insertBatch('nodes', nodesOut);
  await insertBatch('rows', rowsOut);
  await insertBatch('cols', colsOut);
  await insertBatch('cells', cellsOut);
  // parent_cell_id UPDATE — sequenziell, um pro Fehler genau
  // identifizieren zu koennen welcher Node nicht durchging. Bei
  // grossen Imports koennen wir spaeter auf RPC umsteigen.
  for (const up of nodeParentUpdates) {
    const { error: upErr } = await supabase
      .from('nodes')
      .update({ parent_cell_id: up.parent_cell_id })
      .eq('id', up.id);
    if (upErr) throw upErr;
  }
  await insertBatch('kb_cols', kbColsOut);
  await insertBatch('kb_cards', kbCardsOut);
  await insertBatch('checklists', checklistsOut);
  await insertBatch('checklist_items', checklistItemsOut);
  await insertBatch('links', linksOut);

  // Target-Cell final patchen: FK-Slot auf neuen Root-Node, Feature-
  // Flag anheben. Wenn payload.sourceCell existiert (Cell-Subtree-
  // Export), mergen wir zusaetzlich info-Felder/Links + aktivieren die
  // passenden Flags (info / checklists).
  const featKey = rootRow.type === 'matrix' ? 'matrix' : 'board';
  const nextFeatures = new Set<string>(
    (targetCell.features ?? []) as string[],
  );
  nextFeatures.add(featKey);

  const targetDataBase =
    ((targetCell as { data?: unknown }).data as Record<string, unknown> | null) ??
    {};
  let mergedData: Record<string, unknown> = { ...targetDataBase };

  if (payload.sourceCell) {
    // Info-Felder + Links mergen — neue UUIDs, damit keine
    // Kollisionen mit bestehenden Feldern auftreten.
    const scData = payload.sourceCell.data ?? {};
    const scFeatures = payload.sourceCell.features ?? [];
    for (const f of scFeatures) {
      if (f === 'info' || f === 'checklists') nextFeatures.add(f);
    }
    const srcFields = Array.isArray(
      (scData as { infoFields?: unknown }).infoFields,
    )
      ? ((scData as { infoFields: unknown[] }).infoFields as Array<{
          id?: unknown;
          label?: unknown;
          value?: unknown;
        }>)
      : [];
    const srcLinks = Array.isArray((scData as { links?: unknown }).links)
      ? ((scData as { links: unknown[] }).links as Array<{
          id?: unknown;
          label?: unknown;
          url?: unknown;
        }>)
      : [];
    const existingFields = Array.isArray(mergedData.infoFields)
      ? (mergedData.infoFields as unknown[])
      : [];
    const existingLinks = Array.isArray(mergedData.links)
      ? (mergedData.links as unknown[])
      : [];
    const newFields = srcFields
      .filter(
        (f) => typeof f.label === 'string' && typeof f.value === 'string',
      )
      .map((f) => ({
        id: newUuid(),
        label: f.label as string,
        value: f.value as string,
      }));
    const newLinks = srcLinks
      .filter((l) => typeof l.url === 'string')
      .map((l) => ({
        id: newUuid(),
        label: typeof l.label === 'string' ? l.label : '',
        url: l.url as string,
      }));
    if (newFields.length > 0 || newLinks.length > 0) {
      nextFeatures.add('info');
      mergedData = {
        ...mergedData,
        infoFields: [...existingFields, ...newFields],
        links: [...existingLinks, ...newLinks],
      };
    }
    // Checklisten-Feature aktivieren, wenn die Quell-Zelle eine hatte
    // und wir jetzt neue Listen unter Target-Cell haengen.
    const hasRetargetedChecklists = checklistsOut.some(
      (cl) => (cl as { cell_id: string | null }).cell_id === targetCellId,
    );
    if (hasRetargetedChecklists) nextFeatures.add('checklists');
  }

  const patch: Record<string, unknown> =
    rootRow.type === 'matrix'
      ? {
          child_matrix_id: rootNewId,
          features: Array.from(nextFeatures),
          data: mergedData,
        }
      : {
          board_id: rootNewId,
          features: Array.from(nextFeatures),
          data: mergedData,
        };
  const { error: patchErr } = await supabase
    .from('cells')
    .update(patch)
    .eq('id', targetCellId);
  if (patchErr) throw patchErr;

  return { rootNodeId: rootNewId, aliasMap };
}

// Cell-Container-Merge: wird aufgerufen, wenn ein Cell-Subtree-Export
// KEINE Sub-Matrix/Sub-Board enthaelt — dann ist der Payload nur eine
// Cell-Zeile plus evtl. Checklisten + Items (die an dieser Cell
// haengen). Wir mergen Felder, Links und Checklisten in die Target-
// Cell, ohne einen Node anzulegen. Features-Flags werden entsprechend
// uebernommen.
async function executeCellContainerMerge(args: {
  payload: WorkspaceExport;
  workspaceId: string;
  targetCellId: string;
}): Promise<void> {
  const { payload, workspaceId, targetCellId } = args;
  // Primaere Quelle fuer Container-Infos: payload.sourceCell (neues
  // Cell-Subtree-Format). Fallback: payload.cells[0] (legacy-Format,
  // vor der SB.1f-Aenderung). Beides kann vorkommen — wir lesen
  // tolerant.
  const sourceData =
    payload.sourceCell?.data ??
    ((payload.cells[0] as { data?: unknown } | undefined)?.data as
      | Record<string, unknown>
      | null
      | undefined) ??
    {};
  const sourceFeatures =
    payload.sourceCell?.features ??
    ((payload.cells[0] as { features?: unknown } | undefined)
      ?.features as string[] | undefined) ??
    [];
  const sourceFields = (
    Array.isArray((sourceData as { infoFields?: unknown }).infoFields)
      ? (sourceData as { infoFields: unknown[] }).infoFields
      : []
  ) as Array<{ id?: unknown; label?: unknown; value?: unknown }>;
  const sourceLinks = (
    Array.isArray((sourceData as { links?: unknown }).links)
      ? (sourceData as { links: unknown[] }).links
      : []
  ) as Array<{ id?: unknown; label?: unknown; url?: unknown }>;

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

  // Features mergen: Source-Features (nur info/checklists relevant —
  // matrix/board kommen nicht hier an) + bestehende Target-Features.
  const nextFeatures = new Set<string>(
    (targetCell.features ?? []) as string[],
  );
  for (const f of sourceFeatures) {
    if (f === 'info' || f === 'checklists') nextFeatures.add(f);
  }
  if (newFields.length > 0 || newLinks.length > 0) nextFeatures.add('info');

  const nextData = {
    ...targetData,
    infoFields: [...existingFields, ...newFields],
    links: [...existingLinks, ...newLinks],
  };

  const { error: upErr } = await supabase
    .from('cells')
    .update({ data: nextData, features: Array.from(nextFeatures) })
    .eq('id', targetCellId);
  if (upErr) throw upErr;

  // 2. Checklisten + Items aus dem Payload uebernehmen, alle mit
  //    neuer UUID, cell_id=target, board_id=null, position ans Ende.
  const remapMap: RemapMap = new Map();
  for (const cl of payload.checklists)
    remap((cl as { id: string }).id, remapMap);
  for (const it of payload.checklist_items)
    remap((it as { id: string }).id, remapMap);

  if (payload.checklists.length > 0) {
    const aliasMap = await reserveAliases(
      workspaceId,
      (payload.checklists as Array<{ alias?: unknown }>).flatMap((cl) =>
        typeof cl.alias === 'string' && cl.alias ? [cl.alias] : [],
      ),
    );
    const { data: existingLists } = await supabase
      .from('checklists')
      .select('position')
      .eq('cell_id', targetCellId)
      .order('position', { ascending: false })
      .limit(1);
    const offset =
      Array.isArray(existingLists) && existingLists.length > 0
        ? ((existingLists[0].position as number) ?? 0) + 1
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
  }
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
