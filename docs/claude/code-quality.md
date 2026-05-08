# Code-Quality-Manifest

**Verbindlich. Globale Single-Source.** Code-Qualitaet ist nicht verhandelbar — auch nicht unter "V1-pragmatisch". Pragmatik gilt **UX-Scope** (welches Feature wann), niemals Engineering-Tiefe. Eine Doublette = Review-Stop, gleichwertig wie `alert()` oder `Date.now()`-Position-Default.

**Wann lesen:** vor jedem `npm run lint`, vor jedem Commit, vor jeder neuen Library-Funktion, vor jedem PR.

**Look-and-Feel-Standard:** Code liest sich wie ein wohlgeordnetes Dokument — semantisch, redundanzfrei, getypt, dokumentiert wo non-obvious.

---

## 1. Doublet-Verbot (Pflicht)

**Jede Funktion / jeder Type / jede CSS-Klasse / jedes Token / jeder Hook lebt an genau einer Stelle.** Wenn eine Funktion in zwei Dateien existiert (auch unter anderem Namen, aehnliche Logik), ist eine zu viel.

### 1.1 Pre-Commit-Doublet-Check

Vor jedem Commit:

```bash
# Suche nach existing Helpern in der Library
grep -rn "^export function\|^export const" packages/client-web/src/lib/

# Suche nach existing Types
grep -n "^export type\|^export interface" packages/client-web/src/lib/types.ts

# Suche nach existing CSS-Klassen
grep -n "^\." packages/client-web/src/styles.css
```

Bevor ich eine neue Funktion `formatMyDate()` schreibe — gibt es eine `formatDateDE()` oder `isoDate()`? Wenn ja: erweitern, nicht duplizieren.

### 1.2 Aehnlichkeits-Heuristik

Wenn zwei Funktionen folgende Faktoren teilen, sind sie Doubletten:
- gleiche Input-Shape (selbe Argumente)
- gleicher Output-Shape (selbe Returns)
- ≥70% gleiche Logic (modulo Variablen-Namen)

Aktion: existing Funktion erweitern via:
- Optional-Parameter mit Defaults
- Generics
- Strategy-Pattern (Funktion als Argument)

### 1.3 Anti-Doublet-Patterns

```ts
// FALSCH — zwei Funktionen mit gleicher Logik
function getCardLabel(card: KbCardRow): string { return card.name || '(Karte)'; }
function cardDisplayLabel(c: KbCardRow): string { return c.name || '(Karte)'; }

// RICHTIG — eine, in lib/projections.ts oder lib/labels.ts
export function cardLabel(card: KbCardRow): string { return card.name || '(Karte)'; }

// FALSCH — gleiches Date-Format an drei Stellen inline
const a = new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const b = new Date(iso2).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

// RICHTIG — einmal in lib/dates.ts
export function formatDateDE(iso: string): string { ... }
```

### 1.4 Komponenten-Doubletten

Wenn zwei Komponenten 80% gleiche Struktur haben (z.B. zwei Modal-Layouts mit unterschiedlichen Bodies):
- Generische Komponente in `components/Modal.tsx` mit `children`-Slot
- Spezifische Wrapper konsumieren

### 1.5 Style-Doubletten

CSS-Doubletten: identische Properties an zwei Klassen → in eine Klasse extrahieren (Utility) oder die zweite via `@extend`-Pattern (BEM-Modifier).

```css
/* FALSCH */
.btn-primary { padding: var(--space-2) var(--space-4); border-radius: var(--radius-md); ... }
.btn-danger  { padding: var(--space-2) var(--space-4); border-radius: var(--radius-md); ... }

/* RICHTIG — Base-Klasse + Modifier */
.btn         { padding: var(--space-2) var(--space-4); border-radius: var(--radius-md); ... }
.btn-primary { background: var(--accent); }
.btn-danger  { background: var(--danger); }
```

---

## 2. Dead-Code-Verbot

Ungenutzte Exports, ungenutzte Imports, ungenutzte Variablen, ungenutzte Files = Reviewstop.

### 2.1 Tooling-Pflicht (Pre-Commit)

```bash
# TypeScript-Check (kein noUnusedLocals-Bypass)
npx tsc --noEmit

# Biome — alle Regeln aktiv
npx biome check --error-on-warnings src/

# Ungenutzte Exports (knip oder ts-unused-exports — als CI-Job)
npx knip --production
```

`tsconfig.json` muss aktiv haben:
- `"strict": true`
- `"noUnusedLocals": true`
- `"noUnusedParameters": true`
- `"noFallthroughCasesInSwitch": true`
- `"noImplicitReturns": true`
- `"exactOptionalPropertyTypes": true` (V2-Ziel)

### 2.2 Auskommentierter Code = Loeschen

Kein `// const oldThing = ...` im Commit. Wenn ein Codeblock spaeter wieder relevant werden koennte, wandert er in Git-History (siehe `git log -S '<term>'`), nicht in den Source.

### 2.3 TODO/FIXME-Hygiene

TODO-Kommentare nur mit:
- konkretem Trigger (`// TODO bei Welle B.2 unenrollMfa-Audit-Event hinzufuegen`)
- Owner (impliziter User, da Solo-Projekt)
- Plan-Datei-Verweis wo machbar

`// TODO: cleanup later` ohne Trigger ist verboten — entweder jetzt machen oder in Plan/BACKLOG.

### 2.4 Unbenutzte Files

Module, die niemand importiert, wandern in Git-History. Detektion:

```bash
# Findet Files die exports haben, aber nicht importiert sind
npx ts-unused-exports tsconfig.json --findCompletelyUnusedFiles
```

---

## 3. Type-Safety (Strict)

### 3.1 Verbote

- `any` ist verboten. Wenn der Server-Shape unklar: `unknown` + Type-Guard.
- `as <Type>`-Casts sind verboten. Ausnahmen:
  - PostgREST-Returns aus `supabase.from('...').select(...)` (Library-Untyped, OK).
  - Bekannte runtime-validated JSONB-Felder (z.B. `display_meta as Record<string, unknown>`).
- `// @ts-ignore` ist verboten. `// @ts-expect-error` nur mit dt.-Begruendung in derselben Zeile (z.B. `// @ts-expect-error fix mit T.AC.B.2 deferred`).
- `as any` / `as unknown as <T>` doppelter Cast ist verboten ausser bei dokumentierten Library-Limitationen (`@supabase/supabase-js` postgres_changes-Event-Type, biome-ignore mit Begruendung).

### 3.2 Type-Predicate-Pattern (statt `!`-Assertions)

```ts
// FALSCH
const ids = items.filter(it => it.id != null).map(it => it.id!);

// RICHTIG
const ids = items
  .filter((it): it is typeof it & { id: string } => it.id != null)
  .map(it => it.id);
```

Memory-Pattern: `feedback_type_predicate_filter.md`. `mustRemap`-Helper-Pattern fuer Map-Lookups mit Pre-Pass-Vertrag (`feedback_must_remap_helper.md`).

### 3.3 JSONB-Validation an Datenfluss-Grenzen

Wenn JSONB ins Frontend kommt (z.B. `cell.data`, `task.attrs`), Zod-Schema oder Type-Guard an der Grenze. Nicht uebers Programm verteilt jeden Zugriff casten.

### 3.4 Discriminated Unions fuer Polymorphie

```ts
// RICHTIG
type AtomManifestation =
  | { atom_type: 'task';      atom_id: string; ... }
  | { atom_type: 'link';      atom_id: string; ... }
  | { atom_type: 'checklist'; atom_id: string; ... };

function describe(m: AtomManifestation) {
  switch (m.atom_type) {
    case 'task':      return `Task: ${m.atom_id}`;
    case 'link':      return `Link: ${m.atom_id}`;
    case 'checklist': return `Checklist: ${m.atom_id}`;
  }
}
```

### 3.5 Read-Only wo moeglich

- Konstanten als `as const`
- Arrays als `readonly T[]` wenn Caller nicht mutieren soll
- Object-Properties als `readonly` wenn Set-once

---

## 4. Standards-Compliance

### 4.1 WCAG 2.2 AA (Pflicht)

Detail in `style.md` §7. Hier nur die Konsequenzen fuer Code:
- Jedes interaktive Element hat `:focus-visible`-Style.
- Custom-Buttons (Spans mit onClick) bekommen `role="button"`, `tabindex="0"`, `keydown`-Handler fuer Enter/Space.
- Modals haben `role="dialog"`, `aria-modal="true"`, Focus-Trap, Restore.
- Live-Regions (Toasts) mit `role="status"` (info) / `role="alert"` (error).
- Headings linear (`h1` → `h2` → `h3`, kein Sprung).
- Form-Inputs mit `<label for="">` oder Wrapper-Label.
- Icons mit Bedeutung: `aria-label`. Decorative: `aria-hidden="true"`.

### 4.2 OWASP-Awareness

- Output-Encoding: nie `innerHTML` mit User-Input. SolidJS rendert auto-escaped, das passt — aber nicht `innerHTML=...` selbst setzen.
- URL-Sanitization: jeder Link-Input durch `sanitizeUrl()` (lehnt `javascript:` / `data:` ab).
- File-Upload (kuenftig): Server-Side validate + Magic-Byte-Check.
- Auth: Supabase-managed, RLS auf jeder Tabelle.
- CSRF: Supabase-JWTs sind Bearer, kein Cookie-Auth, daher CSRF-frei. Bei kuenftigen Cookie-Pfaden: SameSite=Lax + CSRF-Token.
- Secrets: niemals im Code, niemals im Git, niemals in Logs. Master-Keys via Postgres-GUC oder Container-Env.

### 4.3 12-Factor-App

Detail in `standards.md` (referenziert).
- Config aus Env-Variables, niemals hardcoded.
- Build-Time-Konstanten via `import.meta.env.VITE_*`.
- Runtime-Config via fetch von Server (z.B. `auth/v1/settings` fuer Provider-Status).
- Logs auf stdout, kein File-Logging im Container.

### 4.4 Semantic Versioning

`packages/*/package.json` folgt SemVer:
- MAJOR: Breaking Change
- MINOR: Neue Features rueckwaerts-kompatibel
- PATCH: Bugfixes

### 4.5 RFC-Compliance

- E-Mail-Validation: HTML5 `type="email"` + Server-Side via Supabase-Auth.
- URL-Sanitization: WHATWG URL-Spec.
- Datum: ISO 8601 in DB (`date` / `timestamptz`), DE-Format in UI ueber `lib/dates.ts`.
- UUID: v4 (`gen_random_uuid()` in DB, `crypto.randomUUID()` im Client).

---

## 5. Tooling-Pflicht

### 5.1 Pre-Commit-Hook (lokal)

```bash
# Idealerweise via lefthook/husky:
# .husky/pre-commit
npm run lint
npm run typecheck
npm run test:unit
```

In der Praxis: vor jedem Commit manuell:
```bash
cd packages/client-web
npx biome check --error-on-warnings src/
npx tsc --noEmit
```

### 5.2 CI-Pflicht

`.github/workflows/pr.yml` muss laufen:
- `biome check` (kein --write, kein --unsafe — read-only check)
- `tsc --noEmit`
- `vitest run` (alle Test-Suites)
- Optional: knip / ts-unused-exports
- Build-Smoke: `npm run build` fuer client-web

### 5.3 Memory-Pattern: biome JSX-Suppression

`{/* biome-ignore */}` zwischen JSX-Siblings funktioniert NICHT. Inline `// biome-ignore` direkt vor Element/Attribut. Vor jedem Commit `npm run lint` — `biome check --write` reicht nicht, CI braucht `--unsafe` fuer @keyframes/CSS-Quotes/imports + manuelle Fixes fuer a11y. Memory `feedback_biome_jsx_suppression.md`.

### 5.4 biome-ignore-Verbot

**`biome-ignore` ist KEIN Workaround fuer schlechten Code.** Wenn die Pruefung anschlaegt, ist die richtige Antwort der Refactor — nicht die Suppression.

Konkret:
- `useSemanticElements`-Verstoss → Element migrieren (`<dialog>` statt `<div role="dialog">`, `<ul>/<li>` statt `<div role="list">`, `<aside>` fuer non-modale Drawer, `<fieldset>/<legend class="visually-hidden">` fuer Form-Gruppen).
- `useKeyWithClickEvents`-Verstoss auf Backdrop-Click → `<button type="button" tabIndex={-1}>` statt `<div onClick>`. Native ESC kommt vom `<dialog onCancel>`.
- `noNonNullAssertion` (`!`) → Solid `<Show when={x}>{(narrowed) => ...}` mit Render-Function-Pattern.
- `noForEach` → `for ... of` mit `break/continue` (saubere Early-Exit-Semantik).
- Stale `biome-ignore` (suppressions/unused) → ersatzlos entfernen.

`biome-ignore` ist NUR zulaessig wenn es eine **dokumentierte Library-Limitation** gibt, die im Code nicht aufloesbar ist (Beispiel: `@supabase/supabase-js` postgres_changes-Event-Type-Cast). Begruendung muss in der Suppression-Zeile stehen.

Niemals `biome-ignore` benutzen weil "Refactor zu aufwendig" oder "Pattern ist etabliert". Das ist Umgehen der Pruefung. Wenn 5 Files denselben Workaround brauchen, ist der Refactor 5× mehr Aufwand — aber er ist trotzdem die richtige Antwort.

### 5.5 Test-Pflicht-Mapping

| Aenderungs-Trigger | Test-Pflicht |
|---|---|
| Neue MCP-Tool | Vitest Schema + Integration-Count |
| Neue safe-mutation-Wrapping | manuelle Smoke (online + offline-DevTools) |
| Neue UI-Komponente | manuelle Smoke (Hover, Focus, Keyboard, Mobile, Dark) |
| Schema-Migration | `to_regclass`-Smoke + count-Diff vor/nach |
| Realtime-Subscribe | 2-Tab-Smoke (Tab A mutiert, Tab B sieht Update ohne Reload) |
| Export/Import | Roundtrip-Test (Export → Wipe → Import → identical State) |

### 5.6 Post-Push Deploy-Verifikation (Pflicht)

**Nach jedem `git push origin main`** — und vor allem nach jedem
Welle-/Sub-Sprint-Abschluss — den GitHub-Actions-Deploy-Workflow
pollen + Ergebnis melden. Stille Deploy-Failures sind der
schlimmste Fehler-Modus: Code ist gepusht, Pipeline rot, Staging
auf altem Build, niemand merkt's.

**Workflow:**

```bash
# Repo ist public, keine Auth noetig:
curl -s "https://api.github.com/repos/LEVCON-AT/Infinite-Matrix/actions/runs?per_page=1" \
  -o /c/temp/run.json
# Status auswerten — `status` ∈ {queued|in_progress|completed},
# `conclusion` ∈ {success|failure|cancelled|skipped|null}.
```

**Cadence:**

- Erste Pruefung: ~15-30 Sekunden nach Push (Run muss registriert
  sein, einmal-curl).
- Bei `in_progress`: **`ScheduleWakeup` mit 240-270 Sekunden** — eine
  Anthropic-Cache-Window-Laenge (TTL 300s). Workflow laeuft typisch
  2-3 Minuten, der Wakeup faengt das Ergebnis im warmen Cache ein.
  Wakeup-Prompt enthaelt die Run-URL + Erwartung („bei failure: Steps
  holen, lokal reproduzieren, fixen + pushen"). Kein Polling-Loop
  in Bash (`until ...; do sleep`-Pattern ist runtime-blockiert).
- Bei mehreren Pushes hintereinander: pro Push ein Wakeup, wenn das
  vorherige Wakeup schon gefeuert ist; sonst ein Wakeup verlaengert
  bis zum letzten Push.
- Wenn Run noch laeuft + es gibt Folge-Arbeit (Konzept-Pass, Memory-
  Pflege): parallel weiter arbeiten, der Wakeup checkt im Hintergrund.

**Failure-Handling:**

1. Jobs+Steps via `/actions/runs/<id>/jobs` holen → fehlgeschlagenen
   Step identifizieren.
2. Logs-API ist auth-gated (403 ohne Token). Reproduzierbare Fails
   (Audit / Lint / Typecheck / Test / Build) lokal nachstellen mit
   den entsprechenden `pnpm`-Skripten.
3. Nicht-reproduzierbare Fails (SSH-Auth, rsync, Smoke-Test gegen
   Live-VPS): Step + bekanntes Symptom dem User melden, **nicht
   blind raten**.
4. Reproduzierbare Fixes: lokal fixen → committen → erneut pushen
   → erneut Workflow-Run beobachten.

**Tools:**

- `gh` CLI ist auf dem Dev-PC NICHT installiert. Direkter
  GitHub-API-Zugriff via `curl` ist der einzige Pfad.
- API-Antworten landen in `/c/temp/run.json` (Windows-Bash-`/tmp`
  haengt nicht zuverlaessig).
- Polling-Loops in Bash (`until ...; do sleep 15; done`) sind
  geblockt — nicht wieder versuchen.

**Verbindlich seit 2026-05-08** (User-Direktive nach Stillem-Failure
mit HIGH-CVE-Audit). Memory-Sicherung: `feedback_post_push_deploy_check.md`.

---

## 6. Globalitaet (Pflicht-Wiederholung)

Detail in `architektur.md` §8 + `style.md` §3. Hier nur die Konsequenzen:

- Helpers global in `lib/` — nie inline in Komponenten.
- Types global in `lib/types.ts` — nie inline in Komponenten.
- CSS-Tokens global in `:root` — nie inline in Components.
- Konstanten domain-global (z.B. `CELL_FEATURES`, `FEAT_COLORS`, `KEYBOARD_SHORTCUTS`).
- Hooks domain-global in `lib/hooks/`.

**Doublet-Detection ist Pflicht** vor jeder neuen Funktion/Type/Klasse.

---

## 6.5 Neue UI-Komponente anlegen — Vorgangsweise (Pflicht)

**Top-Level-Standard.** Verbindlich fuer jede neue UI-Komponente in `packages/client-web/src/components/` und jedes neue Helper-Library-File in `packages/client-web/src/lib/`. Ziel: **Doublet-Praevention ueber Sessions hinweg** — wenn in einer kuenftigen Session (anderer Modell-Snapshot, neuer Conversation-Thread) das Pattern noetig wird, wird die Vorgangsweise hier gefunden und keine Doublette gebaut.

### 6.5.1 Pflicht-Schritte

1. **Audit existing.** Bevor ein Komponenten-File angelegt wird:
   ```bash
   # Aehnliche Komponenten suchen
   Glob: "packages/client-web/src/components/**/*.tsx"
   Grep: <Pattern-Keyword>  # z.B. "Picker", "Modal", "Bulk", "Confirm"
   # Aehnliche Helper suchen
   Glob: "packages/client-web/src/lib/**/*.ts"
   Grep: <Function-Keyword>
   ```
   Wenn ein vergleichbares Pattern existiert: **reuse** statt neu bauen. Doublet-Verbot §1.
2. **Naming.** PascalCase fuer Komponenten (`BulkScalarInput.tsx`), kebab-case fuer Helper (`cell-selection.ts`). Reuse-faehig benennen — generischer Domain-Name, kein Caller-spezifischer.
3. **Globalitaet — Layer-Trennung.** Logik gehoert in `lib/`, Render in `components/`. Komponente konsumiert Logik via Helper-Import, niemals re-implementiert. Bei 2+ absehbaren Callern: Logik **muss** in `lib/`.
4. **Token-Pflicht.** `var(--token)` fuer Color/Spacing/Radius/Shadow/Duration/Easing — gemaess `style.md` §1+§2. Keine Hex-Codes, keine `px` ausser Border/Outline/Shadow/Icon-Anker.
5. **`style.md`-Eintrag (Pflicht bei wiederverwendbarem Pattern).** Wenn die Komponente ein **Pattern** etabliert (Modal-Form, Input-Form, Listen-Form, Toolbar-Form) — Eintrag in `style.md` Komponenten-Standards-Sektion mit:
   - Pattern-Name + Kurzbeschreibung
   - Reuse-Faelle (welche Caller heute / welche absehbar)
   - Komponenten-Path
   - Mindest-Beispiel (Props + Render)
   - Verbindliches Verhalten (Animation, Focus-Trap, Hotkeys, A11y)
6. **Animation-Pflicht.** Sichtbare State-Aenderungen via Helper aus `lib/animations.ts`. Kein direkter `transition:`-Hack, kein `setTimeout`-Choreographie. Detail `animations.md`.
7. **Memory-Verweis bei Querschnitts-Pattern.** Wenn das Pattern UX-praegende Wirkung hat (z.B. „Loesch-Modal mit Export-Doppelboden", „Bulk-Scalar-Input"), Eintrag in MEMORY.md unter `feedback_*.md` als Single-Source-Sicherung. Manifest und Memory referenzieren sich gegenseitig.

### 6.5.2 Wann ein neues Pattern manifestiert werden MUSS

- Neue Komponente hat **2+ absehbare Reuse-Faelle** (heute oder in dokumentierten kommenden Wellen).
- Neue Komponente etabliert eine **UX-Konvention** (Tastenkombination, Drilldown-Behavior, Confirm-Form, Empty-State-Form).
- Neue Komponente loest ein **Pattern-Problem**, das im Manifest noch nicht abgebildet ist.

### 6.5.3 Wann KEIN Manifest-Eintrag noetig

- Page-spezifische Wrapper ohne Reuse-Anspruch (`SettingsTabContent`, `WizardStep3Layout`).
- Triviale Komposition aus existing Komponenten ohne neue Konvention.
- Internes Helper-File mit Single-Caller (aber: dann auch nicht als Komponente, sondern inline).

### 6.5.4 Pre-Commit-Probe

Vor Commit pruefen:
- [ ] Audit existing erfolgt (Glob/Grep dokumentiert in PR-Beschreibung wenn Querschnitts-Pattern).
- [ ] Token statt Hex/px durchgehend.
- [ ] Animation via `lib/animations.ts`-Helper, nicht inline.
- [ ] `style.md`-Eintrag bei wiederverwendbarem Pattern erfolgt.
- [ ] Memory-File angelegt bei Querschnitts-Pattern.
- [ ] Komponente in `__tests__` mit Reuse-Beispiel abgedeckt (mindestens Render + Standard-Interaction).

### 6.5.5 Querverweise

- `style.md` §Komponenten — wo neue Patterns eingetragen werden.
- `architektur.md` §8 Globalitaet — Layer-Trennung lib/ vs components/.
- `animations.md` — Pflicht-Helper.
- `feedback_neue_komponente_vorgangsweise.md` (Memory) — Single-Source-Sicherung.

---

## 7. Kommentare (Pflicht-Hygiene)

### 7.1 Wann kommentieren

- **Why, nicht What.** Code zeigt was passiert — Kommentar erklaert warum.
- **Unintuitive Konsequenz** dokumentieren (z.B. "Sync-Trigger ON CONFLICT DO NOTHING, weil Backfill-Idempotenz").
- **Migration-Trigger** (z.B. "Q.2: task_manifestations ist weg, atom_manifestations ist Single-Source").
- **Externe Konstrainst** (z.B. "Supabase-Realtime erfordert REPLICA IDENTITY FULL fuer DELETE-Payload").

### 7.2 Wann nicht kommentieren

- Self-explanatory Code: `const cards = boardCards.filter(c => !c.archived);` — kein "// filter archived" davor.
- Triviale Setter/Getter.
- "FIXME later" ohne Trigger (siehe §2.3).

### 7.3 Datei-Header

Jede Library-Datei beginnt mit Top-Level-Kommentar:
- Kurzbeschreibung der Verantwortung
- Migration-Hinweise (welche Welle / Sprint hat sie angelegt, was wurde geaendert)
- Referenzen auf verwandte Manifeste (`docs/claude/*.md`)

### 7.4 SQL-Migration-Header

Jede Migration mit Block-Header:
```sql
-- ═══════════════════════════════════════════════════════════════
-- Phase X.Y — <Kurzbeschreibung>
--
-- <Warum diese Migration noetig ist, welches Problem sie loest>
-- <Welche Konsequenzen fuer Code (welche Files muessen syncen)>
-- ═══════════════════════════════════════════════════════════════
```

Plus `COMMENT ON TABLE` / `COMMENT ON COLUMN` fuer non-obvious Sachen.

---

## 8. Error-Handling (Pflicht)

### 8.1 Fehler sind UI

Detail in CLAUDE.md. Hier nur die Konsequenzen fuer Code:

```ts
try {
  await someMutation();
} catch (err) {
  console.error('someMutation:', err);  // Dev-Debug
  showToast(translateDbError(err, 'Aktion konnte nicht ausgefuehrt werden.'), 'error');
}
```

- `console.error` davor fuer Dev-Debugging.
- `translateDbError(err, fallback)` mappt RLS/FK/Network auf dt. Endkunden-Texte.
- Kein `alert()`, niemals.
- Stille Misserfolge sind verboten — entweder Toast oder hart durchwerfen.
- Memory `feedback_user_facing_toasts.md`: kein Tech-Jargon im Toast (kein "RLS denied", kein "duplicate key violates").

### 8.2 Promise-Hygiene

- `await` immer, niemals "fire-and-forget" ausser dokumentiertem `void`-Pattern (`void mergeRows(...)` fuer Cache-Sync).
- `Promise.all` fuer parallele unabhaengige Calls.
- `Promise.allSettled` wenn ein Fehler die anderen nicht killen darf.
- Catch-Blocks ohne Action sind verboten — mindestens `console.warn`.

### 8.3 Network-Error-Differentiation

`isNetworkError(err)` aus `lib/mutation-queue.ts` unterscheidet:
- Network-Error → safe-mutation queued + Cache-Patch
- RLS/FK/Validation → hart durchwerfen, Caller toastet

---

## 9. State-Management (Solid-Spezifisch)

### 9.1 Reactive-Patterns

- `createSignal` fuer atomic state.
- `createMemo` fuer derived state — niemals in JSX inline neu rechnen.
- `createResource` fuer async-Daten mit Suspense-Awareness.
- `createEffect` fuer Side-Effects (Subscribe, Cleanup).
- Niemals Signal-Aufruf im JSX-Body — entweder direkt, oder Memo.

### 9.2 Show-Pattern (statt `&&`)

```tsx
// FALSCH — produziert "0" oder "false" als Text
{count && <div>{count}</div>}

// RICHTIG — Show mit when
<Show when={count() > 0}>
  <div>{count()}</div>
</Show>

// RICHTIG — Show mit callback fuer narrowing
<Show when={user()}>
  {(u) => <div>{u().name}</div>}
</Show>
```

Memory `feedback_solid_show_callback.md`.

### 9.3 onCleanup-Pflicht

Jeder Subscribe (Realtime, EventListener, Interval) registriert `onCleanup`:

```ts
onMount(() => {
  const handler = (e) => { ... };
  document.addEventListener('keydown', handler);
  onCleanup(() => document.removeEventListener('keydown', handler));
});
```

---

## 10. Performance (Pflicht-Awareness)

### 10.1 Reactivity-Granularitaet

- Solid: kein React-Style "alles re-rendert". Komponenten rendern einmal, Reactivity laeuft per-Signal.
- Aber: nicht in Schleifen Signals lesen. `For` / `Index` mit Key-Funktion fuer Listen.

### 10.2 IDB-Performance

- `mergeRows` ist O(n) Insert. Bei grossen Listen Bulk via `putAll`.
- `getByWorkspace` mit `by_workspace`-Index — kein Full-Scan.
- Cache-Writes als `void`-Fire-and-Forget — Read-Path nicht blockieren.

### 10.3 Realtime-Throttle

Presence-Events: max alle 2s ein Update. Mass-Inserts (Bulk-Import): Channel temporaer pausieren oder Debounce.

### 10.4 Bundle-Size

- Vite-Build mit Code-Splitting per Route.
- Dynamic-Import fuer schwere Module (`await import('./recur')`).
- Ueber 200kb Bundle = Audit-Trigger.

---

## 11. Anti-Pattern (sofort durchfallen)

- **Doublet** in lib/, components/, types/, styles/ — Review-Stop.
- **Dead Code** (ungenutzte Exports, auskommentierter Code, leere Catch-Blocks).
- **`any` / `as any` / `// @ts-ignore`** ohne dokumentierte Begruendung.
- **`alert()` / `confirm()` / `prompt()`** im Code.
- **Inline-Styles** ausser dokumentierten Custom-Property-Cases.
- **Inline-Hex/px/ms-Literals** statt Tokens.
- **`console.log` im Production-Code** (nur `console.error`/`console.warn` mit dokumentiertem Grund).
- **TODO ohne Trigger** im Code.
- **Auskommentierter Code** im Commit.
- **Stiller Catch-Block** ohne Action.
- **JSX-Signal-Aufruf in Schleifen** (Reactivity-Overhead).
- **Promise ohne `await`** ausser dokumentiertem `void`-Pattern.
- **Direkte DOM-Mutation in Solid-Komponenten** (use `ref` + onMount).
- **`!`-Assertions** statt Type-Predicate-Filter.
- **Magic-Numbers >= 2x** statt Token.
- **Component-internal Helper, der in zwei Komponenten existiert** — extrahieren.

---

## 12. Pre-Commit-Quality-Selbstcheck

1. `npx tsc --noEmit` clean?
2. `npx biome check --error-on-warnings src/` clean?
3. Doublet-Check: neue Funktion in `lib/` greppt? CSS-Klasse in styles.css greppt?
4. Type-Safety: kein `any`, kein `!`, kein `// @ts-ignore`?
5. Inline-Style/Hex/px-Literals in Components? (Grep)
6. Animation-Selbstcheck (animations.md §5) durch?
7. Style-Selbstcheck (style.md §10) durch?
8. Architektur-Selbstcheck (architektur.md §10) durch?
9. Errors via Toast + translateError? Kein stiller Catch?
10. Auskommentierter Code / TODO ohne Trigger raus?
11. Memory-Files updated falls neue Lessons aus dem Sprint?

Wenn **eine** Antwort Nein: Commit blockt.

**Post-Push-Pflicht:** nach jedem `git push origin main` den
GitHub-Actions-Run pollen — siehe §5.6. Bei `failure` reproduzieren
+ fixen, bei `success` zur naechsten Aufgabe.

---

## 13. Bekannte Drift

Stand 2026-05-08 nach Drift-Sweep (Commits `b6b0968` + `cc2414c`):

**Behoben in Q.3.C (2026-05-01):**

- ~~Doublet-Verdacht `formatDate*`~~ → `lib/dates.ts` mit `formatDateDE` / `formatDateTimeDE` / `formatDateTimeWithSecsDE`. 6 Komponenten konsolidiert (AuditLogSection, ChecklistPanel, CardOverlay, PlatformAdminsSection, StatsSection, recur.ts). Number-Format-`toLocaleString` (z.B. Stats-Counts) bleibt inline — kein Date-Doublet.
- ~~`as any`-Casts~~ → 4 Stellen verifiziert, alle in `lib/realtime.ts` mit dokumentierter biome-ignore + Supabase-Workaround-Erklaerung. Manifest-konform.
- ~~TODO ohne Trigger~~ → 1 Stelle in `routes/Calendar.tsx` Header-Doc, ist Out-of-Scope-Hinweis (Drag-Drop / Atom-Generalisierung), kein Code-Todo.
- **Inline-Styles** → groesstenteils Custom-Property-Set (Manifest-konform). Echte Verstoesse in NodeTree (padding-left in px) und Icon (flex/display hardcoded) per Q.3.B behoben.

**Behoben in Drift-Sweep 2026-05-08 (Commit `cc2414c`):**

- ~~Inline-Styles in Dynamic-Position-Popups~~ → AliasAutocomplete (`--ac-x/y`), ContextMenu (`--cm-x/y`), ObjectSuggestion (`--os-x/y/min-w`) auf CSS-Custom-Properties migriert. position:fixed + max-inline-size + z-index in CSS-Klassen.
- ~~Inline-Styles im Hour-Grid (SidebarDayView)~~ → 9 Custom-Properties (`--sb-day-allday-h`, `--sb-day-grid-h`, `--sb-buf-top/h`, `--sb-hour-top`, `--sb-evt-top/h/left-pct/w-pct`). calc-Geometry fuer Hour-Label-Reserve in CSS-Klasse.

**Behoben in Drift-Sweep 2026-05-08 (Commit `b6b0968`):**

- ~~console.log-Audit~~ → 3 `[gemini]`-Trace-Logs + Debug-Counter in `gemini.ts` entfernt; andere AI-Provider sind clean. Production-Code-Standard (`console.error`/`console.warn` nur dokumentiert) erfuellt.
- ~~Auskommentierter Code-Audit~~ → keine Treffer. Alle `//`-Bloecke sind Doku-Beispiele in Library-Headers, alle `/* ignore */`-Marker sind dokumentierte Silent-Catches. Drift clean.
- ~~Component-internal Helper-Doubletten~~ → `formatRelative` (MembersList) + `formatRelativeDate` (Templates) konsolidiert in `lib/dates.ts` als `formatRelativeDeLong` + `formatRelativeDeShort`. Single-Source.

**Nicht-Defekte (verifiziert):**

- `as unknown as`-Casts (85 Stellen) sind optimistic-update-Pattern in `lib/mutations.ts` und Tagged-Union-Casts. Kein Type-Refactor noetig.

**Offen / Folge-Sub-Sprints:**

- (kein bekannter Drift — bei Befund eintragen, sonst `git blame` faellig)

---

## 14. Aenderungen am Manifest

Nicht ohne Plan-Eintrag und User-Freigabe. Wenn ein neues Quality-Pattern auftaucht (z.B. neuer Linter, neuer Type-Helper), Manifest erweitern, niemals inline anders.
