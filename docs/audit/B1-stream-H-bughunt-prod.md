# AU-B1 / Stream H — Bug-Hunt + Edge-Cases + Production-Readiness

**Datum:** 2026-04-29
**Scope:** Cross-Cutting durch alle Modifikationen seit 26.04 (Commits ff57056 bis 7093afa)
**Methode:** Code-Reviewer-Agent, Race-Condition-Hunt, Realtime-Leak-Audit, Cleanup-Pattern, Offline-Queue, AI-Pipe-Edge-Cases, Performance-Stichproben.

---

## Bewertungs-Übersicht

| Severity | Count |
|---|---:|
| CRITICAL | 2 |
| HIGH | 8 |
| MEDIUM | 6 |
| LOW | 3 |
| INFO | 2 |

---

## Cross-Cutting-Beobachtungen

1. **`pendingMutationCount` ist workspace-agnostisch** — das Modul-globale Signal zeigt die Summe des zuletzt befragten Workspaces. Bei zwei gleichzeitig offenen Tabs auf verschiedenen Workspaces können die Counts kreuz-kontaminieren.

2. **Kein Cross-Tab-SignOut-Sync** — es gibt keinen `BroadcastChannel` und keinen `storage`-Event-Listener. Tab B merkt einen signOut in Tab A erst beim nächsten Supabase-Request oder Token-Expiry.

3. **`objects`-Tabelle ohne IDB-Cache-Fallback** — alle anderen Workspace-Tabellen haben Cache-Coverage. Objects fehlen vollständig; `fetchObjects` scheitert hart im Offline-Fall und zerstört den ganzen `resolverMaps`-Memo. **Cross-Stream:** Stream B B1-B-010 hat dasselbe gefunden.

4. **SIGNED_OUT löscht keine lokalen Caches** — `auth.ts` setzt nur `accountInvalid(false)` zurück. IDB-Cache, Alias-Index, Mutation-Queue und `offlineState` bleiben stehen. Bei User-Wechsel auf demselben Browser sieht der neue User Daten des vorherigen.

---

## Findings

### [CRITICAL] B1-H-001 — AbortError nach Cancel landet als Fehler-Toast im UI

**File:** `packages/client-web/src/components/AiHelpDrawer.tsx:200-214` + `packages/client-web/src/lib/ai-assist/index.ts:145-148`

**Was:** Wenn der User "Abbrechen" klickt, ruft `cancel()` `abortCtrl.abort()`. Der laufende `fetch`-Aufruf in `callAnthropicStream` wirft daraufhin einen `DOMException` mit `name === 'AbortError'`. Dieser propagiert durch den `try/catch` in `index.ts` als generischer Fehler. Der User sieht eine rote Error-Box mit "The operation was aborted." oder ähnlichem, obwohl er selbst abgebrochen hat — eine explizite Benutzeraktion wird als Systemfehler dargestellt.

**Fix:** In `index.ts` im `catch`-Block prüfen: `if ((e as Error).name === 'AbortError') { finalStopReason = 'error'; /* aber kein errorMsg setzen */ }`. In `AiHelpDrawer` den äußeren `catch` mit `if ((e as Error).name === 'AbortError') return;` abschneiden.

**Effort:** S
**Memory/Regel:** UX-Korrektheit, CLAUDE.md P12

---

### [CRITICAL] B1-H-002 — SIGNED_OUT löscht keine lokalen IDB-Caches (Datenschutz-Leck bei User-Wechsel)

**File:** `packages/client-web/src/lib/auth.ts:51-52`

**Was:** Beim `SIGNED_OUT`-Event setzt `onAuthStateChange` nur `setAccountInvalid(false)`. Die IDB-Datenbanken `matrix-cache` (alle Workspace-Rows) und `matrix-mutation-queue` (pending Mutations) bleiben komplett erhalten. `clearAliasIndex` wird nicht aufgerufen. `resetOfflineState()` bleibt aus.

**Warum:** In einem Multi-User-Szenario auf demselben Browser (Familie, Shared-Device, School-Chromebook) sieht der nächste User beim Öffnen der App sofort alle Daten des vorherigen Users aus dem Cache — inklusive Checklisten-Inhalte, Karten-Namen, Docs-Inhalte. **Cross-Stream:** Stream C B1-C-001 hat dasselbe für API-Keys gefunden — bestätigt strukturelles Pattern.

**CLAUDE.md-Referenz:** "Datenhoheit beim User" + "Keine Passwörter persistent speichern" (analog auf Fremddaten anzuwenden).

**Fix:** In `bootstrapAuth` den `SIGNED_OUT`-Handler erweitern: `clearAll()` (offline-cache), `clearWorkspaceQueue(...)` (alle Workspaces), `resetOfflineState()`, alle `clearAliasIndex`-Einträge. Plus `clearProviderCredentialCache()` + `resetAiProvidersCache()` aus B1-C-001.

**Effort:** M
**Memory/Regel:** CLAUDE.md P7

---

### [HIGH] B1-H-003 — Race-Condition in AiHelpDrawer: Mount-Check fehlt nach await

**File:** `packages/client-web/src/components/AiHelpDrawer.tsx:81-113`

**Was:** Der `createEffect` für Read-Only-Detection ruft ein `void (async () => { ... })()` auf. Nach `await fetchNodesForWorkspace(wsId)` und `await fetchMembers(wsId)` prüft der Code nicht, ob der Drawer inzwischen geschlossen wurde oder der Workspace gewechselt hat.

**Warum:** Bei schnellem Drawer-Toggle setzt der async-Block die Signale eines bereits geschlossenen Drawer-Renders.

**Fix:** Vor dem `async`-Block `let cancelled = false`; am Ende `onCleanup(() => { cancelled = true; })`. Im async-Block nach jedem `await` prüfen: `if (cancelled) return;`.

**Effort:** S
**Memory/Regel:** SolidJS Cleanup-Pattern

---

### [HIGH] B1-H-004 — Doppelte `For`-Loops für Nachrichten im AiHelpDrawer

**File:** `packages/client-web/src/components/AiHelpDrawer.tsx:352-394`

**Was:** Das Chat-UI rendert `messages()` zweimal mit zwei separaten `<For>` — alle User-Nachrichten erscheinen zuerst, danach alle Assistenten-Nachrichten. **Cross-Stream:** Stream D B1-D-005 hat dasselbe als HIGH gefunden.

**Fix:** Einen einzigen `<For>` mit `<Show when={...}>` darin.

**Effort:** S
**Memory/Regel:** SolidJS-Rendering-Korrektheit

---

### [HIGH] B1-H-005 — Race-Condition in `ensureObjectFor`: Doppel-Anlage bei schnellem Rename

**File:** `packages/client-web/src/lib/objects.ts:327-357`

**Was:** `ensureObjectFor` prüft `if (args.row.object_id) return null;` gegen den beim Aufruf bekannten Wert. Wenn der User zwei Renames in schneller Folge macht, kann `ensureObjectFor` zweimal aufgerufen werden, bevor der erste RPC-Call abgeschlossen ist. Beide sehen `object_id === null`, beide legen ein neues Object an.

**Warum:** Resultat: zwei Object-Einträge für dieselbe Row in der DB. Der spätere `update` überschreibt den ersten, aber der erste bleibt als Orphan in `objects` stehen. **Cross-Stream:** Stream B B1-B-001 + Stream F B1-F-004 + B1-H-017 sehen `ensureObjectFor` aus 4 Blickwinkeln.

**Fix:** In-memory `Set<string>` als Inflight-Guard pro rowId. Alternativ: Unique-Constraint auf `(workspace_id, home_ref_kind, home_ref_id)` auf DB-Ebene.

**Effort:** S
**Memory/Regel:** Race-Conditions in Async-Code

---

### [HIGH] B1-H-006 — `objects`-Resource ohne IDB-Cache-Fallback — Online-Dependency für resolverMaps

**File:** `packages/client-web/src/lib/objects.ts:74-83` + `packages/client-web/src/routes/Workspace.tsx:288-301`

**Was:** `fetchObjects` hat keinen `withCache`-Wrapper und keinen `isNetworkError`-Fallback. Das `resolverMaps`-Memo gibt offline `objectsById: new Map()` zurück. Jedes dynamische Template (`{row.object}` / `{column.object}`) rendert leer statt mit dem letzten bekannten Object-Label.

**Warum:** Breadcrumb, NodeTree-Labels und MatrixView-Header zeigen alle `"(ohne Label)"` offline. **Cross-Stream:** Stream B B1-B-010 hat dasselbe gefunden.

**Fix:** `objects`-Store in `offline-cache.ts` TABLES-Array + MatrixCacheSchema aufnehmen (DB_VERSION auf 4 bumpen), `fetchObjects` durch `withCache` wrappen.

**Effort:** L (DB_VERSION-Bump + Migration-Pfad)
**Memory/Regel:** CLAUDE.md Regel 17

---

### [HIGH] B1-H-007 — `pendingMutationCount` workspace-agnostisch — Cross-Workspace-Kontamination

**File:** `packages/client-web/src/lib/mutation-queue.ts:107-118`

**Was:** Modul-globales Signal `pendingCount` hält einen einzigen Zähler. Bei zwei Tabs auf verschiedenen Workspaces korrumpieren die Counts gegenseitig.

**Fix:** Signal pro workspaceId (Map) oder `refreshPendingCount` gibt den Wert als Return zurück statt globales Signal zu schreiben.

**Effort:** M
**Memory/Regel:** Multi-Tab-Konsistenz

---

### [HIGH] B1-H-008 — Kein Cross-Tab-SignOut-Sync

**File:** `packages/client-web/src/lib/auth.ts` (fehlendes Pattern)

**Was:** Tab B führt nach Tab-A-Logout weiter API-Calls durch, die mit 401 scheitern, ohne klaren Hinweis. Supabase-JS Cross-Tab-Sync via `storage`-Events funktioniert in Firefox unzuverlässig.

**Fix:** Explizit `window.addEventListener('storage', ...)` Handler in `bootstrapAuth` einbauen, bei Leerung des Supabase-Session-Keys `setSession(null)` + Redirect zu `/login`.

**Effort:** M
**Memory/Regel:** CLAUDE.md P11 (Kontext behalten)

---

### [HIGH] B1-H-009 — Tool-Use-Loop nach Abort setzt RPC-Calls ohne Abort-Signal fort

**File:** `packages/client-web/src/lib/ai-assist/index.ts:123-137`

**Was:** Das `signal` aus `opts.signal` wird nur an `callAnthropicStream` weitergegeben. Die darauffolgenden Tool-Dispatch-Calls via `supabase.rpc(...)` erhalten kein Abort-Signal. Beim User-Cancel während Tool-Phase läuft destructive `mcp_delete_*`-RPC trotzdem aus.

**Fix:** `opts.signal` durch `dispatchTool` durchreichen und bei `signal?.aborted` im Tool-Dispatch früh mit Abort-Error returnen. Alternativ: `signal.throwIfAborted()` am Anfang jedes Loop-Schleifendurchlaufs.

**Effort:** S
**Memory/Regel:** CLAUDE.md P8

---

### [HIGH] B1-H-010 — AiHelpDrawer Read-Only-Detection: `location.pathname` nicht reaktiv

**File:** `packages/client-web/src/components/AiHelpDrawer.tsx:81-114`

**Was:** Der `createEffect` wird nur durch `open()`-Änderung getriggert. `location.pathname` wird *nach* dem ersten `await` nicht mehr im reaktiven Tracking-Kontext gelesen. Bei Navigation zur anderen Node (Drawer offen, `open()` unverändert) bleibt Read-Only-Detection stale.

**Fix:** `extractNodeIdFromPath(location.pathname)` *vor* dem `void (async ...)()` lesen. Oder separater `createEffect` für `location.pathname`-Änderungen.

**Effort:** S
**Memory/Regel:** SolidJS Reactive-Tracking

---

### [MEDIUM] B1-H-011 — `fetchAliasIndexLive` ignoriert Supabase-Fehler in einzelnen Shards

**File:** `packages/client-web/src/lib/alias-index.ts:186-226`

**Was:** `Promise.all([nodes, cells, cards, ...])` gibt 6 Ergebnisse zurück, aber keiner der Einzel-Responses wird auf `.error` geprüft. Bei RLS-Fehler in einem Shard werden Aliases still aus dem Index ausgelassen.

**Fix:** Nach `Promise.all` jeden Shard auf `.error` prüfen und per `console.warn` loggen.

**Effort:** S
**Memory/Regel:** CLAUDE.md P12

---

### [MEDIUM] B1-H-012 — `resolverMaps`-Memo recomputed bei jedem einzelnen Realtime-Bump

**File:** `packages/client-web/src/routes/Workspace.tsx:296-301`

**Was:** `resolverMaps` ist ein `createMemo` das alle 4 Resources neu liest. Jeder Realtime-Bump baut alle 4 Maps neu (~800 Einträge bei mittleren Workspaces).

**Bewertung:** MEDIUM. Bei > 1000 Entities pro Dimension wird es spürbar.

**Fix:** Die 4 Maps einzeln als eigene `createMemo` pro Resource, dann fünftes Memo zur Zusammenführung.

**Effort:** S
**Memory/Regel:** Performance

---

### [MEDIUM] B1-H-013 — `AiHelpDrawer` baut Conversation-History ohne Tool-Use-IDs

**File:** `packages/client-web/src/components/AiHelpDrawer.tsx:177-184`

**Was:** Die Conversation für `runAssist` wird aus `messages()` aufgebaut, aber `tool_result`-Messages werden nicht korrekt für Anthropic-API rekonstruiert. Bei Follow-up-Nachricht in Session mit vorherigen Tool-Calls antwortet API mit `400 Bad Request` ("Missing tool_result for tool_use").

**Fix:** Das `ChatMessage`-Format muss Tool-Use-IDs speichern, oder Conversation direkt als `AssistMessage[]` im Drawer-State halten.

**Effort:** M
**Memory/Regel:** Anthropic-API-Korrektheit

---

### [MEDIUM] B1-H-014 — `createChildNode` Offline-Path: `created_by` fehlt im `buildOffline`-Result

**File:** `packages/client-web/src/lib/mutations.ts:435-450`

**Was:** Das `buildOffline`-Objekt für Nodes setzt `id`, `workspace_id`, `type`, `label`, ... aber `created_by` fehlt. Offline erstellte Nodes zeigen nach Reconnect-Replay einen leeren Avatar-Slot.

**Fix:** Im `buildOffline`-Block `created_by: user().id` hinzufügen.

**Effort:** XS
**Memory/Regel:** Konsistenz

---

### [MEDIUM] B1-H-015 — `pendingMuts()` Badge-Click kann `replayQueue` auf veraltete `workspaceId` rufen

**File:** `packages/client-web/src/routes/Workspace.tsx:1082-1102`

**Was:** Bei Click im Moment eines Workspace-Wechsels (innerhalb ~50ms-Fenster) könnte `params.workspaceId` die alte oder neue ID sein. `replayQueue` läuft gegen falschen Workspace.

**Fix:** Snapshot der `workspaceId` beim Effect-Mount; Click verwendet diese Variable.

**Effort:** S
**Memory/Regel:** Race-Conditions

---

### [MEDIUM] B1-H-016 — `offline-cache.ts` `blocked()` Handler ohne User-Hinweis

**File:** `packages/client-web/src/lib/offline-cache.ts:91-95`

**Was:** Bei IDB-Version-Konflikt zwischen Tabs hängt `openDB` bis der andere Tab schließt. User sieht weißen "Lade..."-Screen ohne Erklärung.

**CLAUDE.md-Referenz:** "Fehler sind UI."

**Fix:** Im `blocked()` Handler `showToast('Bitte andere Matrix-Tabs schließen oder neu laden, damit der Cache aktualisiert werden kann.', 'error')`.

**Effort:** S
**Memory/Regel:** CLAUDE.md P12

---

### [LOW] B1-H-017 — `ensureObjectFor` ruft `supabase.from(table).update()` ohne safe-mutation-Wrapper

**File:** `packages/client-web/src/lib/objects.ts:341-348`

**Was:** **Cross-Stream:** Stream B B1-B-001 (CRITICAL) + Stream F B1-F-004 (HIGH) + Stream H B1-H-005 (HIGH) sehen dasselbe Issue aus 4 verschiedenen Blickwinkeln. Hier nur als LOW eingeordnet weil es Race-Condition-fokussiert ist (der eigentliche Wrapper-Verstoß ist anderweitig bereits eskaliert).

**Effort:** (Teil von B1-B-001)
**Memory/Regel:** CLAUDE.md Regel 17

---

### [LOW] B1-H-018 — `alias-index.ts` states-Map akkumuliert ohne Cleanup-Garantie

**File:** `packages/client-web/src/lib/alias-index.ts:39`

**Was:** Bei schnellem Workspace-Wechsel + Rendering-Error im Cleanup-Pfad wächst `states`-Map unbounded.

**Fix:** Optional Bound (LRU-Cache) oder bei jedem Workspace-Mount alle anderen states löschen.

**Effort:** S

---

### [LOW] B1-H-019 — `AiHelpDrawer` Drawer: Conversation bleibt bei Workspace-Wechsel

**File:** `packages/client-web/src/components/AiHelpDrawer.tsx:53-69`

**Was:** Drawer lebt in App.tsx außerhalb der Route-Hierarchie. Chat-Historie von Workspace A nach Wechsel zu B vollständig sichtbar — KI-Antworten beziehen sich auf alten Kontext.

**Fix:** Bei Workspace-Wechsel `setMessages([])` aufrufen; oder UI-Hinweis "Workspace-Wechsel: neue Konversation starten?".

**Effort:** S
**Memory/Regel:** CLAUDE.md P11

---

### [INFO] B1-H-020 — `model: cred.modelName || 'claude-opus-4-7'` — Fallback-Model-ID Drift-Risiko

**File:** `packages/client-web/src/lib/ai-assist/index.ts:100`

**Was:** Hardcoded Fallback `'claude-opus-4-7'` dupliziert Konstante aus `ai-providers.ts:129`.

**Fix:** `import { PROVIDER_DEFAULT_MODELS } from '../ai-providers'` und `cred.modelName || PROVIDER_DEFAULT_MODELS.anthropic`.

**Effort:** XS

---

### [INFO] B1-H-021 — `validateUserExists` kann doppelt feuern bei schnellem Token-Refresh

**File:** `packages/client-web/src/lib/auth.ts:48-63`

**Was:** `onAuthStateChange` feuert für `SIGNED_IN` und `TOKEN_REFRESHED` jeweils `validateUserExists()`. Bei race kann `setAccountInvalid(true)` und sofort `(false)` gesetzt werden — und der Toast in App.tsx wird nie zurückgesetzt.

**Fix:** Inflight-Guard in `validateUserExists`.

**Effort:** S

---

## Zusammenfassung Top-Prioritäten

| Prio | Finding | Datei | Hauptrisiko |
|---|---|---|---|
| 1 | B1-H-002 | `lib/auth.ts:51` | Datenschutz: andere User sehen Workspace-Daten nach Logout |
| 2 | B1-H-001 | `AiHelpDrawer.tsx:200-214` / `ai-assist/index.ts:145` | UX-Crash: Abort zeigt Fehler statt Silent-Stop |
| 3 | B1-H-009 | `ai-assist/index.ts:123-137` | Safety: destructive Tool-RPC läuft nach User-Abort durch |
| 4 | B1-H-004 | `AiHelpDrawer.tsx:352-394` | Korrektheit: Chat-Reihenfolge strukturell falsch gerendert |
| 5 | B1-H-013 | `AiHelpDrawer.tsx:177-184` | Funktionalität: Tool-Use-History fehlt → Anthropic 400 bei Follow-up |
| 6 | B1-H-006 | `lib/objects.ts:74` / `Workspace.tsx:288` | Offline: resolverMaps kaputt bei Netzwerkausfall |
| 7 | B1-H-005 | `lib/objects.ts:327` | Daten-Integrität: Doppel-Object bei schnellem Rename |
| 8 | B1-H-003 | `AiHelpDrawer.tsx:81` | Race: stale Read-Only-State nach schnellem Drawer-Toggle |
