// Welle WV.A.8b — MCP-Tools fuer saved_filters (Migration 070).
//
// AI-Konsumenten koennen Filter listen + neu speichern. body folgt
// SavedFilterBody-Format aus client-web/src/lib/atom-filter-attrs.ts
// (Schema-Quad mit WV.Y).

import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

const atomKindSchema = z.enum(['task', 'link', 'doc', 'checklist', 'imported_event']);

const filterOperatorSchema = z.enum([
  'contains',
  'starts-with',
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'between',
  'before',
  'after',
  'in',
  'not-in',
  'has-any',
  'has-all',
  'has-none',
  'is-empty',
  'is-not-empty',
]);

const filterConditionSchema = z.object({
  field: z.string().describe('Attribute-Key aus lib/atom-filter-attrs.ts (z.B. "deadline").'),
  operator: filterOperatorSchema,
  // value ist polymorph je nach operator. Bridge waet Schema-Drift via
  // body.v=1 CHECK-Constraint in DB.
  value: z.unknown().describe('Operator-abhaengig (string, number, boolean, string[], [min,max]).'),
});

const savedFilterBodySchema = z.object({
  v: z.literal(1),
  atomKind: atomKindSchema,
  logic: z.enum(['and', 'or']),
  conditions: z.array(filterConditionSchema),
});

// ─── saved_filter.list ────────────────────────────────────────
const savedFilterListSchema = z.object({
  workspaceRef: z.string().optional(),
  atomKind: atomKindSchema.optional().describe('Filter auf einen bestimmten Atom-Typ.'),
  scope: z
    .enum(['workspace', 'user', 'both'])
    .default('both')
    .describe('workspace=shared (owner_user_id NULL), user=eigene private, both=alle sichtbaren.'),
});

// ─── saved_filter.create ──────────────────────────────────────
const savedFilterCreateSchema = z.object({
  workspaceRef: z.string().optional(),
  name: z.string().min(1),
  body: savedFilterBodySchema,
  isPrivate: z
    .boolean()
    .default(false)
    .describe('true = nur fuer anrufenden User; false = workspace-shared.'),
});

// ─── saved_filter.delete ──────────────────────────────────────
const savedFilterDeleteSchema = z.object({
  filterId: z.string().describe('saved_filters.id.'),
});

export const savedFilterTools: ToolDef[] = [
  {
    name: 'saved_filter.list',
    description:
      'Listet die fuer den User sichtbaren Filter (workspace-shared + eigene private). Optional Filter auf atomKind.',
    schema: savedFilterListSchema,
    jsonSchema: zodToJsonSchema(savedFilterListSchema),
  },
  {
    name: 'saved_filter.create',
    description:
      'Speichert einen Filter mit body=SavedFilterBody (siehe lib/atom-filter-attrs.ts). isPrivate=true → nur fuer den anrufenden User.',
    schema: savedFilterCreateSchema,
    jsonSchema: zodToJsonSchema(savedFilterCreateSchema),
  },
  {
    name: 'saved_filter.delete',
    description: 'Loescht einen Filter.',
    schema: savedFilterDeleteSchema,
    jsonSchema: zodToJsonSchema(savedFilterDeleteSchema),
  },
];
