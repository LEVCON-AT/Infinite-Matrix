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
});

// ─── checklist.item.toggle ─────────────────────────────────────────
const checklistItemToggleSchema = z.object({
  boardRef: z.string().describe('Alias/ID des Boards'),
  checklistId: z.string().describe('Checklisten-ID'),
  itemId: z.string().describe('Item-ID'),
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
];
