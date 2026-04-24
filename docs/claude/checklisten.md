# Prüfroutinen (Trigger-basierte Checklisten)

**Wann lesen:** Vor jedem Commit — egal wie klein. Mindestens **ein** Trigger passt immer. Die Liste ist dafür da, dass das Mechanische nicht vergessen wird.

---

Konventionen beschreiben *was* gilt, Prüfroutinen *wann* was zu prüfen ist. Vor jedem Commit gehe ich (die AI) die zum Scope passende Checkliste mechanisch durch — nicht aus Bauchgefühl. Mindestens **ein** Trigger passt bei jeder Code-Änderung.

## Trigger: Feature geändert / neues Feature

- [ ] **MCP-Coverage**: existiert ein `MATRIX_TOOL` für die (neue/geänderte) Mutations-Aktion? Wenn nein: Schema in `packages/bridge/src/tools/<gruppe>.ts` + Client-Handler in `MATRIX_TOOLS` + Vitest + `tool-registry.test.ts`-Count erhöhen. *Selbst-Check: „Kann die AI das Feature headless aufrufen?"*
- [ ] **Destruktiv?** → `pushUndo(label)` vor Mutation, `showUndoToast(label)` danach. Kein `confirm()` in Tool-Handlern.
- [ ] **Error-Pfade**: jeder erwartbare Fehler via `showToast(msg, {type:'error'}) + translateError(err, fallback)`. Niemals `alert()`, niemals nur `console.error`.
- [ ] **Animation**: sichtbare State-Änderung via `transform`/`opacity` + `--tr-std` (220ms) oder `--tr-enter` (180ms). Keine `display:none`-Swaps, keine `setTimeout`-Animationen.
- [ ] **Alias-Index**: mutiert die Änderung `node.alias`/`cell.alias`/`card.alias`/`link.alias` (inkl. Parent-Zugehörigkeit, z.B. cross-board move)? → `rebuildAliasIndex()` nach Mutation.
- [ ] **Settings-Gate**: Feature soll in Edit vs. Non-Edit unterschiedlich erscheinen? → Eintrag in `appSettings.vis.{key}` + `VIS_LABELS` + `isVis('key')`-Check.
- [ ] **Focus-Restore**: öffnet die Änderung ein Modal? → `_pushFocusRestore()` beim Open, `_popFocusRestore()` beim Close. Plus `_pushModal(closeFn)`/`_popModal`.
- [ ] **Tokens vor Literals**: neue Magic-Number / Hex-Color / ms-Duration → existiert Token in `:root`? Falls ≥2× verwendet, neuen Token anlegen.

## Trigger: Neues UI-Element (Button, Row, Modal, Chip, …)

- [ ] **Tastatur**: `tabindex="0"` wenn interaktiv erreichbar, `-1` wenn über Kontextmenü zugänglich. `onclick` + `onkeydown` für Enter/Space (rolle­spezifisch).
- [ ] **Semantik**: `role=`/`aria-*` wenn nicht natives Element (z.B. `<span role="button" aria-label="…">`). Bei Checkboxes `aria-checked=…`.
- [ ] **Focus-Styling**: Element matched den `:focus-visible`-Scope in [styles.md](styles.md) (Reset nicht global). Neue Klassen ggf. zur Scope-Liste ergänzen.
- [ ] **Mobile-Tap**: `@media (max-width:480px)` min 44×44 px für Ico-Buttons, min 40 px Höhe für `.btn`.
- [ ] **Dark-Mode**: Farben via Token oder `data-theme="dark"`-Override geprüft. Kein `style="color:#333"` inline.
- [ ] **Inline-Styles**: keine statischen `style="…"` — nur dynamische Werte (User-Input, berechnete Position) als `style="--x:${v}"` mit CSS-Klasse die `var(--x)` liest.
- [ ] **Kontext-Rückbindung**: öffnet das Element ein Menü/Dialog? → Breadcrumb oder Source-Highlight zeigen, damit User sieht „worauf" gewirkt wird.

## Trigger: Strukturelle Änderung (neue Tabelle / Spalte / FK / Feature)

Schema-Änderungen dürfen nicht isoliert bleiben. Für jede strukturelle Änderung durchläuft der Change **vier Artefakte** — Export/Import ist gleichrangig zu MCP (ohne Export-Nachzug gibt es stille Datenverluste beim Round-Trip).

- [ ] **DB-Schema** in `infra/supabase/migrations/*.sql` — Tabelle/Spalte/FK angelegt, idempotent, mit ON DELETE-Verhalten definiert.
- [ ] **Client-Mutations** in `packages/client-web/src/lib/mutations.ts` — CRUD-Helper (`add*`, `set*`, `del*`) plus ggf. `restore*` für Undo.
- [ ] **MCP-Tool-Trio**: Bridge-Schema in `packages/bridge/src/tools/<gruppe>.ts` + Client-Handler in `MATRIX_TOOLS` + Vitest (siehe [architektur.md](architektur.md#tool-trio-regel)).
- [ ] **Export/Import** in `packages/client-web/src/lib/export.ts` + `lib/subtree-import.ts`:
  - [ ] Neue Tabelle: `WorkspaceExport`-Shape erweitert, `fetchWorkspaceRowsForExport` lädt sie, alle `export*`-Varianten filtern sie subtree-korrekt, `parseImportPayload` liest sie tolerant, Import-Insert in FK-sicherer Reihenfolge, Clear-Helpers (für Overwrite-Modus) räumen sie auf.
  - [ ] Neue Spalte: Spread `{ ...row }` deckt's ab; FK-Spalten explizit per `remap(...)` durchreichen.
  - [ ] Neuer FK: Remap-Map um das Feld erweitern.
  - [ ] Neues Cell-Feature: prüfen ob ein eigener `feature-<name>`-Export/Import nötig ist.
  - [ ] JSONB-Felder mit embedded IDs: Remap auch dort (wie `kb_cards.checklist_ref` in `kb_cards.checklist[].id` wäre der Pattern).
  - [ ] `formatExportStats` / `summarizeExport`: Count für den neuen Typ anzeigen.

Merksatz: *Jede strukturelle Änderung braucht den Vier-Artefakte-Durchlauf — Schema + Mutations + MCP + Export/Import.*

## Trigger: Neues MATRIX_TOOL / Bridge-Endpoint

- [ ] **Tool-Trio vollständig**: Schema + Client-Handler + Vitest (siehe [architektur.md](architektur.md#tool-trio-regel)).
- [ ] **Zod-Schema**: jedes Feld mit `.describe('…')` für JSON-Schema-Readability in MCP-Inspector.
- [ ] **zod-json-Deckung**: benutzter Zod-Typ ist in `util/zod-json.ts` abgedeckt? Wenn neu (z.B. `z.tuple`), erweitern.
- [ ] **Registry-Test**: neuer Tool-Name in `packages/bridge/test/tool-registry.test.ts` expected-Liste + `tools.size`-Count erhöht.
- [ ] **Return-Shape**: Erfolg `{verb:true, …details}`, Fehler `{error:'<deutsch, konkret>'}`. Nie werfen, nie `undefined`.
- [ ] **Defensive Kopien**: bei Array-/Object-Returns `.slice()` / `JSON.parse(JSON.stringify(…))` — kein Leak auf internen State.
- [ ] **Ref-Resolver**: neue Ref-Form? Muster `^`-Prefix strippen + Alias-Index zuerst + Raw-ID-Fallback + Typ-Check, analog zu `_resolveNodeRef`/`_resolveBoardRef`/`_resolveCardRef`.
- [ ] **URL-Input**: landet ein URL-String im State? → `sanitizeUrl()` davor. **Alias**: `validateAlias(val, oldAlias)` mit canonical `v.alias` speichern.

## Trigger: Neue Tastatur-Shortcut / Keyboard-Interaktion

- [ ] **Konfigurierbar?** → Eintrag in `DEFAULT_KEYBINDINGS` + `KB_ACTIONS`, Check via `matchShortcut(e, 'actionName')`.
- [ ] **Fix?** → in `fixedRows`-Liste von `showKeyboardHelp()` dokumentieren.
- [ ] **In Text-Input geschützt?** → Guard `!event.target.matches('input,textarea,[contenteditable]')` bei Alphazeichen-Shortcuts (wie Shift+R).
- [ ] **Overlay mit ESC**: `document.addEventListener('keydown', h, true)` (Capture) + `ev.stopImmediatePropagation()` im Handler, sonst schluckt globaler Back-Handler das Event.

## Trigger: Vor dem Commit (jede Änderung, immer)

- [ ] **Diff gelesen**: `git diff --cached` manuell durchgegangen — keine `console.log`, keine Dead-Code-Reste, keine TODOs ohne Ticket-Referenz, keine Secrets.
- [ ] **Preview-Smoke**: `preview_eval window.location.reload()` + gezielte DOM-Messung + `preview_console_logs level:"error"` leer. Bei großen JS-Edits: Cache-Buster-URL.
- [ ] **Messbar verifiziert**: Zahlen statt Adjektive — `maxDelta < 1px`, `toolsCount === 37`, nicht „sieht passend aus".
- [ ] **Commit-Message**: Conventional-Commits-Format, Co-Authored-By-Trailer, Scope passt (`feat(bridge/tools)` / `fix(client)` / `docs(claude)` / …).
- [ ] **Standards-Abgleich**: Änderung berührt Security / Accessibility / Infra? → Kurz gegen den passenden Standard (OWASP ASVS / WCAG / 12-Factor / systemd) prüfen — siehe [standards.md](standards.md).
- [ ] **Destruktive Git-Aktion nur mit Auftrag**: kein `reset --hard`, `push --force`, `--no-verify` ohne explizite User-Freigabe.

## Wenn eine Checkbox scheitert

Nicht weichklopfen. Entweder:
- **Fix sofort** wenn ≤ 5 Minuten (Animation hinzufügen, Token einführen, Vitest-Assert ergänzen)
- **Im gleichen Commit nachziehen** wenn logisch Teil der Änderung (MCP-Tool zum neuen Feature)
- **Explizit als Follow-up-Todo** in TodoWrite eintragen wenn separater Aufwand (SSH-Hardening-Style)

Niemals „mach ich später, merk ich mir eh" — wird garantiert vergessen.
