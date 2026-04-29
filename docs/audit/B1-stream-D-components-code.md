# AU-B1 / Stream D — Components Code-Review

**Datum:** 2026-04-29
**Scope:** ~22 Components, davon 16 neu, 6 stark veraendert (~5500 LOC)
**Methode:** Code-Reviewer-Agent, Pruefung gegen SolidJS-Patterns, Modal-Hygiene, Resource-Cleanup, Animation-Konformitaet, Token-Verwendung.

---

## Bewertungs-Übersicht

| Severity | Count |
|---|---:|
| CRITICAL | 2 |
| HIGH | 5 |
| MEDIUM | 5 |
| LOW | 2 |
| INFO | 1 |

---

## Cross-Cutting-Beobachtungen

Modal-Hygiene ist in den "neuen" Modals (NewCellWizard, BulkAddModal, GroupMatrixGenerator, WizardShell) konsistent und korrekt umgesetzt (installFocusRestore + installFocusTrap + ESC in Capture-Phase). Die wichtigsten Regelabweichungen konzentrieren sich auf AiProviderEditModal (kein FocusTrap) und AiHelpDrawer (kein ESC-Capture, potentieller restoreFocus-Double-Call). NodeTree enthaelt zwei direkte `supabase.from()`-Calls im Card-Drag-Drop-Handler, die dem Review-Stop-Kriterium aus CLAUDE.md entsprechen. Die Message-Render-Loop in AiHelpDrawer hat ein strukturelles Problem das zu stale Closures uber Nachrichten-Iterationen fuehren kann.

---

## Findings

### [CRITICAL] B1-D-001 — NodeTree.tsx: direkte `supabase.from()` ohne Wrapper im Card-Drop-Handler

**File:** `packages/client-web/src/components/NodeTree.tsx:1003-1025`
**Was:** `onCardDrop()` fuehrt zwei rohe `supabase.from('kb_cols')` und `supabase.from('kb_cards')` Queries direkt aus, ohne safe-mutation-Wrapper oder privaten gewrappten Helper.
**Warum:** CLAUDE.md "Was NICHT tun" definiert direkte `supabase.from(...).insert/update/delete()` ohne Wrapper als "Review-Stop, analog zu `alert()`-Aufrufen". Gilt analog fuer lesende Queries im schreibenden Kontext (Position-Lookup vor `moveCardToBoard`). Kein Offline-Cache-Fallback, kein `runOptimisticUpdate`. Fehler bricht lautlos (kein `isNetworkError`-Branch, kein `markCacheFallback()`).
**Fix:** Einen privaten Helper `fetchFirstColOfBoard(boardId, workspaceId)` in `lib/queries.ts` auslagern, der den IDB-Cache-Fallback umsetzt (Pattern: live fetch → `mergeRows`, bei `isNetworkError` → `getById`). `onCardDrop` nutzt diesen Helper statt direktem supabase-Call.
**Effort:** M
**Memory/Regel:** CLAUDE.md Arbeitsprinzip 17 + "Keine neue `client-web`-Mutation ohne Offline-Pfad."

---

### [CRITICAL] B1-D-002 — AiHelpDrawer.tsx: stale closure beim Conversation-History-Aufbau

**File:** `packages/client-web/src/components/AiHelpDrawer.tsx:179-183`
**Was:** `send()` liest `messages()` am Anfang der Funktion, baut daraus `conversation`. Dann appended `setMessages((prev) => [...prev, { kind: 'user', text }])` die neue User-Message. Der `conversation`-Array enthaelt die User-Message bereits — er wird aber vor dem `setMessages`-Call gebaut (Zeile 158: `setMessages(...)` kommt vor Zeile 179 `for (const m of messages())`). Konkret: `messages()` wird zweimal gelesen — einmal bei Zeile 158 (dort ist die neue Message schon im Signal), dann nochmal in der Loop Zeile 180.
**Warum:** In SolidJS werden Signal-Reads in `async`-Funktionen ausserhalb von `createEffect`/`createMemo` nicht getrackt. Aber das `setMessages` auf Zeile 158 schreibt synchron, und die nachfolgende `for (const m of messages())` auf Zeile 180 liest den aktualisierten Wert. Die neue User-Message ist also bereits in `messages()` und wird nochmal in `conversation` geschrieben. Ergebnis: die LLM-API bekommt die letzte User-Message doppelt, was zu falschen Antworten fuehren kann.
**Fix:** `conversation` aus dem Snapshot aufbauen, der **vor** `setMessages` gelesen wird: `const prevMessages = messages();` vor `setMessages(...)` (Zeile 158), dann `for (const m of prevMessages) {...}`.
**Effort:** S
**Memory/Regel:** SolidJS Signal-Semantik; `send()` ist eine async-Funktion.

---

### [HIGH] B1-D-003 — AiProviderEditModal.tsx: kein `installFocusTrap`

**File:** `packages/client-web/src/components/AiProviderEditModal.tsx:56-66`
**Was:** `onMount` ruft nur `installFocusRestore()`, kein `installFocusTrap(containerEl)`. Das Modal-Div hat kein `ref` fuer den Trap.
**Warum:** CLAUDE.md Regel 15: "Modal oeffnen: `installFocusTrap` + `installFocusRestore`." Ohne Focus-Trap kann Tab-Fokus aus dem offenen Modal herauswandern in den Seiten-Hintergrund. Sensibles Formular (API-Key), bei dem Fokus-Leak besonders problematisch ist.
**Fix:** `let containerEl: HTMLDivElement | undefined;` einfuehren, `ref={(el) => { containerEl = el; }}` auf dem Modal-Div, in `onMount`: `if (containerEl) onCleanup(installFocusTrap(containerEl));`
**Effort:** S
**Memory/Regel:** CLAUDE.md Arbeitsprinzip 15.

---

### [HIGH] B1-D-004 — AiHelpDrawer.tsx: kein ESC-Capture und potentieller doppelter restoreFocus-Call

**File:** `packages/client-web/src/components/AiHelpDrawer.tsx:128-144`
**Was:** Zwei Probleme kombiniert: (1) Der Drawer hat keinen globalen ESC-Handler in Capture-Phase. Der Drawer schliesst sich nur ueber den X-Button oder `closeDrawer()` — ESC-Key wird nicht abgefangen, und wenn ein anderer ESC-Handler auf der Seite aktiv ist (z.B. Matrix-Navigation), wird `closeDrawer()` nie durch ESC ausgeloest. (2) Der `restoreFocus`-Cleanup-Callback kann doppelt gefeuert werden: der `createEffect` feuert beim Schliessen `restoreFocus?.()` (Zeile 135), und zusaetzlich der `onCleanup` in `onMount` feuert `restoreFocus?.()` beim Component-Unmount (Zeile 142). Wenn der Drawer schliesst (effect), dann das Component unmountet (cleanup), wird `restoreFocus` zweimal aufgerufen.
**Warum:** CLAUDE.md "Kein globales ESC ohne Capture-Kontrolle. Overlays, die ESC verarbeiten wollen, muessen in Capture-Phase + `stopImmediatePropagation`." Auch: Regel 15 Focus-Restore bei Modals.
**Fix:** (1) ESC-Handler in Capture-Phase im `createEffect` registrieren, wenn `open()`. Bei Drawer-Close den Handler entfernen. (2) `restoreFocus = null` nach dem ersten Call in der `else`-Branch setzen (was bereits passiert), und im `onCleanup` nur aufrufen wenn `restoreFocus !== null`.
**Effort:** M
**Memory/Regel:** CLAUDE.md "Was NICHT tun: Kein globales ESC ohne Capture-Kontrolle" + Arbeitsprinzip 15.

---

### [HIGH] B1-D-005 — AiHelpDrawer.tsx: Double-For-Loop fuer messages-Rendering ist O(2n) und bricht Rendering-Reihenfolge

**File:** `packages/client-web/src/components/AiHelpDrawer.tsx:352-394`
**Was:** Nachrichten werden in zwei separaten `<For each={messages()}>` Schleifen gerendert — eine fuer `kind === 'user'`, eine fuer `kind === 'assistant'`. Beide iterieren ueber die gesamte `messages()`-Liste.
**Warum:** Alle User-Messages werden DOM-seitig zuerst gerendert, dann alle Assistant-Messages — unabhaengig von der tatsaechlichen Reihenfolge in `messages()`. Das Chat-Interface zeigt also erst alle User-Nachrichten, dann alle Antworten, statt der richtigen alternierenden Konversations-Reihenfolge. Das ist ein funktionaler Bug: ein Gespraech mit 3 Fragen/3 Antworten zeigt im DOM "Frage1, Frage2, Frage3, Antwort1, Antwort2, Antwort3" statt des erwarteten abwechselnden Musters.
**Fix:** Eine einzige `<For each={messages()}>` Schleife mit `<Switch>`/`<Match>` (oder einem `<Show when={m.kind === 'user'}>` + `<Show when={m.kind === 'assistant'}>` innerhalb derselben Iteration) ersetzen die zwei Loops.
**Effort:** S
**Memory/Regel:** SolidJS-Rendering-Korrektheit; Chat-Semantik.

---

### [HIGH] B1-D-006 — GroupMatrixGenerator.tsx: `setTimeout(150)` in `onPickerBlur` ohne `onCleanup`

**File:** `packages/client-web/src/components/GroupMatrixGenerator.tsx:329-333`
**Was:** `onPickerBlur` startet einen `setTimeout(() => { if (objectSuggestState().open) return; setPickerKind(null); }, 150)` ohne den Timer-Handle zu speichern oder via `onCleanup` aufzuraeumen.
**Warum:** Wenn das Modal waehrend des 150ms-Timeouts schliesst (z.B. durch schnelles ESC nach Blur), feuert der Callback nach dem Unmount und ruft `setPickerKind(null)` auf einem bereits ungemounteten Signal. In SolidJS fuehrt das nicht zu einem Crash, aber es kann Zustandsmutationen auf bereits entsorgten Komponenten ausloesen und erzeugt schwer reproduzierbare Bugs bei schnellem Oeffnen/Schliessen. Hinzu kommt: CLAUDE.md Regel 16 "Keine `setTimeout`-Animationen" — zwar ist das keine Animation, aber das Muster ist explizit unerwuenscht.
**Fix:** Timer-Handle speichern (`let blurTimer: ReturnType<typeof setTimeout> | undefined`), in `onCleanup(() => clearTimeout(blurTimer))` raeumen. Alternativ `queueMicrotask` statt `setTimeout(150)` verwenden.
**Effort:** S
**Memory/Regel:** CLAUDE.md Arbeitsprinzip 16; SolidJS onCleanup-Pattern.

---

### [HIGH] B1-D-007 — MatrixView.tsx: Hotkey-Konflikt zwischen Matrix-Zell-Navigation (1/2/3/4/d) und globalen Hotkeys

**File:** `packages/client-web/src/components/MatrixView.tsx:517-599`
**Was:** Der globale `keydown`-Handler in `onMount` greift auf `1`, `2`, `3`, `4` und `d`/`D` wenn die aktive Klasse `.mx-cell` hat. NewCellWizard registriert ebenfalls einen globalen Capture-Handler (`document.addEventListener('keydown', dispatchKey, true)`) der dieselben Keys (1/2/3/4/d) auf den Feature-Picker mappt.
**Warum:** Beide Handler laufen auf `document`-Level. Der MatrixView-Handler ist in Bubble-Phase, der NewCellWizard-Handler in Capture-Phase. Wenn der Wizard offen ist und der Fokus auf einer `.mx-cell` liegt, wuerden beide Handler feuern. Kritischer: nach `doCommit` + `p.onClose()` wird der Wizard unmounted und sein Handler entfernt, aber wenn `onCreated` den Fokus auf die neu angelegte Zelle setzt, kann der Matrix-Handler noch ein `4`/`d` fangen das eigentlich fuer den Wizard gedacht war.
**Fix:** Im NewCellWizard-Capture-Handler: pruefe ob `step().kind === 'commit'` und return early (busy-Check allein reicht nicht — der Step wechselt synchron vor dem await). Oder: Nach `doCommit` den globalen Handler explizit entfernen bevor `p.onClose()` aufgerufen wird.
**Effort:** S
**Memory/Regel:** CLAUDE.md "Was NICHT tun: Kein globales ESC ohne Capture-Kontrolle" — analoges Pattern fur Feature-Hotkeys.

---

### [MEDIUM] B1-D-008 — AiHelpDrawer.tsx: `Show when={m.kind === 'user'}` ohne Callback-Form bei Type-Assertion

**File:** `packages/client-web/src/components/AiHelpDrawer.tsx:353-357`
**Was:** `<Show when={m.kind === 'user'}><div ...>{(m as { text: string }).text}</div></Show>` — der boolean-Test in `when` narrowt den Typ nicht, deshalb die `as`-Assertion. Gleiches Muster bei `kind === 'assistant'`.
**Warum:** Memory `feedback_solid_show_callback.md`: `<Show when={x}>{(v) => ...}</Show>` callback-form narrowt den Typ. Statt `m as {...}` sollte das narrowing explizit sein. Aktuell erzeugt die Assertion zwar keinen Laufzeitfehler, aber wenn ein drittes `kind` (`'system'`) in `ChatMessage` existiert und versehentlich mit `kind === 'user'` matcht, wuerde die unsichere Cast-Assertion crashen.
**Fix:** Callback-Form nutzen: `<Show when={m.kind === 'user' ? m : null}>{(msg) => <div ...>{msg().text}</div>}</Show>`.
**Effort:** S
**Memory/Regel:** Memory `feedback_solid_show_callback.md`.

---

### [MEDIUM] B1-D-009 — WizardShell.tsx: kein `installFocusTrap` trotz `cardRef`

**File:** `packages/client-web/src/components/wizard/WizardShell.tsx:51-65`
**Was:** `cardRef` wird als `let cardRef: HTMLDivElement | undefined` deklariert und dem `.overlay-card`-Div zugewiesen, aber in `onMount` wird kein `installFocusTrap(cardRef)` aufgerufen — nur `installFocusRestore()`.
**Warum:** CLAUDE.md Regel 15: "Modal oeffnen: `installFocusTrap` + `installFocusRestore`." Der Wizard ist ein fullscreen-Modal das Tab-Fokus auf seine Steps beschraenken muss. Ohne Trap kann Tab aus dem Wizard in den Hintergrund wandern.
**Fix:** In `onMount`: `if (cardRef) onCleanup(installFocusTrap(cardRef));` nach `onCleanup(installFocusRestore())`.
**Effort:** S
**Memory/Regel:** CLAUDE.md Arbeitsprinzip 15.

---

### [MEDIUM] B1-D-010 — NodeTree.tsx: `drawConnections()` in `createEffect` ohne `onCleanup` fuer `requestAnimationFrame`

**File:** `packages/client-web/src/components/NodeTree.tsx:1089-1099`
**Was:** `createEffect(() => { ...; requestAnimationFrame(() => drawConnections()); })` — der RAF-Handle wird nicht gespeichert und beim Component-Unmount nicht gecancelt via `cancelAnimationFrame`.
**Warum:** Wenn NodeTree unmountet (z.B. Workspace-Wechsel) und ein RAF noch pending ist, feuert `drawConnections()` nach dem Unmount und greift auf `scrollRef` / `svgRef` zu, die dann `undefined` sein koennen. `drawConnections` hat zwar Guards (`if (!scrollRef || !svgRef) return`) — aber das verhindert den Aufruf selbst nicht. Bei schnellem Workspace-Wechsel koennen mehrere RAF-Frames aus dem alten Tree in den neuen Tree einschlagen und Layout-Queries auf dem alten DOM ausfuehren.
**Fix:** `let rafHandle: number | undefined;` speichern, `rafHandle = requestAnimationFrame(...)`, `onCleanup(() => { if (rafHandle) cancelAnimationFrame(rafHandle); })` in `onMount`.
**Effort:** S
**Memory/Regel:** CLAUDE.md Arbeitsprinzip 16; SolidJS Cleanup-Pattern.

---

### [MEDIUM] B1-D-011 — NewCellWizard.tsx: `step().kind === 'name' && currentNameDef()` als doppelter Body mit redundantem null-Guard

**File:** `packages/client-web/src/components/NewCellWizard.tsx:824-888`
**Was:** `<Show when={step().kind === 'name' && currentNameDef()}>` und dann im Callback `const def = currentNameDef(); if (!def) return null;` — der innere null-Guard ist redundant. Dazu gibt es einen zweiten separaten `<Show when={step().kind === 'name'}>` Block fuer den Footer (Zeile 889-928).
**Warum:** Nicht die callback-form verwendet, was `currentNameDef()` direkt als non-null liefern wuerde. Zwei `Show`-Bloecke mit gleicher Bedingung erfordern doppelte reaktive Auswertung und koennen auseinanderlaufen wenn sich der Zustand zwischen den Renders aendert.
**Fix:** Beide `Show`-Bloecke in einen einzigen `<Show when={step().kind === 'name' && currentNameDef()}>` zusammenfassen mit Callback-Form.
**Effort:** M
**Memory/Regel:** Memory `feedback_solid_show_callback.md`.

---

### [MEDIUM] B1-D-012 — GroupMatrixGenerator.tsx: `submit()` ohne `void` bei Button-onClick

**File:** `packages/client-web/src/components/GroupMatrixGenerator.tsx:647`
**Was:** `onClick={submit}` direkt ohne `() => void submit()`. `submit` ist eine `async function` — der Return-Value (Promise) wird an den Browser-Event-Handler uebergeben.
**Warum:** Browser ignoriert Promise-Rueckgaben von Event-Handlern zwar, aber unhandled-Promise-Rejections werden nicht gecaught, wenn der Browser den unhandled-rejection-Event feuert. Konsistenzwidrig zum Rest des Codebases.
**Fix:** `onClick={() => void submit()}` statt `onClick={submit}`.
**Effort:** S
**Memory/Regel:** Konsistenz mit restlichem Codebase; SolidJS Event-Handler-Pattern.

---

### [LOW] B1-D-013 — AiHelpDrawer.tsx: `ITER_CAP_HELP = 10` als Magic-Number ohne Token

**File:** `packages/client-web/src/components/AiHelpDrawer.tsx:75`
**Was:** `const ITER_CAP_HELP = 10;` ist ein lokales Constant das den Wert aus `lib/ai-assist/index.ts` (dort `ITER_CAP`) dupliziert. Beide koennen auseinanderlaufen.
**Warum:** CLAUDE.md Regel 14: "Tokens vor Literals." Single-Source-of-Truth-Verletzung.
**Fix:** `ITER_CAP` aus `lib/ai-assist` exportieren und in `AiHelpDrawer` importieren, statt es lokal zu duplizieren.
**Effort:** S
**Memory/Regel:** CLAUDE.md Arbeitsprinzip 14.

---

### [LOW] B1-D-014 — ObjectSuggestion.tsx: Magic-Number `z-index: 10000` inline ohne Token

**File:** `packages/client-web/src/components/ObjectSuggestion.tsx:42`
**Was:** `'z-index': '10000'` als Inline-Style-Literal.
**Warum:** CLAUDE.md Regel 14: bei Werten die mehrfach vorkommen sollte ein CSS-Token existieren.
**Fix:** Pruefen ob `:root { --z-popup: 10000; }` im Projekt-CSS existiert; wenn nicht, als Token anlegen.
**Effort:** S
**Memory/Regel:** CLAUDE.md Arbeitsprinzip 14.

---

### [INFO] B1-D-015 — AiHelpDrawer.tsx: Auto-scroll-Effect liest 3 Signals als void-Statements

**File:** `packages/client-web/src/components/AiHelpDrawer.tsx:117-125`
**Was:** `void messages(); void streamingText(); void activeTools();` — drei separate void-Reads um Dependency-Tracking in einem `createEffect` zu erzwingen.
**Warum:** Kein Bug, aber `void`-Reads sind von Biome flagbar und koennen kuenftige Linter-Konfigurationen brechen.
**Fix (optional):** `const _scrollDep = [messages(), streamingText(), activeTools()].length;` — oder die drei Signale in einem `createMemo` kombinieren.
**Effort:** S
**Memory/Regel:** SolidJS-Pattern-Konsistenz; keine Regel-Verletzung.

---

## Zusammenfassung Top-Prioritäten

| Prio | ID | Severity | Effort | Kurztitel |
|---|---|---|---|---|
| 1 | B1-D-001 | CRITICAL | M | NodeTree direkte supabase.from()-Calls ohne Wrapper |
| 2 | B1-D-002 | CRITICAL | S | AiHelpDrawer stale closure — User-Message doppelt in Conversation |
| 3 | B1-D-005 | HIGH | S | AiHelpDrawer Double-For-Loop bricht Chat-Reihenfolge |
| 4 | B1-D-003 | HIGH | S | AiProviderEditModal kein installFocusTrap |
| 5 | B1-D-009 | HIGH | S | WizardShell kein installFocusTrap trotz cardRef |
| 6 | B1-D-004 | HIGH | M | AiHelpDrawer kein ESC-Capture + potentieller doppelter restoreFocus |
| 7 | B1-D-007 | HIGH | S | MatrixView / NewCellWizard Hotkey-Timing-Konflikt nach Commit |
| 8 | B1-D-006 | HIGH | S | GroupMatrixGenerator setTimeout ohne onCleanup |
| 9 | B1-D-010 | MEDIUM | S | NodeTree requestAnimationFrame ohne cancelAnimationFrame-Cleanup |
| 10 | B1-D-011 | MEDIUM | M | NewCellWizard doppelter Show-Block + redundanter null-Guard |
