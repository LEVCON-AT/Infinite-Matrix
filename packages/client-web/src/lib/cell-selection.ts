// Welle WV.C.3 — Multi-Select-Store fuer Bulk-Apply (Edit-Mode-scoped).
//
// Konzept §8.1 — Selektions-Modell. Globaler Single-Source-Store.
// Edit-Mode-only (View-Mode ohne Multi-Select V1, siehe Konzept §8.1).
//
// API (final 2026-05-07):
//   selectCell(id) / deselectCell(id) / toggleCell(id)
//   selectRange(fromId, toId, matrixId)
//   selectAllInMatrix(matrixId)
//   clearSelection()
//   selectionCount = createMemo
//   selectedCellIds = createSignal-getter
//   isCellSelected(id) = O(1) Lookup ueber Set
//
// Range-Resolver braucht Cell-Coords (row, col) — Caller (MatrixView)
// registriert via registerMatrixCells(matrixId, cells) bei Mount,
// unregisterMatrix(matrixId) bei Unmount. Ohne Registry kein Range-
// Select moeglich (Fallback: nur toId selektieren).
//
// Auto-Clear-Trigger (§8.1):
//   - Edit-Mode verlassen (installCellSelectionAutoClear)
//   - Workspace-Wechsel (installCellSelectionAutoClear)
//   - Drill-Up/Down via setActiveMatrixId(newId) — Aenderung clear-t.
//
// Konsumenten:
//   - MatrixView.tsx (Render — outline + checkmark via isCellSelected)
//   - EditModeToolbar.tsx (Counter — selectionCount)
//   - keyboard-nav.ts (Strg+A / ESC)
//   - cell-selection-hotkeys.ts (Strg+Click / Shift+Click — Welle C.4)
//   - bulk-apply-template.ts (Mutation-Helper — Welle C.4)

import { type Accessor, createEffect, createMemo, createSignal } from 'solid-js';

export type CellCoord = {
  id: string;
  row: number;
  col: number;
};

const [selectedCellIds, setSelectedCellIds] = createSignal<readonly string[]>([]);
const [activeMatrixId, setActiveMatrixIdInternal] = createSignal<string | null>(null);
const [lastAnchorId, setLastAnchorId] = createSignal<string | null>(null);

// Pro Matrix die Cell-Koordinaten — gefuettert von MatrixView bei
// Mount. Map<matrixId, cells>. Set von neuer Map damit Solid-Reaktiv.
const [matrixCellRegistry, setMatrixCellRegistry] = createSignal<
  ReadonlyMap<string, ReadonlyArray<CellCoord>>
>(new Map());

// ─── Public Reads ──────────────────────────────────────────────

export { selectedCellIds, lastAnchorId, activeMatrixId };

export const selectionCount: Accessor<number> = createMemo(() => selectedCellIds().length);

// O(N) Lookup. Fuer Hot-Pfade in Render-Loops besser den Set-Memo
// nehmen (siehe selectionSet).
export function isCellSelected(id: string): boolean {
  return selectedCellIds().includes(id);
}

// Set-Memo fuer Render-Pfade mit vielen Cells — O(1) Lookup.
export const selectionSet: Accessor<ReadonlySet<string>> = createMemo(
  () => new Set(selectedCellIds()),
);

// ─── Mutations ─────────────────────────────────────────────────

export function selectCell(id: string): void {
  if (!id) return;
  setSelectedCellIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  setLastAnchorId(id);
}

export function deselectCell(id: string): void {
  setSelectedCellIds((prev) => prev.filter((x) => x !== id));
  if (lastAnchorId() === id) setLastAnchorId(null);
}

export function toggleCell(id: string): void {
  if (selectedCellIds().includes(id)) {
    deselectCell(id);
  } else {
    selectCell(id);
  }
}

// Rechteckiger Range zwischen fromId (Anker) und toId (Ziel) — alle
// Cells, deren (row, col) im Min/Max-Rechteck liegen, werden mit
// selektiert. Bestehende Selektion bleibt; nur additive Erweiterung.
export function selectRange(fromId: string, toId: string, matrixId: string): void {
  const cells = matrixCellRegistry().get(matrixId);
  if (!cells) {
    // Fallback wenn Matrix nicht registriert — nur toId.
    selectCell(toId);
    return;
  }
  const fromCell = cells.find((c) => c.id === fromId);
  const toCell = cells.find((c) => c.id === toId);
  if (!fromCell || !toCell) {
    selectCell(toId);
    return;
  }
  const r1 = Math.min(fromCell.row, toCell.row);
  const r2 = Math.max(fromCell.row, toCell.row);
  const c1 = Math.min(fromCell.col, toCell.col);
  const c2 = Math.max(fromCell.col, toCell.col);
  const inRangeIds = cells
    .filter((c) => c.row >= r1 && c.row <= r2 && c.col >= c1 && c.col <= c2)
    .map((c) => c.id);
  setSelectedCellIds((prev) => {
    const set = new Set(prev);
    for (const id of inRangeIds) set.add(id);
    return Array.from(set);
  });
  setLastAnchorId(toId);
}

export function selectAllInMatrix(matrixId: string): void {
  const cells = matrixCellRegistry().get(matrixId);
  if (!cells || cells.length === 0) return;
  setSelectedCellIds(cells.map((c) => c.id));
  setLastAnchorId(cells[0]?.id ?? null);
}

export function clearSelection(): void {
  if (selectedCellIds().length === 0 && lastAnchorId() === null) return;
  setSelectedCellIds([]);
  setLastAnchorId(null);
}

// ─── Matrix-Registry ───────────────────────────────────────────

export function registerMatrixCells(matrixId: string, cells: ReadonlyArray<CellCoord>): void {
  setMatrixCellRegistry((prev) => {
    const next = new Map(prev);
    next.set(matrixId, cells);
    return next;
  });
}

export function unregisterMatrix(matrixId: string): void {
  setMatrixCellRegistry((prev) => {
    if (!prev.has(matrixId)) return prev;
    const next = new Map(prev);
    next.delete(matrixId);
    return next;
  });
}

// Matrix-Wechsel-Trigger. Caller (Workspace.tsx) ruft das beim
// Drill-Up/Down — bei Aenderung clearen wir die Selektion.
export function setActiveMatrixId(matrixId: string | null): void {
  if (activeMatrixId() === matrixId) return;
  clearSelection();
  setActiveMatrixIdInternal(matrixId);
}

// ─── Auto-Clear-Effects ────────────────────────────────────────
// Mount-once-Helper, der Edit-Mode + Workspace-Wechsel auf clear
// verdrahtet. Caller im Workspace.tsx-Mount.

export type CellSelectionAutoClearOptions = {
  isEditMode: Accessor<boolean>;
  workspaceId: Accessor<string | null>;
};

export function installCellSelectionAutoClear(opts: CellSelectionAutoClearOptions): void {
  // Edit-Mode-Verlassen → clear (auch View-Mode darf nichts geerbt
  // haben).
  createEffect(() => {
    if (!opts.isEditMode()) clearSelection();
  });
  // Workspace-Wechsel → clear (Cells aus altem Workspace sind nicht
  // mehr sichtbar, Selektion stale).
  createEffect(() => {
    void opts.workspaceId();
    clearSelection();
    setActiveMatrixIdInternal(null);
    setMatrixCellRegistry(new Map());
  });
}
