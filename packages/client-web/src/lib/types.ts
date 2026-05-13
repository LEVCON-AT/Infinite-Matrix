// Minimale DB-Typen fuer den Read-Only-Client. Erweitert sich nach Bedarf.
// Entspricht 1:1 den Tabellen aus infra/supabase/migrations/002_matrix_schema.sql.

export type Workspace = {
  id: string;
  name: string;
  // Welle F.2 — optionale Beschreibung (max 500 chars). Migration 083.
  description: string | null;
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
  // Phase 3 O.8: Source-of-Truth fuer Display-Name. Plain rendert wie
  // label; mit {row.object}/{column.object} resolved der Client live.
  // label bleibt als Plain-Snapshot/Fallback erhalten.
  label_template: string;
  alias: string | null;
  parent_cell_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  // NT.2: User der den Knoten angelegt hat. Per DEFAULT auth.uid()
  // automatisch gesetzt; NULL nach User-Delete (ON DELETE SET NULL)
  // oder bei Service-Role-Inserts ohne explicit-Param (Bridge).
  created_by: string | null;
  // Phase 3 O.1: optional Object-Ref. Wenn gesetzt, ist der Knoten
  // selbst eine wiederverwendbare Identitaet (Power-User-Toggle).
  // Default null — Knoten ist nur Container.
  object_id?: string | null;
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
  // Phase 3 O.1: optional Object-Ref. Auto-Object kommt mit O.2.
  object_id?: string | null;
};

export type ColRow = {
  id: string;
  matrix_id: string;
  workspace_id: string;
  label: string;
  position: number;
  object_id?: string | null;
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
  // Phase 3 O.1: optional Object-Ref. kb_cards (Karten) bekommen
  // KEIN object_id — User-Architektur-Regel: Karten sind Pfad-Enden.
  object_id?: string | null;
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
  // Phase 3 O.8: Source-of-Truth fuer Display-Label. Plain rendert wie
  // label; mit {row.object}/{column.object} resolved der Client live.
  label_template: string;
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

// WV.B.2 — links-EXTENDED: type → provider. 15 Provider aus
// Konzept §12.3.2. Backward-compat-Alias `LinkType` exportiert
// die enge V1-Domain (url/mail) weiter, neue Code-Pfade nutzen
// `LinkProvider`.
export type LinkProvider =
  | 'url'
  | 'mail'
  | 'mail-generic'
  | 'onenote'
  | 'notion'
  | 'onedrive'
  | 'drive'
  | 'dropbox'
  | 'nextcloud'
  | 'slack'
  | 'teams'
  | 'whatsapp'
  | 'discord'
  | 'telegram'
  | 'filesystem';

// Backward-compat: Code-Pfade die vor WV.B nur 'url'|'mail' kannten.
// Neuer Code nutzt LinkProvider.
export type LinkType = 'url' | 'mail';

export type LinkRow = {
  id: string;
  workspace_id: string;
  board_id: string;
  // WV.B.2: provider statt type. Migration 073 hat type-Spalte
  // gedroppt + provider mit CHECK auf 15 Werte hinzugefuegt.
  provider: LinkProvider;
  // WV.B.2: Provider-spezifische Metadaten (z.B. {channel_id} bei slack,
  // {notebook_id, section_id, page_id} bei onenote).
  provider_meta: Record<string, unknown>;
  // WV.B.6 Symbol-System: User-Override gegenueber Auto-Symbol.
  // NULL = Auto-Logik aus lib/symbol-resolution.ts.
  symbol_override: string | null;
  // WV.B.2: Click-Counter fuer „beliebte Links"-Sortierung.
  // Inkrement via mcp_increment_link_click_count RPC.
  click_count: number;
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
      // §12.3 Symbol-System — provider + symbolOverride fuer
      // Provider-distinct Icon-Render via lib/symbol-resolution.ts.
      // Optional fuer Backward-Compat: legacy linkEntryFromInfoLink
      // (cell.data.links jsonb) kennt sie nicht und faellt auf
      // linkType-basiertes Fallback zurueck.
      provider?: LinkProvider;
      symbolOverride?: string | null;
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
  // Phase 3 O.8: Source-of-Truth fuer Display-Title. Plain rendert wie
  // title; mit {row.object}/{column.object} resolved der Client live.
  title_template: string;
  // Welle D: HTML statt Markdown. ProseMirror-Output, dompurify-sanitized.
  content: string;
  source_alias: string | null;
  created_at: string;
  updated_at: string;
};

// ─── Welle D — Tag-System ─────────────────────────────────────
// (Atom-Pins sind seit WV.WV.1 in atom_manifestations(kind='pinned')
// konsolidiert — siehe lib/atom-manifestations.ts AtomContainerKind +
// createAtomPin/deleteAtomPin/moveAtomPin/pinDocWithCreate.)
//
// Vier Tag-Kinds:
// - freetext: User tippt `#design`, value = canonical-string.
// - atom_ref: Tag verweist auf konkretes Atom, value = atom_id::text,
//             display_label = title-Snapshot.
// - object_ref: Tag verweist auf Cell/Node, value = `${kind}:${id}`,
//               display_label = alias-or-label-Snapshot.
// - alias_ref: User tippt `^kuerzel`, value = canonical-alias-string,
//              display_label = `^kuerzel` Snapshot, Live-Resolve gegen
//              alias-index zur Anzeige (mit Stale-Indicator-Fallback).
export type TagKind = 'freetext' | 'atom_ref' | 'object_ref' | 'alias_ref';

export type WorkspaceTag = {
  id: string;
  workspace_id: string;
  kind: TagKind;
  value: string;
  display_label: string | null;
  usage_count: number;
  created_at: string;
};

export type AtomTag = {
  id: string;
  // WV.B.1 erweitert um 'info_field' (atom_type-ENUM Migration 072).
  atom_type: 'task' | 'link' | 'doc' | 'checklist' | 'imported_event' | 'info_field';
  atom_id: string;
  workspace_id: string;
  tag_id: string;
  position: number;
  created_at: string;
};

// AtomTag mit gejointen workspace_tags-Feldern. Was die Pin-Render-Pfade
// (TagPills) wirklich brauchen: Title + Kind. RPC-Returns liefern das
// gebundled — beim Read aus IDB-Cache muessen wir es selbst joinen.
export type AtomTagWithTag = AtomTag & {
  tag_kind: TagKind;
  tag_value: string;
  tag_display_label: string | null;
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

// ─── Object-Layer (Phase 3 Welle O.1) ─────────────────────────
// Globale Identities pro Workspace. Zeilen / Spalten / kb_cols /
// (optional) nodes referenzieren ueber object_id auf einen
// ObjectRow-Eintrag. Cells und kb_cards bleiben Pfad-Enden ohne
// object_id (User-Architektur-Regel 2026-04-29).
//
// Auto-Anlage + Suggestion-UI kommt mit O.2. O.1 ist nur Schema +
// leere Helper. Die Typen sind hier vorbereitet damit nachfolgende
// Wellen ohne Type-Refactor weiterbauen koennen.

export type ObjectHomeRefKind = 'row' | 'col' | 'kb_col' | 'node' | 'standalone';

export type ObjectRow = {
  id: string;
  workspace_id: string;
  label: string;
  alias: string | null; // ohne ^o.-Prefix gespeichert; UI rendert mit Prefix
  type_label: string | null; // frei, optional
  parent_id: string | null; // Self-FK fuer Hierarchie
  attrs: Record<string, unknown>;
  home_ref_kind: ObjectHomeRefKind | null;
  home_ref_id: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
};

export type ObjectInput = {
  label: string;
  alias?: string | null;
  type_label?: string | null;
  parent_id?: string | null;
  attrs?: Record<string, unknown>;
  home_ref_kind?: ObjectHomeRefKind;
  home_ref_id?: string;
};

export type ObjectTagRow = {
  object_id: string;
  tag_object_id: string;
  workspace_id: string;
  created_at: string;
};

export type GroupRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
};

export type GroupMemberRow = {
  group_id: string;
  object_id: string;
  workspace_id: string;
  created_at: string;
};

export type SoftGroupRow = {
  id: string;
  workspace_id: string;
  name: string;
  source_node_id: string | null;
  promoted_to: string | null; // groups.id wenn promoted
  created_at: string;
  last_used_at: string;
  created_by: string | null;
};

export type SoftGroupMemberRow = {
  soft_group_id: string;
  object_id: string;
  workspace_id: string;
};

// ─── Task-Layer Types (Phase 4 T.1 + Q.2 consolidation) ────────────
// ECS-Architektur: tasks (Layer 0 = Aggregate Root) + atom_manifestations
// (Layer 1 = "wo erscheint die Task / das Atom"). Q.2 hat die alte
// task_manifestations-Tabelle aufgeloest — Manifestations leben jetzt
// polymorph in atom_manifestations mit `atom_type` als Diskriminator.
// Task-spezifische Reads filtern auf `atom_type='task'`.

export type TaskStatus = 'open' | 'in_progress' | 'blocked' | 'done' | 'archived';

export type TaskManifestationKind = 'kanban' | 'checklist' | 'calendar' | 'standalone';

// recur teilt sich mit kb_cards die Struktur (CardRecur). Identisches
// Format laesst T.1.B-Datenmigration die JSONB-Spalte 1:1 uebernehmen.
export type TaskRecur = CardRecur;

export type TaskRow = {
  id: string;
  workspace_id: string;
  label: string;
  note: string | null;
  status: TaskStatus;
  deadline: string | null; // date as ISO 'YYYY-MM-DD'
  who: string[];
  recur: TaskRecur | null;
  done_occurrences: string[]; // date[] als ISO 'YYYY-MM-DD'
  attrs: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  // Welle I: Task wurde aus einem importierten External-Event abgeleitet.
  // Bei derive_sync_mode='live' propagiert der Sync-Worker Updates des
  // Events (label/deadline/recur/note) auf die Task — ausser die Spalte
  // ist in local_overrides als true markiert (User-Edit gewinnt).
  derived_from_external_event_id?: string | null;
  derive_sync_mode?: 'snapshot' | 'live' | null;
  derive_scope?: 'instance' | 'series' | null;
  local_overrides?: Record<string, boolean>;
};

export type TaskInput = {
  label: string;
  note?: string;
  status?: TaskStatus;
  deadline?: string | null;
  who?: string[];
  recur?: TaskRecur | null;
  attrs?: Record<string, unknown>;
};

// Q.2: TaskManifestationRow ist jetzt eine getypte Sicht auf
// atom_manifestations mit atom_type='task'. Die ID-Spalte heisst in der
// DB `atom_id` — Caller die einen Task-Bezug brauchen, nutzen die
// Spalte mit demselben Namen. Field-Renames entlang der 30 Zugriffs-
// stellen wurden mit dem Q.2-Sweep angepasst.
export type TaskManifestationRow = {
  id: string;
  atom_type: 'task';
  atom_id: string; // ehemals task_id; verweist nach wie vor auf tasks.id
  workspace_id: string;
  kind: TaskManifestationKind;
  container_id: string | null; // kb_cols.id / checklists.id / null bei calendar/standalone
  position: number;
  level: number | null; // nur bei kind='checklist' (0/1/2)
  display_meta: Record<string, unknown>;
  created_at: string;
};

export type TaskManifestationInput = {
  atom_id: string; // tasks.id
  kind: TaskManifestationKind;
  container_id?: string | null;
  position?: number;
  level?: number | null;
  display_meta?: Record<string, unknown>;
};

// ─── Welle I — Calendar Inbound ────────────────────────────────
// Externe Kalender (Gmail/Outlook/Apple/Nextcloud/CalDAV-Subscribe +
// optional OAuth) werden in das Matrix-System gespiegelt. Storage-
// Pattern wie ai-providers (pgcrypto fuer Tokens), Atom-Zwiebel-Treue
// via atom_type='imported_event' + Mirror-Trigger (Migration 059).

export type ExternalCalendarKind = 'ics_subscribe' | 'google' | 'microsoft' | 'upload';
export type ExternalCalendarSyncStatus = 'idle' | 'syncing' | 'error';

export type ExternalCalendar = {
  id: string;
  user_id: string;
  workspace_id: string;
  kind: ExternalCalendarKind;
  label: string;
  source_url: string | null;
  // Ohne oauth_token-Felder — die existieren nur bytea-encrypted in der
  // DB, das Frontend bekommt sie nie. Service-Helper holt bei Bedarf
  // ueber get_external_calendar_credentials.
  oauth_expires_at: string | null;
  webhook_channel_id: string | null;
  webhook_resource_id: string | null;
  webhook_expires_at: string | null;
  sync_status: ExternalCalendarSyncStatus;
  sync_interval_minutes: number;
  last_sync_at: string | null;
  last_error_msg: string | null;
  color: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type ExternalEventSyncState = 'active' | 'cancelled' | 'orphaned';

export type ExternalEvent = {
  id: string;
  external_calendar_id: string;
  workspace_id: string;
  external_id: string;
  summary: string;
  description: string | null;
  location: string | null;
  url: string | null;
  start_at: string; // ISO timestamp
  end_at: string | null;
  all_day: boolean;
  rrule: string | null;
  recurrence_id: string | null;
  source_provider: ExternalCalendarKind;
  source_modified_at: string | null;
  sync_state: ExternalEventSyncState;
  last_synced_at: string;
  created_at: string;
  updated_at: string;
};

// Bei Task-Ableitung aus External-Event: User-waehlbare Modi.
export type DeriveSyncMode = 'snapshot' | 'live';
export type DeriveScope = 'instance' | 'series';

// ─── Welle WV.A — Vorlagen-Foundation (Migration 067) ──────────
// Drei Tabellen aus dem Widget+Vorlagen-Konzept §6.2:
// feature_templates + template_sections + template_widgets.
// Visibility-Modell (Konzept §6.1): platform / workspace / user.

export type TemplateVisibility = 'platform' | 'workspace' | 'user';

export type TemplateRenderPosition = 'hotkey_slot' | 'auto_under_features';

// 7 Widget-Types aus dem Konzept §6.5/§7. Re-Export aus
// lib/widget-picker.ts (WidgetType) — Single-Source dort.
// Hier nur Zeichen-konstanten als Subset wiederholt fuer Row-Type.
export type TemplateWidgetType =
  | 'kanban'
  | 'checklist'
  | 'info'
  | 'doc'
  | 'link'
  | 'calendar'
  | 'smart_summary'
  // Welle WV.D.3.g — Channel-Bridge-Widget (Mail/Chat). Provider +
  // external_ref leben in widget_external_channels (Migration 077).
  | 'channel'
  // Welle WV.D.5.a — Drive-Bridge-Widget (File-Pick). Provider +
  // external_ref.folder_id leben in widget_external_channels.
  | 'drive';

export type TemplateSectionVisibility = 'always' | 'edit_only';

export type FeatureTemplateRow = {
  id: string;
  // workspace_id NULL = Plattform-Vorlage. workspace_id SET +
  // owner_user_id NULL = Workspace-shared. Beide SET = User-privat.
  workspace_id: string | null;
  owner_user_id: string | null;
  name: string;
  symbol: string | null;
  symbol_color: string | null;
  // Default-Hint fuer den Hotkey-Slot. Effektive Slot-Belegung pro
  // Workspace lebt in workspace_hotkey_slots (WV.A.3).
  hotkey_slot: number | null;
  is_global: boolean;
  visibility: TemplateVisibility;
  layout_version: number;
  title_template: string | null;
  // Default-Drop-Target fuer Atomic-Drop (§9.10). DEFERRABLE FK auf
  // template_widgets.id — kann NULL sein bei Vorlagen ohne klares
  // Root (z.B. Smart Summary), dann zeigt WidgetPicker alle Slots.
  root_widget_id: string | null;
  render_position: TemplateRenderPosition;
  config: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
  updated_at: string;
};

// workspace_id denormalisiert (Trigger pflegt aus parent template) —
// NULL bei Plattform-Vorlagen, sonst = parent.workspace_id.
export type TemplateSectionRow = {
  id: string;
  template_id: string;
  workspace_id: string | null;
  position: number;
  title: string | null;
  default_collapsed: boolean;
  visibility: TemplateSectionVisibility;
  created_at: string;
};

// WV.A.2 — Cell ↔ Vorlage-Junction (Migration 068).
// Multi-Vorlagen pro Cell: mehrere Rows mit unterschiedlichen
// template_id. layout_version pinned beim Apply, Update-Hint
// vergleicht gegen feature_templates.layout_version (Konzept §6.5).
export type CellTemplateInstanceRow = {
  id: string;
  cell_id: string;
  template_id: string;
  workspace_id: string;
  layout_version: number;
  applied_at: string;
  applied_by: string | null;
};

// Sparse-Override: enthaelt nur die Felder, die der User explizit
// veraendert hat. JSON-Patch auf template_widgets.data. Reset-to-
// Template via DELETE der Row (Konzept §6.5).
export type CellWidgetOverrideRow = {
  id: string;
  instance_id: string;
  widget_id: string;
  workspace_id: string;
  override_data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

// WV.A.3 — Hotkey-Slot-Belegung 1-9 (Migration 069). Owner setzt
// pro Workspace, jeder User kann fuer den eigenen Account
// uebersteuern.
export type WorkspaceHotkeySlotRow = {
  id: string;
  workspace_id: string;
  slot: number;
  template_id: string;
  set_by: string | null;
  set_at: string;
};

export type UserHotkeySlotRow = {
  id: string;
  user_id: string;
  workspace_id: string;
  slot: number;
  template_id: string;
  set_at: string;
};

// WV.B.1 — Info-Felder (Migration 072). 6. Atom-Type. value_type
// CHECK ueber 10 Werte aus Konzept §12.1.
export type InfoFieldValueType =
  | 'text'
  | 'number'
  | 'date'
  | 'currency'
  | 'boolean'
  | 'email'
  | 'phone'
  | 'url'
  | 'enum'
  | 'alias-ref';

export type InfoFieldRow = {
  id: string;
  workspace_id: string;
  label: string;
  value: string | null;
  value_type: InfoFieldValueType;
  // value_meta: typed Erweiterungen (z.B. {min,max,step,unit} bei number).
  value_meta: Record<string, unknown>;
  // WV.B.6 Symbol-System: User-Override fuer Auto-Symbol. NULL = Auto.
  symbol_override: string | null;
  created_at: string;
  updated_at: string;
};

// WV.B.3 — Atom-Markers (Migration 074). Polymorphe User-Markierungen.
// kind=star Workspace-shared, kind=eye User-privat (RLS).
export type AtomMarkerKind = 'star' | 'eye';

export type AtomMarkerRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  kind: AtomMarkerKind;
  // Polymorphe Atom-Referenz — atom_type bestimmt Source-Tabelle.
  atom_type: 'task' | 'link' | 'doc' | 'checklist' | 'imported_event' | 'info_field';
  atom_id: string;
  created_at: string;
};

// WV.A.4 — Saved-Filter (Migration 070). body folgt
// SavedFilterBody aus lib/atom-filter-attrs.ts. owner_user_id NULL =
// Workspace-shared, sonst User-privat.
export type SavedFilterRow = {
  id: string;
  workspace_id: string;
  owner_user_id: string | null;
  name: string;
  atom_kind: 'task' | 'link' | 'doc' | 'checklist' | 'imported_event' | 'info_field';
  // jsonb-Body — Caller dekodiert via isSavedFilterBody aus
  // lib/atom-filter-attrs.ts (defensiver Decoder).
  body: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

// workspace_id denormalisiert wie TemplateSectionRow — Trigger pflegt
// aus section.workspace_id automatisch.
export type TemplateWidgetRow = {
  id: string;
  section_id: string;
  workspace_id: string | null;
  // 1-basierter Spalten-Index im 12-Col-Grid (Konzept §7.1 — Grid-Foundation).
  column: number;
  position: number;
  type: TemplateWidgetType;
  // size_cols 1-12, size_rows 1-24 — Layout-Grid-Dimensionen.
  size_cols: number;
  size_rows: number;
  // data: typabhaengiges Widget-Schema (Konzept §6.5 + §7).
  data: Record<string, unknown>;
  // toggles: User-Switches pro Widget (z.B. show-completed,
  // group-by, sort-mode).
  toggles: Record<string, unknown>;
  // config: technische Render-Optionen (z.B. caching, channel-bridge-ref).
  config: Record<string, unknown>;
  created_at: string;
};

// ─── Welle WV.D — Channel-Bridges (Migration 077 + 078) ────────
// Konzept §13 + plan-welle-d.md.

export type ChannelProvider =
  | 'outlook'
  | 'gmail'
  | 'mail-generic'
  | 'onenote'
  | 'onedrive'
  | 'drive'
  | 'dropbox'
  | 'nextcloud'
  | 'slack'
  | 'teams'
  | 'discord'
  | 'whatsapp'
  | 'telegram';

// Frontend liest user_oauth_tokens IMMER ueber die Safe-View (ohne
// *_encrypted-Spalten). Plaintext landet nur Bridge-side via
// get_oauth_token_decrypted-RPC.
export type UserOAuthTokenSafe = {
  id: string;
  user_id: string;
  provider: ChannelProvider;
  expires_at: string | null;
  scopes: string[] | null;
  has_refresh_token: boolean;
  has_generic_credentials: boolean;
  created_at: string;
  updated_at: string;
};

// Status-Werte aus oauth_provider_slots_status_chk.
export type OAuthProviderSlotStatus =
  | 'fehlt' // weder Client-ID noch Secret konfiguriert
  | 'konfiguriert' // Client-ID + Secret gesetzt, noch nicht verifiziert
  | 'verifiziert' // Test-Connect erfolgreich
  | 'ungueltig'; // Test-Fail (Message in status_message)

export type OAuthProviderSlotSafe = {
  id: string;
  provider: ChannelProvider;
  client_id: string;
  auth_url: string | null;
  token_url: string | null;
  scopes_default: string[] | null;
  extra_config: Record<string, unknown>;
  status: OAuthProviderSlotStatus;
  status_checked_at: string | null;
  status_message: string | null;
  has_client_secret: boolean;
  created_at: string;
  updated_at: string;
};

export type WidgetExternalChannelRow = {
  id: string;
  widget_id: string;
  workspace_id: string;
  provider: ChannelProvider;
  external_ref: Record<string, unknown>;
  created_at: string;
};

// Mail-generic-Credentials-Format (verschluesselt als JSON).
export type GenericMailCredentials = {
  imap_host: string;
  imap_port?: number;
  smtp_host: string;
  smtp_port?: number;
  username: string;
  app_password: string;
};
