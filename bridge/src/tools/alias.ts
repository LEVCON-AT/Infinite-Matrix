import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

const resolveSchema = z.object({
  alias: z.string().describe('Alias zum Auflösen (case-insensitiv)'),
});

const setSchema = z.object({
  currentAlias: z
    .string()
    .optional()
    .describe('Vorhandener Alias zum Umbenennen (resolved via aliasIndex)'),
  nodeRef: z
    .string()
    .optional()
    .describe('Alias/ID einer Matrix oder Board — für neuen Alias auf einem Node'),
  alias: z.string().describe('Neuer Alias-Wert. Leer = bestehenden Alias löschen.'),
});

export const aliasTools: ToolDef[] = [
  {
    name: 'alias.resolve',
    description:
      'Löst einen Alias auf und gibt die zugehörige Referenz (Matrix-ID, Zelle, Karte, Link) zurück.',
    schema: resolveSchema,
    jsonSchema: zodToJsonSchema(resolveSchema),
  },
  {
    name: 'alias.set',
    description:
      'Setzt, renamed oder löscht einen Alias. Via currentAlias für Rename/Delete, via nodeRef für neuen Matrix/Board-Alias. Für Cell/Card/Link: spezifische Tools nutzen.',
    schema: setSchema,
    jsonSchema: zodToJsonSchema(setSchema),
  },
];
