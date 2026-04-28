// Phase 3 O.8 — Name-Template-Resolver fuer nameable Cell-Features.
//
// Templates speichern wir wortwoertlich in nodes.label_template,
// docs.title_template, checklists.label_template. Plain-Strings
// (kein '{') rendern unveraendert; mit `{row.object}` /
// `{column.object}` resolved dieser Helper Live aus der Parent-
// Cell-Kette: cell → row.object_id/col.object_id → object.label.
//
// Resolver ist fault-tolerant:
//   - leerer Template (DEFAULT '' aus Migration 036) → fallback auf
//     legacy label/title.
//   - kein parent_cell (Top-Level-Node) → Template wird returned, die
//     `{row.object}` Platzhalter werden zu leeren Strings ersetzt.
//   - parent-Row/Col ohne object_id → Plain-row.label / col.label.
//   - parent-Object ohne label → leerer String.
//
// Cross-Type Helper: resolveLabel ist generisch ueber Template +
// ResolveContext. Convenience-Wrapper liefern Context-Builder fuer
// Node/Doc/Checklist.

import type {
  CellRow,
  ChecklistRow,
  ColRow,
  DocRow,
  NodeRow,
  ObjectRow,
  RowRow,
} from './types';

// ─── Context-Type ──────────────────────────────────────────────
// Was der Resolver wissen muss, um {row.object} / {column.object}
// zu ersetzen. Beide *_object* sind null wenn das Parent-Row/-Col
// kein Object verlinkt — wir fallen dann auf das Plain-Label.
export type ResolveContext = {
  rowObjectLabel: string | null;
  rowFallbackLabel: string;
  colObjectLabel: string | null;
  colFallbackLabel: string;
};

// ─── Hauptfunktion ─────────────────────────────────────────────
// Generic resolver. Returnt fallback wenn template leer; Template
// wenn kein '{' (Plain); resolved-String wenn Platzhalter vorhanden.
export function resolveLabel(
  template: string | null | undefined,
  ctx: ResolveContext | null,
  fallback: string,
): string {
  // Migration 036 hat DEFAULT '' — bei leerem Template ist das
  // legacy label/title die einzige Wahrheit.
  if (!template) return fallback;
  if (!template.includes('{')) return template;
  if (!ctx) {
    // Top-Level oder kein Context-Build moeglich. Platzhalter
    // werden zu leeren Strings — ergibt z.B. " / " (nur Trenner).
    // Power-User-Fall, sehr selten in der UI.
    return template.replace(/\{row\.object\}/g, '').replace(/\{column\.object\}/g, '');
  }
  return template
    .replace(/\{row\.object\}/g, ctx.rowObjectLabel ?? ctx.rowFallbackLabel ?? '')
    .replace(/\{column\.object\}/g, ctx.colObjectLabel ?? ctx.colFallbackLabel ?? '');
}

// ─── Context-Builder ───────────────────────────────────────────
// Walkt parent_cell_id → cell → row/col → object.label.
//
// Erwartet Workspace-globale Maps; im Frontend lebt das als
// createMemo ueber rows/cols/cells/objects. Bei null parent_cell_id
// returnt null (Top-Level-Indikator).
export type ContextMaps = {
  cellsById: Map<string, CellRow>;
  rowsById: Map<string, RowRow>;
  colsById: Map<string, ColRow>;
  objectsById: Map<string, ObjectRow>;
};

export function buildContext(
  parentCellId: string | null | undefined,
  maps: ContextMaps,
): ResolveContext | null {
  if (!parentCellId) return null;
  const cell = maps.cellsById.get(parentCellId);
  if (!cell) return null;
  const row = maps.rowsById.get(cell.row_id);
  const col = maps.colsById.get(cell.col_id);
  if (!row || !col) return null;

  const rowObj = row.object_id ? maps.objectsById.get(row.object_id) : null;
  const colObj = col.object_id ? maps.objectsById.get(col.object_id) : null;

  return {
    rowObjectLabel: rowObj?.label ?? null,
    rowFallbackLabel: row.label,
    colObjectLabel: colObj?.label ?? null,
    colFallbackLabel: col.label,
  };
}

// ─── Convenience: Per-Type Resolver ────────────────────────────

// Node (Matrix/Board): label_template + parent_cell_id.
export function resolveNodeLabel(node: NodeRow, maps: ContextMaps): string {
  const ctx = buildContext(node.parent_cell_id, maps);
  return resolveLabel(node.label_template, ctx, node.label || '(ohne Label)');
}

// Doc: title_template + attached_cell_id.
export function resolveDocTitle(doc: DocRow, maps: ContextMaps): string {
  const ctx = buildContext(doc.attached_cell_id, maps);
  return resolveLabel(doc.title_template, ctx, doc.title);
}

// Checklist: label_template + cell_id.
// Board-Checklists (cell_id == null) faellt auf legacy label —
// kein Cell-Context vorhanden.
export function resolveChecklistLabel(checklist: ChecklistRow, maps: ContextMaps): string {
  const ctx = buildContext(checklist.cell_id, maps);
  return resolveLabel(checklist.label_template, ctx, checklist.label);
}

// ─── Template-Validation Utilities ─────────────────────────────

// Liefert die statische Aufloesung eines Templates zum Snapshot-
// Zeitpunkt. Genutzt fuer Cycle-Position 4/5 (statischer Snapshot)
// und beim Insert: das `label`/`title`-Feld wird mit dem resolved
// String zum Anlage-Zeitpunkt gefuellt — als Fallback fuer Audit-
// Log und Resolver-Faelle ohne Context.
export function snapshotTemplate(template: string, ctx: ResolveContext | null): string {
  return resolveLabel(template, ctx, template);
}

// Erkennt, ob ein Template dynamisch ist (mindestens ein {}-Pattern).
export function isDynamicTemplate(template: string | null | undefined): boolean {
  return !!template && template.includes('{');
}
