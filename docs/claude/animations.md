# Animations-Manifest

**Verbindlich. Keine Ausnahmen.** Jede sichtbare Zustands-Aenderung im UI ist animiert. Fehlende Animation = Defekt, gleichwertig wie `alert()` oder `Date.now()` als Position-Default.

**Look-and-Feel:** HyperUI-Eleganz — subtile Hover-Lifts, weiche Schatten-Tiefe, klare Bezier-Easings, grosszuegiges Spacing in `rem`, Focus-Rings mit Offset, Press-Down-Pulse auf Buttons, Slide-In statt Pop-In. Modern, ruhig, taktil.

**Pflicht-Mass-System:** Animation-Distanzen + Spacing in `rem`/`em`/`%`. **`px` nur fuer:** `border-width`, `outline-width`/`outline-offset` (Focus-Ring), `box-shadow` Offsets/Blurs, sehr kleine Icon-Dimensionen wo `0.125rem` Drift das Pixel-Grid bricht (mit Begruendung im Code-Kommentar).

**Wann lesen:** vor jeder UI-Aenderung — Show/Hide, Tab-Wechsel, Drill-Down, Modal-Open, Drag, Filter, Loading, Dropdown, Toast, Card-Insert, Hover, Focus.

**Wann nicht animieren:** nie. Ausnahme: `prefers-reduced-motion: reduce` → alle Durations 0ms (Pflicht-Override am Ende).

---

## 1. Foundation-Tokens

Definiert in `:root` (`packages/client-standalone/matrix.html`) und `packages/client-web/src/styles.css`. **Nie inline.** Globale Single-Source.

### 1.1 Durations

| Token | Wert | Verwendung |
|---|---|---|
| `--tr-instant` | `75ms` | Hover-Color-Wechsel, Tooltip-Show, Button-Press-Visual |
| `--tr-fast` | `150ms` | Chevron-Rotate, List-Item-Stagger-Cascade, Checkbox-Toggle, Hover-Lift |
| `--tr-base` | `200ms` | Standard fuer alle Transitions ohne speziellen Charakter |
| `--tr-enter` | `220ms` | Modal-Open, Toast-Slide-in, Card-Insert, Page-Enter |
| `--tr-exit` | `160ms` | Modal-Close, Toast-Dismiss, Element-Remove |
| `--tr-slow` | `300ms` | Tab-Wechsel, Filter-Slide, Drill-Down/Up, Layout-Shift |
| `--tr-slower` | `500ms` | Page-weite Transitions, Theme-Wechsel |

### 1.2 Easings

| Token | Wert | Charakter |
|---|---|---|
| `--ease-linear` | `linear` | Skeleton-Shimmer, Loading-Pulse |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Enter — schnell raus, sanft ankommen |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exit — sanft starten, beschleunigt verlassen |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | Standard fuer Wechsel/Move |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Spring-Overshoot fuer Card-Drop, Modal-Bloom |
| `--ease-smooth` | `cubic-bezier(0.16, 1, 0.3, 1)` | HyperUI-Signature — sanft, taktil, kein Overshoot |

### 1.3 Transform-Origins

| Token | Wert | Verwendung |
|---|---|---|
| `--origin-tl` | `top left` | Sidebar-Aufklapp, Dropdown vom Anchor unten-links |
| `--origin-tr` | `top right` | Dropdown vom Anchor unten-rechts |
| `--origin-tc` | `top center` | Dropdown unter Header |
| `--origin-bc` | `bottom center` | Toast-from-bottom, Bottom-Sheet |
| `--origin-cl` | `center left` | Drawer-from-left |
| `--origin-cr` | `center right` | Drawer-from-right |
| `--origin-cc` | `center center` | Modal, Card-Insert, Default fuer Scale |

### 1.4 Translate-Distanzen (alle `rem`)

| Token | Wert | Verwendung |
|---|---|---|
| `--lift-xs` | `-0.125rem` (≈ 2px) | Hover-Lift fuer kleine Elemente (Chips, Badges) |
| `--lift-sm` | `-0.25rem` (≈ 4px) | Hover-Lift fuer Cards, Buttons |
| `--lift-md` | `-0.5rem` (≈ 8px) | Modal-Bloom Start-Offset, Card-Insert-Slide |
| `--lift-lg` | `-1rem` (≈ 16px) | Page-Enter-Slide, Toast-from-top |
| `--press` | `0.0625rem` (≈ 1px) | Active-Press-Down (oder scale-Variante, siehe 2.13) |

### 1.5 Scale-Faktoren

| Token | Wert | Verwendung |
|---|---|---|
| `--scale-press` | `0.98` | Button-Active-Press |
| `--scale-pulse-up` | `1.03` | Click-Pulse-Highscale |
| `--scale-pop-in` | `0.94` | Modal/Card-Initial-Scale fuer Bloom-In |
| `--scale-pop-out` | `1.04` | Modal-Initial-Scale fuer Pop-Out (Drill-Down) |

---

## 2. Pflicht-Pattern pro UI-Event

Jedes Pattern ist verbindlich. Implementiert via Helper in `lib/animations.ts` (Solid + Standalone teilen die Konvention; Standalone-Pendant lebt inline).

Konvention: alle Helper async (returnen Promise → `transitionend`/`animationend`). `prefers-reduced-motion: reduce` short-circuited zum sofortigen Klassen-Toggle.

### 2.1 Hover-Lift (Cards, Buttons, interaktive Tiles)

HyperUI-Signature. Element hebt sich subtil + Schatten-Tiefe waechst.

```css
.lift {
  transition:
    transform var(--tr-fast) var(--ease-smooth),
    box-shadow var(--tr-fast) var(--ease-smooth);
}
.lift:hover {
  transform: translateY(var(--lift-sm));
  box-shadow: var(--shadow-lg);
}
.lift:active {
  transform: translateY(0) scale(var(--scale-press));
  box-shadow: var(--shadow-sm);
  transition: transform var(--tr-instant) var(--ease-out);
}
```

Anwendung: Kanban-Cards, Tile-Buttons, Provider-Slots, Stats-Cards.

### 2.2 Focus-Ring (Tastatur-Navigation)

Token-basiert, animiert beim Erscheinen. **Nie** `*:focus { outline: none }`.

```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius);
  transition:
    outline-color var(--tr-instant) var(--ease-smooth),
    outline-offset var(--tr-instant) var(--ease-smooth);
}
```

### 2.3 Button-Press-Pulse

Click-Bestaetigung. Scale-Down beim Druck, Spring zurueck beim Loslassen.

```css
.btn {
  transition:
    transform var(--tr-fast) var(--ease-spring),
    background-color var(--tr-fast) var(--ease-smooth),
    box-shadow var(--tr-fast) var(--ease-smooth);
}
.btn:active { transform: scale(var(--scale-press)); }
```

### 2.4 Page-Enter (Route-Wechsel)

Neuer Content faded ein, slidet `--lift-md` nach oben.

```css
.page-enter {
  opacity: 0;
  transform: translateY(var(--lift-md));
  animation: pageEnter var(--tr-enter) var(--ease-smooth) forwards;
}
@keyframes pageEnter {
  to { opacity: 1; transform: translateY(0); }
}
```

Helper: `pageEnter(el)`. In Route-`onMount` aufrufen, nach `requestAnimationFrame`.

### 2.5 List-Stagger (Initial-Render)

Erste 8–12 Items mit 30 ms-Stagger, Rest instant.

```css
.list-item-enter {
  opacity: 0;
  transform: translateY(var(--lift-xs));
  animation: listItemEnter var(--tr-fast) var(--ease-smooth) forwards;
}
.list-item-enter:nth-child(1) { animation-delay: 0ms; }
.list-item-enter:nth-child(2) { animation-delay: 30ms; }
/* … bis 12, danach kein Delay */
@keyframes listItemEnter {
  to { opacity: 1; transform: translateY(0); }
}
```

Helper: `listStaggerEnter(container, itemSelector)`.

### 2.6 Cross-Direction-Slide (Filter / Monats- / Tages-Wechsel)

Alter Inhalt slidet raus (Richtung X), neuer slidet rein (Gegenrichtung). Crossfade gleichzeitig.

```css
.slide-out-left  { animation: slideOutLeft  var(--tr-slow) var(--ease-in-out) forwards; }
.slide-in-right  { animation: slideInRight  var(--tr-slow) var(--ease-in-out) forwards; }
.slide-out-right { animation: slideOutRight var(--tr-slow) var(--ease-in-out) forwards; }
.slide-in-left   { animation: slideInLeft   var(--tr-slow) var(--ease-in-out) forwards; }

@keyframes slideOutLeft  { to   { opacity: 0; transform: translateX(-100%); } }
@keyframes slideInRight  { from { opacity: 0; transform: translateX(100%); } to { opacity: 1; transform: translateX(0); } }
@keyframes slideOutRight { to   { opacity: 0; transform: translateX(100%); } }
@keyframes slideInLeft   { from { opacity: 0; transform: translateX(-100%); } to { opacity: 1; transform: translateX(0); } }
```

Helper: `slideHorizontal(direction, oldEl, newEl)`.

### 2.7 Drill-Down (Matrix-Zoom-In)

Old-Layer skaliert auf `--scale-pop-out` + faded auf 0. New-Layer kommt von `--scale-pop-in` + faded auf 1. **Pflicht** — fehlt aktuell, ist Defekt.

```css
.drill-down-out {
  animation: drillDownOut var(--tr-slow) var(--ease-smooth) forwards;
  transform-origin: var(--origin-cc);
}
.drill-down-in {
  animation: drillDownIn  var(--tr-slow) var(--ease-smooth) forwards;
  transform-origin: var(--origin-cc);
}
@keyframes drillDownOut {
  to { opacity: 0; transform: scale(var(--scale-pop-out)); }
}
@keyframes drillDownIn {
  from { opacity: 0; transform: scale(var(--scale-pop-in)); }
  to   { opacity: 1; transform: scale(1); }
}
```

Helper: `drillDown(oldEl, newEl)` / `drillUp(oldEl, newEl)` (umgedrehte Skalen).

### 2.8 Sidebar-Aufklapp / Chevron + Collapsible

Chevron rotiert 0deg → 90deg. Inhalt expandiert via `max-height: 0 → scrollHeight`.

```css
.chevron {
  transition: transform var(--tr-fast) var(--ease-smooth);
  transform-origin: var(--origin-cc);
}
.chevron[aria-expanded="true"] { transform: rotate(90deg); }

.collapsible {
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  transition:
    max-height var(--tr-slow) var(--ease-smooth),
    opacity var(--tr-fast) var(--ease-smooth);
}
.collapsible[data-open="true"] {
  max-height: var(--collapsible-natural, 100vh);
  opacity: 1;
}
```

JS setzt `--collapsible-natural` direkt vor dem Toggle auf `el.scrollHeight + 'px'` (px hier zwingend, weil scrollHeight in px kommt — Token-Free-Pass weil Runtime-derived). Nach `transitionend` auf `max-height: none` setzen, damit nachfolgendes Resize sauber durchschlaegt.

Helper: `bindCollapsible(triggerEl, contentEl)`. **Anti-Pattern:** `display: none`-Toggle. Verboten.

### 2.9 Modal-Open (Bloom)

Backdrop faded 0 → 1. Dialog skaliert `--scale-pop-in` → 1 + faded mit Spring-Easing.

```css
.modal-backdrop {
  opacity: 0;
  transition: opacity var(--tr-enter) var(--ease-smooth);
}
.modal-backdrop[data-open="true"] { opacity: 1; }

.modal-dialog {
  opacity: 0;
  transform: scale(var(--scale-pop-in));
  transform-origin: var(--origin-cc);
  transition:
    opacity   var(--tr-enter) var(--ease-spring),
    transform var(--tr-enter) var(--ease-spring);
}
.modal-dialog[data-open="true"] {
  opacity: 1;
  transform: scale(1);
}
```

Close: `--tr-exit` mit `--ease-in`. DOM-Remove im `transitionend`.

Helper: `openModal(backdrop, dialog)` / `closeModal(backdrop, dialog)`.

### 2.10 Drawer / Sheet (Side-In)

Drawer slidet von `100%` ueber Seite. `transform-origin` matched die Seite.

```css
.drawer {
  position: fixed;
  inset-block: 0;
  inset-inline-end: 0;
  transform: translateX(100%);
  transition: transform var(--tr-slow) var(--ease-smooth);
}
.drawer[data-open="true"] { transform: translateX(0); }
```

### 2.11 Toast-Enter / Dismiss

Slidet von rechts (`100%` → `0`). Auto-Dismiss faded mit `--tr-exit`.

```css
.toast {
  opacity: 0;
  transform: translateX(100%);
  transition:
    opacity   var(--tr-enter) var(--ease-smooth),
    transform var(--tr-enter) var(--ease-smooth);
}
.toast[data-state="visible"] { opacity: 1; transform: translateX(0); }
.toast[data-state="leaving"] {
  opacity: 0;
  transform: translateX(0);
  transition: opacity var(--tr-exit) var(--ease-in);
}
```

### 2.12 Drag-Source / Drop-Target

```css
.drag-source {
  opacity: 0.5;
  cursor: grabbing;
  transition: opacity var(--tr-fast) var(--ease-smooth);
}
.drop-target {
  transition:
    outline-color var(--tr-fast) var(--ease-smooth),
    background-color var(--tr-fast) var(--ease-smooth);
}
.drop-target--active {
  outline: 2px solid var(--accent);
  background-color: var(--accent-soft);
  animation: dropPulse 600ms infinite var(--ease-in-out);
}
@keyframes dropPulse {
  0%, 100% { outline-width: 2px; }
  50%      { outline-width: 4px; }
}
```

Drop-Animation: scale `1.04` → `1` mit `--ease-spring` auf dem Item.

### 2.13 Card-Insert / Item-Add

```css
.card-insert {
  opacity: 0;
  transform: translateY(calc(-1 * var(--lift-md)));
  animation: cardInsert var(--tr-enter) var(--ease-smooth) forwards;
}
@keyframes cardInsert {
  to { opacity: 1; transform: translateY(0); }
}
```

Bulk-Insert: Stagger 30 ms wie List-Stagger (2.5).

### 2.14 Loading-Skeleton (Shimmer)

Statt Spinner. Shimmer-Gradient, 1.5 s Dauerschleife.

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--bg2) 0%,
    var(--bg-hover) 50%,
    var(--bg2) 100%
  );
  background-size: 200% 100%;
  border-radius: var(--radius);
  animation: skeletonShimmer 1500ms infinite var(--ease-linear);
}
@keyframes skeletonShimmer {
  to { background-position: -200% 0; }
}
```

### 2.15 Click-Pulse (Aktions-Bestaetigung)

```css
.click-pulse { animation: clickPulse var(--tr-enter) var(--ease-spring); }
@keyframes clickPulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(var(--scale-pulse-up)); }
}
```

### 2.16 Theme-Wechsel (Dark/Light Toggle)

Body-`transition` auf `background-color` + `color` mit `--tr-base`. Children mit `inherit` faden mit. Keine harten Farb-Sprünge.

```css
:root {
  transition:
    background-color var(--tr-base) var(--ease-smooth),
    color var(--tr-base) var(--ease-smooth);
}
```

### 2.17 Dropdown-Open (Menue)

Slidet leicht von oben + faded ein.

```css
.dropdown {
  opacity: 0;
  transform: translateY(calc(-1 * var(--lift-xs))) scale(var(--scale-pop-in));
  transform-origin: var(--origin-tc);
  transition:
    opacity   var(--tr-enter) var(--ease-smooth),
    transform var(--tr-enter) var(--ease-smooth);
  pointer-events: none;
}
.dropdown[data-open="true"] {
  opacity: 1;
  transform: translateY(0) scale(1);
  pointer-events: auto;
}
```

### 2.18 Tooltip-Show

Schnell ein, schnell aus.

```css
.tooltip {
  opacity: 0;
  transform: translateY(var(--lift-xs));
  transition:
    opacity   var(--tr-instant) var(--ease-smooth),
    transform var(--tr-instant) var(--ease-smooth);
}
.tooltip[data-visible="true"] {
  opacity: 1;
  transform: translateY(0);
}
```

### 2.19 Tab-Indicator-Slide

Active-Tab-Underline gleitet zur neuen Position via `transform: translateX`.

```css
.tab-indicator {
  position: absolute;
  inset-inline-start: 0;
  inset-block-end: 0;
  block-size: 2px;
  background: var(--accent);
  transition: transform var(--tr-base) var(--ease-smooth);
  /* JS setzt --tab-x + --tab-w basierend auf aktivem Tab */
  transform: translateX(var(--tab-x));
  inline-size: var(--tab-w);
}
```

### 2.20 Page-Transition zwischen Routen

Out: faded + slidet `--lift-sm` nach oben. In: kommt von unten + faded.

Helper: `routeTransition(oldEl, newEl)` mit `--tr-slow`.

---

## 3. Anti-Pattern (sofort durchfallen)

- **`display: none`-Swap** ohne Animation. Stattdessen `max-height` + `opacity` oder `visibility` + `opacity` + `transitionend`-Cleanup.
- **`visibility: hidden`-Swap mit `transition`** ohne `opacity`. Visibility ist nicht animierbar.
- **`setTimeout`-Animation.** CSS + `animationend`/`transitionend` ist autoritativ.
- **Animation ohne `transform-origin`.** Default `center center` ist fuer Sidebar/Dropdown/Toast falsch. Origin explizit aus 1.3.
- **Inline-Animation-Properties.** `style="transition: opacity 0.2s"` ist verboten — Token-Pflicht.
- **`px` in Animation-Distanzen.** `translateY(8px)` etc. ist verboten — `--lift-*`-Token (alle in `rem`).
- **Hartes Hex/ms in Animation-Werten.** Durations + Easings + Distanzen sind alle Tokens.
- **Animation-Dauer > 320 ms** ohne Code-Kommentar mit Begruendung.
- **Animation-Dauer < 75 ms** ohne Begruendung. Unter Wahrnehmungsschwelle — entweder instant ohne Animation oder min `--tr-instant`.
- **Globaler `*:focus { outline: none }`.** Verboten — Accessibility-Killer. Scope nur auf konkrete UI-Elemente, immer mit `:focus-visible`-Pendant.
- **Fehlender `prefers-reduced-motion`-Override.** Pflicht-Block am Ende der CSS:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```

---

## 4. Helper-Library `lib/animations.ts`

Einzige Stelle. **Nichts dupliziert.** Globale Single-Source. Alle Komponenten konsumieren von hier.

```ts
// Lifecycle-Helpers (async, prefers-reduced-motion-aware)
export function pageEnter(el: HTMLElement): Promise<void>;
export function listStaggerEnter(container: HTMLElement, itemSelector: string): void;
export function slideHorizontal(direction: 'left'|'right', oldEl: HTMLElement, newEl: HTMLElement): Promise<void>;
export function drillDown(oldEl: HTMLElement, newEl: HTMLElement): Promise<void>;
export function drillUp(oldEl: HTMLElement, newEl: HTMLElement): Promise<void>;
export function bindCollapsible(triggerEl: HTMLElement, contentEl: HTMLElement): () => void;
export function openModal(backdrop: HTMLElement, dialog: HTMLElement): void;
export function closeModal(backdrop: HTMLElement, dialog: HTMLElement): Promise<void>;
export function openDrawer(drawerEl: HTMLElement): void;
export function closeDrawer(drawerEl: HTMLElement): Promise<void>;
export function showToastWithAnimation(toastEl: HTMLElement): Promise<void>;
export function clickPulse(el: HTMLElement): void;
export function fadeSwap(oldEl: HTMLElement, newEl: HTMLElement): Promise<void>;
export function routeTransition(oldEl: HTMLElement, newEl: HTMLElement): Promise<void>;

// Hook-Style fuer Solid (nutzt onCleanup intern)
export function useHoverLift(elRef: () => HTMLElement | undefined): void;
export function useFocusRing(elRef: () => HTMLElement | undefined): void;
export function useDropdownAnimation(triggerRef: () => HTMLElement | undefined, dropdownRef: () => HTMLElement | undefined): {
  open: () => Promise<void>;
  close: () => Promise<void>;
};

// Utility
export function prefersReducedMotion(): boolean;
export function waitTransition(el: HTMLElement, property?: string, timeoutMs?: number): Promise<void>;
```

Implementations-Hinweise:
- Alle Async-Helper resolven bei `transitionend`/`animationend`. Timeout-Fallback bei `prefersReducedMotion()` (immediate resolve) oder bei haengender Animation (`timeoutMs` default `tr-slow * 2`).
- Helper akzeptieren bereits gemountete DOM-Elemente — kuemmern sich nicht um Mount/Unmount.
- Solid-Hooks registrieren `onCleanup` intern — Caller muss nichts tun.

---

## 5. Pre-Commit-Animation-Selbstcheck

Vor jedem Commit, bei UI-relevanten Aenderungen:

1. Hat jeder neue Show/Hide eine Animation? (`max-height`/`opacity`, kein `display: none`)
2. Hat jeder neue Modal-Open eine `openModal()`-Verwendung?
3. Hat jeder neue Tab/Filter/Page-Wechsel eine `slideHorizontal`/`pageEnter`-Verwendung?
4. Hat jede neue Liste eine `listStaggerEnter` beim Initial-Render?
5. Sind alle Durations Tokens (`--tr-*`)? (Grep `grep -rn "transition.*[0-9]\+ms" src/` → muss 0 Treffer ausserhalb `:root` ergeben)
6. Sind alle Easings Tokens (`--ease-*`)? (Grep `cubic-bezier` → nur in `:root` erlaubt)
7. Sind alle Translate-Distanzen Tokens? (Grep `translateY([^-)]*px` → 0 Treffer)
8. Setzt jede Scale-Animation `transform-origin` explizit?
9. Hat jedes Hover-Element ein `:focus-visible`-Pendant?
10. Funktioniert das UI mit DevTools-Toggle `prefers-reduced-motion: reduce`?

Wenn **eine** Antwort Nein: Commit blockt.

---

## 6. Bekannte Defekte

Stand 2026-05-01 nach Q.3.A-Sweep:

**Behoben in Q.3.A** (alle 6 Audit-Defekte):

- ~~Sidebar-Mini-Calendar Aufklapp-Chevrons~~ → `.sb-cal-mini-month` / `.sb-cal-mini-expand-row` mit `sbCalMonthEnter` Card-Insert beim Mount.
- ~~Matrix-Drill-Down/Up~~ → View-Transitions API via `drillNavigate(nav, href, 'down'|'up')` aus `lib/animations.ts`. CSS scope `.ws-main` via `view-transition-name`. Integriert in `MatrixView.enterCellNonEdit` (down) + Breadcrumb-Click (up). Silent-Fallback auf instant-navigate in Browsern ohne API.
- ~~NodeTree-Expand~~ → `.tree-children` UL mit `treeChildrenIn`-Animation beim Mount. V1-Tradeoff: Close-Path bleibt instant (Solid-`<Show>`-Constraint).
- ~~CardOverlay-Open~~ + ~~CommandPalette-Open~~ → `.overlay-card` global auf Pattern §2.9 migriert: `scale(--scale-pop-in)` Pure-Bloom, transform-origin: center, --ease-spring via --tr-enter. Trifft auch alle anderen `.overlay-card`-Modale.
- ~~Toast-Enter~~ → `@keyframes toastIn` jetzt `translateX(calc(-1 * --lift-lg)) scale(--scale-pop-in)` mit explizitem --ease-smooth.

**Foundation-Komplettierung in Q.3.A:** Token-Suite §1.1-1.5 in `:root` ergaenzt (legacy `--tr-std`/`--tr-enter` bleiben fuer ~90 nicht angefasste Stellen). Helper-Library um `drillDown`/`drillUp`/`bindCollapsible`/`openModal`/`closeModal`/`drillNavigate` erweitert. Pattern-Klassen `.drill-down-*`/`.drill-up-*`/`.chevron-rotate`/`.collapsible`/`.modal-bloom-*`/`.lift` global verfuegbar.

**Behoben in Folge-Sprints (post-Q.3.A):**

- ~~Provider-Slot-Cards~~ → `.lift`-Helper-Klasse auf `ProviderSlotCard` (Admin/Config Welle B Folge).
- ~~Login-Page~~ → Pattern 2.4 `loginPageEnter` + 2.1 `.lift` auf SSO-Buttons (B.1.A/B Sprint).
- ~~Modal-Close-Pattern~~ → `ModalTransition`-Wrapper + `[data-state="leaving"]` Exit-Animation auf `.overlay-scrim` / `.overlay-card`. CommandPalette migriert; weitere Modale (CardOverlay, ImportDialog, Wizards) sind drop-in-migrierbar via `<ModalTransition when={open()}>`-Wrap.
- ~~NodeTree-Collapse-Animation~~ → `.tree-children-wrap` mit `grid-template-rows: 0fr → 1fr`-Trick. Children IMMER gerendert sobald `hasChildren()` (Performance-Tradeoff: O(n) bei vollem Tree). Open + Close beide smooth.

---

## 7. Aenderungen an diesem Manifest

Nicht ohne Plan-Eintrag und User-Freigabe. Wenn ein neues UI-Pattern auftaucht (Bottom-Sheet, Carousel, Stepper-Indicator), dieses Manifest erweitern, **niemals inline anders machen**.
