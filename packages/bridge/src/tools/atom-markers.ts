// Welle WV.B.7 — MCP-Tools fuer atom_markers (Migration 074).
//
// User-Markierungen an Atomen. Zwei Kinds (Konzept §13.6):
//   - star: Workspace-shared (alle Member sehen Counter + User-Liste)
//   - eye:  User-privat (nur Owner sieht eigene Eye-Marker)

import { z } from 'zod';
import type { ToolDef } from '../dispatcher.js';
import { zodToJsonSchema } from '../util/zod-json.js';

const atomTypeSchema = z.enum(['task', 'link', 'doc', 'checklist', 'imported_event', 'info_field']);

const markerKindSchema = z.enum(['star', 'eye']);

// ─── atom_marker.set ──────────────────────────────────────────
const atomMarkerSetSchema = z.object({
  kind: markerKindSchema,
  atomType: atomTypeSchema,
  atomId: z.string(),
});

// ─── atom_marker.unset ────────────────────────────────────────
const atomMarkerUnsetSchema = z.object({
  markerId: z.string().describe('atom_markers.id (Junction-Row).'),
});

// ─── atom_marker.list ─────────────────────────────────────────
const atomMarkerListSchema = z.object({
  workspaceRef: z.string().optional(),
  kind: markerKindSchema.optional().describe('Filter — alle wenn nicht gesetzt.'),
  atomType: atomTypeSchema.optional(),
  atomId: z.string().optional().describe('Wenn gesetzt: nur Marker auf diesem Atom.'),
  scope: z
    .enum(['self', 'workspace'])
    .default('workspace')
    .describe(
      'self = nur eigene Marker; workspace = alle sichtbaren (RLS filtert eye automatisch).',
    ),
});

export const atomMarkerTools: ToolDef[] = [
  {
    name: 'atom_marker.set',
    description:
      'Setzt eine Markierung (star oder eye) auf einem Atom. Idempotent (UNIQUE per user+atom+kind).',
    schema: atomMarkerSetSchema,
    jsonSchema: zodToJsonSchema(atomMarkerSetSchema),
  },
  {
    name: 'atom_marker.unset',
    description: 'Entfernt eine bestehende Markierung anhand der Junction-ID.',
    schema: atomMarkerUnsetSchema,
    jsonSchema: zodToJsonSchema(atomMarkerUnsetSchema),
  },
  {
    name: 'atom_marker.list',
    description:
      'Listet Markierungen im Workspace. Filter: kind/atomType/atomId/scope. RLS filtert kind=eye auf eigene Eintraege.',
    schema: atomMarkerListSchema,
    jsonSchema: zodToJsonSchema(atomMarkerListSchema),
  },
];
