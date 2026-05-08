// Welle WV.A.8b — MCP-Tools fuer feature_templates (Migration 067).
//
// AI-Konsumenten koennen Workspace-Vorlagen lesen + minimal verwalten.
// Volle CRUD-Suite (mit template_sections / template_widgets) folgt
// in Welle C wenn Vorlagen-Verwaltungs-Route gebaut wird —
// V1-Bridge-Scope: list + create + delete fuer feature_templates.

import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

// ─── feature_template.list ────────────────────────────────────
const featureTemplateListSchema = z.object({
  workspaceRef: z.string().optional().describe('Workspace-Alias oder ID. Default: aktive Session.'),
  visibility: z
    .enum(['platform', 'workspace', 'user'])
    .optional()
    .describe('Filter auf Visibility-Stufe.'),
});

// ─── feature_template.create ──────────────────────────────────
const featureTemplateCreateSchema = z.object({
  workspaceRef: z.string().optional().describe('Workspace-Alias oder ID. Default: aktive Session.'),
  name: z.string().min(1).describe('Vorlagen-Name (Pflicht).'),
  visibility: z
    .enum(['workspace', 'user'])
    .default('workspace')
    .describe('Plattform-Vorlagen werden nicht via Bridge angelegt — nur platform_admin.'),
  symbol: z.string().optional().describe('Heroicons-Icon-Name (z.B. "view-columns").'),
  symbolColor: z.string().optional().describe('Token-Reference (z.B. "var(--accent)").'),
  hotkeySlot: z
    .number()
    .int()
    .min(1)
    .max(9)
    .optional()
    .describe('Default-Hotkey-Hint (1-9). Effektive Slot-Belegung in workspace_hotkey_slots.'),
  renderPosition: z
    .enum(['hotkey_slot', 'auto_under_features'])
    .default('hotkey_slot')
    .describe('auto_under_features fuer Smart-Summary-aehnliche Vorlagen.'),
  titleTemplate: z
    .string()
    .optional()
    .describe('Title-Resolver-Template (analog docs.title_template).'),
});

// ─── feature_template.delete ──────────────────────────────────
const featureTemplateDeleteSchema = z.object({
  templateId: z.string().describe('feature_templates.id (UUID).'),
});

export const featureTemplateTools: ToolDef[] = [
  {
    name: 'feature_template.list',
    description:
      'Listet die fuer den aktuellen User sichtbaren Workspace-Vorlagen + Plattform-Vorlagen. Optional Filter auf visibility.',
    schema: featureTemplateListSchema,
    jsonSchema: zodToJsonSchema(featureTemplateListSchema),
  },
  {
    name: 'feature_template.create',
    description:
      'Legt eine neue Workspace- oder User-Vorlage an. Plattform-Vorlagen werden nicht ueber Bridge angelegt (nur platform_admin via SQL).',
    schema: featureTemplateCreateSchema,
    jsonSchema: zodToJsonSchema(featureTemplateCreateSchema),
  },
  {
    name: 'feature_template.delete',
    description:
      'Loescht eine Vorlage. Cascade: template_sections + template_widgets + cell_template_instances + cell_widget_overrides werden mit gehen.',
    schema: featureTemplateDeleteSchema,
    jsonSchema: zodToJsonSchema(featureTemplateDeleteSchema),
  },
];
