// WV.Y — Atom-Filter-Attribute Single-Source.
//
// Audit-Ergebnis-Datei: deklariert pro AtomKind die filterbaren
// Attribute mit Field-Type, Source-Spalte und erlaubten Operatoren.
// Ohne diese Single-Source entsteht Doublet-Drift, sobald mehrere
// Caller (Filter-Builder, saved_filters, BoardView-FilterBox,
// Search-Result-Filter, MCP-Tools) eigene Attribute-Listen halten.
//
// Welle-A-Konsumenten:
//   - `FilterBuilderModal` (R-WV-11): rendert pro AtomKind die
//     erlaubten Felder + Operatoren als UI; konsumiert `attrsFor()`.
//   - `saved_filters`-Tabelle (Welle A vorgezogen): persistiert
//     SavedFilter-Records — Storage-Shape ist hier definiert.
//   - `evaluateAtomFilter()` (Welle A): Pure-Function-Evaluator,
//     nimmt Atom + SavedFilter und liefert boolean. Wir liefern
//     hier nur Schema + Source-Pointer; der Evaluator selbst lebt
//     in Welle A wenn die UI-Wiring konkret wird.
//   - MCP-Tool `atoms.filter` (Welle A optional): nimmt
//     SavedFilter-JSON, gibt Atom-IDs zurueck.
//
// Konvention:
//   - Attribute-Keys sind stabile IDs (z.B. 'deadline', 'tags',
//     'status'). Werden in saved_filters.conditions persistiert
//     und im UI als i18n-Key benutzt — Rename ist Schema-Migration.
//   - `source` zeigt auf den Read-Pfad: 'column' (top-level Spalte)
//     oder 'attrs' (jsonb-Pfad). Spalten-Renames in den Source-
//     Tabellen ziehen Update hier nach sich (Schema-Quad-Pflicht).
//   - Operator-Listen sind whitelist-streng — UI rendert nichts
//     was hier nicht steht.
//
// NICHT-Aufgabe dieser Datei:
//   - Keine Mutations, keine Queries, kein Business-Logic.
//   - Kein Evaluator (Welle A): wir definieren nur das Schema.
//   - Keine Sort-Order: das ist View-State, lebt in Komponenten
//     (z.B. BoardView.sortComparator). Filter ≠ Sort.
//
// Verbindlich verankert in `architektur.md` §3 (Schema-Heptad —
// Filter-Schema ist Querschnitt-Layer wie Tags) und Konzept §16.1.

import type { AtomKind } from './atom-manifestations';

// ─── Field-Types ──────────────────────────────────────────────
// Bestimmt UI-Render + Operator-Set.

export type FilterFieldType =
  | 'text' // Freitext (label/title/alias/note)
  | 'enum' // Geschlossene Auswahl (status, link.type, source_provider)
  | 'date' // ISO 'YYYY-MM-DD' (deadline, start_at)
  | 'datetime' // ISO Timestamp (created_at, updated_at)
  | 'number' // Integer/Decimal (priority)
  | 'boolean' // True/False (done, archived, all_day)
  | 'multi-tag' // String-Array Tag-IDs aus atom_tags-Registry
  | 'multi-string' // String-Array (who, custom-attrs)
  | 'recur' // CardRecur-Struktur (Pseudo-Filter: hat-Wiederholung?)
  | 'reference'; // FK auf andere Tabelle (col_id, board_id, cell_id)

// ─── Operatoren ────────────────────────────────────────────────
// Whitelist-streng pro Field-Type — siehe `defaultOperatorsFor`.

export type FilterOperator =
  | 'contains' // text: substring
  | 'starts-with' // text
  | 'eq' // text/enum/number/boolean/reference
  | 'neq'
  | 'lt' // number/date
  | 'lte'
  | 'gt'
  | 'gte'
  | 'between' // number/date — value: [min, max]
  | 'before' // date — alias fuer lt
  | 'after' // date — alias fuer gt
  | 'in' // enum/reference — value: string[]
  | 'not-in'
  | 'has-any' // multi-tag/multi-string — value: string[]
  | 'has-all'
  | 'has-none'
  | 'is-empty' // text/multi-* — leerer/null Wert
  | 'is-not-empty';

// ─── Source-Pointer ────────────────────────────────────────────
// Wo lebt der Wert in der Source-Row?

export type FilterSource =
  | { kind: 'column'; column: string } // direkte Spalte (z.B. 'label', 'deadline')
  | { kind: 'attrs'; path: string } // jsonb-Pfad (z.B. attrs.alias, attrs.tags)
  | { kind: 'computed'; key: string }; // berechnet — Caller-Helper-Lookup
// (z.B. 'tags' via atom_tags-JOIN,
// 'has-recur' via recur != null).

// ─── Attribute-Definition ──────────────────────────────────────

export type AtomFilterAttribute = {
  // Stable Identifier — landet 1:1 in saved_filters.conditions.field.
  key: string;
  label: string;
  fieldType: FilterFieldType;
  source: FilterSource;
  operators: FilterOperator[];
  // Bei fieldType='enum': erlaubte Werte. UI rendert daraus die
  // Optionen, Evaluator validiert dagegen.
  enumValues?: ReadonlyArray<{ value: string; label: string }>;
  // Optional: Hinweis-Text fuer das UI (z.B. „leer = ohne Frist").
  hint?: string;
};

// ─── Default-Operatoren pro Field-Type ─────────────────────────
// Helper fuer Attribute-Definition unten. Konsumenten koennen die
// Liste pro Attribute weiter beschneiden (z.B. priority erlaubt
// `between`, deadline erlaubt `before/after` zusaetzlich).

export function defaultOperatorsFor(t: FilterFieldType): FilterOperator[] {
  if (t === 'text') {
    return ['contains', 'starts-with', 'eq', 'is-empty', 'is-not-empty'];
  }
  if (t === 'enum') {
    return ['eq', 'neq', 'in', 'not-in'];
  }
  if (t === 'date') {
    return ['eq', 'before', 'after', 'between', 'is-empty', 'is-not-empty'];
  }
  if (t === 'datetime') {
    return ['before', 'after', 'between'];
  }
  if (t === 'number') {
    return ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'between', 'is-empty', 'is-not-empty'];
  }
  if (t === 'boolean') {
    return ['eq'];
  }
  if (t === 'multi-tag' || t === 'multi-string') {
    return ['has-any', 'has-all', 'has-none', 'is-empty', 'is-not-empty'];
  }
  if (t === 'recur') {
    return ['is-empty', 'is-not-empty'];
  }
  if (t === 'reference') {
    return ['eq', 'in', 'not-in'];
  }
  return ['eq'];
}

// ─── Attribute-Tables ──────────────────────────────────────────

// Querschnitt — alle Atoms haben Tags + Created-At. Wird in jede
// Atom-Liste gemerged statt 5x dupliziert.
const COMMON_ATTRS: ReadonlyArray<AtomFilterAttribute> = [
  {
    key: 'tags',
    label: 'Tags',
    fieldType: 'multi-tag',
    source: { kind: 'computed', key: 'atom_tags' },
    operators: defaultOperatorsFor('multi-tag'),
  },
  {
    key: 'created_at',
    label: 'Erstellt am',
    fieldType: 'datetime',
    source: { kind: 'column', column: 'created_at' },
    operators: defaultOperatorsFor('datetime'),
  },
];

const TASK_ATTRS: ReadonlyArray<AtomFilterAttribute> = [
  {
    key: 'label',
    label: 'Titel',
    fieldType: 'text',
    source: { kind: 'column', column: 'label' },
    operators: defaultOperatorsFor('text'),
  },
  {
    key: 'note',
    label: 'Notiz',
    fieldType: 'text',
    source: { kind: 'column', column: 'note' },
    operators: defaultOperatorsFor('text'),
  },
  {
    key: 'alias',
    label: 'Alias',
    fieldType: 'text',
    source: { kind: 'attrs', path: 'alias' },
    operators: defaultOperatorsFor('text'),
  },
  {
    key: 'status',
    label: 'Status',
    fieldType: 'enum',
    source: { kind: 'column', column: 'status' },
    operators: defaultOperatorsFor('enum'),
    enumValues: [
      { value: 'open', label: 'Offen' },
      { value: 'in_progress', label: 'In Arbeit' },
      { value: 'blocked', label: 'Blockiert' },
      { value: 'done', label: 'Erledigt' },
      { value: 'archived', label: 'Archiviert' },
    ],
  },
  {
    key: 'deadline',
    label: 'Frist',
    fieldType: 'date',
    source: { kind: 'column', column: 'deadline' },
    operators: defaultOperatorsFor('date'),
    hint: 'Leer = ohne Frist',
  },
  {
    key: 'priority',
    label: 'Prioritaet',
    fieldType: 'number',
    source: { kind: 'attrs', path: 'priority' },
    operators: defaultOperatorsFor('number'),
  },
  {
    key: 'who',
    label: 'Zustaendig',
    fieldType: 'multi-string',
    source: { kind: 'column', column: 'who' },
    operators: defaultOperatorsFor('multi-string'),
  },
  {
    key: 'recur',
    label: 'Wiederholung',
    fieldType: 'recur',
    source: { kind: 'column', column: 'recur' },
    operators: defaultOperatorsFor('recur'),
  },
  {
    key: 'derived_from_external',
    label: 'Aus Kalender abgeleitet',
    fieldType: 'boolean',
    source: { kind: 'computed', key: 'has-derived-source' },
    operators: ['eq'],
  },
];

const LINK_ATTRS: ReadonlyArray<AtomFilterAttribute> = [
  {
    key: 'label',
    label: 'Anzeigetext',
    fieldType: 'text',
    source: { kind: 'column', column: 'label' },
    operators: defaultOperatorsFor('text'),
  },
  {
    key: 'url',
    label: 'URL',
    fieldType: 'text',
    source: { kind: 'column', column: 'url' },
    operators: defaultOperatorsFor('text'),
  },
  {
    key: 'alias',
    label: 'Alias',
    fieldType: 'text',
    source: { kind: 'column', column: 'alias' },
    operators: defaultOperatorsFor('text'),
  },
  {
    key: 'type',
    label: 'Typ',
    fieldType: 'enum',
    source: { kind: 'column', column: 'type' },
    operators: defaultOperatorsFor('enum'),
    enumValues: [
      { value: 'url', label: 'URL' },
      { value: 'mail', label: 'Mail' },
    ],
    // Welle B: erweitert auf 15 Provider via links.provider.
    hint: 'Welle B: erweitert auf 15 Provider (provider-Spalte)',
  },
];

const DOC_ATTRS: ReadonlyArray<AtomFilterAttribute> = [
  {
    key: 'title',
    label: 'Titel',
    fieldType: 'text',
    source: { kind: 'column', column: 'title' },
    operators: defaultOperatorsFor('text'),
  },
  {
    key: 'alias',
    label: 'Alias',
    fieldType: 'text',
    source: { kind: 'column', column: 'alias' },
    operators: defaultOperatorsFor('text'),
  },
  {
    key: 'content',
    label: 'Inhalt',
    fieldType: 'text',
    source: { kind: 'column', column: 'content' },
    operators: ['contains', 'is-empty', 'is-not-empty'],
    hint: 'HTML-Inhalt — Suche im Plaintext-Strip',
  },
  {
    key: 'updated_at',
    label: 'Zuletzt geaendert',
    fieldType: 'datetime',
    source: { kind: 'column', column: 'updated_at' },
    operators: defaultOperatorsFor('datetime'),
  },
];

const CHECKLIST_ATTRS: ReadonlyArray<AtomFilterAttribute> = [
  {
    key: 'label',
    label: 'Titel',
    fieldType: 'text',
    source: { kind: 'column', column: 'label' },
    operators: defaultOperatorsFor('text'),
  },
  {
    key: 'alias',
    label: 'Alias',
    fieldType: 'text',
    source: { kind: 'column', column: 'alias' },
    operators: defaultOperatorsFor('text'),
  },
  {
    key: 'close_mode',
    label: 'Abschluss-Modus',
    fieldType: 'enum',
    source: { kind: 'column', column: 'close_mode' },
    operators: defaultOperatorsFor('enum'),
    enumValues: [
      { value: 'manual', label: 'Manuell' },
      { value: 'auto-prompt', label: 'Auto mit Bestaetigung' },
      { value: 'auto-silent', label: 'Auto stillschweigend' },
    ],
  },
  {
    key: 'recur',
    label: 'Wiederholung',
    fieldType: 'recur',
    source: { kind: 'column', column: 'recur' },
    operators: defaultOperatorsFor('recur'),
  },
  {
    key: 'progress',
    label: 'Fortschritt',
    fieldType: 'number',
    source: { kind: 'computed', key: 'checklist-progress-percent' },
    operators: ['lt', 'lte', 'gt', 'gte', 'between', 'eq'],
    hint: '0-100 (% erledigte Items)',
  },
];

const IMPORTED_EVENT_ATTRS: ReadonlyArray<AtomFilterAttribute> = [
  {
    key: 'summary',
    label: 'Titel',
    fieldType: 'text',
    source: { kind: 'column', column: 'summary' },
    operators: defaultOperatorsFor('text'),
  },
  {
    key: 'description',
    label: 'Beschreibung',
    fieldType: 'text',
    source: { kind: 'column', column: 'description' },
    operators: defaultOperatorsFor('text'),
  },
  {
    key: 'location',
    label: 'Ort',
    fieldType: 'text',
    source: { kind: 'column', column: 'location' },
    operators: defaultOperatorsFor('text'),
  },
  {
    key: 'start_at',
    label: 'Start',
    fieldType: 'datetime',
    source: { kind: 'column', column: 'start_at' },
    operators: defaultOperatorsFor('datetime'),
  },
  {
    key: 'all_day',
    label: 'Ganztaegig',
    fieldType: 'boolean',
    source: { kind: 'column', column: 'all_day' },
    operators: ['eq'],
  },
  {
    key: 'source_provider',
    label: 'Kalender-Quelle',
    fieldType: 'enum',
    source: { kind: 'column', column: 'source_provider' },
    operators: defaultOperatorsFor('enum'),
    enumValues: [
      { value: 'google', label: 'Google' },
      { value: 'outlook', label: 'Outlook' },
      { value: 'ics', label: 'ICS-Feed' },
      { value: 'caldav', label: 'CalDAV' },
    ],
  },
  {
    key: 'sync_state',
    label: 'Sync-Status',
    fieldType: 'enum',
    source: { kind: 'column', column: 'sync_state' },
    operators: defaultOperatorsFor('enum'),
    enumValues: [
      { value: 'active', label: 'Aktiv' },
      { value: 'cancelled', label: 'Abgesagt' },
      { value: 'orphaned', label: 'Verwaist' },
    ],
  },
];

// ─── Public API ────────────────────────────────────────────────

const ATOM_FILTER_ATTRS_TABLE = {
  task: [...TASK_ATTRS, ...COMMON_ATTRS],
  link: [...LINK_ATTRS, ...COMMON_ATTRS],
  doc: [...DOC_ATTRS, ...COMMON_ATTRS],
  checklist: [...CHECKLIST_ATTRS, ...COMMON_ATTRS],
  imported_event: [...IMPORTED_EVENT_ATTRS, ...COMMON_ATTRS],
} as const satisfies Record<AtomKind, ReadonlyArray<AtomFilterAttribute>>;

export function attrsFor(kind: AtomKind): ReadonlyArray<AtomFilterAttribute> {
  return ATOM_FILTER_ATTRS_TABLE[kind];
}

export function findAttr(kind: AtomKind, key: string): AtomFilterAttribute | undefined {
  return attrsFor(kind).find((a) => a.key === key);
}

// ─── SavedFilter — Storage-Format ──────────────────────────────
// Wird in `saved_filters.body` (jsonb) persistiert (Welle A — Tabelle
// in §15.1-A). Konsumenten:
//   - FilterBuilderModal liest/schreibt SavedFilter.
//   - evaluateAtomFilter(atom, filter) (Welle A) wertet den Filter
//     gegen ein Atom + Source-Resolver-Bundle aus.
//   - MCP-Tool `atoms.filter` nimmt SavedFilter-Payload.
// Forward-Compat: `v` als Versions-Diskriminator, Operator-Liste
// strikt aus FilterOperator. Unbekannter `v`-Wert → Caller bricht ab.

export type SavedFilterCondition = {
  // Verweist auf AtomFilterAttribute.key. Bei Rename in
  // ATOM_FILTER_ATTRS_TABLE ist Migration der saved_filters-Rows
  // Pflicht (Schema-Quad).
  field: string;
  operator: FilterOperator;
  // Wert-Typ haengt vom Operator ab:
  //   contains/starts-with/eq → string
  //   in/not-in/has-any/has-all/has-none → string[]
  //   between → [string, string] (date) | [number, number]
  //   is-empty/is-not-empty → null (Wert wird ignoriert)
  //   eq/boolean → boolean
  value: string | number | boolean | string[] | [string, string] | [number, number] | null;
};

export type SavedFilterBody = {
  v: 1;
  atomKind: AtomKind;
  // Logik-Verknuepfung der Bedingungen. V1 nur flach (keine Gruppen).
  // Welle B/C kann Gruppen-Schachtelung ergaenzen.
  logic: 'and' | 'or';
  conditions: SavedFilterCondition[];
};

// Defensive Decoder fuer SavedFilter aus untrusted Sources (Import,
// MCP-Payload). Returns null bei Schema-Drift.
export function isSavedFilterBody(raw: unknown): raw is SavedFilterBody {
  if (typeof raw !== 'object' || raw === null) return false;
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) return false;
  if (o.atomKind !== 'task' && o.atomKind !== 'link' && o.atomKind !== 'doc') {
    if (o.atomKind !== 'checklist' && o.atomKind !== 'imported_event') return false;
  }
  if (o.logic !== 'and' && o.logic !== 'or') return false;
  if (!Array.isArray(o.conditions)) return false;
  for (const c of o.conditions) {
    if (typeof c !== 'object' || c === null) return false;
    const cc = c as Record<string, unknown>;
    if (typeof cc.field !== 'string') return false;
    if (typeof cc.operator !== 'string') return false;
  }
  return true;
}
