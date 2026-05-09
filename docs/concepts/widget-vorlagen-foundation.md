# Konzept — Widget+Vorlagen-Foundation

**Status:** Entwurf. Konzept-Sprint 2026-05-04. Nicht Implementierungs-bereit — siehe Review-Worksheet `widget-vorlagen-review.md`.

**Verbindlich nach Approval.** Aenderungen brauchen User-Freigabe.

**Begleit-Manifest:** `docs/claude/architektur.md` §14 (Foundation-Direktive: Integration-First, Native-Fallback).

---

<a id="1"></a>
## 1. Kontext + Vision

Smart Summary ist heute Stub (T.1.E.2 live: Status-Counts via `lib/task-aggregate.ts`, klickbare Pill, sechs Sektionen als „kommt bald" annotiert in `CellSummaryPage.tsx`). Beim Versuch, das echte Dashboard (T.SS, ~25-30d) zu planen, hat der User die Frage **eine Ebene hoeher** gehoben:

> Alle Features ausser Matrix (Board · Checklist · Info · Doc · Smart Summary · Kalender) sind im Kern **vorab zusammengestellte Vorlagen** mit Symbol, Namensvorschlag, Hotkey-Slot (1-9 im Feature-Wizard) und fest positionierten Widgets in einem Spalten/Sektionen-Layout. Atome bleiben einzeln (Task, Link, Doc, Checklist, imported_event) — damit ein Widget cross-view droppbar ist (Kanban-Karte in Checklist, Checklist in Kanban-Karte, alles in Kalender). Kommentare + Markierungen werden pro Widget toggelbar.

Konsequenz: das heutige `CELL_FEATURES`-Modell mit fest verdrahteten Hotkeys 1-4 (`features.ts:42-87`) wird abgeloest durch eine **Vorlagen-Registry**. Was heute „das Board-Feature" heisst, ist morgen die Plattform-Default-Vorlage „Kanban" auf User-konfigurierbarem Hotkey-Slot. „Info" wird zum Form-Widget innerhalb einer Vorlage. „Smart Summary" wird die Plattform-Default-Vorlage „Dashboard" mit 6 Default-Widgets.

**Ziel:** maximale Flexibilitaet bei trotzdem niedrigem Einstiegs-Aufwand. Plattform liefert reichhaltige Default-Vorlagen, User kann bestaetigen oder eigene anlegen — nichts muss, alles kann.

**Roadmap-Position (User 2026-05-04):** dieser Konzept-Sprint plus die Folge-Implementierung sind **der groesste Umbau vor** den finalen End-Wellen (Restaufraeumen, BACKLOG, SaaS-Page, Produktdoku, Test/Prod-Infra V2). Pfusch hier multipliziert sich.

---

<a id="2"></a>
## 2. Foundation-Direktive — Integration-First, Native-Fallback

**Verbindlich verankert in `docs/claude/architektur.md` §14.** Hier nochmal als Pflicht-Lekuere fuer alle weiteren Abschnitte:

> Das Tool ist Organisations-Layer ueber existing User-Infrastruktur, nicht Konkurrenz dazu. Keine native Dateiablage. Kein eigener Chat. Maximal eigene Doku — und die idealerweise mit Sync zu Drittsystemen. Native Features sind Fallback, nicht Default. Maximale Flexibilitaet kommt aus Aliasen + Hyperlinks im Text + strukturellen Aggregationen, nicht aus eigenem Storage.

Konkret fuer dieses Konzept:

- **Comments / Chat** primaer als Bridge (Mail-Thread, Messenger-Channel, Slack/Teams), `atom_comments` als opt-in Fallback.
- **Attachments** primaer als Cloud-Verknuepfung (OneDrive/Drive/Dropbox), Supabase-Storage als Notnagel.
- **Doc** primaer als OneNote/Notion-Sync (V1-Anker), ProseMirror-Atom-Doc (heute live) als Fallback.
- **Sharing** ist Kern, nicht Add-On — Drag-Drop nach extern, Alias-Aufloesung zu absoluten URLs.
- **UI-Toggles** haben `extern / native / off`, Default `extern`.

Jeder Abschnitt unten respektiert diese Direktive.

---

<a id="3"></a>
## 3. Inventur — alles, was heute kein Atom + keine Matrix ist

Heutiges Modell (Quelle: `packages/client-web/src/lib/features.ts:42-87` + Architektur §1):

| Feature | Hotkey | Kind | Persistenz | Atom-Bestandteile (heute) | Externe Anker (V1/V2) |
|---|---|---|---|---|---|
| **Matrix** | 1 | structural | `nodes` (Sub-Node) + `rows` + `cols` + `cells` | n/a (Container) | n/a |
| **Board (Kanban)** | 2 | structural | `kb_columns` + `tasks` + `atom_manifestations(kind=kanban)` | tasks, links, checklists, docs (cross-view-pinbar via Welle T.AC) | Trello / Jira / Asana (V2) |
| **Info** | 3 | flag | `cell.data.infoFields[]` (JSONB-Array) + `cell.data.links[]` | keine — Felder sind reine Cell-Daten, kein Atom | Notion-DB-Row, OneNote-Page (V1) |
| **Checklist** | 4 | flag | `checklists` + `atom_manifestations(kind=checklist)` mit `level 0-2` | tasks, checklists, docs | Todoist / MS-To-Do (V2) |
| **Doc** | (`d`) | atom-pin | `docs` + `atom_manifestations(kind='pinned', container_kind='cell')` (post-WV.WV-Konsolidierung — heute noch `atom_pins`, siehe §9.A) | doc-Atom selbst | **OneNote / Notion (V1)** |
| **Smart Summary** | klickbar via Pill | aggregiert | `lib/task-aggregate.ts` rechnet on-the-fly | task + atom_manifestations gelesen, nicht geschrieben | n/a (intern) |
| **Kalender** | (Sidebar-Mode) | structural | `atom_manifestations(kind=calendar)` + `external_events` (Welle I) | tasks, links, checklists, imported_events | Google / Outlook / ICS Inbound (live), Outbound (V1-Backlog) |

Beobachtungen:

- **Info-Felder sind heute kein Atom-Typ** — sie leben als JSONB-Array in `cell.data.infoFields`. Cross-View-Drag (z.B. Info-Feld in Kanban-Karte) ist heute nicht moeglich, weil das Atom fehlt.
- **Doc ist als einziges existing Feature schon entkoppelt** — kein Cell-Feature mehr, sondern Atom mit Pin (Welle D). Damit ist Doc das Vorbild fuer das Vorlagen-Modell.
- **Hotkeys 5-9 + `n` sind frei** (Kommentar in `features.ts:86`).
- **Smart Summary** liest, schreibt nicht. In der neuen Welt wird es selbst zur Vorlage „Dashboard" mit Read-Widgets.

→ Konkret-Output im Worksheet: §3.1-§3.7 zu jedem Feature die Atom-Erweiterungs-Frage + den Bridge-Anker bestaetigen lassen.

---

<a id="4"></a>
## 4. Atom-Erweiterungs-Entscheidung

Architektur §1.1 listet heute 5 Atom-Typen: `task` · `link` · `checklist` · `doc` · `imported_event`. Frage: muss die Liste fuer das Vorlagen-Modell wachsen?

| Kandidat | Pro | Contra | Vorlaeufige Empfehlung |
|---|---|---|---|
| `info_field` | Cross-View-Drag (Info → Kanban-Karte) wird moeglich. Form-Widget braucht eigenstaendige Form-Atome. | Info-Felder sind heute schwach getypt (Label + Value-String). Migration aller `cell.data.infoFields` in atomare Tabelle. | **JA, V1** — `atom_type='info_field'` mit `(label, value, value_type, position)`. Mit Migration `cell.data.infoFields[] → atom_manifestations(kind=info)` als Polymorphie-Sicht. |
| `note` (Inline-Note) | User-Quick-Marker an einem Atom („zur Erinnerung 2026-05-03"). | Konzeptuell Doc-Subset. Ueberlappt mit `atom_doc_notes` (Architektur §1.5). | **NEIN, V2** — bis Use-Case schaerfer ist. Stattdessen `atom_comments` (extern primaer) decken den Use-Case ab. |
| `marker` (Highlight/Star) | Pro Widget-Toggle „Marker" braucht ein Schema. | Kann auch als Boolean-Spalte auf bestehenden Atomen leben. | **NEIN** — als JSONB-Spalte `markers` auf bestehenden Atom-Tabellen, kein eigener Atom-Typ. |
| `external_ref` | Mail-Thread / Drive-File / OneNote-Page als first-class Atom. | Kollidiert mit `link` — `link` koennte zu generic-`external_ref` umbenannt werden. | **JA, V1** — Erweiterung von `link` um Provider-Discriminator (`link.provider IN ('url', 'mail', 'drive', 'onenote', 'messenger')`). Kein neuer Atom-Typ, sondern Diskriminator-Spalte. |
| `widget_data_blob` | Wenn ein Widget Custom-Daten haelt (z.B. einen Chart-Schnipsel). | Falscher Layer — gehoert in Widget-Config, nicht in Atom-Layer. | **NEIN.** |

**V1 Atom-Liste (vorgeschlagen):** `task` · `link (mit provider-discriminator)` · `checklist` · `doc` · `imported_event` · **`info_field`** (neu, 6 Atome).

Worksheet-Frage 4.1: bestaetigt User die Erweiterung um `info_field`? 4.2: Provider-Diskriminator auf `link` oder eigener Atom-Typ?

---

<a id="5"></a>
## 5. Widget-Foundation

### 5.1 Section · Column · Widget — das Layout-Modell

```
┌─ Vorlage „Info Vertrag" ─────────────────────────────────────┐
│                                                                │
│ ┌─ Section „Stammdaten" ────────────────────────────────────┐ │
│ │  ┌─ Col 1 ─────────┐  ┌─ Col 2 ──────────────────────┐  │ │
│ │  │ ┌─ Widget ────┐ │  │ ┌─ Widget ──────────────────┐│  │ │
│ │  │ │ Form Felder │ │  │ │ Doc-Sync OneNote-Page     ││  │ │
│ │  │ └─────────────┘ │  │ │ (Comment-Toggle: Outlook) ││  │ │
│ │  │                 │  │ └───────────────────────────┘│  │ │
│ │  └─────────────────┘  └──────────────────────────────┘  │ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                │
│ ┌─ Section „Termine + Tasks" (collapsed) ───────────────────┐ │
│ └────────────────────────────────────────────────────────────┘ │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

- **Section** = horizontaler Container mit Titel + Default-Collapsed-State + Visibility (always / edit-only / never).
- **Column** = vertikaler Slot innerhalb einer Section. Min/Max-Width in `rem`. Mobile-Override: Columns stacken vertikal.
- **Widget** = inhaltliches Element in einer Column. Vertrag siehe 5.2.

### 5.2 Datenquellen + UI-Stile (final 2026-05-05)

Drei Iterationen haben geklaert: Slot-vs-Aggregat ist **kein** Datenmodell-Unterschied. Es gibt zwei Datenquellen + drei UI-Stile, die sich aus Filter-Konfiguration ableiten.

#### 5.2.1 Datenquellen

| Quelle | Was sie liefert | Beispiel |
|---|---|---|
| `direct` | **Genau ein** Atom per Alias-Ref. Inline-Render des Atom-Inhalts. | „Slot zeigt das Doc `^kunde-mueller-hauptvertrag`" — Hauptvertrag ist immer dieses spezifische Doc. |
| `query` | **0..n** Atome aus Filter-Builder mit Conditions. | „Alle Tasks dieser Cell mit Object=Hund, Tag=Bissig, User=Annemarie, sortiert nach Deadline, max 5" |
| `external` | Externer Channel-Inhalt (Mail-Thread, Messenger-Channel, Cloud-File-Preview). Foundation-Direktive §14. | „Outlook-Mail-Thread `mueller-vertrag`" |

#### 5.2.2 UI-Stile (abgeleitet aus query.limit + atom_types)

| Stil | Bedingung | Render |
|---|---|---|
| **Mono-Slot** | `direct` ODER `query` mit `limit=1` + ein `atom_type` | Ein prominentes Atom (Doku-Slot, Task-Slot, Link-Slot, ...). Atom-spezifischer Renderer. |
| **Misch-Slot** | `query` mit `limit=1` + mehrere `atom_types` | Erstes Atom prominent, Atom-Type-Icon zeigt was es geworden ist. |
| **Aggregat** | `query` mit `limit=n` (n>1 oder unlimited) | Liste/Grid je nach Widget-Type. |

UI-Stil ist Render-Hint, kein Datenmodell. Ein Widget kann von Slot zu Aggregat wechseln, indem User `limit` von 1 auf 10 setzt.

#### 5.2.3 Filter-Builder (Modal, globaler Reuse)

Der Filter-Builder oeffnet als Modal — Inline-Editor scheidet aus, weil Widget-Groesse variiert. Komponente `FilterBuilderModal` wird **single-source**: dieselbe Komponente in Widget-Filter, Sidebar-Filter, Command-Palette-Suche. Doublet-Verbot pro `code-quality.md` §1.

Filter-Conditions:

```
SELECT atoms WHERE
  atom_type IN [...]                              -- 1..6 atom_types
  AND scope IN { cell | cell+subtree | pool (workspace) | global }
  AND <conditions verbunden mit AND/OR>:
    - has_object: Object-Ref aus Welle-O-Object-Layer
    - has_tag: Tag-Ref aus Welle-D-Tag-Registry
    - by_user: created_by | assigned_to | mentioned_in
    - by_atom_attr: atom-spezifisches Feld (siehe §17 Risiken — finale Liste zur Umsetzung)
    - by_alias_pattern: Alias-Wildcard (z.B. „beginnt mit `kunde-`")
ORDER BY <field> ASC|DESC
LIMIT n | unlimited
```

Filter-Picker reusen heute folgende Foundation (Stand 2026-05-07, Audit-Stichprobe):
- Alias-Picker — `lib/use-alias-autocomplete.ts` + `lib/alias-index.ts` + `lib/alias-chip-menu.ts` (Inline-Hook in `<input>`/`<textarea>` via `^`-Trigger).
- Tag-Picker — `lib/tag-index.ts` + `lib/atom-tags.ts` (nur Index/Mutationen, **kein dezidierter Picker existing**).
- Object-Picker — `components/ObjectPickerModal.tsx` + `components/ObjectSuggestion.tsx` + `lib/use-object-suggest.ts` (Modal **und** Inline-Suggest, zwei Pfade).
- Atom-Picker — `components/AtomPickerModal.tsx`.
- Cell-Picker — `components/CellSuggestModal.tsx`.
- User-Picker — `lib/pm-mention-plugin.ts` (nur ProseMirror-Plugin, **kein generischer User-Picker**).

Drei verschiedene Render-Pattern (Hook / Modal / PM-Plugin) ohne gemeinsamen API-Vertrag, Tag- und User-Picker fehlen ganz auf generischer Ebene, Object-Picker hat zwei parallele Pfade — das ist **kein Konzept-Issue**, sondern ein **Refactor-Auftrag**.

**Auftrag — separater Picker-Audit-Sprint (User 2026-05-07, deferred, Timing TBD):**

Beim Hingreifen wird **JEDER existing Picker-Fall im Code in einer Matrix dargestellt** mit:
- **Ist:** wo lebt er, welches Render-Pattern, welcher Index, welche Caller.
- **Soll:** welcher Effekt soll erreicht werden (Inline-Autocomplete / Modal-Auswahl / PM-Mention-Trigger / Drag-DnD-Source).
- **Vereinheitlichung:** wie laesst sich das auf einen gemeinsamen Index-Layer + Render-Linsen-Vertrag bringen.

Detail-Entscheidungen (Render-Linsen-Modell, PM-Mention-Scope, Object-Picker-Doppel-Pfad-Konsolidierung, Tag/User-Picker-Generizitaet) **leiten sich aus dieser Matrix ab** und werden im Refactor-Plan-File entschieden — **nicht jetzt im Konzept**.

**Konsequenz fuer Welle WV (Filter-Builder-Implementierung):** Filter-Builder-Modal nutzt zunaechst die **heutigen Picker as-is** — der Picker-Audit-Sprint zieht spaeter ein. Kein Refactor-Block fuer WV.

Verankert im BACKLOG als eigener Welle-Eintrag (siehe BACKLOG-Update 2026-05-07).

#### 5.2.4 Drop-Verhalten

| Filter-Form | Drop-Aktion |
|---|---|
| `direct` (kein Filter) | Drop ersetzt das aktuelle Atom (mit Confirm wenn schon befuellt). |
| `query` mit reinen AND-Conditions (Tag/Object/User-Setter, einfach) | **Auto-Apply:** Drop tagged/verknuepft das gedroppte Atom mit allen Filter-Conditions. Toast „Atom in Slot uebernommen + 3 Attribute gesetzt". |
| `query` mit OR / Negation / komplex | **Drop-Modal:** „Welche Attribute uebernehmen?" mit Optionen (a) Attribute setzen + Atom uebernehmen (b) verwerfen (c) neues Widget anlegen mit dem gedroppten Atom + dessen Eigenschaften. |
| `external` (Channel-Widget) | Drop-Aktion ist Provider-spezifisch (Mail-Forward, Channel-Post). V2. |

#### 5.2.5 Empty-State

Bei leerem Slot/Aggregat:
- Symbol/Placeholder zeigt visuell „droppen oder Regel zuweisen".
- CTA-Button „Filter bearbeiten" oeffnet `FilterBuilderModal`.
- CTA-Button „Atom direkt verlinken" oeffnet Alias-Picker (fuer `direct`-Quelle).
- Animation: subtile Pulse-Animation auf Drop-Hover (`animations.md` §2.12 Drag-Source/Drop-Target).

#### 5.2.6 Widget-Vertrag (TS-Interface)

```ts
type WidgetType =
  | 'kanban-column'       // Eine Spalte eines Kanban-Boards
  | 'checklist'           // 3-stufig hierarchisch
  | 'info-form'           // Form-Felder (info_field-Atome)
  | 'doc-embedded'        // Inline ProseMirror-Doc oder Sync-Doc
  | 'doc-link'            // Verlinkter externer Doc (OneNote / Notion)
  | 'task-list'           // Filterbare Task-Liste
  | 'calendar'            // Kalender-Widget (Tag/Woche/Monat)
  | 'link-list'           // Link-Liste mit Provider-Icons
  | 'atom-card'           // Generisches Atom-Card-Render fuer Mono-/Misch-Slot
  | 'activity'            // Activity-Stream (extern + Mutations + opt-in atom_comments)
  | 'channel-thread'      // Mail/Messenger-Thread eingebettet
  | 'iframe'              // Generisches Embedded-Widget
  ;

type WidgetFilter = {
  atom_types: AtomType[];
  scope: 'cell' | 'subtree' | 'workspace' | 'global';
  conditions: FilterCondition[];           // AND/OR-Tree
  sort?: { field: string; dir: 'asc' | 'desc' };
  limit?: number;                          // undefined = unlimited
};

type FilterCondition =
  | { kind: 'and' | 'or'; children: FilterCondition[] }
  | { kind: 'not'; child: FilterCondition }
  | { kind: 'has_object'; objectId: string }
  | { kind: 'has_tag'; tagId: string }
  | { kind: 'by_user'; userId: string; role: 'created_by' | 'assigned_to' | 'mentioned' }
  | { kind: 'by_atom_attr'; atomType: AtomType; attr: string; op: 'eq' | 'lt' | 'gt' | 'in' | 'contains'; value: unknown }
  | { kind: 'by_alias_pattern'; pattern: string };

type Widget = {
  id: string;
  type: WidgetType;
  title?: string;                          // Override Default-Naming
  section_id: string;
  column: number;                          // 1-basiert
  position: number;                        // innerhalb der Column
  size: { cols: number; rows: number };    // Grid-Span (12-Spalten-Grid)
  data:
    | { source: 'direct'; directRef: { atomType: AtomType; alias?: string; atomId?: string } }
    | { source: 'query'; query: WidgetFilter }
    | { source: 'external'; externalProvider: ExternalProvider; externalRef: { kind: string; id: string; href?: string } };
  toggles: {
    comments: 'off' | 'native' | 'external';      // Default 'external' (§14)
    commentsChannel?: { provider: string; ref: string };
    attachments: 'off' | 'cloud' | 'native';      // Default 'cloud'
    attachmentsCloud?: { provider: string; folderRef: string };
    markers: boolean;
    header: boolean;
    edit_in_view: boolean;                        // User-Edit ausserhalb Edit-Mode
  };
  config: Record<string, unknown>;                // type-spezifisch
};

type ExternalProvider = 'onenote' | 'notion' | 'gmail' | 'outlook' | 'slack' | 'teams' | 'whatsapp' | 'drive' | 'onedrive' | 'dropbox' | 'nextcloud' | 'protonmail' | 'smtp';
```

**Aenderungen gegenueber 2026-05-04-Entwurf:**
- `data.source` als diskriminierte Union (`direct` / `query` / `external`).
- `expects_single` + `auto_tag_on_drop` entfaellt — ergibt sich aus `query.limit` und `query.conditions`.
- `WidgetFilter` als first-class Type, **identisch in `saved_filters` (siehe §15)**.
- `WidgetType`-Liste ergaenzt um `atom-card` (generischer Mono-/Misch-Slot-Renderer).
- `ExternalProvider` ergaenzt um `nextcloud`, `protonmail`, `smtp` (User-Wunsch zu Worksheet 13.1/13.3).

### 5.3 Persistenz + Sync-Modell (final 2026-05-06)

Layout lebt:

- **In der Vorlage** (Template-scoped, gleich fuer alle Cell-Instanzen, die diese Vorlage verwenden) → `template_widgets`-Tabelle.
- **In der Cell-Instanz** als sparse Override → `cell_widget_overrides`-Tabelle.

**Override-Granularitaet (User 2026-05-06 zu 5.6/5.7):**

- **Top-Level-Field sparse** — `override_data` haelt nur die geaenderten Felder (size, toggles, title, position, column, section_id, config, data).
- **Sub-Objects als Ganzes** — Komplex-Felder wie `data.query`, `data.directRef`, `data.externalRef`, `config` werden ATOMAR ueberschrieben (kein JSON-Path-Patch). Wenn User den Filter aendert, ist `override_data.data` ein vollstaendiges `data`-Object.
- **Read-Pfad:** `widget_render = mergeShallow(template_widget, override_data)` via Helper `lib/template-merge.ts` (Single-Source, Doublet-Verbot).

**Reset pro Widget (User 2026-05-06 zu 5.6 #3):**

Rechtsklick auf Widget im Edit-Mode → „Auf Vorlage zuruecksetzen" → loescht den `cell_widget_overrides`-Eintrag fuer dieses Widget. Mit `pushUndo` + `showUndoToast`.

**Indicator-Dot bei Anpassung (User 2026-05-06 zu 5.6 #4):**

Angepasstes Widget zeigt kleinen Indicator-Dot (`--accent-soft` Farbton, oben rechts neben Title-Bar). Hover-Tooltip „Angepasst — auf Vorlage zuruecksetzen?". Animation `--tr-fast` Pulse beim ersten Override.

**Position-Reorder atomar (User 2026-05-06 zu 5.6 #5 — Option c):**

Position-Override **niemals einzeln**. Nur via Drag-and-Drop-Reorder im Edit-Mode → System schreibt Override fuer alle Widgets der betroffenen Section/Column in einer atomaren Mutation (Bulk-Upsert). Damit sind Position-Kollisionen ausgeschlossen.

API-Vertrag (Mutation): `reorderWidgets(cellInstanceId, sectionId, columnIndex, orderedWidgetIds)` — schreibt fuer jedes Widget in der Liste einen Override-Eintrag mit der neuen Position.

MCP-Tool-Naming: `widget.reorder` (nicht `widget.position.set`).

**Sync-Modell:**

- **Default = Auto-Sync.** Aenderung an der Vorlage wirkt automatisch auf alle Cell-Instanzen, die nicht explizit `cell_widget_overrides` haben. Vorlage-Update aendert Title-Field → alle Cells sehen den neuen Title (auch die, die andere Felder ueberschrieben haben — nur das Title-Feld wirkt).
- **Soft-Sync per Cell-Instanz waehlbar.** Im Cell-Edit-Mode kann User die Vorlage „abschliessen" (UI: Schloss-Symbol). Dann wirkt Vorlage-Update **nicht** automatisch — User bekommt UI-Hint „Vorlage hat Update — anwenden?" und entscheidet pro Cell.
- **Reset-to-Template** pro Feature/Vorlage. Bei Vorlagen-basiertem Feature: Reset setzt Cell-Instanz zurueck auf Vorlage-Default, alle `cell_widget_overrides` werden geloescht (mit Undo).

**Realtime + Throttle (User 2026-05-06 zu 5.6 #7):**

User-Direktive: *„andere User muessen nicht zuschauen wie sich die Container laufend in Breite und Hoehe veraendern — mit Herz und Hausverstand."* Konkret:

- **Lokal-Optimistic waehrend Drag/Resize** — keine DB-Mutation, kein Realtime-Broadcast. Nur lokaler State.
- **Atomic-Commit am Drag-/Resize-End** — eine DB-Mutation + Realtime-Bumps. Andere User sehen das Ergebnis, nicht den Live-Schritt.
- **Form-Field-Live-Edit** (Filter-Builder, Toggle-Click) — Debounce 500ms client-seitig vor Mutation. Realtime-Subscriber auf `cell_widget_overrides` mit 1-2s Server-side-Throttle pro Cell-Instance, damit andere Member nicht ueberschwemmt werden.
- Konsistent mit `architektur.md` §5.8 — Realtime-Default mit erlaubtem Sekunden-Debounce.

**Heptad-Slots fuer `cell_widget_overrides`:**

| Slot | Eintrag |
|---|---|
| 1 Schema | siehe oben (instance_id × widget_id × override_data jsonb + is_locked? geht in cell_template_instances) |
| 2 Types | `lib/types.ts` `CellWidgetOverride` |
| 3 Mutations | `lib/cell-widget-overrides.ts` (CRUD + `reorderWidgets`-Bulk-Helper) via `safe-mutation` |
| 4 Offline-Cache | TABLES + DB_VERSION-Bump |
| 5 Realtime | Workspace-Channel mit 1-2s Throttle pro Cell-Instance (User-Direktive Hausverstand) |
| 6 Export/Import | embedded in cell_template_instances |
| 7 MCP-Tools | `widget.override.set`, `widget.override.reset`, `widget.reorder` (atomar) — Tool-Trio + Realtime-Garantie (§6.1) Pflicht |
| 8 Channel-Bridge | n/a — Strukturdaten, kein User-Inhalt |

**Sync-Modell** (User 2026-05-05 bestaetigt zu Punkt 3.4):

- **Default = Auto-Sync.** Aenderung an der Vorlage wirkt automatisch auf alle Cell-Instanzen, die nicht explizit `cell_widget_overrides` haben. Das Doc-Pattern aus Welle D dient als Vorbild fuer die Entkopplungs-Bewegung (Cell-Feature → freies Modell), aber Vorlagen sind nicht Live-View — sie sind Auto-Sync **mit** Override-Layer.
- **Soft-Sync per Cell-Instanz waehlbar.** Im Cell-Edit-Mode kann User die Vorlage „abschliessen" (UI: Schloss-Symbol an der Cell-Instanz). Dann wirkt Vorlage-Update **nicht** automatisch — User bekommt UI-Hint „Vorlage hat Update — anwenden?" und entscheidet pro Cell.
- **Reset-to-Template** (User 2026-05-05 zu 5.8): pro Feature/Vorlage. Bei Vorlagen-basiertem Feature: Reset-Action setzt Cell-Instanz zurueck auf Vorlage-Default, alle `cell_widget_overrides` werden geloescht (mit Undo). Bei Blank-Feature (kein Vorlagen-Bezug): Action „leeren" oder „Vorlage einladen".

Override-Tabelle skizze (Detail in §6.8):

```
cell_widget_overrides (
  ...,
  override_data jsonb,            -- nur die geaenderten Felder, sparse
  is_locked     bool default false  -- 2026-05-05: Schloss-Toggle pro Cell-Instanz
)
```

→ Detail-Diskussion zu `layout_version`-Pinning + Visibility des Schloss-Symbols + UI-Hint-Verhalten siehe **§6.8** (Hook gesetzt 2026-05-05). Vor Implementierung der Vorlagen-CRUD-Welle muessen Auto-Sync-Trigger-Regel + Schloss-UI mit User abgestimmt werden.

Worksheet-Frage 5.6: User-Override pro Cell erlaubt? 5.7: Override-Granularitaet (ganzer Widget oder einzelne Felder)? 5.8: Reset-to-Template-Action — siehe oben (User-Antwort 2026-05-05).

### 5.4 Reuse aus existing Code

- `lib/task-aggregate.ts` — Aggregation fuer task-list, calendar, activity.
- `lib/atom-manifestations.ts` — polymorpher CRUD fuer alle Widgets mit `data.source='atoms'`.
- `lib/drag-context.ts` + `manifestation-cross-view.ts` — Widget-internes DnD + Cross-Widget-Drop.
- `lib/keyboard-nav.ts` — Section-Collapse-Hotkeys.
- Animation-Pattern §2.5 (List-Stagger), §2.13 (Card-Insert), §2.7 (Drill-Down) fuer Widget-Mount/Unmount.
- Style-Pattern §6.3 (Grid + Flex), §5.3 (.card) fuer Widget-Container.

---

<a id="6"></a>
## 6. Vorlagen-Modell

### 6.1 Hierarchie

```
Plattform-Vorlage     (read-only fuer User, Plattform-Admin pflegt)
    │
    ├─ Workspace-Vorlage    (User-editierbar, Workspace-shared, Permission gating)
    │       │
    │       └─ User-Vorlage    (privat, nur fuer den anlegenden User)
    │
    └─ Cell-Instanz       (eine konkrete Cell, die eine Vorlage verwendet)
```

### 6.2 Tabelle (Skizze)

```
feature_templates (
  id              uuid PK,
  workspace_id    uuid NULL FK workspaces,        -- NULL = Plattform-Vorlage
  owner_user_id   uuid NULL FK auth.users,        -- NULL = Workspace-shared
  name            text,
  symbol          text,                           -- Heroicons-IconName
  symbol_color    text NULL,                      -- Token-Reference
  hotkey_slot     int NULL CHECK (1..9),          -- Workspace-eindeutig per Slot
  is_global       bool default false,             -- User-Toggle „global verfuegbar"
  visibility      enum('platform','workspace','user'),
  layout_version  int default 1,                  -- bei Layout-Aenderung bumpen, Cells re-baselinen
  title_template  text NULL,                      -- analog docs.title_template (Welle D)
  root_widget_id  uuid NULL REFERENCES template_widgets(id) ON DELETE SET NULL,
                                                  -- §9.10: Default-Drop-Target fuer Atomic-Drop/Paste.
                                                  -- NULL = keine Default-Aktion, WidgetPicker zeigt
                                                  -- alle kompatiblen Slots. Bei mehreren Vorlagen in
                                                  -- einer Cell mit Root-Widget kompatibler Atom-Type:
                                                  -- WidgetPicker mit Root-Widgets prominent.
  render_position text NOT NULL DEFAULT 'hotkey_slot'
                  CHECK (render_position IN ('hotkey_slot', 'auto_under_features')),
                                                  -- §11: Smart Summary = 'auto_under_features'
                                                  -- (auto-render unter den Cell-Features, kein
                                                  -- Hotkey-Slot, kein Wizard-Pfad). Default
                                                  -- 'hotkey_slot' fuer normale Vorlagen.
  config          jsonb,                          -- Default-Toggles, Cycle-Templates, etc.
  created_at      timestamptz,
  created_by      uuid FK auth.users
)

template_sections (
  id              uuid PK,
  template_id     uuid FK feature_templates,
  position        numeric,
  title           text,
  default_collapsed bool default false,
  visibility      enum('always','edit_only')
)

template_widgets (
  id              uuid PK,
  section_id      uuid FK template_sections,
  column          int,
  position        numeric,
  type            text,                           -- WidgetType-Enum
  size_cols       int, size_rows int,
  data            jsonb,                          -- siehe Widget.data
  toggles         jsonb,                          -- siehe Widget.toggles
  config          jsonb
)

cell_template_instances (
  id              uuid PK,
  cell_id         uuid FK cells,
  template_id     uuid FK feature_templates,
  layout_version  int,                            -- pinned, fuer Re-Baseline-Awareness
  applied_at      timestamptz
)

cell_widget_overrides (
  id              uuid PK,
  instance_id     uuid FK cell_template_instances,
  widget_id       uuid FK template_widgets,
  override_data   jsonb                           -- sparse: nur die geaenderten Felder
)
```

Heptad pro Tabelle (siehe `docs/claude/architektur.md` §3) inkl. **§14-Slot 8 (Channel-Bridge)**: hier `n/a — kein User-Inhalt, sondern Strukturdaten.`

### 6.3 Hotkey-Slots

Heute fest verdrahtet (`features.ts:42-87`): `1=Matrix`, `2=Board`, `3=Info`, `4=Checkliste`. Doc lebt auf `d`.

Kuenftig: Slots `1-9` sind **per Workspace konfigurierbar** und werden Vorlagen zugewiesen. Plattform-Default-Belegung:

| Slot | Plattform-Default (User 2026-05-06 Re-Diskussion 6.1) | User-Override moeglich? |
|---|---|---|
| 1 | Matrix-Vorlage (`template_kind='structural-node'`) | ja — Matrix-Erzeugung bleibt via Command-Palette + `/templates/`-Route erreichbar (kein zusaetzlicher Toolbar-Button noetig) |
| 2 | Vorlage „Info" | ja |
| 3 | Vorlage „Kanban" (= ehemaliges Board-Feature) | ja |
| 4 | Vorlage „Checkliste" | ja |
| 5-9 | leer | ja |

**Slots 5-9 offen** (User 2026-05-06): „Ueber Vorlagen muessen wir noch sprechen" — Plattform-Default-Belegung fuer 5-9 in Folge-Sprint zu klaeren.

**Buchstaben-Slots (`'d'`, `'n'`, etc.) entfallen in V1** (User 2026-05-07 Re-Diskussion 7.7): V1 nutzt nur Ziffern-Slots `1-9`. Spaeter (V2) koennen Buchstaben-Slots dazu kommen.

**Doku-Globaler-Hotkey** bleibt unveraendert: `'d'` triggert weiterhin `openDokuForContext(ctx)` aus `lib/docs-open.ts` (Welle D, heute live) — ist **kein Vorlagen-Slot**, sondern ein Workspace-globaler Hotkey ausserhalb des Slot-Schemas. Die Doku-Plattform-Vorlage existiert (siehe §15 Heptad), hat in V1 aber **keinen** Slot zugewiesen — User wendet sie aus der `/templates/`-Liste an oder nutzt den existing `'d'`-Hotkey fuer Doku-Open.

### 6.3d MCP/AI-Onboarding-Vorschlag (User-Vorschlag 2026-05-06 zu 6.1)

User-Direktive: im Onboarding-Wizard schlaegt MCP/AI passende Plattform-Vorlagen vor und belegt damit Slots — basierend auf User-Eingaben (Workspace-Zweck, Branche, Use-Case).

Voraussetzung:
- Erweiterte Plattform-Vorlagen-Bibliothek (mehr als die initialen 4-6 Default-Vorlagen) — Plattform-Admin-pflegbar (Folge-Sprint).
- AI-Pipe (Welle A live) bekommt MCP-Tool `template.suggest(workspaceContext)` → liefert Liste passender Plattform-Vorlagen mit Score.
- Onboarding-Wizard: User beantwortet 2-3 Fragen → AI schlaegt Slot-Belegung 1-9 vor → User bestaetigt oder editiert pro Slot.

Dies ist ein **Folge-Sprint** — Detail-Spec gehoert in eigenes Plan-File. Heute nur als Konzept-Anker dokumentiert. V1-Welle WV.A liefert nur die 4 Plattform-Defaults (1-4) hardcoded — Erweiterung + AI-Onboarding kommt nach WV.D (AI-Pipe-Voraussetzung schon gegeben).

**Architektur-Konsequenz (User 2026-05-06 zu 6.1):** Matrix ist **kein Sonderfall** mehr, sondern Plattform-Vorlage mit `feature_templates.template_kind='structural-node'`. Das passt zur Gesamtvision „alles ist Vorlage" — Matrix nur mit besonderem Kind.

```sql
ALTER TABLE feature_templates ADD COLUMN template_kind text NOT NULL DEFAULT 'layout'
  CHECK (template_kind IN ('layout', 'structural-node'));
```

- `layout` = Widget-Vorlage (default — Info, Kanban, Checkliste, Smart Summary, Doku, User-Vorlagen).
- `structural-node` = erzeugt beim Apply einen Sub-Node mit FK-Cascade (heute Matrix, V2 evtl. weitere strukturelle Container).

**User-Schutz:** Matrix-Erzeugung ist nicht nur an Slot 1 gekoppelt:
- Edit-Mode-Toolbar-Button „Sub-Matrix anlegen" — immer sichtbar.
- Command-Palette-Befehl „Matrix anlegen".
- `/templates/`-Liste zeigt Matrix-Vorlage, User kann sie auf jeden Slot legen.

**Adjacent-Cleanup beim Welle WV.A:** `lib/features.ts` (heute hardcoded `CELL_FEATURES`) wird obsolete. Liste kommt aus `feature_templates`-Tabelle. `findFeatureByHotkey` und `findFeatureByKey` werden Lookups in der Tabelle.

### 6.3a Slot-Override-Inheritance (User 2026-05-06 zu 6.2)

Drei-Schicht-Inheritance Plattform → Workspace → User (Best-Practice, vergleichbar VSCode-Settings, Notion-Workspace-Defaults, Slack-Personal-Overrides):

```
Plattform-Default
  ↓  Workspace-Owner kann ueberschreiben (gilt fuer alle Member)
Workspace-Override (workspace_hotkey_slots)
  ↓  User kann pro Slot ueberschreiben (gilt nur fuer ihn)
User-Override (user_hotkey_slots)
  ↓
Effektive Slot-Belegung fuer diesen User in diesem Workspace
```

Schema:

```sql
CREATE TABLE workspace_hotkey_slots (
  id           uuid PK,
  workspace_id uuid FK workspaces ON DELETE CASCADE,
  slot         text CHECK (slot IN ('1','2','3','4','5','6','7','8','9')),
  template_id  uuid FK feature_templates ON DELETE CASCADE,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (workspace_id, slot)
);

CREATE TABLE user_hotkey_slots (
  id           uuid PK,
  workspace_id uuid FK workspaces ON DELETE CASCADE,
  user_id      uuid FK auth.users ON DELETE CASCADE,
  slot         text CHECK (slot IN ('1','2','3','4','5','6','7','8','9')),
  template_id  uuid FK feature_templates ON DELETE CASCADE,
  created_at   timestamptz DEFAULT now(),
  UNIQUE (workspace_id, user_id, slot)
);
```

Read-Pfad: drei-Schicht-Lookup im Frontend (`lib/hotkey-slots.ts:resolveSlot(slot)`), Cache pro Workspace + User.

**RLS:**
- `workspace_hotkey_slots` SELECT: `is_workspace_member`. WRITE: `can_write_workspace` und User ist Workspace-Owner (Owner-only-Write).
- `user_hotkey_slots` SELECT/WRITE: nur Owner (`user_id=auth.uid()`).

**Realtime:**
- `workspace_hotkey_slots` ist Workspace-shared user-relevant → Realtime-Pflicht (§5.8). Wenn Owner Slot 3 aendert, sehen alle Member den neuen Hotkey sofort.
- `user_hotkey_slots` User-privat — Realtime nicht zwingend (Cross-Tab via `storage`-Event reicht). Wenn V1 ohne Realtime, dokumentieren in Migration-Header (Realtime-Konsistenz-Ausnahme begruenden).

**UI:**
- Workspace-Owner: `/w/:wsId/templates/` hat Tab „Workspace-Hotkeys" — Slot-Picker pro Slot mit Vorlage-Wahl.
- Member: `/w/:wsId/preferences/hotkeys` (User-Override) — gleicher Picker, nur fuer den User.
- Hotkey-Hint-Toolbar (siehe §8.4) zeigt effektive Belegung; bei User-Override ein kleiner Stift-Icon neben dem Slot-Label.
- Toast bei Workspace-Default-Aenderung wenn User-Override existiert: „Workspace-Default fuer Slot 3 geaendert auf X — dein Override bleibt aktiv. [Auf Workspace-Default zuruecksetzen]".

**Heptad-Slots:** beide Tabellen MCP-Tools `workspace.hotkey.set/clear/list` + `user.hotkey.set/clear/list` — Tool-Trio + Realtime-Garantie (§6.1) Pflicht.

### 6.3b Berechtigungsmatrix Plattform / Workspace / User-Vorlagen (User 2026-05-06 zu 6.4)

```sql
ALTER TABLE feature_templates ADD COLUMN visibility text NOT NULL DEFAULT 'user'
  CHECK (visibility IN ('platform','workspace','user'));
ALTER TABLE feature_templates ADD COLUMN owner_user_id uuid NULL FK auth.users ON DELETE SET NULL;
-- Plattform: workspace_id=NULL, owner=NULL, visibility=platform
-- Workspace: workspace_id=X,    owner=NULL, visibility=workspace
-- User:      workspace_id=X,    owner=Y,    visibility=user
```

| Aktion | Plattform-Vorlage | Workspace-Vorlage | User-Vorlage |
|---|---|---|---|
| **Lesen** | alle authentifizierten User | `is_workspace_member(X)` | `is_workspace_member(X) AND user_id=auth.uid()` |
| **Anlegen** | nur Plattform-Admin | `can_write_workspace(X) AND role IN (owner,editor)` | `is_workspace_member(X) AND user_id=auth.uid()` |
| **Bearbeiten** | nur Plattform-Admin | `can_write_workspace(X) AND role IN (owner,editor)` | nur Owner |
| **Loeschen** | nur Plattform-Admin (mit Loesch-Feedback §7.1) | nur Workspace-Owner (`role=owner`) | nur Owner |
| **Bulk-Apply auf Cells** | jeder mit `can_write_workspace` (Plattform = Read-only-Quelle) | `can_write_workspace` | `can_write_workspace` (User darf seine eigenen anwenden) |
| **Hotkey-Slot Workspace** | Workspace-Owner setzt | Workspace-Owner setzt | n/a — User-Vorlage geht in `user_hotkey_slots` |
| **„Im Feature-Wizard verfuegbar"** | n/a (Plattform immer im Wizard) | Workspace-Owner-Toggle | User-eigener Hotkey-Slot |
| **Plattform-weit-Global** | Plattform-Admin im `/admin/templates/` | n/a — Promote via Plattform-Admin | n/a |

**Promote-Pfad** (Workspace-Vorlage → Plattform-Vorlage): **nur Plattform-Admin-Push** in `/admin/templates/promote/:id` (User 2026-05-06 zu 6.4 #5). Plattform-Admin entscheidet eigenstaendig, kein User-Request-Flow in V1. Kopie wird angelegt, Original bleibt. (V2 ggf. User-Request-Inbox.)

**Demote-Pfad** (User-Vorlage → Workspace-Vorlage): User mit Owner/Editor-Rolle in `/templates/`-Liste-Aktion „Im Workspace veroeffentlichen". Kopie wird angelegt mit `visibility='workspace'`, `owner_user_id=NULL`.

**Plattform-Vorlage-Loeschen — Pflicht-Bericht** (User 2026-05-06 zu 6.4 #4): bevor Plattform-Admin eine Plattform-Vorlage loescht, zeigt das Loesch-Feedback-Modal die Anzahl betroffener Workspaces + Cell-Instanzen (z.B. „In 27 Workspaces, 1438 Cell-Instanzen"). Optionen wie in §7.1: Cells leeren / zu Blank-Feature konvertieren / Abbrechen. `pushUndo` + `showUndoToast` (extra wichtig wegen Reichweite).

**Viewer-Rolle:** kann KEINE Bulk-Apply-Aktionen ausfuehren (User 2026-05-06 zu 6.4 #3). `can_write_workspace` schliesst Viewer aus — implizite RLS-Konsequenz. Im UI ist der Slot-Hint-Toolbar im Edit-Mode fuer Viewer ausgegraut + Tooltip „Read-only-Mitglied".

**RLS-Implementation:** drei Policy-Bloecke pro `visibility`-Wert auf `feature_templates`. Detail-DDL in WV.A-Sprint. Adjacent-Cleanup-Auftrag (User 2026-05-06 zu 6.4 #6): existing RLS-Helper-Funktionen (`is_workspace_member`, `can_write_workspace`, `is_platform_admin`) reusen. Pruefen ob `is_workspace_owner(ws_id)` existiert — wenn nicht, anlegen als Single-Source.

### 6.3c `layout_version`-Pinning + Auto-Sync-Detail (final 2026-05-07 Re-Diskussion 6.8)

**Schema:**

```sql
ALTER TABLE feature_templates ADD COLUMN layout_version int NOT NULL DEFAULT 1;
ALTER TABLE cell_template_instances ADD COLUMN pinned_version int NOT NULL DEFAULT 1;
ALTER TABLE cell_template_instances ADD COLUMN is_locked bool NOT NULL DEFAULT false;
```

**Was bumpt `layout_version`** (User 2026-05-07 zu 6.8 #6 — Vorschlag b):

- ✅ Section/Column/Widget add / remove / move
- ✅ Filter-Conditions in einem Widget aendern
- ❌ Toggle-Aenderungen (comments/attachments/marker/header/edit_in_view) — **kein Bump**
- ❌ Vorlagen-Name oder Symbol — **kein Bump**
- ❌ `title_template` aendern — **kein Bump**

Begruendung: nur Strukturelles fuehrt zu Layout-Drift, der einen Update-Hint rechtfertigt. Toggle/Symbol/Name sind kosmetisch, sie wirken Auto-Sync trotzdem (auch bei `is_locked=true` werden sie nicht gepinnt).

**Auto-Sync-Trigger:** kein DB-Trigger, der ueber Cell-Instanzen iteriert. Der Render-Pfad nimmt `templates.layout_version` als Quelle (oder `pinned_version` wenn `is_locked=true`). „Just-in-Time-Sync".

**Schloss-Toggle-UI** (User 2026-05-07 zu 6.8 — **Edit-Mode-gated**, Memory `feedback_card_not_structural.md`-Linie):

- Position: kleines Icon in Cell-Header-Toolbar (rechts oben, vor Marker-Bereich Star/Eye).
- **Nur sichtbar/klickbar im Edit-Mode.** Out-of-Edit-Mode: Schloss-Icon ist nicht im DOM (Cell-Header bleibt aufgeraeumt).
- **Outline-Schloss** = `is_locked=false`. Hover „Auto-Sync mit Vorlage aktiv".
- **Filled-Schloss** in `--accent` = `is_locked=true`. Hover „Auf Version X gepinnt — Klick fuer Auto-Sync".
- Click toggelt mit `pushUndo` + `showUndoToast` + `clickPulse` (`animations.md` §2.15).

**Update-Hint-Banner** (User-Antwort implizit ueber „einziger Einwand"-Logik — Banner ist Information, immer sichtbar):

- Sichtbar wenn `is_locked=true AND pinned_version < layout_version` — **auch ausserhalb Edit-Mode**.
- Banner oben in Cell-View: „Vorlage hat Update verfuegbar (Version X → Y). [Anwenden] [Spaeter]".
- `[Anwenden]` triggert Edit-Mode-gated-Action — wenn User nicht im Edit-Mode, oeffnet sich der Edit-Mode (oder die Aktion wird abgelehnt mit Hint „Edit-Mode aktivieren").
- `[Spaeter]` dismisst lokal in localStorage (V1, kein Cross-Device-Sync — V2 ggf. Server-Side).

**Versions-Migration bei Pin-Update (V1: naive Version-Bump):**

- User klickt „Anwenden" → `pinned_version = current layout_version`.
- Existing `cell_widget_overrides` bleiben erhalten. Orphane Overrides (auf nicht mehr existierenden Widgets) werden beim Render uebersprungen — nicht geloescht.
- V2-Polish: Diff-Replay V2→V3→V4 mit Konflikt-Loesung pro Override-Feld.

**Realtime:** `feature_templates.layout_version`-Update wird ueber `feature_templates`-Subscribe broadcast. Cell-Instances mit `is_locked=false` re-rendern automatisch. Cell-Instances mit `is_locked=true` zeigen den Update-Hint-Banner.

**`cell_widget_overrides`-Cleanup beim Reset-to-Template** (siehe §5.3): alle `cell_widget_overrides` fuer die Instance geloescht. `pushUndo` + `showUndoToast`.

→ Hook 3.4 von 2026-05-05 ist hier final beantwortet.

Worksheet-Frage 6.1: Slot 1 wirklich unveraenderlich? 6.2: Slot-Overrides per Workspace, User oder beides? 6.3: Plattform-Default-Belegung wie oben?

### 6.4 Naming-Templates (final 2026-05-07 Re-Diskussion 6.5)

**Maximale Konsolidierung mit Welle D — kein neuer Mechanismus.** Pro Vorlage: `title_template: text` analog `docs.title_template` aus Welle D. Resolver: `lib/label-template.ts` (Single-Source).

**Variablen-Liste = Welle-D-Liste, nicht erweitert** (User 2026-05-07):

```
{row.object}      → Row-Object-Label (Fallback: row.label)
{column.object}   → Col-Object-Label (Fallback: col.label)
```

Beispiel: Vorlage „Info Vertrag" mit `title_template = "{row.object} — Vertrag"`. Bei Cell mit Row „Mueller AG" wird gerendert „Mueller AG — Vertrag".

**Konsolidierung mit name-cycle (User-Direktive 2026-05-07):**

- Im Vorlage-Editor definiert User EIN `title_template`.
- Beim Anlegen einer Cell mit dieser Vorlage geht der NewCellWizard in den Cycle-Step (Welle D O.8 Pattern, heute live).
- Das Vorlagen-`title_template` ist der **erste/primary Cycle-Vorschlag**. Enter uebernimmt es.
- User kann durch alternative Cycle-Optionen blaettern wie heute.

→ Eine Quelle. Vorlage-Editor und Cycle-Step sind synchron.

**UX:** kein neuer Variablen-Picker. Welle-D-Logik samt Tastenkombination (existing) wird reused — Vorlage-Editor nutzt dasselbe Eingabe-Pattern wie der Cycle-Step im NewCellWizard.

**Erweiterung der Variablen-Liste:** wenn kuenftig zusaetzliche Variablen noetig werden (z.B. `{cell.label}`, `{workspace.name}`, `{today}`), gehoert das in `lib/label-template.ts` als zentrale Erweiterung — nicht parallel im Vorlagen-Modell. V1 keine Erweiterung.

### 6.5 Symbol (final 2026-05-07 Re-Diskussion 6.6)

**Library: Heroicons V1.** https://heroicons.com — ~300 Icons, MIT-Lizenz, im Repo bereits via `Icon.tsx` (`IconName`-Type) eingebunden. Outline-Stil passt zur HyperUI-Aesthetik (`style.md` §3).

**Plattform-Default-Belegung 1-4** (passend zu §6.3-Slot-Tabelle):

| Slot | Vorlage | Heroicons-Name |
|---|---|---|
| 1 | Matrix | `squares-2x2` |
| 2 | Info | `information-circle` |
| 3 | Kanban | `view-columns` |
| 4 | Checkliste | `check-circle` |

**V1 Picker-Modal** — Search-Box + Grid mit allen Heroicons. Verwendet im:
- Save-as-Template-Modal (siehe §7.2).
- Vorlage-Editor in `/templates/edit/:id`.

**Picker-Komponente neu zu erstellen** (User 2026-05-07): kein bekannter existing Picker. Neue globale Komponente `components/IconPicker.tsx` als Single-Source. **Adjacent-Cleanup-Probe trotzdem beim Implementieren** — falls doch ein vergleichbares Pattern existiert (z.B. NewCellWizard Cycle-Step hat Icon-Wahl?), reuse statt Doublet.

**V2 Custom-Upload** (deferred): Storage-Bucket `template_symbols/` fuer User-eigene SVG-Uploads mit MIME-Validation + SVG-Sanitizer (XSS-Risk).

**Kein `symbol_color`** (User 2026-05-06 zu 6.7 — verworfen). `feature_templates`-Tabelle hat keine Color-Spalte.

---

<a id="7"></a>
## 7. Vorlagen-Verwaltung + Designer (final 2026-05-05)

User-Korrektur 2026-05-05: Beide Pfade A + B sind **V1**, nicht V1/V2-getrennt. Der WYSIWYG-Editor-Komplettausbau ist V2-deferred.

### 7.1 Pfad A — Vorlagen-Verwaltungs-Route (V1)

Neue Route `/w/:wsId/templates/`:

**Liste-View** (final 2026-05-07 zu 7.5):

- **Tab-Filter:** `Plattform` / **`Workspace` (Default)** / `Meine privaten` / `Alle`.
- **Search-Input** ueber Name + Beschreibung + Atom-Type-Mix.
- **Filter-Chip-Bar** (V1-optional): Atom-Type-Mix, Hotkey-Slot belegt, Usage-Count > 0.
- **Spalten pro Vorlage:**
  - Symbol · Name · Beschreibung · Sichtbarkeit-Badge · Hotkey-Slot · Usage-Counter („In N Cells") · letzte Aenderung · **Erstellt-von-Avatar** (nur sichtbar wenn Workspace mehrere aktive User hat — Memory `feedback_avatar_visibility_multiuser_only.md`) · Aktions-Trigger.
- **Sort-Default:** Sichtbarkeit (Plattform → Workspace → User-privat) → dann Name alphabetisch. Sortier-bare Spalten: Name, Hotkey-Slot, Usage-Counter, letzte Aenderung.
- **Aktions-Trigger pro Zeile** (drei Trigger-Pfade — Standard-Pattern aus existing Codebase):
  - **Drei-Punkte-Icon** rechts in der Zeile.
  - **Rechtsklick** auf die Zeile.
  - **Plus-Button** (Standard-Trigger gemaess existing Codebase-Pattern — Adjacent-Cleanup-Auftrag: pruefen wo der Plus-Trigger heute genutzt wird, gleiche Komponente reusen).
  Alle drei oeffnen denselben Action-Menue: Bearbeiten · Duplizieren · Hotkey-Slot zuweisen · Globaler-Toggle · Loeschen.
- **Empty-State** (kein Treffer): Icon + Hinweis „Keine Vorlagen gefunden" + Reset-Filter-Button.
- **Mobile-Layout** (`< --bp-md`, 48em): Card-Layout pro Vorlage statt Tabelle. Symbol+Name oben, Meta-Daten kompakt darunter, Action-Trigger rechts. Wird in der Implementierung mitgenommen (kein eigener Frontend-Design-Sprint).

**Animation:** List-Stagger beim Initial-Render (`animations.md` §2.5). Card-Insert-Animation bei „+ Neue Vorlage".

**Reuse-Anker (Adjacent-Cleanup):**
- Member-Liste in `/w/:wsId/settings/members/` als Pattern-Vorbild fuer Listen-Komponente, Action-Trigger-Set, Mobile-Card-Layout. Pruefen ob extrahier-bar als globale `WorkspaceListView`-Komponente.
- `useShowUserAvatars(workspace_id)`-Helper neu in `lib/workspace-presence.ts` (oder existing Presence-Lib) — Doublet-Verbot, Reuse fuer NavTree, Vorlagen-Liste, Marker-Counter.

**Aktion „Neue Vorlage":**
- Modal mit Wahl: (a) Leere Vorlage (eine Section, eine Column, kein Widget) oder (b) „Aus existing Cell-Feature" (Cell-Picker + Snapshot).
- Felder: Name + Symbol + Beschreibung + Hotkey-Slot (optional) + Sichtbarkeit (Workspace / privat).

**Aktion „Bearbeiten":**
- Sub-Route `/w/:wsId/templates/edit/:id` mit Editor (siehe 7.3).

**Aktion „Loeschen mit Feedback" (Pflicht):**
- Modal zeigt: „Vorlage X wird verwendet von **N Cells**".
- Optionen:
  - **Cells leeren** — Cell-Instanzen verlieren ihre Widgets, bleiben als „leere Cell mit Feature-Slot" zurueck. User kann neue Vorlage anwenden.
  - **Cells konvertieren zu Blank-Feature** — Layout wird mit den User-Overrides eingefroren, Cell-Instanz wird zur Blank-Vorlage (loose Kopplung loest sich).
  - **Abbrechen.**
- Loeschen ist **destruktiv** → `pushUndo` + `showUndoToast` (`code-quality.md` §8.1).
- Plattform-Vorlagen sind nicht loeschbar — Ausgrau + Tooltip „Plattform-Default".

**Aktion „Hotkey-Slot zuweisen":**
- Slot-Picker (1-9). Buchstaben-Slots erst V2.
- Konflikt-Check: zeigt aktuelle Slot-Belegung. Bei Override: Confirm-Modal „Slot 3 ist belegt mit Vorlage Y — ueberschreiben?".

**Aktion „Globaler Toggle":**
- Workspace-Owner: „Im Feature-Wizard verfuegbar (Workspace-weit)" on/off.
- Plattform-Admin (in Admin-Dashboard, separate Route): „Wirklich global SaaS-weit" on/off.

### 7.2 Pfad B — Save-as-Template aus existing Feature (V1, parallel zu A)

Im Cell-Edit-Mode-Toolbar Action „Als Vorlage speichern" → Modal:
- Felder Name + Symbol + Hotkey-Slot + Sichtbarkeit.
- Buttons:
  - „Direkt speichern" — Snapshot wird sofort als Vorlage angelegt, Modal schliesst.
  - „Im Designer weiter editieren" — Vorlage wird angelegt + Sub-Route Editor oeffnet.

Layout, Widget-Toggles, Konfiguration werden vom existing Cell-Feature kopiert. Atom-Inhalte werden **nicht** uebernommen — die Vorlage ist Layout, nicht Daten.

### 7.3 WYSIWYG-Layout-Editor (final 2026-05-07 Re-Diskussion 7.10)

**V1-Minimal** — gerade so viel wie der Save-as-Template-Workflow braucht:

- **Layout-Editing:** linke Section/Column/Widget-Liste mit Up/Down-Reorder + Drag-and-Drop.
- **Widget hinzufuegen:** „+ Widget"-Button → **Modal-Picker** (nicht Dropdown — Modal hat Platz fuer WidgetType-Beschreibung + Vorschau pro Type, lerne-orientiert).
- **„+ Section" / „+ Column" / „+ Widget"** als Action-Buttons.
- **Widget-Inspector** als rechte Sidebar fuer ausgewaehltes Widget — Filter-Builder-Modal-Trigger, Toggles (comments/attachments/marker/header/edit_in_view), Title-Override.
- **Inline-Edit** fuer Section-Titel + Title-Templates (Welle-D-Reuse `lib/label-template.ts`, kein neuer Picker — siehe §6.4).
- **Widget-Loeschen** mit Trash-Icon + Confirm-Modal.
- **Layout-Versioning:** strukturelle Aenderungen bumpen `layout_version` (siehe §6.3c), Toggle/Symbol/Name nicht.
- **Soft-Lock-Pattern fuer Multi-User-Edit (User 2026-05-07 zu 7.10 #3):**
  - Wenn User A einen Vorlagen-Editor oeffnet, broadcastet die existing **Live-Cursor-Infra (Welle P1.D, heute live)** ein Edit-Lock-Signal im Workspace-Channel — kein neues Schema, Reuse der Presence-Tabellen.
  - User B oeffnet den selben Editor → sieht Banner „User A editiert gerade — beobachten oder Sperre uebernehmen". User B kann:
    - **Beobachten:** Read-only-Editor mit Live-Refresh der A-Aenderungen (Welle-P1.D-Live-Cursor zeigt zusaetzlich Cursor-Position von A).
    - **Sperre uebernehmen:** Force-Acquire (Soft-Lock = nicht erzwungen, nur signalisiert). User A bekommt Toast „User B hat den Editor uebernommen" + sein Editor wechselt zu Read-only.
  - **Auto-Release:** Lock laeuft nach 5 Minuten Inaktivitaet ab oder bei Editor-Close.
  - **Heartbeat:** existing Presence-Heartbeat (max alle 2s ein Update, `architektur.md` §5.5) wird reused.

**V2-Komplettausbau** (deferred):
- Widget-Palette als Sidebar mit Drag-aus-Palette-in-Layout.
- Visual-Snap-to-Grid mit Live-Preview waehrend Drag.
- Layout-Templates (vorgefertigte Section-Schemata: 1-Col / 2-Col / 3-Col / Sidebar+Main / Hero+List).
- Diff-Preview vor Vorlage-Update („so sehen die N Cell-Instanzen mit dem Update aus").
- Versions-History (`layout_version` browsen, Rollback).
- Multi-User-OT/CRDT (statt Soft-Lock).
- Mobile-Editor (Touch-DnD).

**Cell-Instanz-Override mobile bleibt V1** (User 2026-05-07 zu 7.10 #4) — nur der Vorlagen-Editor ist Desktop-V1.

**Adjacent-Cleanup:**
- BoardView-DnD-Pattern (`lib/drag-context.ts`, `manifestation-cross-view.ts`) als Foundation reusen. Wenn beim Implementieren Drift auftaucht (z.B. veraltete Position-Logic — Q.1.c-Stil), als Adjacent-Refactor mitnehmen.
- Welle-P1.D Live-Cursor-Infra (`project_phase1_state.md`) fuer Soft-Lock-Pattern reusen — keine neue Tabelle.
- IconPicker (neu in §6.5) wird im Inspector-Sidebar fuer Widget-Symbol-Override genutzt.

### 7.4 Heptad-Slot 8 (Channel-Bridge) fuer feature_templates

`n/a` — Strukturdaten, kein User-Inhalt. Keine externe Channel-Verknuepfung noetig.

### 7.5 V1-User-Journey (durchgaengig)

1. User legt eine neue Cell an, waehlt im Wizard Default „Matrix" (= Slot 1) oder existing-Vorlage (Slot 2-9).
2. Wenn schon vorhanden: User waehlt „Leere Vorlage (Slot 6)" — Cell oeffnet sich mit Custom-Vorlage.
3. User klickt im Edit-Mode „+ Widget" → Widget-Picker.
4. User fuegt Widgets hinzu, konfiguriert Filter via Modal, setzt Toggles.
5. Action „Als Vorlage speichern" → Modal mit Speicher-Optionen (siehe 7.2). Slot 6 ist belegt.
6. **Alternativ**: User geht direkt in `/templates/` (Pfad A), legt eine leere Vorlage an, editiert im Designer, weist Hotkey-Slot zu.
7. Bulk-Apply: User wendet Slot 6 auf mehrere Zellen an (siehe §8).

---

<a id="8"></a>
## 8. Bulk-Action-Spec

User-Mental-Modell: *„Matrix im Edit-Mode: `Strg+A`, dann Taste `2` fuer Hinterlegen eines Info-Boards fuer alle Zellen."*

### 8.1 Selektions-Modell (final 2026-05-07)

Heute existiert **kein Multi-Select** auf Cells im Edit-Mode (Pruefung `MatrixView.tsx`). Neu: im Edit-Mode visualisiert die Cell-Hervorhebung Selektion.

**Mode-Scope:** ausschliesslich Edit-Mode (aligned mit `feedback_cell_click_semantics.md` — Hintergrund-Click ist Edit-Aktion). View-Mode-Multi-Select V1 nicht vorgesehen — V2-Frage falls spaeter Bulk-Tag/Bulk-Pin gewuenscht.

**Hotkeys:**
- `Strg+Click` toggelt einzelne Cell.
- `Strg+A` selektiert alle Cells der aktuellen Matrix-Ebene (per-Matrix-scoped — kein Recursing in Sub-Matrizen).
- `Shift+Click` selektiert Range zwischen letzter und aktueller Cell.
- `ESC` oder Click ausserhalb → Selektion clear.

**Auto-Clear-Trigger:**
- Drill-Up oder Drill-Down (Matrix-Wechsel).
- Edit-Mode-Verlassen.
- Workspace-Wechsel.

**Visuelles Feedback:**
- Selected-Cell: `outline: 0.125rem solid var(--accent-500)` (kein Border-Layout-Shift).
- Checkmark-Badge top-right der Cell, Heroicons `check-circle-solid`.
- Animation `expand-fade` (animations.md) beim Selektieren, `collapse-fade` beim Deselektieren.
- Animation Card-Insert-Stagger (animations.md §2.13) bei Bulk-Apply auf neu-erstellte Widgets.

**Globaler Store** `lib/cell-selection.ts` als Single-Source:
```ts
export const [selectedCellIds, setSelectedCellIds] = createSignal<string[]>([]);
export function selectCell(id: string): void;
export function deselectCell(id: string): void;
export function toggleCell(id: string): void;
export function selectRange(fromId: string, toId: string, matrixId: string): void;
export function selectAllInMatrix(matrixId: string): void;
export function clearSelection(): void;
export const selectionCount = () => selectedCellIds().length;
```
Konsumenten: `MatrixView.tsx` (Render), `EditModeToolbar.tsx` (Counter), `keyboard-nav.ts` (Strg+A/ESC), `cell-selection-hotkeys.ts` (Strg/Shift+Click), `bulk-apply-template.ts` (Mutation-Helper), Drill-Up/Down + Edit-Mode-Exit (Auto-Clear).

**Mobile/Touch:** V1 deferred. Long-Press-Pattern + Touch-Range-Select kommen V2 mit Mobile-Editor.

### 8.2 Hotkey-Routing + Bulk-Wizard-Flow (interim-final 2026-05-07)

Detail-Diskussion 2026-05-07 mit User. Die folgenden Konventionen sind verbindlich; einzelne Implementierungs-Komponenten sind global anzulegen gemaess `code-quality.md` §6.5.

#### 8.2.1 Hotkey-Inventar

| Hotkey | Wirkung | Trigger | Confirm |
|---|---|---|---|
| `Strg+Click` | Single-Toggle | sofort | nein |
| `Shift+Click` | Range selektieren (von letztem Anker bis Ziel) | sofort | nein |
| `Strg+A` | Alle Cells der aktuellen Matrix-Ebene | sofort | nein |
| `ESC` | Selektion clearen | sofort | nein |
| `Enter` (mit Selektion) | Bulk-Wizard oeffnen, Vorlage-Wahl in Step 1 | Wizard-Flow | im Wizard |
| `1-9` (mit Selektion) | Direkt-Bulk-Wizard mit Slot N vorausgewaehlt (Step 1 uebersprungen) | Wizard-Flow | im Wizard |
| `Alt+1-9` | **Vorlage destruktiv entfernen** von markierten Cells | DangerousDeleteModal | Pflicht + pushUndo + Liste |
| `Alt+Entf` (oder `Alt+Backspace`) | **Markierte Cells komplett leeren** (alle Vorlagen + Atome inkl. Sub-Strukturen) | DangerousDeleteModal mit Export-Checkbox + Fundus-Knopf | Pflicht + pushUndo + Liste |

Slot `1` (Matrix) bei Bulk-Apply (final 2026-05-07): **keine Sperre.** Drei Sub-Konventionen:

- (a) **Threshold N>1**: ab 2 selektierten Cells erscheint Confirm-Modal „N Sub-Matrizen werden angelegt — fortfahren? (alle leer)" mit pushUndo.
- (b) **Default-Inhalt leer**: neue Sub-Matrizen sind reine Matrix-Container ohne Standard-Cells.
- (c) **N=1 → NewCellWizard reusen**: bei einer einzelnen selektierten Cell wirft Slot 1 den existing NewCellWizard auf (alleiniger Cell-Anlage-Pfad — Doublet-Vermeidung).

#### 8.2.2 Bulk-Wizard-Flow

```
Selektion N Cells + Enter (oder 1-9)
↓
Step 1: Vorlage waehlen (uebersprungen wenn 1-9 direkt)
        Plattform / Workspace / User-Vorlagen, mit Symbol + Name + Hotkey-Hint.
↓
Step 1a (siehe 8.4): Skip-Liste fuer Cells mit Konflikt
        Sichtbar nur wenn ≥1 Cell konflikthaft (sonst uebersprungen).
        Checkbox pro Cell — Default markiert = ueberspringen,
        Abmarkieren = ueberschreiben/re-sync mit Confirm-Stufe.
        Konflikt-Tags: andere Vorlage / re-sync (alte layout_version) /
        overrides (Datenverlust-Warnung) / locked (Lock-Symbol +
        Force-Confirm wenn abmarkiert).
        Globale Komponente: BulkConflictPicker (siehe 8.2.4a).
↓
Step 2: Auto-Alias-Vergabe
        - Checkbox „Aliase automatisch vergeben" (Default an).
        - V1-Pattern: zusammengesetzt `{vorlage}-{row}-{col}`.
        - Bei Checkbox aus: alle Aliase leer.
        - Konflikt-Check: existing Aliase im Workspace nicht ueberschreiben — Suffix `-1`/`-2`/...
        - **BulkScalarInput-Komponente** (siehe §8.2.4) — Single-Input applies-to-all + Drilldown-Liste fuer Per-Row-Override.
↓
Step 3: Confirm + Submit
        - Anzahl + collapsible-Liste der Cells (Vorlage-Symbol, Cell-Coord, generierter Alias).
        - „N Cells anwenden"-Button + pushUndo + showUndoToast.
```

#### 8.2.3 Destruktive Aktionen — `DangerousDeleteModal`

`Alt+1-9` und `Alt+Entf` triggern eine **gemeinsame** Confirm-Komponente `DangerousDeleteModal` mit:
- Anzahl der betroffenen Cells.
- **Collapsible-Liste** der Cells (Default eingeklappt — bei 8x8 = 64 Zeilen sonst unbedienbar). Pro Eintrag: Cell-Coord + Inhalt-Vorschau (Vorlage-Name + Atom-Counts).
- **Export-Checkbox „Vor Loeschung exportieren"** — Default `an` (User-Direktive 2026-05-07: „doppelter Boden, falls man irrtuemlich bestaetigt hat"). Format JSON ueber existing Workspace-Export-Foundation.
- **Fundus-Knopf** „In Fundus verschieben" — angeboten **sobald Fundus implementiert** (siehe §14a). Bis dahin nur Hard-Delete + Export.
- `pushUndo` + `showUndoToast` Pflicht.

Komponente neu zu bauen — globale Anlage gemaess `code-quality.md` §6.5, `style.md`-Pattern „Loesch-Modal mit Export-Doppelboden" einzutragen bei Implementierung.

#### 8.2.4a BulkConflictPicker-Komponente (neu)

**Pattern:** Liste der konflikthaften Items (Cells / Atome / Tags / Channels) mit Checkbox pro Item, Group-Toggle „Alle (ab)markieren", Konflikt-Art-Tag pro Zeile, Default markiert=ueberspringen, Abmarkieren=Aktion mit Confirm-Stufe.

```
┌────────────────────────────────────────────────────────────────┐
│ Vorlage „Info Vertrag" wird auf 12 Cells angewendet.           │
│ Folgende Cells haben Konflikt — Default: ueberspringen.         │
│ Abmarkieren = ueberschreiben/re-sync (Nachfrage).               │
│ [✓ Alle markieren]  [☐ Alle abmarkieren]                       │
│                                                                 │
│ ✓  jan/kunde       — „Info Vertrag" v3 (gleich, aktuell)        │  ← Szenario B (still uebergangen ausserhalb Liste)
│ ✓  feb/lieferant   — „Kanban Default" v1   [andere Vorlage]     │  ← Szenario D
│ ✓  mar/projekt     — „Info Vertrag" v2     [re-sync v2→v3]      │  ← Szenario C
│ ✓  mar/kunde       — locked                [Schloss aktiv]      │  ← Szenario F (Force-Confirm bei Abmarkieren)
│ ✓  apr/projekt     — 4 Overrides           [Datenverlust]       │  ← Szenario E
│                                                                 │
│ [Zurueck]  [Weiter →]                                           │
└────────────────────────────────────────────────────────────────┘
```

Beim „Weiter": fuer **abmarkierte** Cells zweite Confirm-Stufe analog `DangerousDeleteModal`-Pattern (Datenverlust-Liste pro Cell, pushUndo Pflicht).

Reuse-Faelle: Bulk-Apply hier (Cells), Bulk-Tag (Atome), Bulk-Channel-Apply (Widgets), Bulk-Schema-Migration (Tabellen-Migration mit User-Konflikt-Wahl), zukuenftige Fundus-Restore-Konflikte.

Komponente neu zu bauen — globale Anlage gemaess `code-quality.md` §6.5, `style.md`-Pattern „Bulk-Conflict-Picker" einzutragen bei Implementierung.

#### 8.2.4 BulkScalarInput-Komponente (neu)

**Pattern:** Single-Input applies-to-all als Default + Drilldown-Button am rechten Ende, der eine Liste aufklappt fuer Per-Row-Edit. Auf/Ab-Hotkey navigiert.

```
┌─────────────────────────────────────────────────┐
│ Alias-Pattern: [info-{row}-{col}        ]  [⋮]  │
└─────────────────────────────────────────────────┘
                  │ Click [⋮]
                  ↓
┌─────────────────────────────────────────────────┐
│ jan/kunde:    [info-jan-kunde         ]   ↑↓   │
│ jan/lieferant:[info-jan-lieferant     ]        │
│ feb/kunde:    [info-feb-kunde         ]        │
│ ...                                              │
│ [✓ Uebernehmen] [Auf alle anwenden]              │
└─────────────────────────────────────────────────┘
```

Reuse-Faelle: Bulk-Alias-Vergabe (hier), Bulk-Tag-Vergabe (V2), Bulk-Naming-Override, Bulk-Field-Edit fuer typed `info_field`-Atome.

Komponente neu zu bauen — globale Anlage gemaess `code-quality.md` §6.5, `style.md`-Pattern „Bulk-Scalar-Input" einzutragen bei Implementierung.

#### 8.2.5 Atom-Loesch-Logik (Variante (c) — Single-Source-bewusst)

Bei `Alt+1-9` und `Alt+Entf` wird pro betroffenem Atom geprueft:

- Atom **ausschliesslich** in dieser Cell-Vorlage manifestiert → **Atom selbst loeschen** (oder in Fundus verschieben, wenn implementiert).
- Atom **auch in anderen Cells / anderen Vorlagen** manifestiert → **nur die Manifestation kappen**, Atom bleibt in den anderen Cells erhalten. Keine broken references.
- **Sub-Matrizen** als Atom: rekursive Mit-Verschiebung — gleiche (c)-Logik (nur loeschen wenn ausschliesslich hier).

Diese Logik wird in `bulk-delete-template`-Mutation als Postgres-Function gekapselt mit Realtime-Publication-Trigger pro betroffenem Atom (Architektur-Direktive §5.8 + §6.1).

#### 8.2.6 Toolbar-Button-Aequivalente (WCAG-Pflicht)

Jeder Hotkey braucht einen Toolbar-Button — stilsichere wiederverwendbare Loesung **bei Implementierung** entscheiden (User-Delegation 2026-05-07). `style.md`-Reuse statt Neuanlage bevorzugen, sonst neuer Standard-Eintrag.

#### 8.2.7 Code-Skizze

```ts
// lib/keyboard-nav.ts erweitert
installBulkSelectionHotkeys({
  isActive: () => editMode(),
});
installBulkApplyHotkey({
  isActive: () => editMode() && selectionCount() > 0,
  onEnterOrSlot: (slotOrEnter: 'enter' | 1 | 2 | ... | 9) => openBulkWizard(slotOrEnter),
  onAltSlot: (slot: number) => openDangerousDeleteModal('remove-template', slot),
  onAltDelete: () => openDangerousDeleteModal('clear-cells'),
});
```

### 8.3 `bulkApplyTemplate`-Verhalten

Idempotent + transaktional pro Cell, optimistic + offline-fallback via `lib/safe-mutation.ts`:

1. Pro Cell: pruefen ob Cell die Vorlage schon hat (`cell_template_instances`).
2. Wenn ja: User-Confirm „Layout zuruecksetzen?" (Reset-to-Template) oder Skip.
3. Wenn nein: Vorlage anwenden = Insert in `cell_template_instances`, Default-Widgets aus `template_widgets` rendern.
4. `pushUndo` + `showUndoToast('Vorlage auf 5 Zellen angewendet')` — Undo entfernt alle Instances.

### 8.4 UX-Affordances (final 2026-05-07)

#### 8.4.1 Selektions-Counter (8.6 final)

Pill-Counter rechts in der Edit-Mode-Toolbar: „N Zellen ausgewaehlt". Animation `count-bump` (Welle-T existing) bei Selektions-Aenderung. Reuse existing Pill-Style (`<Badge>` falls existing, sonst HyperUI-Pill-Pattern). Keine neue Komponente.

#### 8.4.2 Slot-Hint-Toolbar (8.7 final, Komponente neu)

`SlotHintToolbar` (neu, globale Anlage gemaess `code-quality.md` §6.5):

- **Sichtbarkeit:** Edit-Mode aktiv → Toolbar **immer sichtbar** (auch ohne Selektion). User soll vor Selektion sehen, was passieren wird.
- **Layout:** 9 Slot-Buttons (~2.5rem × 2.5rem) in Reihe, Symbol oben + Hotkey-Zahl als Subscript unten rechts.
- **Hover/Focus:** Tooltip mit Vorlage-Name, z.B. „Hotkey 3: Info Vertrag".
- **Click:** triggert Bulk-Wizard fuer Slot N (Touch-Aequivalent fuer 8.2.6 WCAG-Pflicht). Ohne aktive Selektion: Hint-Toast „selektiere zuerst Cells".
- **Slot-Status:**
  - Belegt → Symbol + Tooltip-Detail.
  - Leer → gedimmt + Plus-Hover, Click oeffnet `/w/:wsId/templates/` fokussiert auf Slot-Picker.
- **Drei-Schicht-Inheritance-Indikator:** Plattform-Default = kein Indikator; Workspace-Override = blauer Punkt unten links; User-Override = gelber Punkt unten rechts.
- **Position in Toolbar:** links neben Selektions-Counter (8.4.1).
- **Mobile (< 48em):** collapse zu Dropdown „Slots ▾" (Touch-Aequivalent fuer Hardware-Hotkeys).

`style.md`-Pattern „Slot-Hint-Toolbar" einzutragen bei Implementierung.

#### 8.4.3 Animation

Card-Insert-Stagger (animations.md §2.13, 30 ms) auf neu-erstellte Widgets nach Bulk-Apply.

#### 8.4.4 Toolbar-Button-Aequivalente (WCAG-Pflicht)

Jeder Hotkey aus 8.2.1 hat ein Toolbar-Button-Aequivalent — stilsichere wiederverwendbare Loesung **bei Implementierung** entscheiden (User-Delegation 2026-05-07). `style.md`-Reuse statt Neuanlage bevorzugen.

---

<a id="8a"></a>
## 8a. Zero-Shift-Edit-Mode (Querschnitt-Direktive — eng gefasst, User 2026-05-07)

**Pflicht-Direktive (eng gefasst):** Beim **Edit-Mode-Toggle** (View↔Edit) **duerfen die Edit-Affordances Cell/Card/Item-Positionen nicht verruecken**. Edit-Affordances (X-Buttons, Toolbars, Verschiebepfeile, Drag-Handles, Selection-Outlines, Slot-Hint-Toolbar) erscheinen als Overlay-Layer.

**Content-Updates duerfen Layout schieben** — neue Karten in einer Spalte, Card-Inline-Expand (Mini ↔ Expanded), neue Items in einer Checkliste, Spalten-Wachstum, Item-Add. KEIN Zero-Shift-Verstoss.

User-Quote 2026-05-07: *„bei Aktivierung des edit modes ein Zero-Shift Modell gelten soll. also es soll sich nicht der ganze canvas verändern und verschieben, sondern es sollen Elemente (x, Toolbars, Verschiebepfeile usw) hinzukommen ohne Inhalte zu verrücken"*.

User-Praezisierung 2026-05-07: *„damit ist rein der edit Modus gemeint. die Spalte soll kein Scrollcontainer sein und es duerfen auch die anderen Karten nach unten ruecken. in diesem Fall wuerde Zero-Shift nur dort Anwendung finden: wenn ich auf Karten bin und in den edit mode gehe, dann kann ich die Spalten via Symbole vertauschen und loeschen. diese Symbole duerfen zu keiner Verrueckung des canvas/der spalten fuehren."*

### 8a.1 Geltungsbereich (Querschnitt durch Welle WV) — eng gefasst

**Zero-Shift-Pflicht (Edit-Mode-Toggle):**
- §8.1 Selektions-Modell — Outline statt Border, Checkmark-Badge als Overlay.
- §8.4.1 Selektions-Counter — Pill-Counter als Floating-Element in Toolbar.
- §8.4.2 Slot-Hint-Toolbar — als Overlay-Bar, kein Layout-Push beim Toggle.
- §8.4.4 Toolbar-Button-Aequivalente — als Overlay-Buttons.
- §6 Vorlagen-Modell · Designer-Edit-Mode (Welle WV.A) — Inspector-Sidebar als Overlay.
- §9 Cross-View-Drag-Affordances — Drag-Handles als Overlay-Pseudo-Elements.
- §13 Toggles-Edit-Mode-UI — Toggle-Modal als Overlay.
- Matrix-Edit-Mode — Spalten/Zeilen-Add-Buttons + Reorder-Pfeile + X-Buttons als Overlay.

**Erlaubt zu schieben (Content-Updates):**
- §9.7 checklist × kanban Card-Expand — Spalte waechst beim Inline-Expand. OK.
- Item-Add in Spalte / Checkliste — Container waechst. OK.
- Spalten-Add (auch im Edit-Mode getriggert) — Layout waechst. OK.
- Atom-Inline-Edit — Card waechst. OK.

### 8a.2 Manifest-Verankerung

- `style.md` §6.4 — Pflicht-Patterns + Anti-Patterns + Pre-Commit-Probe (DOM-Coordinate-Test, **nur fuer Edit-Mode-Toggle**).
- `animations.md` §3 — Layout-Shift-Animation **beim Edit-Mode-Toggle** als Anti-Pattern.
- `CLAUDE.md` „Was NICHT tun" — Zero-Shift-Pflicht-Eintrag (eng gefasst).
- `feedback_zero_shift_edit_mode.md` (Memory) — Top-Level-Sicherung ueber Sessions, eng gefasst.

### 8a.3 Pre-Commit-Probe (nur Edit-Mode-Toggle)

Beim Implementieren jeder Edit-Mode-Affordance:
- Cell-`getBoundingClientRect()` vor und nach Edit-Mode-**Toggle** muss identisch bleiben (Toleranz < 1px Sub-Pixel-Rendering).
- Outline statt Border bei Selektion / Hover-Edit.
- Toolbar via `position: absolute|fixed`, nicht via Flex/Grid-Insertion **beim Toggle**.
- Animation `expand-fade` (nicht `expand-slide` / `accordion-down`) **fuer das Toggle-Affordance**.
- Reduced-Motion respektieren.

**NICHT pruefen** bei Content-Aktionen (Card-Expand, neue Items, neue Spalten/Karten — diese sind erlaubt zu schieben).

### 8a.4 Praezisierungs-Vorfall 2026-05-07

Erste Manifest-Fassung war zu breit (impliziert „Card-Expand ist Zero-Shift-Verstoss"). User-Klarstellung: Spalte ist kein Scroll-Container, Card-Expand darf Spalten-Layout schieben. Manifest umgehend nachgebessert in `feedback_zero_shift_edit_mode.md`, `style.md` §6.4, `animations.md` §3, `CLAUDE.md`, `widget-vorlagen-foundation.md` §8a.

---

<a id="9"></a>
## 9. Cross-View-Drag-Matrix

User: *„Kanban-Karte in Checkliste · Checkliste in Kanban-Karte · alles in Kalender — sollte heute schon gehen."*

Audit (Stand 2026-05-04, nach Welle T.AC + Q.2):

| Atom-Typ ↓ \ Manifestation-Kind → | kanban | checklist | calendar | standalone |
|---|---|---|---|---|
| **task** | ✅ live | ✅ live | ✅ live (Welle T.AC.D) | ✅ live |
| **link** | ❌ Drop-Target fehlt (`BoardView:457` lehnt link ab) | ❌ Drop-Target fehlt (`ChecklistPanel:148` lehnt link ab) | ✅ live (`SidebarCalendarMini` → `dropAtomOnDate`) | ✅ live (atom_pins parent_kind='cell') |
| **checklist** | ❌ Drop-Target fehlt (Konzept sagte „live" — Code lehnt ab) | ⚠ Drop in andere Checklist nicht akzeptiert; Sub-Items inline | ✅ live (`SidebarCalendarMini`) | ✅ live |
| **doc** | ❌ Drop-Target fehlt | ❌ Drop-Target fehlt | ❌ Drop-Target fehlt (`SidebarCalendarMini` hat keinen `doc`-Branch) | ✅ live (atom_pins parent_kind='cell', Welle D) |
| **imported_event** | ❌ heute → ✅ live nach WV.WV (Drag-Source freigeschaltet) | ❌ heute → ✅ live nach WV.WV | ✅ live (read) + ✅ Wiedervorlage-Manifestation auf andere Calendar-Slots (WV.WV) | ❌ heute → ✅ live nach WV.WV (Cell-Pin via Generic-Drop) |
| **info_field** (post-WV.B) | ✅ live nach WV.B+WV.WV (Drag aus Form-Widget-Field-Row) | ✅ live nach WV.B+WV.WV | ✅ live nach WV.B+WV.WV (auto bei value_type='date' via §9.C Auto-Adapter, Vorlage-Toggle §13) + Adapter-Dialog bei Drop in Link-Widget (value_type='url') | ✅ live nach WV.B+WV.WV (Cell-Pin) |

Legende: ✅ live · ⚠ live mit Caveat · ❌ fehlt · TBD = im Konzept zu entscheiden.

**Audit-Code-Pfade (Stand 2026-05-07):**

- **Drag-Source** (`drag-context.ts`): `DragAtomType = 'task' | 'link' | 'doc' | 'checklist'` — 4 draggable Atome.
- **Drop-Target Filter heute:**
  - Kanban-Spalte / Kanban-Karte / Checklist-Container / Calendar Hour-Slot: `accepts: src.atom === 'task'` — **nur task**.
  - Calendar Mini (`SidebarCalendarMini`): `task` + `link` + `checklist` — **doc fehlt**.
- **Helper-Layer:**
  - `manifestation-cross-view.ts` (`dropOnKanbanCol`, `dropOnChecklist`): hartes `taskId`-Argument — nicht generisch.
  - `manifestation-move.ts` (`moveByDate`, `moveByTime`): nur task.
  - `atom-manifestations.ts` (`dropAtomOnDate`): **generisch** (alle 5 atom_types), wird aber nur in einem Drop-Target gerufen.
- **Doc-Architektur-Drift:** Doc lebt heute via `atom_pins(parent_kind='cell')`, NICHT via `atom_manifestations`. Doc kann nicht in Kanban/Checklist/Calendar erscheinen — strukturelles Atom-Verankerungs-Doublet (siehe §9.A Konsolidierung).

Worksheet §9 ist auf Audit-Stand 2026-05-07 aktualisiert (Diskrepanzen 9.4 / 9.5 / 9.7 zu 2026-05-04-Stand).

---

<a id="9a"></a>
## 9.A Goldlösung Generic-Standard — atom_pins-Konsolidierung + Generic-Drop-Refactor

User-Direktive 2026-05-07 zu §9: *„alles in Richtung gold-generic-standard. wenn pins unnoetig bzw via manifestations Tags auch abbildbar, dann natuerlich so durchfuehren, dass taggen UND drop ueberall moeglich ist."*

### 9.A.1 Architektur-Entscheidung — atom_pins → atom_manifestations(kind='pinned')

**Konsolidierungs-Pfad (Option A, User-bestaetigt 2026-05-07):**

`atom_pins` (Welle D, Migration 063) ist **strukturell redundant** zu `atom_manifestations` — beide sind polymorphe Atom→Container-Junctions, nur mit unterschiedlichen Container-Domains. Konsolidierung in eine Tabelle:

```sql
ALTER TABLE atom_manifestations
  ADD COLUMN container_kind text NULL
  -- 'kanban-col' | 'checklist' | 'calendar' | 'cell' | 'atom' | 'node'
  -- (heute nur kanban-col/checklist/calendar implizit aus kind, neu: cell/atom/node)
  ;

ALTER TYPE atom_manifestation_kind ADD VALUE IF NOT EXISTS 'pinned';
-- pinned ist die Welle-D-Variante: container_kind ∈ {cell, atom, node}.
-- kanban/checklist/calendar haben implizit container_kind aus kind ableitbar.
```

**Migration-Strategie:** Clean-Cut (Memory `feedback_clean_cut_no_prod_data.md`) — heute nur staging-Bestand, ~2 Pins. atom_pins wird in atom_manifestations(kind='pinned')-Rows kopiert, dann atom_pins gedroppt. Cascade-Trigger werden in atom_manifestations re-kodiert.

**Code-Auswirkung:**
- `lib/atom-pins.ts` → entfaellt, alle Funktionen wandern als `kind='pinned'`-Methoden in `lib/atom-manifestations.ts`.
- `components/AtomPickerModal.tsx`, `components/DocsPopup.tsx`, `lib/docs-open.ts`, `lib/docs-ui.ts`, `lib/subtree-import.ts` → `parentKind`/`parent_kind` re-named zu `containerKind`/`container_kind`. Calls re-routed.
- MCP-Tools (Welle D.X.M `atom-pin.ts`) → re-routed auf `atom_manifestations(kind='pinned')`.
- Export/Import (Welle D.X.E) → atom_pins-Block entfaellt, atom_manifestations-Block deckt es mit ab.

### 9.A.2 atom_tags bleibt unangetastet (fachliche Bewertung)

Alle 4 `workspace_tags.kind`-Werte (`freetext` / `atom_ref` / `object_ref` / `alias_ref`) bleiben erhalten. Trennung zu atom_manifestations:

| Pfad | Semantik | Render-Wirkung | Filter-Wirkung |
|---|---|---|---|
| `atom_manifestations(kind='pinned', container_kind='atom')` | strukturelle Render-Verankerung | sichtbar — Atom A erscheint in der Render-Hierarchie von Atom B | nein |
| `atom_tags(kind='atom_ref')` | klassifikatorische Verknuepfung | unsichtbar — nur als Tag-Pill | ja — User filtert „zeige alle mit Tag X" |

**Kein Doublet** — semantisch verschieden. Bestaetigt User 2026-05-07 fachliche Bewertung.

### 9.A.3 Generic-Drop-Refactor

**Helper-Generic** in `lib/atom-manifestations.ts`:
- `dropAtomOnKanbanCol(atomType, atomId, colId, ...)` — generisch fuer task/link/doc/checklist.
- `dropAtomOnChecklist(atomType, atomId, checklistId, ...)` — generisch.
- `dropAtomOnCalendar(atomType, atomId, date, ...)` — bereits live als `dropAtomOnDate`, generisch.
- `dropAtomOnCell(atomType, atomId, cellId, ...)` — neu (entspricht heute atom_pins(parent_kind='cell')).
- `dropAtomOnAtom(atomType, atomId, parentAtomType, parentAtomId, ...)` — neu (entspricht heute atom_pins(parent_kind='atom')).
- `dropAtomOnNode(atomType, atomId, nodeKind, nodeId, ...)` — neu (entspricht heute atom_pins(parent_kind='node')).

**Drop-Target `accepts:`-Filter aufweichen** in BoardView, ChecklistPanel, SidebarCalendarMini, SidebarDayView, Hauptkalender-Route — **alle 5 Atom-Typen** akzeptieren (post-WV.WV inkl. imported_event-Drag-Source-Freischaltung — siehe §9.12).

**imported_event-Spezial (§9.12):**
- DragAtomType erweitert um `'imported_event'` (5. draggable Atom-Type).
- Drop-Targets akzeptieren imported_event als Manifestation; Source `external_events` bleibt read-only.
- Calendar-zu-Calendar-Drop = Wiedervorlage-Manifestation (eigener display_meta-Snapshot, nicht Move).
- Source-Update beim ICS-Sync: Title syncs in display_meta, Datum bleibt Snapshot.
- Card-Edit-Mode: kein ✏️-Button, nur X-Button zum Manifestation-Loeschen.

**Render-Polymorphie:** Card-Komponente in BoardView wird polymorph (`Card<AtomType>`) — pro Atom-Type Render-Variante mit Atom-Type-Icon + atom-spezifische Quick-Actions. ChecklistPanel-Item analog.

### 9.A.4 atom_tags-Drift-Audit (Adjacent-Cleanup)

Im selben Sprint:
- Pruefen ob heute Code-Pfade `atom_tags(kind='atom_ref')` strukturell missbrauchen (als Render-Verankerung statt Filter). Wenn ja: re-routen auf `atom_manifestations(kind='pinned')`.
- Pruefen ob `atom_pins` heute klassifikatorisch missbraucht wird. Bei Drift-Befund: re-routen auf `atom_tags`.

### 9.A.5 Sprint-Verankerung — `WV.WV` (Sechs Outputs)

Kombinierter Pre-WV.A-Sprint, deferred (Timing TBD):

1. **atom_pins-Konsolidierung** (Schema-Migration + Code-Refactor + Cascade-Trigger).
2. **Generic-Drop-Refactor** (manifestation-cross-view.ts generic, alle Drop-Targets erweitert).
3. **atom_tags-Drift-Audit** (Status-Bestaetigung).
4. **DragHoverNavigator-Komponente** (§9.B Querschnitt-Pattern).
5. **WidgetPicker-Komponente** (§9.10b — generisch, ueberholt KanbanColPicker). Zeigt alle kompatiblen Widget-Slots in der Cell, **Root-Widgets prominent gelistet** (oben). Multi-Root-Disambiguierung pro Cell mit mehreren Vorlagen.
6. **Card<AtomType>-Polymorphie** in BoardView + ChecklistPanel-Item.

Plus Konzept-File-Erweiterung §6.2: `feature_templates.root_widget_id` als Default-Drop-Target-Pointer.

Output: korrigierte Cross-View-Matrix wird zu **alle 4 draggable Atome × alle Manifestation-Kinds** ✅ live (außer imported_event read-only).

Verankert im BACKLOG `I-WV)` als `WV.WV`. Siehe BACKLOG-Update 2026-05-07.

### 9.A.6 Multi-Root-Widget-Disambiguierung (User-Klarstellung 2026-05-07)

User-Klarstellung 2026-05-07 zu §9.10: *„bedenke dass es mehrere Features geben kann, die Checklist als root Widget haben."*

Eine Cell kann mehrere Vorlagen-Instanzen haben (`cell_template_instances`-Mehrfach-Zuordnung). Mehrere davon koennen Checklist als Root-Widget setzen.

**Atom-Drop/Paste-Routing in Cell mit N Vorlagen:**

1. Sammle alle kompatiblen Widget-Slots (atom_type passt zu Widget-Type) ueber alle Vorlagen-Instanzen der Cell.
2. Sortiere: **Root-Widgets zuerst** (markiert via `feature_templates.root_widget_id`), dann andere kompatible.
3. Routing:
   - **0 kompatible Slots** → Confirm-Modal „Neue Vorlage anlegen?" mit Vorlagen-Auswahl.
   - **1 kompatibler Slot (Root oder non-Root)** → direkt einfuegen.
   - **≥2 kompatible Slots, davon ≥2 Root-Widgets** → `WidgetPicker` mit Root-Widgets prominent (oben), non-Root-Widgets als Fallback-Option.
   - **≥2 kompatible Slots, genau 1 Root-Widget** → direkt im Root-Widget einfuegen (Konvention: Root hat Vorrang).
   - **≥2 kompatible Slots, kein Root-Widget** → `WidgetPicker` mit allen kompatiblen Slots.
4. User kann **immer** ueber `WidgetPicker` umentscheiden — auch wenn Auto-Routing eindeutig waere (Modifier-Key z.B. `Shift+Drop` oeffnet immer Picker).

---

<a id="9b"></a>
## 9.B Drag-Hover-Navigation (Querschnitt-Direktive, User 2026-05-07)

User-Direktive 2026-05-07 zu §9.6c: *„muss ich mit dem gedraggten Element aber auch zum Kalender navigieren koennen."* Plus weitere Use-Cases bei §9.9, §9.10, §9.13 (CSV-Antworten):

> *„doc ziehen in den NavTree → Ablage bei Feature mit Kanban-Board → Dialog mit Spaltenauswahl kommt (evtl. schon bei drag-hover am Desktop)."*  
> *„das Canvas wird gaussian verschwommen + Nav-Sidebar klappt auf (falls verschlossen) mit kurzem Puls des NavTree-Bereichs."*  
> *„bei Ziehen + Hover ueber Navbar geht entsprechendes Widget auf (mit drag-hover navigierbar) und dann in den Widgets ablegbar."*

Ein Pattern, vier Use-Cases — Querschnitt durch Sektion 9.

### 9.B.1 Pattern-Definition

**Trigger:** User drag-t ein Atom (`task` / `link` / `doc` / `checklist`) + hovert ueber NavTree-Trigger oder Drag-Hover-Hint im Canvas.

**Verhalten:**
1. NavTree-Sidebar expandiert (falls collapsed) mit kurzem Puls (`animations.md`-Helper).
2. Canvas-Bereich (alles ausserhalb NavTree) wird **gedimmt + gaussian-blurred** via `backdrop-filter: blur(0.25rem)` — Fokus auf Navigation.
3. Drag-State bleibt aktiv (`activeDrag()`-Signal aus `lib/drag-context.ts` haelt durch).
4. User navigiert durch Tree per Hover (Drill-Down auf Hover, Drill-Up nach Verlassen).
5. Hover ueber Cell mit kompatiblem Feature (Kanban / Checklist / Calendar / etc.) → Cell expandiert visuell, zeigt Drop-Targets in den enthaltenen Widgets.
6. Drop landet im aktuell gehoverten Widget, Canvas + NavTree kehren in Pre-Drag-Zustand zurueck.

**Zero-Shift-Pflicht (§8a):** NavTree-Expand und Canvas-Dimming sind Overlay-Layer — keine Layout-Verschiebung der Cell-Inhalte.

### 9.B.2 Reuse-Faelle (Sektion 9)

| Use-Case | Auswirkung |
|---|---|
| 9.6c link/mail × calendar (Hauptkalender) | Drag link aus Sidebar-Liste → Hover NavTree → Cell mit Calendar-Feature → Drop |
| 9.9 doc × kanban | Drag doc → Hover NavTree → Cell mit Kanban-Board → Spaltenauswahl-Dialog |
| 9.10 doc × checklist | Drag doc → Hover NavTree → Cell mit Checklist (Root-Widget-Logik) |
| 9.13 info_field × kanban | Drag info_field → Hover Navbar → Widget oeffnet → Drop in Kanban |

Plus generell jeder „Drag von A nach Cell-Y-mit-Feature-Z"-Pfad jenseits sichtbarem Drop-Target.

### 9.B.3 Sub-Pattern: Doc-Editor → NavTree-Suche (§9.10)

Aus dem Doc-Editor: User markiert Liste → Aktion „Als Checkliste anlegen" → Dialog mit Alias-Eingabe + Autovervollstaendigung + Suche. **Absprung-Button „in NavTree suchen"** — bei Klick:
- Dialog graut (dimmed)
- Canvas wird gaussian-blurred
- NavTree-Sidebar oeffnet (mit Puls)
- User waehlt Cell durch Hover/Click
- Checklist wird in der gewaehlten Cell angelegt

Das ist eine **Modal→NavTree-Wahl-Variante** des Drag-Hover-Pattern, ohne aktiven Drag — Picker-as-NavTree.

### 9.B.4 Komponente — `DragHoverNavigator` (neu)

Anlage gemaess `code-quality.md` §6.5. Reuse-faehig fuer alle 4 Use-Cases + Modal-Variante.

**Steuert:**
- NavTree-Expand-on-Drag-Hover (mit Puls-Animation)
- Canvas-Dimming via `backdrop-filter: blur(0.25rem)` mit Token
- Drag-State-Erhaltung ueber NavTree-Navigation hinweg
- Drop-Target-Detection in expandierten Cells

**Nutzt:**
- `lib/drag-context.ts` `activeDrag()`-Signal
- Animation-Helper aus `lib/animations.ts` (Pulse + Backdrop-Blur)

**Zero-Shift-konform** — alle Effekte als Overlay, keine Layout-Verschiebung.

`style.md`-Pattern „Drag-Hover-Navigator" einzutragen bei Implementierung.

### 9.B.5 Manifest-Verankerung

- `style.md` Komponenten-Standards: Pattern „Drag-Hover-Navigator" mit Backdrop-Blur-Token + Pulse-Animation.
- `feedback_drag_hover_navigation.md` (Memory) — Top-Level-Pattern.
- `animations.md` — Pulse + Backdrop-Blur als Helper-Calls dokumentieren bei Implementierung.

### 9.B.6 Sprint-Verankerung

Eingang in `WV.WV` (vierter Output zusaetzlich zu atom_pins-Konsolidierung + Generic-Drop + atom_tags-Drift-Audit). Siehe BACKLOG-Update 2026-05-07.

---

<a id="9c"></a>
## 9.C Cross-Type-Drop-Adapter (Querschnitt-Pattern, User 2026-05-07 zu §9.13.7)

User-Wunsch 2026-05-07 zu §9.13.7: *„bei Link sollte ein/der Dialog oeffnen um Anzeigetext oder URL anzupassen?"*

Generalisiert: wenn ein Atom-Type-A auf einen Widget-Slot gedroppt wird, der einen **anderen** Atom-Type-B erwartet, ist ein **Adapter-Schritt** noetig. Beispiele:

- `info_field(value_type='url')` → Link-Widget (Anzeigetext + URL adapten)
- `info_field(value_type='date')` → Calendar (auto-Adapter, siehe §9.14)
- `doc` → Kanban-Card (Title + Excerpt-Snippet)
- `link` → Doc-Pin (Anchor-Text)
- `task.deadline` → Calendar (existing, virtual-Manifestation)

### 9.C.1 Pattern-Definition

**Trigger:** Drop von Atom-Type-A auf Widget mit Atom-Type-B-Erwartung.

**Adapter-Dialog:**
- Default-Mapping aus den Atom-A-Feldern (z.B. info_field.label → Link.anzeigetext, info_field.value → Link.url).
- User-Override pro Feld moeglich (Inputs vor-befuellt, editierbar).
- Submit erzeugt Atom-B (oder Pseudo-Atom mit Snapshot-Werten in display_meta — wenn Source-Atom referentiell bleibt).
- Abbruch verwirft Drop.

### 9.C.2 Auto-Adapter ohne Dialog

Wenn das Mapping **eindeutig** ist (z.B. `info_field(value_type='date')` → Calendar mit `start_date=value`), kann der Adapter **ohne Dialog** durchgereicht werden — User bestaetigt nur per Drop.

Heuristik:
- 1:1-Feld-Mapping ohne Mehrdeutigkeit → kein Dialog.
- Mehrere Felder zu mappen oder unklare Quelle → Dialog mit Vorbelegung.

### 9.C.3 Bekannte Adapter-Faelle (V1)

| Source-Atom | Drop-Target | Adapter-Form |
|---|---|---|
| info_field(value_type='url') | Link-Widget | Dialog: Anzeigetext (Default label) + URL (Default value) |
| info_field(value_type='date') | Calendar | auto: start_date=value, label=info_field.label |
| info_field(value_type='currency') | Kanban-Card | direkt: Title=label, Value=formatted (kein Dialog) |
| info_field(value_type='text') | Doc-Pin | Dialog: einbetten als Text-Block oder als Reference-Pin? |
| doc | Kanban-Card | direkt: Title + Mini-Excerpt 80 Zeichen (kein Dialog) |
| link | Doc-Pin | direkt: Anchor mit URL + Label |
| task.deadline (virtual) | Calendar | existing (Welle T.AC.D.1) |

Erweiterung pro neuem Atom-Type oder Widget-Type folgt der Pattern-Definition.

### 9.C.4 Manifest-Verankerung

- `style.md` §6.x — `AdapterDialog`-Komponente als Reuse-Pattern (Anlage gemaess `code-quality.md` §6.5 bei Implementierung).
- `widget-vorlagen-foundation.md` §9.C — Querschnitt-Direktive.

### 9.C.5 Sprint-Verankerung

WV.WV-Output-Erweiterung um `AdapterDialog`-Komponente (7. Output) — generischer Mapping-Dialog mit Default-Vorbelegung + Submit-Adapter-Logik. Konkrete Adapter-Faelle (info_field→Link, doc→Kanban etc.) als Sub-Output beim Implementieren der jeweiligen Drop-Targets.

---

<a id="9-14"></a>
## §9.14 Auto-Calendar-Manifestation aus `info_field(value_type='date')`

**Status 2026-05-09 — LIVE seit Welle WV.E #37** (Migration 082 `082_info_field_auto_calendar.sql`). T1 (info_field-update), T2 (info_manif-insert), T3 (info_manif-delete) Postgres-Trigger pflegen die Auto-Manifestations-Liste mit `display_meta.auto = true`. `lib/calendar.ts` rendert die Auto-Eintraege zusammen mit den manuell gedroppten Calendar-Manifs. Vorlage-Toggle `template_widgets.config.toggles.date_field_auto_calendar` (default `true`) erlaubt pro Calendar-Widget das Auto-Verhalten abzuschalten. Manual-Delete-Block in `lib/atom-manifestations.ts` verhindert dass User Auto-Manifs direkt loescht (Re-Sync wuerde sie wieder erzeugen). Diagnose-MCP-Tool `manif.calendar.auto.list` (`bridge/src/tools/manif-calendar-auto.ts`) listet pro Workspace alle Auto-Manifs read-only.

User-Direktive (Konzept-Pass 2026-05-08): *„wenn ein info_field als Datum getypt ist, soll das automatisch im Kalender erscheinen — ohne dass der User extra droppen muss."*

Querschnitt zu §9.C (Cross-Type-Drop-Adapter) — der **Auto-Adapter ohne Dialog**-Fall: Date-Typed Info-Felder bekommen automatisch eine Calendar-Manifestation, mit Vorlage-Toggle als Off-Switch (§13.10 `date_field_auto_calendar`).

### 9.14.1 Architektur-Entscheidung — Auto-Manifestation pro Info-Manifestation

**Problem:** `info_fields` sind **workspace-scoped** (Migration 072), nicht cell-scoped. Eine direkte `info_field(value_type='date')` → `atom_manifestations(kind='calendar')`-Auto-Erzeugung haette **keinen Cell-Container** — Calendar-Renderer wuesste nicht, in welchem Cell-Kontext der Termin erscheint.

**Loesung — Mirror per Info-Manifestation:** Die Calendar-Manifestation wird **gespiegelt** zu jeder existing `atom_manifestations(atom_type='info_field', kind='info', container_kind='cell')`-Row. Eine Info-Manifestation in Cell C → eine Calendar-Manifestation in Cell C.

```
info_fields(id=F1, value_type='date', value='2026-05-15')
  ↓
atom_manifestations(atom_id=F1, kind='info', container_kind='cell', container_id=C1)
atom_manifestations(atom_id=F1, kind='info', container_kind='cell', container_id=C2)
  ↓ (Auto-Trigger)
atom_manifestations(atom_id=F1, kind='calendar', container_kind='cell', container_id=C1, display_meta={date:'2026-05-15', auto:true})
atom_manifestations(atom_id=F1, kind='calendar', container_kind='cell', container_id=C2, display_meta={date:'2026-05-15', auto:true})
```

`display_meta.auto = true` markiert die Auto-Manifestation — User kann sie nicht direkt deleten (re-creates beim naechsten Trigger), nur via Vorlage-Toggle abschalten.

### 9.14.2 Trigger-Logik (Postgres)

Ein Postgres-Trigger pflegt die Auto-Manifestations-Liste. Drei Eintritts-Punkte:

| Trigger | Auf | Aktion |
|---|---|---|
| `T1: info_field-update` | `AFTER UPDATE OF value, value_type ON info_fields` | re-sync alle Calendar-Auto-Manifs der Info-Manifs des Atoms |
| `T2: info_manif-insert` | `AFTER INSERT ON atom_manifestations WHERE kind='info' AND atom_type='info_field'` | wenn `info_fields.value_type='date'`: Calendar-Auto-Manif erzeugen |
| `T3: info_manif-delete` | `AFTER DELETE ON atom_manifestations WHERE kind='info' AND atom_type='info_field'` | korrespondierende Calendar-Auto-Manif (gleiche cell + atom_id) loeschen |

**Re-Sync-Flow (T1):**

```sql
CREATE OR REPLACE FUNCTION public._info_field_auto_calendar_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_date date;
BEGIN
  -- value_type-Wechsel weg von 'date' → alle Auto-Manifs purgen.
  IF NEW.value_type <> 'date' THEN
    DELETE FROM public.atom_manifestations
    WHERE atom_type = 'info_field' AND atom_id = NEW.id
      AND kind = 'calendar' AND (display_meta ->> 'auto')::boolean = true;
    RETURN NEW;
  END IF;

  -- value-Parse (ISO 8601 'YYYY-MM-DD' oder Postgres-date-castable).
  -- Bei NULL/leer/parse-fail → keine Calendar-Manif (silent skip).
  BEGIN
    v_date := NEW.value::date;
  EXCEPTION WHEN others THEN
    DELETE FROM public.atom_manifestations
    WHERE atom_type = 'info_field' AND atom_id = NEW.id
      AND kind = 'calendar' AND (display_meta ->> 'auto')::boolean = true;
    RETURN NEW;
  END;

  -- UPSERT pro existing Info-Manifestation. Spiegelt nur cell-scoped
  -- Info-Manifs (container_kind='cell') — workspace-globale Info-
  -- Manifestations bekommen keine Calendar-Auto-Manif (kein Cell-
  -- Kontext fuer Calendar-Render).
  INSERT INTO public.atom_manifestations (
    atom_type, atom_id, workspace_id, kind, container_id, container_kind,
    position, level, display_meta
  )
  SELECT
    'info_field', NEW.id, m.workspace_id, 'calendar', m.container_id, 'cell',
    0, NULL,
    jsonb_build_object('date', v_date::text, 'auto', true, 'source', 'info_field')
  FROM public.atom_manifestations m
  WHERE m.atom_type = 'info_field' AND m.atom_id = NEW.id
    AND m.kind = 'info' AND m.container_kind = 'cell'
  ON CONFLICT (atom_type, atom_id, kind, container_kind, container_id)
  DO UPDATE SET display_meta = EXCLUDED.display_meta;

  RETURN NEW;
END;
$$;
```

`UNIQUE(atom_type, atom_id, kind, container_kind, container_id)` muss als Constraint auf `atom_manifestations` existieren — falls nicht, Migration ergaenzt.

### 9.14.3 Vorlage-Toggle (§13.10 `date_field_auto_calendar`)

Per Vorlage-Toggle in `template_widgets.config.toggles.date_field_auto_calendar` kann der User Auto-Calendar **pro Vorlage** abschalten:

| Toggle-Wert | Verhalten |
|---|---|
| `true` (Default) | Auto-Trigger laeuft, Calendar-Manif wird erzeugt |
| `false` | Trigger-Function checkt vor INSERT die Vorlage der Cell-Info-Section, bei `false` wird **keine** Auto-Manif erzeugt |

**Konsequenz fuer Trigger:** ein zweiter Filter nach Cell-Info-Manif-Lookup — JOIN auf `cell_template_instances` + `template_widgets.config.toggles.date_field_auto_calendar`. Bei `false`: skip.

### 9.14.4 Edge-Cases

| Fall | Verhalten |
|---|---|
| `value` ist NULL oder leer | keine Auto-Manif (silent skip in Trigger) |
| `value` parse-Fail (kein gueltiges Datum) | bestehende Auto-Manifs purgen, neue nicht erzeugen |
| `value_type` wechselt von `date` → `text` | alle Auto-Manifs des Atoms purgen |
| `value_type` wechselt von `text` → `date` | Trigger T1 feuert → Auto-Manifs erzeugen fuer alle existing Info-Manifs |
| User loescht eine `kind='calendar'`-Auto-Manif manuell | re-creates beim naechsten T1/T2-Feuer (Auto-Marker = Source-of-Truth) |
| Cell-Info-Manifestation per Drag entfernt | T3 feuert → korrespondierende Calendar-Auto-Manif loeschen |
| `display_meta.date` muss von Calendar-Renderer gelesen werden | `lib/calendar.ts` ergaenzen — auto-info-field-Pfad analog `task` |
| User editiert Calendar-Auto-Manif `display_meta.time` (z.B. 14:30) | erlaubt — `time` ist nicht im Trigger-Diff, bleibt persistent. Zeitslot-Manif-Teil ist User-Daten. Re-Sync ueberschreibt nur `date` + `auto` + `source` |

### 9.14.5 Schema-Heptad-Pflege

| Slot | Aenderung |
|---|---|
| Schema | Migration `082_info_field_auto_calendar_trigger.sql` — Trigger T1+T2+T3 + ggf. UNIQUE-Constraint |
| Types | n/a — `display_meta.auto` ist im JSONB, keine TS-Type-Aenderung noetig |
| Mutations | `lib/atom-manifestations.ts` — `auto`-Marker bei Manual-Delete-Versuch toasten („wird vom System gepflegt") |
| Cache | n/a — Realtime-Subscribe deckt es ab |
| Realtime | n/a — `atom_manifestations` ist schon im publication |
| Export | `display_meta.auto`-Manifs muessen beim Import **idempotent** behandelt werden (re-creates beim ersten Trigger-Feuer; Direkt-Import erzeugt kein Duplikat dank UNIQUE-Constraint) |
| MCP | `manif.calendar.auto.list` (Read-only) — Liste der Auto-Manifs eines Atoms fuer Diagnose |
| Channel-Bridge | n/a |

### 9.14.6 V2-Erweiterung — `date_range`-Feldtyp

Konzept §12.1 V2-Kandidat `date_range` (zwei Datumsfelder mit Start/End). Auto-Calendar-Manifestation wuerde dann eine `display_meta.range = {start, end}` setzen statt `display_meta.date`. Trigger-Logik bleibt strukturell gleich, nur die Parse-Logik unterscheidet.

**V2-Defer:** kein `date_range`-Type in V1 — siehe §12.1.

### 9.14.7 Sprint-Verankerung

Welle **WV.E** Item #37: „Auto-Calendar-Manifestation aus info_field(value_type='date') via Postgres-Trigger." Aufwand-Schaetzung: ~1.5d (Migration + Trigger + Calendar-Renderer-Pfad + Vorlage-Toggle-Filter + Tests).

**Reihenfolge:**

1. Migration 082 mit T1+T2+T3 + UNIQUE-Constraint-Check.
2. `lib/calendar.ts` — `auto`-Source erkennen + rendern.
3. `lib/atom-manifestations.ts` — Manual-Delete-Block fuer `auto`-Manifs.
4. `template_widgets.config.toggles.date_field_auto_calendar` Default `true` in Migration 071-Vorlagen-Seed.
5. `template-config.ts` Toggle-UI in Designer.
6. Smoke + Realtime-Test.

**Manifest-Verankerung:** `architektur.md` §3 (Schema-Heptad) bleibt unveraendert. `widget-vorlagen-foundation.md` §10.4 wird von „TBD" auf „§9.14 final 2026-05-08" aktualisiert.

---

<a id="10"></a>
## 10. Kalender als Universal-Linse (final 2026-05-07)

User: *„Wichtig waere alles in den Kalender."*

**Status nach §9 + §13:**

| Atom | Calendar-Drop | Status |
|---|---|---|
| **task** | live mit display_meta.time + range + Recur (Welle T.AC.D) | ✅ §9.3 |
| **link / mail** | live als Wiedervorlage (Welle T.AC.D.1) | ✅ §9.6 + Click-Action 9.6a |
| **checklist** | live als Wiedervorlage | ✅ §9.8 + Click-Action 9.8a (Items-Preview-Modal) |
| **doc** | post-WV.WV (SidebarCalendarMini doc-Branch + ManifestationAtomType erweitert) | ✅ §9.11 + Click-Action analog 9.8a |
| **info_field** (post-WV.B) | Auto-Manifestation bei `value_type='date'` via §9.C Auto-Adapter | ✅ §9.14 + Vorlage-Toggle §13.10 `date_field_auto_calendar` |
| **imported_event** | nativer Calendar-Atom + Wiedervorlage in andere Slots (post-WV.WV) | ✅ §9.12 + DragAtomType erweitert |

### 10.1 Calendar-Outbound-Sync (final 2026-05-07, Welle WV.E)

User-CSV 2026-05-07: *„ja wichtig, gerne hinten angereiht."*

Heute hat Welle I nur **Inbound** (ICS/Google/Outlook → atom_manifestations). Outbound (atom_manifestations → User-Calendar) **fehlt komplett**.

**Provider-Liste V1:**
- **Google Calendar** (Calendar-API, OAuth-Write-Scope).
- **Outlook / Microsoft 365** (Graph-API, OAuth-Write-Scope).
- ICS-Subscribe entfaellt (Read-only-Format, kein Outbound-Pfad).

**Bidirektionalitaet:** 
- Tool schreibt in User-Calendar (Outbound).
- Updates aus External (z.B. User verschiebt den Termin in Outlook) syncen zurueck (analog Welle T.AC.D Calendar-Update — bestehender Inbound-Pfad).
- Konflikt-Aufloesung: External-Last-Write-Wins (User-Edit in Outlook hat Vorrang ueber Tool-Edit, weil User-Calendar = User-Hoheit).

**OAuth-Re-Auth beim Aktivieren:**
- Bei der Outbound-Aktivierung explizit Re-Consent mit Calendar-Write-Scope (vorher nur Read).
- User-Erwartung: „neue Permission" dialog beim Aktivieren — kein stiller Scope-Upgrade.

**Sprint-Verankerung:** Welle **WV.E** „Cross-View-Komplettierung" im BACKLOG. Gleicher Provider-Cluster wie §13.1 Comments + Welle I Inbound.

#### 10.1.1 Schema-Architektur (Konzept-Pass 2026-05-08)

**Zwei neue Tabellen** + bestehende Welle-I-Inbound-Tabellen werden bidirektional gekoppelt:

| Tabelle | Status | Rolle |
|---|---|---|
| `external_events` (Migration 059) | bestehend | Inbound — Provider→Matrix Mirror, Source-of-Truth fuer importierte Termine |
| `outbound_calendar_targets` | **NEU** | User-bound: pro User pro Provider-Calendar das Outbound-Ziel + Sync-State |
| `outbound_event_links` | **NEU** | Junction: atom_manifestations.id ↔ Provider-Event-ID + last_synced_at + last_external_update |

`outbound_calendar_targets`:

```sql
CREATE TABLE outbound_calendar_targets (
  id              uuid pk default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  provider        text not null check (provider in ('google','outlook','m365')),
  external_cal_id text not null,                -- z.B. 'primary' bei Google
  external_cal_name text,                       -- Display-Label fuer UI
  enabled         boolean not null default true,
  last_full_sync_at timestamptz,
  last_sync_token text,                         -- Provider-Sync-Token (Google syncToken / Graph deltaToken)
  scope_granted   text not null,                -- 'read' | 'write' — write nach Re-Auth
  created_at      timestamptz not null default now(),
  UNIQUE (user_id, workspace_id, provider, external_cal_id)
);
```

`outbound_event_links`:

```sql
CREATE TABLE outbound_event_links (
  id                 uuid pk default gen_random_uuid(),
  manifestation_id   uuid not null references atom_manifestations(id) on delete cascade,
  target_id          uuid not null references outbound_calendar_targets(id) on delete cascade,
  external_event_id  text not null,             -- Provider-Event-ID (Google eventId / Graph id)
  external_etag      text,                      -- fuer If-Match-Check bei Updates
  last_synced_at     timestamptz not null default now(),
  last_external_update timestamptz,             -- aus External-Pull → Conflict-Resolution
  sync_state         text not null check (sync_state in ('clean','dirty_local','dirty_remote','conflict','deleted_remote')),
  UNIQUE (manifestation_id, target_id),         -- ein Mirror pro Manifestation pro Target
  UNIQUE (target_id, external_event_id)         -- ein Mirror pro External-Event pro Target
);
```

`atom_manifestations` (kind='calendar') bleibt unangetastet — `outbound_event_links` ist die Junction.

#### 10.1.2 Sync-Flow Outbound (atom_manifestations → Provider)

**Trigger statt Polling:** Postgres-Trigger auf `atom_manifestations` (AFTER INSERT/UPDATE/DELETE WHERE kind='calendar') schreibt einen Eintrag in `outbound_sync_queue` (eigene Tabelle, FIFO, claimable).

```sql
CREATE TABLE outbound_sync_queue (
  id                uuid pk default gen_random_uuid(),
  manifestation_id  uuid not null,               -- ohne FK — Cascade-Delete-tolerant
  op                text not null check (op in ('upsert','delete')),
  enqueued_at       timestamptz not null default now(),
  claimed_at        timestamptz,
  claimed_by        text,                        -- worker-id
  attempts          int not null default 0,
  last_error        text
);
```

**Worker (`outbound-sync-bridge`-Service)** — analog `mail-bridge` / `oauth-bridge` (Welle WV.D):
- Pollt `outbound_sync_queue` alle 30s (claim mit `UPDATE … RETURNING`-Pattern).
- Pro Job: liest `atom_manifestations` + alle `outbound_calendar_targets` des `workspace_id` + `user_id` mit `enabled=true` + `scope_granted='write'`.
- Pro Target: Upsert-Call zur Provider-API (Google: events.insert/patch/delete; Graph: events POST/PATCH/DELETE).
- Persistiert `outbound_event_links` mit external_event_id + last_synced_at + sync_state='clean'.
- Bei Provider-Error (Network, 5xx, Rate-Limit): attempts++, retry mit exponential backoff. Bei 4xx (Auth-Fail, Calendar-not-found): sync_state='conflict', User-Notification.

**Service-Foundation:** `infra/services/outbound-sync-bridge` mit eigener systemd-Unit + .env (DATABASE_URL, SUPABASE_JWT_SECRET, fuer Provider-Calls Service-User-Tokens aus user_oauth_tokens).

#### 10.1.3 Sync-Flow Inbound-Bidirektional (Provider → atom_manifestations)

Bestehender Welle-I-Inbound-Pfad (calendar-inbound-sync) ergaenzt um:
- **Sync-Token-Tracking** in `outbound_calendar_targets.last_sync_token` (Google sync-token / Graph delta-token) — incremental sync statt full-refresh.
- **External-Last-Write-Wins-Logik:** wenn ein external_event in `outbound_event_links` referenziert ist (= wir haben ihn outbound geschrieben) und der External-`updated`-Zeitstempel > `last_synced_at`: External-Update ueberschreibt die Matrix-`atom_manifestations.display_meta` (Datum, Time, Recur).
- **Conflict-Detection:** wenn external `updated` > `last_synced_at` UND lokal in Matrix in derselben Zeit eine Mutation erfolgte (atom_manifestations.updated_at > last_synced_at): sync_state='conflict', User-Notification mit Choice-Dialog (Local-keep / Remote-keep / Both-as-separate).

#### 10.1.4 OAuth-Re-Auth-Flow (Scope-Upgrade)

Bestehender `lib/oauth-flow.ts` (Welle WV.D.3.f) nutzt PKCE oder Server-Side-Bridge. Outbound-Aktivierung erfordert **Calendar-Write-Scope** zusaetzlich zum Welle-I-Read-Scope:

| Provider | Read-Scope (heute) | Write-Scope (NEU) |
|---|---|---|
| Google | `https://www.googleapis.com/auth/calendar.readonly` | `https://www.googleapis.com/auth/calendar.events` |
| Microsoft Graph (Outlook/M365) | `Calendars.Read` | `Calendars.ReadWrite` |

**UX:**
1. User klickt „Outbound aktivieren" pro `outbound_calendar_target`.
2. Frontend prueft `user_oauth_tokens.scopes_granted` — wenn write-Scope fehlt: redirect zu OAuth-Re-Authorize mit erweitertem Scope-Set.
3. User sieht Provider-Consent-Screen mit „neue Permission: Kalender bearbeiten".
4. Nach Consent: Token wird geupdated (`user_oauth_tokens.scopes_granted` += write-scope), `outbound_calendar_targets.scope_granted='write'` gesetzt.
5. Auto-Initial-Sync: alle existing `atom_manifestations(kind='calendar')` werden in `outbound_sync_queue` als `op='upsert'` enqueued.

**Stille Scope-Upgrades sind verboten** — User muss aktiv re-konsentieren (Memory `feedback_admin_dashboard_config_gate.md`).

#### 10.1.5 Edge-Cases

| Fall | Verhalten |
|---|---|
| User loescht Outbound-Target | `outbound_event_links`-CASCADE entfernt Junctions. Provider-Events bleiben — User kann sie manuell loeschen oder Tool bietet „Aufraeumen"-Bulk-Aktion. |
| User loescht atom_manifestation | CASCADE auf outbound_event_links → Trigger enqueued `op='delete'` mit external_event_id-Snapshot. Worker macht DELETE-Call zum Provider. |
| External-Event geloescht (Google: status=cancelled) | sync_state='deleted_remote', User-Notification. Tool-seitig bleibt das atom_manifestations bestehen — User entscheidet ob er es auch loescht. |
| Multi-Day-Event (start_date != end_date) | Direkt mappable: Google-Event + Graph-Event unterstuetzen Range natuerlich. |
| Recur-Event (display_meta.recur) | RRULE-Mapping: Welle T.AC.D-Recur-Format → iCalendar-RRULE (RFC 5545). Provider-API akzeptiert RRULE-Strings direkt. |
| Time-Zone | atom_manifestations.display_meta.time ist Workspace-Local-Time (kein TZ-Modell heute). Outbound-Sync schreibt mit `timeZone=workspace.tz` (neues Feld in `workspaces` — V2-Defer, V1 verwendet UTC + User-Browser-TZ). |
| User hat 2+ Outbound-Targets fuer denselben Workspace | Jede Manifestation wird in jedes Target gespiegelt — pro Target eine `outbound_event_links`-Row. Beispiel: User hat Privat-Google-Cal + Arbeit-Outlook-Cal beide aktiv → jeder Termin landet in beiden. |
| Provider-Rate-Limit | exponential backoff im Worker. Max-Attempts=10, danach sync_state='conflict' + User-Notification. |
| Provider-Token-Expiry waehrend Sync | Worker triggert Token-Refresh via `lib/oauth-tokens.ts`-RPC. Bei Refresh-Fail: attempts erhalten, retry beim naechsten Worker-Run. |

#### 10.1.6 Schema-Heptad-Pflege

| Slot | Aenderung |
|---|---|
| Schema | Migration `083_calendar_outbound.sql` — 3 neue Tabellen + RLS + Trigger + Realtime. |
| Types | `lib/types.ts` — `OutboundCalendarTargetRow`, `OutboundEventLinkRow`, `OutboundSyncQueueRow`. |
| Mutations | `lib/calendar-outbound.ts` — CRUD fuer `outbound_calendar_targets` (User-bound). `outbound_event_links` ist System-gepflegt — Frontend nur Read. |
| Cache | `outbound_calendar_targets` als IDB-Store (User-private, Workspace-scoped). `outbound_event_links` nicht im Cache (read-on-demand fuer Settings-UI). |
| Realtime | `outbound_calendar_targets` + `outbound_event_links` in `supabase_realtime`-Publication, REPLICA IDENTITY FULL. Subscribe in `realtime.ts`. UI-Bumps: Settings-Page (Target-Liste) + Calendar-Render (Sync-Status-Indicator). |
| Export | `outbound_calendar_targets` ist **user-private** (analog `user_oauth_tokens`) — NICHT im Export. `outbound_event_links` ebenfalls nicht (re-creates beim ersten Worker-Run nach Import). |
| MCP | `calendar_outbound.target.list` / `.set` / `.disable` — User-API fuer Targets. `calendar_outbound.queue.status` als Read-only-Diagnose (analog `manif.calendar.auto.list`). |
| Channel-Bridge (§14.3 8. Slot) | n/a — Outbound-Sync IST der Channel-Pfad. Native Calendar-Manifs sind die Source. |

#### 10.1.7 Sprint-Verankerung

Welle **WV.E** Item #38: „Calendar-Outbound-Sync (Google + Outlook + Microsoft365, bidirektional mit External-Last-Write-Wins, OAuth-Re-Auth mit Calendar-Write-Scope)." Aufwand-Schaetzung: ~5-6d.

**Reihenfolge:**

1. Migration 083: Schema + RLS + Trigger fuer `outbound_sync_queue`-Enqueue.
2. `lib/calendar-outbound.ts` + `lib/types.ts`-Erweiterung + Realtime-Subscribe.
3. `lib/oauth-flow.ts` Scope-Upgrade-Pfad + Settings-UI „Outbound aktivieren" pro Provider-Target.
4. `infra/services/outbound-sync-bridge` Service: Worker-Loop + Provider-API-Adapter (Google + Graph).
5. systemd-Unit + nginx-Config + One-Time-Bootstrap-Doku.
6. Settings-UI „Outbound-Targets verwalten" (Liste + Aktivieren/Deaktivieren + Sync-Status pro Target).
7. Calendar-Render-Pfad: Sync-Status-Indicator pro Event („synced ✓ / dirty ⏵ / conflict ⚠").
8. Conflict-Resolution-Dialog (External-Last-Write-Wins-Default + Override-Optionen).
9. MCP-Tools (Read-only-Diagnose).
10. Smoke-Tests + 2-Tab-Realtime-Tests + Cross-Provider-Roundtrip.

**V2-Defer:**
- ICS-Outbound (statt Provider-API) — niche, ICS ist Read-only-Format, Outbound waere ein eigenes File-Sharing-Setup.
- Time-Zone-Modell auf Workspace-Ebene (`workspaces.tz` + tz-aware atom_manifestations).
- Recur-Edge-Cases (Exception-Dates, Modified-Instances) — V1 syncs nur regulaere Recur-Events.

**Manifest-Verankerung:** `architektur.md` §3 Schema-Heptad bekommt 3 neue Tabellen-Eintraege. `architektur.md` §7 Bridge bekommt Hinweis auf den 4. Self-hosted-Service `outbound-sync-bridge` (analog `alias-resolve`/`oauth-bridge`/`mail-bridge`).

### 10.2 Cross-Reference-Tabelle (alle anderen 10.x-Items)

10.1 link → calendar = §9.6 final.  
10.2 checklist → calendar = §9.8 final.  
10.3 doc → calendar = §9.11 final.  
10.4 Auto-Calendar aus Date-Field = §9.14 final 2026-05-08 + §13.10 final.

---

<a id="11"></a>
## 11. Smart-Summary als Auto-Render-Vorlage (final 2026-05-07)

**Architektur-Klarstellung User 2026-05-07:** *„Smart Summary in keinen Slot — wird bereits gerendert, direkt unter den Features."*

Smart Summary ist **kein Hotkey-Slot-basierter Vorlagen-Type** — sondern ein **Auto-Render-Pattern**: in jeder Cell-Darstellung wird die Smart-Summary direkt unter den Cell-Features automatisch gerendert (existing Pfad: `MatrixView.tsx:1103` rendert `CellTaskSummary`).

### 11.1 Render-Position-Discriminator

`feature_templates.render_position` (siehe §6.2 Schema-Erweiterung):
- `'hotkey_slot'` (Default): Vorlage ueber Hotkey/Wizard auswaehlbar.
- `'auto_under_features'`: Vorlage wird automatisch unter den Cell-Features gerendert (Smart Summary).

**Smart Summary** ist die **einzige Plattform-Vorlage** mit `render_position='auto_under_features'` in V1.

### 11.2 Default-Widgets (final 2026-05-07, 6 Widgets aus Stub)

User-Korrektur: Original-Stub-Liste 1:1 (Vertragsende-Countdown verworfen — zu spezifisch).

| Sektion | Widget-Type | data.source | Filter |
|---|---|---|---|
| Kommende Tasks | `task-list` | query | `atomType=task, deadline >= today, status NOT IN (done, archived)` |
| Anstehende Termine | `calendar` | query | `kind=calendar, range=next-7-days` |
| Ueberfaellige Tasks | `task-list` | query | `atomType=task, deadline < today, status NOT IN (done, archived)` |
| Haeufige Links | `link-list` | query | `atomType=link, sort=click_count DESC, limit=10` |
| Letzte Docs | `doc-list` | query | `atomType=doc, sort=updated_at DESC, limit=10` |
| Activity-Stream | `activity` | aggregate | `sources=[external_channels, mutations_log, atom_comments_native_optin]` |

### 11.3 Toggles — Comments + Attachments entfallen

**User-Korrektur 2026-05-07:** *„warum braucht smart summary Attachments und comments? denke das sollte weg"*

Smart-Summary-Widgets haben **kein** Comment-Toggle und **kein** Attachment-Toggle. Smart Summary ist Read-Only-Aggregat — Kommentare gehoeren ans einzelne Atom (nicht ans Aggregat-Widget). Attachments sind nicht relevant fuer Aggregat-Listen.

Aktive Toggles fuer Smart-Summary-Widgets:
- `markers=on` (User-Star/Eye sichtbar pro Atom-Eintrag)
- `header=on` (Section-Title sichtbar)
- `edit_in_view`: pro Widget-Type (task-list/checklist=true via §13.5)

### 11.4 Scope-Toggle Cell vs. Cell+Substruktur (final 2026-05-07)

**User-Direktive:** *„mir geht die Auswahl ab ob nur cell oder cell + substruktur wenn submatrix vorhanden — kann sonst auch ein toggle auf der smart summary Feature page selbst sein"*

**Scope-Toggle direkt auf der Smart-Summary-Render-Sektion** (oben rechts oder im Header):
- `cell_only` (Default): Smart Summary scannt nur die aktuelle Cell.
- `cell_plus_substructure`: rekursiv ueber alle Sub-Matrizen / Sub-Cells.

Pro Cell-Instanz **persistent** in `cell_widget_overrides` (analog Smart-Summary-User-Override).

### 11.5 Filter-Flexibilitaet

**User-Vorgabe:** *„max Flexibilitaet"* — alle Filter-Builder-Conditions aus §5.2.2 verfuegbar (atom_types / by_object / by_tag / by_alias_pattern / by_atom_attr / sort / limit + AND/OR-Kombinationen).

User kann pro Widget den Filter im Vorlage-Designer (§7.10) anpassen. Plattform-Defaults (siehe 11.2) sind nur Startpunkte.

### 11.6 User-Override sparse via `cell_widget_overrides`

User kann pro Cell Smart-Summary-Widgets ausblenden / hinzufuegen / umordnen — sparse-Overrides in `cell_widget_overrides` (existing in §5.3 + §6.3a). Vorlage-Update zieht ueber non-overridete Widgets, Overrides bleiben.

### 11.7 `link.click_count` V1-Pflicht (LIVE 2026-05-09)

**Status:** LIVE. Migration 073 hat `click_count int DEFAULT 0` Spalte + RPC `mcp_increment_link_click_count(p_link_id)`. Code-Pfad seit 2026-05-09 verkabelt.

**Code-Pfad:**
- `lib/link-clicks.ts` — `incrementLinkClickCount(linkId)` Best-Effort-Helper. RPC-Call mit Promise-Wrap, swallows Errors silent (Click-Tracking blockt nie den User-Flow). 1.5s-Dedup-Cache pro `linkId` gegen Doppel-Click-Events.
- `parseTreeLinkEntryId(entryId)` — extrahiert echte `links.id` aus TreeEntry-IDs mit Prefix `link-board-`. `link-info-` (cell.data.links jsonb ohne click_count) liefert null.

**Pflicht-Call-Sites:**
- `lib/alias-dispatch.ts` — `case 'link'` ruft `incrementLinkClickCount(result.linkId)` vor `window.open()`. `AliasResolveResult.link` traegt jetzt `linkId: string` (frueher nur url+label).
- `lib/atom-routing.ts` — `case 'link'` (Calendar-Manifestation als Link-Atom) ruft `incrementLinkClickCount(event.atomId)`.
- `components/NodeTree.tsx` — Sidebar-Link-Entry: TreeLink-onClick + Context-Menu-„Link oeffnen" rufen Increment fuer `link-board-`-IDs.
- `components/BoardView.tsx` — Board-Header-Links-Leiste (`content().links` aus `links`-Tabelle): `<a>`-onClick ruft Increment parallel zur nativen Navigation (Audit 2026-05-09).

**Realtime:** Workspace-Channel `links` deckt das ab — Increment via RPC triggert UPDATE → Realtime-Subscriber bekommen den neuen Counter ohne Extra-Sync.

**Konzept-Punkt §11.7 zugemacht.**

### 11.8 Migrations-Pfad

Bestehende Stub-Page wird durch Render des Vorlagen-Layouts ersetzt. **Keine Daten-Migration** noetig — Aggregation lebt weiter on-the-fly via `task-aggregate.ts`. Render-Pfad wandert von `MatrixView.tsx:1103` direkten `<CellTaskSummary>`-Aufruf zu Vorlagen-basiertem Render mit `render_position='auto_under_features'`-Lookup.

### 11.9 AI-Faehigkeiten (V2 deferred)

V2-Vorschlag: KI-Filter via Welle-A-Pipe — z.B. „heute relevante Aufgaben" als KI-Filter statt fester Filter. Welle A KI-Pipe ist live (`project_phase2_kifirst_vision.md`). V2 deferred.

---

<a id="12"></a>
## 12. Info-Feature-Konsolidierung

Heutige Info-Felder (`cell.data.infoFields[]` als JSONB-Array) werden **atomisiert** zu `atom_type='info_field'` (siehe §4). Die heutige Info-Page wird zur Plattform-Default-Vorlage „Info" mit:

- Section „Felder" → Widget `info-form` (rendert info_field-Atome als Form).
- Section „Links" → Widget `link-list` (rendert link-Atome mit `provider='url'`).
- Section „Doku" → Widget `doc-link` (rendert gepinnte doc-Atome).

**Clean-cut-Migration (User 2026-05-06: keine Daten):**
- `cell.data.infoFields` + `cell.data.links` → einzelne info_field-/link-Atome mit atom_manifestations.
- `cells.data` Spalte gedroppt wenn nach Migration leer.
- Kein Legacy-Fallback (Memory `feedback_clean_cut_no_prod_data.md`).

### 12.1 Initiale typed Field-Types V1 (final 2026-05-07)

Zehn Werte fuer `info_fields.value_type`:

| value_type | Beispiel | UI-Form |
|---|---|---|
| `text` | „Notiz" | Single-Line-Input |
| `number` | „Bestellmenge: 5" | Numeric-Input |
| `date` | „Vertragsende: 31.12.2026" | Date-Picker |
| `currency` | „Umsatz: 1.250,00 €" | Numeric + Locale |
| `boolean` | „Aktiv: ja/nein" | Checkbox / Toggle |
| `email` | „kontakt@..." | Email-Input + Validator |
| `phone` | „+43 1 23456" | Tel-Input + Format |
| `url` | „https://..." | URL-Input + Validator |
| `enum` | „Status: Pending/Active/Closed" | Select-Dropdown |
| `alias-ref` | „Verlinkt zu ^kunde" | Alias-Picker (existing Welle D) |

V2-Kandidaten: `rating` / `percentage` / `file-ref` / `markdown` / `range` (z.B. `date_range` aus §9.14 V2).

### 12.2 Verhaeltnis zu Welle O.9 (final 2026-05-07)

Object-Layer (Welle O, live) macht typisierte Attribute auf **Object-Ebene** — universal pro Object-Type. Info-Felder hier auf **Cell-Ebene** — pro Cell eigene Werte.

**V1 Layer getrennt:** Cell-Info-Felder leben unabhaengig, Object-Felder via Alias-Resolve referenzierbar (nicht inherited).

**V2:** Object-Field-Inheritance als optionale Default-Quelle fuer Cell-Info-Felder — pro Vorlage konfigurierbar (z.B. „Vertrag-Cell erbt Tel/Email/Adresse vom Object Kunde").

### 12.3 Symbol-System fuer typed Fields + Links (final 2026-05-07, User-Direktive)

User-Direktive 2026-05-07: *„symboltoggle und Symbolauswahl oder fuer Felder wie waehrung Datum email Autosymbol fuer links macht noch Sinn (kann bei links auch favico oder Symbol fuer bekannte links sein (local URL Sharepoint,..))"*

#### 12.3.1 Auto-Symbol pro Field-Type (Heroicons-Defaults)

| value_type | Default-Symbol |
|---|---|
| `text` | `document-text` |
| `number` | `calculator` |
| `date` | `calendar` |
| `currency` | `banknotes` (Locale-abhaengig `currency-euro` etc.) |
| `boolean` | `check-circle` |
| `email` | `envelope` |
| `phone` | `phone` |
| `url` | `link` |
| `enum` | `list-bullet` |
| `alias-ref` | `at-symbol` |

#### 12.3.2 Auto-Symbol pro Link-Provider (15 Werte)

| provider | Default-Symbol |
|---|---|
| `url` | **Favicon** vom Hostname (Service-Worker-Cache, TTL 30 Tage) — Fallback `globe` |
| `mail` / `mail-generic` | `envelope` |
| `onenote` / `notion` / `onedrive` / `drive` / `dropbox` / `nextcloud` | Brand-SVG-Icons (statisch im Bundle) |
| `slack` / `teams` / `whatsapp` / `discord` / `telegram` | Brand-SVG-Icons |
| `filesystem` | `folder` (lokale Datei: `computer-desktop`) |

Provider-Detection automatisch beim Eintragen (Hostname/Schema) + manueller Override.

#### 12.3.3 Symbol-Toggle drei Ebenen

| Ebene | Toggle | Default |
|---|---|---|
| Pro Vorlage | „Auto-Symbole an/aus" — gilt fuer alle Felder/Links der Vorlage | an |
| Pro Field/Link-Atom | „Symbol an/aus" — User kann Symbol pro Eintrag verbergen | an |
| Pro Field/Link-Atom | „Symbol manuell waehlen" → IconPicker-Modal (Reuse `code-quality.md` §6.5) | Auto |

#### 12.3.4 Resolution-Order

```
1. User-Override (manuelle Auswahl via IconPicker)
2. Favicon-Fetch (nur fuer provider='url', Auto-Cache)
3. Auto-Symbol vom Provider / Field-Type (Default)
4. Generisches Fallback (globe / document)
```

#### 12.3.5 Schema-Erweiterung (WV.B)

```sql
ALTER TABLE info_fields ADD COLUMN symbol_override text NULL;
ALTER TABLE links ADD COLUMN symbol_override text NULL;
```

Haelt User-manuell-gewaehltes Symbol als Heroicons-Name oder Brand-Icon-Key. NULL = Auto-Logik.

#### 12.3.5a Render-Pfad-Status (2026-05-09)

**LIVE seit 2026-05-09:** Symbol-Resolver hatte seit WV.B 0 Konsumenten — Resolver-Helper waren totes Feature. V1-Closure verkabelt:

- `ResolvedSymbol`-Type erweitert um `brandKey?: BrandKey`. 11 LinkProvider mit Brand-distinct Glyph (mail-generic, onenote, onedrive, drive, dropbox, nextcloud, slack, teams, whatsapp, discord, telegram) returnen den Key. Provider 'url'/'mail'/'notion'/'filesystem' bleiben Heroicon-only.
- `<AtomSymbol resolved={ResolvedSymbol} />`-Wrapper-Component dispatcht zwischen drei Render-Pfaden:
  - `source='favicon'` + `faviconUrl` → `<img>` mit onError-Fallback auf Heroicon (Favicon-Service down / Hostname unreachable).
  - `brandKey` → `<BrandIcon brand={key} colored={?} />`.
  - sonst → `<Icon name={iconName} />`.
- `TreeEntry.kind='link'` erweitert um optionale `provider: LinkProvider` + `symbolOverride: string | null`. `linkEntryFromBoardLink` (lib/queries.ts) fuellt beides aus `LinkRow`. Legacy `linkEntryFromInfoLink` (cell.data.links jsonb) laesst sie undefiniert — Render-Fallback auf `iconNameFor`.
- `NodeTree.tsx` Tree-Row-Render: Wenn `entry.kind==='link'` + `entry.provider`, `<AtomSymbol>` mit `resolveLinkSymbol(provider, url, override)`. Sonst `<Icon name={iconNameFor(entry)}>` wie bisher.
- `BoardView.tsx` board-link-chip-Render (Header-Links-Leiste): `<AtomSymbol resolved={resolveLinkSymbol(link.provider, link.url, link.symbol_override)} size={12}>` (Adjacent 2026-05-09). Frueher Statisch-Dispatch zwischen `envelope` (mail) + `arrow-top-right-on-square` (alle anderen) — Brand-Icons fuer Slack/Teams/OneNote/Notion/Drive etc. waren verloren.

**V2-deferred:**
- info_field-Atom-Renderer (Welle B fortgesetzt) nutzt `resolveInfoFieldSymbol` + `<AtomSymbol>` analog. CellInfoPage rendert heute legacy infoFields-jsonb ohne `value_type`-Discriminator — kein Symbol-Render-Pfad anwendbar bis Welle B atom-Renderer-Foundation.
- IconPicker-Modal Override-Auswahl (per-Atom-Symbol manuell): Schema (`info_fields.symbol_override` + `links.symbol_override`) live, UI-Anbindung folgt mit Atom-Edit-Modal in Welle B.
- Per-Vorlage „Auto-Symbole an/aus" Toggle (§12.3.3 Ebene 1): noch nicht im WidgetInspector. Wenn aus, sollen alle Symbole im gerenderten Vorlagen-Layout ausgeblendet werden — Pflicht-Stelle bei `TemplateWidgetRenderer`/`AtomSymbol`-Bypass.

**Konzept-Punkt §12.3 Render-Pfad V1 zugemacht.**

#### 12.3.6 Performance-Pflicht

- **Favicon-Fetch:** via Service-Worker-Cache, Cache-Key = Hostname, TTL 30 Tage. Nicht bei jedem Render.
- **Brand-Icons:** als statische SVG-Assets in `packages/client-web/src/assets/brand-icons/`.
- **Lazy-Render:** Symbole erst beim Sichtbarwerden (`IntersectionObserver`) in langen Listen.

---

<a id="13"></a>
## 13. Toggles pro Widget — Comment-Channel + Attachment-Source

Foundation-Direktive (§14) konkret:

### 13.1 Comment-Channel-Toggle

**Status 2026-05-09:** V1 LIVE — 3-state-Toggle im WidgetInspector + Stub-Section im Renderer. Provider-/Thread-Picker fuer extern + atom_comments-Tabelle fuer native bleiben V2.

UI:

```
[ Kommentare ]   ( ) aus
                 (•) extern  →  Provider: [Outlook-Mail ▾]   Thread: [Vertrag-Mueller ▾]    ← V2
                 ( ) nativ
```

Optionen:

- **off** — keine Comment-Section unter dem Widget. V1 default.
- **extern** — Provider-Auswahl (OAuth-verbunden, sonst graued out + „Provider verbinden"-CTA). Thread-Auswahl: bestehender Thread linken oder neuen anlegen. V1: `widget.toggles.comments.mode='extern'` setzt nur User-Praeferenz, Stub-Section zeigt „Kommentare extern (Provider folgt in V2)".
- **nativ** — `atom_comments`-Tabelle, pro Atom thread, Realtime via Supabase. Default nur fuer Single-User-Workspaces oder explizit gewaehlt. V1: Stub-Section zeigt „Kommentare nativ (atom_comments folgt in V2)".

**V1-Schema:** `widget.toggles.comments = { mode: 'off'|'extern'|'native' }` — `provider` + `thread_ref` werden in V2 ergaenzt.

`commentsMode(toggles)`-Helper im Renderer + 3-state-Radio im WidgetInspector. `template-widget-comments-stub`-CSS-Klasse fuer das Stub-Render mit Hairline-Trenner + Icon + Label.

Provider-V1-Liste (final 2026-05-07):

- **SMTP (Outbound)** — generischer Mail-Versand, Provider-agnostisch.
- **IMAP (Inbound)** — generisches Mail-Empfangen, Provider-agnostisch. Replies aus dem Mail-Channel landen wieder im Tool als Comment-Stream (User-Direktive „Weg retour").
- **Slack** — App-Bot fuer Outbound + Events-API fuer Inbound.
- **Microsoft-Teams** — App-Bot fuer Outbound + Webhook fuer Inbound.

V2: Outlook-Graph + Gmail-API (tieferer Sync mit Threading-Detail, Read-Receipts, Sub-Folder-Logik). WhatsApp-Business-Cloud-API, Telegram, Discord.

**Protonmail entfaellt komplett** (auch nicht V2) — keine API, Bridge-Komplexitaet nicht gerechtfertigt.

### 13.2 Attachment-Source-Toggle

**Status 2026-05-09:** V1 LIVE — 3-state-Toggle im WidgetInspector + Stub-Section im Renderer. Provider-/Folder-Picker fuer cloud + Supabase-Storage-Bucket fuer native bleiben V2.

UI:

```
[ Anhaenge ]    ( ) aus
                (•) Cloud   →  Provider: [OneDrive ▾]    Ordner: [Vertrag-Mueller/]    ← V2
                ( ) nativ
```

Optionen:

- **off** — keine Attachments. V1 default.
- **cloud** — Provider-Auswahl. Drag-Drop von Datei → Upload zum User-Cloud-Ordner. Widget zeigt Liste mit Cloud-Provider-Icons. V1: `widget.toggles.attachments.mode='cloud'` setzt nur User-Praeferenz.
- **nativ** — Supabase-Storage-Bucket. Quota begrenzt, Antivirus-Awareness V2.

**V1-Schema:** `widget.toggles.attachments = { mode: 'off'|'cloud'|'native' }` — `provider` + `folder_ref` werden in V2 ergaenzt.

`attachmentsMode(toggles)`-Helper im Renderer + 3-state-Radio im WidgetInspector. `template-widget-attachments-stub`-CSS-Klasse fuer das Stub-Render.

V1-Provider (final 2026-05-07): OneDrive, Google Drive, Dropbox, **Nextcloud** (DSGVO-konform, WebDAV-API), **pCloud** (Schweiz, eigene API). V2: kDrive (Infomaniak), MagentaCLOUD (Telekom), Tresorit (E2E-Encryption), Mailbox.org Drive.

### 13.3 Marker-Toggle (final 2026-05-06)

**Status 2026-05-09 — V1 LIVE.** `AtomMarkerBar`-Component (Star + Eye Click-Toggle, 1.5s-Throttle pro Atom+Kind, Star-Counter rechts vom Icon, Self-Eye-Indicator) gewired in fuenf Renderern:
- BoardView Card-Meta-Row (atom_type='task')
- CardOverlay-Header (V2.A, atom_type='task')
- TaskDetail-Header (V2.B, atom_type='task')
- ImportedEventDetailModal-Header (V2.C, atom_type='imported_event')
- ChecklistPanel cl-head (V2.D, atom_type='checklist')

`wsAtomMarkers`-Resource in `Workspace.tsx` (`fetchAtomMarkersForWorkspace`) + Realtime-Refetch ueber `atom_markers`-Slot. TaskDetail-Route hat eigene `wsAtomMarkers`-Resource (Direct-Open via `/w/<wid>/task/<tid>` ohne Workspace.tsx-Bundle). RLS filtert eye-Marker auf Owner. Konzept-Vorgabe „rechts in der Card-Toolbar" via `margin-left: auto` in `.atom-marker-bar`.

**V1-Scope:** Click-Toggle (Star setzen/entfernen, Eye setzen/entfernen) + Counter (nur Star) + 1.5s-Throttle. Drei der sechs atom_markers-CHECK-Werte (`task` / `imported_event` / `checklist`) live. NodeTree-Atom-Rows fuer link/doc-Atome + Calendar-Route-Variants des ImportedEventDetailModal + info_field-Atom-Renderer folgen wenn die Card-Variants den `AtomMarkerBar` als Render-Hook bekommen (Calendar-Route hat aktuell kein wsAtomMarkers-Bundle, info_field-Atom-Renderer ist Welle B-Aufgabe).

**V2-deferred:**
- Hover-Tooltip „Wer hat gestartet" (User-Liste mit Avatars).
- Filter-Builder-Conditions `has_marker(kind=star, by_user=me, count>=N)` — siehe §5.2.6 Filter-DSL.
- Vorlagen-Toggle `markers.workspace_star` / `markers.private_eye` (heute immer sichtbar; Toggle abschaltbar nur wenn Vorlage es deaktiviert).
- Smart-Summary-Default-Widget „Beobachtet von dir" → `task-list` mit Filter `has_marker(kind=eye, by_user=me)`.
- AtomMarkerBar in NodeTree-Atom-Rows + ChecklistPanel-Items.

Marker leben in einer eigenen Tabelle `atom_markers` (siehe §15) — analog Layer-4-Pattern aus `architektur.md` §1.5. Zwei Kinds in V1:

| Kind | Sichtbarkeit | UI | Counter |
|---|---|---|---|
| `star` | Workspace-shared (alle Member sehen) | gefuelltes/outline-Star-Icon, Aktiv-Color `--warning` (Amber) | „⭐ N" mit User-Liste im Hover-Tooltip |
| `eye` | User-privat (nur Owner sieht eigenen Eye-Marker) | filled/outline-Eye-Icon, Aktiv-Color `--accent` | kein Counter (privat) |

**Widget-Toggle pro Marker-Art:**

- `markers.workspace_star` (default `true`): wenn aus, ist die Star-UI ausgegraut + Tooltip „Marker im Widget deaktiviert". Bestehende Stars bleiben in der DB, werden aber im Widget nicht angezeigt + nicht editierbar.
- `markers.private_eye` (default `true`): immer fuer den User sichtbar. Toggle abschaltbar nur wenn der User Eye in diesem Widget nicht braucht (UI-Aufgeraeumter Wunsch).

**UI-Position** (`style.md` §6.3 Layout-System):

```
┌── Atom-Card ────────────────────── ⭐ 3  👁  ──┐
│  Doc: Vertrag Mueller                          │
│  Tags: #vertrag #wichtig                       │
└────────────────────────────────────────────────┘
```

Right-aligned in der Card-Toolbar. Konsistente Position ueber alle Widget-Types (`atom-card`, `task-list`, `link-list`, `doc-link`).

**Animation** (`animations.md`):
- Click-Pulse via §2.15 (`clickPulse`) auf das geklickte Icon.
- Counter-Tick beim Star-Setzen: mini-Pop-Animation am Counter via `--scale-pulse-up`.
- Toast bei erstmaligem Star: „Du folgst diesem Atom" mit Hint zum Star-Counter.

**Realtime** (siehe `architektur.md` §5.8 Realtime-Konsistenz-Direktive):
- Star-Toggle ist Workspace-shared → Subscribe auf `atom_markers` mit `kind=star`.
- Eye-Toggle ist User-privat → Subscribe gefiltert auf `user_id=auth.uid()` (oder kein Subscribe noetig — wirkt nur in eigenem Browser).
- Throttle: Star-Counter-Bumps debouncen 1-2s pro Atom-Card, damit Spam-Klicks nicht 5 Realtime-Events ergeben.

**Filter-Builder-Conditions** (siehe §5.2.6):
- `has_marker(kind=star)` — irgendein Star (irgendwer)
- `has_marker(kind=star, by_user=me)` — meine Stars
- `has_marker(kind=star, by_user=any, count>=N)` — Atome mit mind. N Stars
- `has_marker(kind=eye, by_user=me)` — meine Eye-Watchings (immer self-scoped)

Smart-Summary-Default-Vorlage erweitert: ein Widget „Beobachtet von dir" → `task-list`/`atom-card` mit Filter `has_marker(kind=eye, by_user=me) AND scope=workspace`.

### 13.4 Header-Toggle

**Status 2026-05-09:** LIVE. Boolean `widget.toggles.header` (default `true`). Wenn `false`: `TemplateWidgetRenderer` skipped die Header-Section komplett (Type-Badge + Reset-Button) — z.B. fuer Hero-Doc-Embed ohne Chrome.

`WidgetInspector` zeigt Checkbox „Header anzeigen" — Default an, User kann pro Widget abschalten. `headerToggle(toggles)`-Helper im Renderer.

### 13.5 edit_in_view-Toggle

**Status 2026-05-09:** V1 LIVE (Wrapper-Klasse + Inspector-UI). Boolean `widget.toggles.edit_in_view`. Wenn an: User kann Widget-Inhalt aendern auch wenn die Cell nicht im Edit-Mode ist (z.B. Tasks abhaken in einem Smart-Summary-Widget).

**Defaults pro Widget-Type (final 2026-05-07):**
- `kanban` / `checklist` → `true` (Inline-Edit naturlich, Checkbox abhaken usw.).
- `info` / `doc` → `false` (strukturierte Felder mit Validierung, Inline-Edit kann Daten-Inkonsistenz verursachen).
- `link` / `calendar` / `smart_summary` / `channel` / `drive` → `false`.

Vorlage-Designer-Inspector zeigt Toggle pro Widget — User kann Default ueberschreiben. `editInViewToggle(toggles, type)`-Helper liefert den effektiven Wert.

**V1-Implementation:** Renderer setzt CSS-Klasse `.template-widget-edit-in-view` + `data-edit-in-view`-Attribut auf den Widget-Wrapper. Sub-Renderer (BoardView / ChecklistPanel / Channel / Drive) konsumieren das Flag noch nicht — Inline-Edit-Pfad bleibt heute Edit-Mode-gated.

**V2-deferred:** Sub-Renderer lesen das Flag und schalten Edit-Affordances unabhaengig vom Cell-Edit-Mode frei. Pflicht-Stellen: `BoardView.onCardDragStart`-Guard (sort=manual), `ChecklistPanel`-Item-Edit, `info_field`-Value-Editor, `Channel`-Send-Button, `DriveWidget.handleLinkFile`. Pro Sub-Renderer einzeln gegated — Caller (`TemplateWidgetRenderer`) reicht das Flag durch.

**Konzept-Punkt zugemacht V1.** V2-Sub-Renderer-Wiring bleibt offen.

### 13.5a Konflikt-Audit `AccountVisibility` vs. `edit_in_view`-Widget-Toggle (Audit-Stand 2026-05-07, Entscheidung deferred zum Wrap-up)

**User-Klarstellung 2026-05-07:** *„es gibt in den Einstellungen bereits einen solchen tab — wir muessen dann sprechen ob dieser Tab in Konflikt steht mit dem toggle pro Widget."*

#### 13.5a.1 Audit-Befund 2026-05-07

Existing Settings-Tab `routes/settings/AccountVisibility.tsx` regelt **Bedienelement-Sichtbarkeit** ueber 15 VisKeys mit jeweils Dropdown:

| Gruppe | Keys |
|---|---|
| Matrix | `addRowCol` · `deleteRowCol` · `renameHeaders` · `moveArrows` · `transpose` |
| Zellen | `addFeature` · `addInfoField` · `alias` |
| Kanban | `addKbCol` · `colorPicker` |
| Aufgabenuebersicht | `dailyColEdit` |
| Sidebar | `sbCtxFeature` · `sbCtxContent` |
| Diverses | `exportImport` · `deleteItems` |

**Optionen je Key:** `'edit'` (Nur Edit-Modus) · `'always'` (Immer sichtbar) · `'never'` (Ausgeblendet). Default = `'edit'`.

#### 13.5a.2 Skopen-Vergleich

| Aspekt | `AccountVisibility` | `edit_in_view`-Widget-Toggle (§13.5) |
|---|---|---|
| Skopus | Bedienelement-Sichtbarkeit (Buttons / Pfeile) | Widget-Inhalt-Editierbarkeit (Items / Felder) |
| Optionen | 3 (`edit` / `always` / `never`) | Boolean (`true` / `false`) |
| Granularitaet | pro Bedienelement (15 Keys) | pro Widget-Type / pro Vorlage |
| Quelle | User-Setting (Workspace-uebergreifend) | Vorlage-Setting (Workspace-shared) |

Verschiedene Skopen — **kein direkter Konflikt**, aber **subtile UX-Inkonsistenz** moeglich (z.B. `addInfoField='edit'` blendet Add-Button im View-Mode aus, aber `edit_in_view: true` laesst existing Felder jederzeit inline editieren).

#### 13.5a.3 Drei Optionen fuer Wrap-up-Sprint

| Variante | Beschreibung | Pro | Contra |
|---|---|---|---|
| (1) Getrennt | beide Mechanismen parallel | kein Refactor | UX-Inkonsistenz akzeptiert |
| (2) Integrieren | neues VIS_KEY `widgetInlineEdit` in AccountVisibility, Vorlage-Toggle ueberholt | Single-Source, klar | verliert Vorlage-Granularitaet |
| (3) Hybrid | AccountVisibility = User-Default, Vorlage-Toggle = Override-Layer (analog §6.3a Slot-Override-Inheritance) | Doublet-frei, klare Inheritance-Kette, Granularitaet erhalten | Komplexer Render-Pfad |

**Empfehlung: Variante (3) Hybrid** — analog zur etablierten §6.3a Drei-Schicht-Inheritance (Plattform → Workspace → User → Vorlage-Override).

#### 13.5a.4 Wrap-up-Sub-Sprint

User-Entscheidung zwischen den drei Varianten **deferred zum Konzept-Ende** (nach §18 Verifikation, vor Implementierungs-Start). Audit-Befund + Empfehlung sind hier verankert — User entscheidet bei der Wrap-up-Diskussion.

**Kein neuer Modal-Build.** Audit-Sprint, kein Komponenten-Sprint.

Verankert als Worksheet 13.7a — wird **am Schluss vor Implementierung** durchdiskutiert.

### 13.6 OAuth-Token-Storage (final 2026-05-07)

**Status 2026-05-09 — LIVE seit Welle WV.D.2** (Commit `6000d90`, Migration 078 `user_oauth_tokens` + `oauth_provider_slots`).

Live-Pfad:
- Tabelle `user_oauth_tokens` (user_id + provider + access_token_encrypted + refresh_token_encrypted + scope + expires_at). Verschluesselung per pgsodium-Wrap, Plaintext-Decrypt nur Bridge-side via `get_oauth_token_decrypted`-RPC — Frontend exposed das niemals.
- View `user_oauth_tokens_safe` filtert die `*_encrypted`-Spalten aus dem Read-Pfad.
- Write-Pfad nur ueber SECURITY-DEFINER-RPCs `set_oauth_token` / `delete_oauth_token` — direkte INSERT/UPDATE/DELETE policy-blockiert.
- Provider-Slots in `oauth_provider_slots` (platform_admin-only) liefern Client-ID/Secret + Status-Heartbeat (Memory `feedback_admin_dashboard_config_gate.md`).
- Cascade-Delete bei User-Loeschung via FK `user_id REFERENCES auth.users(id) ON DELETE CASCADE`.
- Frontend-Layer `lib/oauth-tokens.ts` (Read mit IDB-Cache-Fallback) + Bridge-Tools `oauth-tokens.ts` + Heptad-Round-Trip (Export/Import deferred fuer Sicherheits-Direktive §15.2 — OAuth-Tokens werden bewusst NICHT exportiert).

Pattern aus Welle A `user_ai_providers` (Memory `project_phase2_kifirst_vision.md`) wiederverwendet:

- Workspace-scoped Tabelle `user_oauth_tokens` (oder erweiterte `user_ai_providers`).
- Pro User + Provider eine Row mit Token + Refresh-Token (verschluesselt) + Scope.
- RLS: nur Owner-User darf lesen/schreiben.
- Cascade-Delete bei User-Loeschung.

---

<a id="14"></a>
## 14. Hyperlink-via-Alias als universelle Anker-Sprache

`^kuerzel` ist heute In-App-Resolver (`lib/alias-resolve.ts` + `lib/alias-index.ts` + `lib/use-alias-autocomplete.ts`). Im Vorlagen-Modell wird er zur **universellen Sharing-Sprache** — In-App-Anker, AI-Pipe-Eingang, Drag-Drop-Quelle nach extern, URL-Direktverlinkung in info_field-URL-Type.

**Foundation-Bezug:** §14 dieser Spec ist die UX-Manifestation der Foundation-Direktive (Architektur-Manifest §14). Aliase + Hyperlinks sind der Default-Mechanismus, ueber den User-Daten zwischen App und externen Channels (Mail, Messenger, Chat-AI) fliessen — ohne User-Infrastruktur zu duplizieren.

### 14.1 Public-Resolve-Endpoint (Member-only V1)

**Status 2026-05-09 — V1 LIVE.** SPA-Route `/r/:workspaceId/:alias` (`routes/AliasRedirect.tsx`) resolved Aliase aus extern-Drop-URLs (`buildExternalDragUrl` in `drag-context.ts`). Resolver ruft `resolveAlias(alias, workspaceId)` und dispatched via `dispatchAliasResult` auf die Cell/Karte/Doc/Link-Route. Member-only-Pflicht durch RLS in resolveAlias-Queries (Non-Member sehen die Atom-Targets nicht — kommt als „Alias nicht gefunden" zurueck, kein Hint auf Existenz, Konzept-Vorgabe gewahrt).

**V1-Ein­schraenkungen (Folge-Sub-Sprints):**
- Auth-Guard in `App.tsx` schickt nicht-eingeloggte User auf `/login`. **`?next=`-Parameter** + automatischer Re-Direct nach Login deferred V2 (Pattern wie `Invite.tsx` mit sessionStorage).
- URL nutzt `workspaceId` (UUID) statt `:workspaceSlug` — Workspace-Slugs sind im Schema heute nicht definiert, Slug-URL bleibt V2-Polish.
- Server-Side-Hydration via Edge-Function (concept Realisierung „kommt mit Test/Prod-V2") deferred.

**Live-Pfad:**
- Drag aus BoardView/NodeTree → `bindDragSource` ruft `setExternalDragMimes` → `buildExternalDragUrl` produziert `/r/<wsid>/<alias>`.
- Empfaenger klickt Hyperlink in Mail/Messenger → SPA-Route `AliasRedirect` rendert Spinner → resolveAlias + Navigate.
- Bei Non-Member oder geloeschtem Alias: showToast + Navigate auf Workspace-Root (defensiver Fallback).

Neuer Endpoint `GET /alias/:workspaceSlug/:alias` mit:

- **Default Member-only.** Permission-Check via `is_workspace_member(workspace_id)` analog Architektur §5.3 RLS.
- Bei eingeloggtem Member: Redirect zur App-Route der Cell/Karte/Link/Doc/Atom.
- Bei nicht-eingeloggtem User: **Login-Redirect** mit Redirect-Param (`?next=/alias/...`). Nach Login wird wieder auf den Alias-Endpoint geleitet, der nach Permission-Check zur Ziel-Route redirected.
- Bei eingeloggtem Non-Member: 404 (kein Hint auf Existenz).

Realisierung V1: App-Route mit Client-Side-Resolution (SPA). Server-Side-Hydration via Edge-Function kommt mit Test/Prod-V2.

**Worksheet-Bestaetigung 14.1:** Member-only Default + Login-Redirect. ✓

### 14.2 Public-Token-Sharing (V2 deferred)

Public-Sharing eines Aliases („Hier der Link, gilt fuer Aussenstehende") via signed Token:

- `GET /alias/:workspaceSlug/:alias?t=<jwt>` → Token validiert, ggf. read-only Snapshot ausserhalb der Member-Pflicht.
- Token-Generierung in der Cell/Atom-Action-Bar mit TTL-Wahl (1h / 1d / 7d / 30d / unbegrenzt).
- Token-Revoke pro Cell/Atom.

**V2 deferred.** V1 zwingt: jeder Empfaenger eines Alias-Hyperlinks ist Member des Workspaces oder bekommt Login-Redirect. Foundation-Direktive ist gewahrt — Public-Sharing folgt der gleichen „Bridge zur User-Infrastruktur"-Logik (eine Mail mit Alias-Hyperlink an einen Member ist genauso wirksam wie heute).

### 14.3 AI-Tool `alias.expand_to_text`

**Status 2026-05-09:**
- Bridge-Schema (`packages/bridge/src/tools/alias.ts`) komplett: `alias` + `depth` (1-3, default 1, V1-Handler ignorieren) + `format` (markdown/plain/html, default markdown). Schema-Tests in `alias-query-settings-meta.test.ts` decken Defaults + Boundary-Cases ab.
- Standalone-Handler (`matrix.html`) liefert `{ text }` in 3 Formaten — Single-Level (depth=1).
- Client-Web ws-Bridge-Handler folgt mit Bridge-Wiring-Sprint (heute kein ws-Tool-Routing in client-web).
- V2-Output `{ text, hyperlink, children: [...] }` mit Atom-Beziehungs-Traversal — deferred Welle F (braucht Resolver-Erweiterung um nested Aliase auf Atom-Children zu mappen).

MCP-Tool fuer AI-Pipe (Welle A live):

```ts
{
  name: 'alias.expand_to_text',
  description: 'Expandiert einen Alias zu strukturiertem Text (Title + Body + Children + Links + Hyperlink). Fuer Mail-/Messenger-Compose mit Aliasen.',
  input: {
    alias: string,
    depth?: number,                                    // default 1, max 3 (Performance-Bremse)
    format?: 'markdown' | 'plain' | 'html'             // default 'markdown'
  },
  output: {
    text: string,                                      // formatierter Text gemaess `format`
    hyperlink: string,                                 // absolute URL der Cell/Atom
    children: Array<{ alias_or_id: string, kind: string, title: string, hyperlink: string }>
  }
}
```

**Format-Konventionen:**
- `markdown` (Default) — Mail-Compose, AI-Chat-Kontext: Title als `# Heading`, Children als Bullet-List mit `[Title](hyperlink)`. Standard fuer Send-Out.
- `plain` — reiner Text mit absoluten URLs. Messenger ohne Markdown-Renderer (z.B. WhatsApp).
- `html` — `<h1>` + `<ul>` + `<a href>`. Outlook-/Gmail-Compose.

Mental-Modell User-AI: *„Schreib an xy@ alle Infos aus ^kunde mit Doku-Hyperlinks unten."* AI-Pipe ruft `alias.expand_to_text({alias:'kunde', depth:2, format:'markdown'})`, baut Mail-Body, fuegt am Ende die Hyperlinks aller Doc-Children an.

**Worksheet-Bestaetigung 14.3:** Default `markdown`, alle drei Formate via Param. ✓

### 14.4 Drag-Drop nach extern (alle 4 MIME-Types V1)

**Status:** Live seit 2026-05-09 — `setExternalDragMimes(dt, src)` in `lib/drag-context.ts` setzt drei Standard-MIMEs, `bindDragSource` ruft es nach dem ATOM_REF_MIME automatisch auf. `BoardView.onCardDragStart` (Kanban-Karten, eigene DragStart-Logik wegen `boardUi.sort()`-Guard) ruft die Helper-Funktion ebenfalls.

User zieht Atom oder Widget aus der App. Drop-Target ist ein externes App-Window (Mail-Compose, Messenger, Chat-KI).

HTML5-DataTransfer mit **vier parallelen Formaten** (alle V1-Pflicht):

| MIME | Inhalt | Konsument |
|---|---|---|
| `text/plain` | absolute URL (alias-resolve oder Workspace-Root) | Simple Text-Editoren, Slack, WhatsApp |
| `text/html` | `<a href="…">{label}</a>` (HTML-escaped) | Outlook, Gmail, Word |
| `text/uri-list` | absolute URL als Single-Line-URI (RFC 2483) | OS-Native Drop-Targets, Browser-Bookmark-Bar |
| `application/x-matrix-atom-ref` | JSON-Payload (siehe §14.5) | In-App-Drop (Matrix-zu-Matrix), Bridge-Tool-Drop |

**URL-Aufloesung in `buildExternalDragUrl`:**
1. atom='link' mit `url`-Property: sanitisierter Underlying-Link (Empfaenger kriegt das Original-Ziel, nicht den Matrix-Wrapper).
2. workspaceId + Alias gefunden via `findAliasForOwner(wsId, kind, id)`: `${origin}/api/resolve/${alias}` → 302-Redirect auf richtiges Atom-Page (Member-Auth, §14.1 alias-resolve-Service).
3. workspaceId ohne Alias: `${origin}/w/${wsId}` als Workspace-Root-Fallback. Atom-Deep-Links sind parent-FK-abhaengig (Card → Board, Cell → Matrix), ohne Alias kein stabiler universeller Pfad.
4. weder noch: text/uri-list bleibt leer, text/plain = Label, text/html = escaped Label.

**Reverse-Alias-Lookup:** `findAliasForOwner(wsId, kind, id)` (lib/alias-index.ts) — Linear-Scan ueber den in-memory Alias-Index. Drag-Start ist Single-Shot, ~hunderte Eintraege, kein Hot-Path. Kein dedizierter byOwner-Index noetig.

**Konsum-Logik:**
- Drop in die **eigene App**: Custom-MIME (`application/x-matrix-atom-ref`) wird konsumiert, bleibt Atom-Ref ohne Loss.
- Drop in **externe App**: nur Standard-Formate werden gelesen — Alias wird zu Hyperlink, Empfaenger-Member landet via 302-Resolve auf der richtigen Page. Non-Member sieht den Login-Redirect mit `return=/api/resolve/<alias>`.

**Konzept-Punkt zugemacht** — §14.4 V1 LIVE.

**Worksheet-Bestaetigung 14.4:** alle 4 Formate V1. ✓

### 14.5 Custom-MIME-Rename + JSON-Format (Migration LIVE)

**Status:** Live seit WV.WV.8 + Caller-Audit 2026-05-09. MIME ist `application/x-matrix-atom-ref`, Payload ist versioniertes JSON `{ v:1, atomType, atomId, workspaceId, sourceManifId? }`.

**Code-Single-Source:** `packages/client-web/src/lib/drag-context.ts`
- `ATOM_REF_MIME` — exportierte Konstante.
- `AtomRefPayload` — Type mit `v: 1` (Forward-Compat-Versionierung).
- `encodeAtomRefPayload(DragSource): string` — Encoder.
- `decodeAtomRefPayload(raw): AtomRefPayload | null` — defensiver Decoder fuer ext. Konsumenten (MCP-Bridge, Cross-Window-Drops). Returns `null` bei Schema-Drift.
- `bindDragSource()` setzt den MIME automatisch.

**Caller-Audit 2026-05-09 (alle In-App-Drag-Quellen emittieren Ref-MIME):**
- `BoardView.onCardDragStart` — Kanban-Card-Drag (manuelles `setData`, weil `boardUi.sort()`-Guard `bindDragSource` nicht zulaesst). Setzt zusaetzlich `text/matrix-card-id` + `text/plain` als Legacy-Fallback fuer Browser-stripping.
- `bindDragSource`-Konsumenten (DocsPopup-Atoms, Sidebar-Atoms, ChecklistPanel-Items, etc.) — automatisch.

**Drop-Handler-Audit 2026-05-09 (alle akzeptieren Ref-MIME als primaer):**
- `BoardView.onCardDrop` + `onColDrop` — Ref-MIME → Legacy → `draggingCardId()`-Solid-Fallback.
- `NodeTree.onCardDrop` + `onCardDragOver` — Ref-MIME → Legacy.
- In-App-Drop-Targets (BoardView/ChecklistPanel/Calendar/SidebarDayView) lesen primaer `activeDrag()` (Solid-Signal); MIME-Pfad ist nur fuer Cross-Window-/MCP-/Bridge-Konsumenten relevant.

**Begruendung Rename:** „atom" allein ist mehrdeutig, **„atom-ref"** macht klar, dass es um eine Referenz handelt — nicht den Atom-Body selbst. Konsistent zum Type `AtomRef` in Architektur-Manifest §1.6.

**Begruendung JSON-Format mit `v`:** Cross-Workspace-Drop (z.B. Bridge-Tool-Hosting) braucht `workspaceId`. `v: 1` ist Forward-Compat-Vertrag — Konsumenten brechen bei unbekanntem `v` ab. Erweiterbar fuer kuenftige Felder (e.g. `aliasHint`, `displayMeta`-Snapshot).

**Konzept-Punkt zugemacht** — keine WV.WV-Folge-Aktion mehr noetig fuer §14.5.

### 14.6 Alias-Autocomplete in jedem Text-Input (Coverage-Pflicht)

**Direktive:** ueberall wo der User Text schreibt, ist `^` der Trigger fuer Alias-Autocomplete (existing `lib/use-alias-autocomplete.ts`).

**Coverage V1 (Pflicht) — Status nach Audit 2026-05-09:**

| Input | Stelle | Autocomplete |
|---|---|---|
| Doc-Editor (ProseMirror) | `DocsPopup.tsx` (Mention-Plugin separat, WV.D.8) | ✅ live |
| Comment-Editor (Card-Note) | `CardOverlay.tsx:1185` | ✅ live |
| Cell-Info-Edit (Notiz/Felder) | `CellInfoPage.tsx:319` | ✅ live |
| Node-Beschreibung (Sidebar-Edit) | `NodeDescription.tsx:83` | ✅ live |
| Checklist-Item-Edit | `ChecklistPanel.tsx:624` | ✅ live |
| Checklist-Action-Modal | `ChecklistActionModal.tsx:172` | ✅ live |
| Checklist-Paste-Popup (Bulk-Items) | `ChecklistPastePopup.tsx` (workspaceId-Prop) | ✅ live (Audit 2026-05-09) |
| AI-Help-Drawer (Prompt) | `AiHelpDrawer.tsx:547` | ✅ live (Audit 2026-05-09) |
| Cell-Suggest-Modal (AI-Prompt) | `CellSuggestModal.tsx:119` | ✅ live (Audit 2026-05-09) |
| Vorlagen-Designer Vorlagen-Name | `TemplateDesigner.tsx:370` | ✅ live (Audit 2026-05-09) |
| Vorlagen-Designer Section-Title | `TemplateDesigner.tsx:415` | ✅ live (Audit 2026-05-09) |
| Vorlagen-Designer Title-Template | `TemplateDesigner.tsx:718` | ✅ live (Audit 2026-05-09) |
| Vorlagen-Designer Beschreibung | `TemplateDesigner.tsx:740` | ✅ live (Audit 2026-05-09) |
| Mail-Compose (Welle WV.B Channel-Bridge) | TBD bei Welle B Implementation | 🚧 deferred |
| **Info-Field Value (URL-Type)** | siehe §14.7 (Alias als Direktverlinkung) | 🚧 §14.7 |

**V1-Exempts (kein Autocomplete sinnvoll):**

| Input | Stelle | Begruendung |
|---|---|---|
| Bulk-Alias-Vergabe-Pattern | `BulkScalarInput.tsx` (BulkWizardModal-Caller) | Input IST der Alias-String — kein `^kuerzel`-Lookup. V2 Bulk-Tag/Field-Edit braucht's. |
| Template-Name-Modal | `NewTemplateModal.tsx`, `SaveAsTemplateModal.tsx` | Vorlagen-Name = Alias-Quelle, kein Resolver-Target. |
| Onboarding-Wizard | `wizard/StepQuestions.tsx` | Pre-Workspace — kein Alias-Index verfuegbar. |
| Generic-Adapter-Dialog | `AdapterDialog.tsx` | Caller-spezifisch (showPrompt etc.); pro Caller entscheiden. |
| Admin-System-Config | `admin/SystemConfigSection.tsx` | API-Keys + URLs, keine Alias-Targets. |
| Import-Passphrase | `ImportDialog.tsx` | Passwort-Input. |

**Anti-Pattern (Review-Stop):** neuer Text-Input ohne `bindAliasAutocomplete`-Hook (es sei denn, Exempts-Liste oben deckt's). Adjacent-Cleanup-Pflicht — wenn beim Bearbeiten ein Text-Input ohne Autocomplete entdeckt wird, ansprechen + nach Approval mitziehen.

**Querverweis:** `lib/use-alias-autocomplete.ts` exportiert `bindAliasAutocomplete(el, wsId)` als globalen Helper. Pattern: `ref={(el) => { onCleanup(bindAliasAutocomplete(el, wsId)); }}`. Kein Re-Implement.

**Worksheet-Bestaetigung 14.6:** ueberall wo User Text schreibt. ✓ Konzept-Punkt zugemacht 2026-05-09.

### 14.7 Alias als URL-Wert in info_field-URL-Type

**User-Direktive 2026-05-07:** *„In einem Infofeld URL kann ich auch einfach ein alias eintippen als direktverlinkung."*

**Status nach Code-Pass 2026-05-09:** V1-Mixed-Tokenizer LIVE — `lib/alias-tokenizer.ts` erkennt drei Token-Typen (`text` / `alias` / `url`), `AliasText` rendert sie 1:1 (Alias als Chip, URL als `<a target=_blank rel=noopener>`, Text plain). `markdown-lite` nutzt denselben Tokenizer (URL-Detection-Doublet entfernt).

**Verhalten:**

- info_field-Wert akzeptiert beliebige Mischung aus Text + Alias + URL. Renderer detektiert pro Token:
  - **klassische URL** (`https://...`, `http://...`, `mailto:...`, `tel:...`) — sanitisiert via `sanitizeUrl()` (Architektur §6.6, Allowlist-Schemes), gerendert als Inline-Link.
  - **Alias** (`^kuerzel`) — gerendert als `<AliasChip>`, click loest via `lib/alias-resolve.ts` zu Atom/Cell/Doc/Card auf, dispatch via `dispatchAliasResult` (navigate/Card-Overlay/Doc-Popup).
  - **Text** — Plain-Render.
- **Speicherung:** Alias bleibt im `value` als Alias-String erhalten — KEIN Eager-Resolve in URL beim Save. Renames der Ziel-Cell/Atom schlagen ohne Stale-URLs durch (Welle D-Resolver-Pattern).
- **XSS-Defense:** Tokenizer dropt URLs deren Scheme nicht in der Allowlist (`https/http/mailto/tel`) — `javascript:`, `data:`, `vbscript:`, `blob:`, `file:` werden als Plain-Text gerendert, kein `<a href>`.
- **Trailing-Punctuation:** `https://x.com,` wird als URL `https://x.com` + Text `,` gesplittet (Satzendung gehoert zum Satz, nicht zur URL).
- **Autocomplete:** `^` triggert Alias-Autocomplete in Edit-Mode (siehe §14.6).
- **Edit-Sync mit info_field-Origin:** Alias-Wert ist Single-Source — Edit am info_field laeuft durch Welle WV.B Realtime an alle Caller (Cross-View-Drag-Manifestationen).

**Beispiel:**

```
info_field(label='Vertrag', value='^kunde-vertrag-2026 plus https://crm.acme.com')
       ↓ tokenizer
[alias: kunde-vertrag-2026] [text: ' plus '] [url: 'https://crm.acme.com']
       ↓ render
[Vertrag] [^kunde-vertrag-2026] plus https://crm.acme.com
              ↓ click chip                   ↓ click link
              navigate via dispatchAlias     window.open in new tab
```

**Schema-Konsequenz:** keine — `info_fields.value text` deckt alle Mischungen ab. Render-Logik unterscheidet Alias-Praefix `^` und URL-Schemes.

**Live-Stellen via `AliasText`-Reuse:** alle Konsumenten profitieren automatisch — `CellInfoPage` (info-Field-Values), `ChecklistPanel` (item-Text-View), `CardOverlay` (Card-Notes), `MarkdownLightView` (Node-Descriptions). Kein Renderer-Doublet.

**V2-Erweiterung (deferred zu Welle B atom-Renderer-Foundation):**
- Symbol-Inheritance fuer Alias-Chips (Symbol vom Ziel-Atom geerbt — heute zeigt der Chip den Alias-Text mit Amber-Akzent).
- Provider-Auto-Symbol fuer URLs (favicon-style — Drive/OneNote/Mail-Icon je nach Hostname).
- Beide haengen an §12.3 Symbol-System V2.

**Worksheet-Bestaetigung 14.7:** Verankert + V1-Tokenizer-Pass live. ✓ Konzept-Punkt zugemacht 2026-05-09 fuer V1; Symbol-Inheritance bleibt offen bis Welle B.

---

---

<a id="14a"></a>
## 14a. Fundus — Atom-Soft-Delete + Wiederbeschaffbarkeit (Konzept-Punkt offen, Detail-Diskussion deferred)

User-Direktive 2026-05-07 zu §8.2: bei destruktiven Bulk-Aktionen (Alt+Hotkey = Vorlage entfernen, Alt+Entf = Cell leeren) sollen Atome nicht zwingend hart geloescht werden, sondern in einen **Fundus** verschoben werden koennen — als alternativer Lifecycle-Pfad mit Restore-Faehigkeit. Das ist ein **fundamentaler** Mechanismus, der das Konzept-File neu beruehrt.

**Status:** Konzept-Punkt eroeffnet, Detail-Diskussion **deferred** — eigener Sub-Sprint nach Abschluss Sektion 8 (Bulk-Action) und vor Welle WV.A. Im BACKLOG als `WV.Z — Fundus-Foundation` (TBD-Aufwand).

### 14a.1 Mental-Modell (User-Vision)

- **Fundus = eigene Matrix auf oberster Ebene** (Workspace-Root), oder ein abgelegener Container, **visuell unterscheidbar** zur aktiven Arbeitsmatrix.
- Atome werden bei destruktivem Bulk wahlweise **harte geloescht** ODER **in Fundus verschoben** (Restore-faehig).
- Im Confirm-Modal (§8.2 destruktiv): zwei Knoepfe „Loeschen mit Auswirkungen" / „In Fundus verschieben".

### 14a.2 Offene Detail-Fragen (zum richtigen Zeitpunkt zur Sprache)

Diese Fragen werden im Fundus-Sub-Sprint einzeln nach Workflow `feedback_konzept_diskussion_workflow.md` (Foundation+Grund-Info+Fragen → Stop) durchdiskutiert. Hier nur als Anker dokumentiert, damit nichts verloren geht:

| ID | Frage | Bemerkung |
|---|---|---|
| **F.1** | **Form des Fundus** — eigene Matrix auf Workspace-Root-Ebene? Oder eigener Container neben dem Matrix-Tree (z.B. wie ein Papierkorb-Bereich)? Visualisierung: andere Hintergrund-Farbe, dimmed, eigenes Symbol? | UX-Foundation. Pflicht-Anker fuer „abgegrenzt zu aktiver Arbeitsmatrix erkennbar" (User 2026-05-07). |
| **F.2** | **Atom-Status im Fundus** — sind Atome dort aktiv (weiter Realtime-Subscription, weiter Alias-aufloesbar) oder deaktiviert (frozen-Snapshot)? | Konsequenz fuer Realtime-Konsistenz §5.8 + Alias-Resolver. |
| **F.3** | **Manifestationen-Konsequenz** — wenn Atom im Fundus liegt, was passiert mit existing Manifestationen in **anderen** Cells? Werden sie auch in Fundus-mode geschoben (sichtbar mit Hint „im Fundus")? Oder werden sie hart entfernt aus den anderen Cells beim Verschieben? Oder bleiben sie unveraendert sichtbar? | Single-Source vs Live-Reference. Gravierend fuer User-Erwartung. |
| **F.4** | **Alias-Resolution** — Alias zu einem Fundus-Atom: weiter aufloesbar (mit Hint „im Fundus")? Oder broken? Oder soft-broken (Alias-Resolver gibt Warnung)? | `^kunde` darf nicht stillschweigend ins Leere zeigen. |
| **F.5** | **Schema-Form** — neue Spalte `is_in_fundus` (boolean) auf jedem Atom-Aggregat? Oder eigene Tabelle `fundus_atoms` mit FK auf Atom + verschoben_at? Oder `state`-Enum (`active`/`fundus`/`archived`)? | Heptad-Slot 1 (Schema). Performance bei Listen-Filter. |
| **F.6** | **Berechtigungen + Scope** — Fundus pro User? Pro Workspace? Plattform-weit? Hybrid (User-privater + Workspace-shared)? | RLS-Form. |
| **F.7** | **Restore-Pfad UX** — wie holt User ein Atom aus Fundus zurueck? Drag-and-Drop in eine Cell? Restore-Button mit Cell-Picker? Auto-Restore bei Aufruf via Alias? | UX-Flow. |
| **F.8** | **Fundus vs. Welle Export-Pfad** — wenn `DangerousDeleteModal` schon Export-Checkbox hat (§8.2 Doppelter-Boden), warum braucht es zusaetzlich den Fundus? Hat der Fundus eine andere Funktion (in-app-Wiederbeschaffung) als Export (out-of-app-Sicherung)? | Beziehung der zwei Doppelboeden klaeren. |
| **F.9** | **Sub-Strukturen + Sub-Matrizen** — wenn eine Sub-Matrix als Atom in Fundus geht: gehen alle ihre inneren Cells/Atome mit? Oder nur die Sub-Matrix-Manifestation? | Rekursions-Logik. |
| **F.10** | **Auto-Cleanup** — Atome im Fundus, die laenger als X Tage liegen, werden hart geloescht? Oder ewige Aufbewahrung (User-driven Cleanup)? | Storage-Hygiene. |
| **F.11** | **Migration der heutigen Soft-Delete-Implementierungen** — Welle T hat Tasks mit `archived_at`, Welle D hat Doc-Pins mit Soft-State. Wird das im Fundus-Modell konsolidiert oder bleiben Cell-spezifische Soft-Delete-Pfade parallel? | Adjacent-Cleanup-Frage. |
| **F.12** | **Foundation-Direktive §14 Konsequenz** — Fundus = native Lastfunktion. Vereinbar mit Integration-First? Oder soll Fundus Bridge-Konzept haben (z.B. Atom geht in OneNote-Archiv-Section)? | §14-Probe. |

### 14a.3 Erst-Loesch-Probe (Verankerung in §8.2)

Im Bulk-Confirm-Modal (Alt+Hotkey, Alt+Entf) wird die Fundus-Wahl angeboten — **sobald der Fundus konzeptionell verabschiedet und implementiert ist**. Bis dahin: nur „Loeschen mit Auswirkungen" + „Export-Checkbox als Doppelter-Boden" (§8.2).

### 14a.4 BACKLOG-Verankerung

Eintrag `WV.Z — Fundus-Foundation` in `docs/BACKLOG-2026-04-30.md` Welle I-WV. TBD-Aufwand. Pflicht-Output: F.1-F.12 final + Schema-Heptad + UI-Spec.

---

<a id="15"></a>
## 15. Schema-Heptad-Skizze

Pro neuer Tabelle (siehe §6.2 + §13 + §14) alle 7 + 1 Slots benannt. Detail-DDL kommt in der Implementierungs-Welle, hier nur Skizze:

**Update 2026-05-05 (Punkt 3.4-Folgeklaerung):** geplante Tabelle `widget_instances` entfaellt — Slot/Aggregat-Unterscheidung ist Filter-basiert, kein neuer `parent_kind`. Welle-D-Tag-System loest die Slot-Zuweisung (siehe §5.2). Eine Tabelle weniger im Heptad.

**Neue Tabelle 2026-05-05: `saved_filters`** — wiederverwendbare Filter-Definitionen fuer Widget-Filter, Sidebar-Filter, Command-Palette-Suche. Re-Use-Pattern (Doublet-Verbot, `code-quality.md` §1).

**Neue Tabelle 2026-05-06: `atom_markers`** — User-Markierungen an Atomen (Star Workspace-shared + Eye User-privat). Layer-4-Pattern, polymorph wie atom_comments. Schema:

```sql
CREATE TABLE atom_markers (
  id           uuid PK,
  atom_type    enum('task','link','doc','checklist','imported_event','info_field'),
  atom_id      uuid,
  workspace_id uuid FK workspaces ON DELETE CASCADE,
  user_id      uuid FK auth.users ON DELETE CASCADE,
  kind         text CHECK (kind IN ('star','eye')),
  created_at   timestamptz DEFAULT now(),
  UNIQUE (atom_type, atom_id, user_id, kind)
);
```

RLS:
- SELECT: `is_workspace_member(workspace_id) AND (kind='star' OR user_id=auth.uid())` — Star ist Workspace-shared, Eye nur fuer Owner sichtbar.
- INSERT/UPDATE/DELETE: nur fuer Owner (`user_id=auth.uid()`) + `is_workspace_member(workspace_id)`.

Migration-Welle: **WV.B Atom-Erweiterung** (zusammen mit `info_field` und `link.provider`).

**Schema-Erweiterung 2026-05-06: `info_field`-Atom + Cell-Daten-Migration** (Welle WV.B, finalisiert 2026-05-06):

```sql
-- 1. atom_type-Enum erweitert.
ALTER TYPE atom_type ADD VALUE 'info_field';

-- 2. info_fields-Aggregate-Tabelle.
CREATE TABLE info_fields (
  id           uuid PK,
  workspace_id uuid FK workspaces ON DELETE CASCADE,
  label        text NOT NULL,
  value        text NULL,                       -- Text-Repraesentation, je Type interpretiert
  value_type   text NOT NULL DEFAULT 'text'
                 CHECK (value_type IN (
                   'text', 'number', 'date', 'currency',
                   'boolean', 'email', 'phone', 'url',
                   'enum', 'alias-ref'
                 )),
  value_meta   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- typed-Erweiterungen
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
-- RLS: SELECT is_workspace_member, WRITE can_write_workspace.
-- REPLICA IDENTITY FULL + Realtime-Publication (§5.8 Direktive).

-- 3. atom_manifestations.kind erlaubt 'info' (neuer Kind fuer Cell-Info-Section).
ALTER TYPE manifestation_kind ADD VALUE 'info';

-- 4. Cascade-Trigger: info_fields-DELETE → atom_manifestations purge (analog tasks-Trigger).
CREATE TRIGGER _atom_manif_purge_for_info_fields ...

-- 5. Clean-cut: cell.data Sub-Keys droppen (User-Direktive: keine relevanten Daten).
UPDATE cells SET data = data - 'infoFields' - 'links' WHERE data ? 'infoFields' OR data ? 'links';
-- (Optional V1-Polish:) wenn cells.data nach diesem Update leer-jsonb ist und keine anderen Sub-Keys: Spalte droppen.
```

**`value_type`-Liste V1 (final 2026-05-06):**

| Type | Native-Renderer im Form-Widget | value_meta-Erweiterung |
|---|---|---|
| `text` | Plain Text-Input | — |
| `number` | Number-Input mit Min/Max-Constraints | `{ min, max, step, unit }` |
| `date` | Date-Picker (Lokalisiert DE) | `{ format }` (z.B. `'date'` / `'datetime'`) |
| `currency` | Currency-Input mit Symbol + Locale-Format | `{ currency_code, locale }` |
| `boolean` | Toggle/Switch (`style.md` §5.2 Pattern) | — |
| `email` | Email-Input + Display als `mailto:`-Link beim Render | — |
| `phone` | Phone-Input + Display als `tel:`-Link beim Render | — |
| `url` | URL-Input + Click-Through (sanitizeUrl-validiert) | — |
| `enum` | Dropdown mit User-definiertem Auswahl-Set | `{ options: string[] }` |
| `alias-ref` | Alias-Picker (reuse `lib/use-alias-autocomplete.ts`) — verlinktes Atom inline | `{ atom_type? }` |

V2-deferred: `rich-text` (Mini-ProseMirror-Inline) — Editor-Heavy, nicht V1-noetig.

**Cell-Info-Section-Layout (Plattform-Default-Vorlage „Info" §11):**
- Section „Felder" mit Form-Widget rendert `info_field`-Atome — pro Feld nativer Renderer aus value_type.
- Section „Links" mit Link-List-Widget — `link`-Atome mit `provider='url'`-Filter.
- Section „Doku" mit Doc-List-Widget — gepinnte `doc`-Atome.

**MCP-Tool-Naming (final 2026-05-06):** `info_field.add` / `info_field.edit` / `info_field.move` / `info_field.delete` / `info_field.list` — konsistent mit `atom-tag.*` und `atom-pin.*` aus Welle D. Tool-Trio + Realtime-Garantie (§6.1) Pflicht.

**Cell-Links-Migration:** trivial mit `provider='url'` fuer alle. Heuristische Detektion (Mail-URL → `mail`, OneNote-URL → `onenote`) entfaellt — User hat keine Bestandsdaten.

---

**Schema-Erweiterung 2026-05-06: `links.provider`-Diskriminator** (Welle WV.B):

```sql
-- Bestehende `links.type`-Spalte wird gedroppt (Clean-cut, Memory feedback_clean_cut_no_prod_data.md).
ALTER TABLE links DROP COLUMN type;

-- Neuer Diskriminator + Provider-Native-Metadaten.
ALTER TABLE links ADD COLUMN provider text NOT NULL DEFAULT 'url'
  CHECK (provider IN (
    'url',
    'mail', 'mail-generic',
    'onenote', 'notion',
    'onedrive', 'drive', 'dropbox', 'nextcloud',
    'slack', 'teams',
    'whatsapp', 'discord', 'telegram',
    'protonmail',
    'filesystem'
  ));
ALTER TABLE links ADD COLUMN provider_meta jsonb NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN links.provider IS 'Diskriminator fuer Provider-spezifische UI + Validation + Click-Action.';
COMMENT ON COLUMN links.provider_meta IS 'Provider-Native-IDs (thread_id, page_id, file_id) + Display-Cache (subject, preview, sender, date).';
```

**`links.url`-Konvention** (final 2026-05-06):
- `url` haelt **kanonische Click-Through-URL**.
- Fuer Provider mit Public-Permalink (Outlook-Web, OneNote-Web, Slack, Drive-Share-Link): direkter Provider-Permalink.
- Fuer Provider ohne Public-URL (`mail-generic` IMAP): App-interne Resolver-URL `https://matrix.levcon.at/api/resolve/<provider>/<provider_meta.id>` — Tool-eigene Click-Through-Page resolved + redirected.
- B-tree-Index auf `url` bleibt fuer Search.

**`mail-generic` (User-Frage 2026-05-06):** IMAP+SMTP-Generic-Setup. User gibt IMAP-Server, SMTP-Server, Username, App-Password an — verschluesselter Storage in `user_oauth_tokens` analog OAuth-Token (Master-Key-Pattern aus `user_ai_providers`). Sicherheits-Hinweis: App-Password ist heikler als OAuth — UI soll User darauf hinweisen.

**Neue Tabelle 2026-05-06: `user_oauth_tokens`** (Welle WV.D Channel-Bridges, Voraussetzung fuer Channel-Provider):

```sql
CREATE TABLE user_oauth_tokens (
  id                       uuid PK,
  user_id                  uuid FK auth.users ON DELETE CASCADE,
  provider                 text,                          -- 'outlook', 'gmail', 'onenote', 'onedrive', 'mail-generic', ...
  access_token_encrypted   bytea,                         -- pgp_sym_encrypt mit app.ai_master_key
  refresh_token_encrypted  bytea NULL,                    -- NULL bei mail-generic (App-Password)
  generic_credentials_encrypted bytea NULL,               -- mail-generic: { imap_host, smtp_host, username, app_password }
  expires_at               timestamptz NULL,              -- NULL bei App-Password
  scopes                   text[] NULL,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),
  UNIQUE (user_id, provider)
);
```

RLS: SELECT/WRITE nur fuer Owner (`user_id=auth.uid()`). Token-Refresh laeuft Lazy beim Read (wenn `expires_at < now()` → Refresh-Call vor Provider-API-Call).

**Neue Tabelle 2026-05-06: `widget_external_channels`** (Welle WV.D, Verknuepfung Widget zu Provider-Ref):

```sql
CREATE TABLE widget_external_channels (
  id              uuid PK,
  widget_id       uuid FK template_widgets ON DELETE CASCADE,
  workspace_id    uuid FK workspaces ON DELETE CASCADE,
  provider        text,                                   -- gleiche Liste wie links.provider
  external_ref    jsonb,                                  -- Provider-Native-IDs (thread_id, channel_id, folder_id)
  created_at      timestamptz DEFAULT now()
);
```

Token-Bezug: jeder calling User authentifiziert mit eigenem `user_oauth_tokens`-Eintrag. `widget_external_channels` haelt nur den Provider-Ref, nicht die Tokens — Tokens bleiben User-Privat-Eigentum.

### 15.0 Heptad-Round-Trip-Status (Audit 2026-05-09)

**Status:** Workspace-Round-Trip-Loop fuer alle 13 Tabellen LIVE seit 2026-05-09.

Vor 2026-05-09 wurden 8 Tabellen zwar exportiert aber NIE importiert (Slot-6-Heptad-Luecke):
- `feature_templates`, `template_sections`, `template_widgets`, `cell_template_instances`, `cell_widget_overrides`, `workspace_hotkey_slots`, `saved_filters`, `widget_external_channels`

**Behoben 2026-05-09 in `executeSubtreeImportIntoMatrix`:**
- Workspace-Globals-Block fuer `payload.payloadType === 'workspace'`. Subtree-Imports skippen die Workspace-Globals (sind nicht im Subtree-Export).
- FK-Reihenfolge respektiert: `feature_templates` → `template_sections` → `template_widgets` → (Root-Widget-Back-Ref-UPDATE) → `cell_template_instances` → `cell_widget_overrides` → `workspace_hotkey_slots` → `saved_filters` → `widget_external_channels`.
- Filter pro Tabelle:
  - `feature_templates`: nur `visibility='workspace'` (platform-Templates sind system-seeded; user-Templates sind privat zum source-User).
  - `workspace_hotkey_slots`: nur `scope='workspace'`.
  - `saved_filters`: nur `scope='workspace'` + `owner_user_id` → NULL.
  - `widget_external_channels`: `oauth_token_ref` → NULL (§15.2 Sicherheits-Direktive — User muss neu authentisieren).
- `feature_templates.root_widget_id` ist Back-Reference auf `template_widgets`; V1-Loesung: initial NULL, post-Insert UPDATE-Pass.
- Cleanup-on-Fail erweitert: `cleanupPartialImport` nimmt `WorkspaceGlobalsCleanup` als optionalen Param. FK-CASCADE auf `feature_templates` raeumt `template_sections` + `template_widgets` automatisch mit; `cell_*` + `hotkey_slots` + `saved_filters` + `widget_external_channels` werden separat geloescht.

**Konzept-Punkt §15.0 Workspace-Round-Trip zugemacht.**

### 15.1 Heptad-Pflege pro Tabelle (kein „dito"-Schleifen)

**Direktive (User 2026-05-07: „du entscheidest fachlich"):** jede Tabelle bekommt eigene Spalte mit allen 8 Slots — Architektur §3 verlangt Pro-Tabelle-Pflege, „dito"-Verweise verschleiern Cache/Realtime/Export-Pflichten und brachen in Welle D als Lessons-Learned (Tag-System Heptad-Lueckenexport).

V1-Tabellen-Liste (post-WV.WV-Stand): **13 neue/erweiterte Tabellen** — aufgeteilt in drei Sub-Tabellen fuer Lesbarkeit.

#### A) Vorlagen-Strukturdaten (kein User-Inhalt)

| # | Slot | `feature_templates` | `template_sections` | `template_widgets` | `cell_template_instances` | `cell_widget_overrides` | `hotkey_slots` |
|---|---|---|---|---|---|---|---|
| 1 | Schema | (id, workspace_id NULL, owner_user_id NULL, **scope ENUM**, name, symbol, **render_position ENUM**, **root_widget_id FK**, layout_version, hotkey_slot, title_template, created_at) | (id, template_id FK CASCADE, title, position, default_collapsed bool) | (id, section_id FK CASCADE, type, column, position, size_cols, size_rows, data_jsonb, toggles_jsonb, config_jsonb) | (id, cell_id FK CASCADE, template_id FK, applied_at, layout_version_pinned NULL) | (id, instance_id FK CASCADE, widget_id FK, override_jsonb) | (id, **scope ENUM**, workspace_id NULL, user_id NULL, slot CHECK 1-9, template_id FK, created_at) |
| 2 | Types | `FeatureTemplate` mit Discriminated-Union ueber `scope` | `TemplateSection` | `TemplateWidget` (mit `WidgetData`-Discriminator) | `CellTemplateInstance` | `CellWidgetOverride` | `HotkeySlot` |
| 3 | Mutations | `lib/feature-templates.ts` CRUD | `lib/template-sections.ts` | `lib/template-widgets.ts` | `lib/cell-template.ts` (apply/reset/bulk) | `lib/cell-widget-overrides.ts` (sparse upsert) | `lib/hotkey-slots.ts` |
| 4 | Cache | TABLES `feature_templates` + DB_VERSION+1 | TABLES + DB_VERSION+1 | TABLES + DB_VERSION+1 | TABLES + DB_VERSION+1 | TABLES + DB_VERSION+1 | TABLES + DB_VERSION+1 |
| 5 | Realtime | Workspace-Channel + RLS-Filter (siehe §15.3) | Workspace-Channel | Workspace-Channel | Workspace-Channel | Workspace-Channel | Workspace-Channel mit RLS-Filter (User-scope nur fuer Owner) |
| 6 | Export/Import | WorkspaceExport `feature_templates[]` (scope='workspace' + scope='user' fuer Owner) | embedded in template | embedded in template | embedded in cell-export | embedded in cell-export | exportiert nur scope='workspace'; user-scope wird beim Import vom Owner neu gesetzt |
| 7 | MCP-Tools | `template.add/edit/list/delete/apply` | `template.section.add/edit/move/delete` | `template.widget.add/edit/move/delete/configure` | `cell.template.apply/reset/bulk_apply` | `cell.widget.override.set/clear` | `hotkey.slot.assign/clear/list` |
| 8 | Channel-Bridge §14 | n/a — Strukturdaten | n/a | n/a | n/a | n/a | n/a |

#### B) Atom-Erweiterungen + Channel-Bridge (User-Inhalt)

| # | Slot | `info_fields` (NEU, Welle WV.B) | `links` (EXTENDED, Welle WV.B) | `user_oauth_tokens` (NEU, Welle WV.D) | `widget_external_channels` (NEU, Welle WV.D) |
|---|---|---|---|---|---|
| 1 | Schema | (id, workspace_id FK CASCADE, label, value, value_type ENUM 10, value_meta jsonb, **symbol_override** text NULL, position, created_at, updated_at) | ALTER: ADD `provider` ENUM 15, ADD `provider_meta` jsonb, ADD **`symbol_override` text NULL**, ADD **`click_count` int default 0** + Increment-Trigger; DROP `type` (clean-cut) | (id, user_id FK CASCADE, provider, access_token_encrypted bytea, refresh_token_encrypted bytea NULL, generic_credentials_encrypted bytea NULL, expires_at NULL, scopes text[] NULL, created_at, updated_at, UNIQUE (user_id, provider)) | (id, widget_id FK template_widgets CASCADE, workspace_id FK CASCADE, provider, external_ref jsonb, oauth_token_ref FK user_oauth_tokens NULL, created_at) |
| 2 | Types | `InfoFieldRow` + ValueType-Discriminated-Union | erweitert `LinkRow` um `provider` + `provider_meta` | `UserOAuthToken` | `WidgetExternalChannel` |
| 3 | Mutations | `lib/info-fields.ts` CRUD via safe-mutation | `lib/links.ts` erweitert; click-counter-Trigger in DB | `lib/user-oauth.ts` (encrypt via app.ai_master_key, lazy-refresh) | `lib/widget-channels.ts` (connect/disconnect, OAuth-Bridge) |
| 4 | Cache | TABLES `info_fields` + DB_VERSION+1 | bestehender `links`-Eintrag bleibt; DB_VERSION+1 wegen Schema-Drift | **NEIN — sensitive** (keine IDB-Spiegelung von Tokens) | TABLES `widget_external_channels` + DB_VERSION+1 |
| 5 | Realtime | Workspace-Channel + REPLICA IDENTITY FULL | Workspace-Channel (existing) — Trigger updated `updated_at` damit Realtime feuert | **NEIN** — kein Realtime fuer Tokens (sensitive). Beim Refresh nur Local-Update | Workspace-Channel — Channel-State-Updates an alle Member |
| 6 | Export/Import | als Atom in `WorkspaceExport.atoms.info_fields[]` | bestehende Export-Logik, `provider`-Spalte mit | **NEIN — nicht exportiert** (User-privat, Sicherheit §15.2). User muss nach Import neu verknuepfen | `external_ref` exportiert, `oauth_token_ref` als opaker Verweis (nicht als Inhalt) — beim Import vom Owner neu zu authentisieren |
| 7 | MCP-Tools | `info_field.add/edit/move/delete/list` | `link.add/edit/list/delete` (existing) — erweitert um `provider`-Param | **interne Funktion, keine MCP-Tools** (Security: AI darf User-Tokens nicht steuern) | `widget.channel.connect/disconnect/list` |
| 8 | Channel-Bridge §14 | V2 deferred: Notion-DB-Row-Sync, OneNote-Page-Section-Sync. V1 native-only mit Verweis auf §13.2-V2. | `provider`-Diskriminator IST die Bridge — `mail`/`mail-generic`/`onenote`/`drive`/... | **= dieser Slot ist die Bridge-Identitaet selbst** — Token-Storage fuer alle Provider | **= dieser Slot ist die Bridge-Verknuepfung selbst** — Widget zu externem Channel/Thread |

#### C) Querschnitt + EXTENDED + GONE

| # | Slot | `saved_filters` (NEU, Welle WV.B) | `atom_markers` (NEU, Welle WV.B) | `atom_manifestations` (EXTENDED, Welle WV.WV) | `atom_pins` (GONE, Welle WV.WV) |
|---|---|---|---|---|---|
| 1 | Schema | (id, workspace_id FK CASCADE, owner_user_id FK NULL, **scope ENUM('workspace','user')**, name, description, filter_json, usage_count, created_at) | (id, atom_type ENUM 6, atom_id, workspace_id FK CASCADE, user_id FK CASCADE, kind CHECK ('star','eye'), created_at, UNIQUE) | ALTER: erweitert `kind`-ENUM um `'pinned'`, neue Spalte `container_kind` ENUM ('cell','atom','node','kanban-col','checklist','calendar') | **DROP TABLE** atom_pins; Cascade-Trigger entfernt; Daten werden vor Drop migriert in atom_manifestations(kind='pinned') |
| 2 | Types | `SavedFilter` mit scope-Discriminated-Union | `AtomMarker` mit kind-Discriminated-Union | bestehender `ManifestationRow` erweitert um `container_kind` | n/a (Type wird entfernt aus `lib/types.ts`) |
| 3 | Mutations | `lib/saved-filters.ts` CRUD | `lib/atom-markers.ts` toggle/list mit RLS-aware Filter | bestehende Helper akzeptieren neue kind/container_kind | n/a (`lib/atom-pins.ts` wird zu Compat-Wrapper auf atom_manifestations dann entfernt) |
| 4 | Cache | TABLES `saved_filters` + DB_VERSION+1 | TABLES `atom_markers` + DB_VERSION+1 | bestehender Cache-Eintrag bleibt; DB_VERSION+1 wegen `container_kind`-Drift | **TABLES drop** + DB_VERSION+1 (OBSOLETE_STORES-Eintrag damit alte IDB sauber gewipt) |
| 5 | Realtime | Workspace-Channel + RLS-Filter (User-scope nur Owner) | **Star Workspace-Realtime, Eye User-privat** (Throttle 1-2s pro Atom) | bestehende Subscription deckt erweiterte kinds ab | **Subscriber-Eintrag entfernen** in `realtime.ts` |
| 6 | Export/Import | `WorkspaceExport.saved_filters[]` (scope='workspace' + Owner-scope='user') | **Star exportiert** (workspace-shared), **Eye nicht** (user-privat) | bestehende Export-Logik deckt erweiterte kinds ab | **Export-Pfad entfernen** in `lib/export.ts` + `subtree-import.ts` |
| 7 | MCP-Tools | `filter.add/edit/list/delete/apply` | `atom.marker.toggle/list` | bestehende `manif.*`-Tools akzeptieren neue kinds | **MCP-Tools deprecaten** (`atom_pin.*` aus `bridge/src/tools/`) |
| 8 | Channel-Bridge §14 | n/a — Strukturdaten (Filter-Definitionen) | n/a — User-Annotation, kein extern persistierter Inhalt | n/a — bestehende Logik | n/a — Tabelle entfaellt |

### 15.2 Sicherheits-Direktive — OAuth-Tokens nicht exportieren (User 2026-05-07 bestaetigt)

`user_oauth_tokens` und Token-Bestandteile aus `widget_external_channels` werden **nicht in den Workspace-Export aufgenommen.**

**Begruendung:**
- Tokens sind User-privat per RLS (`user_id=auth.uid()` SELECT/WRITE).
- Workspace-Export ist Workspace-public — alle Member, die Import machen koennen, wuerden Tokens lesen koennen, die ihnen RLS-rechtlich nie sichtbar waren. **Datenpanne.**
- Praezedenz: `user_ai_providers` (Architektur §12.4) — gleiche Logik, nie in Backups eingefuegt.

**Konsequenz nach Import:** User muss Channels neu verknuepfen (OAuth-Re-Auth). UX-Hinweis im Import-Wizard: „Externe Channels muessen nach Import neu verknuepft werden."

### 15.3 Realtime fuer `feature_templates` — Workspace-public mit RLS-Filter (User 2026-05-07 bestaetigt)

`feature_templates`-Subscription ist **Workspace-Channel mit RLS-Filter** (nicht zwei separate Channels).

**Begruendung:**
- Pro Architektur §5.1 ein Channel pro Workspace, keine Channel-pro-Tabelle/Komponente.
- RLS schneidet User-scope (`scope='user'`) clientseitig + serverseitig zu — Owner sieht eigene Vorlagen, andere Member sehen die nicht.
- Plattform-Vorlagen (`scope='platform'`) sind read-only fuer alle, Realtime erkennt Plattform-Admin-Updates.
- Workspace-Vorlagen (`scope='workspace'`): alle Member sehen Mutations live.

**Throttle:** kein Throttle noetig — Vorlagen-Mutations sind selten (User-driven, nicht hochfrequent).

### 15.4 RLS-Skizze pro Tabelle (User 2026-05-07 bestaetigt + erweitert)

Standard-Pattern §5.3 mit Diskriminator-Branching:

| Tabelle | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| `feature_templates` | `is_workspace_member(workspace_id) OR scope='platform'` (Plattform-Read fuer alle) OR (`scope='user' AND owner_user_id=auth.uid()`) | `scope='platform' AND is_platform_admin()` ODER (`scope='workspace' AND can_write_workspace`) ODER (`scope='user' AND owner_user_id=auth.uid()`) |
| `template_sections` / `template_widgets` | erbt via `template_id`-Join | erbt via `template_id`-Join |
| `cell_template_instances` / `cell_widget_overrides` | `is_workspace_member(workspace_id)` (cell-via-join) | `can_write_workspace` |
| `hotkey_slots` | `(scope='workspace' AND is_workspace_member)` ODER (`scope='user' AND user_id=auth.uid()`) | gleiche Logik |
| `info_fields` | `is_workspace_member` | `can_write_workspace` |
| `user_oauth_tokens` | nur Owner (`user_id=auth.uid()`) | nur Owner |
| `widget_external_channels` | `is_workspace_member` | `can_write_workspace` |
| `saved_filters` | `is_workspace_member AND (scope='workspace' OR owner_user_id=auth.uid())` | `can_write_workspace AND (scope='workspace' OR owner_user_id=auth.uid())` |
| `atom_markers` | `is_workspace_member AND (kind='star' OR user_id=auth.uid())` (Star shared, Eye Owner-only) | nur Owner |
| `oauth_provider_slots` | `is_platform_admin()` (Read+Write) — Plattform-Konfig, nicht User-/Workspace-skopiert. Status-Heartbeat-Updates ueber RPC `set_oauth_provider_slot_status` mit SECURITY DEFINER. | nur `is_platform_admin()` |
| `atom_manifestations` (extended §9.A) | `is_workspace_member(workspace_id)` mit Container-Branching: `container_kind='cell'` join cells.workspace, `container_kind='atom'` join atom-Tabelle | `can_write_workspace` mit gleichem Branching |

`is_platform_admin()` ist existing Helper aus Welle B (Plattform-Admin-Foundation). `is_workspace_member()` und `can_write_workspace()` sind Architektur-§5.3-Helper.

### 15.5 Channel-Bridge-Slot 8 immer gefuellt (User 2026-05-07 bestaetigt, §14.3 Pflicht)

Pro Tabelle in §15.1 explizit gefuellt:

- **Strukturdaten / Annotation** (8 Tabellen): Slot 8 = `n/a — Strukturdaten/Annotation, kein extern haltbarer User-Inhalt`. Fallen nicht unter §14.3-Probe.
- **User-Inhalts-Tabellen** (4 Tabellen): Slot 8 explizit:
  - `info_fields`: V2 Notion-DB-Row-Sync + OneNote-Page-Section-Sync (siehe §13.2). V1 native-only mit Bridge-Plan im V2-BACKLOG.
  - `links`: `provider`-Discriminator IST die Bridge selbst (15 Provider-Werte).
  - `user_oauth_tokens`: = die Bridge-Identitaet (Token-Storage fuer alle Provider).
  - `widget_external_channels`: = die Bridge-Verknuepfung (Widget zu externem Thread/Channel).

**Foundation-Direktive-Probe (§14.7):** vor Welle WV.D-Start ist Slot 8 fuer alle 4 User-Inhalts-Tabellen ausgefuellt. ✓

### 15.6 Detail-Konventionen

**`saved_filters`-Detail:**
- `scope ENUM('workspace', 'user')` — Workspace-shared oder User-privat (analog `hotkey_slots`).
- `filter_json` haelt `WidgetFilter`-Struktur (siehe §5.2.6) — gleiches Format wie Widget-eingebetteter Filter.
- `usage_count` getriggered bei Verwendung in einem Widget oder Saved-Search.
- RLS siehe §15.4.

**`hotkey_slots`-Detail:**
- `scope ENUM('workspace', 'user')` — Workspace-Default ODER User-Override.
- `workspace_id NULL` bei `scope='user'`, `user_id NULL` bei `scope='workspace'` (Polymorphie-light analog `saved_filters`).
- `slot CHECK (slot IN ('1','2','3','4','5','6','7','8','9'))` — V1 nur Ziffern, V2-Erweiterung um Buchstaben siehe §6.3 + 7.7.
- UNIQUE (scope, workspace_id, slot) bei workspace, UNIQUE (scope, user_id, slot) bei user — via Partial-Index.

**`feature_templates.scope`-Detail:**
- `scope ENUM('platform', 'workspace', 'user')`.
- `scope='platform'`: `workspace_id NULL`, `owner_user_id NULL`, RLS-WRITE nur fuer Plattform-Admins.
- `scope='workspace'`: `workspace_id NOT NULL`, `owner_user_id NULL`.
- `scope='user'`: `workspace_id NULL` (User-Vorlage gilt cross-workspace fuer Owner) ODER `workspace_id NOT NULL` + `owner_user_id NOT NULL` (User-private innerhalb Workspace). **Entscheidung:** `workspace_id NOT NULL + owner_user_id NOT NULL` fuer scope='user' — Vorlagen sind kontextual (User in Workspace X braucht andere Vorlagen als in Workspace Y), und RLS-Pflege bleibt einfach.

**Sektion 15 KOMPLETT abgeschlossen 2026-05-07.**

---

<a id="16"></a>
## 16. Migration-Reihenfolge

**Direktive (User 2026-05-07: „du entscheidest fachlich"):** Reihenfolge ergibt sich aus Foundation-Pflichten — Atom-Schema vor Vorlagen-Schema (§1 Atom-Zwiebel), Konsolidierung vor neuen Strukturen (§2 Single-Source), Bridge-Konzept vor Native-Pfad (§14).

### 16.1 Pre-WV.A — Pflicht-Sprints (vor Welle A)

| # | Sprint | Pflicht | Begruendung |
|---|---|---|---|
| **WV.WV** | atom_pins-Konsolidierung + 7 Querschnitt-Komponenten + MIME-Rename (8 Outputs siehe BACKLOG) | **Pflicht vor WV.A** | atom_pins → atom_manifestations(kind='pinned') ist Schema-Foundation. Wenn parallel weitergelebt: Doublet-Drift in Welle A's `template_widgets.data`. WidgetPicker + DragHoverNavigator + AdapterDialog + Card-Polymorphie sind Voraussetzung fuer Vorlagen-Drop-Foundation. |
| **WV.Y** | Atom-Filter-Attribute-Audit → `lib/atom-filter-attrs.ts` (Single-Source) | **Pflicht vor WV.A** | Filter-Builder im Widget-Foundation braucht Single-Source. Saved-Filters (in Welle A vorgezogen) konsumieren das Format. Ohne Audit-Output entstehen Doublet-Pfade pro Caller. |

**WV.X** (Picker-Audit) ist NICHT Pre-WV.A-Pflicht (User-Direktive 2026-05-07: „muss nicht jetzt sein") — Welle WV.A nutzt heutige Picker as-is, Refactor zieht spaeter ein.

### 16.2 Welle A — Foundation (~15d)

1. Migration `feature_templates` + `template_sections` + `template_widgets` + `cell_template_instances` + `cell_widget_overrides` + `hotkey_slots` + `saved_filters` (alle 7 Tabellen aus §15.1-A + Querschnitt — `saved_filters` und `hotkey_slots` vorgezogen weil Foundation-Konsumenten).
2. RLS-Policies pro Tabelle (siehe §15.4).
3. Realtime-Publication + REPLICA IDENTITY FULL fuer alle 7 Tabellen.
4. Plattform-Default-Vorlagen einspielen: Kanban (Hotkey 2), Info (3), Checkliste (4), Smart Summary (auto_under_features ohne Slot — §11.6), Doc (Slot d via globaler Hotkey, nicht in feature_templates.hotkey_slot).
5. UI-Foundation: Widget-Renderer, Section/Column-Layout, `lib/widget-foundation.ts` mit Layout-Engine.
6. **FilterBuilderModal-Komponente** als globaler Reuse (siehe §17 R-WV-11) — konsumiert `lib/atom-filter-attrs.ts` aus WV.Y.
7. Schema-Heptad-Pflege: Types + Mutations + Cache + Realtime + Export + MCP fuer alle 7 Tabellen.

### 16.3 Welle B — Atom-Erweiterung + Symbol-System (~13d)

8. Migration `info_fields`-Atom + `atom_type`-Enum-Erweiterung.
9. Migration `links`-EXTENDED: ADD `provider` ENUM 15, ADD `provider_meta`, ADD `symbol_override`, ADD `click_count` + Increment-Trigger; DROP `type` (clean-cut).
10. Migration `info_fields.symbol_override`.
11. Migration `atom_markers`-Tabelle (Star + Eye, RLS pro kind).
12. **Symbol-System** (§12.6-§12.10): 10 Heroicons-Defaults pro value_type, 15 Brand-SVGs pro link.provider, Favicon-Fetch mit Service-Worker-Cache TTL 30d, Lazy-Render via IntersectionObserver, IconPicker fuer manuellen Override.
13. Backfill `cell.data.infoFields` → `info_field`-Atome + atom_manifestations(kind='info'). Clean-cut (Memory `feedback_clean_cut_no_prod_data.md`).
14. Backfill `cell.data.links` → `link.provider='url'`. Clean-cut.
15. Schema-Heptad-Pflege fuer alle Tabellen.

### 16.4 Welle C — Vorlagen-CRUD + Bulk-Apply (~14d)

16. **Vorlagen-Verwaltungs-Route `/w/:wsId/templates/`** — V1, NICHT V2 (User-Direktive 2026-05-05). Liste + Search + Filter + Usage-Counter + Loesch-Modal-mit-Feedback + Hotkey-Slot-Picker (V1 nur Ziffern 1-9).
17. Save-as-Template aus existing Cell-Feature (Edit-Mode-Action).
18. **Bulk-Action-Foundation** (Sektion 8): Multi-Select im Edit-Mode, globaler Store `lib/cell-selection.ts`, Hotkeys (Strg+Click/Shift+Click/Strg+A/ESC/Enter/1-9/Alt+1-9/Alt+Entf), Bulk-Wizard-Flow, Auto-Alias `{vorlage}-{row}-{col}`.
19. **4 Bulk-Komponenten** gemaess `code-quality.md` §6.5: `BulkScalarInput`, `DangerousDeleteModal`, `BulkConflictPicker`, `SlotHintToolbar`.
20. Reset-to-Template + sparse User-Overrides via `cell_widget_overrides`.
21. layout_version-Pinning + Update-Hint („Vorlage hat Update — anwenden?").
22. Schema-Heptad-Pflege.

### 16.5 Welle D — Channel-Bridges (~25d)

23. Migration `user_oauth_tokens` + `widget_external_channels`.
24. **OAuth-Foundation:** Lazy-Refresh-Pattern, encrypt via `app.ai_master_key` (Architektur §12), Provider-Slots im Admin-Dashboard mit Verify-Buttons (Memory `feedback_admin_dashboard_config_gate.md`).
25. **OneNote-Doc-Sync** (V1-Anker §13.2 + §14.2 Architektur): Workspace ↔ Notebook, Cell ↔ Section, Doc-Atom ↔ Page.
26. **Mail-Channel-Bridge** V1: SMTP+IMAP (mail-generic) + Slack + Teams (§13.1). Outlook-Graph + Gmail-API V2.
27. **Cloud-Drive-Bridge** V1: OneDrive + Google Drive + Dropbox + Nextcloud + pCloud (§13.3). kDrive/MagentaCLOUD/Tresorit/Mailbox.org V2.
28. **Public-Alias-Resolve-Endpoint** (§14.1) — Member-only V1, Login-Redirect bei Non-Member.
29. **AI-Tool `alias.expand_to_text`** (§14.3) mit `'markdown' | 'plain' | 'html'`-Format-Param.
30. Schema-Heptad-Pflege fuer alle Bridge-Tabellen + UI-Toggles pro Widget („extern / native / off", Default `extern`).

### 16.6 WV.Z — Fundus-Foundation (deferred, vor Welle F empfohlen)

31. **Fundus-Konzept-Sub-Sprint** (F.1-F.12 §14a) — Detail-Diskussion vor Implementation.
32. Schema `fundus_*`-Tabellen (Form-Entscheidung in Sub-Sprint).
33. UI-Spec Fundus-Container + Restore-UX.
34. **DangerousDeleteModal-Erweiterung** (§8.2): zweiter Knopf „In Fundus verschieben" als Adjacent-Cleanup. Bis WV.Z bleibt es Hard-Delete + Export-Checkbox-Doppelboden.
35. Schema-Heptad-Pflege.

### 16.7 Welle E — Cross-View-Komplettierung (~10d)

36. Doc-Cross-View vollstaendig (Drop-Targets §9.9 + §9.10 + §9.11).
37. Auto-Calendar-Manifestation aus `info_field(value_type='date')` (§9.14): Postgres-Trigger.
38. **Calendar-Outbound-Sync** (§10.5): Google + Outlook/Graph + Microsoft365, bidirektional mit External-Last-Write-Wins, OAuth-Re-Auth mit Calendar-Write-Scope.
39. info_field × kanban + checklist + calendar (§9.13) — post-WV.B Drag-Source-Erweiterung.
40. Schema-Heptad-Pflege.

### 16.8 Welle F — Polish + Activity-Stream (~10d)

41. **Activity-Stream-Widget** mit Multi-Source-Aggregation: Mail-Threads + Messenger + Mutations-Log + (opt-in) `atom_comments`. Liest **bevorzugt aus verknuepften externen Channels** (§11.1).
42. **Marker-UX-Komplettierung** auf Basis `atom_markers` (Welle B): Star Workspace-shared mit Counter, Eye User-privat ohne Counter (§13.6).
43. **Designer-First-Route** (V1 minimal oder V2 deferred — Entscheidung in Welle F selbst): WYSIWYG-Layout-Editor mit DnD-Canvas + Widget-Palette + Inspector. V1-Minimal-Variante: nur Inspector ohne DnD.
44. Schema-Heptad-Pflege.

### 16.9 WV.X — Picker-Audit (deferred, Timing TBD)

45. Picker-Audit-Sprint (siehe §5.2.3 + §17 R-WV-12). Refactor heutiger Picker-Foundation (Alias / Object / Tag / User / Atom / Cell). Pflicht-Output: Matrix mit Ist/Soll/Vereinheitlichung pro Picker-Fall. Welle WV.A-F nutzen heutige Picker as-is bis dieser Sprint zieht.

### 16.10 Aufwandsschaetzung total

| Phase | Aufwand |
|---|---|
| **Pre-WV.A:** WV.WV + WV.Y | ~17-22d |
| Welle A — Foundation | ~15d |
| Welle B — Atom + Symbol | ~13d |
| Welle C — Vorlagen-CRUD + Bulk | ~14d |
| Welle D — Channel-Bridges | ~25d |
| **WV.Z** Fundus | ~10-15d |
| Welle E — Cross-View | ~10d |
| Welle F — Polish + Activity | ~10d |
| **WV.X** Picker-Audit (Timing TBD, parallel/post-F) | ~10-15d |
| **Total** | **~125-140d** (User-CSV: „ok, lieber mehr als weniger") |

**Sektion 16 KOMPLETT abgeschlossen 2026-05-08.**

---

<a id="17"></a>
## 17. Risiken

| ID | Risiko | Mitigation |
|---|---|---|
| **R-WV-1** | **Foundation-Refactor-Tiefe** — Widget-Modell beruehrt fast jede Komponente (BoardView, ChecklistPanel, CellInfoPage, CellSummaryPage, DocsPopup). | Welle A liefert nur Foundation + leere Vorlagen. Bestehende Komponenten bleiben parallel, bis Default-Vorlagen sie ablösen (Welle C). |
| **R-WV-2** | **Bestand-Migration** — `cell.data.infoFields` zu Atom. | Clean-cut (User hat „keine relevanten Daten" gesagt? sonst Dual-Path eine Release-Generation). |
| **R-WV-3** | **Permissions** — Workspace-Vorlagen, User-Vorlagen, Plattform-Vorlagen mit RLS. | RLS-Policies pro Tabelle: Plattform-Read fuer alle, Workspace-Write nur fuer `can_write_workspace`, User-Vorlage nur fuer Owner. |
| **R-WV-4** | **Provider-OAuth-Komplexitaet** — pro Provider eigener OAuth-Flow + Token-Refresh + Scope-Mgmt. | Erst-Welle nur 1 Provider pro Domain (OneNote fuer Doc-Sync, Outlook fuer Mail-Channel, OneDrive fuer Attachments). V2 weitere Provider. |
| **R-WV-5** | **Layout-Versionen** — Vorlage aendert sich, bestehende Cell-Instances haben alte Layout. | `layout_version`-Spalte auf Vorlage + Instance, UI-Hint „Vorlage hat Update — anwenden?", keine automatische Migration. |
| **R-WV-6** | **Performance Widget-Render** — Smart-Summary mit 6 Widgets pro Cell × 100 Cells im Workspace = 600 Widget-Subscriptions. | Lazy-Subscribe pro Widget (nur wenn sichtbar), Realtime-Channel pro Workspace mit Routing nach Widget-ID, Skeleton-State waehrend Load. |
| **R-WV-7** | **Hotkey-Konflikt** — User belegt Slot 4 mit Vorlage X, drueckt 4 in Cell-Wizard erwartet aber Checkliste. | Slot-Hint-Toolbar im Edit-Mode (siehe §8.4) + Confirm-Modal beim ersten User-Override eines Plattform-Defaults. |
| **R-WV-8** | **Cross-View-Drag-Edge-Cases** — Doc-Atom in Kanban-Karte: Title-Snapshot aus Doc-Atom. Doc wird umbenannt → Karten-Title? | Live-Resolve via `title_template`-Pattern (Welle D), kein Snapshot. |
| **R-WV-9** | **AI-Tool-Permission** — `alias.expand_to_text` darf nicht uebergeordnete Cells leaken. | Permission-Check im Tool: nur Atome die der calling User-Token sehen darf. |
| **R-WV-10** | **Atom-spezifische Filter-Attribute** — Filter-Builder muss pro Atom-Type wissen welche Felder filterbar sind. Liste ist Konzept-vorlaeufig (siehe unten), **finale Definition zur Umsetzung** (User 2026-05-07: Variante B). | **Eigener Pre-WV.A-Audit-Sprint, deferred** (analog Picker-Audit). Pflicht-Output: pro Atom-Type pro Attribut Spalten-Mapping + UI-Form + Index-Pflicht + Translation-String + Drop-Diskussion. Single-Source `lib/atom-filter-attrs.ts`. Erweiterung-fest erlaubt (neuer Atom-Type → neue Attribut-Liste, Audit-Methodik wiederholen). Im BACKLOG verankert. Siehe §17.1 Auftrag-Block. |
| **R-WV-11** | **Filter-Builder-Globalitaet** — `FilterBuilderModal` wird in Widget-Filter, Sidebar-Filter, Command-Palette-Suche, Saved-Filters-Designer reused. Bei Doublet-Drift bricht UX-Konsistenz. | Komponente in `components/FilterBuilder/` mit eigenem README. Pro Sprint Adjacent-Cleanup-Probe. Storybook/Playwright-Test pro Caller. |
| **R-WV-12** | **Picker-Helper-Globalisierung** — Alias/Tag/Object/User/Atom/Cell-Picker existieren heute getrennt mit drei Render-Patterns (Hook / Modal / PM-Plugin), Tag- und User-Picker fehlen ganz auf generischer Ebene, Object-Picker hat zwei parallele Pfade. Filter-Builder braucht sie alle. | **Eigener Picker-Audit-Sprint, deferred** (User 2026-05-07: Timing TBD, „muss nicht jetzt sein"). Pflicht-Output: Matrix mit **Ist / Soll / Vereinheitlichung** pro existing Picker-Fall im Code. Detail-Entscheidungen leiten aus Matrix ab. Welle WV nutzt heutige Picker as-is, Refactor zieht spaeter ein. Im BACKLOG verankert. Siehe §5.2.3 Auftrag. |
| **R-WV-13** (NEU 2026-05-08) | **Custom-MIME-Migration im WV.WV** — Rename `application/x-matrix-atom` → `application/x-matrix-atom-ref` (§14.5). Wenn ein einziger Get-Handler stehenbleibt, bricht Drag-Drop fuer In-App-Drops still — Atom wird nicht erkannt, Cross-View-Drag schlaegt fehl ohne Fehler. | **Pre-Sprint-Audit:** `Grep("application/x-matrix-atom"\|getData\(.*atom)` ueber gesamten `client-web/src/`. Alle Get-Handler in einem Commit migrieren. Smoke-Test in jedem Drop-Target nach Migration: Card → Spalte, Doc → Spalte, Link → Checkliste, Card → Calendar. Plus Vitest fuer dataTransfer-MIME-Konvention. |
| **R-WV-14** (NEU 2026-05-08) | **Symbol-System Performance** — bei 100 Cells × 6 Widgets × 5 Atomen = 3000+ Symbol-Renders pro Workspace. Service-Worker-Cache + Brand-SVG-Assets + Lazy-Render via IntersectionObserver (§12.10) sind Foundation, aber bei vielen Brand-SVGs (15 Provider) waeren das 15 Single-Requests bei kalten Cache. | **Sprite-Sheet** fuer 15 Brand-SVGs (1 Request statt 15). Favicon-Fetch async (Lazy + IntersectionObserver) — kein Block des Initial-Renders. Skeleton-State pro Symbol bis SVG da. **Measurement vor Optimierung:** wenn Workspace < 50 Cells: kein Sprite-Sheet noetig. Audit erst bei realer Workspace-Groesse > 100 Cells im Production-Smoke. |
| **R-WV-15** (NEU 2026-05-08) | **WV.Z Fundus + Migration heutiger Soft-Delete-Pfade** — Welle T Tasks haben `archived_at` (Soft-Delete heute), Welle D Doc-Pins haben kein Soft-State (Hard-Delete heute). Bei Fundus-Implementation: konsolidieren oder parallel? Wenn parallel: zwei Soft-Delete-Pfade nebeneinander = §2 Single-Source-Verstoss. Wenn konsolidieren: Bestand-Migration noetig fuer Tasks. | **F.11-Frage im WV.Z-Sub-Sprint klaert das.** Bis WV.Z bleiben heutige Soft-Delete-Pfade unangetastet. Empfehlung: **konsolidieren** in `is_in_fundus`-Pattern (oder eigene `fundus_atoms`-Tabelle), Tasks-`archived_at` als Migration in Fundus uebernehmen, Doc-Pins-Soft-State als zweiter Migration-Schritt. Kein V1-Blocker — WV.Z deferred. |

**Final 2026-05-08 (User-Direktive: „bitte fachlich durchentscheiden"):** alle 15 Risiken (R-WV-1 bis R-WV-15) mit Mitigations bestaetigt. Drei NEUE Risiken (-13/-14/-15) entstanden aus Sektion 8-16-Diskussion und sind oben in der Tabelle dokumentiert. R-WV-10 + R-WV-12 verweisen auf eigene deferred Audit-Sprints (WV.Y / WV.X). R-WV-15 verweist auf WV.Z Fundus-Sub-Sprint.

### 17.1 Konzept-vorlaeufige Atom-Filter-Attribute (finale Liste zur Umsetzung)

| Atom-Type | Filterbare Attribute (V1-Vorschlag) |
|---|---|
| `task` | status, deadline (relativ: heute / diese Woche / dieser Monat / ueberfaellig), has_recur, assigned_to_user, has_subtasks, priority |
| `doc` | has_content (nicht-leer), updated_in_last_X_days, has_pin, has_external_sync (OneNote/Notion) |
| `link` | provider (15 Werte: `url` / `mail` / `mail-generic` / `onenote` / `notion` / `onedrive` / `drive` / `dropbox` / `nextcloud` / `slack` / `teams` / `whatsapp` / `discord` / `telegram` / `protonmail` / `filesystem`), click_count, has_alias, domain (aus url-Hostname), provider_meta-Felder (subject, sender, date) |
| `checklist` | completed_ratio, has_due, item_count, recur_active |
| `info_field` | value_type (10 Werte: text/number/date/currency/boolean/email/phone/url/enum/alias-ref), has_value, value_in_range, label_pattern, by_atom_attr (z.B. `value::date < today` fuer Vertragsende-Reminder) |
| `imported_event` | source_provider (`google`/`outlook`/`ics`), in_range (Datum-Bereich), all_day |

**Final 2026-05-08:** als V1-Vorschlag bestaetigt. **Diese Liste wird vor Welle WV.A finalisiert** in einem eigenen Pre-WV.A-Audit-Sprint WV.Y (User 2026-05-07: „Variante B und Drops zum gegeben Zeitpunkt besprechen" — analog Picker-Audit-Sprint §5.2.3). Erweiterungen je Atom-Type sind nach Audit Schema-Heptad-fest (Migration noetig wenn neues Attribut nicht aus existing Spalten ableitbar). V1-Vorschlag dient als Audit-Eingang, nicht als finale Schema-Definition.

**Pflicht-Output des Audit-Sprints** pro Atom-Type pro Attribut:
- **Spalten-Mapping** — `existing` (Spalte da, direkt filterbar) / `needs migration` (Schema-Migration noetig) / `drop` (Attribut faellt aus V1-Liste).
- **UI-Form** — `Select` / `Date-Range` / `Numeric` / `Boolean` / `Free-Text` / `Multi-Select`.
- **Index-Pflicht** — `BTREE` / `GIN` / `Partial` / `none` (mit Begruendung wenn das Attribut hochfrequent gefiltert wird).
- **Translation-String** — i18n-Key fuer das Attribut-Label im Filter-Builder-UI.
- **Drop-Diskussion** — Kandidaten wie `has_subtasks`, `domain` zu pruefen. Drops kommen erst beim Audit, nicht jetzt im Konzept.

**Output-File:** `lib/atom-filter-attrs.ts` als TS-Konstante (Single-Source) — Filter-Builder-Modal, Saved-Filters-Editor, AI-Tool `query.run`, Sidebar-Filter, Command-Palette-Suche konsumieren alle aus dieser Konstante.

**Detail-Entscheidungen** (Scope kuenftige Atome wie `marker`, JSON vs TS-Form, User-Custom-Attribute) **leiten aus dem Audit ab** — werden nicht jetzt im Konzept entschieden.

Erweiterungen je Atom-Type sind nach Audit Schema-Heptad-fest (Migration noetig wenn neues Attribut nicht aus existing Spalten ableitbar).

Verankert im BACKLOG als eigener Welle-Eintrag (siehe BACKLOG-Update 2026-05-07).

**Sektion 17 KOMPLETT abgeschlossen 2026-05-08.**

---

<a id="18"></a>
## 18. Verifikation des Konzepts

**Final 2026-05-08 (User-Direktive: „bitte fachlich durchentscheiden"):** Trace-Tests mit konkreten Setups + Schritten + Erfolgs-Kriterien + Fail-Modes. Sektion 18 ist **kein Konzept-Diskussions-Punkt**, sondern **Verifikations-Tracker zur Implementierungs-Phase**. Die Tests laufen **vor** und **nach** Welle WV.A — Pre-Welle als Konzept-Akzeptanz, Post-Welle als Smoke.

### 18.1 Trace-Test 1 — Bulk-Apply Vorlage „Info Vertrag" auf 5 Cells

**Setup:**
- Workspace mit 1 Matrix-Sub-Node, 5 leere Cells in einer Zeile.
- Vorlage „Info Vertrag" (User-Vorlage, scope='workspace') mit 3 Sections (Stammdaten, Links, Doku) und 5 Widgets.
- User ist Workspace-Owner (`can_write_workspace = true`).
- Zweite Browser-Session als Workspace-Member offen (Realtime-Probe).

**Schritte:**
1. Edit-Mode aktivieren (Strg+E). Slot-Hint-Toolbar erscheint mit Slot 6 = „Info Vertrag".
2. `Strg+A` — alle 5 Cells selektiert (Outline + Checkmark sichtbar, Toolbar-Counter-Pill „5").
3. Hotkey `6` — Bulk-Wizard Step 1 oeffnet sich: Liste der 5 Cells, Auto-Alias `info-vertrag-r1-c1` bis `info-vertrag-r1-c5`, alle markiert „anwenden".
4. Step 1a: 0 Konflikte (Cells leer), Skip-Liste leer, weiter.
5. Step 2: Default-Inhalt-Felder leer (User-Vorlage hat keine), kein Scalar-Input.
6. Step 3: Confirm „5 Cells erhalten Vorlage Info Vertrag", Apply.
7. Pulse-Animation pro Cell mit Stagger 30ms, Toolbar-Counter zaehlt bis 5/5.
8. UndoToast „5 Vorlagen angewendet — rueckgaengig" 8s sichtbar.

**Erfolgs-Kriterien:**
- 5 `cell_template_instances`-Eintraege erstellt.
- Alle 5 Cells zeigen „Info Vertrag"-Layout (3 Sections, 5 Widgets, leer).
- Aliase `info-vertrag-r1-c1` bis `info-vertrag-r1-c5` resolvable via `lib/alias-resolve.ts`.
- Realtime-Update erreicht zweite Session in **< 2s** (§5.8 Konsistenz-Direktive).
- Undo restored alle 5 Cells in einem Klick (Snapshot-Atomicity).
- Hotkey-Dispatch < 100ms (Wizard-Open).
- Apply-Total < 500ms fuer 5 Cells.
- Zero-Shift beim Edit-Mode-Toggle (§6.4 — Cell-Position bleibt identisch).

**Fail-Modes (Test deckt diese Bugs auf):**
- Bulk-Wizard zeigt unrelevante Cells (`lib/cell-selection.ts`-Bug).
- Apply geht nur auf 4 von 5 Cells (Mutation-Atomicity-Bug, RPC-Bundling).
- Realtime erreicht Session B nicht (`realtime.ts`-Subscribe vergessen).
- Undo macht nur 4 Cells rueckgaengig (`pushUndo`-Snapshot-Bug).
- Zero-Shift verletzt: Cell-Positionen verruecken beim Edit-Mode-Toggle.

### 18.2 Trace-Test 2 — Doc-Cross-View OneNote-Sync + Live-Title

**Setup:**
- User hat OneNote-OAuth verknuepft (`user_oauth_tokens` populated, scope='Notes.ReadWrite').
- Workspace-Mapping: Workspace ↔ Notebook „Vertraege", Cell ↔ Section „Mueller AG", Doc-Atom ↔ Page „Vertrag-2026".
- Cell hat Vorlage „Doku" mit Doc-Widget, Doc-Atom verknuepft mit OneNote-Page.

**Schritte:**
1. User editiert Doc-Title in Matrix → „Vertrag-2026 V2".
2. WV.D OneNote-Sync triggert: Page-Title-Update zur OneNote-Graph-API.
3. OneNote-API antwortet 200 OK, `lib/onenote-sync.ts` setzt `synced_at`.
4. Anderer Workspace-Member sieht Doc-Title-Update via Realtime in **< 2s**.
5. User dropt Doc-Atom in Kanban-Spalte einer anderen Cell.
6. WidgetPicker oeffnet (1 kompatibler Widget = Kanban-Spalte) → direkt droppen (1-Kompatibel-Routing).
7. `Card<doc>` erscheint: Title aus Doc-Atom (live-resolved), Mini-Excerpt erste 80 Zeichen, Doc-Icon, Pin-Count-Badge.
8. User dropt selbe Doc-Atom in Calendar-Range einer dritten Cell.
9. AdapterDialog oeffnet (date-Wahl als kein Auto-Mapping eindeutig) → User waehlt Wiedervorlage 2026-05-15.
10. Manifestation `kind='calendar'` mit display_meta-Snapshot erstellt.
11. User benennt Doc-Atom in Matrix erneut um → „Vertrag-2026 V3". Card<doc> in Kanban-Spalte aktualisiert sich live (R-WV-8 Mitigation).

**Erfolgs-Kriterien:**
- OneNote-Page-Title nach **< 10s** synchronisiert (Bridge-Latency-Toleranz).
- Realtime-Update Cross-User **< 2s**.
- Card<doc> rendert mit Live-Title (kein Snapshot — wichtig fuer R-WV-8).
- Doc-Rename → alle Manifestationen (Kanban + Calendar) aktualisieren sich live.
- Calendar-Manifestation respektiert Range + zeigt im Hauptkalender-Widget.
- Drei Sub-Tests: Drag aus Doc-Editor / Drag aus DocsPopup / Drag aus Mention liefern alle dasselbe `application/x-matrix-atom-ref`-JSON-Payload (R-WV-13).

**Fail-Modes:**
- OneNote-Sync timeout, kein Retry-Pfad → Bridge-Resilience-Bug.
- Doc-Title-Snapshot statt Live-Resolve → R-WV-8 Mitigation gebrochen.
- AdapterDialog erscheint nicht (auto-Adapter triggert faelschlich) → §9.C-Logik-Bug.
- Custom-MIME wird als String statt JSON gelesen → R-WV-13 Migration unvollstaendig.

### 18.3 Trace-Test 3 — Smart-Summary mit external Comment-Channel

**Setup:**
- Cell hat Smart-Summary-Auto-Render unter den Features (§11.6 `render_position='auto_under_features'`).
- Smart-Summary hat 6 Default-Widgets (Kommende Tasks, Anstehende Termine, Ueberfaellig, Haeufige Links, Letzte Docs, Activity-Stream).
- User hat Slack-Bridge verknuepft (`user_oauth_tokens` Slack-OAuth, `widget_external_channels` mapped Activity-Stream-Widget zu Slack-Channel `#vertraege`).
- User hat Cell-Substruktur mit 2 Tasks (1 ueberfaellig, 1 anstehend), 3 Links, 2 Docs.

**Schritte:**
1. User oeffnet Cell. Smart-Summary rendert unter den Cell-Features.
2. 6 Widgets laden parallel mit Skeleton-State (§2.14).
3. „Activity-Stream"-Widget zeigt Mix:
   - Mutations-Log-Entries (intern, aus `mutations.ts` audit-log).
   - Slack-Channel-Messages (extern, via `lib/widget-channels.ts`).
4. User klickt Edit-Mode auf Activity-Stream-Widget → Comment-Channel-Toggle: external/native/off (Default `external`).
5. User schreibt Comment in Widget-Eingabe „Vertrag erlaeutert mit Mueller AG", Submit.
6. Bridge sendet zur Slack-API → Channel `#vertraege` zeigt die Nachricht innerhalb **< 2s**.
7. Slack-User antwortet im Channel `#vertraege` „Verstanden, Termin am Donnerstag".
8. Activity-Stream zeigt Slack-Antwort innerhalb **< 5s** (Bridge-Inbound-Polling oder Webhook).
9. User toggled Comment-Channel auf `native` (Test-Variante) → Slack-Pfad inaktiv, neuer Comment landet in `atom_comments`.
10. User toggled zurueck auf `external` → atom_comments-Eintrag bleibt sichtbar (read-only-Mix-Mode), neue Comments gehen wieder nach Slack.

**Erfolgs-Kriterien:**
- 6 Widgets rendern parallel **< 1s** mit Skeleton.
- Slack-Send via Bridge **< 2s** round-trip.
- Slack-Inbound erscheint im Activity-Stream **< 5s**.
- Comment-Toggle persistiert in `template_widgets.toggles_jsonb` (Single-Source).
- Native-Fallback (`atom_comments`) NICHT aktiv solange `external` gewaehlt (Foundation §14).
- Smart-Summary read-only-Aggregat (§11.3): Comment + Attachment Toggles entfallen fuer die anderen 5 Widgets, nur Activity-Stream hat sie.

**Fail-Modes:**
- Widget rendert ohne Skeleton (Performance-Bug, R-WV-6).
- Slack-Bridge timeout ohne Retry/Toast.
- Comment landet in nativem `atom_comments` UND Slack (Doppel-Write, §14-Verstoss).
- Toggle persistiert nicht ueber Reload.

### 18.4 Trace-Test 4 — KI-Mail mit `alias.expand_to_text`

**Setup:**
- User hat AI-Provider-Key gesetzt (`user_ai_providers` mit Anthropic-Key).
- Workspace hat Cell „Mueller AG" mit Alias `^kunde`, 3 gepinnte Doc-Atomen (Vertrag, AGB, Spezifikation), und 5 Tasks.
- Outlook-Mail-Bridge verknuepft (`user_oauth_tokens` Outlook-Graph mit Mail.Send-Scope).

**Schritte:**
1. User in AI-Chat: *„Schreib an x@mueller-ag.de eine Mail mit den wichtigsten Infos aus ^kunde, fuehr alle Hyperlinks zu Vertrags-Docs unten an."*
2. AI-Pipe ruft `alias.expand_to_text({alias: 'kunde', depth: 2, format: 'markdown'})`.
3. Tool returns:
   - `text` (Markdown): `# Mueller AG\n<Body>\n\n## Verknuepfte Docs\n- [Vertrag](https://...)\n- [AGB](https://...)\n- [Spezifikation](https://...)\n`.
   - `hyperlink`: absolute URL zur Cell.
   - `children`: Array mit 3 Doc-Refs.
4. AI baut Mail-Body in Markdown: Header + Body + Bullet-List Doc-Hyperlinks + Hyperlink zur Cell.
5. AI ruft `mail.compose({to, subject, body_markdown, save_as_draft: true})` via Outlook-Bridge.
6. Mail wird in Outlook-Drafts gespeichert.
7. User oeffnet Outlook → Draft sichtbar mit Aliasen als Hyperlinks gerendert (HTML-Konvertierung).
8. User klickt einen Hyperlink in Outlook → Browser oeffnet Login-Redirect → nach Login redirected zur richtigen Cell `^kunde`.

**Erfolgs-Kriterien:**
- `alias.expand_to_text` dauert **< 500ms** fuer depth=2.
- Permission-Check: nur Atome die der User-Token sehen darf (R-WV-9 Test). Test mit Non-Member: Tool returnt 403 oder leeres Result.
- Hyperlinks resolvable: Click in Outlook → Login-Redirect → richtiger Cell ohne 404.
- Markdown-Format korrekt (Outlook-Renderer rendert Bullets + Hyperlinks).
- Mail bleibt in Drafts (nicht auto-send) — Sicherheitsmassnahme.
- AI-Tool laeuft mit User-JWT, nicht service_role (R-WV-9 Mitigation).

**Fail-Modes:**
- `alias.expand_to_text` liefert mehr Cells als User darf (RLS-Bug, R-WV-9).
- Hyperlink resolved zur falschen Cell (Alias-Index-Drift).
- Markdown wird in Outlook nicht als HTML gerendert (Bridge-Format-Bug).
- AI-Tool nutzt service_role (Permission-Eskalation, R-WV-9-Verstoss).

### 18.5 Heptad-Mapping-Coverage-Matrix (Probe)

**Pflicht-Output vor Welle WV.A:** Excel/CSV-Matrix `docs/concepts/heptad-coverage-matrix.csv` mit:

- **Zeilen:** 13 Tabellen aus §15.1 (A/B/C-Sub-Tabellen).
- **Spalten:** 8 Slots (Schema, Types, Mutations, Cache, Realtime, Export, MCP, Channel-Bridge).
- **Zellen:** Status `done` / `n/a` / `pending` mit Verweis auf konkretes File-Path bei `done`.

**Erfolgs-Kriterium:** 13 × 8 = 104 Felder, davon mind. ein Verweis auf File-Path / Migration-Nummer / `n/a`-Begruendung pro Feld. Keine `pending`-Felder beim Welle-A-Start.

**Test-Pfad:** Pro Tabelle pruefen ob die `architektur.md` §3.3 Pre-Commit-Heptad-Selbstcheck-Liste (alle 7 Pflicht-Slots + Slot 8 Channel-Bridge) erfuellt ist.

### 18.6 Foundation-Direktive (§14) Probe

**Pflicht-Output vor Welle WV.D:** Audit-Liste in `docs/concepts/foundation-audit.csv` mit:

- **Zeilen:** 6 Domains (Comments, Files, Doc, Calendar, Sharing, Notifications).
- **Spalten:**
  - Default-Toggle = `extern` ✓/✗
  - Mind. 1 V1-Provider implementiert ✓/✗ (Provider-Name)
  - Native-Pfad als „Fallback" benannt im UI + Code-Comment ✓/✗
  - Bridge-Konzept im Plan-File vor Native-Pfad ✓/✗

**Erfolgs-Kriterium:** alle 6 Domains × 4 Spalten = 24 Felder, alle ✓. Keine Domain mit Native-First-Default.

**Test-Pfad:** Grep nach `default.*native` in `template_widgets.toggles_jsonb`-Defaults — 0 Treffer erwartet.

### 18.7 Backlog-Konsistenz (Probe)

Alle heutigen Features (Matrix, Board, Info, Checkliste, Doc, Smart Summary, Kalender) haben Migrations-Pfad ins Vorlagen-Modell:

| Feature | Migration-Pfad | Welle |
|---|---|---|
| Matrix | unveraendert (struktureller Container, kein Vorlagen-Atom) | n/a |
| Board (Kanban) | Plattform-Default-Vorlage „Kanban", Hotkey 2 | A (Defaults), C (UI) |
| Info | Plattform-Default-Vorlage „Info", Hotkey 3, info_field-Atom | A + B + C |
| Checkliste | Plattform-Default-Vorlage „Checkliste", Hotkey 4 | A (Defaults), C (UI) |
| Doc | Plattform-Default-Vorlage „Doku", Hotkey `d` (globaler Hotkey, nicht in feature_templates.hotkey_slot) | A (Defaults) |
| Smart Summary | Plattform-Default-Vorlage „Smart Summary" mit `render_position='auto_under_features'` | A (Defaults), F (Activity) |
| Kalender | Sidebar-Mode bleibt + atom_manifestations(kind='calendar') unveraendert + Calendar-Outbound-Sync neu | E |

**Erfolgs-Kriterium:** Backlog `BACKLOG-2026-04-30.md` enthaelt keine Feature-Eintraege ausserhalb Welle A-F + WV.WV/X/Y/Z, die noch ein eigenes Vorlagen-Pendant brauchen.

### 18.8 Risiken-Akzeptanz

User signiert R-WV-1 bis R-WV-15 mit Mitigation-Plan ab — siehe §17 Tabelle (alle 15 Risiken bestaetigt 2026-05-08).

Wenn Spec abgenommen → Implementierungs-Plan-File `docs/plan-widget-vorlagen-impl.md` als eigene Welle.

**Sektion 18 KOMPLETT abgeschlossen 2026-05-08.**

---

## Anhang — Querverweise

- Foundation-Direktive: `docs/claude/architektur.md` §14
- Atom-Zwiebel-Modell: `docs/claude/architektur.md` §1
- Schema-Heptad-Pflicht: `docs/claude/architektur.md` §3
- Mutation-Pfad: `docs/claude/architektur.md` §4
- Realtime + RLS: `docs/claude/architektur.md` §5
- MCP-Tool-Trio: `docs/claude/architektur.md` §6
- Animation-Pflicht: `docs/claude/animations.md`
- Style-Pflicht: `docs/claude/style.md`
- Code-Quality: `docs/claude/code-quality.md`
- BACKLOG: `docs/BACKLOG-2026-04-30.md` (Welle 1.5-Updates s. dort)
- Memory: `feedback_native_as_fallback.md`, `project_task_layer_phase1.md`, `project_welle_d_doku_state.md`, `project_object_layer_phase3.md`
