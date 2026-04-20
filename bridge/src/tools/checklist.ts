import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

// ─── checklist.add ─────────────────────────────────────────────────
const checklistAddSchema = z.object({
  boardRef: z.string().describe('Alias/ID des Boards'),
  label: z.string().min(1).describe('Checklisten-Name'),
});

// ─── checklist.item.add ────────────────────────────────────────────
const checklistItemAddSchema = z.object({
  boardRef: z.string().describe('Alias/ID des Boards'),
  checklistId: z.string().describe('Checklisten-ID'),
  text: z.string().min(1).describe('Item-Text'),
  afterItemId: z.string().optional().describe('ID des Items, nach dem eingefügt wird (Default: ans Ende)'),
  level: z.number().int().min(0).max(2).optional().describe('Einrückungs-Level 0-2 (Default: 0)'),
});

// ─── checklist.item.toggle ─────────────────────────────────────────
const checklistItemToggleSchema = z.object({
  boardRef: z.string().describe('Alias/ID des Boards'),
  checklistId: z.string().describe('Checklisten-ID'),
  itemId: z.string().describe('Item-ID'),
});

// ─── checklist.item.set_level ──────────────────────────────────────
const checklistItemSetLevelSchema = z.object({
  boardRef: z.string().describe('Alias/ID des Boards'),
  checklistId: z.string().describe('Checklisten-ID'),
  itemId: z.string().describe('Item-ID'),
  level: z.number().int().min(0).max(2).describe('Neuer Einrückungs-Level 0-2'),
});

export const checklistTools: ToolDef[] = [
  {
    name: 'checklist.add',
    description: 'Legt eine neue Checkliste im Board an.',
    schema: checklistAddSchema,
    jsonSchema: zodToJsonSchema(checklistAddSchema),
  },
  {
    name: 'checklist.item.add',
    description: 'Fügt einer Checkliste ein Item hinzu.',
    schema: checklistItemAddSchema,
    jsonSchema: zodToJsonSchema(checklistItemAddSchema),
  },
  {
    name: 'checklist.item.toggle',
    description: 'Toggelt den Erledigt-Status eines Checklisten-Items.',
    schema: checklistItemToggleSchema,
    jsonSchema: zodToJsonSchema(checklistItemToggleSchema),
  },
  {
    name: 'checklist.item.set_level',
    description: 'Setzt den Einrückungs-Level eines Items (0-2). Nachkommen werden mit-verschoben; lehnt ab, wenn Level-Sprung oder Grenzen verletzt werden.',
    schema: checklistItemSetLevelSchema,
    jsonSchema: zodToJsonSchema(checklistItemSetLevelSchema),
  },
];
