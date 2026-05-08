// Welle WV.C.4 — Bulk-Apply-Template Mutation-Orchestrator.
//
// Konzept §8.3 — bulkApplyTemplate-Verhalten (idempotent + transaktional
// pro Cell, optimistic via lib/safe-mutation Wrapper).
//
// V1-Scope:
// - Pro Cell: applyTemplateToCell + optional setAlias.
// - Konflikt-Strategie: skip (nicht ueberschreiben). V1 ohne Reset-to-
//   Template (Konflikt-Cells werden uebersprungen, nicht resyncedt).
// - pushUndo + showUndoToast: Caller-Verantwortung. Hier nur Promise<>
//   mit angewandt-/uebersprungen-Liste, damit Caller den Toast-Text
//   passend baut + Undo via removeTemplateFromCell setzt.

import { applyTemplateToCell } from './cell-templates';
import { translateDbError } from './errors';
import { updateCell } from './mutations';
import type { CellTemplateInstanceRow } from './types';

export type BulkApplyCellSpec = {
  cellId: string;
  // Optional Alias — nur gesetzt wenn alias.trim() truthy.
  alias?: string | null;
};

export type BulkApplyTemplateInput = {
  workspaceId: string;
  templateId: string;
  layoutVersion: number;
  appliedBy?: string | null;
  cells: ReadonlyArray<BulkApplyCellSpec>;
};

export type BulkApplyTemplateResult = {
  applied: ReadonlyArray<{ cellId: string; instance: CellTemplateInstanceRow }>;
  failed: ReadonlyArray<{ cellId: string; reason: string }>;
};

// Sequenziell pro Cell — V1 simpel. Fehler pro Cell stoppt nicht den
// Gesamt-Run (Bulk-Pflicht). Fehler-Liste am Ende fuer Toast-Detail.
export async function bulkApplyTemplate(
  input: BulkApplyTemplateInput,
): Promise<BulkApplyTemplateResult> {
  const applied: { cellId: string; instance: CellTemplateInstanceRow }[] = [];
  const failed: { cellId: string; reason: string }[] = [];

  for (const cell of input.cells) {
    try {
      const instance = await applyTemplateToCell({
        workspaceId: input.workspaceId,
        cellId: cell.cellId,
        templateId: input.templateId,
        layoutVersion: input.layoutVersion,
        appliedBy: input.appliedBy ?? null,
      });
      // Alias optional — nur setzen wenn nicht leer.
      const aliasTrim = (cell.alias ?? '').trim();
      if (aliasTrim) {
        try {
          await updateCell(cell.cellId, { alias: aliasTrim });
        } catch (aliasErr) {
          // Alias-Fehler ist non-fatal — Vorlage ist trotzdem
          // angewandt. Vermerken aber weitermachen.
          failed.push({
            cellId: cell.cellId,
            reason: `Alias konnte nicht gesetzt werden: ${translateDbError(aliasErr, 'unbekannter Fehler')}`,
          });
        }
      }
      applied.push({ cellId: cell.cellId, instance });
    } catch (err) {
      failed.push({
        cellId: cell.cellId,
        reason: translateDbError(err, 'Vorlage konnte nicht angewendet werden.'),
      });
    }
  }

  return { applied, failed };
}

// Auto-Alias: V1 simple Token-Replacement — `{vorlage}` → vorlage-name
// kebabcased, `{row}` → row-label kebab, `{col}` → col-label kebab.
// Konflikt-Suffix `-1`/`-2` wenn Alias im Workspace bereits existiert.
//
// V1 keine Live-Konflikt-Pruefung (Caller liefert bekannte Aliases).
export type AliasContext = {
  templateName: string;
  rowLabel: string;
  colLabel: string;
};

export function buildAutoAlias(pattern: string, ctx: AliasContext): string {
  const slugVorlage = slug(ctx.templateName);
  const slugRow = slug(ctx.rowLabel);
  const slugCol = slug(ctx.colLabel);
  return pattern
    .replace(/\{vorlage\}/g, slugVorlage)
    .replace(/\{template\}/g, slugVorlage)
    .replace(/\{row\}/g, slugRow)
    .replace(/\{col\}/g, slugCol);
}

export function resolveAliasConflicts(
  candidates: ReadonlyArray<{ cellId: string; proposed: string }>,
  existingAliases: ReadonlySet<string>,
): Map<string, string> {
  // Reihenfolge bewahren — frueheste Cell behaelt den Basis-Alias,
  // spaetere bekommen Suffix.
  const result = new Map<string, string>();
  const usedNow = new Set<string>(existingAliases);
  for (const c of candidates) {
    if (!c.proposed.trim()) {
      result.set(c.cellId, '');
      continue;
    }
    let final = c.proposed;
    let n = 1;
    while (usedNow.has(final)) {
      n += 1;
      final = `${c.proposed}-${n}`;
    }
    usedNow.add(final);
    result.set(c.cellId, final);
  }
  return result;
}

function slug(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mark}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
