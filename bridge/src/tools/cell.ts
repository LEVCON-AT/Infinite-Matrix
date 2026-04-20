import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

// ─── cell.get ──────────────────────────────────────────────────────
const cellGetSchema = z.object({
  matrixRef: z.string().describe('Alias/ID der Matrix'),
  rowId: z.string().describe('Zeilen-ID'),
  colId: z.string().describe('Spalten-ID'),
});

// ─── cell.feature.add ──────────────────────────────────────────────
const cellFeatureAddSchema = z.object({
  matrixRef: z.string().describe('Alias/ID der Matrix'),
  rowId: z.string().describe('Zeilen-ID'),
  colId: z.string().describe('Spalten-ID'),
  feature: z
    .enum(['matrix', 'board', 'info', 'checklists'])
    .describe('Zu aktivierendes Feature'),
  label: z
    .string()
    .optional()
    .describe('Optionaler Name für die neu erzeugte Sub-Matrix/Board'),
});

// ─── cell.alias.set ────────────────────────────────────────────────
const cellAliasSetSchema = z.object({
  matrixRef: z.string().describe('Alias/ID der Matrix'),
  rowId: z.string().describe('Zeilen-ID'),
  colId: z.string().describe('Spalten-ID'),
  alias: z
    .string()
    .describe('Alias (a-z, 0-9, max 16). Leer-String löscht den Alias.'),
});

export const cellTools: ToolDef[] = [
  {
    name: 'cell.get',
    description: 'Liefert den Cell-State (features, alias, boardId, matrixId, tabLabels).',
    schema: cellGetSchema,
    jsonSchema: zodToJsonSchema(cellGetSchema),
  },
  {
    name: 'cell.feature.add',
    description:
      'Aktiviert ein Feature für eine Zelle. Legt bei Bedarf das Board oder die Sub-Matrix an.',
    schema: cellFeatureAddSchema,
    jsonSchema: zodToJsonSchema(cellFeatureAddSchema),
  },
  {
    name: 'cell.alias.set',
    description: 'Setzt oder löscht den Zellen-Alias für ^kürzel-Navigation.',
    schema: cellAliasSetSchema,
    jsonSchema: zodToJsonSchema(cellAliasSetSchema),
  },
];
