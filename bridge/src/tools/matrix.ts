import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

const stateGetSchema = z.object({
  subtreeRef: z.string().optional().describe('Alias oder Matrix-ID für Teilbaum-Abfrage'),
});

const navigateSchema = z.object({
  target: z.string().describe('Alias (^kürzel) oder Matrix-ID zum Navigieren'),
});

const createSchema = z.object({
  parentRef: z.string().optional().describe('Alias/ID der Eltern-Zelle (leer = Root)'),
  label: z.string().describe('Name der neuen Matrix'),
  rows: z.array(z.string()).optional().describe('Zeilen-Labels'),
  cols: z.array(z.string()).optional().describe('Spalten-Labels'),
  alias: z.string().optional().describe('Alias für die neue Matrix'),
});

export const matrixTools: ToolDef[] = [
  {
    name: 'matrix.state.get',
    description:
      'Gibt den aktuellen Matrix-State als JSON zurück. Optional nur einen Teilbaum (via Alias oder ID).',
    schema: stateGetSchema,
    jsonSchema: zodToJsonSchema(stateGetSchema),
  },
  {
    name: 'matrix.navigate',
    description: 'Navigiert im Browser zu einer bestimmten Matrix oder Zelle (via Alias oder ID).',
    schema: navigateSchema,
    jsonSchema: zodToJsonSchema(navigateSchema),
  },
  {
    name: 'matrix.create',
    description:
      'Erstellt eine neue Matrix. Optional in einer bestimmten Eltern-Zelle, mit vordefinierten Zeilen/Spalten und Alias.',
    schema: createSchema,
    jsonSchema: zodToJsonSchema(createSchema),
  },
];
