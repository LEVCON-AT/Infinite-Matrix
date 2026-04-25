# AU-A4 — Style-Konvention-Audit

**Datum:** 2026-04-25
**Scope:** `packages/client-web/` nach Phase 0 Abschluss
**Standard:** `docs/claude/styles.md` + `docs/claude/checklisten.md` (Trigger: Neues UI-Element)
**Methode:** Biome-Lint + gezielte Pattern-Greps + Stichprobe

---

## TL;DR

Code ist überraschend sauber — keine Hot-Findings, kein systematisches Anti-Pattern. Die Lint-Errors verteilen sich auf zwei Cluster (`noNonNullAssertion` + `a11y`), die jeweils einen eigenen Mini-Sprint rechtfertigen, sich aber nicht in einem Wisch nebenbei mitlösen lassen. **Ein 1-Liner-Fix wurde in diesem Sprint inline gezogen** (siehe F2). Vier Follow-up-Mini-Sprints sind unten als AU-A4.1..A4.4 vorgemerkt.

---

## F1 — Biome-Lint-Errors (218 total)

`pnpm exec biome lint src --max-diagnostics=500`:

| Kategorie | Count | Beispiel-Treffer | Empfehlung |
|---|---|---|---|
| `style/noNonNullAssertion` | 116 | `lib/queries.ts:636-731` (8x), `lib/subtree-import.ts:454-675` (~5x), `components/NodeTree.tsx:888-1779` (4x) | **AU-A4.1** — Sweep, jedes `!` einzeln gegen Type-Korrekturen / `??`-Fallbacks ersetzen. Risiko mittel: pro Stelle prüfen ob die Type-Annahme stimmt. |
| `a11y/useSemanticElements` | 32 | `<div role="button" …>` statt `<button>` | **AU-A4.2** — viele sind in NodeTree (Tree-Rows), wo ein `<button>` Layout brechen würde. Pro Stelle entscheiden: Refactor zu `<button>` ODER explizite biome-disable mit Begründung. |
| `a11y/useKeyWithClickEvents` | 19 | onClick ohne onKeyDown | **AU-A4.2** — bei `role="button"`-Spans muss `onKeyDown` für Enter/Space dazu. Trifft mehrere Stellen in NodeTree, MatrixView, BoardView. |
| `a11y/useFocusableInteractive` | 7 | role-bestücktes Element ohne `tabIndex` | **AU-A4.2** |
| `style/useTemplate` | 10 | `'foo' + var` statt Template-Literal | **AU-A4.4** — Quick-Fix. |
| `style/useNumberNamespace` | 8 | `parseInt(x)` statt `Number.parseInt(x)` | **AU-A4.4** — Quick-Fix. |
| `a11y/noNoninteractiveElementToInteractiveRole` | 5 | `<div role="button">` auf semantisch nicht-interaktiven Elementen | **AU-A4.2** |
| `style/noUnusedTemplateLiteral` | 5 | Backtick-String ohne `${}` | **AU-A4.4** — Quick-Fix. |
| `suspicious/noAssignInExpressions` | 3 | `if ((x = …))` | Stichprobe — ggf. ablehnen, wenn idiomatisch. |
| `suspicious/noImplicitAnyLet` | 3 | `let x;` ohne Initialwert/Type | **AU-A4.4** — Type ergänzen. |
| `complexity/useOptionalChain` | 2 | `a && a.b` statt `a?.b` | **AU-A4.4** — Quick-Fix. |
| `performance/noDelete` | 2 | `delete obj.k` | Pro Stelle prüfen — ggf. legitime JSONB-Aufräumung. |
| `complexity/noForEach` | 1 | `arr.forEach(...)` statt `for-of` | **AU-A4.4** |
| `style/useConst` | 1 | `let` der nicht reassigned wird | **AU-A4.4** |
| `style/useImportType` | 1 | `import {Type}` statt `import type {Type}` | **AU-A4.4** |
| `a11y/noRedundantRoles` | 1 | `<button role="button">` | **AU-A4.4** |
| `suspicious/noExplicitAny` | 1 | explicit `any` | Stichprobe |
| `suspicious/noGlobalIsNan` | 1 | `isNaN(x)` statt `Number.isNaN(x)` | **AU-A4.4** |

---

## F2 — Animation-Hygiene (✅ + 1 Inline-Fix)

87 `transition/animation`-Vorkommen in `packages/client-web/src/styles.css`. Alle bis auf zwei nutzen die Tokens `--tr-std` (220ms) oder `--tr-enter` (180ms).

| Stelle | Status | Aktion |
|---|---|---|
| `styles.css:2517` `transition: r 120ms` (SVG-Radius an `.tree-connections circle`) | Hard-coded, **akzeptabel**. Token-System hat keinen schnelleren Wert; SVG-Radius-Animation ist eigener Use-Case mit nur 1 Vorkommen. | dokumentieren, später ggf. eigener Token wenn Wiederholung kommt. |
| `styles.css:4932` `transition: width 180ms cubic-bezier(.16, 1, .3, 1)` (Progress-Bar-Fill) | Manuell ausgeschriebener `--tr-enter`. | **FIXED** in diesem Sprint → `var(--tr-enter)`. |

---

## F3 — Inline-Styles (✅)

13 Vorkommen `style={{ … }}` in 12 Components. Stichprobe ergibt: **alle dynamisch** (User-konfigurierte Farben über CSS-Vars, berechnete Indents, Position aus Mouse-Events). Keine Statisch-Werte inline. Keine Aktion nötig.

Beispiele:
- `FrequencyMatrix.tsx:170` — `padding-left: ${FREQ_INDENT_BASE + agg.depth * FREQ_INDENT_PER_LEVEL}px` (depth-abhängig, dynamisch).
- `Icon.tsx` — Icon-Größen aus Prop.
- `WorkspaceSwitcher.tsx`, `PresenceStack.tsx` — Position aus Anchor-Element.

---

## F4 — ESC-Capture-Pattern (✅)

14 Overlay-/Modal-Components verwenden korrekt `document.addEventListener('keydown', h, true)` mit `stopImmediatePropagation()` im Handler:

CardOverlay, CellOverlay, ChecklistActionModal, ChecklistPastePopup, ChecklistToCardPopup, CommandPalette, ContextMenu, DialogHost, DocsPopup, FrequencyMatrix, GlobalSearch, ImportDialog, KeyboardHelp, SettingsModal, WorkspaceSwitcher.

Drei `keydown`-Handler **ohne** Capture sind beabsichtigt:
- `routes/Workspace.tsx:510` (ESC-Back-Navigation Workspace),
- `routes/Workspace.tsx:677` (`^`-Palette-Trigger),
- `lib/edit-mode.ts:41` (Globaler Edit-Mode-Hotkey),
- `components/MatrixView.tsx:367` (Zell-Navigation Pfeiltasten).

Diese **müssen** in Bubble laufen, damit Overlays in Capture sie schlucken können. Korrekt entsprechend `docs/claude/styles.md` „Overlay-ESC".

`lib/use-alias-autocomplete.ts:204` ist `el.addEventListener` (element-bound, kein Konflikt mit Document-Bubble).

---

## F5 — Focus-Restore-Pattern (LÜCKE)

Pattern existiert in 3 Components als lokale Implementation, fehlt in 10 weiteren. Plus: Konsolidierungs-Kandidat.

**Vorhanden (eigenes `prevFocus`-Pattern):**
- `CommandPalette.tsx:90,98,102`
- `DocsPopup.tsx:189,283,421`
- `GlobalSearch.tsx:93,95,99`

**Fehlt:**
- DialogHost, CardOverlay, CellOverlay, ChecklistActionModal, ChecklistPastePopup, ChecklistToCardPopup, FrequencyMatrix-Flyout, ImportDialog, KeyboardHelp, SettingsModal.

**Empfehlung (AU-A4.3):** Helper analog zu `installFocusTrap` in `lib/dialog.ts`:

```ts
export function installFocusRestore(): () => void {
  const previous = document.activeElement as HTMLElement | null;
  return () => {
    if (previous && document.contains(previous)) {
      previous.focus?.();
    }
  };
}
```

Aufruf-Pattern in jedem Modal:
```ts
onMount(() => {
  const restore = installFocusRestore();
  onCleanup(restore);
});
```

Die 3 Bestandsfälle bleiben kompatibel — können später dasselbe Helper-API adoptieren.

---

## F6 — Undo-Pattern in `del*`-Mutations (✅ konform)

`packages/client-web/src/lib/mutations.ts` exportiert 13 `del*`-Funktionen. Memory `feedback_saas_undo_pattern.md` definiert: Undo-Pflicht für Row-Level-Deletes, JSONB- und Cascade-Lasten sind explizite Ausnahmen.

| Mutation | Undo? | Wo verdrahtet | Anmerkung |
|---|---|---|---|
| `delCard` | ✅ | `BoardView.tsx:518` | |
| `delBoardLink` | ✅ | `BoardView.tsx:615` | |
| `delChecklist` | ✅ | `ChecklistPanel.tsx:133` | mit Items-Snapshot |
| `delChecklistItem` | ✅ | `ChecklistPanel.tsx:171` | |
| `delChecklistSnapshot` | ✅ | `ChecklistPanel.tsx:272` | |
| `delDoc` | ✅ | `DocsPopup.tsx:641` | |
| `delRow` | ✅ | `MatrixView.tsx:213` | mit Cells-Snapshot |
| `delCol` | ✅ | `MatrixView.tsx:240` | mit Cells-Snapshot |
| `delKbCol` | ⚠️ deferred | — | Cascade-Scope (alle Karten der Spalte). Memory-V2-Ausnahme. |
| `delCellInfoField` | ⚠️ deferred | — | JSONB-Mutation. Memory-V2-Ausnahme. |
| `delCellLink` | ⚠️ deferred | — | JSONB-Mutation. Memory-V2-Ausnahme. |
| `delCardInlineItem` | ⚠️ deferred | — | JSONB-Mutation. Memory-V2-Ausnahme. |
| `delCellRow` | ⚠️ prüfen | `CellOverlay.tsx` (Subnode-Delete) | Bei Cell-Subnode-Delete via CellOverlay-„Inhalt löschen": kein Undo, weil Cascade über Cells/Rows/Cols. Sollte als V2-Ausnahme dokumentiert werden, ist aber konsistent mit `delKbCol`. |

Keine ungeplante Lücke. Drei JSONB-Mutations + zwei Cascade-Mutations sind explizit als V2-Pendings vermerkt.

---

## F7 — Tokens vs Literals (✅)

Spot-Check der in Q1–Q3 + A1.x neu hinzugekommenen Components (DialogHost, ImportDialog, ChecklistActionModal/PastePopup/ToCardPopup, CommandPalette, FrequencyMatrix, etc.): keine statischen `0px`/`#hex`/`14px`-Inline-Literale gefunden, die >1× auftauchen.

Einzige bekannte Ausnahme aus AU-A1.5 (ImportDialog): `font-size:13px/14px` — `--fs-base`/`--fs-small`-Tokens existieren schlicht nicht im `:root`. Wenn der Bedarf wächst, **AU-A4.4** könnte Token-Set ergänzen.

---

## Follow-up Mini-Sprints

| Sprint | Scope | Schätz | Risiko |
|---|---|---|---|
| **AU-A4.1** | `noNonNullAssertion`-Sweep (116 `!`-Stellen) | ~2h | mittel — pro Stelle Type-Annahme prüfen |
| **AU-A4.2** | a11y-Sweep (64 Lint-Errors) | ~2h | mittel — manche `<div role="button">` brauchen Refactor zu `<button>`, andere brauchen explizite biome-disable mit Kommentar | ✅ **DONE** (siehe unten) |
| **AU-A4.3** | Focus-Restore-Helper in `lib/dialog.ts` + 10 Modal-Migration + 3 Bestandsfälle adoptieren | ~1h | niedrig — Helper-Pattern bewährt (analog Focus-Trap aus AU-A3) |
| **AU-A4.4** | Restliche Lint-Quick-Wins (`useTemplate`, `useNumberNamespace`, `noUnusedTemplateLiteral`, `useOptionalChain`, `useConst`, `useImportType`, `noRedundantRoles`, `noGlobalIsNan`, `noForEach`, `noImplicitAnyLet`) | ~30 min | niedrig — biome `--apply-unsafe` deckt viele |

---

## Sprint-Output

**Inline gefixt:**
- `packages/client-web/src/styles.css:4932` — `transition: width 180ms cubic-bezier(.16, 1, .3, 1)` → `transition: width var(--tr-enter)`.

**Findings-Report:** dieses Dokument.

---

## AU-A4.2 — a11y-Sweep ✅ (2026-04-25)

**Resultat:** 64 → 0 a11y-Lint-Errors.

### Strategie

Drei Patterns identifiziert, jeweils anders behandelt:

1. **Modal/Scrim-Pattern** (~38 Errors über 11 Modals — `<div class="overlay-scrim">` + `<div role="dialog" aria-modal="true">`)
   - **Entscheidung:** `biome-ignore` mit fundierter Begründung statt Migration zu nativem `<dialog>`-Element
   - **Grund:** Native `<dialog>`-API erfordert `showModal()`-Refactor aller 10 Modals + neue Focus-Mechanik. ARIA-Modal-Pattern (`role="dialog"` + `aria-modal="true"` + Focus-Trap aus AU-A3 + Focus-Restore aus AU-A4.3) ist semantisch äquivalent.
   - **Pattern:**
     ```tsx
     // biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop-Klick — Tastatur via ESC-Capture im onMount.
     <div class="overlay-scrim" onClick={...}>
       <div
         class="overlay-card xxx-card"
         // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> bewusst statt <dialog> — showModal() haette aufwendige Migration aller Modals zur Folge.
         role="dialog"
         aria-modal="true"
       >
     ```

2. **Listbox/Option-Pattern** (~10 Errors — `AliasAutocomplete`, `WorkspaceSwitcher`, `GlobalSearch`, `HeaderSearchBar`)
   - **Realer Bug** (`useFocusableInteractive`): listbox/option ohne `tabIndex` → `tabIndex={-1}` ergänzt (programmatisch fokussierbar, nicht im Tab-Flow). ARIA-konformes Combobox-Pattern.
   - **Falsch-positiv** (`useSemanticElements` schlägt `<select>` vor): Custom-Dropdowns rendern Multi-Section-Matches, Badges, Multiline-Items — `<select>` kann das nicht. `biome-ignore` mit Begründung.

3. **Refactor zu nativem Element**
   - `CellDocsSection.tsx:88-89` — `<li role="button">` → `<li><button class="cell-docs-item">` (Wrapper-Pattern). CSS in `styles.css:2098` um `width:100%; color:inherit; font:inherit; text-align:left` ergänzt.
   - `CommandPalette.tsx:336` — `<ul role="list">` → `<ul>` (redundantes role entfernt, FIXABLE).

4. **Fall-spezifische `biome-ignore` mit Begründung:**
   - `FrequencyMatrix.tsx` — `<th role="link">` (Klick-Anker auf Row-Header; `<a>` würde Tabellen-Semantik zerstören).
   - `BoardView.tsx` — `<li role="button">` Karten-Container (enthält nested Move/Del-Buttons, `<button>`-in-`<button>` wäre invalid).
   - `CardOverlay.tsx`, `DocsPopup.tsx` — `<div role="button">` für Note-View/Content-View (Inhalt ist `<AliasText>`/`<MarkdownLightView>` mit nested klickbaren Chips).
   - `AliasChip.tsx` — `<span role="button">` (Inline-Kontext-Render).
   - `Toasts.tsx`, `ProgressOverlay.tsx` — `<div role="status">` (Container für mehrere Items, role auf parent macht Live-Region für Screen-Reader).
   - `MatrixView.tsx` — `<span class="mx-feat-chip">` mit onClick (Tastatur über Matrix-Navigation, dokumentiert in KeyboardHelp).
   - `TaskOverview.tsx` — `<div role="link">` (Inhalt ist `<AliasText>`).

### Wichtiger Befund: biome-ignore-Comment-Placement in JSX

Biome v1.9.4 erkennt `{/* biome-ignore */}` zwischen Parent- und Child-JSX **nicht** als Suppression — der Kommentar wird als Text-Node-Child des Parents geparst, nicht als Sibling-Annotation.

**Korrektes Pattern:**
- **Vor JSX-Element auf JS-Expression-Ebene** (z.B. nach `return (` oder in `fallback={...}`-Position):
  ```tsx
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: ...
    <div onClick={...}>
  );
  ```
- **Inline als Attribut-Kommentar:**
  ```tsx
  <div
    class="..."
    // biome-ignore lint/a11y/useSemanticElements: ...
    role="dialog"
  >
  ```

Lokation der Suppression muss **direkt vor** dem Diagnostic-Reporting-Punkt liegen — biome reportet je nach Rule entweder beim Element-Start (z.B. `useKeyWithClickEvents`) oder beim Attribut (z.B. `useSemanticElements` beim `role="..."`).

### Files geändert (16 Components + 1 CSS)

`AliasAutocomplete.tsx`, `AliasChip.tsx`, `BoardView.tsx`, `CardOverlay.tsx`, `CellDocsSection.tsx`, `CellOverlay.tsx`, `ChecklistActionModal.tsx`, `ChecklistPastePopup.tsx`, `ChecklistToCardPopup.tsx`, `CommandPalette.tsx`, `DialogHost.tsx`, `DocsPopup.tsx`, `FrequencyMatrix.tsx`, `GlobalSearch.tsx`, `HeaderSearchBar.tsx`, `ImportDialog.tsx`, `KeyboardHelp.tsx`, `MatrixView.tsx`, `ProgressOverlay.tsx`, `SettingsModal.tsx`, `TaskOverview.tsx`, `Toasts.tsx`, `WorkspaceSwitcher.tsx` + `styles.css`.

### Verifikation

- `pnpm exec tsc --noEmit` grün
- `pnpm exec vite build` grün (PWA precache + Dist-Output ok)
- `pnpm exec biome lint src` — a11y-Errors: **64 → 0**, Gesamterror-Count: 144 (alle non-a11y, deferred AU-A4.1)

**Commit:** `docs(audit): AU-A4 — Style-Konvention-Audit + Animation-Token-Fix`.
