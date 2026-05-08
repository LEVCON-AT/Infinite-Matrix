// Welle WV.E #40 Heptad-Pflege — MCP-Tool fuer Auto-Calendar-
// Manifestations-Diagnose.
//
// Migration 082 (WV.E #37) erzeugt automatische Calendar-
// Manifestations aus info_field(value_type='date') via 3 Trigger.
// Diagnose-Tool listet pro Workspace alle aktiven Auto-Manifs +
// erlaubt das Pruefen, ob ein erwartetes info_field-Datum
// tatsaechlich auf dem Kalender ankommt.
//
// Read-only — Auto-Manifs werden ausschliesslich vom Postgres-
// Trigger gepflegt. Manuelle Mutation ist im Frontend per Toast
// blockiert (lib/atom-manifestations.ts) und auch hier nicht
// expose. Wer den Toggle pro Vorlage abschalten will: das ist
// `template_widget.config.toggles.date_field_auto_calendar=false`,
// MCP-Pfad ueber das existing template-update-Tool.

import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

// ─── manif.calendar.auto.list ────────────────────────────────
const manifCalendarAutoListSchema = z.object({
  workspaceRef: z
    .string()
    .min(1)
    .describe('Workspace-Alias oder UUID. Filter auf workspace_id der Auto-Manifs.'),
  cellRef: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Optional: Cell-Alias oder UUID. Filter auf container_id (cell). Ohne: alle Cells im Workspace.',
    ),
  infoFieldId: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Optional: Filter auf einen konkreten info_field-Atom (atom_id). Nuetzlich um Trigger-Wirkung pro Feld zu pruefen.',
    ),
});

export const manifCalendarAutoTools: ToolDef[] = [
  {
    name: 'manif.calendar.auto.list',
    description:
      'Listet die automatisch erzeugten Calendar-Manifestations aus info_field(value_type=date) (Welle WV.E #37). Pro Auto-Manif: cell_id, info_field_id, start_date (aus display_meta), label, last_synced_at. Diagnose-Tool — Auto-Manifs werden ausschliesslich vom Postgres-Trigger gepflegt, manuelle Mutation ist blockiert.',
    schema: manifCalendarAutoListSchema,
    jsonSchema: zodToJsonSchema(manifCalendarAutoListSchema),
  },
];
