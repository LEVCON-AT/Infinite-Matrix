import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

// Hardcoded Template-IDs müssen mit TEMPLATES-Registry im Client synchron sein.
const TEMPLATE_IDS = ['projektplan', 'gtd', 'life-layout', 'decision', 'reading-list'] as const;

const templateListSchema = z.object({});

const templateInstantiateSchema = z.object({
  templateId: z.enum(TEMPLATE_IDS).describe('Template-Kürzel (siehe template.list)'),
  label: z.string().optional().describe('Eigener Name für die instanziierte Matrix'),
  parentCellAlias: z
    .string()
    .optional()
    .describe(
      'Cell-Alias (^kürzel) in der die neue Matrix als Sub-Matrix eingehängt wird. Ohne: Orphan.',
    ),
});

export const templateTools: ToolDef[] = [
  {
    name: 'template.list',
    description:
      'Liefert den hardcoded Template-Katalog (Projektplan, GTD, Life-Layout, Decision, Reading-List).',
    schema: templateListSchema,
    jsonSchema: zodToJsonSchema(templateListSchema),
  },
  {
    name: 'template.instantiate',
    description:
      'Erzeugt eine Matrix aus einem Template. Optional an einer Zelle (via parentCellAlias) anhängen.',
    schema: templateInstantiateSchema,
    jsonSchema: zodToJsonSchema(templateInstantiateSchema),
  },
];
