// Welle D.X.M — MCP-Tools fuer atom_tags + workspace_tags.
//
// Globales Tag-System. AI kann Tags an Atome haengen via vier Trigger:
//   freetext (#design)     - addAtomTagFreetext
//   alias_ref (^kuerzel)   - addAtomTagAlias
//   atom_ref (Task->Doc)   - addAtomTagAtomRef
//   object_ref (Cell/Node) - addAtomTagObjectRef
//
// Tag-Owner ist ausschliesslich Atom (Manifestation erbt, Cell-Tags
// werden als object_ref-Tags an Atomen modelliert, nicht als Cell-Owner).

import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

const atomKindSchema = z.enum(['task', 'link', 'doc', 'checklist', 'imported_event']);

const atomRef = {
  atomType: atomKindSchema.describe('Atom-Typ des Tag-Owners'),
  atomId: z.string().describe('Atom-ID (UUID)'),
};

// ─── tag.add.freetext ─────────────────────────────────────────────
const tagAddFreetextSchema = z.object({
  ...atomRef,
  value: z.string().min(1).describe('Tag-Wert (ohne #-Prefix)'),
});

// ─── tag.add.alias ────────────────────────────────────────────────
const tagAddAliasSchema = z.object({
  ...atomRef,
  alias: z.string().min(1).describe('Alias-Kuerzel (ohne ^-Prefix). Server-resolved.'),
});

// ─── tag.add.atomref ──────────────────────────────────────────────
const tagAddAtomRefSchema = z.object({
  ...atomRef,
  targetAtomType: atomKindSchema,
  targetAtomId: z.string(),
});

// ─── tag.add.objectref ────────────────────────────────────────────
const tagAddObjectRefSchema = z.object({
  ...atomRef,
  objectKind: z.enum(['cell', 'node']),
  objectId: z.string(),
});

// ─── tag.remove ───────────────────────────────────────────────────
const tagRemoveSchema = z.object({
  tagJunctionId: z.string().describe('atom_tags.id (Junction-Row, nicht Registry-Tag-ID)'),
});

// ─── tag.list ─────────────────────────────────────────────────────
const tagListSchema = z.object({
  workspaceRef: z.string().optional().describe('Workspace-Alias/ID'),
  atomType: atomKindSchema.optional().describe('Filter auf Atom-Typ des Owners'),
  atomId: z.string().optional().describe('Filter auf Atom-ID des Owners'),
  kind: z
    .enum(['freetext', 'alias_ref', 'atom_ref', 'object_ref'])
    .optional()
    .describe('Filter auf Tag-Kind'),
});

// ─── tag.gc ───────────────────────────────────────────────────────
const tagGcSchema = z.object({
  workspaceRef: z.string().optional().describe('Workspace-Alias/ID'),
});

export const atomTagTools: ToolDef[] = [
  {
    name: 'tag.add.freetext',
    description: 'Hängt einen freetext-Tag (#wert) an ein Atom. Idempotent (Doppel-Tag = no-op).',
    schema: tagAddFreetextSchema,
    jsonSchema: zodToJsonSchema(tagAddFreetextSchema),
  },
  {
    name: 'tag.add.alias',
    description:
      'Hängt einen alias_ref-Tag an ein Atom. Server resolved den Alias gegen den alias-index.',
    schema: tagAddAliasSchema,
    jsonSchema: zodToJsonSchema(tagAddAliasSchema),
  },
  {
    name: 'tag.add.atomref',
    description: 'Hängt einen atom_ref-Tag (Verweis auf anderes Atom) an ein Atom.',
    schema: tagAddAtomRefSchema,
    jsonSchema: zodToJsonSchema(tagAddAtomRefSchema),
  },
  {
    name: 'tag.add.objectref',
    description: 'Hängt einen object_ref-Tag (Verweis auf Cell oder Node) an ein Atom.',
    schema: tagAddObjectRefSchema,
    jsonSchema: zodToJsonSchema(tagAddObjectRefSchema),
  },
  {
    name: 'tag.remove',
    description:
      'Entfernt einen einzelnen Tag-Junction von einem Atom. usage_count wird via Trigger dekrementiert.',
    schema: tagRemoveSchema,
    jsonSchema: zodToJsonSchema(tagRemoveSchema),
  },
  {
    name: 'tag.list',
    description:
      'Listet Tag-Junctions im Workspace, optional gefiltert auf Atom-Typ/ID oder Tag-Kind. Joined mit workspace_tags-Registry.',
    schema: tagListSchema,
    jsonSchema: zodToJsonSchema(tagListSchema),
  },
  {
    name: 'tag.gc',
    description:
      'Garbage-Collect — entfernt alle workspace_tags-Rows mit usage_count=0. Liefert Anzahl gepurgter Tags.',
    schema: tagGcSchema,
    jsonSchema: zodToJsonSchema(tagGcSchema),
  },
];
