// Parst einen Alt-Client-Payload und baut einen DB-Import-Plan.
// - Jede Alt-ID (Node, Row, Col, Card, ...) bekommt eine frische UUID.
// - Referenzen (boardId, matrixId, checklistRef, sourceClId, colId) werden
//   ueber die UUID-Map aufgeloest.
// - Root-Matrix wird anhand von rootId identifiziert.
// - Aliases werden nicht umbenannt — Collision-Check passiert serverseitig
//   via Unique-Index (DB-Insert schlaegt fehl mit Meldung).

import type {
  AltBoardData,
  AltMatrixData,
  AltNode,
  AltPayload,
  ImportPlan,
  PlannedCell,
  PlannedChecklist,
  PlannedChecklistItem,
  PlannedCol,
  PlannedKbCard,
  PlannedKbCol,
  PlannedLink,
  PlannedNode,
  PlannedRow,
} from './import-types';
import { sanitizeUrl } from './url';

export class ImportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportParseError';
  }
}

function newUuid(): string {
  // crypto.randomUUID ist in modernen Browsern verfuegbar.
  return crypto.randomUUID();
}

// Strikte Validierung der Top-Level-Struktur.
function assertPayload(x: unknown): asserts x is AltPayload {
  if (!x || typeof x !== 'object') {
    throw new ImportParseError('Payload ist kein Objekt.');
  }
  const p = x as Record<string, unknown>;
  if (!p.nodes || typeof p.nodes !== 'object') {
    throw new ImportParseError('Feld "nodes" fehlt oder ist kein Objekt.');
  }
  if (typeof p.rootId !== 'string' || p.rootId.length === 0) {
    throw new ImportParseError('Feld "rootId" fehlt oder ist kein String.');
  }
  const nodes = p.nodes as Record<string, unknown>;
  if (!nodes[p.rootId]) {
    throw new ImportParseError(
      `rootId="${p.rootId}" referenziert keinen Node in "nodes".`,
    );
  }
}

export function parsePayload(rawJson: string): AltPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (e) {
    throw new ImportParseError(
      `JSON ungueltig: ${(e as Error).message}`,
    );
  }
  assertPayload(parsed);
  return parsed;
}

function clampLevel(l: unknown): 0 | 1 | 2 {
  const n = typeof l === 'number' ? Math.floor(l) : 0;
  if (n >= 2) return 2;
  if (n >= 1) return 1;
  return 0;
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function asAlias(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

function asDateString(v: unknown): string | null {
  // Erwartet ISO-Date (YYYY-MM-DD). Alles andere wird zu null.
  if (typeof v !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function safeObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

// ─── Haupt-Planner ────────────────────────────────────────────
export function buildImportPlan(payload: AltPayload): ImportPlan {
  const map = new Map<string, string>(); // altId → newUuid (nur fuer IDs, die gemappt werden)
  const ensureMap = (altId: string): string => {
    let u = map.get(altId);
    if (!u) {
      u = newUuid();
      map.set(altId, u);
    }
    return u;
  };

  const plan: ImportPlan = {
    rootNodeId: '',
    nodes: [],
    rows: [],
    cols: [],
    cells: [],
    kbCols: [],
    checklists: [],
    checklistItems: [],
    kbCards: [],
    links: [],
    parentCellUpdates: [],
  };

  // 1) Alle Nodes vormappen (damit FKs aus Zellen aufloesbar sind).
  const altNodes = payload.nodes as Record<string, AltNode>;
  for (const altId of Object.keys(altNodes)) {
    ensureMap(altId);
  }
  plan.rootNodeId = ensureMap(payload.rootId);

  // 2) Node-Liste bauen (ohne parent_cell_id — kommt in Phase 3).
  for (const [altId, n] of Object.entries(altNodes)) {
    if (n.type !== 'matrix' && n.type !== 'board') continue;
    const planned: PlannedNode = {
      id: ensureMap(altId),
      type: n.type,
      label: asString(n.label, '(ohne Label)'),
      alias: asAlias(n.alias),
      data: {}, // Alt-data wandert nicht als JSONB rein — wir zerlegen in Tabellen.
      parentCellId: null,
    };
    plan.nodes.push(planned);

    // 3) Matrix-spezifisch: rows, cols, cells.
    if (n.type === 'matrix') {
      const d = (n.data ?? {}) as AltMatrixData;
      const rows = Array.isArray(d.rows) ? d.rows : [];
      const cols = Array.isArray(d.cols) ? d.cols : [];
      rows.forEach((r, i) => {
        const rUuid = ensureMap(r.id);
        const pr: PlannedRow = {
          id: rUuid,
          matrix_id: planned.id,
          label: asString(r.label),
          position: i,
        };
        plan.rows.push(pr);
      });
      cols.forEach((c, i) => {
        const cUuid = ensureMap(c.id);
        const pc: PlannedCol = {
          id: cUuid,
          matrix_id: planned.id,
          label: asString(c.label),
          position: i,
        };
        plan.cols.push(pc);
      });

      const cellsObj = (d.cells ?? {}) as Record<string, unknown>;
      for (const [key, cRaw] of Object.entries(cellsObj)) {
        const cell = safeObj(cRaw);
        if (!cell) continue;
        // key = "rowId-colId"
        const dashIdx = key.indexOf('-');
        if (dashIdx < 0) continue;
        const rowAlt = key.slice(0, dashIdx);
        const colAlt = key.slice(dashIdx + 1);
        const rowUuid = map.get(rowAlt);
        const colUuid = map.get(colAlt);
        if (!rowUuid || !colUuid) continue; // verwaiste Cell → ueberspringen

        const features = asStringArray(cell.features);
        const boardIdAlt =
          typeof cell.boardId === 'string' ? cell.boardId : null;
        const matrixIdAlt =
          typeof cell.matrixId === 'string' ? cell.matrixId : null;

        const boardUuid = boardIdAlt ? map.get(boardIdAlt) ?? null : null;
        const childMatrixUuid = matrixIdAlt
          ? map.get(matrixIdAlt) ?? null
          : null;

        // Rest-Daten (infoFields etc.) als jsonb-data mitgeben.
        const extra: Record<string, unknown> = {};
        for (const k of Object.keys(cell)) {
          if (['alias', 'features', 'boardId', 'matrixId'].includes(k)) continue;
          extra[k] = cell[k];
        }

        const cellUuid = newUuid();
        const pcell: PlannedCell = {
          id: cellUuid,
          matrix_id: planned.id,
          row_id: rowUuid,
          col_id: colUuid,
          alias: asAlias(cell.alias),
          features: features.filter((f) =>
            ['info', 'board', 'matrix', 'checklists'].includes(f),
          ),
          child_matrix_id: childMatrixUuid,
          board_id: boardUuid,
          data: extra,
        };
        plan.cells.push(pcell);

        // Reverselookup fuer parent_cell_id der Kind-Nodes.
        if (childMatrixUuid) {
          plan.parentCellUpdates.push({
            nodeId: childMatrixUuid,
            parentCellId: cellUuid,
          });
        }
        if (boardUuid) {
          plan.parentCellUpdates.push({
            nodeId: boardUuid,
            parentCellId: cellUuid,
          });
        }
      }
    }

    // 4) Board-spezifisch: kb_cols → checklists + items → kb_cards → links.
    if (n.type === 'board') {
      const d = (n.data ?? {}) as AltBoardData;
      const boardUuid = planned.id;

      const kbCols = Array.isArray(d.kbCols) ? d.kbCols : [];
      kbCols.forEach((c, i) => {
        const cUuid = ensureMap(c.id);
        const pc: PlannedKbCol = {
          id: cUuid,
          board_id: boardUuid,
          label: asString(c.label),
          position: i,
          color: typeof c.color === 'string' && c.color.length > 0 ? c.color : null,
        };
        plan.kbCols.push(pc);
      });

      const cls = Array.isArray(d.checklists) ? d.checklists : [];
      cls.forEach((cl, i) => {
        const clUuid = ensureMap(cl.id);
        const pcl: PlannedChecklist = {
          id: clUuid,
          board_id: boardUuid,
          label: asString(cl.label),
          position: i,
          recur: safeObj(cl.recur),
          close_mode:
            cl.closeMode === 'manual' ||
            cl.closeMode === 'auto-silent' ||
            cl.closeMode === 'auto-prompt'
              ? cl.closeMode
              : 'auto-prompt',
          action: safeObj(cl.action),
          history: Array.isArray(cl.history) ? cl.history : [],
          alias: asAlias(cl.alias),
        };
        plan.checklists.push(pcl);

        const items = Array.isArray(cl.items) ? cl.items : [];
        items.forEach((it, ii) => {
          const pit: PlannedChecklistItem = {
            id: newUuid(),
            checklist_id: clUuid,
            text: asString(it.text),
            done: !!it.done,
            level: clampLevel(it.level),
            position: ii,
          };
          plan.checklistItems.push(pit);
        });
      });

      const cards = Array.isArray(d.kbCards) ? d.kbCards : [];
      cards.forEach((card, i) => {
        const cardUuid = ensureMap(card.id);
        const colUuid = map.get(card.colId);
        if (!colUuid) return; // Karte ohne gueltige Spalte → skip.
        const checklistRef = card.checklistRef
          ? map.get(card.checklistRef) ?? null
          : null;
        const sourceClId = card.sourceClId
          ? map.get(card.sourceClId) ?? null
          : null;
        const pcard: PlannedKbCard = {
          id: cardUuid,
          board_id: boardUuid,
          col_id: colUuid,
          alias: asAlias(card.alias),
          name: asString(card.name),
          note: asString(card.note),
          tags: asStringArray(card.tags),
          who: asStringArray(card.who),
          deadline: asDateString(card.deadline),
          priority: asNumberOrNull(card.priority),
          done: !!card.done,
          archived: !!card.archived,
          position: i,
          recur: safeObj(card.recur),
          done_occurrences: asStringArray(card.doneOccurrences).filter((s) =>
            /^\d{4}-\d{2}-\d{2}$/.test(s),
          ),
          source_cl_id: sourceClId,
          source_label: typeof card.sourceLabel === 'string'
            ? card.sourceLabel
            : null,
          // Exklusiv: checklist_ref ODER inline-checklist (DB-CHECK).
          checklist_ref: checklistRef,
          checklist:
            !checklistRef && Array.isArray(card.checklist)
              ? card.checklist.map((it) => ({
                  id: typeof it.id === 'string' ? it.id : newUuid(),
                  text: asString(it.text),
                  done: !!it.done,
                  level: clampLevel(it.level),
                }))
              : null,
        };
        plan.kbCards.push(pcard);
      });

      const links = Array.isArray(d.links) ? d.links : [];
      links.forEach((l, i) => {
        const lUuid = ensureMap(l.id);
        const type: 'url' | 'mail' = l.type === 'mail' ? 'mail' : 'url';
        const pl: PlannedLink = {
          id: lUuid,
          board_id: boardUuid,
          type,
          label: asString(l.label),
          // URL-Sanitization: javascript:/data:/etc. wird vor DB-Insert
          // verworfen. Empty-String fallback haelt das Schema (`NOT NULL`)
          // intakt; der Render-Pfad zeigt dann einen leeren Chip.
          url: sanitizeUrl(asString(l.url)) ?? '',
          alias: asAlias(l.alias),
          position: i,
          data: safeObj(l.data) ?? {},
        };
        plan.links.push(pl);
      });
    }
  }

  return plan;
}
