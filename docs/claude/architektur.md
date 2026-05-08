# Architektur-Manifest

**Verbindlich. Globale Single-Source.** Jede strukturelle Entscheidung folgt diesem Manifest. Wer eine neue Tabelle, eine neue Mutation, ein neues MCP-Tool, eine neue Sicht oder einen neuen Realtime-Kanal baut, faengt hier an.

**Kern-Prinzip:** Daten leben **einmal**. Sichten / Manifestations / Wrapper kapseln sie, mirrorn sie nicht. Eine Information, ein Schreib-Pfad, ein Channel.

**Wann lesen:** vor jedem Schema-Migrations-Entwurf, vor jeder neuen Mutation, vor jedem MCP-Tool, vor jeder Realtime-Subscription, vor jeder Multi-User-/RLS-Aenderung.

---

## 1. Atom-Zwiebel-Prinzip (ECS)

**Foundation der gesamten Daten-Architektur.** Alle inhaltlichen Objekte folgen diesem Schichten-Modell, basierend auf Entity-Component-System (ECS) bzw. Aggregate-Root mit Layered Components.

```
                 ┌──────────────────────────────────┐
                 │   Layer 4 — Additive Anhaenge    │  ← Comments, Files, Docs-Notes
                 │   (1:N an atom_id)               │     (T.2 +)
                 ├──────────────────────────────────┤
                 │   Layer 3 — Regeln / Trigger     │  ← State-Machines, If-Then-Rules
                 │   (separates rule-engine-modul)  │     (T.4 — heikel, zuletzt)
                 ├──────────────────────────────────┤
                 │   Layer 2 — Abhaengigkeiten      │  ← depends_on / blocks (DAG)
                 │   (M:N atom_dependencies)        │     (T.3)
                 ├──────────────────────────────────┤
                 │   Layer 2 — Pins + Tags          │  ← Welle D
                 │   atom_pins (atom→parent)        │     Pin: Atom an Cell/Atom/Node
                 │   workspace_tags + atom_tags     │     Tag-Owner = ausschliesslich Atom
                 │   parent_kind ∈ {cell,atom,      │     (Manifestation erbt vom Atom)
                 │     node,manifestation}          │     (Migration 063+064)
                 │   tag_kind ∈ {freetext,atom_ref, │
                 │     object_ref,alias_ref}        │
                 ├──────────────────────────────────┤
                 │   Layer 1 — Manifestations       │  ← wo erscheint das Atom?
                 │   (1:N atom_manifestations)      │     Kanban / Checklist / Calendar /
                 │   atom_type ∈ {task,link,        │     Standalone / (spaeter Flowchart)
                 │     checklist,doc,imported_event}│     (T.1 + T.AC + Welle I)
                 │   kind ∈ {kanban,checklist,      │
                 │     calendar,standalone}         │
                 ├══════════════════════════════════┤
                 │   Layer 0 — KERN (Atom)          │  ← Aggregate Root
                 │   tasks / links / checklists /   │     (T.1)
                 │   docs                           │
                 └──────────────────────────────────┘
```

### 1.1 Layer 0 — Atom (Aggregate Root)

Jedes inhaltliche Objekt hat **eine** Aggregate-Tabelle:
- `tasks` — id, label, note, status, deadline, who, recur, done_occurrences, attrs
- `links` — id, label, url, type, alias
- `checklists` — id, label, recur, close_mode, history, alias, label_template
- `docs` — id, title, content, title_template (Welle D: HTML-Body, kein attached_cell_id mehr — Pin lebt in atom_pins)

**Regel:** ein Atom-Typ = eine Tabelle. Keine parallelen Tables fuer dieselbe Domain. Keine Mirror-Spalten. Keine "alternative" Repraesentation.

**Welle I (Migration 059)** ergaenzt einen 5. atom_type:
- `imported_event` — Source-Tabelle `external_events` (Read-Only fuer User; befuellt vom `calendar-inbound-sync`-Service aus ICS-URLs / Google / Microsoft)

### 1.2 Layer 1 — Manifestations (polymorph)

Eine **einzige** polymorphe Tabelle `atom_manifestations` haelt alle Sichten:

```sql
atom_manifestations (
  id           uuid PK
  atom_type    enum('task','link','doc','checklist','imported_event')   -- Diskriminator
  atom_id      uuid                                     -- Soft-Ref auf Layer-0-Tabelle
  workspace_id uuid FK workspaces
  kind         enum('kanban','checklist','calendar','standalone')
  container_id uuid                                     -- kb_col / checklist / null
  position     numeric
  level        smallint                                 -- nur bei kind='checklist' (0-2)
  display_meta jsonb                                    -- kanban-color, calendar time/range/recur, source_provider/color (imported_event), ...
  created_at   timestamptz
)
```

**Welle I (Migration 059) erweitert** das `atom_type`-Enum um `imported_event` — Source-Tabelle ist `external_events` (gespeist vom `calendar-inbound-sync`-Service aus ICS-URLs / Google / Microsoft). Mirror-Trigger `_imported_event_mirror_to_atom_manif` synct INSERT/UPDATE auf `external_events` in `atom_manifestations(kind='calendar')` mit Provider-Snapshot in `display_meta` (`source_provider`, `source_color`, `source_calendar_id` zusaetzlich zu Standard-Calendar-Feldern).

**Regel:** kein Mirror, keine Sync-Trigger zwischen parallelen Tables. Polymorph mit `atom_type`-Diskriminator. Layer-0-Tabellen haben **keinen** FK zu atom_manifestations (wuerde Polymorphie brechen). Stattdessen: BEFORE-DELETE-Trigger pro Layer-0-Tabelle, der atom_manifestations purged (Pseudo-CASCADE).

**USP-Konsequenz:** *Drag-to-Create-Manifestation* — eine Task wird Karte UND Termin UND Checklisten-Punkt. Ein Link wird im Kalender als Wiedervorlage. Eine Checkliste wird im Kanban als Card-Ref. Cross-View ist additiv: dieselbe atom_id, mehrere Manifestations, eine Wahrheit.

### 1.3 Layer 2 — Dependencies (Phase T.3)

`atom_dependencies (from_atom_type, from_atom_id, to_atom_type, to_atom_id, kind)` als M:N-DAG. Cycle-Detection via PG-Recursive-CTE. Visual via dagre-d3 oder SVG-Eigenbau.

### 1.4 Layer 3 — Regeln (Phase T.4)

`atom_rules (atom_type, atom_id, when_jsonb, then_jsonb)`. Trigger via Postgres-Triggers oder Edge-Function. Heikelster Block — eigene Welle, evtl. erst V2.

### 1.5 Layer 4 — Additive Anhaenge (Phase T.2)

`atom_comments`, `atom_attachments` (Supabase-Storage), `atom_doc_notes`. Alle 1:N an `(atom_type, atom_id)`. Realtime fuer Comments.

**Foundation-Direktive (§14):** native `atom_comments` + `atom_attachments` sind **Fallback, nicht Default.** Primaer-Pfad ist die Channel-Bridge zu User-eigenen Drittsystemen (Mail-Thread, Messenger, Slack/Teams, Cloud-Drive). Native-Tabellen werden nur fuer Single-User-/Offline-Use-Cases oder auf expliziten User-Wunsch gebaut. Vor dem Native-Schema muss das Bridge-Konzept stehen — siehe §14.

### 1.5b Layer 2 — Pins + Tags (Welle D)

**`atom_pins`** ist die generische "Atom A ist an Parent P gepinnt"-Relation. Loest `docs.attached_cell_id` ab und macht das Pin-Konzept symmetrisch ueber alle 5 Atom-Typen + 4 Parent-Kinds:

```
atom_pins (
  id           uuid pk,
  atom_type    enum('task','link','doc','checklist','imported_event'),
  atom_id      uuid,                                      -- polymorph, kein FK
  workspace_id uuid fk → workspaces ON DELETE CASCADE,
  parent_kind  enum('cell','atom','node','manifestation'),
  parent_id    uuid,                                      -- polymorph, kein FK
  position     numeric,
  created_at   timestamptz,
  UNIQUE (atom_type, atom_id, parent_kind, parent_id)     -- Multi-Pin erlaubt, Doppel-Pin verboten
)
```

`parent_kind='manifestation'` ist V2-deferred — V1 nur cell/atom/node. Cascade ueber Source-Trigger (5 Atom-Typen + 2 Parent-Kinds = 7 Trigger), Pattern aus Migration 044 `_atom_manif_purge_for_*`.

**Tag-System** (`workspace_tags` + `atom_tags`) ist orthogonal zu Pins. **Tag-Owner = ausschliesslich Atom** (Manifestation erbt vom Atom — keine eigenen Tags pro Linse). Vier Tag-Kinds:

| Kind | value | display_label | Use |
|---|---|---|---|
| `freetext` | canonical-string | NULL | `#design` |
| `atom_ref` | target atom_id::text | title-Snapshot | `@TaskTitle` (Click → Atom) |
| `object_ref` | `${kind}:${id}` | label-Snapshot | `⤴Cell ^kunde` (Click → Cell/Node) |
| `alias_ref` | canonical-alias-string | `^kuerzel`-Snapshot | Live-Resolve gegen alias-index |

`workspace_tags(id, ws, kind, value, display_label, usage_count)` ist die Registry. UNIQUE(ws, kind, value) — pro Wert eine Registry-Zeile. `atom_tags(id, atom_type, atom_id, ws, tag_id)` ist die Junction. Trigger `_workspace_tags_bump_usage` pflegt usage_count automatisch.

**Konsequenzen fuer Code:**
- `lib/atom-pins.ts`: Read/Write fuer atom_pins (offline-cache + Realtime). Helper `setDocSingleCellPin` fuer Compat-UX (DocsPopup-Attach-Input).
- `lib/atom-tags.ts`: vier RPC-Wrapper (add_atom_tag_freetext/alias/atomref/objectref), `fetchAtomTagsForAtom` mit PostgREST-Embed (atom_tags → workspace_tags FK ist ECHT, Embed safe).
- `lib/tag-index.ts`: Workspace-scoped `workspace_tags`-Cache fuer Autocomplete.
- TagInput + TagPills: wiederverwendbare Komponenten in `components/`.
- `pin_doc_with_create`-RPC bundled Doc-Insert + atom_pins-Insert atomar.

### 1.6 Konsequenzen fuer Code

- **Mutations-Layer:** ein Schreib-Pfad pro Layer. `lib/tasks.ts` fuer Task-spezifische Operationen, `lib/atom-manifestations.ts` fuer Layer-1-Operationen non-task. Beide gehen durch `lib/safe-mutation.ts`.
- **Read-Pfad:** Polymorpher Read mit `atom_type`-Filter. Kein PostgREST-Embed ueber `atom_id` (kein FK). Stattdessen zwei parallele Queries + client-seitiger Map-Join.
- **Realtime:** ein Channel-Listener fuer `atom_manifestations` mit Routing nach `atom_type` + `kind` in domaenen-spezifische Bumps.
- **Cache (IDB):** ein Store `atom_manifestations`. Domain-Filter laeuft client-seitig.
- **MCP-Tools:** Schema-Quad pro Layer (siehe §3).

---

## 2. Single Source of Truth (Pflicht)

**Jede Information lebt an genau einer Stelle.** Doublet = Review-Stop, gleichwertig wie `alert()`-Aufruf oder `Date.now()`-Position-Default.

### 2.1 Schema-Ebene

- Eine Tabelle pro Domain. Keine parallelen Tables mit Sync-Trigger als Glue.
- Polymorph mit Diskriminator-Spalte (`atom_type`, `kind`, etc.) statt zwei parallele Tabellen.
- Keine "Cache"-Spalten, die aus anderen Spalten ableitbar sind. Computed-Columns als `GENERATED` markieren.
- JSONB-Felder fuer flexible Sub-Strukturen (`attrs`, `display_meta`, `data`) — aber **eine** klare Konvention pro Feld, dokumentiert im DB-Header-Kommentar.

### 2.2 TS-Type-Ebene

- `lib/types.ts` ist Single-Source fuer alle DB-Row-Types. Jede Komponente importiert von dort.
- Niemals Type-Duplikate mit kleinen Abweichungen ("MeineLokaleTask" vs `TaskRow`). Erweitern mit Generics oder Utility-Types (`Pick`, `Omit`, `Partial`).
- Keine inline `as { id: string; ... }`-Casts. Wenn der Server einen anderen Shape liefert, eigenen Type definieren in `lib/types.ts`.

### 2.3 Helper-Ebene

- Ein Helper pro Aufgabe, an einer Stelle. `lib/dates.ts` (Datum-Format), `lib/recur.ts` (Recurring-Auflosung), `lib/calendar.ts` (Calendar-Event-Build), `lib/animations.ts` (Animation-Helper), `lib/safe-mutation.ts` (Mutation-Wrapping).
- Vor Neu-Schreiben: `grep -rn "^export function\|^export const" packages/client-web/src/lib/` ob es etwas Aehnliches gibt.

### 2.4 Token-Ebene

- Single-Source `:root` (`packages/client-standalone/matrix.html` inline; `packages/client-web/src/styles.css`).
- Niemals Hex/px/ms-Literals in Komponenten.

---

## 3. Schema-Quad-Regel (de facto: Schema-Heptad)

**Jede strukturelle Aenderung pflegt sieben Artefakte gleichzeitig.** Der Name "Quad" ist historisch — die Liste ist heute laenger weil Realtime/Cache/Types eigenstaendige Risiko-Stellen sind, an denen man Tabellen vergessen kann.

Kein Sub-Sprint gilt als done, wenn nicht alle sieben stehen. **Das ist die haeufigste Lessons-Learned-Quelle:** in Welle D wurden initial 3 von 7 vergessen (MCP-Tools, Realtime-Subscribe, Export/Import-fuer-Tags) und mussten als Tool-Abhaengigkeiten-Sprint nachgezogen werden — siehe Welle-D-Memory.

| # | Artefakt | Wo | Was |
|---|---|---|---|
| 1 | **Schema** | `infra/supabase/migrations/NNN_*.sql` | DDL: `CREATE TABLE`, RLS-Policies, Indexes, Trigger (Cascade!), `ALTER PUBLICATION supabase_realtime ADD TABLE`, Comments |
| 2 | **Types** | `packages/client-web/src/lib/types.ts` | TS-Type pro Row + Enums fuer kind-Spalten + Discriminated Unions wo nötig |
| 3 | **Mutations** | `packages/client-web/src/lib/<domain>.ts` | CRUD durch `safe-mutation`-Wrapper, IDB-Cache-Fallback fuer Reads |
| 4 | **Offline-Cache** | `packages/client-web/src/lib/offline-cache.ts` | TABLES-Eintrag + DB_VERSION-Bump + onUpgradeNeeded-Migration |
| 5 | **Realtime-Subscribe** | `packages/client-web/src/lib/realtime.ts` + `routes/Workspace.tsx` | RealtimeTable-Type erweitert, DIRECT_TABLES-Liste, refetch-Hook in subscribeWorkspace-Bumps |
| 6 | **Export/Import** | `packages/client-web/src/lib/export.ts` + `subtree-import.ts` | WorkspaceExport-Field + Workspace-Export + Subtree-Filter (Matrix + Cell + Feature-Variants) + idempotenter Import-Pfad mit FK-Remap |
| 7 | **MCP-Tools** | `packages/bridge/src/tools/<domain>.ts` + `tools/index.ts` | Add/Update/Delete/Move/List-Tools, Zod-Schema, Registrierung in `registerAllTools` |

### 3.1 Pflicht-Konsequenzen pro Heptad-Aenderung

- **Schema:** RLS (`is_workspace_member` SELECT, `can_write_workspace` WRITE) + Cascade-Trigger fuer alle Source-FKs (polymorph: pro atom_type ein Trigger) + `REPLICA IDENTITY FULL` wenn Realtime + Backfill bei Spalten-Drop + Header-Comment.
- **Types:** Row-Type + Enriched-Type (wenn PostgREST-Embed) + AtomKind-Erweiterung wenn neuer atom_type.
- **Mutations:** Schreiben durch `runOptimistic*` — **inklusive** `SECURITY DEFINER`-RPCs. Pattern: RPC im Live-Pfad (atomare server-side Checks), `buildOffline` baut die synthetische Row mit `crypto.randomUUID()` als Fallback, Replay laeuft als direkter `from(table).insert()` (RLS uebernimmt die Pruefung). Bei Multi-Step-RPCs (z.B. `pin_doc_with_create` = doc + atom_pins atomar): zwei Insert-Specs queuen, FIFO-Replay haelt die Reihenfolge — Atomicity-Verlust offline akzeptabel, FK-Violation ergibt stale-Marker. Reads mit `mergeRows`/`putAll` + `getByWorkspace`/`getById`-Fallback.
- **Offline-Cache:** TABLES-Eintrag + DB_VERSION-Bump. **Vergessen heisst: Cache-Read crasht nach Reconnect.**
- **Realtime-Subscribe:** RealtimeTable-Type-Erweiterung + DIRECT_TABLES + Workspace-refetch-Bump fuer alle Resources die die Tabelle lesen. **Vergessen heisst: Multi-User-Mutationen werden erst nach Reload sichtbar.**
- **Export/Import:** WorkspaceExport-Field + alle 4 Export-Pfade (Workspace + Matrix-Subtree + Cell-Subtree + Feature-Variants) + Subtree-Filter via Owner-Sets + idempotenter Import (UNIQUE-Constraint-aware). **Vergessen heisst: Round-Trip verliert Daten unbemerkt.**
- **MCP-Tools:** Tool-Bundle pro Tabelle + Registrierung in `registerAllTools`. Auch wenn der Bridge-Web-Connector noch nicht live ist — die Schemas definieren die AI-API.

### 3.2 Auch zu pruefen (nicht im Heptad, aber haeufige Mit-Vergessen)

- **Workspace-Reset** (`lib/workspace-reset.ts`): wenn `^reset -all` die Tabelle nicht via Cascade trifft, manuell aufnehmen.
- **Audit-Log-Awareness** (Welle N.1+): wenn die Tabelle audit-relevant ist (sicherheitskritisch oder Compliance), in `lib/audit.ts` aufnehmen.
- **Standalone-Client** (`packages/client-standalone/matrix.html`): **eingefroren** — irrelevant, niemals dort nachzuziehen. Nur erwaehnt damit der Reflex "alles parallel pflegen" hier explizit verneint wird.
- **Smart-Summary / KI-Prompts**: wenn die neue Tabelle Atom-Eigenschaften traegt die in LLM-Prompts erscheinen, `task-aggregate.ts` o.ae. anpassen.
- **Sidebar-Tree / Chip-Filter**: wenn die Tabelle einen Sidebar-Indicator brauchen sollte (z.B. Atom-Type-Pin), `useSidebarChips` + `buildSidebarTree` ergaenzen.

### 3.2a Constraint-Drift bei polymorphen Tabellen (Pflicht-Synchronitaet)

**Verbindlich.** Wenn eine polymorphe Tabelle (heute: `atom_manifestations`) Diskriminator-Spalten via Enum + zusaetzliche CHECK-Constraints fuehrt, muessen Enum-Erweiterungen + CHECK-Updates in **derselben** Migration passieren. Sonst entsteht ein latenter Bug: das Enum kennt den neuen Wert, aber der CHECK-Constraint blockt jede INSERT/UPDATE-Operation damit.

Vorfall-Historie:
- Migration 072 (WV.B.1) hat `info_field` ins `atom_type`-Enum aufgenommen, den `atom_manifestations_atom_type_check` aber nicht erweitert. Latent gebrochen bis Migration 082 (WV.E #37) das nachzog.
- Migration 072 hat `info` in `atom_manifestation_kind`-Enum aufgenommen, den `atom_manifestations_container_check` aber nicht erweitert. Latent gebrochen — `kind='info'`-Inserts haben in der Praxis nie funktioniert.

**Pflicht-Selbstcheck bei Enum-Erweiterungen** an `atom_type` / `atom_manifestation_kind` / aehnlichen Diskriminatoren:

```
[ ] Enum erweitert (ALTER TYPE ... ADD VALUE)
[ ] atom_type_check synchron erweitert (DROP + RECREATE mit neuer Werteliste)
[ ] container_check synchron erweitert (Branch fuer neuen kind/container_kind)
[ ] level_check synchron erweitert (falls neuer kind level braucht)
[ ] UNIQUE-/Partial-Indexes synchron — pro neuer Diskriminator-Kombination eigener Index?
```

**Smoke-Test** post-Migration: `INSERT ... VALUES (<neuer-enum-wert>, ...)` als psql-1-Liner. Wenn der Insert mit `violates check constraint` failt → CHECK ist nicht synchron, Migration unvollstaendig.

### 3.3 Pre-Commit-Heptad-Selbstcheck

Vor jedem Migration-Commit ankreuzen — kostet 30 Sekunden, spart 30 Minuten Nachzieh-Sprint:

```
[ ] Schema       → Migration mit RLS + Trigger + Realtime-Publication
[ ] Types        → Row-Type + Enums in lib/types.ts
[ ] Mutations    → CRUD durch safe-mutation-Wrapper
[ ] Offline-Cache → TABLES + DB_VERSION-Bump in offline-cache.ts
[ ] Realtime     → RealtimeTable + DIRECT_TABLES + Workspace-Bumps
[ ] Export       → WorkspaceExport + alle 4 Export-Pfade + Import
[ ] MCP-Tools    → Tool-Bundle + index.ts-Registrierung
[ ] Constraint-Sync → atom_type_check + container_check + level_check + UNIQUE-Indexes (siehe §3.2a)
```

### 3.4 Lueckenexport-Verbot

Kein Export ist "fast vollstaendig". Vor jedem Export-Sprint **alle** Tabellen + FKs + JSONB-Felder + computed-Columns mit User abstimmen. Roundtrip-Test:
1. Workspace mit allen Features bestuecken
2. Export
3. Workspace wipen
4. Import
5. State-Diff: vorher == nachher ueber ALLE Tabellen

---

## 4. Mutation-Pfad (Offline-First)

### 4.1 Safe-Mutation-Wrapper (Pflicht)

Jede schreibende Funktion im `client-web` laeuft durch `lib/safe-mutation.ts`:

```ts
runOptimisticInsert<T>({ table, workspaceId, label, run, buildOffline })
runOptimisticUpdate<T>({ table, id, patch, label, run })
runOptimisticDelete  ({ table, id, label, run })
```

Wrapper-Verhalten:
1. Try `run()` (Live-Pfad).
2. Bei Erfolg: putOne/patchRow/deleteOne im IDB-Cache, return.
3. Bei `isNetworkError`: Spec in Mutation-Queue, Cache-Patch, return synthetisches Result.
4. Bei anderem Fehler (RLS, Validation, FK): hart durchwerfen — Caller toastet.

**Direkt `supabase.from(...).insert/update/delete()` ohne Wrapper = Review-Stop.** Auch in Helpern, auch in "kleinen" Mutations. Ausnahmen genau diese:

- **Sicherheitskritisch:** Auth-Mutations, Member-Roles, Invites — synchron-online, kein Offline-Replay (`feedback_saas_security_no_offline.md`).
- **Bulk-Operations** mit dokumentiertem Catch-Fallback (z.B. `applyChecklistClose` in `mutations.ts` — Bulk-Online-Pfad mit Per-Item-Wrapper-Fallback bei Network-Loss).

### 4.1.1 SECURITY DEFINER RPCs (Schleichpfad)

`supabase.rpc('xyz')` umgeht die Direkterkennung "Direkter `from(...).insert/update/delete()`" — ist aber funktional aequivalent und gehoert ebenfalls in `runOptimistic*`. Welle D vergass das initial fuer 7 von 11 Atom-Pin-/Tag-Mutations und musste nachziehen (Welle D.X.O Commit).

**Pattern: RPC im Live-Pfad, direkter Insert/Update im Replay.**

```ts
// Single-Step RPC (z.B. create_atom_pin)
return runOptimisticInsert<AtomPin>({
  table: 'atom_pins',
  workspaceId,
  label: 'Pin anlegen',
  run: async () => {
    const { data, error } = await supabase.rpc('create_atom_pin', { ... });
    if (error) throw error;
    return data as AtomPin;
  },
  buildOffline: (id) => ({ id, ...synthRow }),
});
```

**Multi-Step RPC** (z.B. `pin_doc_with_create` = `docs` + `atom_pins` atomar): try-RPC-online + offline-Fallback der zwei Insert-Specs queued (FIFO-Replay haelt die Reihenfolge). Atomicity-Verlust offline akzeptabel, FK-Violation auf den zweiten Step ergibt stale-Marker.

**Lookup-or-Create RPC** (z.B. `add_atom_tag_freetext` = workspace_tags-Lookup-or-Create + atom_tags-Insert): Offline-Fallback prueft den IDB-Cache nach existing workspace_tag mit (kind, value) — Hit ergibt einen Insert-Spec, Miss ergibt zwei. Beispiel: `lib/atom-tags.ts:offlineTagAdd`.

**Online-only-RPCs** (gc_workspace_tags, Bulk-Sweeps): kein Offline-Pfad noetig wenn der RPC nur in Admin-Tools laeuft. Im Funktions-Header dokumentieren.

### 4.2 Read-Pfad (Pflicht)

Jede lesende Funktion:

```ts
try {
  const { data, error } = await supabase.from('x').select(...);
  if (error) throw error;
  void mergeRows('x', data);
  markLiveSuccess();
  return data;
} catch (err) {
  if (!isNetworkError(err)) throw err;
  const cached = await getByWorkspace<T>('x', workspaceId);
  markCacheFallback();
  return cached;
}
```

### 4.3 IDB-Cache-Foundation

`packages/client-web/src/lib/offline-cache.ts`:
- `TABLES`-Tuple = Single-Source aller cachten Tabellen
- DB_VERSION wird hochgezogen, sobald TABLES sich aendert
- `upgrade()`-Callback erstellt neue Stores idempotent + droppt OBSOLETE_STORES
- API: `mergeRows`, `putAll`, `putOne`, `patchRow`, `deleteOne`, `getByWorkspace`, `getById`, `clearWorkspace`, `clearAll`

Neue Tabelle ohne `TABLES`-Eintrag → safe-mutation kann nicht wrappen → Review-Stop.

### 4.4 Mutation-Queue (FIFO-Replay)

`packages/client-web/src/lib/mutation-queue.ts`:
- IDB-persistierte Spec-Liste pro Workspace
- Auto-Replay bei Online-Erkennung
- Idempotent-Konvention: jeder Spec re-applybar ohne Schaden
- Multi-Step-Operations werden in einzelne Specs zerlegt — FIFO liefert Reihenfolge

### 4.5 Position-Helper-Pflicht

Tabellen mit `position`-Spalte haben einen `nextPosition*`-Helper:
- DB-Pfad: `MAX(position) + 1` ueber gefiltere Subset
- Cache-Fallback: `getByWorkspace` + filter + reduce(max)+1

**`Date.now()` als Position-Default ist verboten** — Replay-Drift, Reorder-Bruch. Siehe Q.1.c-Schaden.

---

## 5. Realtime + Multi-User

### 5.1 Channel-Konvention

Ein Channel pro Workspace: `supabase.channel('ws:${workspaceId}')`. Innerhalb der Channel mehrere `.on('postgres_changes', ...)` fuer alle relevanten Tabellen. **Kein Channel-pro-Tabelle**, kein Channel-pro-Komponente.

`subscribeWorkspace(workspaceId, bumps)` ist die Single-Entry. Komponenten registrieren Bumps:

```ts
subscribeWorkspace(wsId, {
  cells:  () => refetchCells(),
  tasks:  () => { refetchKanban(); refetchChecklist(); },
  atom_manifestations: (payload) => {
    const atomType = payload.new?.atom_type ?? payload.old?.atom_type;
    if (atomType !== 'task') refetchAtomCalendar();
    // task-Manifestations werden ueber tasks-Bump covered
  },
});
```

### 5.2 Subscribe-Pflicht

Jede neue Tabelle, deren Aenderungen UI-relevant sind:
1. `ALTER PUBLICATION supabase_realtime ADD TABLE public.x` in Migration
2. `REPLICA IDENTITY FULL` setzen (sonst kein workspace_id im DELETE-Payload)
3. `realtime.ts`-Subscriber-Eintrag
4. Refetch-Resource im Workspace.tsx

### 5.3 RLS (Row-Level Security)

Jede neue Tabelle bekommt:
1. `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`
2. `SELECT`-Policy: `is_workspace_member(workspace_id)`
3. `WRITE`-Policies: `can_write_workspace(workspace_id)` (USING + WITH CHECK)
4. `GRANT SELECT, INSERT, UPDATE, DELETE TO authenticated`
5. `GRANT ALL TO service_role`

**Einziger Mover:** Tabellen ohne `workspace_id` (z.B. `auth.users`-Mirror) brauchen alternative RLS — explizit dokumentieren.

### 5.4 RLS ist kein Frontend-Filter

RLS gibt Berechtigung, **nicht User-Scope**. Bei Self-Listings:

```ts
// FALSCH — nimmt alle workspace-sichtbaren rows
supabase.from('platform_admins').select('*');

// RICHTIG — explizit auf eigenen User filtern
supabase.from('platform_admins').select('*').eq('user_id', user.id);
```

### 5.5 Presence + Awareness

Workspace-Channel haelt Presence. Presence-Events bumpen NodeTree-Avatars + Cursor-Hints. Last-Seen via Throttle (max alle 2s ein Update). Konflikt-Free: Last-Write-Wins, kein OT/CRDT (V1).

### 5.6 Auth-Pfad-Vollstaendigkeit

| Pfad | Status (Stand 2026-05-02) |
|---|---|
| Magic-Link (Login) | live; B.1.E mit 30s-Cooldown + Spam-Hint |
| Mail+PW Login | live (B.1.B) |
| Mail+PW Signup | live als eigene /signup-Route (B.1.C) |
| ResetPassword | live als /reset-password-Route (B.1.D) |
| OAuth Google | live (B.1.A) — Provider-Slot in Admin/Config + Auto-Gate Login |
| OAuth Microsoft | live (B.1.A) |
| OAuth GitHub | live (B.1.A) |
| OAuth LinkedIn | live (B.1.A, OIDC-Variante) |
| OAuth Verify-Button | live (Discovery-Endpoint-Reachability + JWT-Issuer-Check) |
| TOTP-MFA | live (B.2) — Enrollment + Login-Gate + Backup-Codes |
| Backup-Codes | live (B.2 Folge) — 10 single-use Codes, sha256-Hash, Login-Gate akzeptiert |
| Step-Up-Auth (AAL2) | live (B.3) — Workspace-Delete/Owner-Transfer/MFA-Unenroll/Platform-Admin-Grant |
| Session-Mgmt | Welle B.5 (pending — Multi-Session-Liste + Revoke) |

Vor Production-Cutover muessen alle Auth-Pfade durch Step-Up-Auth fuer destruktive Aktionen geschuetzt sein.

### 5.7 Multi-User-Konsistenz

- Cross-Tab: `storage`-Event auf `sb-*-auth-token`-Key — Tab B erkennt Logout in Tab A.
- TOKEN_REFRESHED-Fail → automatischer Logout in `lib/auth.ts`.
- Account-Health: `validateUserExists()` nach jedem Sign-In/Token-Refresh. Geloeschter Account → local-only signOut + accountInvalid-Flag.

### 5.8 Realtime-Konsistenz-Direktive (User 2026-05-06)

> Realtime ist **Default** fuer alle user-relevanten Mutationen. Sekunden-Verzoegerung ist erlaubt, aber **kein Funktion-weiser Mix** (manche Mutation live, andere nur nach Reload).

**User-relevant** = jede Mutation, die andere Workspace-Member sichtbar betrifft. Beispiele:
- Atom-CRUD (tasks, links, docs, checklists, info_field, imported_event)
- Manifestation-CRUD (atom_manifestations)
- Cell/Row/Col/Matrix-Layout-Aenderungen
- Vorlagen-CRUD + Cell-Template-Instances + Overrides
- Marker-Toggle (Workspace-shared Marker wie `star`)
- Comments, Pins, Tags
- Member-Aktionen (Beitritt, Rollen-Aenderung)
- Provider-Verknuepfungen (widget_external_channels)

**NICHT user-relevant** (Realtime nicht noetig):
- User-private Settings (Theme, Sidebar-State, Filter-Lokal, Fokus-Cell)
- Token-Refreshes
- User-private Marker (`eye`-Marker — gehoert nur diesem User, andere Member sollen das gar nicht sehen)
- Audit-Log-Inserts (kein UI-Listener)

**Pflicht-Heptad-Check** bei jeder Schema-Aenderung:
1. Tabelle user-relevant? → JA: Realtime-Slot (5) gefuellt. NEIN: Begruendung im Migration-Header.
2. `ALTER PUBLICATION supabase_realtime ADD TABLE public.x` + `REPLICA IDENTITY FULL`.
3. `realtime.ts`-Subscriber-Eintrag.
4. Workspace-Bumps in `routes/Workspace.tsx`.

**Throttle/Debounce-Erlaubnis:**
- Hochfrequenz-Events (Marker-Toggle-Spam, Counter-Bumps, Presence-Pings) duerfen 1-3 Sekunden gepuffert werden — **nie** ganz weglassen.
- Pro Throttle-Pfad: dokumentierter Debounce-Wert + Begruendung im Subscriber-Code.

**Anti-Pattern (sofort durchfallen):**
- Mutation an einer User-relevanten Tabelle ohne Realtime-Subscribe.
- „Performance-Optimierung" durch selektives Realtime-Weglassen.
- Stiller Reload-Pfad fuer eine Mutation („User muss F5 druecken um das zu sehen") — User-relevante Tabelle = Live, Punkt.

**Adjacent-Cleanup-Pflicht:** wenn beim Bearbeiten eines Files eine User-relevante Mutation ohne Realtime-Pfad entdeckt wird, ansprechen und nach Approval mitziehen. Memory `feedback_realtime_konsistenz.md`.

---

## 6. MCP-Layer (Bridge + Tools)

### 6.1 Tool-Trio-Regel + Realtime-Garantie (Pflicht-Wiederholung)

Jedes MATRIX_TOOL hat **drei Artefakte plus eine Realtime-Garantie** — fehlt eins, ist es nicht merge-ready:

1. **Bridge-Schema** in `packages/bridge/src/tools/<gruppe>.ts`: Zod-Objekt + `zodToJsonSchema()`, registriert in `tools/index.ts`.
2. **Client-Handler** in `packages/client-standalone/matrix.html` (`MATRIX_TOOLS`-Registry) bzw. SaaS-Pendant.
3. **Vitest** in `packages/bridge/test/<gruppe>.test.ts` plus Integration via `tool-registry.test.ts` (Gesamtzahl).
4. **Realtime-Garantie** (User 2026-05-06): wenn das Tool eine **Mutation** an einer user-relevanten Tabelle macht (siehe §5.8), MUSS sie ueber den `safe-mutation`-Wrapper laufen ODER direkt eine Postgres-Insert/Update/Delete-Aktion sein, die Logical-Replication triggert. Direkter `supabase.from(...)` ohne Wrapper UND ohne Publication = Review-Stop. Read-only-Tools (`query.*`) sind ausgenommen. Pruef-Frage am Tool-Handler-Ende: „Sehen alle anderen Workspace-Member das Ergebnis dieses Tool-Aufrufs in Echtzeit, ohne Reload?" Nein → Realtime-Garantie ist gebrochen → Fix.

**Anti-Pattern bei Tool-Handlern:**
- Direkter `supabase.from(table).insert()` ohne `runOptimisticInsert`-Wrapper.
- Tool fuehrt Side-Effect ueber Edge-Function aus, die kein Publication-Update triggert (z.B. Edge-Function setzt Cache-Spalte direkt) — Frontend sieht erst nach Reload.
- Tool, das `service_role`-Key benutzt, um RLS zu umgehen, ohne dass die Tabelle in `supabase_realtime` Publication ist.

**Adjacent-Cleanup-Pflicht beim Tool-Sprint:** wenn ich auf einen existierenden Tool-Handler stosse, der die Realtime-Garantie verletzt, ansprechen + Fix mitziehen (Memory `feedback_realtime_konsistenz.md`).

### 6.2 Feature → MCP-Mapping-Pflicht

Jede neue Mutations-UI-Aktion (Add/Update/Delete/Move/Toggle) bekommt einen MATRIX_TOOL-Eintrag. Ausnahme-Kategorien:
- Rein darstellerisch (Scroll, Hover, Highlight) — keine Datenmutation, kein Tool.
- Komposition bestehender Tools (AI verkettet `X.do()` + `Y.do()`).
- Einmalige Import-/Export-Flows — als `import.*`/`export.*`-Tool spezifisch.

**Selbst-Check am Feature-Ende:** "Kann die AI dieses Feature aufrufen, ohne im Browser zu klicken?" Nein → Tool ergaenzen oder schreiben warum nicht.

### 6.3 Ref-Resolver-Konvention

Refs akzeptieren Alias (`^foo` / `foo`) und Raw-ID:

- `_resolveNodeRef(ref)` → `nodeId | null`
- `_resolveBoardRef(ref)` → mit `type==='board'`-Check
- `_resolveCardRef(args)` → `{boardId, cardId, card} | null`
- Cells: kein eigener Resolver — explizit `matrixRef + rowId + colId`

Neue Resolver folgen demselben Muster (Strip `^`, Alias-Index zuerst, Raw-ID-Fallback, Typ-Check).

### 6.4 Tool-Naming

- Dot-separated, Lesefluss als Satz: `card.done.toggle`, `cell.feature.add`, `matrix.edit_mode.set`
- Singular fuer Aktionen: `row.add`, nicht `rows.add`
- Query-Praefix fuer Read: `query.cards`, `query.aliases`
- Gruppen-Praefix passt zu Domain: `matrix.*`, `cell.*`, `card.*`, `link.*`, `info.field.*`, `checklist.*`, `task.*`, `manif.*`

### 6.5 Tool-Return-Shape

- **Erfolg:** `{<verb>: true, ...details}` mit Verb-Praefix (`created`, `deleted`, `updated`, `moved`, etc.). IDs/Refs zurueckgeben fuer Weiter-Ketten.
- **Fehler:** `{error: '<konkrete dt. Meldung>'}` — niemals werfen, niemals `undefined`.
- **Defensive Kopien** bei Array/Object-Returns.

### 6.6 Sanitization-Pflicht

- URLs durch `sanitizeUrl()` (`javascript:`/`data:` abgelehnt)
- Aliases durch `validateAlias(new, old)` — canonical lowercase
- Arrays explizit `Array.isArray()`-Check vor `.slice()`/`.filter()`

### 6.7 Destruktiv-Pattern in Tools

```
1. pushUndo('<dt. Label>')   ← VOR der Mutation
2. Mutation
3. showUndoToast('<Label>')   ← NACH der Mutation
```

Kein `confirm()` in Tool-Handlern — MCP-Calls laufen headless. Schutz ist Undo-Pipeline.

### 6.8 MCP-Coverage-Audit

Vor Welle-End-Merge: pro Tabelle pruefen, ob saemtliche Mutations als MCP-Tools verfuegbar sind. Liste der CRUD-Mappings im Plan-File. Luecken explizit vermerken.

---

## 7. Bridge (Self-Hosted MCP-Endpoint)

Nodejs + WebSocket + SQLite + nginx/TLS auf User-eigenem VPS. Detail-Plan in `docs/plan-bridge.md`. Hier nur die Architektur-Prinzipien:

### 7.1 Bridge-Typ-Deckung (`util/zod-json.ts`)

Mini-Konverter deckt: `string`, `number`, `boolean`, `enum`, `optional`, `default`, `array`, `object`, `record`, `union`, `discriminatedUnion`, `literal`. Neue Zod-Typen entweder erweitern oder auf existing mappen. Unbekannte Typen liefern `{}` — Handler **muss** zur Laufzeit validieren.

### 7.2 Client-Globals fuer Tool-Handler

Stabil + verwendbar (aus dem Haupt-Script):
- **Daten:** `nodes`, `rootId`, `stack`, `aliasIndex`, `appSettings`, `editMode`, `_undoStack`
- **Builder:** `uid()`, `mkMatrix(label)`, `mkBoard(label)`, `getCell(nid,key)`, `getCard(boardId,cardId)`
- **Feature-Mutation:** `addFeature(cell,feat)`, `removeTree(nid)`, `cleanupCellChildren(cell)`
- **Undo:** `pushUndo(label)`, `showUndoToast(label)`, `_applyUndo(entry)`
- **Alias:** `validateAlias(val,exclude)`, `rebuildAliasIndex()`
- **Persistenz:** `save()`, `saveSettings()`, `getPayload()`, `loadData(d)`, `render()`
- **Sanitization:** `sanitizeUrl(str)`
- **Toggle:** `setCardDone(boardId,cardId,toggle)`, `toggleEdit()`

Nicht zugreifen: interne Render-Helpers, private `_sb*`/`sb*`-Sidebar-State, DOM-Elemente direkt.

### 7.3 Object.assign-Chunking

Registry wird sprint-weise erweitert:

```js
// Basis schliesst:
'status': async () => { ... }
});

// ─── Sprint X.Y: <gruppe> ──────────────────────────────
function _resolveXyzRef(args) { ... }
const XYZ_TEMPLATES = { ... };

Object.assign(MATRIX_TOOLS, {
  'xyz.foo': async (args) => { ... },
  'xyz.bar': async (args) => { ... },
});
```

Vorteil: minimal-invasive Diffs, sauber rueckrollbar.

### 7.4 Alias-Index-Hygiene

`aliasIndex` wird bei jedem Mutations-Pfad, der Aliase **anlegt, loescht oder verschiebt**, neu aufgebaut via `rebuildAliasIndex()`. Cross-Board-Move ist Falle — siehe Sprint 4.3 Fix.

---

## 8. Globalitaet pro Domain (Pflicht)

**Jede Domain hat eine zentrale Library.** Komponenten konsumieren von dort, niemals selbst implementieren.

| Domain | Library | Verantwortung |
|---|---|---|
| Auth | `lib/auth.ts` | Session, Magic-Link, OAuth, Validate, Cross-Tab-Sync |
| Tasks (Layer 0+1) | `lib/tasks.ts` | CRUD, Manifestations, Position-Helper |
| Atoms (poly Layer 1) | `lib/atom-manifestations.ts` | Polymorphe Manifestations fuer non-task Atoms |
| Cells / Matrix | `lib/mutations.ts` | CRUD fuer rows/cols/cells/nodes |
| Queries | `lib/queries.ts` | Komposit-Reads (BoardContent, CellChecklists, AgendaTasks, ...) |
| Realtime | `lib/realtime.ts` | Subscribe-Pattern, Channel-Mgmt |
| Cache | `lib/offline-cache.ts` + `lib/safe-mutation.ts` + `lib/mutation-queue.ts` | IDB-Foundation |
| Calendar | `lib/calendar.ts` | Event-Build, Range-Render, Recur-Expansion |
| Recur | `lib/recur.ts` | recurFiresOn, toggleOccurrence |
| Search | `lib/search.ts` | Trigram-Search, Multi-Domain |
| Alias | `lib/alias.ts` + `lib/alias-resolve.ts` + `lib/alias-index.ts` | Alias-Validation, Resolver, Cross-Tab-Index |
| Drag-Drop | `lib/drag-context.ts` + `lib/manifestation-cross-view.ts` + `lib/manifestation-move.ts` | Drag-Pattern, Cross-View-Drop, Intra-View-Move |
| Animations | `lib/animations.ts` | Pflicht-Pattern aus `animations.md` |
| Dialogs | `lib/dialog.ts` | showConfirm, showChoice, showPrompt, installFocusTrap |
| Toasts | `lib/toasts.ts` | showToast, showUndoToast |
| Errors | `lib/errors.ts` | translateDbError, translateError |
| Dates | `lib/dates.ts` (anlegen wenn noetig) | formatDateDE, addDays, isoDate |
| Keyboard | `lib/keyboard-nav.ts` | useArrowListNav, useGridNav, installEscReturn |
| Admin | `lib/admin.ts` | Plattform-Admin-RPCs, useIsPlatformAdmin |
| MFA | `lib/mfa.ts` (kommend Welle B.2) | TOTP, Backup-Codes, Step-Up |
| Step-Up | `lib/step-up.ts` (kommend Welle B.3) | requireStepUp(action) |

**Regel:** wenn ein Pattern in zwei Komponenten auftaucht → in die passende Library ziehen. Keine "fast-doppelten" Komponenten-internen Helper.

---

## 9. Anti-Pattern (sofort durchfallen)

- **Dual-Write mit Sync-Trigger.** Zwei Tabellen mit Mirror-Logic — siehe Q.2-Schaden.
- **PostgREST-Embed ueber polymorphen Ref.** atom_manifestations.atom_id hat keinen FK. Embed-Versuch scheitert. Zwei parallele Queries + Map-Join.
- **Direkte `supabase.from(...).insert/update/delete()` ohne `safe-mutation`-Wrapper.**
- **Tabelle ohne IDB-Cache-Eintrag bei UI-relevanten Reads.**
- **`Date.now()` als Position-Default.** Position-Helper-Pflicht.
- **PostgREST-Self-Listing ohne `eq('user_id', auth.uid())`.** RLS ist Berechtigung, nicht Scope.
- **Realtime-Channel pro Komponente.** Ein Channel pro Workspace, viele Listener.
- **Tool ohne Vitest oder ohne Handler-Pendant.** Tool-Trio.
- **Schema-Aenderung ohne Export/Import-Aktualisierung.** Schema-Quad.
- **Type-Definition ausserhalb `lib/types.ts`.**
- **Helper-Doublette in mehreren Komponenten.** In Library ziehen.
- **`alert()` / `confirm()` / `prompt()` im Code.** Dialog-System verwenden.
- **MCP-Tool ohne Sanitization der URLs/Aliases/Arrays.**
- **Bridge-Tool-Handler ohne `pushUndo`/`showUndoToast` bei destruktiv.**

---

## 10. Pre-Architektur-Selbstcheck (vor Schema-Migrations und Welle-Start)

1. Ist die neue Domain ein Atom (Layer 0) oder eine Manifestation (Layer 1)? Im Layer-Modell verorten.
2. Wenn polymorph: passt es in atom_manifestations (atom_type erweitern) oder ist es eine eigene Domain?
3. RLS-Policies definiert? `is_workspace_member` SELECT + `can_write_workspace` WRITE?
4. `REPLICA IDENTITY FULL` + Realtime-Publication-Eintrag wenn UI-relevant?
5. IDB-TABLES-Eintrag + DB_VERSION bumpt?
6. `lib/<domain>.ts` mit safe-mutation-Wrappern angelegt?
7. Position-Helper bei `position`-Spalte?
8. MCP-Tool-Trio im Plan?
9. Export/Import-Field im WorkspaceExport-Type?
10. Komponenten konsumieren von Library, nicht inline?

Wenn **eine** Antwort Nein: Welle ist nicht startbereit.

---

## 11. Git-Strategie

### 11.1 Branch-Modell (trunk-based, Direkt-Merge)

```
main            prod. Direkt-Merge von Feature-Branches per User-Kommando.
 │
 ├── feat/<name>     neue Features (z.B. feat/welle-b-mfa)
 ├── fix/<name>      Bugfixes
 ├── chore/<name>    Refactoring, Tooling, Dependencies
 ├── docs/<name>     nur Doku
 └── ci/<name>       Workflows / Infra-Config
```

- Branch-Namen: kebab-case, Scope im Praefix.
- Lebenszyklus: ein Branch = eine Aufgabe, < 5 Tage offen.
- **Direkt-Merge auf main per User-Kommando, keine GitHub-PRs** (Memory `feedback_no_pr_direct_merge.md`).
- Commits im Feature-Branch werden direkt mit Conventional-Commits-Format committet — kein Squash-Schritt noetig.
- Keine Force-Pushes auf `main`.

### 11.2 Conventional-Commits-Format

```
<type>(<scope>): <kurzer Titel in dt.>

<Body — optional, erklaert Warum. Bullets.>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Types:** `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`, `style`, `perf`, `build`
**Scopes:** `client`, `bridge`, `bridge/tools`, `infra/nginx`, `infra/systemd`, `ci`, `docs`, `quality`, `auth`, `objects`, `tasks`, `atoms`, `calendar`, `admin`

Beispiele:
```
feat(atoms): atom_manifestations als Single-Source (Q.2)
fix(quality): position-Default ueber nextManifestationPosition statt Date.now()
refactor(tasks): TaskManifestationRow.task_id → atom_id
docs(claude): Animations-Manifest + Style-Manifest + Architektur-Manifest
```

### 11.3 Tags + Releases

Semver-Tags nach Meilensteinen: `v0.1.0-code-review`, `v0.1.0-bridge-local-mvp`, `v0.2.0-mcp-v1`, `v0.3.0-onboarding`, `v0.4.0-task-layer`, `v0.5.0-foundation` (nach Q.3-Audit-Welle).

### 11.4 Commit-Autorenschaft

Lokaler Committer = User-Identitaet (Git-Config). AI-Mitarbeit per `Co-Authored-By`-Trailer. Nie `--no-verify`, nie Signaturen manipulieren, nie Force-Push auf `main`.

---

## 12. AI-Provider-Master-Key (Phase 2 Welle A.0)

Migration `018_user_ai_providers.sql` legt eine Tabelle `user_ai_providers` an, in der jeder User eigene API-Keys (Anthropic/OpenAI/Gemini) ablegt. Keys werden at-rest verschluesselt mit `pgp_sym_encrypt` (pgcrypto). Master-Key kommt aus einer Postgres-GUC, **nicht** aus einer Migration und **nicht** aus einer Datei im Repo:

```sql
ALTER DATABASE postgres SET app.ai_master_key = '<base64-32-byte-secret>';
```

### 12.1 Setup pro Environment

1. **Master-Key generieren** (32 Byte zufaellig, Base64):
   ```bash
   openssl rand -base64 32
   ```
2. **Env-Variable** in Deploy-Stack definieren — z.B. `.env` neben `infra/supabase/`:
   ```
   AI_KEY_ENCRYPTION_KEY=<output>
   ```
3. **Auf der DB anwenden** (einmalig pro Environment, als Superuser):
   ```sql
   ALTER DATABASE postgres SET app.ai_master_key = '<value>';
   ```
   Reconnect noetig, damit Sessions die GUC sehen.
4. **Verifizieren:**
   ```sql
   SELECT current_setting('app.ai_master_key', true) IS NOT NULL
     AND length(current_setting('app.ai_master_key', true)) >= 16;
   -- t erwartet
   ```

### 12.2 Was passiert wenn Key fehlt

`public._ai_master_key()` raised `ai_master_key_missing` mit Hint. Frontend zeigt Toast "Provider konnte nicht gespeichert werden", Logs zeigen die echte Ursache.

### 12.3 Key-Rotation (out-of-scope V1)

Wenn der Master-Key rotiert: bestehende `api_key_encrypted`-Werte sind unbrauchbar. Phase-3-Item: Rotation-Tool als pg_cron-Helper, das mit beiden Keys decryptet+re-encryptet. Bis dahin: Master-Key behandeln wie Tresor-Schluessel — nie verlieren, nie rotieren.

### 12.4 Backups

Postgres-Dumps enthalten die `bytea`-Spalte verschluesselt — nutzlos ohne Master-Key. **Master-Key NIE in Backups oder Git mit-bundlen.**

---

## 14. Foundation-Direktive: Integration-First, Native-Fallback

**Verbindlich. Strategische Leitlinie, der jede Welle folgt.** Eingefuehrt 2026-05-04 nach User-Direktive im Konzept-Sprint Widget+Vorlagen-Modell.

### 14.1 Leitsatz

> Das Tool ist **Organisations-Layer ueber existing User-Infrastruktur**, nicht Konkurrenz dazu. Keine native Dateiablage. Kein eigener Chat. Maximal eigene Doku — und die idealerweise mit Sync zu Drittsystemen. Native Features sind **Fallback**, nicht Default. Maximale Flexibilitaet kommt aus Aliasen + Hyperlinks im Text + strukturellen Aggregationen, nicht aus eigenem Storage.

User-Erleben-Ziel: top-notch Organisations-Ebene, die das taegliche „pfff was gibts da alles und wo hab ich das wohl" ausschaltet — **ohne** dass der User seine bisherige Mail/Cloud/Messenger/Notiz-Infrastruktur aufgeben oder duplizieren muss.

### 14.2 Konsequenzen pro Domain

| Domain | Primaer-Pfad (Default) | Native-Fallback (opt-in) |
|---|---|---|
| **Comments / Chat** | Bridge zu Mail-Thread, Messenger-Thread, Slack-/Teams-Channel, WhatsApp-Business-Channel | `atom_comments`-Tabelle (Layer 4) — Single-User-/Offline-Use-Case |
| **Attachments** | Verknuepfung zu User-Cloud (OneDrive, Google Drive, Dropbox, Box) oder Bridge-Pfad zu lokalem Filesystem | Supabase-Storage-Bucket — explizit gewaehlt, Quota-limitiert |
| **Doc** | OneNote/Notion-Sync (V1-Anker; Workspace ↔ Notebook, Cell ↔ Section, Doc-Atom ↔ Page) | ProseMirror-Atom-Doc (heute live) — wenn User keinen externen Provider angebunden hat |
| **Calendar** | Google/Outlook/ICS Inbound (Welle I live) + Outbound-Sync (V1-Backlog) | Native Calendar-Manifestation (heute live) bleibt als Anker fuer App-interne Termine |
| **Sharing** | Drag-Drop nach extern (Mail-Compose, Messenger-Window, AI-Chat) mit Alias-Aufloesung zu absoluter URL | n/a (Sharing ist immer extern) |
| **Notifications** | Bridge zu Push-Provider / Mail / Slack-DM | In-App-Inbox als minimaler Fallback |

### 14.3 Pflicht-Konsequenz beim Schema-Heptad

Jede neue Tabelle, die Daten haelt, **die User extern halten koennten**, hat ein Channel-Verknuepfungs-Modell **bevor** der Native-Pfad gebaut wird. Der Heptad bekommt damit faktisch einen achten Slot:

```
[ ] 8. Channel-Bridge → externe Provider (mind. 1 Provider als V1-Anker)
```

Pruef-Frage vor Schema-Entwurf: „Koennte ein User diese Daten heute schon irgendwo anders halten? Wenn ja: Bridge-Konzept zuerst." Antwort „ja" trifft auf Comments, Files, Doc, Chat zu. Antwort „nein" trifft auf Aliase, Atom-Manifestations, Pins, Tags, Audit-Log zu.

### 14.4 Bestandskode-Behandlung

- Heutige native Implementations (ProseMirror-Doc, atom_manifestations(kind=calendar)) bleiben — werden aber unter §14.2 als „Fallback" reklassifiziert.
- Geplante native Implementations (Layer 4 Comments/Attachments per BACKLOG T.2) werden vor Implementierung durch ein Bridge-Konzept ersetzt oder ergaenzt.
- Migrationen, die Native-Spalten anlegen, ohne Bridge-Plan: Review-Stop.

### 14.5 Anti-Pattern (sofort durchfallen)

- Native-First-Implementierung ohne Bridge-Konzept im Plan-File.
- Schema-Migration fuer Comments/Files/Notes/Chat-Tabelle ohne Verknuepfungs-Tabelle (`<atom>_external_channels` oder aequivalent).
- UI-Toggle „Comments aktivieren" ohne Provider-Wahl im selben Toggle.
- Annahme „User wird unsere App fuer X benutzen" ohne Drittsystem-Bridge.
- AI-Pipe-Tools, die User-Daten via Native zwingen, statt durch Aliase + Hyperlinks zu transportieren.

### 14.6 Verhaeltnis zu §1.5 (Layer 4) und §3 (Schema-Heptad)

- **§1.5** beschreibt die Layer-4-Tabellen — diese sind ab 2026-05-04 als Fallback-Pfad reklassifiziert.
- **§3 Schema-Heptad** kriegt den achten Slot „Channel-Bridge", aber nur fuer Tabellen, die unter §14.3 fallen. Aliase/Atom-Manifestations/Pins/Tags bleiben rein nativ — sie sind die Organisations-Foundation, nicht User-Inhalt.

### 14.7 Verifikation

Vor jedem Welle-Start, der eine der Domains aus §14.2 betrifft:

1. Plan-File enthaelt einen Bridge-Konzept-Abschnitt mit mind. 1 V1-Provider.
2. Native-Pfad ist explizit als „Fallback" benannt, nicht als Default.
3. UI-Toggles haben „extern / native / off" als Optionen, Default `extern`.
4. Schema-Heptad-Slot 8 (Channel-Bridge) ist gefuellt oder explizit „n/a (kein User-Inhalt)".

Wenn **eine** Antwort nein: Welle ist nicht startbereit.

---

## 15. Aenderungen am Manifest

Nicht ohne Plan-Eintrag und User-Freigabe. Wenn ein neues Architektur-Pattern auftaucht (z.B. neue Atom-Domain, neuer Manifestation-Kind, neuer Realtime-Pattern), Manifest erweitern, niemals inline anders machen.
