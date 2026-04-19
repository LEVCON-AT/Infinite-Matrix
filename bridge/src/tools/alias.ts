import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

const resolveSchema = z.object({
  alias: z.string().describe('Alias zum Auflösen (case-insensitiv)'),
});

export const aliasTools: ToolDef[] = [
  {
    name: 'alias.resolve',
    description:
      'Löst einen Alias auf und gibt die zugehörige Referenz (Matrix-ID, Zelle, Karte, Link) zurück.',
    schema: resolveSchema,
    jsonSchema: zodToJsonSchema(resolveSchema),
  },
];
