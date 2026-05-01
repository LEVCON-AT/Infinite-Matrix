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
                 │   Layer 1 — Manifestations       │  ← wo erscheint das Atom?
                 │   (1:N atom_manifestations)      │     Kanban / Checklist / Calendar /
                 │   atom_type ∈ {task,link,        │     Standalone / (spaeter Flowchart)
                 │     checklist,doc}               │     (T.1 + T.AC)
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
- `docs` — id, title, content, attached_cell_id, title_template

**Regel:** ein Atom-Typ = eine Tabelle. Keine parallelen Tables fuer dieselbe Domain. Keine Mirror-Spalten. Keine "alternative" Repraesentation.

### 1.2 Layer 1 — Manifestations (polymorph)

Eine **einzige** polymorphe Tabelle `atom_manifestations` haelt alle Sichten:

```sql
atom_manifestations (
  id           uuid PK
  atom_type    enum('task','link','doc','checklist')   -- Diskriminator
  atom_id      uuid                                     -- Soft-Ref auf Layer-0-Tabelle
  workspace_id uuid FK workspaces
  kind         enum('kanban','checklist','calendar','standalone')
  container_id uuid                                     -- kb_col / checklist / null
  position     numeric
  level        smallint                                 -- nur bei kind='checklist' (0-2)
  display_meta jsonb                                    -- kanban-color, calendar time/range/recur, ...
  created_at   timestamptz
)
```

**Regel:** kein Mirror, keine Sync-Trigger zwischen parallelen Tables. Polymorph mit `atom_type`-Diskriminator. Layer-0-Tabellen haben **keinen** FK zu atom_manifestations (wuerde Polymorphie brechen). Stattdessen: BEFORE-DELETE-Trigger pro Layer-0-Tabelle, der atom_manifestations purged (Pseudo-CASCADE).

**USP-Konsequenz:** *Drag-to-Create-Manifestation* — eine Task wird Karte UND Termin UND Checklisten-Punkt. Ein Link wird im Kalender als Wiedervorlage. Eine Checkliste wird im Kanban als Card-Ref. Cross-View ist additiv: dieselbe atom_id, mehrere Manifestations, eine Wahrheit.

### 1.3 Layer 2 — Dependencies (Phase T.3)

`atom_dependencies (from_atom_type, from_atom_id, to_atom_type, to_atom_id, kind)` als M:N-DAG. Cycle-Detection via PG-Recursive-CTE. Visual via dagre-d3 oder SVG-Eigenbau.

### 1.4 Layer 3 — Regeln (Phase T.4)

`atom_rules (atom_type, atom_id, when_jsonb, then_jsonb)`. Trigger via Postgres-Triggers oder Edge-Function. Heikelster Block — eigene Welle, evtl. erst V2.

### 1.5 Layer 4 — Additive Anhaenge (Phase T.2)

`atom_comments`, `atom_attachments` (Supabase-Storage), `atom_doc_notes`. Alle 1:N an `(atom_type, atom_id)`. Realtime fuer Comments.

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

## 3. Schema-Quad-Regel

**Jede strukturelle Aenderung pflegt vier Artefakte gleichzeitig.** Kein Sub-Sprint gilt als done, wenn nur drei davon stehen.

| Artefakt | Wo | Was |
|---|---|---|
| **Schema** | `infra/supabase/migrations/NNN_*.sql` | DDL: `CREATE TABLE`, RLS-Policies, Indexes, Trigger, Realtime-Publication, Comments |
| **Mutations** | `packages/client-web/src/lib/<domain>.ts` | CRUD-Funktionen durch `safe-mutation`-Wrapper, IDB-Cache-Fallback fuer Reads |
| **MCP-Tools** | `packages/bridge/src/tools/<domain>.ts` + `packages/client-standalone/matrix.html` Handler | Add/Update/Delete/Move/Search-Tools, Zod-Schema, Vitest |
| **Export/Import** | `packages/client-web/src/lib/export.ts` + `import-exec.ts` + `subtree-import.ts` | Roundtrip-Test, Field-Mapping, Lueckenexport-Verbot |

### 3.1 Pflicht-Konsequenzen pro Quad-Aenderung

- **Schema:** RLS-Policy (`is_workspace_member` SELECT, `can_write_workspace` WRITE) + `REPLICA IDENTITY FULL` wenn Realtime + DB-Header-Comment der die Tabelle erklaert.
- **Mutations:** alle Schreibe durch `runOptimisticInsert`/`Update`/`Delete`. Reads mit `mergeRows`/`putAll` + `getByWorkspace`/`getById`-Fallback. IDB-TABLES-Eintrag + DB_VERSION-Bump.
- **MCP-Tools:** Tool-Trio (Schema + Handler + Vitest). `registerAllTools`-Count in `tool-registry.test.ts` aktualisiert.
- **Export/Import:** Field im `WorkspaceExport`-Type, `fetchWorkspaceRowsForExport` ergaenzt, `import-exec.ts`-`insertBatch` ergaenzt, Cell-Subtree-Filter (`exportCellSubtree`) abgedeckt.

### 3.2 Lueckenexport-Verbot

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

---

## 6. MCP-Layer (Bridge + Tools)

### 6.1 Tool-Trio-Regel (Pflicht-Wiederholung)

Jedes MATRIX_TOOL hat **drei Artefakte** — fehlt eins, ist es nicht merge-ready:

1. **Bridge-Schema** in `packages/bridge/src/tools/<gruppe>.ts`: Zod-Objekt + `zodToJsonSchema()`, registriert in `tools/index.ts`.
2. **Client-Handler** in `packages/client-standalone/matrix.html` (`MATRIX_TOOLS`-Registry) bzw. SaaS-Pendant.
3. **Vitest** in `packages/bridge/test/<gruppe>.test.ts` plus Integration via `tool-registry.test.ts` (Gesamtzahl).

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

## 13. Aenderungen am Manifest

Nicht ohne Plan-Eintrag und User-Freigabe. Wenn ein neues Architektur-Pattern auftaucht (z.B. neue Atom-Domain, neuer Manifestation-Kind, neuer Realtime-Pattern), Manifest erweitern, niemals inline anders machen.
