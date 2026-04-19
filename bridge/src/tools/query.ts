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

export const queryTools: ToolDef[] = [
  {
    name: 'query.cards',
    description:
      'Sucht Kanban-Karten mit Filtern (Fälligkeit, Tag, Person, Priorität). Gibt passende Karten zurück.',
    schema: queryCardsSchema,
    jsonSchema: zodToJsonSchema(queryCardsSchema),
  },
];
