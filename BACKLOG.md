# Backlog — Infinite Matrix

Nach Abschluss der Code-Review-Sprints (0–6, Branch `code-review-sprints` → `main`) sind die folgenden Aufgaben offen. Reihenfolge = Priorität.

**Status Code-Sauberkeits-Welle:** 1 ✅ (Event-Delegation, Commits `117b314`+`35fe38e`), 2 ✅ (Inline-Styles 219→32, Commits `c0c9388`…`49571a2`), 3 offen, 4–9 geplant.

---

## 1. Event-Delegation für `openCard` ✅ (erledigt)

Commits `117b314` (Implementation) + `35fe38e` (CLAUDE.md-Pattern). Card-Modal hat 0 inline `on(click|change|blur)` Handler; 25 benannte Aktionen in `CARD_ACTIONS`-Dispatch-Tabelle, 3 Listener (click im Capture, change/blur im Bubble/Capture) am Modal-Container. Drag + element-spezifische `onkeydown` bewusst inline belassen.

---

## 2. Inline-Styles auf Plan-Ziel bringen ✅ (erledigt)

**Stand**: 219 → 32 (Plan-Ziel „< 30" praktisch erreicht; verbliebene 32 sind alle dynamische Werte wie `grid-template-columns:${gc}`, `left/top:${e.clientX}`, `--kb-col-color`, `--card-lines`, `--sd-color`, `--pc-color` sowie konfigurierbare Em-Werte `padding:${_cp}em`).

**Commits**:
- `c0c9388` 2a Card-Modal + Recurrence-UI (−56)
- `30d3190` 2b Std-Checkliste + Daily-Column (−27)
- `5fea780` 2c Settings-Modal (−20)
- `a0f27ab` 2d Matrix-Page + Cell-Grid (−8)
- `95b779e` 2e Info/Links + Kanban-Cards (−32)
- `49571a2` 2f Peek/Context-Menu/Modals/Search/Prio-Dot/Search-HL (−44)

**Eingeführte Pattern** (für Backlog-3+ als Referenz):
- Feature-Farben über `[data-feat="matrix|board|info|checklists"]` (Cell-Segments, Peek-Badges, Priority-Badges im _featTitle)
- Farb-Keys aus `var(--X)` via `_srColKey()` → `[data-sr-col="blue|teal|amber|purple|text2|text3"]` (Search-Row-Icons)
- Dynamische Farben über CSS-Custom-Properties: `--kb-col-color`, `--pc-color`, `--sd-color`, `--card-lines`, `--cg-gap`
- Neue Utility-Klassen: `.row-g4/6/8`, `.col-g6`, `.mb-xs/sm/md/0`, `.mg-0`, `.mr-auto`, `.mt-8/10`, `.nowrap`, `.inp-num-sm/md/lg/count`, `.inp-flex-date`, `.modal-title-input`, `.modal-note-ce`, `.modal-pill[data-prio]`, `.pill-dashed`, `.cb-option(-8)`, `.wd-chip(.sel)`, `.cl-row/arrow/del/reset/text-input`, `.occ-info/more/count`, `.btn-small/done-active`, `.alias-ro(-cell)`, `.ptitle-edit-input`, `.phd-actions`, `.empty-actions`, `.ni.ni-md/ni-center`, `.feat-remove`, `.cellhd-alias`, `.tab-edit-input`, `.kb-toolbar/nocol-hint/palette-btn`, `.kb-col[data-color=set]`, `.kb-col-dot`, `.kb-cards[data-scrollable]`, `.kb-card-compact/row`, `.kb-archive-name`, `.kc-note/act-spacer/done-badge`, `.cl-check-sm`, `.kc-recur[data-warn]`, `.setting-row/label/value/input(.num,.num-dual)/section/pw-*`, `.settings-modal/hd/tabs/tab(.active)/body/actions/intro/grid2/cell/cell-label/cell-select`, `.ro-input`, `.info-empty/field-hd/arrow-stack/arrow/del`, `.link-btn.link-mail`, `.link-alias/action-edit/del`, `.dtitle-ico`, `.addcol-btn/tail/tail-btn`, `.dcolh-*`, `.delbtn-dcol`, `.daily-empty`, `.di-check/name-wrap/overdue-text/recur-badge`, `.peek-grid-cell[data-fill]`, `.peek-feat-badge[data-feat]`, `.pc-dot[data-col=set]`, `.peek-empty/sub-offset`, `.help-title/body-2/note/foot`, `.sr-name.faint`, `.sr-cmd-mark`, `.sd-section-hd`, `.sd-dot[data-col=set]`, `.sd-del/tail`, `.ctx-divider/btn-ico`, `.smodal-420`, `.smodal-720(-hd/body/act/reset)`, `.kb-section-hint`, `.mail-body-ta`, `.freq-toolbar/scroll-wrap/board-link`, `.alias-tag-mr4/6`, `.origin-alias-mr6`, `.prio-badge-wrap/ico[data-feat]`, `.prio-dot[data-prio]`, `.search-hl`, `.err-detail`, `.empty-hint`

---

## 3. Mobile-Gesten (Sprint 6.4 — nur wenn Mobile-Nutzung real wird)

- Swipe-Gesture für Sidebar-Open/Close (Touch-Event-Delegation — passt zu Punkt 1).
- Long-Press für Kontextmenü auf Sidebar-Zeilen (statt `+`).
- Alternative, wenn Mobile kein Ziel ist: `<meta name="description">` + Hint-Overlay „Desktop-optimiert, für Mobile eingeschränkte Funktionen".

**Aufwand**: 2 Tage. Wenn nicht priorisiert → Hint-Overlay als Kompromiss (1 h).

---

## 4. Visual Templates — Matrix-Vorlagen

**Was**: Vorgefertigte Matrix-Strukturen, die der User mit einem Klick als neue Sub-Matrix oder Root-Matrix instanziieren kann.

**Ideen für den ersten Satz**:
- **Projekt-Planung** (3×4): Rows = Meilensteine, Cols = Phasen (Plan/Do/Review/Done), Cells enthalten Kanban-Boards
- **GTD / Wochenplan** (5×3): Tages-Rows × Kontexte-Cols mit Checklisten
- **Lebens-Layout** (4×3): Bereiche (Arbeit/Privat/Gesundheit/Lernen) × Zeithorizonte (Kurzfristig/Mittel/Langfristig) mit Sub-Matrizen
- **Decision-Matrix** (N×2): Optionen × Kriterien, Cells mit Info-Text + Rating
- **Reading-List** (3×1): Backlog/Reading/Done mit Info (Buchtitel + Notiz)

**Technisch**:
- `const TEMPLATES = { projektplan: {rows:[...], cols:[...], cells:{...}, features:[...]}, ... }`
- Neuer Gear-Menu-Eintrag „Vorlage einfügen" → Modal mit Template-Preview + „Hier einfügen" (an aktuelle Stack-Position)
- Import/Export von User-eigenen Templates als `.imx`-Fragment (nutzt bestehende JSON-Export-Pipeline)

**Aufwand**: 3 Tage.

---

## 5. Block-Placing — Drag-and-Drop zwischen Strukturen

**Was**: Ganze Zellen, Rows, Cols oder Sub-Matrizen per Drag in andere Matrizen bzw. Positionen verschieben. Heute ist das Kanban-intern schon möglich; das hier ist die Matrix-Ebene.

**Scope-Vorschlag**:
- Drag einer Cell zwischen zwei Matrizen desselben Elterns (Swap-Position)
- Drag einer Row/Col an andere Position (Reorder) — dafür gibt's ↑↓-Buttons schon, aber DnD ist intuitiver
- Drag einer Sub-Matrix in eine andere Cell als Target (Move oder Copy via Modifier)
- Visuelle Drop-Targets mit Highlight + Insertion-Marker
- Respect der Sidebar-Tree-Parentschaft (kein Zirkular-Move)

**Abhängigkeit**: Saubere DataId-Parser (Sprint 4.3 erledigt), Parent-Map (`sbParentMap`) schon da.

**Aufwand**: 3–4 Tage. Größter Block ist die UX für gültige/ungültige Drop-Targets.

---

## 6. Workspace- & Feature-Enrichment

**Was**: Über die vier aktuellen Cell-Features (Info/Board/Checklist/Matrix) hinaus neue Bausteine und Workspace-Sichten, die den persönlichen Organisations-Scope erweitern, ohne den Matrix-Kern zu brechen.

**Neue Cell-Features (Vorschlag, einzeln instanziierbar)**:
- **Timeline/Gantt** — Start/End-Dates auf einer Zeitachse, nutzbar für Meilenstein-Matrizen
- **Tabelle** (N-Spalten-Frei-Tabelle mit Typen) — für strukturierte Daten, die keine Kanban-Karten sind
- **Embedded-Link-Gallery** — URL-Liste mit Preview-Cards (Titel, Favicon, Snippet)
- **Reference** — Alias-Reference zu einer anderen Zelle (Live-Spiegel mit `^alias`-Resolve)
- **Formula** — kleine Mini-Ausdrücke (Summe, Count, Fortschritt) über Daten-in-Matrix

**Workspace-Views** (aggregiert über alle Boards):
- **Today** — alle Cards mit Deadline heute, sortiert nach Priorität
- **Overdue** — alle überfälligen Cards
- **Assigned to me** — Filter auf `who`-Feld über alle Boards
- **Recently modified** — Audit-Trail der letzten N Mutationen

**Technisch**:
- `CELL_FEATURES`-Liste um neue Keys erweitern
- Pro Feature: `render*Tab()`, CSS-Farbe, Sidebar-Icon, Persistenz-Schema
- Workspace-Views als eigene Top-Level-„Virtual Matrix" (stack-level), die ihre Daten aus `nodes` live aggregiert — kein eigener Storage

**Aufwand**: 1–2 Wochen für den Satz; einzelne Features sind ~1–2 Tage.

---

## 7. Collaboration (Yjs / CRDT Real-Time Co-Editing)

**Was**: Mehrere User arbeiten gleichzeitig auf derselben Matrix-Struktur. Änderungen sind konflikt-tolerant (Yjs-CRDT), ohne zentralen Lock.

**Phasen**:
1. **Local-First-Yjs-Einführung**: `nodes`/`currentTab`/`stack` in Yjs-Docs migrieren, alle Mutationen gehen über `Y.Map.set()` / `Y.Array.push()`. Kein Netzwerk, nur Daten-Layer-Swap.
2. **WebRTC-Provider für Peer-to-Peer**: Zwei Browser über Signaling-Server syncen live.
3. **WebSocket-Provider mit y-websocket-Server**: Robuster Multi-User-Sync über zentralen Hub (später Teil der SaaS-Plattform).
4. **Awareness**: Cursors, aktive-User-Liste, selektierte Cells pro User (Sidebar-Dot-Variante).
5. **Offline-Merge**: Client-Edits im IndexedDB cachen, beim Re-Connect mergen.

**Abhängigkeit**: SaaS-Roadmap Phase 4 (Vite-Port) ist Voraussetzung — Yjs läuft schlecht als Inline-Script ohne Module-System.

**Aufwand**: 1–2 Wochen Phase 1 (Daten-Layer-Swap). Rest parallel zur SaaS-Roadmap.

---

## 8. SaaS-Roadmap (separater Plan)

Phase 0 VPS-Deploy → Phase 1 Bridge-Abstraktionen (Store-Adapter, Event-Bus, Integrations-Registry) → Phase 2 Mail/Webhook/iCal → Phase 3 Lizenz-Gate mit PocketBase + Stripe → Phase 4 Vite-Port + SQLite-WASM → Phase 5 Accounts + Cloud-Sync → Phase 6 Yjs-Collaboration (↔ Punkt 7) → Phase 7 Tauri-Desktop.

Die Review-Sprints (0–6) sind die Vorarbeit für Phase 0. Phase 1 baut auf den Konstanten/Tokens aus Sprint 1 auf.

---

## 9. Undo-/Redo-System vervollständigen

**Meilenstein**: `_undoStack` + `_redoStack` mit Shortcut-Anbindung und erweiterter Wire-Liste.

### Was schon da ist (Sprint 6.1)
- `_undoStack` (max 10 FIFO) via `getPayload()`-Snapshot
- `pushUndo(label)` · `_applyUndo(entry)` · `showUndoToast(label)` mit Action-Button
- Wired: `sbDelete`, `delRow`, `delCol`
- 10 s Toast-Lebensdauer, Klick auf „Rückgängig" restauriert

### Was fehlt
1. **Redo-Stack.** Nach Undo wandert der zurückgenommene Zustand auf `_redoStack`. Redo = umgekehrter Apply. Stack leer geräumt bei neuer destruktiver Aktion.
2. **Keyboard-Shortcuts.** `Ctrl+Z` = Undo, `Ctrl+Shift+Z` / `Ctrl+Y` = Redo. In `DEFAULT_KEYBINDINGS` + `KB_ACTIONS` eintragen. `showKeyboardHelp()`-Tabelle ergänzen.
3. **Wire-Liste erweitern**:
   - `delKbCol`, `delKbCard` (Kanban)
   - `delChecklist`, `delClItem`, `delClFromList` (Checklisten)
   - `delLink` (Links/Mailvorlagen)
   - `delInfoField` (Info-Felder)
   - `delDailyCol` (Daily)
   - `delGlobal` (Tags/Personen)
   - `removeFeature` (letztes Feature einer Zelle)
4. **Toast-Verbesserung.** Nach Undo-Klick Info-Toast „Redo verfügbar (Ctrl+Shift+Z)" statt generischem Success-Toast.
5. **Status-Anzeige** (optional). Topbar-Indicator für verfügbare Undo-/Redo-Schritte.

### Verifikation
- 20× destruktive Aktion → 10 Undo-Schritte erreichbar (MAX), älteste verdrängt.
- Undo → Redo → State identisch zum State direkt nach dem Delete.
- Nach Undo + neue Aktion → `_redoStack` leer.
- `Ctrl+Z` in Input-Feldern → Browser-Native-Undo. App-Undo nur wenn kein `contenteditable`/`input` fokussiert.

**Aufwand**: 1–2 Tage. Pattern ist vorhanden, Redo ist spiegelsymmetrisch.

**Nach-hinten-Begründung**: Das aktuelle Undo deckt die Hauptverlust-Risiken ab (Zelle/Zeile/Spalte löschen). Die Wire-Erweiterung + Redo sind Polish, kein Blocker.

---

## Kleinere lose Enden

- **Dark-Mode-Audit restlicher Stellen.** axe DevTools / Lighthouse-Accessibility-Lauf nach Merge.
- **Memory-Profil unter Last.** Heap-Snapshot vor/nach intensiver Nutzung — Sprint 0 hat Listener-Leaks adressiert, bestätigende Messung fehlt.
- **Performance-Profil mit 500+ Cells.** `sbRenderTree`-Zeit < 50 ms Ziel aus Sprint 2 verifizieren.
- **`renderSubMatrix` Empty-State** bei gelöschter Sub-Matrix — Link-Back zur Parent-Cell fehlt vermutlich.
