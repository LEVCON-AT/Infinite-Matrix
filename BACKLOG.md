# Backlog — Infinite Matrix

Nach Abschluss der Code-Review-Sprints (0–6, Branch `code-review-sprints` → `main`) sind die folgenden Aufgaben offen. Reihenfolge = Priorität. Nächste Arbeits-Welle: Punkte **1–3** (Code-Sauberkeit abschließen).

---

## 1. Event-Delegation für `openCard`

**Hintergrund**: `_renderCardModalHTML` baut ~130 Zeilen Template-String mit ~100 inline `onchange`/`onclick`-Handlern. Pro Re-Render werden alle Listener neu verdrahtet; Handler-Code wird als String ins HTML interpoliert (XSS-Oberfläche + schlechte Testbarkeit).

**Fix**: Single Delegate-Listener auf `.modal` mit `data-action`-Attribut + `data-*`-Payload. Handler-Map lokal:

```js
const CARD_ACTIONS = {
  set_name:  (el, {boardId,cardId}) => card_set(boardId, cardId, 'name', el.value),
  set_prio:  (el, {boardId,cardId}) => card_set(boardId, cardId, 'priority', el.value),
  close:     () => closeCard(),
  // …
};
container.addEventListener('input', dispatchAction);
container.addEventListener('click', dispatchAction);
```

**Gewinn**: 1 Listener statt 100 · kleinere Re-Render-Kosten bei großen Datasets · keine Code-Strings im Markup · sauberere Struktur für spätere Features (Redo, Keyboard-Navigation in Cards).

**Voraussetzung**: Template-Split (Sprint 4.4) — schon erledigt.

**Aufwand**: 1 Tag.

---

## 2. Inline-Styles auf Plan-Ziel bringen (Sprint 4.1 Abschluss)

**Stand**: 242 → 219 im Markup (partial). Plan-Ziel <30.

**Was fehlt**: Systematische Durchsicht der Template-Strings in `openCard`, `renderKanban`, `renderInfoTab`, `renderSubMatrix`, `renderDailyBoard` etc. Pro Inline-Style entweder:
- Statische Werte → dedizierte CSS-Klasse
- Dynamische Werte → CSS-Custom-Property per `style="--x:${v}"` + Klasse liest `var(--x)`

**Gewinn**: Theming greift überall, keine XSS-Oberfläche für user-abgeleitete Style-Werte, Dark-Mode-Kontraste brechen nicht mehr durch gepatchte Inline-Farben.

**Aufwand**: 2–3 Tage. Keine funktionalen Änderungen.

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
