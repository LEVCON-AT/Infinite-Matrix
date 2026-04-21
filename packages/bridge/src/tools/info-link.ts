import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

// ─── info.field.add ────────────────────────────────────────────────
const infoFieldAddSchema = z.object({
  boardRef: z.string().describe('Alias/ID des Boards'),
  label: z.string().min(1).describe('Feld-Name'),
  value: z.string().optional().describe('Initialer Wert (default leer)'),
});

// ─── info.field.update ─────────────────────────────────────────────
const infoFieldUpdateSchema = z.object({
  boardRef: z.string().describe('Alias/ID des Boards'),
  fieldId: z.string().describe('Info-Feld-ID'),
  value: z.string().optional(),
  label: z.string().optional(),
});

// ─── info.field.delete ─────────────────────────────────────────────
const infoFieldDeleteSchema = z.object({
  boardRef: z.string().describe('Alias/ID des Boards'),
  fieldId: z.string().describe('Info-Feld-ID'),
});

// ─── link.add ──────────────────────────────────────────────────────
const linkAddSchema = z.object({
  boardRef: z.string().describe('Alias/ID des Boards'),
  label: z.string().optional().describe('Bezeichnung (default: URL)'),
  url: z.string().min(1).describe('URL (http/https). Wird sanitized.'),
  alias: z.string().optional().describe('Optionaler Alias für ^kürzel-Zugriff'),
});

// ─── link.delete ───────────────────────────────────────────────────
const linkDeleteSchema = z.object({
  linkRef: z.string().optional().describe('Alias (^kürzel) des Links'),
  boardRef: z.string().optional(),
  linkId: z.string().optional(),
});

export const infoLinkTools: ToolDef[] = [
  {
    name: 'info.field.add',
    description: 'Fügt dem Board ein Info-Feld hinzu (Label + Wert).',
    schema: infoFieldAddSchema,
    jsonSchema: zodToJsonSchema(infoFieldAddSchema),
  },
  {
    name: 'info.field.update',
    description: 'Aktualisiert Wert und/oder Label eines Info-Feldes.',
    schema: infoFieldUpdateSchema,
    jsonSchema: zodToJsonSchema(infoFieldUpdateSchema),
  },
  {
    name: 'info.field.delete',
    description: 'Löscht ein Info-Feld aus einem Board.',
    schema: infoFieldDeleteSchema,
    jsonSchema: zodToJsonSchema(infoFieldDeleteSchema),
  },
  {
    name: 'link.add',
    description: 'Fügt dem Board einen Link hinzu (Label, URL, optional Alias).',
    schema: linkAddSchema,
    jsonSchema: zodToJsonSchema(linkAddSchema),
  },
  {
    name: 'link.delete',
    description: 'Löscht einen Link vom Board. Per Alias (linkRef) oder boardRef+linkId.',
    schema: linkDeleteSchema,
    jsonSchema: zodToJsonSchema(linkDeleteSchema),
  },
];
