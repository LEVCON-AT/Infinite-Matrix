import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

// Card-Referenz: entweder Alias (cardRef) oder boardRef + cardId.
// Der Client-Handler prüft, dass mindestens eine Form vollständig ist.
const cardRefFields = {
  cardRef: z.string().optional().describe('Alias (^kürzel) der Karte'),
  boardRef: z.string().optional().describe('Alias/ID des Boards (wenn cardRef fehlt)'),
  cardId: z.string().optional().describe('Karten-ID (wenn cardRef fehlt)'),
};

const recurSchema = z.object({
  type: z.enum(['none', 'daily', 'weekly', 'monthly', 'yearly']),
  every: z.number().int().min(1).max(365).optional(),
  day: z.number().int().min(1).max(31).optional(),
  weekday: z.number().int().min(0).max(6).optional(),
});

// ─── card.create ───────────────────────────────────────────────────
const cardCreateSchema = z.object({
  boardRef: z.string().describe('Alias/ID des Ziel-Boards'),
  name: z.string().min(1).describe('Karten-Titel'),
  colId: z.string().optional().describe('Spalten-ID (default: erste Spalte)'),
  note: z.string().optional(),
  priority: z.number().int().min(0).max(3).optional().describe('Priorität 0-3'),
  deadline: z.string().optional().describe('Fälligkeit als YYYY-MM-DD'),
  tags: z.array(z.string()).optional(),
  who: z.array(z.string()).optional(),
  alias: z.string().optional().describe('Alias für ^kürzel-Zugriff'),
});

// ─── card.update ───────────────────────────────────────────────────
const cardPatchSchema = z.object({
  name: z.string().optional(),
  note: z.string().optional(),
  colId: z.string().optional(),
  priority: z.number().int().min(0).max(3).optional(),
  deadline: z.string().optional(),
  tags: z.array(z.string()).optional(),
  who: z.array(z.string()).optional(),
});
const cardUpdateSchema = z.object({
  ...cardRefFields,
  patch: cardPatchSchema.describe('Nur die explizit gesetzten Felder werden aktualisiert'),
});

// ─── card.move ─────────────────────────────────────────────────────
const cardMoveSchema = z.object({
  ...cardRefFields,
  targetColId: z.string().optional().describe('Ziel-Spalten-ID (gleiches Board)'),
  targetBoardRef: z.string().optional().describe('Ziel-Board (cross-board move)'),
});

// ─── card.delete ───────────────────────────────────────────────────
const cardDeleteSchema = z.object({ ...cardRefFields });

// ─── card.done.toggle ──────────────────────────────────────────────
const cardDoneToggleSchema = z.object({ ...cardRefFields });

// ─── card.recurrence.set ───────────────────────────────────────────
const cardRecurrenceSetSchema = z.object({
  ...cardRefFields,
  recur: recurSchema.describe('Wiederholungsspezifikation. type=none deaktiviert'),
});

export const cardTools: ToolDef[] = [
  {
    name: 'card.create',
    description: 'Erzeugt eine neue Kanban-Karte in einem Board.',
    schema: cardCreateSchema,
    jsonSchema: zodToJsonSchema(cardCreateSchema),
  },
  {
    name: 'card.update',
    description: 'Aktualisiert Felder einer Karte (nur übergebene Felder werden gesetzt).',
    schema: cardUpdateSchema,
    jsonSchema: zodToJsonSchema(cardUpdateSchema),
  },
  {
    name: 'card.move',
    description:
      'Bewegt eine Karte in eine andere Spalte (gleiches Board) oder auf ein anderes Board.',
    schema: cardMoveSchema,
    jsonSchema: zodToJsonSchema(cardMoveSchema),
  },
  {
    name: 'card.delete',
    description: 'Löscht eine Karte. Mit Undo.',
    schema: cardDeleteSchema,
    jsonSchema: zodToJsonSchema(cardDeleteSchema),
  },
  {
    name: 'card.done.toggle',
    description:
      'Toggelt den Erledigt-Status einer Karte (verschiebt sie automatisch in die Erledigt-Spalte).',
    schema: cardDoneToggleSchema,
    jsonSchema: zodToJsonSchema(cardDoneToggleSchema),
  },
  {
    name: 'card.recurrence.set',
    description: 'Setzt die Wiederholung einer Karte (täglich/wöchentlich/monatlich/jährlich).',
    schema: cardRecurrenceSetSchema,
    jsonSchema: zodToJsonSchema(cardRecurrenceSetSchema),
  },
];
