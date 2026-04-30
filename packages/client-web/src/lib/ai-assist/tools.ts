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

  // ─── Object-Layer (Phase 3 / Migrations 033-035) ──────────────
  // AU-B1 K11c.3 (B1-G-005 / CC2): Schema-Quad-Vervollstaendigung —
  // Bridge-Tools fuer Object-Layer waren bisher nicht verfuegbar.
  // KI konnte First-Class-Entities nicht ansprechen (mcp_create_object,
  // mcp_search_objects etc.).
  {
    name: 'mcp_search_objects',
    description:
      'Trigram-Fuzzy-Suche ueber objects.label. Gibt {object_id, label, alias, type_label, parent_id, similarity} zurueck. Default-Limit 8, max 50.',
    inputSchema: {
      type: 'object',
      properties: {
        p_workspace_id: UUID,
        p_query: { type: 'string', description: 'Such-String, min 2 Zeichen.' },
        p_limit: { type: 'number', description: 'Max Treffer (1-50). Default 8.' },
      },
      required: ['p_workspace_id', 'p_query'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help', 'cell-suggest'],
  },
  {
    name: 'mcp_create_object',
    description:
      'Legt ein neues First-Class-Object an (z.B. Person, Projekt, Tag). Gibt {object_id, workspace_id, label, alias} zurueck. Optional: type_label (Klassifizierung), parent_id (Hierarchie), home_ref_kind/id (initialer Anker).',
    inputSchema: {
      type: 'object',
      properties: {
        p_workspace_id: UUID,
        p_label: { type: 'string', description: 'Anzeige-Name, max 200 Zeichen.' },
        p_alias: NULLABLE_UUID,
        p_type_label: {
          type: ['string', 'null'],
          description: 'Optional: Typ-Klassifizierung (z.B. "Person", "Projekt").',
        },
        p_parent_id: NULLABLE_UUID,
        p_attrs: {
          type: 'object',
          description: 'Optional: typ-spezifische Attribute als JSON.',
        },
        p_home_ref_kind: {
          type: ['string', 'null'],
          enum: ['row', 'col', 'kb_col', 'node', null],
          description: 'Optional: Anker-Typ. NULL = standalone Object.',
        },
        p_home_ref_id: NULLABLE_UUID,
      },
      required: ['p_workspace_id', 'p_label'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help', 'cell-suggest'],
  },
  {
    name: 'mcp_update_object',
    description: 'Aktualisiert Label/Alias/Type-Label/Attrs eines Objects.',
    inputSchema: {
      type: 'object',
      properties: {
        p_object_id: UUID,
        p_label: { type: ['string', 'null'], description: 'Neuer Name oder NULL.' },
        p_alias: NULLABLE_UUID,
        p_type_label: { type: ['string', 'null'] },
        p_attrs: { type: ['object', 'null'] },
      },
      required: ['p_object_id'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help'],
  },
  {
    name: 'mcp_set_object_parent',
    description: 'Setzt parent_id eines Objects (Hierarchie). NULL = Top-Level.',
    inputSchema: {
      type: 'object',
      properties: {
        p_object_id: UUID,
        p_parent_id: NULLABLE_UUID,
      },
      required: ['p_object_id', 'p_parent_id'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help'],
  },
  {
    name: 'mcp_set_object_home_ref',
    description:
      'Setzt den Home-Anker eines Objects (row/col/kb_col/node). Backfill-Pfad nach Auto-Anlage.',
    inputSchema: {
      type: 'object',
      properties: {
        p_object_id: UUID,
        p_home_ref_kind: {
          type: 'string',
          enum: ['row', 'col', 'kb_col', 'node'],
          description: 'Anker-Typ.',
        },
        p_home_ref_id: UUID,
      },
      required: ['p_object_id', 'p_home_ref_kind', 'p_home_ref_id'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help'],
  },
  {
    name: 'mcp_add_object_tag',
    description: 'Fuegt einen Tag-Pfeil hinzu (object_id → tag_object_id, M:N).',
    inputSchema: {
      type: 'object',
      properties: {
        p_object_id: UUID,
        p_tag_object_id: UUID,
      },
      required: ['p_object_id', 'p_tag_object_id'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help'],
  },
  {
    name: 'mcp_remove_object_tag',
    description: 'Entfernt einen Tag-Pfeil.',
    inputSchema: {
      type: 'object',
      properties: {
        p_object_id: UUID,
        p_tag_object_id: UUID,
      },
      required: ['p_object_id', 'p_tag_object_id'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help'],
  },
  {
    name: 'mcp_delete_object',
    description:
      'Loescht ein Object. Backlinks (rows/cols/kb_cols.object_id) werden DB-seitig auf NULL gesetzt — Tags werden cascadiert geloescht. Nicht trivial wiederherstellbar.',
    inputSchema: {
      type: 'object',
      properties: {
        p_object_id: UUID,
      },
      required: ['p_object_id'],
    },
    riskLevel: 'destructive',
    allowedInModes: ['help'],
  },

  // ─── Groups (Migration 034) ──────────────────────────────────
  {
    name: 'mcp_create_group',
    description:
      'Legt eine neue Gruppe an (workspace-scoped Container fuer Objects). Optional initial members.',
    inputSchema: {
      type: 'object',
      properties: {
        p_workspace_id: UUID,
        p_name: { type: 'string', description: 'Gruppen-Name, max 200 Zeichen.' },
        p_description: { type: ['string', 'null'] },
        p_initial_member_ids: {
          type: ['array', 'null'],
          items: { type: 'string' },
          description: 'Optional: Object-IDs als initiale Mitglieder.',
        },
      },
      required: ['p_workspace_id', 'p_name'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help'],
  },
  {
    name: 'mcp_add_group_members',
    description: 'Fuegt Object-IDs einer Gruppe hinzu. Gibt {added: number} zurueck.',
    inputSchema: {
      type: 'object',
      properties: {
        p_group_id: UUID,
        p_object_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Object-IDs zum Hinzufuegen.',
        },
      },
      required: ['p_group_id', 'p_object_ids'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help'],
  },
  {
    name: 'mcp_remove_group_members',
    description: 'Entfernt Object-IDs aus einer Gruppe. Gibt {removed: number} zurueck.',
    inputSchema: {
      type: 'object',
      properties: {
        p_group_id: UUID,
        p_object_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Object-IDs zum Entfernen.',
        },
      },
      required: ['p_group_id', 'p_object_ids'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help'],
  },
  {
    name: 'mcp_rename_group',
    description: 'Benennt eine Gruppe um.',
    inputSchema: {
      type: 'object',
      properties: {
        p_group_id: UUID,
        p_new_name: { type: 'string', description: 'Neuer Gruppen-Name.' },
      },
      required: ['p_group_id', 'p_new_name'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help'],
  },
  {
    name: 'mcp_delete_group',
    description:
      'Loescht eine Gruppe inkl. aller Memberships. Die Member-Objects bleiben erhalten.',
    inputSchema: {
      type: 'object',
      properties: {
        p_group_id: UUID,
      },
      required: ['p_group_id'],
    },
    riskLevel: 'destructive',
    allowedInModes: ['help'],
  },

  // ─── Task-Layer (Phase 4 / Migration 043) ─────────────────────
  // Layer 0 + Layer 1 fuer den ECS-Task-Layer. mcp_add_manifestation
  // ist der Cross-Cut: dieselbe Task in mehreren Sichten (Kanban,
  // Checklist, Calendar, Standalone).
  {
    name: 'mcp_search_tasks',
    description:
      'Trigram-Fuzzy-Suche ueber tasks.label im Workspace. Optional Filter status (Array) und deadline-Range. Default-Limit 8, max 50. Liefert {id, label, status, deadline, similarity}.',
    inputSchema: {
      type: 'object',
      properties: {
        p_workspace_id: UUID,
        p_query: {
          type: 'string',
          description: 'Such-String (kann leer sein → Top-N nach updated_at).',
        },
        p_status: {
          type: ['array', 'null'],
          items: {
            type: 'string',
            enum: ['open', 'in_progress', 'blocked', 'done', 'archived'],
          },
          description: 'Optional: nur Tasks mit Status aus dieser Liste.',
        },
        p_deadline_from: {
          type: ['string', 'null'],
          description: 'Optional: deadline >= diesem Datum (YYYY-MM-DD).',
        },
        p_deadline_to: {
          type: ['string', 'null'],
          description: 'Optional: deadline <= diesem Datum (YYYY-MM-DD).',
        },
        p_limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Max Treffer. Default 8.',
        },
      },
      required: ['p_workspace_id', 'p_query'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help', 'cell-suggest'],
  },
  {
    name: 'mcp_create_task',
    description:
      'Legt ein neues Task-Atom (Layer 0) an. Status default "open". Note max 5000 Zeichen. Liefert {task_id, label, status, deadline}. Eine Task ohne Manifestation ist sichtbar, aber „heimatlos" — meist direkt ein mcp_add_manifestation hinterher.',
    inputSchema: {
      type: 'object',
      properties: {
        p_workspace_id: UUID,
        p_label: { type: 'string', description: 'Anzeige-Name, max 200 Zeichen.' },
        p_note: {
          type: ['string', 'null'],
          description: 'Optional: Beschreibung, max 5000 Zeichen.',
        },
        p_status: {
          type: ['string', 'null'],
          enum: ['open', 'in_progress', 'blocked', 'done', 'archived', null],
          description: 'Status. Default "open".',
        },
        p_deadline: {
          type: ['string', 'null'],
          description: 'Optional: Deadline als YYYY-MM-DD.',
        },
        p_who: {
          type: ['array', 'null'],
          items: { type: 'string' },
          description: 'Optional: zustaendige Personen (Frei-Text, V1).',
        },
      },
      required: ['p_workspace_id', 'p_label'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help', 'cell-suggest'],
  },
  {
    name: 'mcp_update_task',
    description:
      'Patcht ein Task-Atom. Pro Feld ein p_set_*-Flag — nur wenn true wird der entsprechende Wert geschrieben (sonst bleibt der alte). Erlaubte Felder: label, note, status, deadline.',
    inputSchema: {
      type: 'object',
      properties: {
        p_task_id: UUID,
        p_label: { type: ['string', 'null'] },
        p_set_label: { type: 'boolean', description: 'true = label uebernehmen.' },
        p_note: { type: ['string', 'null'] },
        p_set_note: { type: 'boolean', description: 'true = note uebernehmen.' },
        p_status: {
          type: ['string', 'null'],
          enum: ['open', 'in_progress', 'blocked', 'done', 'archived', null],
        },
        p_set_status: { type: 'boolean', description: 'true = status uebernehmen.' },
        p_deadline: { type: ['string', 'null'], description: 'YYYY-MM-DD oder null.' },
        p_set_deadline: { type: 'boolean', description: 'true = deadline uebernehmen.' },
      },
      required: ['p_task_id'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help'],
  },
  {
    name: 'mcp_add_manifestation',
    description:
      'Fuegt einer existierenden Task eine zusaetzliche Sicht hinzu — der ECS-Cross-Cut. kind ∈ {kanban, checklist, calendar, standalone}. Bei kanban/checklist ist container_id Pflicht (kb_cols.id bzw. checklists.id). Bei calendar optional (display_meta haelt date/time). Liefert {manifestation_id, task_id, kind, container_id, position}.',
    inputSchema: {
      type: 'object',
      properties: {
        p_task_id: UUID,
        p_kind: {
          type: 'string',
          enum: ['kanban', 'checklist', 'calendar', 'standalone'],
          description: 'Art der Sicht.',
        },
        p_container_id: {
          ...NULLABLE_UUID,
          description:
            'Container-ID (kb_cols.id fuer kanban, checklists.id fuer checklist, optional fuer calendar).',
        },
        p_position: {
          type: ['number', 'null'],
          description: 'Optional: Position im Container. Default = max + 1.',
        },
        p_level: {
          type: ['integer', 'null'],
          minimum: 0,
          maximum: 2,
          description: 'Optional: Einrueckungs-Level (nur kind=checklist).',
        },
        p_display_meta: {
          type: ['object', 'null'],
          description:
            'Kind-spezifische Felder (z.B. {start_date, end_date, time, duration_min} bei calendar).',
        },
      },
      required: ['p_task_id', 'p_kind'],
    },
    riskLevel: 'safe',
    allowedInModes: ['help', 'cell-suggest'],
  },
];

// ─── Wizard-only: Preview-Pattern (Mitigation H) ───────────────
// wizard_propose_structure ist KEIN echtes RPC — der Dispatcher in
// index.ts faengt es ab und reicht die args als data zurueck. Der
// LLM gibt seinen Vorschlag als Tool-Use-Args (strukturiert),
// statt JSON in Text zu bauen. Apply-Schleife in lib/wizard-apply.ts
// iteriert die args und ruft die echten mcp_create_*-RPCs.
//
// Tiefen-Limit: 1-3 Top-Level-Knoten, max 6 children pro Node, je
// Cell max 2 Checklisten mit max 6 Items. Begrenzt LLM-Token-Burn
// und Apply-Loop-Laufzeit (Mitigation D).
//
// Children koennen vom User in der Preview per Checkbox einzeln
// (de-)aktiviert werden — Apply nimmt nur die selektierten.
export const WIZARD_PROPOSE_TOOL_NAME = 'wizard_propose_structure';

const WIZARD_PROPOSE_TOOL: ToolDef = {
  name: WIZARD_PROPOSE_TOOL_NAME,
  description:
    'Liefert einen STRUKTURIERTEN Workspace-Vorschlag fuer den Onboarding-Wizard. Wird NICHT direkt ausgefuehrt — der User sieht eine Vorschau, kann einzelne Eintraege an-/abwaehlen und entscheidet manuell. Rufe dieses Tool GENAU EINMAL und beende dann den Turn ohne weiteren Tool-Call.',
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
          'Top-Level-Knoten des Workspaces. 1-3 Eintraege — kein Spam, lieber wenige starke Vorschlaege.',
        minItems: 1,
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
                'Eintraege INNERHALB des Knotens. Bei type=matrix: Zellen (cell_label) mit optional checklists. Bei type=board: Karten (card_name) mit optional note. Max 6 Eintraege pro Knoten.',
              maxItems: 6,
              items: {
                type: 'object',
                properties: {
                  cell_label: {
                    type: ['string', 'null'],
                    description:
                      'Bei matrix-Parent: Label fuer eine Cell. Bei board-Parent: nicht setzen (null).',
                  },
                  card_name: {
                    type: ['string', 'null'],
                    description:
                      'Bei board-Parent: Name fuer eine Karte. Bei matrix-Parent: nicht setzen (null).',
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
