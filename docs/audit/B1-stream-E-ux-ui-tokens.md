# AU-B1 / Stream E — UX/UI + A11y + Tokens

**Datum:** 2026-04-29
**Scope:** `packages/client-web/src/styles.css` (+3843 LOC), neue Components + Settings-Pages, Wizard-Flows (ObjectDetail.tsx ~901 LOC, ObjectsList.tsx ~622 LOC, Workspace.tsx ~266 LOC modifiziert, NewCellWizard, TopLevelWizard, BulkAddModal, GroupMatrixGenerator, WizardShell + Steps)
**Methode:** Code-Reviewer-Agent, Pruefung gegen `docs/claude/styles.md`, CLAUDE.md Regeln 14/12/15/16, A11y-Standards (WCAG AA), Mobile/Dark-Mode.

---

## Bewertungs-Übersicht

| Severity | Count |
|---|---:|
| CRITICAL | 2 |
| HIGH | 7 |
| MEDIUM | 7 |
| LOW | 3 |
| INFO | 2 |
| **Total** | **21** |

---

## Cross-Cutting-Beobachtungen

Die neuen Object-Layer-Sections (Bulk-Add, Obj-Detail, Group-Matrix, NewCellWizard) wurden offensichtlich aus einem anderen Token-System entwickelt oder portiert: Sie verwenden durchgehend `--p` (Primärfarbe, undefiniert), `--rl` als Borderfarbe (ist aber ein Radius-Token), `--radius-sm` (undefiniert mit Fallback `6px`) und `--danger` (undefiniert mit Fallback-Hex). Das erzeugt unsichtbare/falsche Borders und fehlende Farb-Akzente in der gesamten neuen UI-Schicht — ein systemisches Problem, kein Einzelfall. WizardShell (Onboarding) fehlt `installFocusTrap`, obwohl `aria-modal="true"` gesetzt ist — eine direkte A11y-Verletzung des in `styles.md` dokumentierten Musters.

---

## Findings

### [CRITICAL] B1-E-001 — `--rl` (Radius-Token 12px) als Border-Color missbraucht — systemisch in allen neuen Sections

**File:** `packages/client-web/src/styles.css`
**Zeilen (Stichprobe):** 7968, 8014, 8039, 8060, 8106, 8119, 8153, 8173, 8228, 8268, 8316, 8367, 8702, 10691, 10721, 10788 (≥30 Vorkommen)

**Was:** `--rl` ist in `:root` als `--rl: 12px` (Radius-Token) definiert. In allen neuen Sections (Bulk-Add, Obj-Detail, Group-Matrix, NewCellWizard, Top-Level-Wizard) wird es jedoch als **Borderfarbe** eingesetzt: `border: 1px solid var(--rl)`, `border: 1px dashed var(--rl)`, `border-color: var(--rl)`. CSS behandelt `12px` als ungültige `<color>`-Angabe und verwirft sie stillschweigend — die gesetzten Borders rendern ohne definierten Farbwert (fallback `currentColor`). Das ist visuell inkonsistent und nie das gewünschte Ergebnis.

**Warum:** Token-Regel 14 (CLAUDE.md) + semantische Korrektheit. `--rl` ist eindeutig ein Radius-Token; als Border-Color ist der korrekte Token `--border` oder `--border2`. Der Fehler deutet auf Copy-Paste aus einem anderen Code-System oder einer anderen Token-Konvention hin.

**Fix:** Alle `var(--rl)` in Border-Color-Positionen durch `var(--border)` (dezent, 8% opacity) oder `var(--border2)` (stärker, 16% opacity) ersetzen. Border-Radius-Vorkommen von `var(--rl)` bleiben korrekt und sind nicht betroffen.

**Effort:** M (suchen + ersetzen, ~30 Stellen, drei neue Sections)
**Memory/Regel:** CLAUDE.md Regel 14 (Tokens vor Literals) + CSS-Semantik

---

### [CRITICAL] B1-E-002 — `WizardShell` hat `aria-modal="true"` aber keinen Focus-Trap

**File:** `packages/client-web/src/components/wizard/WizardShell.tsx`
**Zeile:** 130–136 (Modal-Div) + 53–55 (onMount — kein `installFocusTrap`)

**Was:** `WizardShell` setzt `role="dialog" aria-modal="true"` auf dem Card-Div, ruft aber nur `installFocusRestore()` und keinen `installFocusTrap(cardRef)` auf. Laut `styles.md` (Phase 0g+ Patterns): „Wer `aria-modal="true"` setzt, muss auch den Trap installieren — sonst sickert der Tab-Order in die Untergrund-UI durch." In der Praxis kann ein Tastatur-Benutzer aus dem 720px-Wizard-Modal per Tab in die Workspace-UI dahinter tabben — ein A11y-Showstopper. **Cross-Stream:** Stream D B1-D-009 hat dasselbe gefunden.

**Warum:** WCAG 2.1 SC 2.1.2 (No Keyboard Trap) verlangt, dass modaler Dialog-Fokus innerhalb des Dialogs bleibt.

**Fix:**
```ts
onMount(() => {
  onCleanup(installFocusRestore());
  if (cardRef) onCleanup(installFocusTrap(cardRef));
});
```

**Effort:** S
**Memory/Regel:** `docs/claude/styles.md`, WCAG 2.1 SC 2.1.2

---

### [HIGH] B1-E-003 — `--p` (undefiniertes Primärfarb-Token) in ≥40 neuen CSS-Regeln

**File:** `packages/client-web/src/styles.css`
**Zeilen (Stichprobe):** 7962 (`accent-color`), 7978 (`border-color`), 8024–8025, 8053, 8069, 8130, 8163–8185, 8238–8239, 8327–8328, 8580, 8702, 8717, 10700, 10732–10737, 10763

**Was:** `--p` ist in `:root` und `[data-theme="dark"]` nicht definiert. Es wird als Primärfarb-Akzent genutzt (focus-border, accent-color auf Checkboxen, button-background, link-color). Da keine Definition existiert, ergibt `var(--p)` einen ungültigen Wert — sämtliche Focus-Indikatoren, Checkbox-Tints, aktive Feature-Buttons und Link-Buttons in den neuen Sections haben keinen Farbakzent.

**Warum:** CLAUDE.md Regel 14 + visuell broken. Das intendierte Token ist vermutlich `--blue`.

**Fix:** In `:root` ergänzen: `--p: var(--blue);`. Alternativ alle `var(--p)` durch `var(--blue)` ersetzen.

**Effort:** S
**Memory/Regel:** CLAUDE.md Regel 14

---

### [HIGH] B1-E-004 — `--accent`, `--danger`, `--radius-sm`, `--bg-hover`, `--focus-ring` undefiniert ohne vollständige Fallbacks

**File:** `packages/client-web/src/styles.css`
**Zeilen:**
- `--accent`: 6207–6211, 6380, 6385, 6389, 9951
- `--danger`: 8205, 8259, 8310, 8469–8470, 8802, 10793, 10798 (Hex-Fallback `#c53030`)
- `--radius-sm`: 7969, 7996 etc. (Fallback `6px`)
- `--bg-hover`: 8128, 8468, 8931, 8990, 9132 (Fallback `var(--rl)` — selbst broken)
- `--focus-ring`: 6725, 10029 (**kein Fallback** → `outline:` leer)

**Was:** Vier neue undefinierte Tokens. Kritischstes Einzelproblem: `.wizard-question-input:focus-visible { outline: var(--focus-ring) }` (Z.10029) hat keinen Fallback → Focus-Outline auf dem Textarea in StepQuestions ist unsichtbar.

**Warum:** CLAUDE.md Regel 14 + A11y (Keyboard-Focus-Indicator).

**Fix:**
- `--focus-ring`: Fallback hinzufügen → `outline: var(--focus-ring, 2px solid var(--focus-color))`.
- `--accent`: in `:root` definieren → `--accent: var(--blue);`.
- `--danger`: Hex-Literals → `color: var(--danger, var(--red));`.
- `--bg-hover`: ersetzen durch `var(--surface-hover)`.
- `--radius-sm`: in `:root` definieren → `--radius-sm: var(--rs);`.

**Effort:** M
**Memory/Regel:** CLAUDE.md Regel 14, WCAG 2.4.7

---

### [HIGH] B1-E-005 — `display: none` in Sidebar-Rails/Collapsed-Mode ohne Animations-Alternative

**File:** `packages/client-web/src/styles.css`
**Zeilen:** 519–526, 530–532

**Was:** Beim Wechsel in den `rails`- oder `collapsed`-Modus der Sidebar werden Elemente via `display: none` ausgeblendet. Beim Sidebar-Mode-Wechsel gibt es keine Transition.

**Warum:** CLAUDE.md „Was NICHT tun" — Harte Visibility-Swaps sind verboten wenn animierbar.

**Fix:** `.ws-sidebar[data-sb-mode="rails"] .ws-actions { opacity: 0; pointer-events: none; transition: opacity var(--tr-std); }` statt `display: none`.

**Effort:** M
**Memory/Regel:** CLAUDE.md Arbeitsprinzip 4 + „Was NICHT tun"

---

### [HIGH] B1-E-006 — Filter-Selects in ObjectsList ohne `aria-label` oder `<label>`

**File:** `packages/client-web/src/routes/ObjectsList.tsx`
**Zeilen:** 448–455 (Type-Filter), 458–466 (Gruppen-Filter), 469–477 (Parent-Filter)

**Was:** Die drei `<select>`-Elemente haben weder ein assoziiertes `<label for="...">` noch ein `aria-label`-Attribut.

**Warum:** WCAG 1.3.1 + WCAG 4.1.2.

**Fix:** `aria-label` ergänzen: `<select aria-label="Nach Typ filtern" ...>`, etc.

**Effort:** S
**Memory/Regel:** WCAG 1.3.1, 4.1.2

---

### [HIGH] B1-E-007 — Suchfeld in ObjectsList ohne `aria-label`

**File:** `packages/client-web/src/routes/ObjectsList.tsx`
**Zeile:** 429–435

**Was:** `<input type="text" class="objects-list-search-input" placeholder="Label oder ^o.alias suchen…">` hat kein `aria-label`. Placeholder allein gilt nicht als barrierefreies Label (WCAG H65).

**Warum:** WCAG 1.3.1 + 4.1.2.

**Fix:** `aria-label="Objekte suchen"` ergänzen.

**Effort:** XS
**Memory/Regel:** WCAG 4.1.2

---

### [HIGH] B1-E-008 — `color: #fff` Hardcode in `.new-cell-wizard-feat.active .new-cell-wizard-feat-hotkey`

**File:** `packages/client-web/src/styles.css:10764`

**Was:** Im aktiven Zustand der Feature-Hotkey-Badges wird `color: #fff` hartcodiert.

**Warum:** CLAUDE.md Regel 14.

**Fix:** `color: var(--surface);` oder `color: var(--bg2);`.

**Effort:** XS
**Memory/Regel:** CLAUDE.md Regel 14

---

### [HIGH] B1-E-009 — `setTimeout(..., 150)` in `GroupMatrixGenerator.onPickerBlur`

**File:** `packages/client-web/src/components/GroupMatrixGenerator.tsx:329-333`

**Was:** Timing-Hack für Blur/Click-Race. Pattern fragil bei langsamen Klicks. **Cross-Stream:** Stream D B1-D-006 hat dasselbe als HIGH gefunden mit Cleanup-Fokus.

**Warum:** CLAUDE.md Arbeitsprinzip 16.

**Fix:** Mit `relatedTarget`-Check lösen oder konsistent mit BoardView (100ms).

**Effort:** S
**Memory/Regel:** CLAUDE.md Arbeitsprinzip 16

---

### [MEDIUM] B1-E-010 — `wizard-step-dot` hat `aria-label` auf `<span>` ohne `role`

**File:** `packages/client-web/src/components/wizard/WizardShell.tsx:140-149`

**Was:** Step-Indicator-Dots sind `<span>`-Elemente mit `aria-label`. Auf reinem `<span>` ohne `role` wird `aria-label` von Screen-Readern ignoriert.

**Fix:** `aria-hidden="true"` oder `role="img"` + `aria-label`.

**Effort:** XS
**Memory/Regel:** WCAG 4.1.2

---

### [MEDIUM] B1-E-011 — `wizard-question-input` (`<textarea>`) hat kein explizites `id`/`for`-Label-Linking

**File:** `packages/client-web/src/components/wizard/StepQuestions.tsx:72-83`

**Was:** Implizites Label-Wrapping mit Hint-`<span>` innerhalb des `<label>` führt zu langen Screen-Reader-Ansagen.

**Fix:** Hint außerhalb des `<label>`, mit `aria-describedby` verknüpfen.

**Effort:** S
**Memory/Regel:** WCAG 1.3.1

---

### [MEDIUM] B1-E-012 — Wizard primary buttons ohne `.btn-p`-Klasse

**File:** `StepProvider.tsx:97-104`, `StepWelcome.tsx:43`, `StepQuestions.tsx:90-98`, `StepProposing.tsx:170`, `StepDone.tsx:68`, `WizardShell.tsx:201`

**Was:** Haupt-CTAs in den Wizard-Steps haben keine CSS-Klasse oder nur `btn-secondary`. Mit `type="button"` bekommen sie nur Browser-Default-Styling — visuell nicht von Secondary-Buttons unterscheidbar.

**Fix:** Primär-Buttons mit `class="btn btn-p"`.

**Effort:** S
**Memory/Regel:** Design-Konsistenz, `styles.md`

---

### [MEDIUM] B1-E-013 — `GroupMatrixGenerator` Mobile: Zwei-Spalten-Grid ohne Breakpoint für <600px

**File:** `packages/client-web/src/styles.css:8666-8671`

**Was:** Zwei-Spalten-Grid für Zeilen-/Spalten-Quellen bricht auf Mobilgeräten (<480px) nicht um.

**Fix:**
```css
@media (max-width: 600px) {
  .group-matrix-grid { grid-template-columns: 1fr; }
}
```

**Effort:** XS
**Memory/Regel:** CLAUDE.md „Praktischer Ablauf 7"

---

### [MEDIUM] B1-E-014 — `transition: r 120ms` Literal-ms-Wert

**File:** `packages/client-web/src/styles.css:2779`

**Was:** `transition: r 120ms;` auf `.tree-connections circle.tree-dot-svg`. CLAUDE.md Regel 14. Projekt-Standard ist 180ms/220ms.

**Fix:** `transition: r var(--tr-enter);`.

**Effort:** XS
**Memory/Regel:** CLAUDE.md Regel 14 + Arbeitsprinzip 4

---

### [MEDIUM] B1-E-015 — `prefers-reduced-motion` fehlt für WizardShell-Subpage-Animation

**File:** `packages/client-web/src/styles.css:10663-10672`

**Was:** Der `@media (prefers-reduced-motion: reduce)` Block deckt `subStepIn` ab. Onboarding-WizardShell hat aber eigene Slide-Transition pro Phasen-Wechsel — wenn künftig Step-Transitions hinzukommen, brauchen sie denselben Block.

**Fix:** Vorbeugend bei zukünftigen Animationen `@media (prefers-reduced-motion: reduce) { .wizard-body { animation: none; } }` ergänzen.

**Effort:** XS
**Memory/Regel:** CLAUDE.md Arbeitsprinzip 4

---

### [MEDIUM] B1-E-016 — Streaming-Text in `StepProposing` nicht in `aria-live`-Region eingebettet

**File:** `packages/client-web/src/components/wizard/StepProposing.tsx:142-148`

**Was:** `aria-live="polite"`-Region umfasst nur den Indicator (`KI denkt nach…`), nicht aber den dynamisch befüllten `wizard-streaming-text`.

**Fix:** `aria-live="polite"` auf den gemeinsamen `.wizard-streaming`-Wrapper verschieben.

**Effort:** XS
**Memory/Regel:** WCAG 4.1.3

---

### [LOW] B1-E-017 — `objects-list-type-filter` als Klasse für drei semantisch verschiedene Filter

**File:** `packages/client-web/src/routes/ObjectsList.tsx:449,459,470`; `styles.css:8427`

**Was:** Alle drei Filter-Selects (Typ, Gruppe, Eltern) verwenden dieselbe Klasse.

**Fix:** Generisch (`.objects-list-filter-select`) oder spezifisch.

**Effort:** XS
**Memory/Regel:** `styles.md` (semantische Klassennamen)

---

### [LOW] B1-E-018 — `wizard-question-input` Literal `font-size: 14px`

**File:** `packages/client-web/src/styles.css:10019`

**Fix:** `font-size: var(--fs-base);`.

**Effort:** XS
**Memory/Regel:** CLAUDE.md Regel 14

---

### [LOW] B1-E-019 — `bulk-add-hint` und `cl-action-hint` mit `font-size: 12px` Literal

**File:** `packages/client-web/src/styles.css:7940, 7914`

**Fix:** `var(--fs-small)` (13px) verwenden oder neuen `--fs-caption: 12px`-Token einführen.

**Effort:** XS
**Memory/Regel:** CLAUDE.md Regel 14

---

### [INFO] B1-E-020 — Namespace-Konsistenz: `.obj-detail-*` vs. `.objects-list-*` vs. `.objects-tree-*`

**File:** `packages/client-web/src/styles.css` (ab Z.8092 / 8353 / 8587)

**Was:** Drei verschiedene Namespace-Präfixe für dasselbe Feature-Cluster. Beobachtenswert aber nicht inkonsistent: jede Seite hat ihren eigenen Präfix. `obj-type-chip` wird auch in `ObjectsList.tsx` (Z.546, 593) genutzt — gutes Reuse-Pattern.

---

### [INFO] B1-E-021 — `display: none` in Responsive-Media-Queries ist akzeptabel

**File:** `packages/client-web/src/styles.css:6107-6111, 6323-6327`

**Was:** Per CLAUDE.md-Konvention ist Layout-Anpassung in Media-Queries akzeptabel. Zur Vollständigkeit dokumentiert.

---

## Zusammenfassung Top-Prioritäten

| Prio | ID | Severity | Effort | Kurztitel |
|---|---|---|---|---|
| 1 | B1-E-001 | CRITICAL | M | `--rl` als Borderfarbe in 30+ Stellen — alle neuen Borders unsichtbar |
| 2 | B1-E-002 | CRITICAL | S | `WizardShell` ohne FocusTrap trotz aria-modal |
| 3 | B1-E-003 | HIGH | S | `--p` undefiniertes Primary-Token in 40+ Regeln |
| 4 | B1-E-004 | HIGH | M | `--focus-ring` ohne Fallback (Z.10029) — Focus-Outline unsichtbar |
| 5 | B1-E-005 | HIGH | M | Sidebar-Rails harte `display:none`-Swaps |
| 6 | B1-E-006 | HIGH | S | ObjectsList Filter-Selects ohne aria-label |
| 7 | B1-E-007 | HIGH | XS | ObjectsList Suchfeld ohne aria-label |
| 8 | B1-E-012 | MEDIUM | S | Wizard primary buttons ohne `.btn-p` |
| 9 | B1-E-013 | MEDIUM | XS | GroupMatrixGenerator Mobile-Breakpoint fehlt |
