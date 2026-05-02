// Welle D.X.M — MCP-Tools fuer atom_pins.
//
// atom_pins ist die generische "Atom A ist an Parent P gepinnt"-Relation.
// AI soll Pins erstellen/loeschen/verschieben koennen — z.B. "pinne diese
// Doku an Cell X" oder "erstelle eine neue Doku am Board Y und pinne sie".
//
// Pattern parallel zu card.ts. Bridge registriert die Schemas;
// Client-Handler (client-web/Standalone) fuehren die RPC-Calls aus.

import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

const atomKindSchema = z.enum(['task', 'link', 'doc', 'checklist', 'imported_event']);
const parentKindSchema = z.enum(['cell', 'atom', 'node', 'manifestation']);

// ─── atom_pin.create ──────────────────────────────────────────────
const atomPinCreateSchema = z.object({
  atomType: atomKindSchema.describe('Atom-Typ des zu pinnenden Atoms'),
  atomId: z.string().describe('Atom-ID (UUID)'),
  parentKind: parentKindSchema.describe(
    'Pin-Ziel-Typ: cell (Zelle), atom (anderes Atom), node (Matrix/Board), manifestation (V2)',
  ),
  parentId: z.string().describe('Pin-Ziel-ID (UUID)'),
  position: z.number().optional().describe('Sortier-Position (default 0)'),
});

// ─── atom_pin.delete ──────────────────────────────────────────────
const atomPinDeleteSchema = z.object({
  pinId: z.string().describe('atom_pins.id zum Loeschen'),
});

// ─── atom_pin.move ────────────────────────────────────────────────
const atomPinMoveSchema = z.object({
  pinId: z.string().describe('atom_pins.id'),
  newParentKind: parentKindSchema,
  newParentId: z.string().describe('Neue Parent-ID'),
  newPosition: z.number().optional(),
});

// ─── atom_pin.list ────────────────────────────────────────────────
const atomPinListSchema = z.object({
  workspaceRef: z.string().optional().describe('Workspace-Alias/ID (default: aktive Session)'),
  atomType: atomKindSchema.optional().describe('Filter auf Atom-Typ'),
  atomId: z.string().optional().describe('Filter auf Atom-ID'),
  parentKind: parentKindSchema.optional().describe('Filter auf Parent-Typ'),
  parentId: z.string().optional().describe('Filter auf Parent-ID'),
});

// ─── doc.pin (Bundled: Doc anlegen + Pin in einer RPC) ───────────
const docPinSchema = z.object({
  workspaceRef: z.string().optional().describe('Workspace-Alias/ID'),
  title: z.string().min(1).describe('Doku-Titel'),
  content: z.string().optional().describe('HTML-Content (default <p></p>)'),
  alias: z.string().optional().describe('Optionaler Alias fuer ^kuerzel-Zugriff'),
  sourceAlias: z.string().optional().describe('Quell-Alias (Cell/Card aus dem die Doku entstand)'),
  parentKind: parentKindSchema
    .optional()
    .describe('Pin-Ziel-Typ. Ohne Angabe: standalone Doku (kein Pin)'),
  parentId: z.string().optional().describe('Pin-Ziel-ID. Pflicht wenn parentKind gesetzt.'),
});

export const atomPinTools: ToolDef[] = [
  {
    name: 'atom_pin.create',
    description:
      'Pinnt ein Atom (Doku/Task/Link/Checkliste/Termin) an einen Parent (Zelle, anderes Atom, Matrix/Board). Mit Undo.',
    schema: atomPinCreateSchema,
    jsonSchema: zodToJsonSchema(atomPinCreateSchema),
  },
  {
    name: 'atom_pin.delete',
    description: 'Entfernt einen Pin. Atom + Parent bleiben erhalten.',
    schema: atomPinDeleteSchema,
    jsonSchema: zodToJsonSchema(atomPinDeleteSchema),
  },
  {
    name: 'atom_pin.move',
    description: 'Verschiebt einen Pin zu einem anderen Parent oder anderer Position.',
    schema: atomPinMoveSchema,
    jsonSchema: zodToJsonSchema(atomPinMoveSchema),
  },
  {
    name: 'atom_pin.list',
    description:
      'Listet Pins im Workspace, optional gefiltert auf Atom-Typ/ID oder Parent-Typ/ID.',
    schema: atomPinListSchema,
    jsonSchema: zodToJsonSchema(atomPinListSchema),
  },
  {
    name: 'doc.pin',
    description:
      'Erstellt eine neue Doku und pinnt sie atomar an einen Parent. Bundled-Variante zum Vermeiden eines doppelten Calls (doc.create + atom_pin.create).',
    schema: docPinSchema,
    jsonSchema: zodToJsonSchema(docPinSchema),
  },
];
