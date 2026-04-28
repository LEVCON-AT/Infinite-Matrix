// Tool-Registry fuer A.2 — eine Quelle der Wahrheit fuer die MCP-
// Tools die der LLM aufrufen darf.
//
// Pro Eintrag:
//   - name              MCP-RPC-Name (matcht Migration 021)
//   - description       fuer LLM-Tool-Liste
//   - inputSchema       JSON-Schema im Anthropic-Format (wird in
//                        adapter konvertiert wenn noetig)
//   - riskLevel         safe = direct call; destructive = Confirm-Modal
//                        (kommt mit A.3 Inline-Help-Drawer)
//   - allowedInModes    welche Modi diesen Tool sehen duerfen
//                        (Promptinj-Mitigation B)
//
// Nicht hier: forbidden-Tools (account/auth/workspace-lifecycle/
// webhooks). Die existieren GAR NICHT als Tool — der LLM weiss nicht
// dass es sie gibt.

import type { AssistMode, ToolDef } from './types';

const UUID = {
  type: 'string' as const,
  description: 'UUID',
};

const NULLABLE_UUID = {
  type: ['string', 'null'] as Array<'string' | 'null'>,
  description: 'UUID oder null',
};

export const TOOL_REGISTRY: ReadonlyArray<ToolDef> = [
  // ─── Read-only ───────────────────────────────────────────────
  {
    name: 'mcp_get_workspace_context',
    description:
      'Liefert eine Snapshot-Uebersicht des Workspaces: Workspace-Name + alle Knoten (Matrix oder Board) mit ihren Cell- und Card-Counts. Gut fuer Context-Aufbau.',
    inputSchema: {
      type: 'object',
      properties: {
        p_workspace_id: { ...UUID, description: 'UUID des Workspaces' },
      },
      required: ['p_workspace_id'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help', 'cell-suggest'], // Wizard hat noch nichts zu lesen
  },

  // ─── Create ──────────────────────────────────────────────────
  {
    name: 'mcp_create_node',
    description:
      'Erstellt einen neuen Knoten im Workspace. Type "matrix" = Tabellen-Gitter mit Zeilen/Spalten/Zellen. Type "board" = Kanban-Board mit Spalten/Karten. Optional unter parent_cell_id verschachtelt.',
    inputSchema: {
      type: 'object',
      properties: {
        p_workspace_id: { ...UUID, description: 'Ziel-Workspace' },
        p_parent_cell_id: {
          ...NULLABLE_UUID,
          description: 'Optional: Parent-Cell-UUID fuer Sub-Matrix/Sub-Board. NULL fuer Top-Level.',
        },
        p_type: { type: 'string', enum: ['matrix', 'board'], description: 'matrix oder board' },
        p_label: { type: 'string', description: 'Anzeige-Name, max 200 Zeichen.' },
        p_alias: {
          type: ['string', 'null'],
          description:
            'Optional: Kurzkuerzel zum schnellen Springen, max 50 Zeichen, nur a-z A-Z 0-9 _ -.',
        },
      },
      required: ['p_workspace_id', 'p_parent_cell_id', 'p_type', 'p_label', 'p_alias'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help', 'cell-suggest'],
  },
  {
    name: 'mcp_create_card',
    description:
      'Erstellt eine neue Karte in einer Kanban-Spalte. Position automatisch = max+1. Note ist optional, max 5000 Zeichen.',
    inputSchema: {
      type: 'object',
      properties: {
        p_col_id: { ...UUID, description: 'UUID der Kanban-Spalte (kb_cols.id)' },
        p_name: { type: 'string', description: 'Karten-Name, max 200 Zeichen.' },
        p_note: { type: ['string', 'null'], description: 'Optional: Notiz/Beschreibung.' },
        p_alias: { type: ['string', 'null'], description: 'Optional: Kurzkuerzel.' },
      },
      required: ['p_col_id', 'p_name', 'p_note', 'p_alias'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help', 'cell-suggest'],
  },
  {
    name: 'mcp_create_checklist',
    description:
      'Erstellt eine Checkliste. Genau eines von cell_id ODER board_id muss gesetzt sein (XOR). Cell-Checkliste haengt direkt an einer Matrix-Zelle, Board-Checkliste an einem Kanban-Board.',
    inputSchema: {
      type: 'object',
      properties: {
        p_cell_id: {
          ...NULLABLE_UUID,
          description:
            'UUID der Cell ODER null. Genau eines von cell_id/board_id muss gesetzt sein.',
        },
        p_board_id: {
          ...NULLABLE_UUID,
          description:
            'UUID des Boards ODER null. Genau eines von cell_id/board_id muss gesetzt sein.',
        },
        p_label: { type: 'string', description: 'Listen-Name, max 200 Zeichen.' },
        p_alias: { type: ['string', 'null'], description: 'Optional: Kurzkuerzel.' },
      },
      required: ['p_cell_id', 'p_board_id', 'p_label', 'p_alias'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help', 'cell-suggest'],
  },
  {
    name: 'mcp_add_checklist_item',
    description:
      'Fuegt ein Item zu einer Checkliste hinzu. Level 0 (Default), 1 oder 2 fuer Einrueckung. Text max 500 Zeichen.',
    inputSchema: {
      type: 'object',
      properties: {
        p_checklist_id: { ...UUID, description: 'UUID der Checkliste' },
        p_text: { type: 'string', description: 'Item-Text, max 500 Zeichen.' },
        p_level: {
          type: 'integer',
          minimum: 0,
          maximum: 2,
          description: 'Einrueckungs-Level: 0 (Top), 1 oder 2.',
        },
      },
      required: ['p_checklist_id', 'p_text', 'p_level'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help', 'cell-suggest'],
  },

  // ─── Modify ──────────────────────────────────────────────────
  {
    name: 'mcp_rename_node',
    description: 'Aendert das Label eines Knotens.',
    inputSchema: {
      type: 'object',
      properties: {
        p_node_id: UUID,
        p_new_label: { type: 'string', description: 'Neues Label, max 200 Zeichen.' },
      },
      required: ['p_node_id', 'p_new_label'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help'],
  },
  {
    name: 'mcp_set_node_alias',
    description: 'Setzt oder entfernt das Alias eines Knotens. NULL = Alias entfernen.',
    inputSchema: {
      type: 'object',
      properties: {
        p_node_id: UUID,
        p_alias: {
          type: ['string', 'null'],
          description: 'Neues Alias oder null. Max 50 Zeichen.',
        },
      },
      required: ['p_node_id', 'p_alias'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help'],
  },
  {
    name: 'mcp_rename_card',
    description: 'Aendert den Namen einer Karte.',
    inputSchema: {
      type: 'object',
      properties: {
        p_card_id: UUID,
        p_new_name: { type: 'string', description: 'Neuer Name, max 200 Zeichen.' },
      },
      required: ['p_card_id', 'p_new_name'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help'],
  },
  {
    name: 'mcp_move_card',
    description:
      'Verschiebt eine Karte in eine andere Spalte des SELBEN Boards. Cross-Board-Move ist nicht erlaubt — dafuer muesste die Karte neu erstellt werden.',
    inputSchema: {
      type: 'object',
      properties: {
        p_card_id: UUID,
        p_target_col_id: { ...UUID, description: 'UUID der Ziel-Spalte (gleicher Board).' },
      },
      required: ['p_card_id', 'p_target_col_id'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help'],
  },
  {
    name: 'mcp_set_card_archived',
    description: 'Archiviert oder de-archiviert eine Karte. Reversibel.',
    inputSchema: {
      type: 'object',
      properties: {
        p_card_id: UUID,
        p_archived: { type: 'boolean', description: 'true = archivieren, false = de-archivieren.' },
      },
      required: ['p_card_id', 'p_archived'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help'],
  },
];

// ─── Wizard-only: Preview-Pattern (Mitigation H) ───────────────
// wizard_propose_structure ist KEIN echtes RPC — der Dispatcher in
// index.ts faengt es ab und reicht die args als data zurueck. Der
// LLM gibt seinen Vorschlag als Tool-Use-Args (strukturiert),
// statt JSON in Text zu bauen. Apply-Schleife in lib/wizard-apply.ts
// (A.4d) iteriert die args und ruft die echten mcp_create_*-RPCs.
//
// Tiefen-Limit absichtlich: max 3 nodes, max 6 children pro Node,
// keine tieferen Verschachtelungen. Begrenzt LLM-Token-Burn und
// Apply-Loop-Laufzeit (Mitigation D).
export const WIZARD_PROPOSE_TOOL_NAME = 'wizard_propose_structure';

const WIZARD_PROPOSE_TOOL: ToolDef = {
  name: WIZARD_PROPOSE_TOOL_NAME,
  description:
    'Liefert einen STRUKTURIERTEN Workspace-Vorschlag fuer den Onboarding-Wizard. Wird NICHT direkt ausgefuehrt — der User sieht eine Vorschau und entscheidet manuell. Rufe dieses Tool GENAU EINMAL und beende dann den Turn ohne weiteren Tool-Call.',
  inputSchema: {
    type: 'object',
    properties: {
      workspace_label: {
        type: 'string',
        description: 'Vorgeschlagener Workspace-Name, max 60 Zeichen.',
        maxLength: 60,
      },
      summary: {
        type: 'string',
        description: 'Kurze Erklaerung warum diese Struktur passt (1-3 Saetze, max 400 Zeichen).',
        maxLength: 400,
      },
      nodes: {
        type: 'array',
        description:
          'Top-Level-Knoten des Workspaces. Max 3 Eintraege — kein Spam, lieber wenige starke Vorschlaege.',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Anzeige-Name, max 60 Zeichen.', maxLength: 60 },
            type: {
              type: 'string',
              enum: ['matrix', 'board'],
              description:
                'matrix = Tabellen-Gitter (Zeilen/Spalten/Zellen). board = Kanban-Board (Spalten/Karten).',
            },
            alias: {
              type: ['string', 'null'],
              description: 'Optional: Kurzkuerzel zum schnellen Springen, max 50 Zeichen.',
              maxLength: 50,
            },
            children: {
              type: 'array',
              description:
                'Eintraege INNERHALB des Knotens. Bei type=matrix: Zellen mit optional checklists/sub_node. Bei type=board: Karten mit name/note. Max 6 Eintraege pro Knoten.',
              maxItems: 6,
              items: {
                type: 'object',
                properties: {
                  cell_label: {
                    type: ['string', 'null'],
                    description:
                      'Bei matrix-Parent: Label fuer eine Cell. Bei board-Parent: nicht setzen.',
                  },
                  card_name: {
                    type: ['string', 'null'],
                    description:
                      'Bei board-Parent: Name fuer eine Karte. Bei matrix-Parent: nicht setzen.',
                  },
                  card_note: {
                    type: ['string', 'null'],
                    description: 'Optional: Notiz fuer eine Karte (nur bei board-Parent).',
                  },
                  checklists: {
                    type: 'array',
                    description:
                      'Optional: Checklisten innerhalb dieser Cell (nur bei matrix-Parent). Max 2.',
                    maxItems: 2,
                    items: {
                      type: 'object',
                      properties: {
                        label: { type: 'string', maxLength: 60 },
                        items: {
                          type: 'array',
                          maxItems: 6,
                          items: { type: 'string', maxLength: 200 },
                        },
                      },
                      required: ['label', 'items'],
                    },
                  },
                },
              },
            },
          },
          required: ['label', 'type'],
        },
      },
    },
    required: ['workspace_label', 'summary', 'nodes'],
  },
  riskLevel: 'safe',
  allowedInModes: ['wizard'],
};

const TOOL_REGISTRY_FULL: ReadonlyArray<ToolDef> = [...TOOL_REGISTRY, WIZARD_PROPOSE_TOOL];

// Tool-Map fuer schnellen Lookup beim Dispatch.
export const TOOL_MAP: Map<string, ToolDef> = new Map(TOOL_REGISTRY_FULL.map((t) => [t.name, t]));

// Promptinj-Mitigation B: pro Mode die erlaubten Tools.
export function allowedToolsForMode(mode: AssistMode): ToolDef[] {
  return TOOL_REGISTRY_FULL.filter((t) => t.allowedInModes.includes(mode));
}
