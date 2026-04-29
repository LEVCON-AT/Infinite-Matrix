# AU-B1 / Stream B — Mutations + Offline-Pfad

**Datum:** 2026-04-29
**Scope:** `packages/client-web/src/lib/` — mutations.ts, queries.ts, objects.ts, members.ts, ai-providers.ts, audit.ts, subtree-import.ts, workspaces.ts, wizard-apply.ts, wizard-state.ts, workspace-create.ts, workspace-reset.ts, workspace-role.ts, presence.ts, presence-filter.ts, incognito.ts, user-prefs.ts, onboarding-gate.ts, errors.ts
**Methode:** Code-Reviewer-Agent, statische Analyse gegen CLAUDE.md Regel 17 (Offline-Pfad), Regel 13 (Undo), Regel 12 (Toast), Schema-Vier-Artefakte-Regel, Memory-Feedback-Refs.

---

## Bewertungs-Übersicht

| Severity | Count |
|---|---:|
| CRITICAL | 2 |
| HIGH | 7 |
| MEDIUM | 5 |
| LOW | 2 |
| INFO | 4 |

---

## Cross-Cutting-Beobachtungen

`mutations.ts` ist insgesamt mustergültig: alle normalen CRUD-Mutations laufen durch `runOptimisticInsert`/`runOptimisticUpdate`/`runOptimisticDelete` mit korrekten `buildOffline`-Implementierungen. Die kritischen Lücken liegen konzentriert in den neuen Object/Group-Mutations (`objects.ts`) und dem Wizard-Apply-Pfad (`wizard-apply.ts`), die beide direkte `supabase.from(...).insert/update/delete()` ohne Wrapper verwenden — explizit als "sync-online"-Design dokumentiert, aber teils ohne die notwendige UI-Fehlerbehandlung. Das `pushUndo`/`showUndoToast`-Pattern ist für Node-Delete (`deleteNode`) und Object-Delete (`deleteObject`) vollständig nicht implementiert, obwohl beide hochdestruktiv und ohne reversiblen Datenpfad sind.

---

## Coverage-Tabelle: Neue Mutations + Wrapper-Status

| Funktion | File:Line | Wrapper | pushUndo+Toast | Tech-Toast OK? |
|---|---|---|---|---|
| `addRow` | mutations.ts:120 | `runOptimisticInsert` | n/a (create) | ja |
| `updateRow` (intern) | mutations.ts:167 | `runOptimisticUpdate` | n/a | ja |
| `renameRow` | mutations.ts:189 | via `updateRow` | n/a | ja |
| `renameAndLinkRow` | mutations.ts:196 | via `updateRow` | n/a | ja |
| `setRowPosition` | mutations.ts:200 | via `updateRow` | n/a | ja |
| `delRow` | mutations.ts:204 | `runOptimisticDelete` | ja (MatrixView.tsx:369) | ja |
| `addCol` | mutations.ts:217 | `runOptimisticInsert` | n/a | ja |
| `updateCol` (intern) | mutations.ts:261 | `runOptimisticUpdate` | n/a | ja |
| `renameCol` | mutations.ts:283 | via `updateCol` | n/a | ja |
| `renameAndLinkCol` | mutations.ts:287 | via `updateCol` | n/a | ja |
| `setColPosition` | mutations.ts:291 | via `updateCol` | n/a | ja |
| `delCol` | mutations.ts:295 | `runOptimisticDelete` | ja (MatrixView.tsx:396) | ja |
| `insertCell` | mutations.ts:316 | `runOptimisticInsert` | n/a | ja |
| `updateCell` | mutations.ts:355 | `runOptimisticUpdate` | n/a | ja |
| `delCellRow` | mutations.ts:377 | `runOptimisticDelete` | FEHLT (kein Undo-Toast) | — |
| `createChildNode` (intern) | mutations.ts:405 | `runOptimisticInsert` | n/a | ja |
| `createChildMatrix` | mutations.ts:453 | via `createChildNode` | n/a | ja |
| `createRootNode` | mutations.ts:472 | `runOptimisticInsert` | n/a | ja |
| `createChildBoard` | mutations.ts:527 | via `createChildNode` | n/a | ja |
| `createRootMatrixWithDefaults` | mutations.ts:549 | via `createRootNode`+seeds | n/a | ja |
| `createRootBoardWithDefaults` | mutations.ts:580 | via `createRootNode`+seeds | n/a | ja |
| `createMatrixFromGroups` | mutations.ts:615 | via `createRootNode`+seeds | n/a | ja |
| `mutateNodeData` (intern) | mutations.ts:653 | `runOptimisticUpdate` | n/a | ja |
| `setNodeDescription` | mutations.ts:695 | via `mutateNodeData` | n/a | ja |
| `deleteNode` | mutations.ts:702 | `runOptimisticDelete` | **FEHLT** | — |
| `renameNode` | mutations.ts:719 | `runOptimisticUpdate` | n/a | ja |
| `addKbCol` | mutations.ts:752 | `runOptimisticInsert` | n/a | ja |
| `delKbCol` | mutations.ts:847 | `runOptimisticDelete` | FEHLT (kein Undo in UI) | — |
| `delCard` | mutations.ts:1205 | `runOptimisticDelete` | ja (BoardView.tsx:617) | ja |
| `delChecklist` | mutations.ts:1394 | `runOptimisticDelete` | ja (ChecklistPanel.tsx:181) | ja |
| `delChecklistSnapshot` | mutations.ts:1605 | via `updateChecklist` | ja (ChecklistPanel.tsx:309) | ja |
| `delChecklistItem` | mutations.ts:1718 | `runOptimisticDelete` | ja (ChecklistPanel.tsx:216) | ja |
| `delCellInfoField` | mutations.ts:1827 | via `mutateCellData` | FEHLT (kein Undo-Toast) | — |
| `delCellLink` | mutations.ts:1908 | via `mutateCellData` | FEHLT (kein Undo-Toast) | — |
| `delBoardLink` | mutations.ts:2107 | `runOptimisticDelete` | ja (BoardView.tsx:713) | ja |
| `delDoc` | mutations.ts:2318 | `runOptimisticDelete` | ja (DocsPopup.tsx:629) | ja |
| `createObject` | objects.ts:207 | **kein Wrapper** (sync-online) | n/a (Hintergrund) | ja |
| `setObjectHomeRef` | objects.ts:248 | **kein Wrapper** (sync-online) | n/a (Hintergrund) | ja |
| `ensureObjectFor` (intern) | objects.ts:327 | **kein Wrapper** — direktes `.update()` | n/a | ja |
| `addRowWithObject` | objects.ts:275 | via `addRow` (Step 2) | n/a | ja |
| `addColWithObject` | objects.ts:298 | via `addCol` (Step 2) | n/a | ja |
| `addKbColWithObject` | objects.ts:386 | via `addKbCol` (Step 2) | n/a | ja |
| `updateObject` | objects.ts:616 | **kein Wrapper** (sync-online via RPC) | n/a | ja |
| `setObjectParent` | objects.ts:633 | **kein Wrapper** (sync-online via RPC) | n/a | ja |
| `addObjectTag` | objects.ts:641 | **kein Wrapper** (sync-online via RPC) | n/a | ja |
| `removeObjectTag` | objects.ts:649 | **kein Wrapper** (sync-online via RPC) | n/a | ja |
| `deleteObject` | objects.ts:657 | **kein Wrapper** (sync-online via RPC) | **FEHLT** | ja |
| `createGroup` | objects.ts:504 | **kein Wrapper** (sync-online via RPC) | n/a | ja |
| `addGroupMembers` | objects.ts:527 | **kein Wrapper** (sync-online via RPC) | n/a | ja |
| `removeGroupMembers` | objects.ts:541 | **kein Wrapper** (sync-online via RPC) | n/a | ja |
| `renameGroup` | objects.ts:554 | **kein Wrapper** (sync-online via RPC) | n/a | ja |
| `deleteGroup` | objects.ts:562 | **kein Wrapper** (sync-online via RPC) | **FEHLT + kein Caller** | ja |
| `createSoftGroup` | objects.ts:570 | **kein Wrapper** (sync-online via RPC) | n/a | ja |
| `promoteSoftGroup` | objects.ts:595 | **kein Wrapper** (sync-online via RPC) | n/a | ja |
| `fetchMembers` | members.ts:57 | localStorage-Fallback | — | ja |
| `deactivateMember` / `reactivateMember` / `removeMember` / `changeMemberRole` | members.ts:86-146 | sync-online (security) | n/a | ja |
| `fetchAiProviders` | ai-providers.ts:53 | localStorage-Fallback | — | ja |
| `setAiProvider` / `setAiProviderDefault` | ai-providers.ts:86 | sync-online (security) | n/a | ja |
| `deleteAiProvider` | ai-providers.ts:100 | sync-online (security) | **FEHLT** | ja |
| `transferWorkspaceOwnership` / `deleteWorkspace` | workspaces.ts:22-40 | sync-online (security) | n/a | ja |
| `loadUserPrefs` | user-prefs.ts:34 | isNetworkError-Fallback (null) | — | ja |
| `saveUserPrefs` | user-prefs.ts:57 | **direkt upsert**, no wrapper | n/a | ja |
| `applyWizardProposal` | wizard-apply.ts:60 | **direkt insert** (kein Wrapper) | n/a (Wizard-Context) | ja |
| `clearCellInfoData` / `clearCellChecklistsData` / `clearMatrixContents` | subtree-import.ts:362-498 | **direkt update/delete** | n/a (Import-Op) | ja |
| `clearBoardContents` | workspace-reset.ts:54 | **direkt delete** | n/a (Reset-Op) | ja |

---

## Findings

### [CRITICAL] B1-B-001 — `ensureObjectFor`: direktes `supabase.from(table).update()` ohne Wrapper

**File:** `packages/client-web/src/lib/objects.ts:341-344`

**Was:** `ensureObjectFor` verknüpft ein neu angelegtes Object mit einem bestehenden Row/Col/Kb_col via direktem `supabase.from(args.table).update({ object_id: object.id }).eq('id', args.row.id)` ohne `runOptimisticUpdate`-Wrapper. Dies ist eine schreibende Funktion, die `rows`/`cols`/`kb_cols` modifiziert — die drei Tabellen, für die der Offline-Cache existiert.

**Warum:** CLAUDE.md Regel 17: "Direkte `supabase.from(...).insert/update/delete()` ohne Wrapper sind ein Review-Stop." Der Caller `ensureObjectForRow`/`Col`/`KbCol` wird als Background-Task nach `renameRow`/`renameCol` aufgerufen — wenn das Netz gerade weg ist (Zug, Offline-Nutzung), wird der update-Call schleichend ignoriert (Fehler nur `console.warn`). Beim nächsten Online-Sync bleibt `object_id = null` obwohl ein Object existiert. Daten-Inkonsistenz.

**Fix:** Den Update-Teil durch `updateRow`/`updateCol`/`updateKbCol` (bereits gewrappte Helper in mutations.ts) ersetzen oder explizit durch `runOptimisticUpdate` wrappen.

**Effort:** S
**Regel:** CLAUDE.md Regel 17

---

### [CRITICAL] B1-B-002 — `wizard-apply.ts`: Direkte Inserts in `kb_cols`, `cols`, `rows`, `cells` ohne Wrapper

**File:** `packages/client-web/src/lib/wizard-apply.ts:198-325`

**Was:** `applyBoardChildren` inseriert `kb_cols` direkt via `supabase.from('kb_cols').insert(...)` (Zeile 198–207), `applyMatrixChildren` inseriert `cols` (Zeile 262–271) und `rows` (Zeile 290–299) und `cells` (Zeile 316–326) — alles direkte Inserts ohne `runOptimisticInsert`. Die gleichen Tabellen haben in `mutations.ts` gewrappte Pendants (`addKbCol`, `addRow`, `addCol`, `insertCell`).

**Warum:** CLAUDE.md Regel 17 — direktes `supabase.from(...).insert()` für Tabellen, die im Offline-Cache geführt werden, ist Review-Stop. Zwar ist der Wizard ein einmaliger Onboarding-Flow und typischerweise Online — aber Fehler landen in `failures[]` statt im Cache, und die neuen Rows erscheinen nicht im IDB-Cache, sodass ein anschließender Offline-Tab leere Sidebar zeigt.

**Fix:** Die direkten Inserts durch die bereits existierenden gewrappten Mutations ersetzen: `addKbCol(...)`, `addRow(...)`, `addCol(...)`, `insertCell(...)`. Der `mcp_create_node`/`mcp_create_card`/`mcp_create_checklist`-Pfad via RPC ist vertretbar (kein Cache für diese), aber die Tabellen-Direkt-Inserts nicht.

**Effort:** M
**Regel:** CLAUDE.md Regel 17

---

### [HIGH] B1-B-003 — `deleteNode`: kein `pushUndo` + `showUndoToast`

**File:** `packages/client-web/src/lib/mutations.ts:702-716`, Caller: `packages/client-web/src/components/NodeTree.tsx:1222`

**Was:** `deleteNode` läuft durch `runOptimisticDelete` — gut. Aber der einzige Caller in NodeTree zeigt via `deleteWithExportPrompt` nur einen "Object loescht sich"-Toast (`showToast(args.successMsg, 'success')`), ohne `showUndoToast` mit Wiederherstellungs-Callback. Das `runOptimisticDelete`-Wrapper in safe-mutation.ts registriert kein Undo — dieser liegt vollständig beim Caller.

**Warum:** CLAUDE.md Regel 13: Alles, was Daten verliert, braucht `pushUndo(label)` + `showUndoToast(label, onUndo → restoreX(snap))`. `deleteNode` löscht rekursiv via DB-Cascade rows/cols/cells/kb_*/checklists/items/links — das ist der destruktivste Einzelvorgang in der App. Memory `feedback_saas_undo_pattern.md`: Snapshot + showUndoToast.

**Fix:** In `deleteWithExportPrompt` (NodeTree.tsx:763) vor `args.deleteFn()` einen Snapshot der Node-Row nehmen, danach `showUndoToast(label, async () => restoreRow('nodes', snap))` aufrufen. Achtung: Cascade-Wiederherstellung ist nicht vollständig möglich (rows/cols gehen auch), daher sollte der Toast klar kommunizieren was wiederherstellbar ist.

**Effort:** M
**Regel:** CLAUDE.md Regel 13, Memory `feedback_saas_undo_pattern.md`

---

### [HIGH] B1-B-004 — `deleteObject`: kein `showUndoToast`

**File:** `packages/client-web/src/routes/ObjectDetail.tsx:468-477`

**Was:** `deleteObject` (objects.ts:657) wird in ObjectDetail.tsx aufgerufen — mit `console.error` + `showToast` bei Fehler (korrekt). Aber kein Snapshot, kein `showUndoToast`.

**Warum:** CLAUDE.md Regel 13. `deleteObject` löscht via `mcp_delete_object` RPC, was alle Backlinks + Tags mitnimmt. Sync-online ohne Cache-Pfad → nach dem Delete gibt es keinen automatischen Rollback. Memory `feedback_saas_undo_pattern.md`.

**Fix:** Vor dem `await deleteObject(o.id)` die `ObjectRow` als `snap` nehmen (bereits vorhanden als `obj()`), danach `showUndoToast('Object gelöscht.', async () => { await createObject({...snap...}); })` aufrufen. Die Backlinks können beim Restore nicht automatisch rekonstruiert werden — das ist im Toast-Hinweis zu erwähnen.

**Effort:** S
**Regel:** CLAUDE.md Regel 13

---

### [HIGH] B1-B-005 — `deleteGroup`: kein Caller, kein Undo, exportiert aber nicht verwendet

**File:** `packages/client-web/src/lib/objects.ts:562-565`

**Was:** `deleteGroup` ist exportiert, wird aber in keiner Komponente/Route aufgerufen (Grep bestätigt: kein Caller außer der Lib-Definition). Die Funktion existiert, aber es gibt weder einen UI-Einstiegspunkt noch einen zugehörigen Undo-Pfad.

**Warum:** Sofern `deleteGroup` im nächsten Sprint mit UI verbunden wird, fehlt das Undo-Pattern von Anfang an. Das ist ein "dead export" der unfertige Arbeit signalisiert. CLAUDE.md Regel 13 greift sobald er aufgerufen wird.

**Fix:** Entweder Caller + Undo-Pattern zeitgleich implementieren, oder die Funktion als `// TODO: O.5-UI` markieren und unexportiert lassen bis der Caller kommt.

**Effort:** S
**Regel:** CLAUDE.md Regel 13, Memory `feedback_schema_quad.md`

---

### [HIGH] B1-B-006 — `delKbCol`: kein `showUndoToast` im UI

**File:** `packages/client-web/src/lib/mutations.ts:847-857`

**Was:** `delKbCol` ist korrekt durch `runOptimisticDelete` gewrappt. Aber kein Caller in den gescannten Komponenten zeigt nach dem Delete ein `showUndoToast`. BoardView.tsx enthält `showUndoToast` nur für Cards und Links, nicht für Kb_col-Löschung.

**Warum:** CLAUDE.md Regel 13 — eine Kanban-Spalte mit Karten + Checklisten ist destruktiv und nicht trivial wiederherstellbar.

**Fix:** Im BoardView-Caller (wo `delKbCol` aufgerufen wird) vor dem Delete Snapshot der KbColRow + aller zugehörigen Cards nehmen, danach `showUndoToast('Spalte "X" gelöscht.', onUndo → restoreKbColWithCards(colSnap, cardSnaps))` aufrufen. `restoreRow` in mutations.ts unterstützt bereits `kb_cards`.

**Effort:** M
**Regel:** CLAUDE.md Regel 13

---

### [HIGH] B1-B-007 — `fetchAiProviders`: fehlendes explizites `user_id`-Filter (RLS-als-Scope-Anti-Pattern)

**File:** `packages/client-web/src/lib/ai-providers.ts:53-63`

**Was:** `fetchAiProviders(userId)` liest `user_ai_providers_safe` View ohne `.eq('user_id', userId)`. Der `userId`-Parameter wird nur für den Cache-Key und Cache-Write benutzt, aber nicht als DB-Filter gesetzt.

**Warum:** Memory `feedback_rls_select_filter.md`: "RLS-Policy gibt Berechtigung, nicht User-Scope. Self-Listings explizit mit `.eq('user_id', auth.uid())` filtern." Die View `user_ai_providers_safe` ist per RLS auf den aufrufenden User eingeschränkt — aber das ist eine Policy-Garantie, kein expliziter Filter. Wenn die RLS-Policy je geändert oder die View durch einen Service-Role-Key aufgerufen wird, liefert sie alle Rows.

**Fix:** `.eq('user_id', userId)` vor `.order(...)` einfügen. `userId` ist bereits als Parameter vorhanden.

**Effort:** S
**Regel:** Memory `feedback_rls_select_filter.md`

---

### [HIGH] B1-B-008 — `MembersList.tsx`: fehlende `console.error()` in allen Catch-Blöcken

**File:** `packages/client-web/src/components/MembersList.tsx:110-114, 140-144, 166-170, 183-187, 205-209`

**Was:** Alle fünf Mutation-Catch-Blöcke in MembersList.tsx (`handleRoleChange`, `handleRevoke`, `handleDeactivate`, `handleReactivate`, `handleRemove`) rufen `showToast(..., 'error')` auf — aber kein einziger hat `console.error(prefix, err)` davor.

**Warum:** Memory `feedback_user_facing_toasts.md`: "DE-Endkunden-Toast + console.error davor." Das ist eine explizite Projektkonvention. Ohne `console.error` ist Debugging in Production unmöglich.

**Fix:** Vor jedem `showToast` in den Catch-Blöcken `console.error('handleRoleChange:', err)` etc. einfügen. Vorbild: `DeleteWorkspaceModal.tsx:58`.

**Effort:** S
**Regel:** Memory `feedback_user_facing_toasts.md`

---

### [MEDIUM] B1-B-009 — `delCellRow`, `delCellInfoField`, `delCellLink`: kein `showUndoToast` im UI

**File:** `packages/client-web/src/lib/mutations.ts:377-391, 1827-1831, 1908-1912`

**Was:** Die drei Lösch-Mutations für Zell-Inhalte sind korrekt gewrappt, aber kein Caller zeigt `showUndoToast`.

**Warum:** CLAUDE.md Regel 13 gilt auch für Info-Felder und Links — beides sind User-erstellte Daten. `delCellRow` ist besonders destruktiv (löscht Sub-Strukturen via Cascade).

**Fix:** In den aufrufenden Komponenten (CellInfoPage.tsx) vor dem Delete Snapshot nehmen + `showUndoToast` aufrufen.

**Effort:** M
**Regel:** CLAUDE.md Regel 13

---

### [MEDIUM] B1-B-010 — `fetchObjects` / `fetchObject` / `fetchObjectChildren` / `fetchAllBacklinks` / Soft-Group-Reads: kein IDB-Cache-Fallback

**File:** `packages/client-web/src/lib/objects.ts:74-153, 180-197, 432-479, 485-497`

**Was:** Alle Object-Layer-Read-Funktionen werfen bei Netzwerkfehler direkt — kein `isNetworkError`-Check, kein IDB-Fallback.

**Warum:** CLAUDE.md Regel 17. Dokumentiert als bewusstes Defer ("IDB-Cache-Fallback folgt mit O.4 wenn offline-cache.ts-TABLES-Liste um 'objects' erweitert wird") — aber im Audit zu erfassen.

**Fix:** Wenn O.4 kommt: `offline-cache.ts` um `objects`, `groups`, `group_members` erweitern (DB_VERSION-Bump), dann `isNetworkError`-Fallback einbauen.

**Effort:** L (O.4-Sprint)
**Regel:** CLAUDE.md Regel 17

---

### [MEDIUM] B1-B-011 — `fetchCellExistingTemplates`: kein `markLiveSuccess`

**File:** `packages/client-web/src/lib/queries.ts:461-544`

**Was:** Die neue Funktion macht mehrere parallele Reads ohne `markLiveSuccess()`/`markCacheFallback()`. Bei Netzwerkfehler wird `_` geschluckt — kein Online-Indicator-Update.

**Warum:** Konventions-Inkonsistenz: alle anderen Reads in queries.ts rufen `markLiveSuccess()`.

**Fix:** Nach `await Promise.all(tasks)` in der success-Branch `markLiveSuccess()` aufrufen.

**Effort:** S
**Regel:** CLAUDE.md Regel 17 (Pattern-Konsistenz)

---

### [MEDIUM] B1-B-012 — `members.ts:fetchMembers`: fehlendes `markLiveSuccess()` im Erfolgsfall

**File:** `packages/client-web/src/lib/members.ts:57-76`

**Was:** Bei Netzwerkfehler korrekt `markCacheFallback()`, aber im Erfolgsfall wird `markLiveSuccess()` nicht aufgerufen.

**Warum:** Analog B1-B-011: das Offline-Badge kann "stuck on cache" bleiben.

**Fix:** Nach `writeCache(workspaceId, members)` im try-Block: `markLiveSuccess()` einfügen.

**Effort:** S
**Regel:** CLAUDE.md Regel 17

---

### [MEDIUM] B1-B-013 — `deleteAiProvider`: kein Confirm-Dialog vor dem Delete

**File:** `packages/client-web/src/lib/ai-providers.ts:100-104`

**Was:** `deleteAiProvider` ist sync-online (Security). Aber es fehlt jegliches Undo/Confirm-Angebot — User der versehentlich den API-Key löscht, muss ihn neu eingeben (RPC löscht den verschlüsselten Key endgültig).

**Warum:** CLAUDE.md Regel 13 — auch Security-Mutations brauchen Bestätigung. Da Plain-Text nicht client-seitig liegt, ist kein echter Restore möglich. Confirm-Dialog ist Minimum.

**Fix:** Im UI-Caller vor `deleteAiProvider(id)` einen `showConfirm`-Dialog ("Provider endgültig löschen? Der API-Key kann nicht wiederhergestellt werden.").

**Effort:** S
**Regel:** CLAUDE.md Regel 13

---

### [LOW] B1-B-014 — Subtree-Import / Workspace-Reset: direkte Deletes ohne Wrapper (dokumentiertes Bulk-Pattern)

**File:** `packages/client-web/src/lib/subtree-import.ts:362-498`, `workspace-reset.ts:54`

**Was:** Multi-step Bulk-Operationen mit direkten `supabase.from(...).delete()`.

**Warum:** Dokumentiertes Bulk-Pattern (analog `applyChecklistClose`) — Idempotenz-/Cascading-Argument. Caller sind import-/reset-getriggert.

**Fix:** Keine sofortige Änderung. Optional: Offline-Guard `if (isOffline()) throw`.

**Effort:** L
**Regel:** CLAUDE.md Regel 17 (Bulk-Ausnahme)

---

### [LOW] B1-B-015 — `fetchAuditLog`: kein IDB-Fallback (dokumentiertes Design)

**File:** `packages/client-web/src/lib/audit.ts:62-86`

**Was:** Online-only ohne Fallback. Bei Netzfehler leere Liste.

**Warum:** Bewusste Design-Entscheidung: Audit-Trail soll authoritativ sein, kein stale Snapshot. Kein Review-Stop.

**Fix:** Optional: Toast bei Netzfehler statt leerer Liste.

**Effort:** S (optional)
**Regel:** INFO

---

### [INFO] B1-B-016 — Schema-Coverage: 021 (mcp_tools) Bridge-only, 034 (group_rpcs) UI-Lücke

**File:** N/A

**Was:** Migration 021 hat keine Frontend-Caller (Bridge-only — korrekt). Migration 034 hat Frontend-Caller in objects.ts, aber kein UI-Einstiegspunkt für `deleteGroup`.

**Fix:** Für group_rpcs: `deleteGroup`-UI im Group-Mgmt-Sprint mit Undo implementieren.

**Effort:** M

---

### [INFO] B1-B-017 — `applyChecklistClose`: Bulk-Online/Fallback-Offline-Muster korrekt

**File:** `packages/client-web/src/lib/mutations.ts:1563-1599`

**Was:** Direkter Bulk-Update online + Fallback auf gewrappte Items offline. Perf-Argument gut begründet.

---

### [INFO] B1-B-018 — `saveUserPrefs`: Direct-Upsert vertretbar durch Last-Write-Wins

**File:** `packages/client-web/src/lib/user-prefs.ts:57-70`

**Was:** Direktes Upsert ohne Wrapper. Netzwerkfehler werden leise geschluckt.

**Warum:** Datei-Kommentar begründet: User-Prefs haben keine kritische Korrektheitspflicht. Beim nächsten Mount neu laden. Kein Review-Stop.

---

### [INFO] B1-B-019 — `fetchCellIdsWithDocs`: Set-Aufbau ohne mergeRows

**File:** `packages/client-web/src/lib/queries.ts:975-998`

**Was:** Baut `Set<string>` ohne vollständige DocRows zu laden. Kein `mergeRows('docs')`. Im Offline-Fallback filtert aus gecachtem Store. Korrekt.

---

## Zusammenfassung Top-Prioritäten

| Prio | ID | Severity | Effort | Kurztitel |
|---|---|---|---|---|
| 1 | B1-B-001 | CRITICAL | S | `ensureObjectFor` Bare-Update — Daten-Inkonsistenz offline |
| 2 | B1-B-002 | CRITICAL | M | `wizard-apply` Bare-Inserts — Cache-Lücke |
| 3 | B1-B-003 | HIGH | M | `deleteNode` ohne Undo — destruktivster Vorgang |
| 4 | B1-B-004 | HIGH | S | `deleteObject` ohne Undo |
| 5 | B1-B-008 | HIGH | S | MembersList kein `console.error` — Debug-Blindfleck |
| 6 | B1-B-007 | HIGH | S | `fetchAiProviders` ohne User-ID-Filter |
| 7 | B1-B-006 | HIGH | M | `delKbCol` ohne Undo |
| 8 | B1-B-005 | HIGH | S | `deleteGroup` Dead Export |
