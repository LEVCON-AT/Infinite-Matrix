# Style-Manifest

**Verbindlich. Globale Single-Source.** Jedes Visual-Detail laeuft durch dieses Manifest. Look-and-Feel-Ziel: **HyperUI-Eleganz** — modern, ruhig, taktil, klare Typo-Hierarchie, grosszuegiges Whitespace, weiche Schatten-Tiefe, subtile Hover-States, durchgaengige Token-Pflicht.

**Wann lesen:** vor jedem CSS, vor jeder Komponenten-Klasse, vor jedem Inline-Style-Versuch.

---

## 1. Mass-System (Pflicht)

### 1.1 Pixel-Regel (streng)

`px` ist verboten — mit genau diesen Ausnahmen:

| Ausnahme | Beispiel | Begruendung |
|---|---|---|
| `border-width` | `border: 1px solid var(--border)` | Borders sollen pixel-fix sein, nicht skalieren |
| `outline-width` / `outline-offset` | `outline: 2px solid var(--accent); outline-offset: 2px` | Focus-Ring muss konstant lesbar bleiben |
| `box-shadow` Offsets/Blurs | `box-shadow: 0 1px 2px ...` | Tiefe muss konstant wirken |
| Sehr kleine Icon-Pixel-Grid-Anker | `inline-size: 14px` fuer 14×14 SVG-Icons | Sub-pixel-Drift bricht Stroke-Sharpness |
| Runtime-derived JS-Werte | `el.style.setProperty('--natural', el.scrollHeight + 'px')` | DOM-API gibt `px` zurueck |

**Sonst nirgends `px`.** Nicht in `font-size`, nicht in `padding`/`margin`/`gap`, nicht in `width`/`height`, nicht in `top`/`left`, nicht in `transform: translate*`, nicht in `letter-spacing`, nicht in `border-radius`.

### 1.2 Spacing-Skala (rem)

Alle Tokens in `:root`:

| Token | Wert | Px-Aequivalent (16px Root) |
|---|---|---|
| `--space-0` | `0` | 0 |
| `--space-px` | `0.0625rem` | 1 |
| `--space-0_5` | `0.125rem` | 2 |
| `--space-1` | `0.25rem` | 4 |
| `--space-1_5` | `0.375rem` | 6 |
| `--space-2` | `0.5rem` | 8 |
| `--space-2_5` | `0.625rem` | 10 |
| `--space-3` | `0.75rem` | 12 |
| `--space-3_5` | `0.875rem` | 14 |
| `--space-4` | `1rem` | 16 |
| `--space-5` | `1.25rem` | 20 |
| `--space-6` | `1.5rem` | 24 |
| `--space-7` | `1.75rem` | 28 |
| `--space-8` | `2rem` | 32 |
| `--space-10` | `2.5rem` | 40 |
| `--space-12` | `3rem` | 48 |
| `--space-14` | `3.5rem` | 56 |
| `--space-16` | `4rem` | 64 |
| `--space-20` | `5rem` | 80 |
| `--space-24` | `6rem` | 96 |
| `--space-32` | `8rem` | 128 |

Verwendung: `padding`, `margin`, `gap`, `inset`, `top`/`bottom`/`left`/`right`. **Nie** Inline-px.

### 1.3 Typo-Skala (rem)

| Token | Wert | Line-Height-Token | Verwendung |
|---|---|---|---|
| `--text-xs` | `0.75rem` | `--lh-snug` (1.25) | Caption, Tag-Label |
| `--text-sm` | `0.875rem` | `--lh-normal` (1.5) | Body-Secondary, Button-Small |
| `--text-base` | `1rem` | `--lh-normal` (1.5) | Body-Default |
| `--text-lg` | `1.125rem` | `--lh-snug` (1.375) | Sub-Heading |
| `--text-xl` | `1.25rem` | `--lh-snug` (1.375) | Section-Heading |
| `--text-2xl` | `1.5rem` | `--lh-tight` (1.25) | Page-Sub-Heading |
| `--text-3xl` | `1.875rem` | `--lh-tight` (1.2) | Page-Heading |
| `--text-4xl` | `2.25rem` | `--lh-tight` (1.15) | Hero |
| `--text-5xl` | `3rem` | `--lh-none` (1) | Display |

Line-Heights:

| Token | Wert |
|---|---|
| `--lh-none` | `1` |
| `--lh-tight` | `1.25` |
| `--lh-snug` | `1.375` |
| `--lh-normal` | `1.5` |
| `--lh-relaxed` | `1.625` |
| `--lh-loose` | `2` |

Font-Weights:

| Token | Wert |
|---|---|
| `--weight-normal` | `400` |
| `--weight-medium` | `500` |
| `--weight-semibold` | `600` |
| `--weight-bold` | `700` |

Letter-Spacings (in `em`, niemals `px`):

| Token | Wert |
|---|---|
| `--tracking-tight` | `-0.02em` |
| `--tracking-normal` | `0` |
| `--tracking-wide` | `0.02em` |
| `--tracking-wider` | `0.04em` |

### 1.4 Border-Radius-Skala

| Token | Wert | Verwendung |
|---|---|---|
| `--radius-none` | `0` | Tabellen, scharfe Ecken |
| `--radius-sm` | `0.125rem` | Subtile Rundung — Tags, Badges |
| `--radius` | `0.25rem` | Standard — Inputs, Buttons-Small |
| `--radius-md` | `0.375rem` | Buttons, Cards-Small |
| `--radius-lg` | `0.5rem` | Cards, Modal-Small |
| `--radius-xl` | `0.75rem` | Modal, Section-Container |
| `--radius-2xl` | `1rem` | Hero-Card, Drawer |
| `--radius-3xl` | `1.5rem` | Spezial — Bottom-Sheet |
| `--radius-full` | `9999px` | Pille, Avatar, Switch-Knob |

### 1.5 Shadow-Skala (HyperUI-typisch)

Alle Schatten als Tokens, niemals inline. Layered fuer Tiefe.

| Token | Wert | Verwendung |
|---|---|---|
| `--shadow-xs` | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | Subtile Buttons, Inputs |
| `--shadow-sm` | `0 1px 3px 0 rgb(0 0 0 / 0.08), 0 1px 2px -1px rgb(0 0 0 / 0.06)` | Cards-Default |
| `--shadow-md` | `0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)` | Hover-State Cards |
| `--shadow-lg` | `0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.06)` | Dropdowns, Popovers |
| `--shadow-xl` | `0 20px 25px -5px rgb(0 0 0 / 0.10), 0 8px 10px -6px rgb(0 0 0 / 0.06)` | Modals |
| `--shadow-2xl` | `0 25px 50px -12px rgb(0 0 0 / 0.18)` | Fullscreen-Drawer, Hero-CTA |
| `--shadow-inner` | `inset 0 2px 4px 0 rgb(0 0 0 / 0.05)` | Pressed-State, Input-Inset |
| `--shadow-focus` | `0 0 0 3px var(--accent-soft)` | Focus-Ring statt Outline (Optional-Pattern) |

### 1.6 Z-Index-Skala

Niemals beliebige Zahlen. Nur diese Tokens.

| Token | Wert | Verwendung |
|---|---|---|
| `--z-base` | `0` | Default |
| `--z-dropdown` | `10` | Menue-Dropdowns |
| `--z-sticky` | `20` | Sticky-Headers |
| `--z-fixed` | `30` | Fixed-Sidebar |
| `--z-modal-backdrop` | `40` | Modal-Backdrop |
| `--z-modal` | `50` | Modal-Dialog |
| `--z-popover` | `60` | Hover-Popover, Tooltip |
| `--z-toast` | `70` | Toast-Stack |
| `--z-cmd` | `80` | Command-Palette |

---

## 2. Color-Tokens

Single-Source in `:root`. Dark-Mode-Overrides in `[data-theme="dark"]`. **Niemals Hex-Literals im Code.**

### 2.1 Semantische Tokens (verwenden!)

| Token | Light | Dark | Verwendung |
|---|---|---|---|
| `--canvas` | weiss-grau | dunkelgrau | App-Hintergrund |
| `--bg` | weiss | grau-900 | Card/Panel-Hintergrund |
| `--bg2` | grau-50 | grau-800 | Sekundaer-Panel |
| `--bg-hover` | grau-100 | grau-700 | Hover-State |
| `--bg-active` | grau-200 | grau-600 | Active/Selected |
| `--border` | grau-200 | grau-700 | Default-Border |
| `--border-strong` | grau-300 | grau-600 | Hervorgehoben |
| `--text` | grau-900 | grau-50 | Primary-Text |
| `--text2` | grau-700 | grau-300 | Secondary-Text — **muss WCAG AA Kontrast halten** |
| `--text3` | grau-500 | grau-400 | Tertiary-Text — Captions |
| `--text-inverse` | weiss | grau-900 | Auf farbigem Hintergrund |
| `--accent` | blue-600 | blue-500 | Primary-Aktion |
| `--accent-hover` | blue-700 | blue-400 | Hover-State |
| `--accent-soft` | blue-50 | blue-950 | Highlight-Background, Focus-Ring-Soft |
| `--success` | green-600 | green-500 | OK-Toast, Check-Icon |
| `--warning` | amber-500 | amber-400 | Warn-Toast, Overdue-Badge |
| `--danger` | red-600 | red-500 | Destruktive Aktionen, Error-Toast |
| `--danger-soft` | red-50 | red-950 | Destruktive-Hover-Background |

### 2.2 Feature-Farben (Matrix-Konzept)

Pro Cell-Feature ein Token-Paar (background + text) — referenziert aus `data-feat`-Attribut, nie inline.

| Feature | `--feat-{x}-bg` | `--feat-{x}-text` |
|---|---|---|
| matrix | blue-50 / blue-950 | blue-700 / blue-300 |
| board | teal-50 / teal-950 | teal-700 / teal-300 |
| info | amber-50 / amber-950 | amber-700 / amber-300 |
| checklists | violet-50 / violet-950 | violet-700 / violet-300 |
| doc | grau-50 / grau-800 | grau-700 / grau-300 |

### 2.3 Color-Konvention im Code

```css
/* RICHTIG */
.my-button { background: var(--accent); color: var(--text-inverse); }

/* FALSCH */
.my-button { background: #2563eb; color: white; }    /* Hex/Named verboten */
.my-button { background: rgb(37 99 235); }            /* Inline-Color verboten */
.my-button[style] { /* nope */ }                       /* Inline-Style verboten */
```

Dynamische User-Farben (z.B. Custom-Kanban-Color): via CSS-Custom-Property gesetzt aus JS:

```ts
el.style.setProperty('--user-col', userValue);  // Eine Property, nicht inline-style
// CSS:
.kb-col { background: var(--user-col, var(--accent)); }
```

---

## 3. Globalitaet (Pflicht)

**Jede CSS-Klasse, jeder Helper, jedes Token, jeder Type lebt an genau einer Stelle.** Doubletten = Review-Stop. Wenn ein Pattern wiederverwendet wird, gehoert es in die globale Library.

### 3.1 CSS-Globalitaet

- **Tokens (`:root`):** ein File pro Build (`packages/client-standalone/matrix.html` inline; `packages/client-web/src/styles.css`).
- **Komponenten-Klassen:** `.btn`, `.btn-primary`, `.btn-subtle`, `.card`, `.input`, `.modal`, `.toast`, `.chip`, `.badge`, `.icon-btn` — global definiert, ueberall konsumiert.
- **Utility-Klassen** (HyperUI-Stil): `.lift`, `.click-pulse`, `.skeleton`, `.list-item-enter`, `.fade-in` — definiert in `:root`-CSS, fuer ad-hoc Komposition.
- **Keine Komponenten-spezifischen Color/Spacing-Werte.** Wenn eine Komponente "eigenen" Wert braucht, ist das ein Token-Bug — anlegen.

### 3.2 TS/JS-Globalitaet

- **Helper:** `lib/animations.ts`, `lib/safe-mutation.ts`, `lib/dialog.ts`, `lib/toasts.ts`, `lib/keyboard-nav.ts`, `lib/recur.ts`, `lib/calendar.ts`. Niemand re-implementiert.
- **Types:** `lib/types.ts` ist Single-Source fuer alle DB-Row-Types. Komponenten importieren von dort, nie inline definieren.
- **Hooks:** `lib/hooks/` — wenn ein Reactive-Pattern wiederverwendet wird (z.B. `useElementSize`, `useFocusTrap`, `useEscClose`), Hook anlegen.

### 3.3 Doublet-Detection (Pre-Commit)

Vor jedem Commit:
1. Neue Funktion → in `lib/` greppen ob es etwas Aehnliches schon gibt (`grep -rn "^export function\|^export const" packages/client-web/src/lib/`).
2. Neue CSS-Klasse → in styles.css greppen.
3. Neue Type-Definition → `lib/types.ts` durchsuchen.
4. Wenn 70% Aehnlichkeit zu existing: existing erweitern, nicht duplizieren.

### 3.4 Anti-Doublet-Pattern (Beispiele)

```ts
// FALSCH — drei Komponenten haben jeweils ihre Date-Format-Logic
function CompA() { const d = new Date(...).toLocaleString('de-DE', {...}); }
function CompB() { const d = new Date(...).toLocaleString('de-DE', {...}); }

// RICHTIG — Single-Source
// lib/dates.ts:
export function formatDateDE(iso: string): string { ... }

function CompA() { const d = formatDateDE(iso); }
function CompB() { const d = formatDateDE(iso); }
```

---

## 4. Inline-Style-Verbot

`style="..."` ist verboten. Ausnahmen genau diese:

| Erlaubt | Beispiel | Begruendung |
|---|---|---|
| Dynamic-Computed Custom-Properties | `style="--user-col: ${userValue}"` | CSS liest dann via `var(--user-col)` — bleibt token-basiert |
| Runtime-DOM-derived Werte | `style="--natural: ${el.scrollHeight}px"` | scrollHeight kommt zwingend in px aus dem DOM |

**Verboten:**

```html
<!-- FALSCH -->
<div style="background: blue;">
<div style="padding: 16px;">
<div style="display: flex; gap: 8px;">
<div style="font-size: 14px; color: #333;">

<!-- RICHTIG -->
<div class="bg-accent">                         <!-- oder eigene Komponenten-Klasse -->
<div class="p-4">                               <!-- Utility -->
<div class="flex gap-2">                        <!-- Utility -->
<div class="text-sm text-secondary">            <!-- Utility -->
```

Utility-Klassen-Konvention (Tailwind-aehnlich, aber lokal):

```css
.p-1 { padding: var(--space-1); }
.p-2 { padding: var(--space-2); }
.p-4 { padding: var(--space-4); }
.gap-1 { gap: var(--space-1); }
.gap-2 { gap: var(--space-2); }
.flex { display: flex; }
.grid { display: grid; }
.bg-accent { background: var(--accent); color: var(--text-inverse); }
.text-sm { font-size: var(--text-sm); line-height: var(--lh-normal); }
.text-secondary { color: var(--text2); }
```

Wer eine neue Utility braucht, legt sie in `:root`-CSS an, nicht inline.

---

## 5. Komponenten-Standards (HyperUI-Look)

### 5.1 Buttons

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding-inline: var(--space-4);
  padding-block: var(--space-2_5);
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  transition:
    background-color var(--tr-fast) var(--ease-smooth),
    box-shadow var(--tr-fast) var(--ease-smooth),
    transform var(--tr-fast) var(--ease-spring),
    color var(--tr-fast) var(--ease-smooth);
}
.btn:hover { background: var(--bg-hover); box-shadow: var(--shadow-sm); }
.btn:active { transform: scale(var(--scale-press)); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-primary { background: var(--accent); color: var(--text-inverse); border-color: var(--accent); }
.btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }

.btn-subtle { background: transparent; color: var(--text2); }
.btn-subtle:hover { background: var(--bg-hover); color: var(--text); }

.btn-danger { background: var(--danger); color: var(--text-inverse); }
.btn-danger:hover { background: var(--danger); filter: brightness(0.9); }
```

### 5.2 Inputs

```css
.input {
  inline-size: 100%;
  padding-inline: var(--space-3);
  padding-block: var(--space-2);
  font-size: var(--text-sm);
  font-family: inherit;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  transition:
    border-color var(--tr-fast) var(--ease-smooth),
    box-shadow var(--tr-fast) var(--ease-smooth);
}
.input:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: var(--shadow-focus);
}
.input::placeholder { color: var(--text3); }
```

### 5.3 Cards

```css
.card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  box-shadow: var(--shadow-xs);
}
.card-interactive {
  cursor: pointer;
  transition:
    transform var(--tr-fast) var(--ease-smooth),
    box-shadow var(--tr-fast) var(--ease-smooth),
    border-color var(--tr-fast) var(--ease-smooth);
}
.card-interactive:hover {
  transform: translateY(var(--lift-sm));
  box-shadow: var(--shadow-md);
  border-color: var(--border-strong);
}
.card-interactive:active {
  transform: translateY(0) scale(var(--scale-press));
  box-shadow: var(--shadow-xs);
}
```

### 5.4 Modals

```css
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.4);
  backdrop-filter: blur(0.25rem);
  z-index: var(--z-modal-backdrop);
}
.modal-dialog {
  position: relative;
  inline-size: min(32rem, calc(100vw - var(--space-8)));
  max-block-size: calc(100vh - var(--space-16));
  overflow: auto;
  background: var(--bg);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  z-index: var(--z-modal);
}
```

### 5.5 Toasts

```css
.toast {
  display: flex;
  align-items: start;
  gap: var(--space-3);
  inline-size: min(24rem, calc(100vw - var(--space-8)));
  padding: var(--space-4);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
}
.toast-error { border-color: var(--danger); }
.toast-success { border-color: var(--success); }
.toast-warning { border-color: var(--warning); }
```

### 5.6 Chevrons (Aufklapp)

```css
.chevron {
  inline-size: var(--space-4);
  block-size: var(--space-4);
  transition: transform var(--tr-fast) var(--ease-smooth);
  transform-origin: center center;
  color: var(--text3);
}
.chevron[aria-expanded="true"] { transform: rotate(90deg); color: var(--text); }
```

### 5.7 Chips / Badges

```css
.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding-inline: var(--space-2);
  padding-block: var(--space-0_5);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  border-radius: var(--radius-full);
  background: var(--bg2);
  color: var(--text2);
}
.chip[data-feat="matrix"]     { background: var(--feat-matrix-bg); color: var(--feat-matrix-text); }
.chip[data-feat="board"]      { background: var(--feat-board-bg); color: var(--feat-board-text); }
.chip[data-feat="info"]       { background: var(--feat-info-bg); color: var(--feat-info-text); }
.chip[data-feat="checklists"] { background: var(--feat-checklists-bg); color: var(--feat-checklists-text); }
```

### 5.8 Icons

SVG-Inline. Stroke-Width-Konstante via `currentColor` damit sie Color-Tokens folgen.

```css
.icon { inline-size: 1em; block-size: 1em; flex-shrink: 0; }
.icon-sm { inline-size: 0.875em; block-size: 0.875em; }
.icon-lg { inline-size: 1.25em; block-size: 1.25em; }
```

Verwendung: `<svg class="icon" stroke="currentColor" ...>` — Color folgt Parent.

---

## 6. Layout-System

### 6.1 Container-Constraints

```css
.container {
  inline-size: 100%;
  max-inline-size: 80rem;        /* 1280px equivalent */
  margin-inline: auto;
  padding-inline: var(--space-4);
}
@media (min-width: 40rem) { .container { padding-inline: var(--space-6); } }
@media (min-width: 64rem) { .container { padding-inline: var(--space-8); } }
```

### 6.2 Breakpoints (em-basiert fuer Browser-Zoom-Stabilitaet)

| Token / Breakpoint | Wert | Etwa |
|---|---|---|
| `--bp-sm` | `40em` | 640px |
| `--bp-md` | `48em` | 768px |
| `--bp-lg` | `64em` | 1024px |
| `--bp-xl` | `80em` | 1280px |
| `--bp-2xl` | `96em` | 1536px |

Verwendung in CSS: `@media (min-width: 40em)`. Tokens sind Konstanten, kein `var()` in `@media` (Browser-Limitation).

### 6.3 Grid + Flex

Bevorzugt Grid fuer 2D-Layouts, Flex fuer 1D. Beide Token-getrieben:

```css
.grid-cols-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.grid-cols-3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); }
.flex { display: flex; gap: var(--space-2); }
.flex-col { display: flex; flex-direction: column; gap: var(--space-2); }
```

---

## 7. Accessibility (WCAG 2.2 AA)

### 7.1 Kontrast

`--text` auf `--bg`: ≥ 7:1 (AAA).
`--text2` auf `--bg`: ≥ 4.5:1 (AA).
`--text3` auf `--bg`: ≥ 3:1 (AA-Large).
Buttons: `--text-inverse` auf `--accent`: ≥ 4.5:1.

Wenn ein Color-Token diese Schwellen unterbietet → korrigieren, nicht ignorieren.

### 7.2 Focus

Pflicht: `:focus-visible`-Style auf JEDEM interaktiven Element (Button, Link, Input, [role=button]/[tabindex=0]).
Verboten: globaler `*:focus { outline: none }` ohne `:focus-visible`-Pendant.

### 7.3 Semantisches HTML

- `<button>` fuer Actions, `<a>` fuer Navigation.
- `<section>`/`<article>`/`<header>`/`<footer>`/`<nav>` statt Div-Suppen.
- Heading-Hierarchie ohne Sprung (`h1` → `h2` → `h3`, nicht `h1` → `h3`).
- `<dialog>` oder `[role="dialog"][aria-modal="true"]` fuer Modals.
- `<label for="">` mit `<input id="">` ODER `<label>`-Wrapper.

### 7.4 ARIA

Sparsam — semantisches HTML zuerst. Wenn ARIA, dann korrekt:
- Modal: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`.
- Live-Region (Toasts): `role="status"` (info) / `role="alert"` (error) / `aria-live="polite"`.
- Disclosure (Collapsible): `aria-expanded="true|false"`, `aria-controls="id"`.
- Tablist: `role="tablist"`, Tabs `role="tab"`, Panels `role="tabpanel"`, `aria-selected`.
- Custom-Buttons (Spans mit `onclick`): `role="button"`, `tabindex="0"`, `keydown`-Handler fuer Enter/Space.

### 7.5 Keyboard-Navigation

- Tab-Order folgt visueller Reihenfolge (DOM-Order).
- ESC schliesst Modals/Popovers/Dropdowns.
- Arrow-Keys in Lists/Grids/Tabs (`useArrowListNav`, `useGridNav` Helper).
- Enter/Space aktiviert custom-Buttons.
- Keine Tastatur-Traps ausserhalb von Modals.

### 7.6 Touch-Targets

Mobile (Viewport ≤ 30em): jedes interaktive Element min `2.75rem × 2.75rem` (≈ 44×44px Apple-HIG).

```css
@media (max-width: 30em) {
  .btn, .icon-btn, .chip { min-block-size: 2.75rem; min-inline-size: 2.75rem; }
}
```

---

## 8. Dark-Mode

`<html data-theme="dark">` aktiviert Dark-Tokens. Theme-Toggle setzt das Attribut + persistiert in localStorage.

```css
:root {
  --bg: #ffffff;
  --text: #0f172a;
  /* ... */
}
[data-theme="dark"] {
  --bg: #0f172a;
  --text: #f1f5f9;
  /* ... */
}
```

Niemals `if (theme === 'dark')` im JS fuer Color-Wahl. Immer ueber Tokens.

---

## 9. Responsive-Konvention

Mobile-First. Default-Styles sind Mobile, `@media (min-width: ...)` erweitert nach oben.

```css
.section { padding: var(--space-4); }
@media (min-width: 40em) { .section { padding: var(--space-6); } }
@media (min-width: 64em) { .section { padding: var(--space-8); } }
```

Filter-Pills + Search wrappen frueh, nie horizontal-scrollen. Status-Badges < 30em: nur Color + Icon, kein Text.

---

## 10. Pre-Commit-Style-Selbstcheck

1. Keine `px` ausser Border/Outline/Shadow/Icon-Anker (siehe 1.1).
   Grep: `grep -rn "[0-9]\+px" src/styles.css src/components/ src/routes/` — Treffer pruefen.
2. Keine Hex-Literals ausserhalb `:root`.
   Grep: `grep -rn "#[0-9a-fA-F]\{3,8\}" src/components/ src/routes/` — 0 erwartet.
3. Keine `style="..."` ausser Custom-Property-Set.
   Grep: `grep -rn 'style="' src/components/` — Treffer pruefen.
4. Alle Durations Tokens (siehe animations.md §5).
5. Doublet-Check (siehe 3.3).
6. Focus-visible auf jedem Interactive.
7. Dark-Mode mit DevTools-Toggle gepruefenft.
8. WCAG-Kontrast (`--text2 on --bg` ≥ 4.5:1 etc.).

Wenn **eine** Antwort Nein: Commit blockt.

---

## 11. Bekannte Drift (Audit-Baseline fuer Q.3.B)

Stand 2026-05-01, zu fixen in Q.3.B Style-Sweep:

- Spacing-Tokens aktuell `--space-xs:4 · sm:8 · md:12 · lg:16` (nur 4 Stufen, in px). Migration auf rem-Skala 1.2.
- Typo-Skala: `--fs-title` als clamp-Variante. Migration auf vollstaendige `--text-*` Skala.
- Farb-Tokens: vorhanden, aber nicht alle nach Dark-Override-Kontrast geprueft. Audit.
- Inline-Styles: schaetzungsweise noch vorhanden in Komponenten (vor allem in CardOverlay, BoardView).
- Fehlende Utility-Klassen: viele Komponenten setzen `padding`/`margin` direkt statt Utility.
- Shadow-Tokens: aktuell `--shadow-sm/md/lg`. Erweiterung auf vollstaendige Skala.
- Border-Radius: aktuell `--rs` einzeln. Migration auf `--radius-*`-Skala.

---

## 12. Standing Orders (User 2026-05-02)

**Wenn beim Implementieren ein Style-Token / eine Klasse / ein Pattern fehlt:**

1. **Nicht ad-hoc inline definieren.** Auch nicht "nur lokal in dieser Komponente".
2. **HyperUI-Vorbild waehlen** (hyperui.dev) — dort gibts die Spec.
3. **Global anlegen** (in `:root`-Tokens / `.btn`-/`.card`-/etc.-Klassen / Manifest-Section).
4. **Verdrahten** — die Komponente konsumiert die globale Klasse.
5. **Dokumentieren** — kurzer Abschnitt im passenden Manifest.

Ohne User zu fragen — User testet danach und sieht ob Optimierungsbedarf besteht. Default-Hypothese: HyperUI matched 80% der Use-Cases out-of-the-box.

---

## 13. Aenderungen am Manifest

Nicht ohne Plan-Eintrag und User-Freigabe. Wenn ein neues Visual-Pattern auftaucht (z.B. Carousel, Stepper, Tree-Connector), Manifest erweitern, niemals inline anders machen.
