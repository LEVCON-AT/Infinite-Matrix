// Minimale DB-Typen fuer den Read-Only-Client. Erweitert sich nach Bedarf.
// Entspricht 1:1 den Tabellen aus infra/supabase/migrations/002_matrix_schema.sql.

export type Workspace = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
};

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

export type Membership = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
};

export type WorkspaceWithRole = Workspace & {
  role: WorkspaceRole;
  // Phase 1.A.4: Owner-Email per get_workspace_owners-RPC nachgeladen,
  // damit der WorkspaceSwitcher fuer fremde Workspaces "Owner: ..."
  // einblenden kann. Null wenn der Lookup nicht durchkam (offline oder
  // RPC fehlt).
  owner_email?: string | null;
};

export type NodeType = 'matrix' | 'board';

export type NodeRow = {
  id: string;
  workspace_id: string;
  type: NodeType;
  label: string;
  alias: string | null;
  parent_cell_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // NT.2: User der den Knoten angelegt hat. Per DEFAULT auth.uid()
  // automatisch gesetzt; NULL nach User-Delete (ON DELETE SET NULL)
  // oder bei Service-Role-Inserts ohne explicit-Param (Bridge).
  created_by: string | null;
};

export type CellRow = {
  id: string;
  workspace_id: string;
  matrix_id: string;
  row_id: string;
  col_id: string;
  alias: string | null;
  features: string[];
  child_matrix_id: string | null;
  board_id: string | null;
  data: Record<string, unknown>;
};

export type RowRow = {
  id: string;
  matrix_id: string;
  workspace_id: string;
  label: string;
  position: number;
};

export type ColRow = {
  id: string;
  matrix_id: string;
  workspace_id: string;
  label: string;
  position: number;
};

export type MatrixContent = {
  rows: RowRow[];
  cols: ColRow[];
  cells: CellRow[];
};

export type CellFeature = 'matrix' | 'board' | 'info' | 'checklists';

// Info-Feld auf einer Zelle. Lebt in cell.data.infoFields[].
// value ist plain text (newlines preserved); HTML-Rendering kommt spaeter
// mit sanitizeHtml-Port — fuer V0 reicht Textarea, kein XSS-Risiko.
export type InfoField = {
  id: string;
  label: string;
  value: string;
};

// URL-Link auf einer Zelle. Lebt in cell.data.links[].
// Bewusst OHNE Alias-Feld: cell-JSONB-Links koennen nicht am DB-Unique-
// Constraint der board-scoped links-Tabelle teilnehmen; Alias-Quicknav
// zu JSONB-Links wuerde einen Workspace-weiten Tree-Scan erfordern,
// was den aliasIndex-Pfad sprengt. Wird bei Bedarf nach einer Migration
// auf eine eigene Tabelle (cell_links) nachgeruestet.
export type InfoLink = {
  id: string;
  label: string;
  url: string;
};

// ─── Kanban ─────────────────────────────────────────────────────
export type KbColRow = {
  id: string;
  workspace_id: string;
  board_id: string;
  label: string;
  position: number;
  color: string | null;
};

// Inline-Checkliste auf einer Karte (kb_cards.checklist jsonb).
// Entspricht dem Item-Shape aus dem Alt-Client (V2.1: +level).
export type InlineChecklistItem = {
  id?: string;
  text: string;
  done: boolean;
  level?: 0 | 1 | 2;
};

// Wiederkehr-Konfiguration (kb_cards.recur jsonb, auch checklists.recur).
// Volle Parity mit HTML-Vorbild + recur.ts:RecurRule. Alle Zusatzfelder
// sind optional — pro type werden die passenden befuellt:
//  - daily:   every, startDate
//  - weekly:  every, startDate, weekdays[] (Mon=0..Sun=6)
//  - monthly: every, startDate, monthType='day' → day
//                               monthType='weekday' → weekday + weekdayOrd
//  - yearly:  every, startDate, yearMonth, monthType='day' → yearDay
//                                          monthType='weekday' → weekday + weekdayOrd
// + endType: 'never' | 'date' → endDate | 'count' → endCount
export type CardRecurType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export type CardRecur = {
  type: CardRecurType;
  every?: number;
  startDate?: string;
  // weekly: Array aus 0-6 (Mo=0..So=6). Legacy `weekday:number` bleibt
  // im Datum als Fallback — wird beim naechsten Edit auf weekdays[]
  // migriert.
  weekdays?: number[];
  weekday?: number; // legacy single
  // monthly/yearly: Wochentag-Modus braucht weekday + weekdayOrd
  //   ord = 1..4 (erster/zweiter/... Wochentag) oder -1 (letzter).
  monthType?: 'day' | 'weekday';
  weekdayOrd?: number;
  day?: number; // 1..31 fuer monthType='day'
  // yearly spezifisch:
  yearMonth?: number; // 0..11
  yearDay?: number; // 1..31
  anchorMonth?: number; // legacy
  anchorDay?: number; // legacy
  // End-Rules:
  endType?: 'never' | 'date' | 'count';
  endDate?: string;
  endCount?: number;
};

export type KbCardRow = {
  id: string;
  workspace_id: string;
  board_id: string;
  col_id: string;
  alias: string | null;
  name: string;
  note: string;
  tags: string[];
  who: string[];
  deadline: string | null;
  priority: number | null;
  done: boolean;
  archived: boolean;
  position: number;
  recur: Record<string, unknown> | null;
  done_occurrences: string[];
  source_cl_id: string | null;
  source_label: string | null;
  checklist_ref: string | null;
  checklist: InlineChecklistItem[] | null;
  color: string | null;
  created_at: string;
  updated_at: string;
};

export type ChecklistCloseMode = 'manual' | 'auto-prompt' | 'auto-silent';

// XOR-Invariante (DB-enforced): genau eines von board_id | cell_id ist gesetzt.
// Client-Code, der eine neue Checkliste anlegt, setzt entsprechend nur einen Parent.
// Snapshot-Eintrag fuer checklist.history. Wird beim Abschliessen
// einer Checkliste erzeugt — enthaelt eine vollstaendige Kopie des
// Item-Zustands zum Zeitpunkt des Closens.
export type ChecklistSnapshotItem = {
  text: string;
  done: boolean;
  level: 0 | 1 | 2;
};

export type ChecklistSnapshot = {
  closedAt: string; // ISO-Timestamp
  items: ChecklistSnapshotItem[];
};

export type ChecklistRow = {
  id: string;
  workspace_id: string;
  board_id: string | null;
  cell_id: string | null;
  label: string;
  position: number;
  recur: Record<string, unknown> | null;
  close_mode: ChecklistCloseMode;
  action: Record<string, unknown> | null;
  // History lebt als jsonb-Array im Row; pro Eintrag ein Snapshot im
  // Shape ChecklistSnapshot. Neueste Eintraege stehen vorne.
  history: ChecklistSnapshot[];
  alias: string | null;
  created_at: string;
  updated_at: string;
};

export type ChecklistItemRow = {
  id: string;
  workspace_id: string;
  checklist_id: string;
  text: string;
  done: boolean;
  level: 0 | 1 | 2;
  position: number;
};

export type LinkType = 'url' | 'mail';

export type LinkRow = {
  id: string;
  workspace_id: string;
  board_id: string;
  type: LinkType;
  label: string;
  url: string;
  alias: string | null;
  position: number;
  data: Record<string, unknown>;
  created_at: string;
};

export type BoardContent = {
  kbCols: KbColRow[];
  kbCards: KbCardRow[];
  checklists: ChecklistRow[];
  checklistItems: ChecklistItemRow[];
  links: LinkRow[];
};

// Checklisten einer einzelnen Zelle (cell_id=X, board_id=NULL).
// Wird lazy geladen, wenn der User den Checklist-Chip einer Zelle oeffnet.
export type CellChecklistsContent = {
  checklists: ChecklistRow[];
  checklistItems: ChecklistItemRow[];
};

// Hilfs-Shape fuer den Sidebar-Tree. Nodes werden nach parent_cell_id
// verschachtelt; die Zelle wiederum kennt ihre Matrix (= parent-Node).
// Seit SB.3 ist der Tree ein discriminated union: Matrix/Board-Nodes
// koennen Zellen-Eintraege als Kinder tragen, und Zellen-Eintraege
// enthalten die darunterliegenden Child-Nodes (sub-matrix, sub-board).
// Leere Zellen (keine Features) werden aus Rendering-Kosten ausgefiltert.
export type TreeEntry =
  | {
      kind: 'node';
      id: string;
      node: NodeRow;
      children: TreeEntry[];
    }
  | {
      kind: 'cell';
      id: string;
      cell: CellRow;
      rowLabel: string;
      colLabel: string;
      children: TreeEntry[];
    }
  | {
      // Feature-Row unter einer Cell. Nur fuer "flag"-Features, die
      // keinen eigenen Sub-Node haben: info + checklists. Die Row
      // repraesentiert die Feature-Page direkt.
      // Structural Features (matrix/board) bekommen KEINE eigene
      // Feature-Row — ihr Sub-Node haengt direkt unter der Cell,
      // weil die Zwischen-Row ein Klick zu viel waere.
      kind: 'feature';
      id: string; // `feat-<cellId>-<feature>` — stable fuer expanded-Set
      cellId: string;
      feature: 'info' | 'checklists';
      // V1 keine Kinder. SB.2-Chips koennen optional Docs/Links/Mails
      // darunter haengen (Chip-aktiviert, sonst [] bleibend).
      children: TreeEntry[];
    }
  | {
      // Link-Row unter einem Board-Node (LinkRow aus 'links' table) oder
      // unter einer Feature-'info'-Row (InfoLink aus cell.data.links).
      // Nur sichtbar wenn der passende Chip aktiv ist (Links bzw. Mails).
      kind: 'link';
      id: string; // `link-<source>-<linkId>` — stable fuer expanded-Set
      linkType: 'url' | 'mail';
      label: string;
      url: string;
      alias: string | null;
      children: TreeEntry[]; // Immer []; pro Struktur vorhanden.
    }
  | {
      // Doc-Row unter einer Cell oder Feature-info-Row. Nur sichtbar,
      // wenn der Docs-Chip aktiv ist.
      kind: 'doc';
      id: string; // `doc-<docId>` — stable fuer expanded-Set
      docId: string;
      title: string;
      alias: string | null;
      children: TreeEntry[]; // Immer [].
    };

// Backward-compat alias — legacy code spricht TreeNode, entspricht einem
// Top-Level node-Eintrag. Neu geschriebener Code nutzt TreeEntry.
export type TreeNode = Extract<TreeEntry, { kind: 'node' }>;

// ─── Dokumentation ─────────────────────────────────────────────
// Freischwebende Markdown-Light-Notiz pro Workspace. Optional mit
// eigenem Alias (→ Quicknav-Ziel), Source-Alias (Ursprung der Doku,
// z.B. Karte aus der heraus dokumentiert wurde) und attached_cell_id
// (Phase 2: Anzeige in Cell-Info/Checklisten-Bereich).
export type DocRow = {
  id: string;
  workspace_id: string;
  alias: string | null;
  title: string;
  content: string;
  source_alias: string | null;
  attached_cell_id: string | null;
  created_at: string;
  updated_at: string;
};

// ─── AI-Provider (Phase 2 Welle A.0) ───────────────────────────
// Pro User mehrere Provider, einer is_default. Der API-Key liegt at-
// rest verschluesselt in user_ai_providers.api_key_encrypted und ist
// fuer das Frontend NIE sichtbar — es liest die _safe-View, die die
// Spalte ausblendet. Mutations gehen ueber RPC, nicht direkt.
export type AiProviderKind = 'anthropic' | 'openai' | 'gemini';

export type AiProvider = {
  id: string;
  kind: AiProviderKind;
  label: string;
  model_name: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export type AiProviderInput = {
  id?: string; // undefined → INSERT, gesetzt → UPDATE
  kind: AiProviderKind;
  label: string;
  apiKey?: string; // undefined bei UPDATE ohne Key-Wechsel
  modelName?: string;
  setDefault?: boolean;
};
