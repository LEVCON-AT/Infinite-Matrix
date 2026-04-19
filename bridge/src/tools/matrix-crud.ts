import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

// ─── matrix.rename ─────────────────────────────────────────────────
const renameSchema = z.object({
  ref: z.string().describe('Alias (^kürzel) oder Matrix-ID'),
  label: z.string().min(1).describe('Neuer Name'),
});

// ─── matrix.delete ─────────────────────────────────────────────────
const deleteMatrixSchema = z.object({
  ref: z.string().describe('Alias (^kürzel) oder Matrix-ID. Root-Matrix wird abgelehnt.'),
});

// ─── row.add ────────────────────────────────────────────────────────
const rowAddSchema = z.object({
  matrixRef: z.string().describe('Alias/ID der Ziel-Matrix'),
  label: z.string().describe('Zeilen-Label'),
});

// ─── row.delete ─────────────────────────────────────────────────────
const rowDeleteSchema = z.object({
  matrixRef: z.string().describe('Alias/ID der Matrix'),
  rowId: z.string().describe('Zeilen-ID (aus matrix.state.get)'),
});

// ─── col.add ────────────────────────────────────────────────────────
const colAddSchema = z.object({
  matrixRef: z.string().describe('Alias/ID der Ziel-Matrix'),
  label: z.string().describe('Spalten-Label'),
});

// ─── col.delete ─────────────────────────────────────────────────────
const colDeleteSchema = z.object({
  matrixRef: z.string().describe('Alias/ID der Matrix'),
  colId: z.string().describe('Spalten-ID (aus matrix.state.get)'),
});

// ─── matrix.edit_mode.set ──────────────────────────────────────────
const editModeSchema = z.object({
  on: z.boolean().describe('Edit-Modus an (true) oder aus (false)'),
});

export const matrixCrudTools: ToolDef[] = [
  {
    name: 'matrix.rename',
    description: 'Benennt eine Matrix um (via Alias oder ID).',
    schema: renameSchema,
    jsonSchema: zodToJsonSchema(renameSchema),
  },
  {
    name: 'matrix.delete',
    description:
      'Löscht eine Matrix inkl. aller Sub-Inhalte. Root-Matrix ist nicht löschbar. Mit Undo.',
    schema: deleteMatrixSchema,
    jsonSchema: zodToJsonSchema(deleteMatrixSchema),
  },
  {
    name: 'row.add',
    description: 'Fügt eine neue Zeile zu einer Matrix hinzu.',
    schema: rowAddSchema,
    jsonSchema: zodToJsonSchema(rowAddSchema),
  },
  {
    name: 'row.delete',
    description:
      'Löscht eine Zeile inkl. aller Zelleninhalte aus einer Matrix. Mit Undo.',
    schema: rowDeleteSchema,
    jsonSchema: zodToJsonSchema(rowDeleteSchema),
  },
  {
    name: 'col.add',
    description: 'Fügt eine neue Spalte zu einer Matrix hinzu.',
    schema: colAddSchema,
    jsonSchema: zodToJsonSchema(colAddSchema),
  },
  {
    name: 'col.delete',
    description:
      'Löscht eine Spalte inkl. aller Zelleninhalte aus einer Matrix. Mit Undo.',
    schema: colDeleteSchema,
    jsonSchema: zodToJsonSchema(colDeleteSchema),
  },
  {
    name: 'matrix.edit_mode.set',
    description: 'Setzt den Edit-Modus (Zeilen/Spalten hinzufügen, löschen, umbenennen).',
    schema: editModeSchema,
    jsonSchema: zodToJsonSchema(editModeSchema),
  },
];
