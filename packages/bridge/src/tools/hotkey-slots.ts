// Welle WV.A.8b — MCP-Tools fuer workspace_hotkey_slots + user_hotkey_slots
// (Migration 069).

import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

// ─── hotkey_slot.list ─────────────────────────────────────────
const hotkeySlotListSchema = z.object({
  workspaceRef: z.string().optional().describe('Workspace-Alias/ID. Default: aktive Session.'),
  scope: z
    .enum(['workspace', 'user', 'both'])
    .default('both')
    .describe('workspace = nur Owner-Belegung; user = nur eigene Override; both = beide gemerged.'),
});

// ─── hotkey_slot.set (workspace) ──────────────────────────────
const hotkeySlotSetWorkspaceSchema = z.object({
  workspaceRef: z.string().optional().describe('Workspace-Alias/ID.'),
  slot: z.number().int().min(1).max(9),
  templateId: z.string().describe('feature_templates.id, das auf diesem Slot landen soll.'),
});

// ─── hotkey_slot.set (user-private) ───────────────────────────
const hotkeySlotSetUserSchema = z.object({
  workspaceRef: z.string().optional().describe('Workspace-Alias/ID.'),
  slot: z.number().int().min(1).max(9),
  templateId: z
    .string()
    .describe('feature_templates.id fuer den Self-Override (gilt nur fuer den anrufenden User).'),
});

// ─── hotkey_slot.clear ────────────────────────────────────────
const hotkeySlotClearSchema = z.object({
  scope: z.enum(['workspace', 'user']).describe('Welche Slot-Belegung zuruecknehmen.'),
  workspaceRef: z.string().optional(),
  slot: z.number().int().min(1).max(9),
});

export const hotkeySlotTools: ToolDef[] = [
  {
    name: 'hotkey_slot.list',
    description:
      'Listet die Hotkey-Slot-Belegung 1-9 fuer den Workspace. scope=workspace zeigt Owner-Belegung, scope=user die eigenen Overrides, scope=both gemerged (User-Override hat Vorrang).',
    schema: hotkeySlotListSchema,
    jsonSchema: zodToJsonSchema(hotkeySlotListSchema),
  },
  {
    name: 'hotkey_slot.set.workspace',
    description:
      'Belegt einen Slot 1-9 mit einer Vorlage fuer den ganzen Workspace. NUR Workspace-Owner.',
    schema: hotkeySlotSetWorkspaceSchema,
    jsonSchema: zodToJsonSchema(hotkeySlotSetWorkspaceSchema),
  },
  {
    name: 'hotkey_slot.set.user',
    description:
      'Belegt einen Slot 1-9 fuer den anrufenden User (Self-Override gegenueber Workspace-Belegung).',
    schema: hotkeySlotSetUserSchema,
    jsonSchema: zodToJsonSchema(hotkeySlotSetUserSchema),
  },
  {
    name: 'hotkey_slot.clear',
    description: 'Loescht einen Slot. scope=workspace nur Owner; scope=user nur eigener Account.',
    schema: hotkeySlotClearSchema,
    jsonSchema: zodToJsonSchema(hotkeySlotClearSchema),
  },
];
