// Welle WV.B.7 — MCP-Tools fuer info_fields (Migration 072).
//
// AI-Konsumenten verwalten typed Cell-Info-Felder. value_type-Whitelist
// aus Konzept §12.1.

import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

const valueTypeSchema = z.enum([
  'text',
  'number',
  'date',
  'currency',
  'boolean',
  'email',
  'phone',
  'url',
  'enum',
  'alias-ref',
]);

// ─── info_field.list ──────────────────────────────────────────
const infoFieldListSchema = z.object({
  workspaceRef: z.string().optional().describe('Workspace-Alias/ID. Default: aktive Session.'),
  cellRef: z
    .string()
    .optional()
    .describe('Wenn gesetzt: nur Felder die ueber atom_manifestation an dieser Cell haengen.'),
});

// ─── info_field.add ───────────────────────────────────────────
const infoFieldAddSchema = z.object({
  workspaceRef: z.string().optional(),
  cellRef: z
    .string()
    .optional()
    .describe('Wenn gesetzt: atom_manifestation(kind=info) wird auch erstellt.'),
  label: z.string().min(1),
  value: z.string().nullable().optional(),
  valueType: valueTypeSchema.default('text'),
  valueMeta: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Typed Erweiterungen (z.B. {min,max,unit}).'),
  symbolOverride: z
    .string()
    .nullable()
    .optional()
    .describe('User-Override fuer Auto-Symbol. Heroicons-Name oder Brand-Key.'),
});

// ─── info_field.update ────────────────────────────────────────
const infoFieldUpdateSchema = z.object({
  fieldId: z.string(),
  label: z.string().min(1).optional(),
  value: z.string().nullable().optional(),
  valueType: valueTypeSchema.optional(),
  valueMeta: z.record(z.string(), z.unknown()).optional(),
  symbolOverride: z.string().nullable().optional(),
});

// ─── info_field.move ──────────────────────────────────────────
const infoFieldMoveSchema = z.object({
  manifestationId: z
    .string()
    .describe('atom_manifestations.id (kind=info) — die Section-Position aendern.'),
  position: z.number().describe('Neue Position numerisch.'),
});

// ─── info_field.delete ────────────────────────────────────────
const infoFieldDeleteSchema = z.object({
  fieldId: z.string().describe('info_fields.id — Cascade purgt atom_manifestations.'),
});

export const infoFieldTools: ToolDef[] = [
  {
    name: 'info_field.list',
    description: 'Listet Info-Felder im Workspace, optional gefiltert auf eine Cell.',
    schema: infoFieldListSchema,
    jsonSchema: zodToJsonSchema(infoFieldListSchema),
  },
  {
    name: 'info_field.add',
    description:
      'Legt ein typed Info-Feld an. Wenn cellRef gesetzt: atom_manifestation(kind=info, container_kind=cell) wird mit erstellt.',
    schema: infoFieldAddSchema,
    jsonSchema: zodToJsonSchema(infoFieldAddSchema),
  },
  {
    name: 'info_field.update',
    description: 'Aendert Label/Value/Type/Meta/Symbol-Override eines existing Felds.',
    schema: infoFieldUpdateSchema,
    jsonSchema: zodToJsonSchema(infoFieldUpdateSchema),
  },
  {
    name: 'info_field.move',
    description: 'Aendert die Section-Position einer Info-Field-Manifestation.',
    schema: infoFieldMoveSchema,
    jsonSchema: zodToJsonSchema(infoFieldMoveSchema),
  },
  {
    name: 'info_field.delete',
    description: 'Loescht ein Info-Feld. Cascade purgt alle atom_manifestations.',
    schema: infoFieldDeleteSchema,
    jsonSchema: zodToJsonSchema(infoFieldDeleteSchema),
  },
];
