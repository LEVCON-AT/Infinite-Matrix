// Welle WV.D.8 Heptad-Pflege — MCP-Tools fuer widget_external_channels.
//
// Verknuepft Widget-Instanzen mit externen Provider-Refs (Slack-Channel,
// Outlook-Folder, OneDrive-Folder, ...). Die Bindung lebt pro Widget,
// nicht pro Cell — dasselbe Widget in zwei Cells teilt die Bridge.
//
// Pattern parallel zu atom-pin.ts. Bridge registriert Schemas; Client-
// Handler (client-web) fuehren die RPC-Calls aus.

import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

const channelProviderSchema = z.enum([
  'outlook',
  'gmail',
  'mail-generic',
  'onenote',
  'onedrive',
  'drive',
  'dropbox',
  'nextcloud',
  'slack',
  'teams',
  'discord',
  'telegram',
  'whatsapp',
]);

// ─── widget_channel.set ──────────────────────────────────────────
// Idempotent via UNIQUE(widget_id, provider) — vorhandene Bindung wird
// per upsert ueberschrieben.
const widgetChannelSetSchema = z.object({
  widgetId: z.string().describe('template_widgets.id (Widget-Instanz)'),
  workspaceRef: z.string().optional().describe('Workspace-Alias/ID (default: aktive Session)'),
  provider: channelProviderSchema.describe('Channel-Provider'),
  externalRef: z
    .record(z.unknown())
    .describe(
      'Provider-spezifischer Ref (z.B. {channel_id, channel_name} fuer Slack, {folder_id} fuer Drive, {team_id, channel_id} fuer Teams)',
    ),
});

// ─── widget_channel.delete ───────────────────────────────────────
const widgetChannelDeleteSchema = z.object({
  id: z.string().describe('widget_external_channels.id'),
});

// ─── widget_channel.list ─────────────────────────────────────────
const widgetChannelListSchema = z.object({
  workspaceRef: z.string().optional().describe('Workspace-Alias/ID'),
  widgetId: z.string().optional().describe('Filter auf Widget-Instanz'),
  provider: channelProviderSchema.optional().describe('Filter auf Provider'),
});

export const widgetChannelTools: ToolDef[] = [
  {
    name: 'widget_channel.set',
    description:
      'Verknuepft eine Widget-Instanz mit einem externen Provider-Ref (Channel/Folder/Inbox). Idempotent — bestehende Bindung fuer dasselbe Widget+Provider wird ueberschrieben.',
    schema: widgetChannelSetSchema,
    jsonSchema: zodToJsonSchema(widgetChannelSetSchema),
  },
  {
    name: 'widget_channel.delete',
    description:
      'Loescht eine Widget-Channel-Bindung. Das Widget bleibt erhalten und faellt auf den native/off-Modus zurueck.',
    schema: widgetChannelDeleteSchema,
    jsonSchema: zodToJsonSchema(widgetChannelDeleteSchema),
  },
  {
    name: 'widget_channel.list',
    description:
      'Listet Widget-Channel-Bindungen im Workspace, optional gefiltert auf Widget-Instanz oder Provider.',
    schema: widgetChannelListSchema,
    jsonSchema: zodToJsonSchema(widgetChannelListSchema),
  },
];
