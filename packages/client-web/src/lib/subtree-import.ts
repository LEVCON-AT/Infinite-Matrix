// Subtree/Feature-Import fuer das Client-Web. Liest die
// WorkspaceExport-Shape aus lib/export.ts (nicht die AltPayload-Shape
// aus lib/import.ts — das ist der HTML-Client-Round-Trip) und fuegt
// den Inhalt in einen bestehenden Workspace ein.
//
// Konformitaets-Notiz — dokumentierte Bulk-Ausnahme (`architektur.md §4.1`):
// Die zahlreichen direkten `supabase.from(...).insert/update/delete()`-Aufrufe
// in dieser Datei laufen bewusst ohne `runOptimistic*`-Wrapper. Begruendung
// analog `import-exec.ts`: Import + delete-Subtree sind User-initiierte,
// UI-blocking Bulk-Pipelines mit FK-geordneten Steps; Offline-Replay einer
// solchen Pipeline waere weder verlustfrei rekonstruierbar (Queue-FIFO
// haelt die Step-Reihenfolge nicht) noch User-erwartbar. Hard-fail per
// ImportError + Toast ist das definierte Vertragsverhalten — der User
// kann den Workspace manuell bereinigen oder den Import neu starten.
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

import type { ExportPayloadType, WorkspaceExport } from './export';
import { WORKSPACE_EXPORT_VERSION } from './export';
import { setProgressPhase } from './progress';
import { supabase } from './supabase';
import { sanitizeUrl } from './url';

export class ImportError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ImportError';
  }
}

export type ImportTarget =
  | { kind: 'matrix'; matrixNodeId: string }
  | { kind: 'board'; boardNodeId: string }
  | { kind: 'cell'; cellId: string }
  | { kind: 'feature-info'; cellId: string }
  | { kind: 'feature-checklists'; cellId: string };

// Import-Modus:
//   'add'               → an bestehende Daten anhaengen (Default).
//   'overwrite'         → bestehenden Ziel-Inhalt zuerst loeschen,
//                         dann importieren.
//   'export-overwrite'  → bestehenden Ziel-Inhalt als Datei
//                         exportieren (Sicherung), dann wie overwrite.
// Matrix-Import unterstuetzt nur 'add' (alles andere waere zu
// destruktiv auf Matrix-Ebene).
export type ImportMode = 'add' | 'overwrite' | 'export-overwrite';

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
    throw new ImportError('Diese Datei sieht nicht wie ein Infinite-Matrix-Export aus.');
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
      data: sc.data && typeof sc.data === 'object' ? (sc.data as Record<string, unknown>) : {},
      features: Array.isArray(sc.features)
        ? (sc.features as unknown[]).filter((x): x is string => typeof x === 'string')
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
    docs: arr('docs'),
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
    case 'board':
      if (p !== 'subtree' && p !== 'workspace') {
        return 'In ein Board passt nur ein anderer Board-Export. Matrix- oder Feature-Exporte sind nicht passend.';
      }
      return null;
    case 'cell':
      if (p !== 'subtree' && p !== 'feature-info' && p !== 'feature-checklists') {
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

// Hard-remap: id MUSS in der Map sein, sonst Programmierfehler.
// Wird genutzt fuer alle "wir haben gerade vorher ueber alle Rows
// iteriert und neue UUIDs vergeben"-Fälle, in denen ein fehlender
// Eintrag ein echter Bug waere.
function mustRemap(id: string, map: RemapMap): string {
  const mapped = map.get(id);
  if (!mapped) {
    throw new Error(`Import: remapMap fehlt Eintrag fuer "${id}" — Pre-Pass nicht durchgelaufen?`);
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
  const tables = ['nodes', 'cells', 'checklists', 'links', 'docs'];
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
  // Phase 4 T.1.D: Karten-Aliases via tasks.attrs.alias.
  const taskRes = await supabase
    .from('tasks')
    .select('attrs')
    .eq('workspace_id', workspaceId)
    .not('attrs->>alias', 'is', null);
  if (!taskRes.error) {
    for (const row of (taskRes.data ?? []) as Array<{ attrs: Record<string, unknown> | null }>) {
      const alias = (row.attrs as Record<string, unknown> | null)?.alias as string | undefined;
      if (alias) existing.add(alias.toLowerCase());
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
  for (const d of p.docs) {
    const a = (d as { alias?: unknown }).alias;
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
async function insertBatch(table: string, rows: Record<string, unknown>[]): Promise<void> {
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

// ─── B1-A-006-Restposten — Object-Layer-Block ────────────────────
// Bereitet Object-Layer-Rows aus dem Payload fuer den Import vor:
// vergibt neue UUIDs, remappt parent_id (self-FK), home_ref_id (poly-
// FK auf row/col/kb_col/node), object_tags-FKs und group-Member-FKs.
//
// Erwartet, dass remapMap bereits node/cell/row/col/kb_col-IDs trägt
// (Pre-Pass im Aufrufer). objects + groups bekommen hier ihren Pre-
// Pass; das ergibt die deterministische Reihenfolge:
//   1. Caller: remap fuer nodes/rows/cols/cells/kb_cols.
//   2. Hier:   remap fuer objects/groups; FK-Auflösung gegen Pre-Pass.
//   3. Caller: applyObjectIdMap auf nodes/rows/cols/kb_cols.
//
// home_ref_kind='standalone' bleibt FK-frei (home_ref_id ist Null).
// Fuer 'row'/'col'/'kb_col'/'node' lesen wir aus remapMap; falls die
// referenzierte Row nicht im Payload ist, wird home_ref_id auf NULL +
// home_ref_kind auf 'standalone' gesetzt — defensiver Fallback.
type ObjectLayerOut = {
  objectsOut: Record<string, unknown>[];
  objectTagsOut: Record<string, unknown>[];
  groupsOut: Record<string, unknown>[];
  groupMembersOut: Record<string, unknown>[];
  insertedObjectIds: string[];
  insertedGroupIds: string[];
};

function buildObjectLayerOut(
  payload: WorkspaceExport,
  workspaceId: string,
  remapMap: RemapMap,
): ObjectLayerOut {
  const sourceObjects = (payload.objects ?? []) as Array<Record<string, unknown>>;
  const sourceObjectTags = (payload.object_tags ?? []) as Array<Record<string, unknown>>;
  const sourceGroups = (payload.groups ?? []) as Array<Record<string, unknown>>;
  const sourceGroupMembers = (payload.group_members ?? []) as Array<Record<string, unknown>>;

  // Pre-Pass: alle Object- + Group-IDs in remapMap eintragen.
  for (const o of sourceObjects) remap((o as { id: string }).id, remapMap);
  for (const g of sourceGroups) remap((g as { id: string }).id, remapMap);

  const objectsOut = sourceObjects.map((o) => {
    const raw = o as {
      id: string;
      parent_id?: string | null;
      home_ref_kind?: string | null;
      home_ref_id?: string | null;
    };
    // home_ref_id-Remap: nur wenn target im Payload (remapMap hat den Eintrag).
    // Sonst graceful auf 'standalone' faellen — kein FK-Bruch im Ziel.
    let newHomeRefKind: string | null = raw.home_ref_kind ?? null;
    let newHomeRefId: string | null = null;
    if (raw.home_ref_id && raw.home_ref_kind && raw.home_ref_kind !== 'standalone') {
      const mapped = remapMap.get(raw.home_ref_id);
      if (mapped) {
        newHomeRefId = mapped;
      } else {
        newHomeRefKind = 'standalone';
      }
    }
    // parent_id (self-FK): wenn parent im Payload → remap, sonst NULL
    // (kein FK-Bruch — Object wird zum neuen Top-Level im Ziel).
    const newParentId = raw.parent_id ? (remapMap.get(raw.parent_id) ?? null) : null;
    return {
      ...o,
      id: mustRemap(raw.id, remapMap),
      workspace_id: workspaceId,
      parent_id: newParentId,
      home_ref_kind: newHomeRefKind,
      home_ref_id: newHomeRefId,
    };
  });

  // object_tags: object_id + tag_object_id sind beide objects.id-Refs.
  // Nur uebernehmen, wenn beide IDs remapbar sind (sonst dangling FK).
  const objectTagsOut: Record<string, unknown>[] = [];
  for (const t of sourceObjectTags) {
    const raw = t as { object_id: string; tag_object_id: string };
    const objId = remapMap.get(raw.object_id);
    const tagId = remapMap.get(raw.tag_object_id);
    if (!objId || !tagId) continue;
    objectTagsOut.push({
      ...t,
      object_id: objId,
      tag_object_id: tagId,
      workspace_id: workspaceId,
    });
  }

  const groupsOut = sourceGroups.map((g) => ({
    ...g,
    id: mustRemap((g as { id: string }).id, remapMap),
    workspace_id: workspaceId,
  }));

  // group_members: group_id + object_id beide remap-pflichtig.
  const groupMembersOut: Record<string, unknown>[] = [];
  for (const gm of sourceGroupMembers) {
    const raw = gm as { group_id: string; object_id: string };
    const gid = remapMap.get(raw.group_id);
    const oid = remapMap.get(raw.object_id);
    if (!gid || !oid) continue;
    groupMembersOut.push({
      ...gm,
      group_id: gid,
      object_id: oid,
      workspace_id: workspaceId,
    });
  }

  return {
    objectsOut,
    objectTagsOut,
    groupsOut,
    groupMembersOut,
    insertedObjectIds: objectsOut.map((o) => o.id as string),
    insertedGroupIds: groupsOut.map((g) => g.id as string),
  };
}

// Helper: auf einer Row mit `object_id`-Feld den FK durch remapMap
// ersetzen (NULL bleibt NULL; nicht-gemappte IDs faellen auch auf NULL).
function applyObjectIdMap<T extends Record<string, unknown>>(row: T, remapMap: RemapMap): T {
  const cur = (row as { object_id?: unknown }).object_id;
  if (typeof cur !== 'string' || !cur) return row;
  const mapped = remapMap.get(cur);
  return { ...row, object_id: mapped ?? null } as T;
}

// ─── Phase 4 T.1.D Helpers: Legacy-Payload → Task-Layer ────────
// Import-Payloads tragen weiterhin die kb_cards / checklist_items
// Form aus historischen Exporten. Diese Helper transformieren sie in
// die native (TaskRow, TaskManifestationRow{kanban|checklist}) Form,
// bevor wir per insertBatch in tasks + atom_manifestations schreiben.
type AnyRecord = Record<string, unknown>;

function kbCardPayloadToTaskAndManif(
  k: AnyRecord,
  workspaceId: string,
): { task: AnyRecord; manif: AnyRecord } {
  const r = k as {
    id: string;
    name?: string;
    note?: string | null;
    done?: boolean;
    archived?: boolean;
    deadline?: string | null;
    who?: string[];
    recur?: AnyRecord | null;
    done_occurrences?: string[];
    priority?: number | null;
    tags?: string[];
    alias?: string | null;
    color?: string | null;
    checklist?: AnyRecord[] | null;
    checklist_ref?: string | null;
    source_cl_id?: string | null;
    source_label?: string | null;
    board_id: string;
    col_id: string;
    position?: number;
  };
  const status = r.archived ? 'archived' : r.done ? 'done' : 'open';
  const attrs: AnyRecord = { legacy_kind: 'kb_card' };
  if (r.priority != null) attrs.priority = r.priority;
  if (r.tags && r.tags.length > 0) attrs.tags = r.tags;
  if (r.alias != null) attrs.alias = r.alias;
  if (r.color != null) attrs.color = r.color;
  if (r.checklist != null) attrs.checklist_inline = r.checklist;
  if (r.checklist_ref != null) attrs.checklist_ref = r.checklist_ref;
  if (r.source_cl_id != null) attrs.source_cl_id = r.source_cl_id;
  if (r.source_label != null) attrs.source_label = r.source_label;
  return {
    task: {
      id: r.id,
      workspace_id: workspaceId,
      label: r.name ?? '',
      note: r.note ?? null,
      status,
      deadline: r.deadline ?? null,
      who: r.who ?? [],
      recur: r.recur ?? null,
      done_occurrences: r.done_occurrences ?? [],
      attrs,
    },
    manif: {
      atom_type: 'task',
      atom_id: r.id,
      workspace_id: workspaceId,
      kind: 'kanban',
      container_id: r.col_id,
      position: r.position ?? 0,
      display_meta: { board_id: r.board_id },
    },
  };
}

function itemPayloadToTaskAndManif(
  it: AnyRecord,
  workspaceId: string,
): { task: AnyRecord; manif: AnyRecord } {
  const r = it as {
    id: string;
    text?: string;
    done?: boolean;
    level?: number;
    position?: number;
    checklist_id: string;
  };
  return {
    task: {
      id: r.id,
      workspace_id: workspaceId,
      label: r.text ?? '',
      status: r.done ? 'done' : 'open',
      attrs: { legacy_kind: 'checklist_item' },
    },
    manif: {
      atom_type: 'task',
      atom_id: r.id,
      workspace_id: workspaceId,
      kind: 'checklist',
      container_id: r.checklist_id,
      level: r.level ?? 0,
      position: r.position ?? 0,
    },
  };
}

// Bulk-Variante: Eingabe sind die schon ID-remappten Payload-Rows mit
// final-targets fuer board_id/col_id/checklist_id. Output sind zwei
// Arrays bereit fuer insertBatch('tasks', ...) + insertBatch('task_-
// manifestations', ...).
function splitKbCards(
  rows: AnyRecord[],
  workspaceId: string,
): {
  tasks: AnyRecord[];
  manifs: AnyRecord[];
} {
  const tasks: AnyRecord[] = [];
  const manifs: AnyRecord[] = [];
  for (const r of rows) {
    const { task, manif } = kbCardPayloadToTaskAndManif(r, workspaceId);
    tasks.push(task);
    manifs.push(manif);
  }
  return { tasks, manifs };
}

function splitChecklistItems(
  rows: AnyRecord[],
  workspaceId: string,
): {
  tasks: AnyRecord[];
  manifs: AnyRecord[];
} {
  const tasks: AnyRecord[] = [];
  const manifs: AnyRecord[] = [];
  for (const r of rows) {
    const { task, manif } = itemPayloadToTaskAndManif(r, workspaceId);
    tasks.push(task);
    manifs.push(manif);
  }
  return { tasks, manifs };
}

// Best-effort Cleanup nach Partial-Insert. Faellt waehrend der Phase-
// Sequenz eine Insert um (Netz weg, RLS-Fehler, FK-Kollision), bleiben
// sonst Nodes/Rows/Cols/Cells als Waisen zurueck. Per Cascade-Delete
// auf nodes raeumen wir rows/cols/cells/kb_cols/kb_cards/checklists/
// items/links mit auf. Docs haengen ON DELETE SET NULL und werden
// daher separat geloescht — sonst bleiben sie mit attached_cell_id=
// NULL freischwebend im Workspace liegen.
//
// Fehler innerhalb des Cleanups werden bewusst geschluckt: der
// Original-Fehler aus der Phase-Sequenz hat Prioritaet und muss den
// Caller erreichen.
type WorkspaceGlobalsCleanup = {
  // Workspace-Globals-Inserts aus dem Workspace-Import-Pfad. Werden bei
  // Failure des try-Blocks separat geloescht — sie haengen NICHT am
  // Nodes-Cascade. Cascade-Reihenfolge muss von oben (FK-Wurzel) nach
  // unten (FK-Blaetter) wirken; FK_CASCADE in den Migrations 067-070
  // erlaubt es uns, nur die obersten Knoten zu loeschen — die Sub-
  // Tabellen (template_sections, template_widgets, etc.) cascade
  // automatisch mit.
  featureTemplateIds?: string[];
  cellTemplateInstanceIds?: string[];
  cellWidgetOverrideIds?: string[];
  hotkeySlotIds?: string[];
  savedFilterIds?: string[];
  widgetExternalChannelIds?: string[];
  // §13.3 V2: atom_markers haben FK auf atom-Tabellen + user_id
  // auf auth.users — kein Cascade von nodes/templates. Bei Failure
  // separater Delete.
  atomMarkerIds?: string[];
  // B1-A-006-Restposten: Object-Layer-Inserts. objects + groups sind
  // workspace-scoped, kein Cascade von nodes — direkter Delete bei
  // Failure. object_tags + group_members cascaden ueber objects/groups.
  objectIds?: string[];
  groupIds?: string[];
};

async function cleanupPartialImport(
  insertedNodeIds: string[],
  insertedDocIds: string[],
  insertedInfoFieldIds: string[] = [],
  workspaceGlobals: WorkspaceGlobalsCleanup = {},
): Promise<void> {
  try {
    if (insertedNodeIds.length > 0) {
      await supabase.from('nodes').delete().in('id', insertedNodeIds);
    }
    if (insertedDocIds.length > 0) {
      await supabase.from('docs').delete().in('id', insertedDocIds);
    }
    if (insertedInfoFieldIds.length > 0) {
      // info_fields sind workspace-skopiert und nicht via Node-Cascade
      // erreichbar. Trigger T1 aus Migration 082 raeumt verbundene
      // atom_manifestations nicht — deren container (cell) wurde aber
      // bereits per nodes-Cascade entfernt. Direkter Delete reicht.
      await supabase.from('info_fields').delete().in('id', insertedInfoFieldIds);
    }
    // Heptad-Round-Trip Workspace-Globals (WV.E #40-Phase-2). Reihenfolge:
    // - widget_external_channels (FK zu template_widgets, NICHT cascade-
    //   getriggert weil template_widgets-Delete unten nochmal greift)
    // - cell_widget_overrides (FK zu instances + widgets)
    // - cell_template_instances (FK zu cells + templates)
    // - hotkey_slots (FK zu templates)
    // - saved_filters (workspace-scope, keine Children)
    // - feature_templates (FK-Wurzel — cascadet auf sections + widgets)
    if ((workspaceGlobals.atomMarkerIds ?? []).length > 0) {
      // atom_markers haben FK auf atom-Tabellen — atom-Inserts kommen
      // vor Markers, also Markers zuerst aufraeumen damit der nachher
      // folgende Atom-Cleanup nicht in Marker-FK-Constraints rennt.
      await supabase
        .from('atom_markers')
        .delete()
        .in('id', workspaceGlobals.atomMarkerIds as string[]);
    }
    if ((workspaceGlobals.widgetExternalChannelIds ?? []).length > 0) {
      await supabase
        .from('widget_external_channels')
        .delete()
        .in('id', workspaceGlobals.widgetExternalChannelIds as string[]);
    }
    if ((workspaceGlobals.cellWidgetOverrideIds ?? []).length > 0) {
      await supabase
        .from('cell_widget_overrides')
        .delete()
        .in('id', workspaceGlobals.cellWidgetOverrideIds as string[]);
    }
    if ((workspaceGlobals.cellTemplateInstanceIds ?? []).length > 0) {
      await supabase
        .from('cell_template_instances')
        .delete()
        .in('id', workspaceGlobals.cellTemplateInstanceIds as string[]);
    }
    if ((workspaceGlobals.hotkeySlotIds ?? []).length > 0) {
      await supabase
        .from('workspace_hotkey_slots')
        .delete()
        .in('id', workspaceGlobals.hotkeySlotIds as string[]);
    }
    if ((workspaceGlobals.savedFilterIds ?? []).length > 0) {
      await supabase
        .from('saved_filters')
        .delete()
        .in('id', workspaceGlobals.savedFilterIds as string[]);
    }
    if ((workspaceGlobals.groupIds ?? []).length > 0) {
      // group_members hat FK-CASCADE auf groups + objects — beim
      // groups-Delete wird das Member-JOIN automatisch geraeumt.
      await supabase
        .from('groups')
        .delete()
        .in('id', workspaceGlobals.groupIds as string[]);
    }
    if ((workspaceGlobals.objectIds ?? []).length > 0) {
      // object_tags hat FK-CASCADE auf objects.id (beidseitig) —
      // beim objects-Delete wird das Tags-JOIN automatisch geraeumt.
      // nodes/rows/cols/kb_cols.object_id wird per ON DELETE SET NULL
      // entkoppelt (Migration 080+) — wir haben die Subtree-Tabellen
      // ohnehin schon ueber nodes-Cascade entfernt.
      await supabase
        .from('objects')
        .delete()
        .in('id', workspaceGlobals.objectIds as string[]);
    }
    if ((workspaceGlobals.featureTemplateIds ?? []).length > 0) {
      // FK-CASCADE entfernt template_sections + template_widgets
      // automatisch — keine separaten Delete-Calls noetig.
      await supabase
        .from('feature_templates')
        .delete()
        .in('id', workspaceGlobals.featureTemplateIds as string[]);
    }
  } catch {
    // Original-Error bleibt im Vordergrund.
  }
}

// ─── Clear-Helpers (fuer Overwrite-Modus) ──────────────────────

// Loescht Sub-Matrix / Sub-Board einer Zelle. Cascades via DB-FK
// (nodes -> rows/cols/cells -> kb_cols/kb_cards/links usw.) sollten
// alle tieferen Rows mitnehmen; falls nicht, waere manuelles Delete
// noetig — im aktuellen Schema uebernimmt ON DELETE CASCADE das.
async function clearCellSubstructure(cellId: string): Promise<void> {
  const { data: cell, error } = await supabase
    .from('cells')
    .select('child_matrix_id, board_id, features')
    .eq('id', cellId)
    .single();
  if (error || !cell) return;
  const subIds = [cell.child_matrix_id, cell.board_id].filter((x): x is string => !!x);
  // 1. Cell-FKs auf NULL — sonst verhindert FK das Node-Delete.
  //    Features 'matrix'/'board' entfernen, Info/Checklists bleiben.
  const nextFeatures = ((cell.features ?? []) as string[]).filter(
    (f) => f !== 'matrix' && f !== 'board',
  );
  const { error: upErr } = await supabase
    .from('cells')
    .update({
      child_matrix_id: null,
      board_id: null,
      features: nextFeatures,
    })
    .eq('id', cellId);
  if (upErr) throw upErr;
  // 2. Nodes selbst loeschen — per DB-Cascade gehen Rows/Cols/Cells/
  //    Boards/Cards/Links mit.
  for (const id of subIds) {
    const { error: dErr } = await supabase.from('nodes').delete().eq('id', id);
    if (dErr) throw dErr;
  }
}

// Leert infoFields + links in cell.data und nimmt 'info' aus features.
export async function clearCellInfoData(cellId: string): Promise<void> {
  const { data: cell, error } = await supabase
    .from('cells')
    .select('data, features')
    .eq('id', cellId)
    .single();
  if (error || !cell) return;
  const data = (cell.data as unknown as Record<string, unknown>) ?? {};
  const nextData = { ...data, infoFields: [], links: [] };
  const nextFeatures = ((cell.features ?? []) as string[]).filter((f) => f !== 'info');
  const { error: upErr } = await supabase
    .from('cells')
    .update({ data: nextData, features: nextFeatures })
    .eq('id', cellId);
  if (upErr) throw upErr;
}

// Loescht alle Cell-scoped Checklisten + Items + nimmt 'checklists'
// aus features.
//
// Phase 4 T.1.D + Q.2: Items leben in atom_manifestations(atom_type='task', kind='checklist').
// Wir loeschen erst die Tasks dieser Manifestations (CASCADE killt
// die Manifestations), dann die Checklisten.
export async function clearCellChecklistsData(cellId: string): Promise<void> {
  const { data: lists, error } = await supabase
    .from('checklists')
    .select('id')
    .eq('cell_id', cellId);
  if (error) throw error;
  const ids = ((lists ?? []) as Array<{ id: string }>).map((l) => l.id);
  if (ids.length > 0) {
    // 1. Tasks der checklist-Manifestations dieser Listen ermitteln.
    const { data: itManifs, error: imErr } = await supabase
      .from('atom_manifestations')
      .select('atom_id')
      .eq('atom_type', 'task')
      .eq('kind', 'checklist')
      .in('container_id', ids);
    if (imErr) throw imErr;
    const taskIds = ((itManifs ?? []) as Array<{ atom_id: string }>).map((m) => m.atom_id);
    if (taskIds.length > 0) {
      const { error: tasksErr } = await supabase.from('tasks').delete().in('id', taskIds);
      if (tasksErr) throw tasksErr;
    }
    // 2. Checklisten loeschen.
    const { error: clErr } = await supabase.from('checklists').delete().in('id', ids);
    if (clErr) throw clErr;
  }
  const { data: cell } = await supabase.from('cells').select('features').eq('id', cellId).single();
  if (cell) {
    const nextFeatures = ((cell.features ?? []) as string[]).filter((f) => f !== 'checklists');
    await supabase.from('cells').update({ features: nextFeatures }).eq('id', cellId);
  }
}

// Loescht Docs die an cellId gepinnt sind. WV.WV.1: Lookup ueber
// atom_manifestations (kind='pinned', container_kind='cell',
// atom_type='doc'), dann Doc-Delete. Multi-Pin: ein Doc das auch an
// andere Cells haengt verschwindet nicht — nur sein Pin auf cellId.
// Das passiert automatisch beim Cell-Delete via Cascade-Trigger auf
// atom_manifestations (Migration 066:_atom_manif_purge_for_cell),
// hier brauchen wir nur den Doc-Delete fuer Single-Cell-Docs.
async function clearCellDocs(cellId: string): Promise<void> {
  // Pins finden
  const { data: pins, error: pinsErr } = await supabase
    .from('atom_manifestations')
    .select('atom_id')
    .eq('kind', 'pinned')
    .eq('container_kind', 'cell')
    .eq('container_id', cellId)
    .eq('atom_type', 'doc');
  if (pinsErr) throw pinsErr;
  const docIds = ((pins ?? []) as Array<{ atom_id: string }>).map((p) => p.atom_id);
  if (docIds.length === 0) return;
  // Pins purgen
  const { error: delPinErr } = await supabase
    .from('atom_manifestations')
    .delete()
    .eq('kind', 'pinned')
    .eq('container_kind', 'cell')
    .eq('container_id', cellId)
    .eq('atom_type', 'doc');
  if (delPinErr) throw delPinErr;
  // Docs purgen
  const { error: delDocErr } = await supabase.from('docs').delete().in('id', docIds);
  if (delDocErr) throw delDocErr;
}

// Alle zusammen — wird bei Cell-Subtree-Overwrite benutzt, weil der
// neue Import alles an der Zielzelle ersetzt.
export async function clearCellCompletely(cellId: string): Promise<void> {
  await clearCellSubstructure(cellId);
  await clearCellInfoData(cellId);
  await clearCellChecklistsData(cellId);
  await clearCellDocs(cellId);
}

// Sammelt rekursiv alle descendant-Node-IDs (Sub-Matrizen + Sub-
// Boards + deren Subs). Start ist matrixId, die Root selbst wird NICHT
// ins Ergebnis aufgenommen (Caller will die Target-Matrix behalten).
// Walking ueber cells.child_matrix_id + cells.board_id. Board-Nodes
// sind Blaetter (keine cells) und beenden den Branch.
async function collectDescendantNodeIds(rootMatrixId: string): Promise<string[]> {
  const descendants: string[] = [];
  const seen = new Set<string>([rootMatrixId]);
  const stack: string[] = [rootMatrixId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) break;
    const { data: cells, error } = await supabase
      .from('cells')
      .select('child_matrix_id, board_id')
      .eq('matrix_id', id);
    if (error) throw error;
    for (const c of (cells ?? []) as Array<{
      child_matrix_id: string | null;
      board_id: string | null;
    }>) {
      if (c.child_matrix_id && !seen.has(c.child_matrix_id)) {
        seen.add(c.child_matrix_id);
        descendants.push(c.child_matrix_id);
        stack.push(c.child_matrix_id);
      }
      if (c.board_id && !seen.has(c.board_id)) {
        seen.add(c.board_id);
        descendants.push(c.board_id);
        stack.push(c.board_id);
      }
    }
  }
  return descendants;
}

// Pre-Cleanup-Helper fuer Phase 4 T.1.D + Q.2: das Schema hat keinen FK
// von atom_manifestations.container_id auf kb_cols/checklists (poly-
// morpher Container). Damit cascadet ein DELETE auf nodes/kb_cols/
// checklists NICHT auf manifestations + tasks. Wir muessen die Tasks
// vorher loeschen — der Pseudo-CASCADE-Trigger purgt die Manifestations
// ueber tasks.id.
async function cleanupTasksForNodeIds(nodeIds: string[]): Promise<void> {
  if (nodeIds.length === 0) return;
  // 1. kanban-Manifestations mit display_meta.board_id ∈ nodeIds.
  //    Wir holen alle (workspace-scoped via RLS) und filtern client-side
  //    — JSONB-Index fehlt.
  const { data: kbManifs, error: kbErr } = await supabase
    .from('atom_manifestations')
    .select('atom_id, display_meta')
    .eq('atom_type', 'task')
    .eq('kind', 'kanban');
  if (kbErr) throw kbErr;
  const idSet = new Set(nodeIds);
  const cardTaskIds = (
    (kbManifs ?? []) as Array<{
      atom_id: string;
      display_meta: Record<string, unknown> | null;
    }>
  )
    .filter((m) => {
      const bId = (m.display_meta as Record<string, unknown> | null)?.board_id;
      return typeof bId === 'string' && idSet.has(bId);
    })
    .map((m) => m.atom_id);

  // 2. Checklisten in diesen Boards.
  const { data: cls, error: clQErr } = await supabase
    .from('checklists')
    .select('id')
    .in('board_id', nodeIds);
  if (clQErr) throw clQErr;
  const clIds = ((cls ?? []) as Array<{ id: string }>).map((c) => c.id);

  // 3. checklist-Manifestations in diesen Checklisten.
  let itemTaskIds: string[] = [];
  if (clIds.length > 0) {
    const { data: itManifs, error: imErr } = await supabase
      .from('atom_manifestations')
      .select('atom_id')
      .eq('atom_type', 'task')
      .eq('kind', 'checklist')
      .in('container_id', clIds);
    if (imErr) throw imErr;
    itemTaskIds = ((itManifs ?? []) as Array<{ atom_id: string }>).map((m) => m.atom_id);
  }

  // 4. Tasks bulk-delete (Pseudo-CASCADE-Trigger purgt manifestations).
  const allTaskIds = [...cardTaskIds, ...itemTaskIds];
  if (allTaskIds.length > 0) {
    const { error: tasksErr } = await supabase.from('tasks').delete().in('id', allTaskIds);
    if (tasksErr) throw tasksErr;
  }
}

async function cleanupTasksForCellIds(cellIds: string[]): Promise<void> {
  if (cellIds.length === 0) return;
  const { data: cls, error: clErr } = await supabase
    .from('checklists')
    .select('id')
    .in('cell_id', cellIds);
  if (clErr) throw clErr;
  const clIds = ((cls ?? []) as Array<{ id: string }>).map((c) => c.id);
  if (clIds.length === 0) return;
  const { data: itManifs, error: imErr } = await supabase
    .from('atom_manifestations')
    .select('atom_id')
    .eq('atom_type', 'task')
    .eq('kind', 'checklist')
    .in('container_id', clIds);
  if (imErr) throw imErr;
  const taskIds = ((itManifs ?? []) as Array<{ atom_id: string }>).map((m) => m.atom_id);
  if (taskIds.length > 0) {
    const { error: tasksErr } = await supabase.from('tasks').delete().in('id', taskIds);
    if (tasksErr) throw tasksErr;
  }
}

// Leert eine Matrix komplett: descendant-Nodes rekursiv loeschen
// (sonst werden sie beim Cell-Delete orphan wegen nodes.parent_cell_id
// ON DELETE SET NULL), dann Docs, dann Cells/Rows/Cols der Matrix.
// Der Matrix-Node selbst (mit Label/Alias/Notizen) bleibt unberuehrt.
//
// Phase 4 T.1.D: Tasks der descendant-Boards/Checklisten muessen vor
// dem Node-Delete gepurged werden (kein FK-Cascade). Der target-Matrix
// hat eigene cell-attached Checklisten — auch dafuer cleanup.
export async function clearMatrixContents(matrixId: string): Promise<void> {
  const descendants = await collectDescendantNodeIds(matrixId);

  const matrixIdsForCells = [matrixId, ...descendants];
  const { data: cells, error: cellsQueryErr } = await supabase
    .from('cells')
    .select('id')
    .in('matrix_id', matrixIdsForCells);
  if (cellsQueryErr) throw cellsQueryErr;
  const cellIds = ((cells ?? []) as Array<{ id: string }>).map((c) => c.id);

  // Phase 4 T.1.D: Tasks der descendant-Boards (kanban + ihre Checklisten)
  // vorher loeschen, sonst orphaned manifestations.
  await cleanupTasksForNodeIds(descendants);
  // cell-attached Checklisten der Matrix-Cells mit cleanup.
  await cleanupTasksForCellIds(cellIds);

  if (cellIds.length > 0) {
    // WV.WV.1: Doc-an-Cell-Pin lebt in atom_manifestations(kind='pinned').
    // Erst Pin-Lookup, dann Pins+Docs purgen. Multi-Pin-Docs verlieren
    // nur ihre Cell-Pins, die Doc bleibt erhalten wenn weitere Pins
    // existieren.
    const { data: pinsToDel, error: pinsErr } = await supabase
      .from('atom_manifestations')
      .select('id, atom_id')
      .eq('kind', 'pinned')
      .eq('container_kind', 'cell')
      .eq('atom_type', 'doc')
      .in('container_id', cellIds);
    if (pinsErr) throw pinsErr;
    const pinRows = (pinsToDel ?? []) as Array<{ id: string; atom_id: string }>;
    if (pinRows.length > 0) {
      const docIds = pinRows.map((p) => p.atom_id);
      const pinIds = pinRows.map((p) => p.id);
      const { error: delPinErr } = await supabase
        .from('atom_manifestations')
        .delete()
        .in('id', pinIds);
      if (delPinErr) throw delPinErr;
      // Single-Pin-Docs purgen wir vollstaendig. Multi-Pin-Docs (die
      // auch an anderen Containern haengen) wollen wir nicht killen —
      // pruefen via verbleibende kind='pinned'-Manifestations.
      const { data: remaining, error: remErr } = await supabase
        .from('atom_manifestations')
        .select('atom_id')
        .eq('kind', 'pinned')
        .eq('atom_type', 'doc')
        .in('atom_id', docIds);
      if (remErr) throw remErr;
      const stillPinned = new Set(
        ((remaining ?? []) as Array<{ atom_id: string }>).map((r) => r.atom_id),
      );
      const orphaned = docIds.filter((id) => !stillPinned.has(id));
      if (orphaned.length > 0) {
        const { error: delDocErr } = await supabase.from('docs').delete().in('id', orphaned);
        if (delDocErr) throw delDocErr;
      }
    }
  }

  if (descendants.length > 0) {
    const { error: dnErr } = await supabase.from('nodes').delete().in('id', descendants);
    if (dnErr) throw dnErr;
  }

  const { error: cErr } = await supabase.from('cells').delete().eq('matrix_id', matrixId);
  if (cErr) throw cErr;
  const { error: rErr } = await supabase.from('rows').delete().eq('matrix_id', matrixId);
  if (rErr) throw rErr;
  const { error: colErr } = await supabase.from('cols').delete().eq('matrix_id', matrixId);
  if (colErr) throw colErr;
}

// ─── Haupt-Import-Funktionen ───────────────────────────────────

export async function executeSubtreeImportIntoCell(args: {
  payload: WorkspaceExport;
  workspaceId: string;
  targetCellId: string;
  mode?: ImportMode;
}): Promise<{ rootNodeId: string; aliasMap: Map<string, string> }> {
  const { payload, workspaceId, targetCellId } = args;
  const mode = args.mode ?? 'add';
  if (payload.payloadType !== 'subtree' && payload.payloadType !== 'workspace') {
    throw new ImportError(
      'In eine Zelle mit Sub-Struktur passt nur ein Bereichs-Export. Diese Datei ist ein anderer Typ.',
    );
  }

  // Progress-Tracking. Total haengt am Modus + am Payload-Typ
  // (Container-Merge hat weniger Phasen als Subtree).
  const hasSubtree = (payload.nodes as unknown[]).length > 0;
  const hasInfoFieldsCell = Array.isArray(payload.info_fields) && payload.info_fields.length > 0;
  const phaseTotal =
    (mode === 'export-overwrite' ? 1 : 0) +
    (mode === 'overwrite' || mode === 'export-overwrite' ? 1 : 0) +
    (hasSubtree ? 13 : 4) +
    (hasSubtree && hasInfoFieldsCell ? 2 : 0);
  let phaseIdx = 0;
  const step = (label: string) => {
    phaseIdx += 1;
    setProgressPhase(label, phaseIdx, phaseTotal);
  };

  // Ueberschreiben: zuerst optional exportieren, dann Ziel-Zelle
  // leerraeumen (Sub-Struktur + Info + Checklisten). Danach geht der
  // normale Import durch, das "Slot schon belegt"-Guard greift nicht.
  if (mode === 'export-overwrite') {
    step('Sicherungs-Export…');
    const { exportCellSubtree, downloadSubtreeExport } = await import('./export');
    const current = await exportCellSubtree(targetCellId, workspaceId);
    await downloadSubtreeExport(current, 'backup-ziel-zelle');
  }
  if (mode === 'overwrite' || mode === 'export-overwrite') {
    step('Ziel-Zelle leeren…');
    await clearCellCompletely(targetCellId);
  }

  // Sonderfall: Cell-Export ohne Sub-Matrix/Sub-Board. Dann enthaelt
  // der Payload nur die eine Cell als Container (Info-Daten + Check-
  // listen). Wir leiten auf den Merge-Flow um — dort werden Felder,
  // Links und Checklisten in die Target-Zelle gemerged, ohne neuen
  // Node anzulegen.
  if (!hasSubtree) {
    await executeCellContainerMerge({
      payload,
      workspaceId,
      targetCellId,
      step,
    });
    // rootNodeId gibt es hier nicht — wir retournieren die Target-
    // Cell-ID als Pseudo-Root fuer Caller-Kompatibilitaet.
    return { rootNodeId: targetCellId, aliasMap: new Map() };
  }

  step('Vorbereitung…');

  // Root-Node finden: ein Node, dessen parent_cell_id NICHT in den
  // exportierten Cells liegt. Das deckt drei Faelle ab:
  //   a) parent_cell_id=null (neuer Export, explizit genullt).
  //   b) parent_cell_id zeigt auf eine Cell, die NICHT mit exportiert
  //      wurde — d.h. der Quell-Node ist der Top-Root der Payload.
  //      (Ältere Exports vor dem parent-strip-Fix.)
  // Nur Nodes mit parent im exportierten Cell-Set sind innere Sub-Nodes.
  const exportedCellIds = new Set((payload.cells as Array<{ id: string }>).map((c) => c.id));
  const rootRow = (
    payload.nodes as Array<{
      id: string;
      type: string;
      parent_cell_id: string | null;
    }>
  ).find((n) => !n.parent_cell_id || !exportedCellIds.has(n.parent_cell_id));
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
  for (const cl of payload.checklists) remap((cl as { id: string }).id, remapMap);
  for (const it of payload.checklist_items) remap((it as { id: string }).id, remapMap);
  for (const l of payload.links) remap((l as { id: string }).id, remapMap);

  // B1-A-006-Restposten — Object-Layer-Block. objects/groups bekommen
  // hier ihren Pre-Pass + FK-Auflösung (home_ref_id, parent_id, tags,
  // group_members). Muss NACH den Subtree-Pre-Passes laufen, weil
  // objects.home_ref_id auf row/col/kb_col/node remap-pflichtig ist.
  const objectLayer = buildObjectLayerOut(payload, workspaceId, remapMap);

  // Rows mappen + FKs auf neue IDs umbiegen + workspace_id setzen.
  // Wichtig: nodes.parent_cell_id wird IM INSERT auf NULL gesetzt,
  // weil die gezielten cells erst in einer spaeteren Phase existieren
  // (FK-Schleife: nodes -> cells -> nodes). Die korrekten Parent-
  // Verweise werden nach den cells per UPDATE nachgezogen.
  const rootNewId = mustRemap(rootRow.id, remapMap);
  const nodesOut = (payload.nodes as Array<Record<string, unknown>>).map((n) => {
    const id = (n as { id: string }).id;
    // NT.2: created_by aus dem Payload entfernen — importierte Knoten
    // gehoeren dem importierenden User (Default auth.uid() greift),
    // nicht dem urspruenglichen Ersteller eines fremden Workspaces.
    const { created_by: _imported, ...rest } = n;
    void _imported;
    return applyObjectIdMap(
      applyAliasMap(
        {
          ...rest,
          id: mustRemap(id, remapMap),
          workspace_id: workspaceId,
          // Im Insert zunaechst NULL. Root-Node und alle Sub-Nodes
          // bekommen ihren parent_cell_id erst im UPDATE-Schritt
          // (siehe Phase D unten).
          parent_cell_id: null,
        },
        aliasMap,
      ),
      remapMap,
    );
  });
  // Mapping Old-Node-ID -> gewuenschter finaler parent_cell_id
  // (Target-Cell fuer Root, remapped cell-id fuer Sub-Nodes).
  const nodeParentUpdates: Array<{ id: string; parent_cell_id: string }> = [];
  for (const n of payload.nodes as Array<{ id: string; parent_cell_id: string | null }>) {
    const newId = mustRemap(n.id, remapMap);
    if (n.id === rootRow.id) {
      nodeParentUpdates.push({ id: newId, parent_cell_id: targetCellId });
    } else if (n.parent_cell_id) {
      const mappedParent = remapMap.get(n.parent_cell_id);
      if (mappedParent) {
        nodeParentUpdates.push({ id: newId, parent_cell_id: mappedParent });
      }
    }
  }

  const rowsOut = (payload.rows as Array<Record<string, unknown>>).map((r) =>
    applyObjectIdMap(
      {
        ...r,
        id: mustRemap((r as { id: string }).id, remapMap),
        workspace_id: workspaceId,
        matrix_id: remap((r as { matrix_id: string }).matrix_id, remapMap),
      },
      remapMap,
    ),
  );

  const colsOut = (payload.cols as Array<Record<string, unknown>>).map((c) =>
    applyObjectIdMap(
      {
        ...c,
        id: mustRemap((c as { id: string }).id, remapMap),
        workspace_id: workspaceId,
        matrix_id: remap((c as { matrix_id: string }).matrix_id, remapMap),
      },
      remapMap,
    ),
  );

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
        id: mustRemap(raw.id, remapMap),
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

  const kbColsOut = (payload.kb_cols as Array<Record<string, unknown>>).map((k) =>
    applyObjectIdMap(
      {
        ...k,
        id: mustRemap((k as { id: string }).id, remapMap),
        workspace_id: workspaceId,
        board_id: remap((k as { board_id: string }).board_id, remapMap),
      },
      remapMap,
    ),
  );

  const kbCardsOut = (payload.kb_cards as Array<Record<string, unknown>>).map((k) => {
    const raw = k as {
      id: string;
      board_id: string;
      col_id: string;
      checklist_ref: string | null;
      source_cl_id: string | null;
    };
    // FK-Felder explizit remappen. checklist_ref/source_cl_id zeigen
    // auf checklists innerhalb des Payloads; ohne Remap zeigen sie
    // nach dem Import auf alte / nicht existierende Checklisten.
    const checklistRefMapped =
      raw.checklist_ref && remapMap.has(raw.checklist_ref)
        ? mustRemap(raw.checklist_ref, remapMap)
        : raw.checklist_ref
          ? null // Referenz zeigt aus dem Payload raus — sauber auf NULL setzen.
          : null;
    const sourceClMapped =
      raw.source_cl_id && remapMap.has(raw.source_cl_id)
        ? mustRemap(raw.source_cl_id, remapMap)
        : raw.source_cl_id
          ? null
          : null;
    return applyAliasMap(
      {
        ...k,
        id: mustRemap(raw.id, remapMap),
        workspace_id: workspaceId,
        board_id: remap(raw.board_id, remapMap),
        col_id: remap(raw.col_id, remapMap),
        checklist_ref: checklistRefMapped,
        source_cl_id: sourceClMapped,
      },
      aliasMap,
    );
  });

  // Checklisten-cell_id: wenn eine Liste im Export cell_id gesetzt
  // hat, aber diese Cell NICHT unter den remappten Cells ist, dann
  // kam sie vom Quell-Container (Cell-Subtree-Export). Wir haengen
  // sie an die Ziel-Zelle.
  const checklistsOut = (payload.checklists as Array<Record<string, unknown>>).map((cl) => {
    const raw = cl as {
      id: string;
      board_id: string | null;
      cell_id: string | null;
    };
    let mappedCellId: string | null = null;
    if (raw.cell_id) {
      if (remapMap.has(raw.cell_id)) {
        mappedCellId = mustRemap(raw.cell_id, remapMap);
      } else {
        // cell_id gehoert zu einer Cell, die nicht im Export drin ist —
        // das ist die Container-Zelle des Exports. Ziel-Zelle nehmen.
        mappedCellId = targetCellId;
      }
    }
    return applyAliasMap(
      {
        ...cl,
        id: mustRemap(raw.id, remapMap),
        workspace_id: workspaceId,
        board_id: remap(raw.board_id, remapMap),
        cell_id: mappedCellId,
      },
      aliasMap,
    );
  });

  const checklistItemsOut = (payload.checklist_items as Array<Record<string, unknown>>).map(
    (it) => ({
      ...it,
      id: mustRemap((it as { id: string }).id, remapMap),
      workspace_id: workspaceId,
      checklist_id: remap((it as { checklist_id: string }).checklist_id, remapMap),
    }),
  );

  const linksOut = (payload.links as Array<Record<string, unknown>>).map((l) => {
    const raw = l as { id: string; board_id: string };
    return applyAliasMap(
      {
        ...l,
        id: mustRemap(raw.id, remapMap),
        workspace_id: workspaceId,
        board_id: remap(raw.board_id, remapMap),
      },
      aliasMap,
    );
  });

  // Docs: neue UUID pro Doc. Welle D — attached_cell_id existiert nicht
  // mehr; legacy-Exporte (vor Welle D) tragen es noch, neuere haben
  // atom_pins separat. Wir bauen zwei Listen: docs (ohne FK) + atom_pins
  // (Doc→Cell, ggf. aus legacy-attached_cell_id rekonstruiert oder aus
  // payload.atom_pins gemappt).
  for (const d of payload.docs) remap((d as { id: string }).id, remapMap);
  // WV.E #40 — info_fields-Atom-IDs vor-mappen (Round-Trip-Loop).
  for (const f of (payload.info_fields ?? []) as Array<{ id: string }>) {
    remap(f.id, remapMap);
  }
  const docPinTargets = new Map<string, string>(); // newDocId -> newCellId
  const docsOut = (payload.docs as Array<Record<string, unknown>>).map((d) => {
    const raw = d as {
      id: string;
      attached_cell_id?: string | null;
    };
    const newDocId = mustRemap(raw.id, remapMap);
    // Legacy-Pfad: wenn attached_cell_id im Export, daraus den Pin
    // rekonstruieren. Falls Cell nicht im remapMap → faellt auf Ziel-
    // Container-Zelle.
    if (raw.attached_cell_id) {
      const remappedCell = remapMap.has(raw.attached_cell_id)
        ? mustRemap(raw.attached_cell_id, remapMap)
        : targetCellId;
      docPinTargets.set(newDocId, remappedCell);
    }
    // attached_cell_id explizit aus dem Insert-Object entfernen — die
    // Spalte existiert nicht mehr.
    const { attached_cell_id: _drop, ...rest } = d as Record<string, unknown> & {
      attached_cell_id?: unknown;
    };
    return applyAliasMap(
      {
        ...rest,
        id: newDocId,
        workspace_id: workspaceId,
      },
      aliasMap,
    );
  });

  // WV.WV.1: Doc-Pins werden als atom_manifestations(kind='pinned')
  // angelegt. Drei Quellen: legacy-rekonstruierte Pins aus
  // docs.attached_cell_id (V0), payload.atom_pins (V1, atom_pins-Tabelle
  // war Welle D), payload.atom_manifestations mit kind='pinned' (V2,
  // post-Migration 066). Backward-Compat-Read fuer alle Pfade.
  const atomPinsOut: Array<Record<string, unknown>> = [];
  // V0/V1 Legacy: Doc→Cell-Pins aus docPinTargets (rekonstruiert aus
  // docs.attached_cell_id oder aus payload.atom_pins V1-Block).
  for (const [docId, cellId] of docPinTargets.entries()) {
    atomPinsOut.push({
      id: newUuid(),
      atom_type: 'doc',
      atom_id: docId,
      workspace_id: workspaceId,
      kind: 'pinned',
      container_kind: 'cell',
      container_id: cellId,
      position: 0,
      level: null,
      display_meta: {},
    });
  }
  // V1-Pfad: payload.atom_pins remappen falls vorhanden (alte Exports).
  if (Array.isArray((payload as Record<string, unknown>).atom_pins)) {
    for (const raw of (payload as { atom_pins: Array<Record<string, unknown>> }).atom_pins) {
      const r = raw as {
        id: string;
        atom_type: string;
        atom_id: string;
        parent_kind: string;
        parent_id: string;
        position?: number;
      };
      // Nur doc-Pins importieren (Tasks/Links/Checklists kommen ueber
      // ihre eigenen Kanaele; falls diese spaeter Pins haben, hier
      // erweitern). parent_kind='cell' nur wenn die Cell im remapMap
      // ist — sonst skippen (Pin-Target nicht im Subtree).
      if (r.atom_type !== 'doc') continue;
      if (r.parent_kind !== 'cell') continue;
      if (!remapMap.has(r.atom_id)) continue;
      const newDocId = mustRemap(r.atom_id, remapMap);
      const newCellId = remapMap.has(r.parent_id) ? mustRemap(r.parent_id, remapMap) : null;
      if (!newCellId) continue;
      // Doppel-Pins (legacy + V1) ueberspringen.
      if (docPinTargets.get(newDocId) === newCellId) continue;
      atomPinsOut.push({
        id: newUuid(),
        atom_type: 'doc',
        atom_id: newDocId,
        workspace_id: workspaceId,
        kind: 'pinned',
        container_kind: 'cell',
        container_id: newCellId,
        position: r.position ?? 0,
        level: null,
        display_meta: {},
      });
    }
  }

  // ─── Welle D — workspace_tags + atom_tags ────────────────────
  // Idempotenter Tag-Import: existing workspace_tags-Rows im Ziel-Workspace
  // werden via (kind,value) wiederverwendet (UNIQUE-Constraint sonst).
  // tag_id-Remap-Map mappt Source-Tag-IDs auf Target-Tag-IDs (existierend
  // oder neu). Nur atom_tags die einen remapped atom_id UND einen
  // remapped tag_id haben werden aus-importiert.
  const workspaceTagsOut: Array<Record<string, unknown>> = [];
  const atomTagsOut: Array<Record<string, unknown>> = [];
  const tagIdRemap = new Map<string, string>();
  const sourceWsTags = Array.isArray((payload as Record<string, unknown>).workspace_tags)
    ? ((payload as { workspace_tags: Array<Record<string, unknown>> }).workspace_tags ?? [])
    : [];
  const sourceAtomTags = Array.isArray((payload as Record<string, unknown>).atom_tags)
    ? ((payload as { atom_tags: Array<Record<string, unknown>> }).atom_tags ?? [])
    : [];
  if (sourceWsTags.length > 0 || sourceAtomTags.length > 0) {
    // Existing Tags im Ziel-Workspace lesen — wir referenzieren sie ueber
    // (kind,value) statt neu anzulegen.
    const { data: existing, error: existingErr } = await supabase
      .from('workspace_tags')
      .select('id, kind, value')
      .eq('workspace_id', workspaceId);
    if (existingErr) throw existingErr;
    const existingByKv = new Map<string, string>();
    for (const e of (existing ?? []) as Array<{ id: string; kind: string; value: string }>) {
      existingByKv.set(`${e.kind}|${e.value}`, e.id);
    }
    for (const raw of sourceWsTags) {
      const r = raw as { id: string; kind: string; value: string; display_label?: string | null };
      const kv = `${r.kind}|${r.value}`;
      const existingId = existingByKv.get(kv);
      if (existingId) {
        tagIdRemap.set(r.id, existingId);
        continue;
      }
      // Neu anlegen — UUID generieren, Registry-Row inserten.
      const newId = newUuid();
      tagIdRemap.set(r.id, newId);
      workspaceTagsOut.push({
        id: newId,
        workspace_id: workspaceId,
        kind: r.kind,
        value: r.value,
        display_label: r.display_label ?? null,
        usage_count: 0,
      });
    }
    // alias_ref-Tags koennen target-IDs als value haben — die haben
    // wir nicht im Ziel-Workspace. Bei alias_ref ist value = der
    // alias-string ('^kuerzel'), bei atom_ref / object_ref = die UUID
    // des Targets. Wenn Target nicht im remapMap, droppen wir die
    // Junction (das atom_ref/object_ref haengt ins Leere).
    for (const raw of sourceAtomTags) {
      const r = raw as {
        id: string;
        atom_type: string;
        atom_id: string;
        tag_id: string;
        position?: number;
      };
      // Atom-id muss im remapMap sein (sonst gehoert das Atom nicht
      // zum Subtree-Import).
      if (!remapMap.has(r.atom_id)) continue;
      const newAtomId = mustRemap(r.atom_id, remapMap);
      const newTagId = tagIdRemap.get(r.tag_id);
      if (!newTagId) continue; // dangling — Source-Tag fehlte im Export
      atomTagsOut.push({
        id: newUuid(),
        atom_type: r.atom_type,
        atom_id: newAtomId,
        workspace_id: workspaceId,
        tag_id: newTagId,
        position: r.position ?? 0,
      });
    }
  }

  // ─── WV.E #40 — info_fields + info-Manifs (Cell-Subtree) ────
  // Analog zur Matrix-Variante: info_fields-Atome workspace-skopiert
  // einfuegen, dann kind='info'-Manifs auf die remapped Sub-Cells
  // anlegen. Trigger T2 erzeugt die kind='calendar'-Auto-Manifs.
  const infoFieldsOutCell = ((payload.info_fields ?? []) as Array<Record<string, unknown>>)
    .filter((f) => remapMap.has((f as { id: string }).id))
    .map((f) => ({
      ...f,
      id: mustRemap((f as { id: string }).id, remapMap),
      workspace_id: workspaceId,
    }));
  const infoFieldManifsOutCell = (payload.atom_manifestations as Array<Record<string, unknown>>)
    .filter((m) => {
      const mm = m as {
        atom_type: string;
        kind: string;
        container_kind: string;
        atom_id: string;
        container_id: string | null;
        display_meta?: Record<string, unknown> | null;
      };
      if (mm.atom_type !== 'info_field') return false;
      if (mm.kind !== 'info') return false;
      if (mm.container_kind !== 'cell') return false;
      if (!mm.container_id) return false;
      if (!remapMap.has(mm.atom_id)) return false;
      if (!remapMap.has(mm.container_id)) return false;
      if ((mm.display_meta as { auto?: boolean } | null)?.auto) return false;
      return true;
    })
    .map((m) => {
      const mm = m as { id: string; atom_id: string; container_id: string };
      return {
        ...m,
        id: newUuid(),
        workspace_id: workspaceId,
        atom_id: mustRemap(mm.atom_id, remapMap),
        container_id: mustRemap(mm.container_id, remapMap),
      };
    });

  // Insert-Reihenfolge loest die FK-Schleife nodes<->cells so auf:
  //   Phase A: alle Nodes mit parent_cell_id=NULL einfuegen.
  //   Phase B: Rows + Cols (haengen an Matrix-Nodes, existieren).
  //   Phase C: Cells inkl. child_matrix_id / board_id — die
  //            referenzierten Sub-Nodes wurden in Phase A angelegt.
  //   Phase D: UPDATE nodes.parent_cell_id aus nodeParentUpdates
  //            (Target-Cell fuer Root, remapped cells fuer Sub-Nodes).
  //   Phase E: Board-interne Tabellen (kb_cols, kb_cards, links) +
  //            Checklisten + Items + info_fields + info-Manifs.
  //
  // Failure-Mode: faellt irgendeine Phase um, raeumt cleanupPartial-
  // Import die schon angelegten Nodes + Docs + info_fields wieder ab
  // (Cascade entfernt rows/cols/cells/kb_*/checklists/items/links/
  // info-Manifs ueber container_id). Der Original-Fehler wird weiter-
  // gereicht, damit der Caller ihn sauber toastet.
  const insertedNodeIds = nodesOut.map((n) => (n as { id: string }).id);
  const insertedDocIds = docsOut.map((d) => (d as { id: string }).id);
  const insertedInfoFieldIdsCell = infoFieldsOutCell.map((f) => (f as { id: string }).id);
  try {
    // B1-A-006-Restposten: Objects + Groups VOR nodes/rows/cols/kb_cols,
    // weil diese 4 Tabellen einen object_id-FK halten. object_tags +
    // group_members nach den jeweiligen Parent-Tabellen (object_tags →
    // objects existieren; group_members → groups + objects existieren).
    if (objectLayer.objectsOut.length > 0) {
      step('Objects einfuegen…');
      await insertBatch('objects', objectLayer.objectsOut);
    }
    if (objectLayer.groupsOut.length > 0) {
      step('Groups einfuegen…');
      await insertBatch('groups', objectLayer.groupsOut);
    }
    if (objectLayer.objectTagsOut.length > 0) {
      step('Object-Tags einfuegen…');
      await insertBatch('object_tags', objectLayer.objectTagsOut);
    }
    if (objectLayer.groupMembersOut.length > 0) {
      step('Group-Members einfuegen…');
      await insertBatch('group_members', objectLayer.groupMembersOut);
    }
    step('Nodes einfuegen…');
    await insertBatch('nodes', nodesOut);
    step('Zeilen einfuegen…');
    await insertBatch('rows', rowsOut);
    step('Spalten einfuegen…');
    await insertBatch('cols', colsOut);
    step('Zellen einfuegen…');
    await insertBatch('cells', cellsOut);
    step('Parent-Verknuepfungen…');
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
    step('Kanban-Spalten einfuegen…');
    await insertBatch('kb_cols', kbColsOut);
    step('Karten einfuegen…');
    {
      const { tasks, manifs } = splitKbCards(kbCardsOut, workspaceId);
      await insertBatch('tasks', tasks);
      await insertBatch('atom_manifestations', manifs);
    }
    step('Checklisten einfuegen…');
    await insertBatch('checklists', checklistsOut);
    step('Checklist-Eintraege einfuegen…');
    {
      const { tasks, manifs } = splitChecklistItems(checklistItemsOut, workspaceId);
      await insertBatch('tasks', tasks);
      await insertBatch('atom_manifestations', manifs);
    }
    step('Links einfuegen…');
    await insertBatch('links', linksOut);
    step('Dokus einfuegen…');
    await insertBatch('docs', docsOut);
    if (atomPinsOut.length > 0) {
      step('Doku-Pins einfuegen…');
      await insertBatch('atom_manifestations', atomPinsOut);
    }
    if (infoFieldsOutCell.length > 0) {
      step('Info-Felder einfuegen…');
      await insertBatch('info_fields', infoFieldsOutCell);
    }
    if (infoFieldManifsOutCell.length > 0) {
      step('Info-Manifestations einfuegen…');
      await insertBatch('atom_manifestations', infoFieldManifsOutCell);
    }
    if (workspaceTagsOut.length > 0) {
      step('Tag-Registry einfuegen…');
      await insertBatch('workspace_tags', workspaceTagsOut);
    }
    if (atomTagsOut.length > 0) {
      step('Atom-Tags einfuegen…');
      await insertBatch('atom_tags', atomTagsOut);
    }
  } catch (err) {
    await cleanupPartialImport(insertedNodeIds, insertedDocIds, insertedInfoFieldIdsCell, {
      // B1-A-006-Restposten: Object-Layer-Inserts geraeumt damit Failure
      // mitten in der Pipeline keine Subtree-fremden Objects hinterlaesst.
      objectIds: objectLayer.insertedObjectIds,
      groupIds: objectLayer.insertedGroupIds,
    });
    throw err;
  }
  step('Ziel-Zelle anpassen…');

  // Target-Cell final patchen: FK-Slot auf neuen Root-Node, Feature-
  // Flag anheben. Wenn payload.sourceCell existiert (Cell-Subtree-
  // Export), mergen wir zusaetzlich info-Felder/Links + aktivieren die
  // passenden Flags (info / checklists).
  const featKey = rootRow.type === 'matrix' ? 'matrix' : 'board';
  const nextFeatures = new Set<string>((targetCell.features ?? []) as string[]);
  nextFeatures.add(featKey);

  const targetDataBase =
    ((targetCell as { data?: unknown }).data as Record<string, unknown> | null) ?? {};
  let mergedData: Record<string, unknown> = { ...targetDataBase };

  if (payload.sourceCell) {
    // Info-Felder + Links mergen — neue UUIDs, damit keine
    // Kollisionen mit bestehenden Feldern auftreten.
    const scData = payload.sourceCell.data ?? {};
    const scFeatures = payload.sourceCell.features ?? [];
    for (const f of scFeatures) {
      if (f === 'info' || f === 'checklists') nextFeatures.add(f);
    }
    const srcFields = Array.isArray((scData as { infoFields?: unknown }).infoFields)
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
    const existingLinks = Array.isArray(mergedData.links) ? (mergedData.links as unknown[]) : [];
    const newFields = srcFields
      .filter((f) => typeof f.label === 'string' && typeof f.value === 'string')
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
        // AU-B1 K9 (B1-I-001 / C6-Partial): javascript:- und andere
        // gefaehrliche Schemes filtern. Render-Pfad ist seit AU-A1.4
        // mit sanitizeUrl gehaerted, aber die URL landete bisher
        // ungefiltert in der DB.
        url: sanitizeUrl(l.url as string) ?? '',
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
  const { error: patchErr } = await supabase.from('cells').update(patch).eq('id', targetCellId);
  if (patchErr) {
    // Ziel-Zelle-Patch hat geworfen — Nodes + Docs + info_fields
    // wurden schon eingefuegt. Cleanup nachziehen, damit der Workspace
    // nicht mit freischwebenden Inserts zurueckbleibt.
    await cleanupPartialImport(insertedNodeIds, insertedDocIds, insertedInfoFieldIdsCell, {
      objectIds: objectLayer.insertedObjectIds,
      groupIds: objectLayer.insertedGroupIds,
    });
    throw patchErr;
  }

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
  // Optionaler Progress-Stepper vom aufrufenden Executor. Wenn
  // gesetzt, stepen wir die drei Teilphasen (Info, Checklisten, Docs)
  // durch.
  step?: (label: string) => void;
}): Promise<void> {
  const { payload, workspaceId, targetCellId, step } = args;
  step?.('Vorbereitung…');
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
    ((payload.cells[0] as { features?: unknown } | undefined)?.features as string[] | undefined) ??
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
  const targetData = (targetCell.data as unknown as Record<string, unknown>) ?? {};
  const existingFields = Array.isArray(targetData.infoFields)
    ? (targetData.infoFields as unknown[])
    : [];
  const existingLinks = Array.isArray(targetData.links) ? (targetData.links as unknown[]) : [];

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
      url: sanitizeUrl(l.url as string) ?? '',
    }));

  // Features mergen: Source-Features (nur info/checklists relevant —
  // matrix/board kommen nicht hier an) + bestehende Target-Features.
  const nextFeatures = new Set<string>((targetCell.features ?? []) as string[]);
  for (const f of sourceFeatures) {
    if (f === 'info' || f === 'checklists') nextFeatures.add(f);
  }
  if (newFields.length > 0 || newLinks.length > 0) nextFeatures.add('info');

  const nextData = {
    ...targetData,
    infoFields: [...existingFields, ...newFields],
    links: [...existingLinks, ...newLinks],
  };

  step?.('Info-Felder mergen…');
  const { error: upErr } = await supabase
    .from('cells')
    .update({ data: nextData, features: Array.from(nextFeatures) })
    .eq('id', targetCellId);
  if (upErr) throw upErr;

  // 2. Checklisten + Items aus dem Payload uebernehmen, alle mit
  //    neuer UUID, cell_id=target, board_id=null, position ans Ende.
  step?.('Checklisten mergen…');
  const remapMap: RemapMap = new Map();
  for (const cl of payload.checklists) remap((cl as { id: string }).id, remapMap);
  for (const it of payload.checklist_items) remap((it as { id: string }).id, remapMap);

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

    const checklistsOut = (payload.checklists as Array<Record<string, unknown>>).map((cl, idx) => {
      const raw = cl as { id: string };
      return applyAliasMap(
        {
          ...cl,
          id: mustRemap(raw.id, remapMap),
          workspace_id: workspaceId,
          board_id: null,
          cell_id: targetCellId,
          position: offset + idx,
        },
        aliasMap,
      );
    });
    const itemsOut = (payload.checklist_items as Array<Record<string, unknown>>).map((it) => ({
      ...it,
      id: mustRemap((it as { id: string }).id, remapMap),
      workspace_id: workspaceId,
      checklist_id: remap((it as { checklist_id: string }).checklist_id, remapMap),
    }));
    await insertBatch('checklists', checklistsOut);
    {
      const { tasks, manifs } = splitChecklistItems(itemsOut, workspaceId);
      await insertBatch('tasks', tasks);
      await insertBatch('atom_manifestations', manifs);
    }
  }

  // 3. Docs aus dem Payload auf die Ziel-Zelle umhaengen. WV.WV.1:
  // Doc-Row + atom_manifestations(kind='pinned') getrennt — Doc-Row
  // hat keine attached_cell_id mehr, der Pin lebt in
  // atom_manifestations(kind='pinned', container_kind='cell').
  step?.('Dokus mergen…');
  if (payload.docs.length > 0) {
    const aliasMap = await reserveAliases(
      workspaceId,
      (payload.docs as Array<{ alias?: unknown }>).flatMap((d) =>
        typeof d.alias === 'string' && d.alias ? [d.alias] : [],
      ),
    );
    const pairs = (payload.docs as Array<Record<string, unknown>>).map((d) => {
      const newDocId = newUuid();
      const { attached_cell_id: _drop, ...rest } = d as Record<string, unknown> & {
        attached_cell_id?: unknown;
      };
      const doc = applyAliasMap(
        {
          ...rest,
          id: newDocId,
          workspace_id: workspaceId,
        },
        aliasMap,
      );
      const pin = {
        id: newUuid(),
        atom_type: 'doc',
        atom_id: newDocId,
        workspace_id: workspaceId,
        kind: 'pinned',
        container_kind: 'cell',
        container_id: targetCellId,
        position: 0,
        level: null,
        display_meta: {},
      };
      return { doc, pin };
    });
    await insertBatch(
      'docs',
      pairs.map((p) => p.doc),
    );
    await insertBatch(
      'atom_manifestations',
      pairs.map((p) => p.pin),
    );
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
  mode?: ImportMode;
}): Promise<{ fieldsAdded: number; linksAdded: number }> {
  const { payload, targetCellId } = args;
  const mode = args.mode ?? 'add';
  if (payload.payloadType !== 'feature-info') {
    throw new ImportError(
      'Das ist kein Info-Export. Bitte waehle eine Info-Datei (enthaelt Felder und Links).',
    );
  }
  // Progress: je 1 Phase fuer backup/clear + 1 fuer Merge.
  const phaseTotal =
    1 +
    (mode === 'overwrite' || mode === 'export-overwrite' ? 1 : 0) +
    (mode === 'export-overwrite' ? 1 : 0);
  let phaseIdx = 0;
  const step = (label: string) => {
    phaseIdx += 1;
    setProgressPhase(label, phaseIdx, phaseTotal);
  };
  if (mode === 'export-overwrite') {
    step('Sicherungs-Export…');
    const { exportFeatureInfo, downloadSubtreeExport } = await import('./export');
    const current = await exportFeatureInfo(targetCellId, args.workspaceId);
    await downloadSubtreeExport(current, 'backup-info');
  }
  if (mode === 'overwrite' || mode === 'export-overwrite') {
    step('Bisherige Info-Daten leeren…');
    await clearCellInfoData(targetCellId);
  }
  step('Info-Felder + Links mergen…');
  const sourceCell = payload.cells[0];
  if (!sourceCell) {
    throw new ImportError('Die Info-Export-Datei ist leer — keine Felder oder Links drin.');
  }
  const sourceData = ((sourceCell as { data?: unknown }).data as Record<string, unknown>) ?? {};
  const sourceFields = (
    Array.isArray(sourceData.infoFields) ? sourceData.infoFields : []
  ) as Array<{
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
  const targetData = (targetCell.data as unknown as Record<string, unknown>) ?? {};
  const existingFields = Array.isArray(targetData.infoFields)
    ? (targetData.infoFields as unknown[])
    : [];
  const existingLinks = Array.isArray(targetData.links) ? (targetData.links as unknown[]) : [];

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
      url: sanitizeUrl(l.url as string) ?? '',
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
  mode?: ImportMode;
}): Promise<{ checklistsAdded: number; itemsAdded: number }> {
  const { payload, workspaceId, targetCellId } = args;
  const mode = args.mode ?? 'add';
  if (payload.payloadType !== 'feature-checklists') {
    throw new ImportError('Das ist kein Checklisten-Export. Bitte waehle eine Checklisten-Datei.');
  }
  // Progress: backup / clear / vorbereitung / listen / items.
  const phaseTotal =
    3 +
    (mode === 'overwrite' || mode === 'export-overwrite' ? 1 : 0) +
    (mode === 'export-overwrite' ? 1 : 0);
  let phaseIdx = 0;
  const step = (label: string) => {
    phaseIdx += 1;
    setProgressPhase(label, phaseIdx, phaseTotal);
  };
  if (mode === 'export-overwrite') {
    step('Sicherungs-Export…');
    const { exportFeatureChecklists, downloadSubtreeExport } = await import('./export');
    const current = await exportFeatureChecklists(targetCellId, workspaceId);
    await downloadSubtreeExport(current, 'backup-checklists');
  }
  if (mode === 'overwrite' || mode === 'export-overwrite') {
    step('Bisherige Checklisten leeren…');
    await clearCellChecklistsData(targetCellId);
  }
  step('Vorbereitung…');
  const aliasMap = await reserveAliases(workspaceId, collectAliases(payload));
  const remapMap: RemapMap = new Map();
  for (const cl of payload.checklists) remap((cl as { id: string }).id, remapMap);
  for (const it of payload.checklist_items) remap((it as { id: string }).id, remapMap);

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

  const checklistsOut = (payload.checklists as Array<Record<string, unknown>>).map((cl, idx) => {
    const raw = cl as { id: string };
    return applyAliasMap(
      {
        ...cl,
        id: mustRemap(raw.id, remapMap),
        workspace_id: workspaceId,
        board_id: null,
        cell_id: targetCellId,
        position: offset + idx,
      },
      aliasMap,
    );
  });

  const itemsOut = (payload.checklist_items as Array<Record<string, unknown>>).map((it) => ({
    ...it,
    id: mustRemap((it as { id: string }).id, remapMap),
    workspace_id: workspaceId,
    checklist_id: remap((it as { checklist_id: string }).checklist_id, remapMap),
  }));

  step('Checklisten einfuegen…');
  await insertBatch('checklists', checklistsOut);
  step('Checklist-Eintraege einfuegen…');
  {
    const { tasks, manifs } = splitChecklistItems(itemsOut, workspaceId);
    await insertBatch('tasks', tasks);
    await insertBatch('atom_manifestations', manifs);
  }

  // Cell-Feature-Flag sicherstellen.
  const { data: targetCell } = await supabase
    .from('cells')
    .select('features')
    .eq('id', targetCellId)
    .single();
  const features = ((targetCell?.features ?? []) as string[]).includes('checklists')
    ? (targetCell?.features as string[])
    : [...((targetCell?.features ?? []) as string[]), 'checklists'];
  if (!((targetCell?.features ?? []) as string[]).includes('checklists')) {
    await supabase.from('cells').update({ features }).eq('id', targetCellId);
  }

  return {
    checklistsAdded: checklistsOut.length,
    itemsAdded: itemsOut.length,
  };
}

// Matrix-Merge-Import: die Rows/Cols/Cells + Sub-Nodes der Quell-
// Matrix werden in die Ziel-Matrix integriert. Die Quell-Matrix-Node
// selbst wird nicht angelegt — ihre ID wird auf die Target-Matrix-ID
// remapped, so dass alle Cells/Rows/Cols danach `matrix_id=target`
// haben. Label + Alias der Ziel-Matrix bleiben erhalten.
//
// Modi:
//   - 'add'               Rows+Cols hinten angehaengt (Positions-Offset),
//                         Cells landen automatisch in neuen Koordinaten.
//   - 'overwrite'         Ziel-Matrix erst geleert (clearMatrixContents),
//                         dann wie 'add' (Offset=0, weil leer).
//   - 'export-overwrite'  exportSubtree(target) + Download als Backup,
//                         dann wie 'overwrite'.
export async function executeSubtreeImportIntoMatrix(args: {
  payload: WorkspaceExport;
  workspaceId: string;
  targetMatrixId: string;
  mode?: ImportMode;
}): Promise<{ targetMatrixId: string }> {
  const { payload, workspaceId, targetMatrixId } = args;
  const mode = args.mode ?? 'add';
  if (payload.payloadType !== 'subtree' && payload.payloadType !== 'workspace') {
    throw new ImportError('In eine Matrix kannst du nur einen Matrix-Export einfuegen.');
  }

  // Root-Detection (tolerant zu alten Exports).
  const exportedCellIds = new Set((payload.cells as Array<{ id: string }>).map((c) => c.id));
  const rootRow = (
    payload.nodes as Array<{
      id: string;
      type: string;
      parent_cell_id: string | null;
    }>
  ).find((n) => !n.parent_cell_id || !exportedCellIds.has(n.parent_cell_id));
  if (!rootRow) {
    throw new ImportError(
      'Der Export ist unvollstaendig — es fehlt der Start-Punkt. Die Datei ist vermutlich beschaedigt.',
    );
  }
  if (rootRow.type !== 'matrix') {
    throw new ImportError(
      'In eine Matrix passt nur ein anderer Matrix-Export — Board-Exporte brauchen eine Zelle als Anker.',
    );
  }

  // Progress-Tracking: Gesamtzahl der Phasen haengt am Modus + Payload.
  // Optionale Phasen werden nur gezaehlt, wenn der Payload sie liefert,
  // sonst laeuft phaseIdx ueber phaseTotal hinaus.
  const hasInfoFields = Array.isArray(payload.info_fields) && payload.info_fields.length > 0;
  const isWorkspaceImportPhase = payload.payloadType === 'workspace';
  const hasFeatTpls =
    isWorkspaceImportPhase &&
    Array.isArray(payload.feature_templates) &&
    payload.feature_templates.length > 0;
  const hasSavedFilters =
    isWorkspaceImportPhase &&
    Array.isArray(payload.saved_filters) &&
    payload.saved_filters.length > 0;
  const hasWidgetChannels =
    isWorkspaceImportPhase &&
    Array.isArray(payload.widget_external_channels) &&
    payload.widget_external_channels.length > 0;
  const phaseTotal =
    13 + // Vorbereitung / Nodes / Rows / Cols / Cells / Parent-Updates /
    //    kb_cols / kb_cards / checklists / items / links / docs / Patch
    (mode === 'overwrite' || mode === 'export-overwrite' ? 1 : 0) +
    (mode === 'export-overwrite' ? 1 : 0) +
    (hasInfoFields ? 2 : 0) + // Info-Felder + Info-Manifestations
    (hasFeatTpls ? 4 : 0) + // Templates + Sections + Widgets + RootRef-Update
    (hasFeatTpls ? 2 : 0) + // CellInstances + WidgetOverrides
    (hasFeatTpls ? 1 : 0) + // HotkeySlots
    (hasSavedFilters ? 1 : 0) +
    (hasWidgetChannels ? 1 : 0);
  let phaseIdx = 0;
  const step = (label: string) => {
    phaseIdx += 1;
    setProgressPhase(label, phaseIdx, phaseTotal);
  };

  if (mode === 'export-overwrite') {
    step('Sicherungs-Export…');
    const { exportSubtree, downloadSubtreeExport } = await import('./export');
    const current = await exportSubtree(targetMatrixId, workspaceId);
    await downloadSubtreeExport(current, 'backup-ziel-matrix');
  }
  if (mode === 'overwrite' || mode === 'export-overwrite') {
    step('Ziel-Matrix leeren…');
    await clearMatrixContents(targetMatrixId);
    // Target-Alias fuer die Dauer des Imports auf NULL setzen, damit
    // reserveAliases den alten Target-Alias nicht faelschlich als
    // "belegt" zaehlt und den payload-Root zu "-2" dedupt. Die finale
    // Zuweisung (Label/Alias/Data aus rootRow) passiert nach den
    // Inserts weiter unten.
    const { error: nullErr } = await supabase
      .from('nodes')
      .update({ alias: null })
      .eq('id', targetMatrixId);
    if (nullErr) throw nullErr;
  }

  step('Vorbereitung…');

  // Positions-Offset: wo beginnen die neuen Rows/Cols? Nach dem Clear
  // ist die Matrix leer → Max-Query liefert nichts → Offset=0.
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
  const rowOffset =
    Array.isArray(rowsRes.data) && rowsRes.data.length > 0
      ? ((rowsRes.data[0].position as number) ?? -1) + 1
      : 0;
  const colOffset =
    Array.isArray(colsRes.data) && colsRes.data.length > 0
      ? ((colsRes.data[0].position as number) ?? -1) + 1
      : 0;

  const remapMap: RemapMap = new Map();
  // Root-Matrix-ID -> Target-Matrix-ID (kein neuer Node noetig).
  remapMap.set(rootRow.id, targetMatrixId);
  const aliasMap = await reserveAliases(workspaceId, collectAliases(payload));

  // Alle sonstigen PKs vormappen.
  for (const n of payload.nodes) {
    const id = (n as { id: string }).id;
    if (id !== rootRow.id) remap(id, remapMap);
  }
  for (const r of payload.rows) remap((r as { id: string }).id, remapMap);
  for (const c of payload.cols) remap((c as { id: string }).id, remapMap);
  for (const c of payload.cells) remap((c as { id: string }).id, remapMap);
  for (const k of payload.kb_cols) remap((k as { id: string }).id, remapMap);
  for (const k of payload.kb_cards) remap((k as { id: string }).id, remapMap);
  for (const cl of payload.checklists) remap((cl as { id: string }).id, remapMap);
  for (const it of payload.checklist_items) remap((it as { id: string }).id, remapMap);
  for (const l of payload.links) remap((l as { id: string }).id, remapMap);
  for (const d of payload.docs) remap((d as { id: string }).id, remapMap);
  // WV.E #40 — info_fields-Atom-IDs vor-mappen (Round-Trip-Loop).
  for (const f of (payload.info_fields ?? []) as Array<{ id: string }>) {
    remap(f.id, remapMap);
  }

  // Nodes ohne Root einfuegen, parent_cell_id=NULL (Phase D setzt um).
  // NT.2: created_by aus dem Payload entfernen — importierte Knoten
  // gehoeren dem importierenden User (Default auth.uid() greift), nicht
  // dem urspruenglichen Ersteller eines fremden Workspaces.
  const nodesOut = (payload.nodes as Array<Record<string, unknown>>)
    .filter((n) => (n as { id: string }).id !== rootRow.id)
    .map((n) => {
      const { created_by: _imported, ...rest } = n;
      void _imported;
      return applyAliasMap(
        {
          ...rest,
          id: mustRemap((n as { id: string }).id, remapMap),
          workspace_id: workspaceId,
          parent_cell_id: null,
        },
        aliasMap,
      );
    });

  const nodeParentUpdates: Array<{ id: string; parent_cell_id: string }> = [];
  for (const n of payload.nodes as Array<{
    id: string;
    parent_cell_id: string | null;
  }>) {
    if (n.id === rootRow.id) continue; // Root → Target, kein Insert/Update
    if (n.parent_cell_id) {
      const mapped = remapMap.get(n.parent_cell_id);
      if (mapped) {
        nodeParentUpdates.push({
          id: mustRemap(n.id, remapMap),
          parent_cell_id: mapped,
        });
      }
    }
  }

  // Rows + Cols: matrix_id=target, position mit Offset. Payload-eigene
  // position als relative Reihenfolge beibehalten (fallback idx).
  const rowsOut = (payload.rows as Array<Record<string, unknown>>).map((r, idx) => {
    const raw = r as { id: string; position?: number };
    return {
      ...r,
      id: mustRemap(raw.id, remapMap),
      workspace_id: workspaceId,
      matrix_id: targetMatrixId,
      position: rowOffset + (raw.position ?? idx),
    };
  });
  const colsOut = (payload.cols as Array<Record<string, unknown>>).map((c, idx) => {
    const raw = c as { id: string; position?: number };
    return {
      ...c,
      id: mustRemap(raw.id, remapMap),
      workspace_id: workspaceId,
      matrix_id: targetMatrixId,
      position: colOffset + (raw.position ?? idx),
    };
  });

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
        id: mustRemap(raw.id, remapMap),
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

  const kbColsOut = (payload.kb_cols as Array<Record<string, unknown>>).map((k) => ({
    ...k,
    id: mustRemap((k as { id: string }).id, remapMap),
    workspace_id: workspaceId,
    board_id: remap((k as { board_id: string }).board_id, remapMap),
  }));
  const kbCardsOut = (payload.kb_cards as Array<Record<string, unknown>>).map((k) => {
    const raw = k as {
      id: string;
      board_id: string;
      col_id: string;
      checklist_ref: string | null;
      source_cl_id: string | null;
    };
    return applyAliasMap(
      {
        ...k,
        id: mustRemap(raw.id, remapMap),
        workspace_id: workspaceId,
        board_id: remap(raw.board_id, remapMap),
        col_id: remap(raw.col_id, remapMap),
        checklist_ref:
          raw.checklist_ref && remapMap.has(raw.checklist_ref)
            ? mustRemap(raw.checklist_ref, remapMap)
            : null,
        source_cl_id:
          raw.source_cl_id && remapMap.has(raw.source_cl_id)
            ? mustRemap(raw.source_cl_id, remapMap)
            : null,
      },
      aliasMap,
    );
  });
  const checklistsOut = (payload.checklists as Array<Record<string, unknown>>).map((cl) => {
    const raw = cl as {
      id: string;
      board_id: string | null;
      cell_id: string | null;
    };
    return applyAliasMap(
      {
        ...cl,
        id: mustRemap(raw.id, remapMap),
        workspace_id: workspaceId,
        board_id: remap(raw.board_id, remapMap),
        cell_id: remap(raw.cell_id, remapMap),
      },
      aliasMap,
    );
  });
  const checklistItemsOut = (payload.checklist_items as Array<Record<string, unknown>>).map(
    (it) => ({
      ...it,
      id: mustRemap((it as { id: string }).id, remapMap),
      workspace_id: workspaceId,
      checklist_id: remap((it as { checklist_id: string }).checklist_id, remapMap),
    }),
  );
  const linksOut = (payload.links as Array<Record<string, unknown>>).map((l) => {
    const raw = l as { id: string; board_id: string; url?: string };
    return applyAliasMap(
      {
        ...l,
        id: mustRemap(raw.id, remapMap),
        workspace_id: workspaceId,
        board_id: remap(raw.board_id, remapMap),
        url: sanitizeUrl(raw.url) ?? '',
      },
      aliasMap,
    );
  });
  // Welle D: Docs ohne attached_cell_id-Spalte; Pin-Map separat als
  // atom_pins-INSERT. Legacy-Pfad: attached_cell_id im Export → Pin
  // rekonstruieren (nur wenn Cell im remapMap).
  const docPinTargetsMatrix = new Map<string, string>(); // newDocId -> newCellId
  const docsOut = (payload.docs as Array<Record<string, unknown>>).map((d) => {
    const raw = d as { id: string; attached_cell_id?: string | null };
    const newDocId = mustRemap(raw.id, remapMap);
    if (raw.attached_cell_id && remapMap.has(raw.attached_cell_id)) {
      docPinTargetsMatrix.set(newDocId, mustRemap(raw.attached_cell_id, remapMap));
    }
    const { attached_cell_id: _drop, ...rest } = d as Record<string, unknown> & {
      attached_cell_id?: unknown;
    };
    return applyAliasMap(
      {
        ...rest,
        id: newDocId,
        workspace_id: workspaceId,
      },
      aliasMap,
    );
  });
  const atomPinsOutMatrix: Array<Record<string, unknown>> = [];
  for (const [docId, cellId] of docPinTargetsMatrix.entries()) {
    atomPinsOutMatrix.push({
      id: newUuid(),
      atom_type: 'doc',
      atom_id: docId,
      workspace_id: workspaceId,
      kind: 'pinned',
      container_kind: 'cell',
      container_id: cellId,
      position: 0,
      level: null,
      display_meta: {},
    });
  }
  // V1-Pfad: payload.atom_pins remappen falls vorhanden.
  if (Array.isArray((payload as Record<string, unknown>).atom_pins)) {
    for (const raw of (payload as { atom_pins: Array<Record<string, unknown>> }).atom_pins) {
      const r = raw as {
        id: string;
        atom_type: string;
        atom_id: string;
        parent_kind: string;
        parent_id: string;
        position?: number;
      };
      if (r.atom_type !== 'doc') continue;
      if (r.parent_kind !== 'cell') continue;
      if (!remapMap.has(r.atom_id)) continue;
      const newDocId = mustRemap(r.atom_id, remapMap);
      const newCellId = remapMap.has(r.parent_id) ? mustRemap(r.parent_id, remapMap) : null;
      if (!newCellId) continue;
      if (docPinTargetsMatrix.get(newDocId) === newCellId) continue;
      atomPinsOutMatrix.push({
        id: newUuid(),
        atom_type: 'doc',
        atom_id: newDocId,
        workspace_id: workspaceId,
        kind: 'pinned',
        container_kind: 'cell',
        container_id: newCellId,
        position: r.position ?? 0,
        level: null,
        display_meta: {},
      });
    }
  }

  // ─── WV.E #40 — info_fields + info-Manifs (Matrix-Subtree) ──
  // info_fields-Atome traegt der Subtree-Export workspace-skopiert mit;
  // referenzierte kind='info'-Manifs (container_kind='cell') haengen in
  // payload.atom_manifestations. Beim Insert greift Trigger T2 aus
  // Migration 082 und legt die kind='calendar'-Auto-Manifs fuer
  // value_type='date'-Felder an — der Export traegt sie nicht mit.
  const infoFieldsOut = ((payload.info_fields ?? []) as Array<Record<string, unknown>>)
    .filter((f) => remapMap.has((f as { id: string }).id))
    .map((f) => ({
      ...f,
      id: mustRemap((f as { id: string }).id, remapMap),
      workspace_id: workspaceId,
    }));
  const infoFieldManifsOut = (payload.atom_manifestations as Array<Record<string, unknown>>)
    .filter((m) => {
      const mm = m as {
        atom_type: string;
        kind: string;
        container_kind: string;
        atom_id: string;
        container_id: string | null;
        display_meta?: Record<string, unknown> | null;
      };
      if (mm.atom_type !== 'info_field') return false;
      if (mm.kind !== 'info') return false;
      if (mm.container_kind !== 'cell') return false;
      if (!mm.container_id) return false;
      // Nur Manifs, deren atom_id + container_id im Subtree liegen.
      if (!remapMap.has(mm.atom_id)) return false;
      if (!remapMap.has(mm.container_id)) return false;
      // Auto-Manifs sollten in kind='info' nicht vorkommen, defensiv:
      if ((mm.display_meta as { auto?: boolean } | null)?.auto) return false;
      return true;
    })
    .map((m) => {
      const mm = m as { id: string; atom_id: string; container_id: string };
      return {
        ...m,
        id: newUuid(),
        workspace_id: workspaceId,
        atom_id: mustRemap(mm.atom_id, remapMap),
        container_id: mustRemap(mm.container_id, remapMap),
      };
    });

  // ─── Welle D — workspace_tags + atom_tags (Matrix-Subtree) ──
  const workspaceTagsOutMatrix: Array<Record<string, unknown>> = [];
  const atomTagsOutMatrix: Array<Record<string, unknown>> = [];
  const tagIdRemapMatrix = new Map<string, string>();
  const sourceWsTagsMatrix = Array.isArray((payload as Record<string, unknown>).workspace_tags)
    ? ((payload as { workspace_tags: Array<Record<string, unknown>> }).workspace_tags ?? [])
    : [];
  const sourceAtomTagsMatrix = Array.isArray((payload as Record<string, unknown>).atom_tags)
    ? ((payload as { atom_tags: Array<Record<string, unknown>> }).atom_tags ?? [])
    : [];
  if (sourceWsTagsMatrix.length > 0 || sourceAtomTagsMatrix.length > 0) {
    const { data: existing, error: existingErr } = await supabase
      .from('workspace_tags')
      .select('id, kind, value')
      .eq('workspace_id', workspaceId);
    if (existingErr) throw existingErr;
    const existingByKv = new Map<string, string>();
    for (const e of (existing ?? []) as Array<{ id: string; kind: string; value: string }>) {
      existingByKv.set(`${e.kind}|${e.value}`, e.id);
    }
    for (const raw of sourceWsTagsMatrix) {
      const r = raw as { id: string; kind: string; value: string; display_label?: string | null };
      const kv = `${r.kind}|${r.value}`;
      const existingId = existingByKv.get(kv);
      if (existingId) {
        tagIdRemapMatrix.set(r.id, existingId);
        continue;
      }
      const newId = newUuid();
      tagIdRemapMatrix.set(r.id, newId);
      workspaceTagsOutMatrix.push({
        id: newId,
        workspace_id: workspaceId,
        kind: r.kind,
        value: r.value,
        display_label: r.display_label ?? null,
        usage_count: 0,
      });
    }
    for (const raw of sourceAtomTagsMatrix) {
      const r = raw as {
        id: string;
        atom_type: string;
        atom_id: string;
        tag_id: string;
        position?: number;
      };
      if (!remapMap.has(r.atom_id)) continue;
      const newAtomId = mustRemap(r.atom_id, remapMap);
      const newTagId = tagIdRemapMatrix.get(r.tag_id);
      if (!newTagId) continue;
      atomTagsOutMatrix.push({
        id: newUuid(),
        atom_type: r.atom_type,
        atom_id: newAtomId,
        workspace_id: workspaceId,
        tag_id: newTagId,
        position: r.position ?? 0,
      });
    }
  }

  // ─── Heptad-Round-Trip Workspace-Globals (WV.E #40-Phase-2) ──
  //
  // Nur fuer Workspace-Exports — Subtree-Exports tragen diese Tabellen
  // nicht (Konzept §15.1, Vorlagen-Bibliothek + Channel-Bridges sind
  // workspace-skopiert). Reihenfolge respektiert FK-Chain:
  //   feature_templates → template_sections → template_widgets →
  //   cell_template_instances → cell_widget_overrides
  //   workspace_hotkey_slots (FK template_id)
  //   saved_filters (independent, scope='workspace' nur)
  //   widget_external_channels (FK widget_id, oauth_token_ref → NULL)
  //
  // feature_templates.root_widget_id ist eine Back-Reference (FK auf
  // template_widgets, das erst SPAETER inseriert wird). V1-Loesung:
  // initial root_widget_id=NULL, post-Insert UPDATE-Phase.
  //
  // Visibility-Filter:
  // - feature_templates: nur visibility='workspace' (platform = system-
  //   seeded, user = importing user hat noch keine User-Templates).
  // - workspace_hotkey_slots: nur scope='workspace' (user-scope = privat).
  // - saved_filters: nur scope='workspace' (analog).
  // - widget_external_channels: oauth_token_ref → NULL (User muss neu
  //   authentisieren, §15.2 Sicherheits-Direktive).

  const isWorkspaceImport = payload.payloadType === 'workspace';

  type FeatTplRow = {
    id: string;
    visibility?: string;
    root_widget_id?: string | null;
    workspace_id?: string | null;
  };
  const sourceFeatTpls = (
    isWorkspaceImport && Array.isArray(payload.feature_templates)
      ? (payload.feature_templates as Array<Record<string, unknown>>)
      : []
  ).filter((t) => (t as FeatTplRow).visibility === 'workspace');
  for (const t of sourceFeatTpls) remap((t as FeatTplRow).id, remapMap);

  const sourceTplSections = (
    isWorkspaceImport && Array.isArray(payload.template_sections)
      ? (payload.template_sections as Array<Record<string, unknown>>)
      : []
  ).filter((s) => remapMap.has((s as { template_id?: string }).template_id ?? ''));
  for (const s of sourceTplSections) remap((s as { id: string }).id, remapMap);

  const sourceTplWidgets = (
    isWorkspaceImport && Array.isArray(payload.template_widgets)
      ? (payload.template_widgets as Array<Record<string, unknown>>)
      : []
  ).filter((w) => remapMap.has((w as { section_id?: string }).section_id ?? ''));
  for (const w of sourceTplWidgets) remap((w as { id: string }).id, remapMap);

  const sourceCellTplInstances = (
    isWorkspaceImport && Array.isArray(payload.cell_template_instances)
      ? (payload.cell_template_instances as Array<Record<string, unknown>>)
      : []
  ).filter((i) => {
    const ii = i as { cell_id?: string; template_id?: string };
    return remapMap.has(ii.cell_id ?? '') && remapMap.has(ii.template_id ?? '');
  });
  for (const i of sourceCellTplInstances) remap((i as { id: string }).id, remapMap);

  const sourceCellWidgetOverrides = (
    isWorkspaceImport && Array.isArray(payload.cell_widget_overrides)
      ? (payload.cell_widget_overrides as Array<Record<string, unknown>>)
      : []
  ).filter((o) => {
    const oo = o as { instance_id?: string; widget_id?: string };
    return remapMap.has(oo.instance_id ?? '') && remapMap.has(oo.widget_id ?? '');
  });
  for (const o of sourceCellWidgetOverrides) remap((o as { id: string }).id, remapMap);

  const sourceHotkeySlots = (
    isWorkspaceImport && Array.isArray(payload.workspace_hotkey_slots)
      ? (payload.workspace_hotkey_slots as Array<Record<string, unknown>>)
      : []
  ).filter((h) => {
    const hh = h as { scope?: string; template_id?: string };
    return hh.scope === 'workspace' && (!hh.template_id || remapMap.has(hh.template_id));
  });
  for (const h of sourceHotkeySlots) remap((h as { id: string }).id, remapMap);

  const sourceSavedFilters = (
    isWorkspaceImport && Array.isArray(payload.saved_filters)
      ? (payload.saved_filters as Array<Record<string, unknown>>)
      : []
  ).filter((f) => (f as { scope?: string }).scope === 'workspace');
  for (const f of sourceSavedFilters) remap((f as { id: string }).id, remapMap);

  const sourceWidgetChannels = (
    isWorkspaceImport && Array.isArray(payload.widget_external_channels)
      ? (payload.widget_external_channels as Array<Record<string, unknown>>)
      : []
  ).filter((c) => remapMap.has((c as { widget_id?: string }).widget_id ?? ''));
  for (const c of sourceWidgetChannels) remap((c as { id: string }).id, remapMap);

  // §13.3 V2 — atom_markers Round-Trip. Filter:
  //   - user_id == auth.uid() (Datenhoheit: nur eigene Markierungen
  //     wandern mit, andere User-IDs wuerden FK auf auth.users nicht
  //     aufloesen).
  //   - atom_id in remapMap (imported_event-Markers haben kein Remap,
  //     external_events sind nicht im Export — siehe §15.2-Pendant).
  const { data: authUserData } = await supabase.auth.getUser();
  const importingUserId = authUserData?.user?.id ?? null;
  const sourceAtomMarkers =
    isWorkspaceImport && Array.isArray(payload.atom_markers) && importingUserId
      ? (payload.atom_markers as Array<Record<string, unknown>>).filter((m) => {
          const mm = m as { user_id?: string; atom_id?: string };
          return mm.user_id === importingUserId && remapMap.has(mm.atom_id ?? '');
        })
      : [];
  for (const m of sourceAtomMarkers) remap((m as { id: string }).id, remapMap);

  // Out-Arrays mit remapped IDs + workspaceId-Patch.
  const featTplsOut = sourceFeatTpls.map((t) => {
    const tt = t as FeatTplRow;
    return {
      ...t,
      id: mustRemap(tt.id, remapMap),
      workspace_id: workspaceId,
      // Back-Ref auf root_widget_id wird nach template_widgets-Insert
      // per UPDATE gesetzt (siehe rootWidgetUpdates).
      root_widget_id: null,
    };
  });
  const rootWidgetUpdates: Array<{ id: string; root_widget_id: string }> = [];
  for (const t of sourceFeatTpls) {
    const tt = t as FeatTplRow;
    if (tt.root_widget_id && remapMap.has(tt.root_widget_id)) {
      rootWidgetUpdates.push({
        id: mustRemap(tt.id, remapMap),
        root_widget_id: mustRemap(tt.root_widget_id, remapMap),
      });
    }
  }
  const tplSectionsOut = sourceTplSections.map((s) => {
    const ss = s as { id: string; template_id: string };
    return {
      ...s,
      id: mustRemap(ss.id, remapMap),
      workspace_id: workspaceId,
      template_id: mustRemap(ss.template_id, remapMap),
    };
  });
  const tplWidgetsOut = sourceTplWidgets.map((w) => {
    const ww = w as { id: string; section_id: string };
    return {
      ...w,
      id: mustRemap(ww.id, remapMap),
      workspace_id: workspaceId,
      section_id: mustRemap(ww.section_id, remapMap),
    };
  });
  const cellTplInstancesOut = sourceCellTplInstances.map((i) => {
    const ii = i as { id: string; cell_id: string; template_id: string };
    return {
      ...i,
      id: mustRemap(ii.id, remapMap),
      workspace_id: workspaceId,
      cell_id: mustRemap(ii.cell_id, remapMap),
      template_id: mustRemap(ii.template_id, remapMap),
    };
  });
  const cellWidgetOverridesOut = sourceCellWidgetOverrides.map((o) => {
    const oo = o as { id: string; instance_id: string; widget_id: string };
    return {
      ...o,
      id: mustRemap(oo.id, remapMap),
      workspace_id: workspaceId,
      instance_id: mustRemap(oo.instance_id, remapMap),
      widget_id: mustRemap(oo.widget_id, remapMap),
    };
  });
  const hotkeySlotsOut = sourceHotkeySlots.map((h) => {
    const hh = h as { id: string; template_id: string | null };
    return {
      ...h,
      id: mustRemap(hh.id, remapMap),
      workspace_id: workspaceId,
      template_id:
        hh.template_id && remapMap.has(hh.template_id) ? mustRemap(hh.template_id, remapMap) : null,
    };
  });
  const savedFiltersOut = sourceSavedFilters.map((f) => {
    const ff = f as { id: string };
    return {
      ...f,
      id: mustRemap(ff.id, remapMap),
      workspace_id: workspaceId,
      // Workspace-shared: kein Owner-User. Falls owner_user_id im
      // Payload gesetzt war (User-scope leakte versehentlich), explizit
      // auf NULL setzen.
      owner_user_id: null,
    };
  });
  const widgetChannelsOut = sourceWidgetChannels.map((c) => {
    const cc = c as { id: string; widget_id: string };
    return {
      ...c,
      id: mustRemap(cc.id, remapMap),
      workspace_id: workspaceId,
      widget_id: mustRemap(cc.widget_id, remapMap),
      // §15.2 Sicherheits-Direktive — Token-Ref haengt im urspruenglichen
      // user_oauth_tokens-Eintrag, der nicht im Export ist. Importer
      // muss neu authentisieren.
      oauth_token_ref: null,
    };
  });
  const atomMarkersOut = sourceAtomMarkers.map((m) => {
    const mm = m as { id: string; atom_id: string };
    return {
      ...m,
      id: mustRemap(mm.id, remapMap),
      workspace_id: workspaceId,
      atom_id: mustRemap(mm.atom_id, remapMap),
      user_id: importingUserId,
    };
  });

  // FK-Order wie bei Cell-Variante: Nodes (parent=null) → Rows → Cols →
  // Cells → UPDATE Nodes.parent_cell_id → kb/checklists/items/links/docs.
  // Bei Failure raeumt cleanupPartialImport angelegte Nodes + Docs +
  // info_fields + Workspace-Globals auf.
  const insertedNodeIds = nodesOut.map((n) => (n as { id: string }).id);
  const insertedDocIds = docsOut.map((d) => (d as { id: string }).id);
  const insertedInfoFieldIds = infoFieldsOut.map((f) => (f as { id: string }).id);
  const insertedFeatTplIds = featTplsOut.map((t) => (t as { id: string }).id);
  const insertedCellTplInstanceIds = cellTplInstancesOut.map((i) => (i as { id: string }).id);
  const insertedCellWidgetOverrideIds = cellWidgetOverridesOut.map((o) => (o as { id: string }).id);
  const insertedHotkeySlotIds = hotkeySlotsOut.map((h) => (h as { id: string }).id);
  const insertedSavedFilterIds = savedFiltersOut.map((f) => (f as { id: string }).id);
  const insertedWidgetChannelIds = widgetChannelsOut.map((c) => (c as { id: string }).id);
  const insertedAtomMarkerIds = atomMarkersOut.map((m) => (m as { id: string }).id);
  const workspaceGlobalsCleanup: WorkspaceGlobalsCleanup = {
    featureTemplateIds: insertedFeatTplIds,
    cellTemplateInstanceIds: insertedCellTplInstanceIds,
    cellWidgetOverrideIds: insertedCellWidgetOverrideIds,
    hotkeySlotIds: insertedHotkeySlotIds,
    savedFilterIds: insertedSavedFilterIds,
    widgetExternalChannelIds: insertedWidgetChannelIds,
    atomMarkerIds: insertedAtomMarkerIds,
  };
  try {
    step('Nodes einfuegen…');
    await insertBatch('nodes', nodesOut);
    step('Zeilen einfuegen…');
    await insertBatch('rows', rowsOut);
    step('Spalten einfuegen…');
    await insertBatch('cols', colsOut);
    step('Zellen einfuegen…');
    await insertBatch('cells', cellsOut);
    step('Parent-Verknuepfungen…');
    for (const up of nodeParentUpdates) {
      const { error: upErr } = await supabase
        .from('nodes')
        .update({ parent_cell_id: up.parent_cell_id })
        .eq('id', up.id);
      if (upErr) throw upErr;
    }
    step('Kanban-Spalten einfuegen…');
    await insertBatch('kb_cols', kbColsOut);
    step('Karten einfuegen…');
    {
      const { tasks, manifs } = splitKbCards(kbCardsOut, workspaceId);
      await insertBatch('tasks', tasks);
      await insertBatch('atom_manifestations', manifs);
    }
    step('Checklisten einfuegen…');
    await insertBatch('checklists', checklistsOut);
    step('Checklist-Eintraege einfuegen…');
    {
      const { tasks, manifs } = splitChecklistItems(checklistItemsOut, workspaceId);
      await insertBatch('tasks', tasks);
      await insertBatch('atom_manifestations', manifs);
    }
    step('Links einfuegen…');
    await insertBatch('links', linksOut);
    step('Dokus einfuegen…');
    await insertBatch('docs', docsOut);
    if (atomPinsOutMatrix.length > 0) {
      step('Doku-Pins einfuegen…');
      await insertBatch('atom_manifestations', atomPinsOutMatrix);
    }
    if (infoFieldsOut.length > 0) {
      step('Info-Felder einfuegen…');
      await insertBatch('info_fields', infoFieldsOut);
    }
    if (infoFieldManifsOut.length > 0) {
      step('Info-Manifestations einfuegen…');
      // Trigger T2 (Migration 082) erzeugt fuer date-Felder
      // automatisch die kind='calendar'-Manif mit display_meta.auto=true.
      await insertBatch('atom_manifestations', infoFieldManifsOut);
    }
    if (workspaceTagsOutMatrix.length > 0) {
      step('Tag-Registry einfuegen…');
      await insertBatch('workspace_tags', workspaceTagsOutMatrix);
    }
    if (atomTagsOutMatrix.length > 0) {
      step('Atom-Tags einfuegen…');
      await insertBatch('atom_tags', atomTagsOutMatrix);
    }
    // ─── Heptad-Round-Trip Workspace-Globals (FK-Order) ──
    if (featTplsOut.length > 0) {
      step('Vorlagen einfuegen…');
      await insertBatch('feature_templates', featTplsOut);
    }
    if (tplSectionsOut.length > 0) {
      step('Vorlagen-Sektionen einfuegen…');
      await insertBatch('template_sections', tplSectionsOut);
    }
    if (tplWidgetsOut.length > 0) {
      step('Vorlagen-Widgets einfuegen…');
      await insertBatch('template_widgets', tplWidgetsOut);
    }
    if (rootWidgetUpdates.length > 0) {
      step('Root-Widget-Verknuepfungen…');
      // feature_templates.root_widget_id ist Back-Ref auf
      // template_widgets — nach Insert per UPDATE setzen.
      for (const up of rootWidgetUpdates) {
        const { error: rwErr } = await supabase
          .from('feature_templates')
          .update({ root_widget_id: up.root_widget_id })
          .eq('id', up.id);
        if (rwErr) throw rwErr;
      }
    }
    if (cellTplInstancesOut.length > 0) {
      step('Cell-Vorlagen-Instanzen einfuegen…');
      await insertBatch('cell_template_instances', cellTplInstancesOut);
    }
    if (cellWidgetOverridesOut.length > 0) {
      step('Cell-Widget-Overrides einfuegen…');
      await insertBatch('cell_widget_overrides', cellWidgetOverridesOut);
    }
    if (hotkeySlotsOut.length > 0) {
      step('Hotkey-Slots einfuegen…');
      await insertBatch('workspace_hotkey_slots', hotkeySlotsOut);
    }
    if (savedFiltersOut.length > 0) {
      step('Gespeicherte Filter einfuegen…');
      await insertBatch('saved_filters', savedFiltersOut);
    }
    if (widgetChannelsOut.length > 0) {
      step('Channel-Bridges einfuegen…');
      // §15.2: oauth_token_ref ist im Out-Array auf NULL gesetzt —
      // User muss neu authentisieren um die Bridge zu reaktivieren.
      await insertBatch('widget_external_channels', widgetChannelsOut);
    }
    if (atomMarkersOut.length > 0) {
      step('User-Markierungen einfuegen…');
      // §13.3 V2: nur eigene atom_markers (Filter weiter oben). Atoms
      // existieren zu diesem Zeitpunkt bereits — FK-Constraint greift
      // sauber. UNIQUE (user_id, atom_type, atom_id, kind) gegen
      // doppelte Importe.
      await insertBatch('atom_markers', atomMarkersOut);
    }
  } catch (err) {
    await cleanupPartialImport(
      insertedNodeIds,
      insertedDocIds,
      insertedInfoFieldIds,
      workspaceGlobalsCleanup,
    );
    throw err;
  }

  step('Ziel-Matrix anpassen…');
  // Bei Ersetzen: Target-Matrix uebernimmt Label/Alias/Data des
  // Payload-Roots. Alias via aliasMap (falls der neue Wert im
  // Workspace kollidiert, gibt's den "-2"-Suffix). Bei Add bleibt
  // der Target-Node unveraendert.
  if (mode === 'overwrite' || mode === 'export-overwrite') {
    const rootLabel = (rootRow as { label?: unknown }).label;
    const rootAlias = (rootRow as { alias?: unknown }).alias;
    const rootData = (rootRow as { data?: unknown }).data;
    const patch: Record<string, unknown> = {};
    if (typeof rootLabel === 'string' && rootLabel) patch.label = rootLabel;
    if (typeof rootAlias === 'string' && rootAlias) {
      patch.alias = aliasMap.get(rootAlias) ?? rootAlias;
    }
    if (rootData && typeof rootData === 'object') patch.data = rootData;
    if (Object.keys(patch).length > 0) {
      const { error: nupErr } = await supabase.from('nodes').update(patch).eq('id', targetMatrixId);
      if (nupErr) {
        // Matrix-Label-/Alias-Patch hat geworfen — Inserts stehen,
        // Workspace ist inkonsistent. Cleanup, damit die zuvor ange-
        // legten Nodes/Docs/Info-Felder/Workspace-Globals nicht als
        // Waisen stehen bleiben.
        await cleanupPartialImport(
          insertedNodeIds,
          insertedDocIds,
          insertedInfoFieldIds,
          workspaceGlobalsCleanup,
        );
        throw nupErr;
      }
    }
  }

  return { targetMatrixId };
}

// Board-Merge-Import: kb_cols + kb_cards + links + board-scoped
// checklists + items werden aus dem Payload in das Ziel-Board
// integriert. Die Root-Board-ID wird auf targetBoardId remapped —
// der Board-Node selbst bleibt (Label/Alias/Notizen ggf. uebernommen
// bei Overwrite).
//
// Sub-Strukturen unter Cells (Matrix/Board-Subs) sind fuer Board-
// Imports nicht relevant — Boards sind Blaetter. Wir filtern den
// Payload entsprechend auf Rows/Items, deren board_id === rootBoardId
// ist, und ignorieren Fremdnodes.
export async function executeSubtreeImportIntoBoard(args: {
  payload: WorkspaceExport;
  workspaceId: string;
  targetBoardId: string;
  mode?: ImportMode;
}): Promise<{ targetBoardId: string }> {
  const { payload, workspaceId, targetBoardId } = args;
  const mode = args.mode ?? 'add';
  if (payload.payloadType !== 'subtree' && payload.payloadType !== 'workspace') {
    throw new ImportError('In ein Board kannst du nur einen Board-Export einfuegen.');
  }

  const exportedCellIds = new Set((payload.cells as Array<{ id: string }>).map((c) => c.id));
  const rootRow = (
    payload.nodes as Array<{
      id: string;
      type: string;
      parent_cell_id: string | null;
    }>
  ).find((n) => !n.parent_cell_id || !exportedCellIds.has(n.parent_cell_id));
  if (!rootRow) {
    throw new ImportError(
      'Der Export ist unvollstaendig — es fehlt der Start-Punkt. Die Datei ist vermutlich beschaedigt.',
    );
  }
  if (rootRow.type !== 'board') {
    throw new ImportError(
      'In ein Board passt nur ein anderer Board-Export — Matrix-Exporte gehen in eine Matrix oder Zelle.',
    );
  }

  // Progress: Vorbereitung + Kanban-Cols + Karten + Checklisten + Items + Links + Patch = 7
  const phaseTotal =
    7 +
    (mode === 'overwrite' || mode === 'export-overwrite' ? 1 : 0) +
    (mode === 'export-overwrite' ? 1 : 0);
  let phaseIdx = 0;
  const step = (label: string) => {
    phaseIdx += 1;
    setProgressPhase(label, phaseIdx, phaseTotal);
  };

  if (mode === 'export-overwrite') {
    step('Sicherungs-Export…');
    const { exportSubtree, downloadSubtreeExport } = await import('./export');
    const current = await exportSubtree(targetBoardId, workspaceId);
    await downloadSubtreeExport(current, 'backup-ziel-board');
  }
  if (mode === 'overwrite' || mode === 'export-overwrite') {
    step('Ziel-Board leeren…');
    // Ziel-Board leeren: Tasks (Karten + Items via cleanupTasksForNodeIds),
    // dann kb_cols, checklists, links.
    await cleanupTasksForNodeIds([targetBoardId]);
    const { error: colsErr } = await supabase
      .from('kb_cols')
      .delete()
      .eq('board_id', targetBoardId);
    if (colsErr) throw colsErr;
    const { error: clErr } = await supabase
      .from('checklists')
      .delete()
      .eq('board_id', targetBoardId);
    if (clErr) throw clErr;
    const { error: linksErr } = await supabase.from('links').delete().eq('board_id', targetBoardId);
    if (linksErr) throw linksErr;
    // Target-Alias auf NULL, damit reserveAliases kollisionsfrei die
    // Payload-Root-Alias verwenden kann.
    const { error: nullErr } = await supabase
      .from('nodes')
      .update({ alias: null })
      .eq('id', targetBoardId);
    if (nullErr) throw nullErr;
  }

  // Position-Offset nach Clear automatisch 0; bei Add an bestehende
  // kb_cols + links anhaengen.
  const [kbColsRes, linksRes] = await Promise.all([
    supabase
      .from('kb_cols')
      .select('position')
      .eq('board_id', targetBoardId)
      .order('position', { ascending: false })
      .limit(1),
    supabase
      .from('links')
      .select('position')
      .eq('board_id', targetBoardId)
      .order('position', { ascending: false })
      .limit(1),
  ]);
  const colOffset =
    Array.isArray(kbColsRes.data) && kbColsRes.data.length > 0
      ? ((kbColsRes.data[0].position as number) ?? -1) + 1
      : 0;
  const linkOffset =
    Array.isArray(linksRes.data) && linksRes.data.length > 0
      ? ((linksRes.data[0].position as number) ?? -1) + 1
      : 0;

  step('Vorbereitung…');
  // Nur Tabellenzeilen des Root-Boards uebernehmen; Fremdinhalt (z.B.
  // verschachtelte Sub-Matrix) aus dem Payload ignorieren.
  const rootId = rootRow.id;
  const kbColsSrc = (
    payload.kb_cols as Array<{ id: string; board_id: string; position?: number }>
  ).filter((k) => k.board_id === rootId);
  const kbCardsSrc = (
    payload.kb_cards as Array<{
      id: string;
      board_id: string;
      col_id: string;
      checklist_ref: string | null;
      source_cl_id: string | null;
    }>
  ).filter((k) => k.board_id === rootId);
  const checklistsSrc = (
    payload.checklists as Array<{ id: string; board_id: string | null }>
  ).filter((cl) => cl.board_id === rootId);
  const checklistIdsSrc = new Set(checklistsSrc.map((cl) => cl.id));
  const itemsSrc = (payload.checklist_items as Array<{ id: string; checklist_id: string }>).filter(
    (it) => checklistIdsSrc.has(it.checklist_id),
  );
  const linksSrc = (
    payload.links as Array<{ id: string; board_id: string; position?: number }>
  ).filter((l) => l.board_id === rootId);

  const remapMap: RemapMap = new Map();
  remapMap.set(rootId, targetBoardId);
  const aliasMap = await reserveAliases(workspaceId, collectAliases(payload));

  for (const k of kbColsSrc) remap(k.id, remapMap);
  for (const k of kbCardsSrc) remap(k.id, remapMap);
  for (const cl of checklistsSrc) remap(cl.id, remapMap);
  for (const it of itemsSrc) remap(it.id, remapMap);
  for (const l of linksSrc) remap(l.id, remapMap);

  const kbColsOut = kbColsSrc.map((k, idx) => ({
    ...(k as unknown as Record<string, unknown>),
    id: mustRemap(k.id, remapMap),
    workspace_id: workspaceId,
    board_id: targetBoardId,
    position: colOffset + (k.position ?? idx),
  }));
  const kbCardsOut = kbCardsSrc.map((k) =>
    applyAliasMap(
      {
        ...(k as unknown as Record<string, unknown>),
        id: mustRemap(k.id, remapMap),
        workspace_id: workspaceId,
        board_id: targetBoardId,
        col_id: remap(k.col_id, remapMap),
        checklist_ref:
          k.checklist_ref && remapMap.has(k.checklist_ref)
            ? mustRemap(k.checklist_ref, remapMap)
            : null,
        source_cl_id:
          k.source_cl_id && remapMap.has(k.source_cl_id)
            ? mustRemap(k.source_cl_id, remapMap)
            : null,
      },
      aliasMap,
    ),
  );
  const checklistsOut = checklistsSrc.map((cl) =>
    applyAliasMap(
      {
        ...(cl as unknown as Record<string, unknown>),
        id: mustRemap(cl.id, remapMap),
        workspace_id: workspaceId,
        board_id: targetBoardId,
        cell_id: null,
      },
      aliasMap,
    ),
  );
  const checklistItemsOut = itemsSrc.map((it) => ({
    ...(it as unknown as Record<string, unknown>),
    id: mustRemap(it.id, remapMap),
    workspace_id: workspaceId,
    checklist_id: remap(it.checklist_id, remapMap),
  }));
  const linksOut = linksSrc.map((l, idx) =>
    applyAliasMap(
      {
        ...(l as unknown as Record<string, unknown>),
        id: mustRemap(l.id, remapMap),
        workspace_id: workspaceId,
        board_id: targetBoardId,
        position: linkOffset + (l.position ?? idx),
      },
      aliasMap,
    ),
  );

  // Insert-Reihenfolge: kb_cols zuerst (kb_cards FK), dann cards,
  // dann checklists (items FK), dann items, dann links.
  step('Kanban-Spalten einfuegen…');
  await insertBatch('kb_cols', kbColsOut);
  step('Karten einfuegen…');
  {
    const { tasks, manifs } = splitKbCards(kbCardsOut, workspaceId);
    await insertBatch('tasks', tasks);
    await insertBatch('atom_manifestations', manifs);
  }
  step('Checklisten einfuegen…');
  await insertBatch('checklists', checklistsOut);
  step('Checklist-Eintraege einfuegen…');
  {
    const { tasks, manifs } = splitChecklistItems(checklistItemsOut, workspaceId);
    await insertBatch('tasks', tasks);
    await insertBatch('atom_manifestations', manifs);
  }
  step('Links einfuegen…');
  await insertBatch('links', linksOut);
  step('Ziel-Board anpassen…');

  // Bei Overwrite: Target-Board-Label/Alias/Data aus Payload-Root.
  if (mode === 'overwrite' || mode === 'export-overwrite') {
    const rootLabel = (rootRow as { label?: unknown }).label;
    const rootAlias = (rootRow as { alias?: unknown }).alias;
    const rootData = (rootRow as { data?: unknown }).data;
    const patch: Record<string, unknown> = {};
    if (typeof rootLabel === 'string' && rootLabel) patch.label = rootLabel;
    if (typeof rootAlias === 'string' && rootAlias) {
      patch.alias = aliasMap.get(rootAlias) ?? rootAlias;
    }
    if (rootData && typeof rootData === 'object') patch.data = rootData;
    if (Object.keys(patch).length > 0) {
      const { error: nupErr } = await supabase.from('nodes').update(patch).eq('id', targetBoardId);
      if (nupErr) throw nupErr;
    }
  }

  return { targetBoardId };
}
