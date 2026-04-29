# AU-B1 / Stream F — CLAUDE.md + docs/claude/* Konformität

**Datum:** 2026-04-29
**Scope:** Cross-Cutting durch ~70 modifizierte/neue Files in `packages/client-web/src/`
**Methode:** Code-Reviewer-Agent, Prüfung gegen 17 Arbeitsprinzipien, „Was NICHT tun"-Liste, ~25 Memory-Files, checklisten.md.

---

## Bewertungs-Übersicht

| Severity | Count |
|---|---:|
| CRITICAL | 2 |
| HIGH | 6 |
| MEDIUM | 5 |
| LOW | 2 |
| INFO | 1 |
| **Total** | **16** |

---

## Cross-Cutting-Beobachtungen

**1. P12-Verletzung als strukturelles Muster:** Das `wrap()`-Pattern in `MatrixView.tsx` und `BoardView.tsx` ist convenience, aber es supprimiert `console.error` in allen durch `wrap()` aufgerufenen Fehler-Pfaden. Dieses Design-Pattern pflanzt sich auf mindestens 5 weitere Komponenten fort (`CellInfoPage`, `ChecklistPanel`, `CellChecklistsPage`, `CardOverlay`, `NodeTree`-Encryption-Function). Eine einzelne `wrap()`-Funktion ohne `console.error` multipliziert den Verstoß auf alle seine Aufrufer.

**2. Export-Lücke als systematisches Problem:** Die `WorkspaceExport`-Shape und `exportWorkspace()` wurden beim Object-Layer (Phase 3 O.1–O.8) nicht nachgezogen. Alle neuen Tabellen (`objects`, `object_tags`, `groups`, `group_members`, `soft_groups`) sowie `user_ai_providers` fehlen im Export. Das widerspricht sowohl P7 (Datenhoheit beim User) als auch `feedback_export_completeness.md` und der Schema-Vier-Artefakte-Regel aus `checklisten.md`. **Cross-Stream:** Stream A B1-A-006 hat dasselbe gefunden.

**3. P13/SaaS-Undo-Pattern-Lücke:** `NewCellWizard.tsx` ruft `deleteNode()` und `delCellRow()` ohne `showUndoToast`. `ObjectDetail.tsx` ruft `deleteObject()` ohne Undo. **Cross-Stream:** Stream B B1-B-003/004 hat dasselbe gefunden.

**4. P17-Verletzung in `ensureObjectFor`:** Ein direktes `supabase.from(args.table).update()` ohne safe-mutation-Wrapper existiert in `lib/objects.ts:341-344`. **Cross-Stream:** Stream B B1-B-001 hat dasselbe gefunden — Cross-Cutting bestätigt.

---

## Konformitäts-Tabelle (per Prinzip)

| Prinzip | Status | Anmerkung |
|---|---|---|
| P1 Praktikabilität | OK | `wrap()`-Pattern ist sinnvoll; `ensureObjectFor` 3-Schritt-Atomic dokumentiert |
| P2 Minimal-invasiv | OK | Keine offensichtlichen Scope-Creep-Refactors gefunden |
| P3 Bestehendes wiederverwenden | TEILWEISE | `wrap()`-Pattern in `MatrixView`/`BoardView` wiederverwendet; aber kein `console.error` darin |
| P4 Animated | OK | Keine harten display:none-Swaps in JSX gefunden |
| P5 Single-File-Constraint | OK | `matrix.html` existiert, keine Hinweise auf Änderungen im Scope |
| P6 Deutsch | OK | Alle UI-Strings in den geprüften Komponenten deutsch |
| P7 Datenhoheit | TEILWEISE | Export-Lücke; StepWelcome informiert User über API-Key-Weitergabe, aber kein Hinweis dass Workspace-Inhalte via `mcp_get_workspace_context` zur KI übertragen werden |
| P8 Risiko-Aktionen bestätigen | OK | `showConfirm` vor `deleteNode`/`deleteObject`/`delCellRow` vorhanden |
| P9 Kein Refactor ohne Auftrag | OK | Keine Evidenz gefunden |
| P10 Messbare Verifikation | INFO | Audit-intern OK |
| P11 Kontext behalten | OK | `DeleteWorkspaceModal`, `NewCellWizard` zeigen relevante Namen |
| P12 Fehler sind UI | **VERSTOSS** | `console.error` fehlt in `wrap()`-Pattern + 7 weitere Dateien |
| P13 Destruktives kriegt Undo | TEILWEISE | `NewCellWizard` `deleteNode`/`delCellRow` und `ObjectDetail` `deleteObject` ohne Undo |
| P14 Tokens vor Literals | OK | Keine neuen Inline-Hex/px-Literale in JSX gefunden |
| P15 Focus-Restore bei Modals | OK | `installFocusRestore()` in `TopLevelWizard`, `NewCellWizard`, `WizardShell` korrekt |
| P16 Animations-Hygiene | OK | Keine `setTimeout`-Animationen; `display:none` nur in scope-gebundenen CSS-Regeln |
| P17 Offline-Pfad | TEILWEISE | `ensureObjectFor` direktes `supabase.from().update()` ohne Wrapper |

---

## Findings

### [CRITICAL] B1-F-001 — `console.error` fehlt in `wrap()`-Pattern: BoardView + MatrixView

**File:** `packages/client-web/src/components/BoardView.tsx:469-471`, `packages/client-web/src/components/MatrixView.tsx:220-222`

**Was:** Das `wrap()`-Helper-Pattern in beiden Komponenten zeigt im `catch`-Block nur `showToast(translateDbError(err), 'error')`, enthält aber kein `console.error(...)`. Da `wrap()` von 10+ Funktionen (`onAddCol`, `onRenameCol`, `onAddCard`, `onMoveCard`, `onAddLink`, `onDelLink`, `onAddRow`, `onDelRow`, `onDelCol`, …) aufgerufen wird, sind alle diese Fehler-Pfade ohne Console-Log.

**Warum:** `checklisten.md` (Trigger: Fehlermeldung / Toast-String hinzugefügt): „Doppel-Pattern: jede `catch`-Branch hat `console.error('<funktionsname>:', err)` **vor** dem `showToast`." Ohne `console.error` in `wrap()` ist bei DB-Fehlern kein Stack-Trace im DevTools-Filter auffindbar — Debugging ist blind.

**Fix:**
```ts
// In wrap():
} catch (err) {
  console.error('wrap:', err);
  showToast(translateDbError(err), 'error');
}
```
Dasselbe in `MatrixView.tsx` line 221.

**Effort:** S
**Memory/Regel:** `feedback_user_facing_toasts.md`, checklisten.md Trigger „Fehlermeldung/Toast-String"

---

### [CRITICAL] B1-F-002 — `console.error` fehlt systemweit in Catch-Blöcken ohne `wrap()`

**File:** `packages/client-web/src/components/CellInfoPage.tsx:103`, `packages/client-web/src/components/ChecklistPanel.tsx:126,158,222`, `packages/client-web/src/components/CardOverlay.tsx:107`, `packages/client-web/src/components/NodeTree.tsx:90`, `packages/client-web/src/components/CellChecklistsPage.tsx:81`

**Was:** Mehrere weitere catch-Blöcke, die `showToast(translateDbError(err), 'error')` aufrufen, haben kein vorangehendes `console.error(...)`. Das sind eigenständige catch-Blöcke (kein `wrap()`), also ergänzend zu B1-F-001.

**Warum:** Checklisten-Regel „Doppel-Pattern" gilt für jeden catch-Block. Die Direktive aus `feedback_user_facing_toasts.md` lautet explizit: „DE-Endkunden-Toast + `console.error` davor."

**Fix:** Jedem dieser catch-Blöcke ein `console.error('<Funktionsname>:', err)` voranstellen. Z.B. in `CellInfoPage.tsx:103`: `console.error('wrap (CellInfoPage):', err);`.

**Effort:** S
**Memory/Regel:** `feedback_user_facing_toasts.md`, CLAUDE.md P12

---

### [HIGH] B1-F-003 — Export-Lücke: Object-Layer-Tabellen nicht im Workspace-Export

**File:** `packages/client-web/src/lib/export.ts:23-49`, `packages/client-web/src/lib/export.ts:130-186`

**Was:** `WorkspaceExport`-Typ und `exportWorkspace()` exportieren `nodes`, `rows`, `cols`, `cells`, `kb_cols`, `kb_cards`, `checklists`, `checklist_items`, `links`, `docs` — aber nicht: `objects`, `object_tags`, `groups`, `group_members`, `soft_groups`. Ebenso fehlen `user_ai_providers`. Subtree-Import in `lib/subtree-import.ts` kennt diese Tabellen ebenfalls nicht.

**Warum:** `feedback_export_completeness.md`: „Kein Lückenexport. Vor jedem Export-Sprint alle Tabellen + FKs + JSONB-Felder mit User abstimmen." checklisten.md Trigger „Strukturelle Änderung". **Cross-Stream:** Stream A B1-A-006 hat dasselbe gefunden.

**Fix:** `WorkspaceExport`-Shape um `objects`, `object_tags`, `groups`, `group_members`, `soft_groups` erweitern; `exportWorkspace()` lädt diese parallel; `formatExportStats`/`summarizeExport` um Object-Count erweitern; `subtree-import.ts` `clearAll*`-Helpers und `parseImportPayload` anpassen.

**Effort:** L
**Memory/Regel:** `feedback_export_completeness.md`, `feedback_schema_quad.md`, CLAUDE.md P7

---

### [HIGH] B1-F-004 — P17-Verletzung: Direktes `supabase.from().update()` ohne Wrapper in `ensureObjectFor`

**File:** `packages/client-web/src/lib/objects.ts:341-344`

**Was:**
```ts
const { error } = await supabase
  .from(args.table)
  .update({ object_id: object.id })
  .eq('id', args.row.id);
```
Dies ist ein direktes `supabase.from(...).update()` ohne `runOptimisticUpdate` oder einen bereits gewrappten Helper. Es wird von `ensureObjectForRow`, `ensureObjectForCol`, `ensureObjectForKbCol` aufgerufen — alles User-sichtbare Aktionen (Rename-Pfad).

**Warum:** CLAUDE.md P17 und „Was NICHT tun": „Direkte `supabase.from(...).insert/update/delete()` ohne Wrapper sind ein Review-Stop." **Cross-Stream:** Stream B B1-B-001 hat dasselbe als CRITICAL gefunden.

**Fix:** Auf `runOptimisticUpdate` umstellen oder über `updateRow`/`updateCol`/`updateKbCol` aus `mutations.ts` leiten.

**Effort:** M
**Memory/Regel:** CLAUDE.md P17, checklisten.md Trigger „Feature geändert"

---

### [HIGH] B1-F-005 — P13-Verletzung: `deleteNode` im `NewCellWizard` ohne `showUndoToast`

**File:** `packages/client-web/src/components/NewCellWizard.tsx:414`, `packages/client-web/src/components/NewCellWizard.tsx:550-551`

**Was:** Im Edit-Mode löscht `doCommit()` (line 414) und `doClearCell()` (lines 550-551) Sub-Nodes via `deleteNode()` und Cells via `delCellRow()`, ohne anschließend `showUndoToast(...)` anzubieten.

**Warum:** CLAUDE.md P13: „Destruktives kriegt Undo." `feedback_saas_undo_pattern.md`. **Cross-Stream:** Stream B B1-B-003 hat verwandtes gefunden.

**Fix:** Vor `deleteNode()` Snapshot des Node erstellen; nach `deleteNode()` `showUndoToast(label, () => restoreNode(snap))` aufrufen.

**Effort:** M
**Memory/Regel:** CLAUDE.md P13, `feedback_saas_undo_pattern.md`

---

### [HIGH] B1-F-006 — P13-Verletzung: `deleteObject` in `ObjectDetail` ohne `showUndoToast`

**File:** `packages/client-web/src/routes/ObjectDetail.tsx:469-477`

**Was:** `onDelete()` ruft `deleteObject(o.id)` auf und zeigt nur `showToast('Object geloescht.', 'success')` — kein Undo-Angebot.

**Warum:** CLAUDE.md P13 + `feedback_saas_undo_pattern.md`. Das Object-Layer hat kein `restoreObject`-Pendant in `mutations.ts` — das fehlt im Vier-Artefakte-Durchlauf. **Cross-Stream:** Stream B B1-B-004 hat dasselbe gefunden.

**Fix:** `restoreObject(snap)` in `lib/objects.ts` anlegen; vor `deleteObject()` Snapshot ziehen; nach Delete `showUndoToast` zeigen.

**Effort:** M
**Memory/Regel:** CLAUDE.md P13, `feedback_saas_undo_pattern.md`

---

### [HIGH] B1-F-007 — MembersList: `console.error` fehlt in 5 Catch-Blöcken

**File:** `packages/client-web/src/components/MembersList.tsx:110-119`, `:140-145`, `:166-171`, `:183-188`, `:205-210`

**Was:** Alle fünf Action-Handler haben catch-Blöcke mit `showToast` aber ohne `console.error`. **Cross-Stream:** Stream B B1-B-008 hat dasselbe gefunden.

**Warum:** `feedback_user_facing_toasts.md`. Die Datei ist als kritischer Pfad markiert (Security-Mutations).

**Fix:** Vor jeder `showToast`-Zeile: `console.error('handleRoleChange:', err)` etc.

**Effort:** S
**Memory/Regel:** `feedback_user_facing_toasts.md`

---

### [MEDIUM] B1-F-008 — P7: Kein UI-Hinweis dass mcp_get_workspace_context Inhalte an KI sendet

**File:** `packages/client-web/src/components/AiHelpDrawer.tsx:1-15`

**Was:** Der `AiHelpDrawer` erlaubt der KI, via `mcp_get_workspace_context` Workspace-Inhalte abzurufen — diese werden an die Anthropic-API gesendet. Es gibt keinen UI-Hinweis im Drawer selbst (anders als in `StepWelcome`).

**Warum:** CLAUDE.md P7: „Datenfluss ausschließlich zum **eigenen** Server." Im SaaS-Kontext mit Anthropic-API-Proxy gilt P7 in einer angepassten Form, aber Transparenz gegenüber dem User ist Teil des Prinzips.

**Fix:** Im Drawer-Header oder als einmalig anzeigende Infobox: „Deine Workspace-Inhalte können bei Tool-Aufrufen an deinen AI-Provider gesendet werden."

**Effort:** S
**Memory/Regel:** CLAUDE.md P7

---

### [MEDIUM] B1-F-009 — Schema-Vier-Artefakte: `docs`-Feature fehlt in feature-doc-Export-Pfad

**File:** `packages/client-web/src/lib/export.ts:53-118`

**Was:** Das neue `doc`-Feature in `CELL_FEATURES` (Phase 3 O.8.D) wird weder in `statsOf()` noch in `summarizeExport()` im Kontext der Cell-Features gezählt oder als Feature-Typ erklärt. Kein dedizierter `feature-doc`-Export-Pfad analog `feature-info`/`feature-checklists`.

**Warum:** checklisten.md „Strukturelle Änderung": „Neues Cell-Feature: prüfen ob ein eigener `feature-<name>`-Export/Import nötig ist."

**Fix:** Klären ob ein `feature-doc`-Export analog `feature-checklists` für Single-Cell-Exports benötigt wird.

**Effort:** M
**Memory/Regel:** `feedback_schema_quad.md`

---

### [MEDIUM] B1-F-010 — checklisten.md Trigger „Strukturelle Änderung": MCP-Tool-Trio für Object-Layer-Tabellen nicht vollständig prüfbar

**File:** `packages/client-web/src/lib/objects.ts`, `packages/bridge/src/tools/`

**Was:** `objects.ts` nutzt RPCs wie `mcp_create_object`, `mcp_update_object`, `mcp_delete_object`, `mcp_create_group` etc. checklisten.md fordert für jede strukturelle Änderung das Tool-Trio: Bridge-Schema + Client-Handler + Vitest. Bridge-Coverage konnte im Scope dieses Streams nicht verifiziert werden.

**Warum:** `feedback_schema_quad.md`. Stream G (CI/CD + Bridge) wird das genauer prüfen.

**Fix:** Bridge-Tool-Coverage für `objects`/`groups`/`soft_groups`-Tabellen verifizieren; fehlende Einträge in `tool-registry.test.ts` ergänzen.

**Effort:** M
**Memory/Regel:** `feedback_schema_quad.md`

---

### [MEDIUM] B1-F-011 — Settings-Suchindex nicht um Object-Layer-Seiten erweitert

**File:** `packages/client-web/src/lib/settings-search.ts:18-122`

**Was:** `SETTINGS_SEARCH_INDEX` kennt nur Settings-Routen. Die neuen Object-Layer-Routen (`/w/:wsId/objects`, `/w/:wsId/o/:objectId`) sind keine Settings-Tabs, also kein direktes Problem — aber Konsistenz prüfen.

**Warum:** checklisten.md Trigger „Settings/IA-Erweiterung denkbar".

**Fix:** Falls die Header-Suche auch non-Settings-Routen indexieren soll: eigenes Search-Konzept. Sonst Kommentar ergänzen.

**Effort:** S
**Memory/Regel:** checklisten.md

---

### [MEDIUM] B1-F-012 — ObjectDetail: ESC-Handler ohne Capture-Phase

**File:** `packages/client-web/src/routes/ObjectDetail.tsx:189-214`

**Was:** `document.addEventListener('keydown', onKey);` — Kein `true` als drittes Argument (Capture-Phase fehlt).

**Warum:** CLAUDE.md „Was NICHT tun": „Kein globales ESC ohne Capture-Kontrolle." Der Handler checkt zwar `dialogQueue().length > 0`, verlässt sich aber darauf.

**Fix:** `document.addEventListener('keydown', onKey, true)` und im Handler `e.stopImmediatePropagation()` nur wenn die Aktion ausgeführt wird.

**Effort:** S
**Memory/Regel:** CLAUDE.md „Was NICHT tun" (ESC)

---

### [LOW] B1-F-013 — `GroupMatrixGenerator`: Drei `catch`-Blöcke in createResource ohne `showToast`

**File:** `packages/client-web/src/components/GroupMatrixGenerator.tsx:80-111`

**Was:** `fetchGroups`, `fetchAllGroupMembers`, `fetchObjects` haben catch-Blöcke mit `console.error` aber ohne `showToast`.

**Warum:** CLAUDE.md P12: „Stille Misserfolge sind verboten."

**Fix:** Toast-Meldung hinzufügen.

**Effort:** S
**Memory/Regel:** CLAUDE.md P12

---

### [LOW] B1-F-014 — `ObjectDetail`: `allObjects`-Fetch scheitert ohne `showToast`

**File:** `packages/client-web/src/routes/ObjectDetail.tsx:97-103`

**Was:** Mehrere createResource-Fetches (fetchObjectBacklinks, fetchObjectChildren, fetchObjectGroups, fetchObjectTags) haben catch-Blöcke ohne `showToast`.

**Warum:** CLAUDE.md P12.

**Fix:** `showToast(translateDbError(err, 'Daten konnten nicht vollständig geladen werden.'), 'warning')`.

**Effort:** S
**Memory/Regel:** CLAUDE.md P12

---

### [INFO] B1-F-015 — WizardShell: `markOnboardingDone` Fehler wird stillschweigend verschluckt

**File:** `packages/client-web/src/components/wizard/WizardShell.tsx:97-105`

**Was:** Best-effort Catch-Block, kommentiert. Vertretbar, aber inkonsistent mit P12.

**Fix:** Optional: `showToast('Wizard-Abschluss konnte nicht gespeichert werden.', 'warning')`.

**Effort:** XS
**Memory/Regel:** CLAUDE.md P12

---

## Zusammenfassung Top-Prioritäten

| Prio | Finding | Datei | Effort |
|---|---|---|---|
| 1 | **B1-F-001** P12-CRITICAL: `wrap()` ohne `console.error` in BoardView + MatrixView | `BoardView.tsx:470`, `MatrixView.tsx:221` | S |
| 2 | **B1-F-002** P12-CRITICAL: System-weite weitere catch-Blöcke ohne `console.error` | 5+ Dateien | S |
| 3 | **B1-F-007** P12-HIGH: MembersList 5 catch-Blöcke ohne `console.error` | `MembersList.tsx:110-210` | S |
| 4 | **B1-F-003** P7/Export-HIGH: Object-Layer-Tabellen fehlen im Workspace-Export | `export.ts`, `subtree-import.ts` | L |
| 5 | **B1-F-004** P17-HIGH: Direktes `supabase.from().update()` in `ensureObjectFor` | `objects.ts:341-344` | M |
| 6 | **B1-F-005** P13-HIGH: `deleteNode`/`delCellRow` in `NewCellWizard` ohne Undo | `NewCellWizard.tsx:414,550-551` | M |
| 7 | **B1-F-006** P13-HIGH: `deleteObject` in `ObjectDetail` ohne Undo | `ObjectDetail.tsx:470` | M |

Die drei CRITICAL- und vier HIGH-Findings mit S/M-Effort sind sofort umsetzbar. **B1-F-003** (Export-Lücke) ist der einzige L-Effort und sollte als eigener Sprint geplant werden.
