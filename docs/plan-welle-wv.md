# Plan — Welle WV.A (Vorlagen-Foundation)

Konzept-Quelle: `docs/concepts/widget-vorlagen-foundation.md` §6, §15, §16.2.
Pre-WV.A-Pflicht: WV.WV (commit 7f965ec) + WV.Y (commit 8f25ee2) — beide erledigt.

Aufwand: ~15d. Atomarer Schritt in 7 Sub-Sprints, je mit Heptad-Pflege.

---

## 1. Sprint-Reihenfolge (top-down — jeder Sub-Sprint baut auf dem vorigen)

| # | Sub-Sprint | Output | Dauer | Abhaengig von |
|---|---|---|---|---|
| **A.1** | Migration `feature_templates` + `template_sections` + `template_widgets` | DDL + RLS + Realtime + Indexes | 2d | WV.WV |
| **A.2** | Migration `cell_template_instances` + `cell_widget_overrides` | DDL + RLS + Realtime + Cascade-Trigger | 1d | A.1 |
| **A.3** | Migration `workspace_hotkey_slots` + `user_hotkey_slots` | DDL + RLS + Realtime (workspace-Variante) | 1d | A.1 |
| **A.4** | Migration `saved_filters` | DDL + RLS + Realtime | 0.5d | WV.Y |
| **A.5** | Plattform-Default-Vorlagen (Seed-Migration) | INSERTs fuer Kanban/Info/Checkliste/Smart-Summary/Doc | 0.5d | A.1 + A.2 |
| **A.6** | UI-Foundation (`lib/widget-foundation.ts` + Widget-Renderer) | Section/Column-Layout-Engine + Widget-Renderer-Dispatcher | 4d | A.1 |
| **A.7** | FilterBuilderModal-Komponente | UI fuer `saved_filters`, konsumiert `lib/atom-filter-attrs.ts` | 2d | A.4 + WV.Y |
| **A.8** | Schema-Heptad-Pflege | Types/Mutations/Cache/Realtime/Export-Import/MCP fuer alle 7 Tabellen | 4d | A.1-A.7 |

**Buffer:** 1d fuer Smoke-Tests + Migration-Re-Runs auf Staging.

---

## 2. Tabellen-Spec pro Migration

### 2.1 A.1 — `feature_templates` + `template_sections` + `template_widgets`

**Skizze:** Konzept §6.2 (komplett uebernehmen).

**Indexes:**
- `feature_templates(workspace_id, hotkey_slot)` — UNIQUE wenn `hotkey_slot IS NOT NULL` (partial)
- `feature_templates(workspace_id, visibility)` — fuer Listen-Filter
- `template_sections(template_id, position)` — Render-Sortierung
- `template_widgets(section_id, position)` — Render-Sortierung

**RLS:** Konzept §15.4. Plattform-Vorlagen (`workspace_id IS NULL`): SELECT fuer alle, WRITE nur platform_admin. Workspace-Vorlagen: SELECT/WRITE per `is_workspace_member` + `can_write_workspace`. User-Vorlagen: SELECT/WRITE nur Owner.

**Realtime:** alle 3 Tabellen `REPLICA IDENTITY FULL` + supabase_realtime publication.

**Cascade-Trigger:**
- `feature_templates` DELETE → `template_sections` DELETE → `template_widgets` DELETE (FK CASCADE)
- `feature_templates` DELETE → `cell_template_instances` DELETE → `cell_widget_overrides` DELETE (in A.2-Migration nachgezogen)

**Risiko R-A1.1:** `root_widget_id` zirkulaer (FK auf `template_widgets(id)`). Mitigation: `ON DELETE SET NULL` + `DEFERRABLE INITIALLY DEFERRED` damit Insert-Reihenfolge nicht problematisch wird.

### 2.2 A.2 — `cell_template_instances` + `cell_widget_overrides`

**Indexes:**
- `cell_template_instances(cell_id, template_id)` — UNIQUE (eine Vorlage einmal pro Cell)
- `cell_template_instances(template_id)` — Usage-Counter fuer §16.4 Welle C
- `cell_widget_overrides(instance_id, widget_id)` — UNIQUE

**RLS:** vererbt aus Cell + Template — `cell_id` muss in Workspace des Users sein.

**Realtime:** beide Tabellen REPLICA IDENTITY FULL.

**Cascade-Trigger:**
- `cells` DELETE → `cell_template_instances` DELETE (FK)
- `cell_template_instances` DELETE → `cell_widget_overrides` DELETE (FK)
- `template_widgets` DELETE → `cell_widget_overrides` DELETE (FK + RESTRICT auf instance, weil sparse override stale werden koennte)

### 2.3 A.3 — `workspace_hotkey_slots` + `user_hotkey_slots`

**Skizze:** Konzept §6.4 (Zeilen 497-525).

**Indexes:**
- `workspace_hotkey_slots(workspace_id, slot)` — UNIQUE (PK ueber beides)
- `user_hotkey_slots(user_id, slot)` — UNIQUE

**RLS:** `workspace_hotkey_slots` SELECT alle Member, WRITE nur Workspace-Owner. `user_hotkey_slots` SELECT/WRITE nur Owner (`user_id=auth.uid()`).

**Realtime:** `workspace_hotkey_slots` Pflicht (Cross-User-Sicht nach Owner-Aenderung). `user_hotkey_slots` optional V1 — wenn ohne, im Migration-Header begruenden (`feedback_realtime_konsistenz.md`).

**Default-Slots (Plattform-Konvention, Konzept §6.3):**
- Slot 1: Matrix-Vorlage
- Slot 2: Info-Vorlage
- Slot 3: Kanban-Vorlage
- Slot 4: Checkliste-Vorlage
- Slot 5-9: leer

### 2.4 A.4 — `saved_filters`

**DDL:**
```sql
CREATE TABLE saved_filters (
  id              uuid PK DEFAULT gen_random_uuid(),
  workspace_id    uuid FK workspaces ON DELETE CASCADE,
  owner_user_id   uuid NULL FK auth.users ON DELETE CASCADE,  -- NULL = Workspace-shared
  name            text NOT NULL,
  atom_kind       text NOT NULL CHECK (atom_kind IN ('task','link','doc','checklist','imported_event')),
  body            jsonb NOT NULL,  -- Format: SavedFilterBody aus lib/atom-filter-attrs.ts
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  CONSTRAINT saved_filter_body_v1 CHECK ((body ->> 'v')::int = 1)
);
CREATE INDEX saved_filters_ws ON saved_filters(workspace_id);
CREATE INDEX saved_filters_atom_kind ON saved_filters(workspace_id, atom_kind);
```

**RLS:** Workspace-shared (`owner_user_id IS NULL`): SELECT alle Member, WRITE per `can_write_workspace`. User-privat: SELECT/WRITE nur Owner.

**Realtime:** REPLICA IDENTITY FULL. Cross-User-Sicht wichtig fuer geteilte Filter.

### 2.5 A.5 — Plattform-Default-Vorlagen (Seed)

5 Vorlagen, alle mit `workspace_id=NULL` + `visibility='platform'` + `created_by=NULL`:

| Vorlage | Hotkey | Render-Position | Sections | Widgets (V1) | Root-Widget |
|---|---|---|---|---|---|
| **Kanban** | 3 | hotkey_slot | 1 (default) | 1× kanban (size 12×) | kanban |
| **Info** | 2 | hotkey_slot | 1 (default) | 1× info (size 12×) | info |
| **Checkliste** | 4 | hotkey_slot | 1 (default) | 1× checklist (size 12×) | checklist |
| **Smart Summary** | NULL | auto_under_features | 1 | 1× smart_summary (size 12×) | NULL |
| **Doc** | NULL (globaler `d`-Hotkey) | hotkey_slot | 1 | 1× doc (size 12×) | doc |

**Smart-Summary-Spec:** Konzept §11.6 — kein Hotkey-Slot, kein Wizard-Pfad, render unter Cell-Features.

**Doc-Spec:** kein Hotkey-Slot in `feature_templates` (Doc lebt auf globalem `d`-Hotkey, nicht in Slot-Belegung).

**Migration-Idempotenz:** `INSERT … ON CONFLICT(id) DO NOTHING`. Plattform-IDs sind hardcoded UUIDs (im SQL-File dokumentiert, damit Re-Apply nicht duplikate erzeugt).

### 2.6 A.6 — UI-Foundation

**`lib/widget-foundation.ts`:**
- `WidgetType` Enum (kanban/checklist/info/doc/link/calendar/smart_summary) — re-export aus `lib/widget-picker.ts` damit kein Doublet
- `WidgetInstance` Type (template_widget + override-merged)
- `mergeWidgetWithOverride(widget, override?)` — sparse overrides auf Base-Widget anwenden
- `loadCellTemplateInstances(cellId)` — JOIN Resolver: cell → instances → templates → sections → widgets → overrides
- `nextWidgetPosition(siblings)` — Position-Helper analog `nextManifestationPosition`

**Renderer-Komponenten:**
- `components/CellTemplateRenderer.tsx` — Top-Level pro Cell, rendert alle Section-Containers
- `components/TemplateSectionRenderer.tsx` — Section-Header + Collapse + Edit-Mode-Toggle
- `components/TemplateWidgetRenderer.tsx` — dispatch pro WidgetType auf existing Komponenten:
  - kanban → BoardView
  - checklist → ChecklistPanel
  - info → CellInfoPage / neue InfoWidget
  - doc → DocsPopup-Inline-Variante
  - calendar → SidebarCalendarMini-Inline-Variante
  - smart_summary → neue SmartSummaryWidget (Welle A V1: leerer Stub mit „in Vorbereitung")

**Risiko R-A6.1:** Bestehende Komponenten (BoardView/ChecklistPanel) nehmen aktuell direkt Cell-Props. Refactor noetig damit sie ueber Widget-Instance-Layer gehen ohne dass die heutigen Cell-Pfade brechen. Mitigation: V1-Adapter-Funktion `widgetInstanceToCellProps(wi)` haelt die Brueche begrenzt.

**Layout-Engine:** Section/Column-Grid (12-Col-Default) mit `size_cols`/`size_rows`. CSS-Grid-Foundation in styles.css `.template-grid` neu (Welle-A-Block, analog `.kb-cards`).

### 2.7 A.7 — FilterBuilderModal

Pattern: analog `AdapterDialog` (WV.WV.7) — `<dialog class="overlay-modal">` + Field-Liste + Submit-Adapter.

**Inputs:**
- `atomKind: AtomKind` — bestimmt verfuegbare Felder via `attrsFor(atomKind)`
- `initial?: SavedFilterBody` — Edit-Mode
- `onSubmit(filter: SavedFilterBody)` — speichert via `saveSavedFilter` (lib/saved-filters.ts neu)
- `onClose()`

**UI:**
- Dropdown atom_kind (locked wenn Edit-Mode)
- Liste Conditions: pro Row Field-Picker + Operator-Picker + Value-Input
- AND/OR-Toggle fuer Logic
- Save-Button (Name-Input + Workspace-shared/Privat-Toggle)

**Konsumenten (Welle B+C):**
- BoardView FilterBox (Drop-In-Replace fuer heutigen Free-Text-Filter)
- ChecklistPanel Filter (neu)
- Sidebar/Tag-Trees Filter (neu)
- Command-Palette Filter-Suche (neu)

### 2.8 A.8 — Schema-Heptad-Pflege

Pro Tabelle (7 Tabellen × 7 Heptad-Slots = 49 Aufgaben) gemaess `architektur.md` §3:

| Slot | feature_templates | template_sections | template_widgets | cell_template_instances | cell_widget_overrides | hotkey_slots (×2) | saved_filters |
|---|---|---|---|---|---|---|---|
| 1. Schema | A.1-A.4 | A.1 | A.1 | A.2 | A.2 | A.3 | A.4 |
| 2. Types (`lib/types.ts`) | NEU | NEU | NEU | NEU | NEU | NEU (×2) | NEU |
| 3. Mutations | `lib/templates.ts` neu | (eingebettet in templates.ts) | (eingebettet) | `lib/cell-templates.ts` neu | (eingebettet) | `lib/hotkey-slots.ts` neu | `lib/saved-filters.ts` neu |
| 4. Cache | TABLES + DB_VERSION+1 | TABLES + DB_VERSION+1 | TABLES + DB_VERSION+1 | TABLES + DB_VERSION+1 | TABLES + DB_VERSION+1 | TABLES + DB_VERSION+1 (×2) | TABLES + DB_VERSION+1 |
| 5. Realtime | direct table | direct table | direct table | direct table | direct table | workspace_hotkey_slots: direct; user_hotkey_slots: cross-tab | direct table |
| 6. Export/Import | `lib/export.ts` + `lib/subtree-import.ts` workspace+cell-subtree-Pfade | (mit-exportiert) | (mit-exportiert) | (cell-subtree) | (cell-subtree) | (workspace-only) | (workspace-only) |
| 7. MCP | `bridge/src/tools/templates.*` neu | (eingebettet) | (eingebettet) | `bridge/src/tools/cell-templates.*` neu | (eingebettet) | `bridge/src/tools/hotkey-slots.*` neu | `bridge/src/tools/saved-filters.*` neu |
| 8. Channel-Bridge | n/a (Strukturdaten) | n/a | n/a | n/a | n/a | n/a | n/a |

Tool-Trio pro MCP-Tool: Bridge-Schema + Client-Handler + Vitest. Realtime-Garantie pro Mutation (Konzept §3 Heptad-Slot 5).

DB_VERSION-Bumps: 7 IDB-Stores neu → 7 Bumps (oder einer mit 7 neuen Tabellen). Empfehlung: 1 Bump mit allen 7, Migration-Header dokumentiert.

---

## 3. Default-Vorlagen Detail (Seed-Migration)

```sql
-- Plattform-IDs: hardcoded fuer Idempotenz.
INSERT INTO feature_templates (id, workspace_id, owner_user_id, name, symbol, hotkey_slot, visibility, layout_version, render_position) VALUES
  ('00000000-0000-0000-0000-000000000a01', NULL, NULL, 'Kanban',        'view-columns',    3, 'platform', 1, 'hotkey_slot'),
  ('00000000-0000-0000-0000-000000000a02', NULL, NULL, 'Info',          'information-circle', 2, 'platform', 1, 'hotkey_slot'),
  ('00000000-0000-0000-0000-000000000a03', NULL, NULL, 'Checkliste',    'list-bullet',     4, 'platform', 1, 'hotkey_slot'),
  ('00000000-0000-0000-0000-000000000a04', NULL, NULL, 'Smart Summary', 'sparkles',        NULL, 'platform', 1, 'auto_under_features'),
  ('00000000-0000-0000-0000-000000000a05', NULL, NULL, 'Doku',          'document-text',   NULL, 'platform', 1, 'hotkey_slot')
ON CONFLICT (id) DO NOTHING;

-- 1 Section pro Vorlage (Default-Section, kein Title).
INSERT INTO template_sections (id, template_id, position, title, default_collapsed, visibility) VALUES
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000a01', 1, NULL, false, 'always'),
  -- … (4 weitere)
ON CONFLICT (id) DO NOTHING;

-- 1 Widget pro Vorlage (root_widget_id Update danach).
INSERT INTO template_widgets (id, section_id, "column", position, type, size_cols, size_rows, data, toggles, config) VALUES
  ('00000000-0000-0000-0000-000000000c01', '00000000-0000-0000-0000-000000000b01', 1, 1, 'kanban',        12, 12, '{}', '{}', '{}'),
  -- … (4 weitere)
ON CONFLICT (id) DO NOTHING;

-- root_widget_id setzen (zirkulaer FK, daher zwei-stage).
UPDATE feature_templates SET root_widget_id = '00000000-0000-0000-0000-000000000c01' WHERE id = '00000000-0000-0000-0000-000000000a01';
-- … (4 weitere)
```

---

## 4. Risiken + Mitigation

| ID | Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|---|---|---|---|---|
| R-A.1 | `root_widget_id` zirkulaer | hoch | mittel | DEFERRABLE FK + Two-Stage-Insert in Seed |
| R-A.6 | Bestehende Komponenten (BoardView/ChecklistPanel) brechen unter Widget-Layer | mittel | hoch | Adapter-Funktion `widgetInstanceToCellProps` haelt Brueche zentriert |
| R-A.7 | FilterBuilderModal zu rich → Welle-A-Scope-Creep | mittel | mittel | V1: nur AND-Logic, flache Conditions, keine Gruppen. Welle B/C erweitert |
| R-A.8 | DB_VERSION-Bump triggert IDB-Re-Sync auf allen Clients | hoch | niedrig | dokumentiert, leise im Background — keine UX-Disruption |
| R-A.9 | Plattform-Default-Vorlagen-IDs kollidieren bei Re-Apply | niedrig | mittel | Hardcoded UUIDs + ON CONFLICT(id) DO NOTHING |
| R-A.10 | Realtime-Subscribe-Storm: 7 neue Tabellen × N Workspaces | mittel | niedrig | Konsolidierte Subscribe-Slot-Funktion (analog Welle D atom_tags) |

---

## 5. Test-Strategie

**Pro Sub-Sprint:**
- Migration: `psql` Smoke (CREATE/DROP/ROLLBACK) auf Dev-DB, dann Staging via SSH (Auftrag-bei-User abholen).
- Types: `tsc --noEmit` clean.
- Mutations: kein Unit-Test V1 (Pattern aus Welle D — End-to-End-Smoke reicht).
- Realtime: manuell Cross-Tab/Cross-User-Edit pruefen.
- Export/Import: Workspace-Roundtrip mit einer Vorlage + einer Cell-Instanz.
- MCP: Vitest pro Tool (Tool-Trio-Pflicht).

**Welle-A-Akzeptanzkriterien:**
1. Plattform-Vorlage „Kanban" ist via Hotkey 3 in einer leeren Cell anlegbar.
2. Cell mit Kanban-Vorlage rendert das BoardView-Widget identisch zur heutigen Board-Feature-Anlage.
3. FilterBuilderModal speichert einen Filter, BoardView konsumiert ihn (mind. ein Konsument live).
4. Realtime-Cross-User-Update: User A aendert Vorlagen-Name → User B sieht es < 2s.
5. Workspace-Export → Re-Import roundtrip-klar mit allen 7 Tabellen.

---

## 6. Definition-of-Done — Welle A

- [ ] 4 Migrations (A.1-A.4) auf Staging applied + idempotent
- [ ] Seed (A.5) applied + 5 Default-Vorlagen sichtbar
- [ ] UI-Foundation (A.6) deployed + mind. eine Cell rendert via Vorlage
- [ ] FilterBuilderModal (A.7) live + mind. ein Konsument
- [ ] Heptad-Pflege (A.8) komplett — alle 7 Slots × 7 Tabellen abgehakt
- [ ] tsc + biome clean ueber gesamte src/
- [ ] vite build clean
- [ ] Manual Smoke (Akzeptanzkriterien 1-5)
- [ ] Memory-Update: `project_widget_vorlagen_konzept.md` setzt Welle A auf live
- [ ] Konzept-File-Update §16.10 Aufwand-Tabelle: Welle A ✅
