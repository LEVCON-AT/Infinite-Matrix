// Welle WV.C — Bulk-Delete-Template Mutation-Orchestrator.
//
// Implementiert Alt+1-9 (Vorlage destruktiv entfernen) und Alt+Entf
// (Cells komplett leeren) aus Konzept §8.2.5. V1 arbeitet auf
// cell_template_instances + cells.features/data — Atom-Cleanup folgt
// per FK-CASCADE auf der DB-Seite (cell_widget_overrides).
//
// V1-Pragmatik (Konzept §8.2.5 Variante c — Single-Source-bewusst):
// - remove-template: pro Cell die Vorlagen-Instance mit templateId
//   entfernen. Override-Cascade durch FK.
// - clear-cells: alle Vorlagen-Instances entfernen + cell.features=[]
//   + cell.data={}. Atome (boards/checklists/info-fields) bleiben
//   im Workspace erhalten — sie werden NICHT mit-geloescht, weil V1
//   ohne Manifestation-Resolver nicht entscheiden kann ob ein Atom
//   ausschliesslich an dieser Cell haengt.
//
// pushUndo + showUndoToast: jede Operation snapshotted die
// cell_template_instances + cell-features/data BEVOR der Delete-
// Aufruf laeuft. Caller bekommt einen Undo-Callback der die
// Snapshot-State via applyTemplateToCell + updateCell wiederherstellt.

import { applyTemplateToCell, removeTemplateFromCell } from './cell-templates';
import { translateDbError } from './errors';
import { updateCell } from './mutations';
import type { CellRow, CellTemplateInstanceRow } from './types';

export type BulkDeleteResult = {
  affectedCells: number;
  failed: ReadonlyArray<{ cellId: string; reason: string }>;
  // Undo-Callback — Caller bindet ihn an showUndoToast.
  undo: () => Promise<void>;
};

// ─── remove-template ──────────────────────────────────────────

export type BulkRemoveTemplateInput = {
  workspaceId: string;
  templateId: string;
  cellIds: ReadonlyArray<string>;
  // Workspace-weite Instances (bereits geladen) fuer Snapshot-Lookup.
  instances: ReadonlyArray<CellTemplateInstanceRow>;
};

export async function bulkRemoveTemplateFromCells(
  input: BulkRemoveTemplateInput,
): Promise<BulkDeleteResult> {
  const failed: { cellId: string; reason: string }[] = [];
  // Snapshot: alle Instance-Rows die geloescht werden.
  const snapshot = input.instances.filter(
    (i) => i.template_id === input.templateId && input.cellIds.includes(i.cell_id),
  );

  for (const inst of snapshot) {
    try {
      await removeTemplateFromCell(inst.id);
    } catch (err) {
      failed.push({
        cellId: inst.cell_id,
        reason: translateDbError(err, 'Vorlage konnte nicht entfernt werden.'),
      });
    }
  }

  return {
    affectedCells: snapshot.length - failed.length,
    failed,
    undo: async () => {
      for (const inst of snapshot) {
        try {
          await applyTemplateToCell({
            workspaceId: inst.workspace_id,
            cellId: inst.cell_id,
            templateId: inst.template_id,
            layoutVersion: inst.layout_version,
            appliedBy: inst.applied_by,
          });
        } catch (err) {
          console.error('undo bulkRemoveTemplate cell:', inst.cell_id, err);
        }
      }
    },
  };
}

// ─── clear-cells ──────────────────────────────────────────────

export type BulkClearCellsInput = {
  workspaceId: string;
  cells: ReadonlyArray<CellRow>;
  // Workspace-weite Instances fuer Snapshot — alle Instances
  // dieser Cells werden geloescht.
  instances: ReadonlyArray<CellTemplateInstanceRow>;
};

export async function bulkClearCells(input: BulkClearCellsInput): Promise<BulkDeleteResult> {
  const failed: { cellId: string; reason: string }[] = [];
  // Snapshot pro Cell: alle Instances + cell.features/data fuer Restore.
  const cellSnap = input.cells.map((c) => ({
    cellId: c.id,
    features: c.features,
    data: c.data,
    alias: c.alias,
  }));
  const instSnap = input.instances.filter((i) => input.cells.some((c) => c.id === i.cell_id));

  // Schritt 1: alle Instances entfernen.
  for (const inst of instSnap) {
    try {
      await removeTemplateFromCell(inst.id);
    } catch (err) {
      failed.push({
        cellId: inst.cell_id,
        reason: translateDbError(err, 'Vorlage-Instance konnte nicht entfernt werden.'),
      });
    }
  }

  // Schritt 2: cell.features=[] + cell.data={}. Alias bleibt erhalten,
  // damit User-Naming nicht verschwindet (User-Wahl: Loesch-Modal kappt
  // Inhalte, nicht Identitaeten).
  for (const cell of input.cells) {
    try {
      await updateCell(cell.id, { features: [], data: {} });
    } catch (err) {
      failed.push({
        cellId: cell.id,
        reason: translateDbError(err, 'Cell konnte nicht geleert werden.'),
      });
    }
  }

  return {
    affectedCells: input.cells.length - failed.length,
    failed,
    undo: async () => {
      // Schritt 1: cell.features/data restoren.
      for (const snap of cellSnap) {
        try {
          await updateCell(snap.cellId, { features: snap.features, data: snap.data });
        } catch (err) {
          console.error('undo bulkClearCells cell:', snap.cellId, err);
        }
      }
      // Schritt 2: Instances wiederherstellen.
      for (const inst of instSnap) {
        try {
          await applyTemplateToCell({
            workspaceId: inst.workspace_id,
            cellId: inst.cell_id,
            templateId: inst.template_id,
            layoutVersion: inst.layout_version,
            appliedBy: inst.applied_by,
          });
        } catch (err) {
          console.error('undo bulkClearCells inst:', inst.cell_id, err);
        }
      }
    },
  };
}
