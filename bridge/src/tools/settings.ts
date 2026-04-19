import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

// ─── settings.get ──────────────────────────────────────────────────
const settingsGetSchema = z.object({
  key: z
    .string()
    .optional()
    .describe('Settings-Key (auch dot-path wie "vis.addRowCol"). Ohne: ganzer appSettings-Tree'),
});

// ─── settings.set ──────────────────────────────────────────────────
const settingsSetSchema = z.object({
  key: z.string().describe('Settings-Key (top-level oder dot-path wie "vis.addRowCol")'),
  value: z.unknown().describe('Neuer Wert (JSON-serialisierbar)'),
});

export const settingsTools: ToolDef[] = [
  {
    name: 'settings.get',
    description: 'Liefert einen einzelnen Settings-Wert oder das ganze appSettings-Objekt.',
    schema: settingsGetSchema,
    jsonSchema: zodToJsonSchema(settingsGetSchema),
  },
  {
    name: 'settings.set',
    description:
      'Setzt einen Settings-Wert. Nur vorhandene Keys werden akzeptiert (keine Neu-Pollution).',
    schema: settingsSetSchema,
    jsonSchema: zodToJsonSchema(settingsSetSchema),
  },
];
