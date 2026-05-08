// Welle WV.A.8b — MCP-Tools fuer cell_template_instances + cell_widget_overrides
// (Migration 068).
//
// AI-Konsumenten koennen Vorlagen an Cells anbringen / entfernen +
// Widget-Overrides setzen. Konzept §6.5 + §9.A.6.

import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

// ─── cell_template.apply ──────────────────────────────────────
const cellTemplateApplySchema = z.object({
  cellRef: z.string().describe('Cell-Alias (^kuerzel) oder Cell-ID.'),
  templateId: z.string().describe('feature_templates.id (UUID).'),
});

// ─── cell_template.remove ─────────────────────────────────────
const cellTemplateRemoveSchema = z.object({
  instanceId: z
    .string()
    .describe('cell_template_instances.id (UUID). Cascade: Overrides loeschen mit.'),
});

// ─── cell_template.list ───────────────────────────────────────
const cellTemplateListSchema = z.object({
  cellRef: z
    .string()
    .optional()
    .describe('Cell-Alias/ID — listet aktive Vorlagen-Instances dieser Cell.'),
  workspaceRef: z.string().optional().describe('Wenn cellRef fehlt: alle Instances im Workspace.'),
});

// ─── cell_template.override.set ───────────────────────────────
const cellTemplateOverrideSetSchema = z.object({
  instanceId: z.string().describe('cell_template_instances.id.'),
  widgetId: z
    .string()
    .describe('template_widgets.id (das Widget, dessen Default ueberschrieben wird).'),
  overrideData: z
    .record(z.string(), z.unknown())
    .describe(
      'Sparse JSON-Patch. Felder data/toggles/config + Layout (column/position/size_cols/size_rows). Was nicht im Patch steht, bleibt Vorlagen-Default.',
    ),
});

// ─── cell_template.override.reset ─────────────────────────────
const cellTemplateOverrideResetSchema = z.object({
  overrideId: z
    .string()
    .describe('cell_widget_overrides.id. DELETE → Widget rendert wieder Vorlagen-Default.'),
});

// ─── cell_template.bulk_apply ─────────────────────────────────
// Welle WV.C.4 — Bulk-Apply analog zum Client-BulkWizard.
// Sequenziell pro Cell: applyTemplateToCell + optional Alias setzen.
// Fehler pro Cell stoppen den Run nicht (Bulk-Pflicht); Caller bekommt
// applied/failed-Zaehler im Result.
const cellTemplateBulkApplySchema = z.object({
  templateId: z.string().describe('feature_templates.id — auf alle Cells anwenden.'),
  cellRefs: z
    .array(z.string())
    .min(1)
    .describe('Cell-Alias (^kuerzel) oder UUID-Array. Reihenfolge bestimmt Konflikt-Suffix.'),
  aliasPattern: z
    .string()
    .optional()
    .describe(
      'Optional: Auto-Alias-Pattern mit Tokens {vorlage}/{row}/{col}. Wenn nicht gesetzt: Cell-Aliase bleiben unveraendert.',
    ),
  skipExisting: z
    .boolean()
    .default(true)
    .describe(
      'true (Default): Cells mit existing Vorlagen-Instance werden uebersprungen. false: Reset-to-Template laeuft pro Cell.',
    ),
});

export const cellTemplateTools: ToolDef[] = [
  {
    name: 'cell_template.apply',
    description:
      'Wendet eine Vorlage auf eine Cell an. layout_version pinned. Eine Vorlage kann nur einmal pro Cell angewendet sein (UNIQUE). Multi-Vorlagen pro Cell via mehrfachen Aufruf mit unterschiedlichen templateId.',
    schema: cellTemplateApplySchema,
    jsonSchema: zodToJsonSchema(cellTemplateApplySchema),
  },
  {
    name: 'cell_template.remove',
    description:
      'Entfernt eine Vorlagen-Instance von einer Cell. Cascade-DELETE auf cell_widget_overrides.',
    schema: cellTemplateRemoveSchema,
    jsonSchema: zodToJsonSchema(cellTemplateRemoveSchema),
  },
  {
    name: 'cell_template.list',
    description: 'Listet die aktiven Vorlagen-Instances einer Cell oder im ganzen Workspace.',
    schema: cellTemplateListSchema,
    jsonSchema: zodToJsonSchema(cellTemplateListSchema),
  },
  {
    name: 'cell_template.override.set',
    description:
      'Setzt einen Sparse-Override auf einem Widget einer Vorlagen-Instance. Upsert auf (instance_id, widget_id) — bestehende Override-Row wird gepatcht.',
    schema: cellTemplateOverrideSetSchema,
    jsonSchema: zodToJsonSchema(cellTemplateOverrideSetSchema),
  },
  {
    name: 'cell_template.override.reset',
    description: 'Setzt ein Widget zurueck auf Vorlagen-Default — DELETE der Override-Row.',
    schema: cellTemplateOverrideResetSchema,
    jsonSchema: zodToJsonSchema(cellTemplateOverrideResetSchema),
  },
  {
    name: 'cell_template.bulk_apply',
    description:
      'Wendet eine Vorlage auf mehrere Cells an. Sequenziell pro Cell. Aliase optional via aliasPattern (Tokens {vorlage}/{row}/{col}). Pro-Cell-Fehler stoppen den Run nicht — Result-Zaehler applied/failed.',
    schema: cellTemplateBulkApplySchema,
    jsonSchema: zodToJsonSchema(cellTemplateBulkApplySchema),
  },
];
