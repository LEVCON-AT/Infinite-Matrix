# Backlog — Infinite Matrix

Nach Abschluss der Code-Review-Sprints (0–6, Branch `code-review-sprints` → `main`) sind die folgenden Aufgaben offen. Reihenfolge ist Priorität; jeder Punkt ist sprintfähig mit klarem Meilenstein.

---

## 1. Undo-/Redo-System vervollständigen

**Meilenstein**: `_undoStack` + `_redoStack` mit Shortcut-Anbindung und erweiterter Wire-Liste.

### Was schon da ist (Sprint 6.1)
- `_undoStack` (max 10 FIFO) via `getPayload()`-Snapshot
- `pushUndo(label)` · `_applyUndo(entry)` · `showUndoToast(label)` mit Action-Button
- Wired: `sbDelete`, `delRow`, `delCol`
- 10 s Toast-Lebensdauer, Klick auf „Rückgängig" restauriert

### Was fehlt
1. **Redo-Stack.** Nach Undo soll der soeben zurückgenommene Zustand auf einen `_redoStack` wandern. Redo = umgekehrter Apply. Stack leer geräumt bei neuer destruktiver Aktion.
2. **Keyboard-Shortcuts.** `Ctrl+Z` = Undo (nimmt den obersten Stack-Eintrag), `Ctrl+Shift+Z` / `Ctrl+Y` = Redo. In `DEFAULT_KEYBINDINGS` + `KB_ACTIONS` eintragen. `showKeyboardHelp()`-Tabelle ergänzen.
3. **Wire-Liste erweitern** (über die drei Sprint-6.1-Stellen hinaus):
   - `delKbCol`, `delKbCard` (Kanban-Spalten/Karten)
   - `delChecklist`, `delClItem`, `delClFromList` (Checklisten)
   - `delLink` (Links/Mailvorlagen)
   - `delInfoField` (Info-Felder)
   - `delDailyCol` (Daily-Board-Spalten)
   - `delGlobal` (Tags/Personen)
   - `removeFeature` (wenn das letzte Feature einer Zelle entfernt wird)
4. **Toast-Verbesserung.** Nach Undo-Klick kurz ein „Redo verfügbar (Ctrl+Shift+Z)"-Hinweis als Info-Toast, statt des aktuellen generischen Success-Toasts.
5. **Status-Anzeige** (optional). Kleines Indicator-Widget in der Topbar, das zeigt, wie viele Undo-/Redo-Schritte verfügbar sind. Nur einblenden wenn ≥1 verfügbar.

### Verifikation
- 20× destruktive Aktion → 10 Undo-Schritte erreichbar (MAX), älteste verdrängt.
- Undo → Redo → State identisch zum State direkt nach dem Delete.
- Nach Undo + neue Aktion → `_redoStack` leer.
- `Ctrl+Z` im Input-Feld → Browser-Native-Undo (nicht unser App-Undo). App-Undo nur wenn kein Text-Editable aktiv ist.

### Aufwand
1–2 Tage. Undo-Pattern ist schon da, Redo ist spiegelsymmetrisch.

---

## 2. Event-Delegation für `openCard` (Sprint 2.3 / 4.4 Folge)

**Hintergrund**: `_renderCardModalHTML` baut ~130 Zeilen Template-String mit ~100 inline `onchange`/`onclick`-Handlern. Bei jedem Re-Render wird alles neu aufgebaut.

**Fix**: Single Event-Delegate auf `.modal` mit `data-action`-Attributen. Handler-Map lokal.

**Gewinn**: Kleinere Re-Render-Kosten bei großen Datasets + Code-Lesbarkeit.

**Aufwand**: 1 Tag. Voraussetzung (Template-Split) ist durch Sprint 4.4 bereits erledigt.

---

## 3. Sprint 4.1 bis zum Plan-Ziel

**Stand**: Inline-Styles im Markup von 242 → 219 (partial). Plan-Ziel <30.

**Was fehlt**: Systematische Durchsicht aller Template-Strings in `openCard`, `renderKanban`, `renderInfoTab`, `renderSubMatrix`, `renderDailyBoard` etc. Pro Inline-Style eine dedizierte CSS-Klasse mit Custom-Property für den dynamischen Wert.

**Aufwand**: 2–3 Tage. Keine funktionalen Änderungen, nur Saubermachen.

---

## 4. Sprint 6.4 — Mobile-Gesten (nur wenn Mobile-Nutzung relevant)

- Swipe-Gesten für Sidebar-Open/Close (Touch-Event-Delegation).
- Alternative: `<meta>`-Hinweis „Desktop-optimiert".

**Aufwand**: 2 Tage. Abhängig davon, ob Mobile-Nutzung tatsächlich vorkommt.

---

## 5. SaaS-Roadmap (siehe separaten Plan)

Phase 0 Deploy → Phase 1 Bridge-Abstraktionen (Store-Adapter, Event-Bus, Integrations-Registry) → Phase 2 Mail/Webhook/iCal → Phase 3 Lizenz-Gate mit PocketBase + Stripe → Phase 4 Vite-Port → Phase 5 Accounts + Cloud-Sync → Phase 6 Yjs-Collaboration → Phase 7 Tauri-Desktop.

Die Review-Sprints (0–6) sind die Vorarbeit für Phase 0. Phase 1 baut auf den Konstanten/Tokens aus Sprint 1 auf.

---

## Kleinere lose Enden

- **Dark-Mode-Audit restlicher Stellen.** axe DevTools / Lighthouse-Accessibility-Lauf nach Merge.
- **Memory-Profil unter Last.** Heap-Snapshot vor/nach intensiver Nutzung — Sprint 0 hat Listener-Leaks adressiert, aber bestätigende Messung fehlt.
- **Performance-Profil mit 500+ Cells.** `sbRenderTree`-Zeit < 50 ms Ziel aus Sprint 2 verifizieren.
- **`renderSubMatrix` Empty-State** bei gelöschter Sub-Matrix — Link-Back zur Parent-Cell fehlt vermutlich.
