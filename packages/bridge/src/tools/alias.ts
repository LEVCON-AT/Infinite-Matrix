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

// Welle WV.D.7 + Konzept §14.3 — alias.expand_to_text.
//
// V1-Output (Standalone-Handler matrix.html, client-web ws-bridge folgt):
//   { text: string }
//
// V2-Output gemaess Konzept §14.3 (deferred bis Welle F):
//   { text, hyperlink, children: Array<{ alias_or_id, kind, title, hyperlink }> }
//
// `depth` reserviert die Schnittstelle fuer V2-Children-Traversal — V1-Handler
// ignorieren den Parameter (Single-Level) bis der Resolver Atom-Beziehungen
// transitiv aufloest.
const expandSchema = z.object({
  alias: z.string().describe('Alias zum Expandieren (case-insensitiv).'),
  depth: z
    .number()
    .int()
    .min(1)
    .max(3)
    .default(1)
    .describe(
      'Children-Traversal-Tiefe (1-3, default 1). V1-Handler ignorieren den Parameter; V2 Welle F liefert children-Liste fuer Mail-Compose mit nested Aliasen.',
    ),
  format: z
    .enum(['markdown', 'plain', 'html'])
    .default('markdown')
    .describe(
      'Output-Format: markdown=`[Label](^alias)`, plain=`Label (^alias)`, html=`<a href="...">Label</a>`.',
    ),
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
  {
    name: 'alias.expand_to_text',
    description:
      'Expandiert einen Alias zu einer kontextangepassten Text-Repräsentation (markdown / plain / html). Nützlich beim Compose von Mails, Doku-Snippets oder HTML-Editoren — der KI generiert Verweise, die sowohl maschinen-resolvable bleiben (^alias) als auch lesbar sind. Permission: Tool läuft mit User-Context, leakt nichts was der Caller nicht sehen darf.',
    schema: expandSchema,
    jsonSchema: zodToJsonSchema(expandSchema),
  },
];
