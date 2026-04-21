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

// ─── checklist.paste (V2.2) ────────────────────────────────────────
const checklistPasteSchema = z.object({
  boardRef: z.string().describe('Alias/ID des Boards'),
  checklistId: z.string().describe('Checklisten-ID'),
  text: z.string().min(1).describe('Zu parsender Text. Erkennt Bullets (-, *, •, "1.") und Einrückung (2 Spaces oder Tab)'),
  afterItemId: z.string().optional().describe('ID des Items, nach dem eingefügt wird (Default: ans Ende)'),
  baseLevel: z.number().int().min(0).max(2).optional().describe('Basis-Level für alle eingefügten Items 0-2 (Default: 0)'),
});

// ─── checklist.clone (V2.2) ────────────────────────────────────────
const checklistCloneSchema = z.object({
  sourceRef: z.string().describe('Alias/ID des Quell-Boards'),
  targetRef: z.string().optional().describe('Alias/ID des Ziel-Boards (Default: aktuelles Board im Stack)'),
});

// ─── checklist.item.move (V2.2) ────────────────────────────────────
const checklistItemMoveSchema = z.object({
  boardRef: z.string().describe('Alias/ID des Boards'),
  fromChecklistId: z.string().describe('Quell-Checklisten-ID'),
  toChecklistId: z.string().describe('Ziel-Checklisten-ID'),
  itemId: z.string().describe('Item-ID (Nachkommen werden mitverschoben)'),
  afterItemId: z.string().optional().describe('ID des Ziel-Items, nach dem eingefügt wird (Default: ans Ende)'),
});

// ─── checklist.set_recur / set_close_mode (V2.3) ───────────────────
const recurShape = z.object({
  type: z.enum(['none','daily','weekly','monthly','yearly']).describe('Wiederholungstyp'),
  every: z.number().int().min(1).max(365).optional().describe('Intervall (alle N Einheiten)'),
  weekdays: z.array(z.number().int().min(0).max(6)).optional().describe('Wochentage (0=Mo..6=So)'),
  weekday: z.number().int().min(0).max(6).optional().describe('Einzel-Wochentag (legacy / monatlich)'),
  weekdayOrd: z.number().int().min(-1).max(4).optional().describe('Ordinalzahl (1..4, -1=letzter)'),
  monthType: z.enum(['day','weekday']).optional().describe('monatlich per Tag-im-Monat oder Wochentag'),
  day: z.number().int().min(1).max(31).optional().describe('Tag im Monat'),
  yearMonth: z.number().int().min(0).max(11).optional().describe('Monat (0=Januar..11=Dezember)'),
  yearDay: z.number().int().min(1).max(31).optional().describe('Tag im Monat für jährlich'),
  startDate: z.string().optional().describe('ISO-Datum YYYY-MM-DD, Beginn der Serie'),
  endType: z.enum(['none','date','count']).optional(),
  endDate: z.string().optional().describe('ISO-Datum YYYY-MM-DD'),
  endCount: z.number().int().min(1).max(999).optional(),
}).describe('Recur-Struktur analog card.recur');

const checklistSetRecurSchema = z.object({
  boardRef: z.string().describe('Alias/ID des Boards'),
  checklistId: z.string().describe('Checklisten-ID'),
  recur: recurShape,
});

const checklistSetCloseModeSchema = z.object({
  boardRef: z.string().describe('Alias/ID des Boards'),
  checklistId: z.string().describe('Checklisten-ID'),
  mode: z.enum(['manual','auto-prompt','auto-silent']).describe('Abschluss-Verhalten'),
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
  {
    name: 'checklist.paste',
    description: 'Fügt Items aus einem Text-Block in eine Checkliste ein. Parser erkennt Bullets und Einrückung (2 Spaces/Tab pro Level, max. 2). baseLevel offset ist optional.',
    schema: checklistPasteSchema,
    jsonSchema: zodToJsonSchema(checklistPasteSchema),
  },
  {
    name: 'checklist.clone',
    description: 'Klont alle Checklisten eines Quell-Boards in ein Ziel-Board (oder aktuelles Board). Labels bekommen "(Kopie)"-Suffix, Items behalten Levels, done wird zurückgesetzt.',
    schema: checklistCloneSchema,
    jsonSchema: zodToJsonSchema(checklistCloneSchema),
  },
  {
    name: 'checklist.item.move',
    description: 'Verschiebt ein Item (mit allen Nachkommen) zwischen zwei Checklisten im selben Board. Level wird bei Cross-List-Move auf 0 normalisiert.',
    schema: checklistItemMoveSchema,
    jsonSchema: zodToJsonSchema(checklistItemMoveSchema),
  },
  {
    name: 'checklist.set_recur',
    description: 'Setzt das Wiederholungs-Muster einer Checkliste. Struktur analog card.recur (type, every, weekdays, startDate, endType, …).',
    schema: checklistSetRecurSchema,
    jsonSchema: zodToJsonSchema(checklistSetRecurSchema),
  },
  {
    name: 'checklist.set_close_mode',
    description: 'Setzt das Abschluss-Verhalten einer Checkliste: manual | auto-prompt | auto-silent.',
    schema: checklistSetCloseModeSchema,
    jsonSchema: zodToJsonSchema(checklistSetCloseModeSchema),
  },
];
