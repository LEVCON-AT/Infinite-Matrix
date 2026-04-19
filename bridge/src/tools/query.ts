import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

const queryCardsSchema = z.object({
  filter: z
    .object({
      due: z.enum(['today', 'week', 'month', 'overdue']).optional().describe('Fälligkeit filtern'),
      tag: z.string().optional().describe('Nach Tag filtern'),
      who: z.string().optional().describe('Nach zugewiesener Person filtern'),
      priority: z.number().int().min(0).max(3).optional().describe('Priorität (0-3)'),
      scope: z
        .enum(['current', 'tree'])
        .optional()
        .default('tree')
        .describe('Suchbereich: aktuelle Matrix oder ganzer Baum'),
    })
    .optional()
    .default({}),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

const queryAliasesSchema = z.object({
  prefix: z.string().optional().describe('Nur Aliasse mit diesem Prefix (case-insensitiv)'),
  type: z
    .enum(['matrix', 'board', 'cell', 'card', 'link', 'mail'])
    .optional()
    .describe('Nur Aliasse dieses Typs'),
  limit: z.number().int().min(1).max(500).optional().default(100),
});

export const queryTools: ToolDef[] = [
  {
    name: 'query.cards',
    description:
      'Sucht Kanban-Karten mit Filtern (Fälligkeit, Tag, Person, Priorität). Gibt passende Karten zurück.',
    schema: queryCardsSchema,
    jsonSchema: zodToJsonSchema(queryCardsSchema),
  },
  {
    name: 'query.aliases',
    description:
      'Listet Aliasse optional gefiltert nach Prefix und Typ. Nützlich für Fuzzy-Lookups in Prompts.',
    schema: queryAliasesSchema,
    jsonSchema: zodToJsonSchema(queryAliasesSchema),
  },
];
