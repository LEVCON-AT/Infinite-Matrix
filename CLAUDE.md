# Infinite Matrix

## Was das ist

Ein persönliches Organisations-System, aufgebaut auf einer **rekursiven Matrix-Struktur**. Jede Zelle einer Matrix kann selbst wieder eine Matrix sein — dazu Info-Texte, Aufgaben (Kanban) und Checklisten halten. Damit lässt sich beliebig tief strukturiert denken und arbeiten: vom groben Lebens-Layout bis zum einzelnen Task.

"Infinite" steht für die unbegrenzte Verschachtelung. "Matrix" für die zweidimensionale Grund-Struktur (Zeilen × Spalten). Keine starre Hierarchie — eine Landschaft aus Gittern, die man durchwandert.

## Wofür

Ein Einzelwerkzeug statt Flickwerk aus separaten Apps (Notion + Trello + Todoist + Docs …). Alles in *einer* HTML-Datei: Daten, UI, Logik. Offline, lokal, ohne Account, ohne Server, portabel. AES-GCM-Verschlüsselung für sensible Inhalte; verschlüsselte Exports als `.imx`, plain als `.json`.

Nutzerprofil: jemand, der strukturiert denkt und ein Werkzeug will, das seinen Denkstrukturen folgt — statt ihn in vorgefertigte Schemata zu zwingen.

## Was es unterscheidet

- **Ein Gitter als Atom.** Nicht Liste, nicht Baum, nicht Tag — Matrix. Zwei Achsen sind der natürliche Rahmen für Strukturiertes.
- **Rekursion ohne Ende.** Jede Zelle kann zur neuen Matrix werden. Keine künstliche Decke.
- **Datei statt Cloud.** Single-File-HTML öffnet im Browser wie ein Dokument. localStorage + optional verschlüsselte Dateien (`.imx`).
- **Tastatur-first.** `^alias` springt direkt zu jeder benannten Stelle. `S` swappt Fokus Sidebar ↔ Canvas. `+` öffnet Kontextmenü auf Sidebar-Zeilen. Alt+↑↓ durch Suchverlauf. `Shift+A` togglet im Full-Modus "alles expandiert" (sticky).
- **Direkte Manipulation.** Matrizen editierbar wie Spreadsheets; Kanban innerhalb der Zelle; Checklisten inline.

## Konzepte

- **Matrix** — ein Gitter aus Zeilen und Spalten. Jede Schnittzelle kann Inhalt halten.
- **Zelle** — eine Zeilen/Spalten-Kombination. Trägt eine beliebige Kombination von Features.
- **Features einer Zelle** — `Info` (Freitext + Links + Mailvorlagen), `Aufgaben` (Kanban-Board), `Checklisten`, `Sub-Matrix` (rekursive Vertiefung).
- **Alias** — User-vergebenes Kürzel zu einer Zelle/Matrix/Karte/Link, für `^kürzel`-Schnellsprünge. Case-insensitiv geloggt, Original-Casing bleibt für Display.
- **Stack** — aktuelle Navigations-Tiefe (Breadcrumb).
- **Sidebar-Tree** — räumliche Übersicht über den ganzen Baum, filterbar, navigierbar. Verbindungslinien in Feature-Farben (blau=Matrix, teal=Board, amber=Info/Cell, lila=Checklisten, grau=Cellbox, `text3`=Link/Mail).
- **Tree-Entry-Kinds** — `matrix`, `cell`, `feature`, `link`. Link-Rows hängen an `feat-*-info` (Multi-Feature) oder direkt an der Cell (Single-Info).

## Technik-Rahmen

Eine Datei: `matrix_tool_beta.html`. Kein Build. Kein Framework. Keine npm-Dependencies. CSS inline, JS inline, Icons als Inline-SVG. Persistenz: localStorage als Primärspeicher + optional File System Access API mit Auto-Save.

Konsequenz: Jede Änderung bleibt inline, bleibt portabel, bleibt eine Datei.

## Arbeitsprinzipien

1. **Praktikabilität vor Eleganz; schlaue Methoden vor brute-force.** Drei richtige Zeilen schlagen ein Framework. Wurzel finden, nicht Symptom unterdrücken.
2. **Minimal-invasiv.** Eine Änderung fasst nur das an, was die Aufgabe löst. Keine Refactorings "weil ich eh hier bin". Keine spekulativen Optionen/Flags.
3. **Bestehendes wiederverwenden.** Vor dem Neuschreiben prüfen: gibt es schon einen Helper, CSS-Klasse, State-Variable, Pattern?
4. **Animated, wenn sichtbar.** Sichtbare State-Änderungen animieren, nie harte `display:none`/`visibility:hidden`-Swaps. Projekt-Standard: `220 ms cubic-bezier(.4, 0, .2, 1)` für Transitions, `180 ms cubic-bezier(.16, 1, .3, 1)` für Enter-Animationen. Bei scaleY-Animationen immer `transform-origin: left center` (damit SVG-Dots nicht verrutschen). Smooth-Scroll über `scrollIntoView({behavior:'smooth'})` — respektiert `prefers-reduced-motion`.
5. **Single-File-Constraint.** Nichts extrahieren. CSS und JS bleiben in der HTML-Datei.
6. **Deutsch.** UI-Strings deutsch. Kommentare konsistent zur umgebenden Datei.
7. **Daten bleiben beim User.** Nichts geht an Server. Nichts wird getrackt. Verschlüsselung (AES-GCM, PBKDF2, 100k iterations) ist die einzige Form "Netzwerk", die das Projekt kennt.
8. **Risiko-Aktionen bestätigen lassen.** Destruktives (git reset, rm, Branch-Delete) und Außenwirkung (push, PR, Comment) vorab abnicken lassen.
9. **Keine Rückgängig-Diskussion.** Wenn User "revertiere" sagt: sofort machen, nicht erklären.
10. **Messbare Verifikation.** Behauptungen mit Zahlen belegen (`maxDelta < 1px`, `activeInDom === expectedId`), nicht "sieht passend aus".
11. **Kontext behalten, nicht rekonstruieren.** Wenn eine Aktion ein Menü/Dialog öffnet: zeig Breadcrumb + highlight die Source-Row (oder das Source-Element). User soll nie raten müssen, "worauf" er gerade wirkt.
12. **Fehler sind UI.** Jeder erwartbare Fehler läuft über `showToast(msg, {type:'error'})` + `translateError(err, fallback)` — niemals `alert()`, niemals nur `console.error`. Bei großem Dataset mit `await`: zusätzlich `showLoading()`/`hideLoading()`. Stille Misserfolge sind verboten.
13. **Destruktives kriegt Undo.** Alles, was Daten verliert (`delRow`, `delCol`, `sbDelete` …), muss zuerst `pushUndo(label)` rufen und nach der Mutation `showUndoToast(label)` anbieten. User darf nicht durch einen Klick dauerhaft verlieren.
14. **Tokens vor Literals.** Vor einem neuen Magic-Number / Hex-Color / ms-Duration: existiert ein Token in `:root` (`--space-*`, `--tr-*`, `--focus-*`, `--shadow-*`, `--fs-*`, `ICO_SIZE.*`)? Falls nicht und der Wert taucht ≥2× auf: neuen Token anlegen statt Inline-Literal.
15. **Focus-Restore bei Modals.** Modal öffnen: `_pushFocusRestore()` + `_pushModal(closeFn)`. Modal schließen: `_popModal(closeFn)` + `_popFocusRestore()` (letzteres restauriert `document.activeElement` vor dem Öffnen). Ohne: Fokus landet im Void, Tastatur-Flow bricht.
16. **Animations-Hygiene.** Jede State-Änderung, die das Auge sieht, läuft über `transform`/`opacity` + `--tr-std`/`--tr-enter`. Keine `setTimeout`-Animationen; CSS + `animationend` bleiben autoritativ. `@media (prefers-reduced-motion: reduce)` respektieren (smooth-scroll macht das automatisch).

## Coding-Standards (projektspezifisch)

- **Namespaces.** `sb*` (Sidebar), `_sb*` (privat), `mm*` (Minimap), `_freq*` (Intervallmatrix-Aggregation), `ICO` (Icons), `SB_ICONS` (Sidebar-Icons), `CELL_FEATURES` (Feature-Definitionen). Eigene Features bekommen einen eigenen Präfix.
- **Persistenz-Pattern.** In-Memory `let _state = ...` → bei Mutation `localStorage.setItem(KEY, ...)` direkt schreiben (nicht auf `save()` warten, das mit Debounce zur Datei flusht). Sidebar-State in `sbSavePersist`/`sbLoadPersist`. Export-relevante States in `getPayload()`/`loadData(d)`.
- **Sichtbarkeits-Toggle.** Settings-Werte vom Typ `'edit'|'always'|'never'` unter `appSettings.vis.{key}`, gelabelt in `VIS_LABELS`, geprüft via `isVis('key')`. Default in `DEFAULT_SETTINGS.vis`.
- **Keyboard-Shortcuts.** Konfigurierbar: in `DEFAULT_KEYBINDINGS` + `KB_ACTIONS` eintragen. Prüfen mit `matchShortcut(e, 'actionName')`. Fixe Shortcuts: in der `fixedRows`-Liste von `showKeyboardHelp()`.
- **Kontext-Menü.** `sbContextMenu(e, dataId)` ist generisch — `buttons[]`-Array (`{icon, label, onClick, className?, divider?, iconColor?}`). Konvention: Breadcrumb-Header via `_sbShortCrumb(dataId)` (Parent-Cell + Feature/Link-Icon + Target-Label), Source-Row per `.sb-node-ctx-src`-Klasse mit gleichem Blue-Akzent verbinden. `cleanup()`-Funktion in allen drei Close-Pfaden (Button-Click, Outside-Click, ESC).
- **Overlay-ESC.** ESC-Handler für Overlays die einen globalen Back-Handler verdecken: `document.addEventListener('keydown', h, true)` (Capture) + `ev.stopImmediatePropagation()`. Sonst schluckt der globale Handler das Event und navigiert statt zu schließen.
- **Modal.** `smodal(title, fields[], cb, onClose)`. Felder: `{label, id, ph, v, ro?, sel?, type?: 'password', cycle?: [values]}`. Für `cycle`: ↑/↓ wechselt durch Werte im Input.
- **Sidebar-Viewport-Mode.** `body.sb-scroll-viewport #sidebar` → `position:sticky; top:0; height:100vh; align-self:flex-start`. Ohne: streckt der Tree die Seite. Mit: Tree scrollt intern, Mask-Fade wird erst aussagekräftig. Setting `sidebarScroll` (default `true`), Command `^sc` togglet live.
- **Scroll-Fade-Pattern.** `@property --fade-top/bot` + `mask-image: linear-gradient(to bottom, transparent 0, #000 var(--fade-top), #000 calc(100% - var(--fade-bot)), transparent 100%)`. JS-Listener auf `scroll` triggert `sbUpdateScrollFade()` — setzt die beiden Props auf `0px` oder `16px` je nach `scrollTop`/`scrollHeight`/`clientHeight`. Bei `clientHeight<=1` bailen (Collapse-Transition).
- **Sticky-Refill-Pattern.** Wenn ein Mode über Nav hinweg "sticky" sein soll (Beispiel `_sbExpandAllSticky`): State persistieren, und im Render (hier `sbRenderTree`) den abgeleiteten State **vor dem Rendern neu befüllen**. So überlebt er `sbExpanded.clear()` in `sbNav` ohne Sonderfälle im Nav-Code.
- **SVG-Dot-Zentrierung.** SVG-Origin muss an Tree-Origin angepasst werden (`svg.style.top = tree.offsetTop`) — sonst verschieben sich Dots gegenüber den Zeilen. Dot-Farben via `circle.dot-{type}{fill:...}` + `path.ln-{type}{stroke:...}`.
- **Scroll-Preservation.** Vor `innerHTML`-Swap auf einem scrollenden Container `scrollTop` sichern, danach wiederherstellen — sonst springt die Ansicht.
- **Design-Tokens (Sprint 1, 5.4).** In `:root` definiert, Dark-Overrides in `[data-theme="dark"]`:
  - Spacing `--space-xs:4 · sm:8 · md:12 · lg:16`
  - Transitions `--tr-std:220ms cubic-bezier(.4,0,.2,1)` · `--tr-enter:180ms cubic-bezier(.16,1,.3,1)`
  - Focus `--focus-color` · `--focus-offset:2px` · `--focus-width:2px`
  - Shadows `--shadow-sm/md/lg`, Overlays `--overlay-strong/soft`, Fade-Maske `--fade-mask-color`
  - Font-Size-Clamps `--fs-title:clamp(14px,.9vw+10px,17px)` · `--fs-subtitle:clamp(13px,.6vw+9px,15px)` (Body bleibt 14–15 px fix)
  - Crypto `CRYPTO.PBKDF2_ITERATIONS / IV_BYTES / SALT_BYTES / HASH / KEY_LEN`, Timing `TIMING.SAVE_DEBOUNCE_MS / FILE_FLUSH_MS / …`, Icon-Größen `ICO_SIZE={XS:10,SM:12,MD:14,LG:18}` — Sondergrößen (9, 11, 22, 32) bleiben literal.
- **Responsive-Breakpoints (Sprint 5.3).** `@media (max-width:1200px)` Content-Padding enger, Sidebar `max-width:320px`. `@media (max-width:900px)` Sidebar als Overlay. `@media (max-width:480px)` Full-Screen-Drawer (`width:100vw`), `.ico-btn` min 44×44 (WCAG-Tap), `.btn` min-height 40, `.kb-col` 85–90 vw single-column.
- **Toast-System (Sprint 3.4).** `showToast(msg, {type:'error'|'warning'|'success'|'info', ms?})` — stapelt in `#toast-stack`, auto-dismiss (5 s info, 7 s error), Schließen-Button. Niemals `alert()`. Für Action-Toasts (Undo): `showUndoToast(label)` baut einen Toast mit zusätzlichem `.toast-action`-Button (10 s Lebensdauer).
- **Error-Translation (Sprint 3.3).** `translateError(err, fallback)` mappt bekannte Fehler-Namen (`AbortError`, `SyntaxError`, `OperationError`) auf deutsche Messages. Fallback: „Unerwarteter Fehler." Immer über diesen Helfer leiten, bevor eine Message in den Toast geht.
- **Modal-Stack (Sprint 3.1/3.2).** `_pushModal(closeFn)` / `_popModal(closeFn)` stapelt schließbare Overlays; globaler ESC-Handler schließt nur das oberste. `_pushFocusRestore()` merkt sich `document.activeElement` beim Öffnen, `_popFocusRestore()` restauriert. Pfade für Button-Click, Outside-Click und ESC alle über denselben `closeFn()` — nicht drei parallele Implementierungen.
- **Undo-Pattern (Sprint 6.1).** Vor destruktiver Mutation `pushUndo(label)` — Snapshot = `getPayload()` als JSON-String, FIFO-Stack `_undoStack` max 10. Nach Mutation `showUndoToast(label)` zeigt „Rückgängig"-Button, klickt User → `_applyUndo(entry)` ruft `loadData(parsed); save(); render()`. Currently wired: `sbDelete`, `delRow`, `delCol`. Weitere destruktive Aktionen nachziehen, wenn User dort Verluste meldet.
- **DataId-Parser (Sprint 4.3).** `parseDataId(id)` parst `matrix-<id>` | `cell-<m>-<r>-<c>` | `feat-<m>-<r>-<c>-<key>` | `link-<b>-<id>` → `{type, matrixId?, rowId?, colId?, key?, boardId?, linkId?}`. Spezialisierte Wrapper mit Node-Lookup: `_sbParseCellDataId`, `_sbParseFeatureDataId`. Niemals neue Inline-Regex für diese IDs schreiben — immer über den Parser.
- **Tabindex-Konvention (Sprint 5.5).** Header-Inputs im Edit-Mode `tabindex="0"` explizit, in Non-Edit `readonly tabindex="-1"`. `.edel`-Delete-Spans: `role="button" tabindex="0" onclick onkeydown` (Enter/Space). Sidebar-Row-Actions (Rename/Delete) `tabindex="-1"` — Zugriff über `+`-Kontextmenü. Keine nativen `<button>` mit `tabindex="-1"`, ohne dass ein Kontextmenü oder Hover-Weg existiert.
- **Focus-Reset-Konvention (Sprint 5.2).** `:focus`-Reset nur auf `button,a,input,select,textarea,[contenteditable],[tabindex],.mcell,.sb-node,.kb-card,.mm-node,.tab,.bcs,.btn,.ico-btn,.sb-chip`. `*:focus-visible` bleibt global (Tastatur-Navigation). Nie wieder `*:focus{outline:none}` — zu breit.
- **Event-Delegation (Backlog 1, Card-Modal).** Statt inline `onclick/onchange/onblur` pro Element: ein Attribut-Marker (`data-action` für Click, `data-change` für Change, `data-blur` für Blur) plus `data-field`/`data-value`/`data-id`/`data-dir`-Auxiliaries. Eine zentrale Dispatch-Tabelle (`CARD_ACTIONS = { 'ns:verb': (ref, el, e) => ... }`) — Keys namespaced (`card:`, `recur:`, `cl:`). Drei Listener am Container: **click im Capture-Phase** (wenn ein innerer Node `onclick="event.stopPropagation()"` hat — sonst kommt Bubble nicht durch), change im Bubble, **blur im Capture** (bubbled nicht). Listener werden im „First-Open"-Zweig des Mount angebracht (vorher `cloneNode`+`replaceChild` räumt alte Listener ab); Re-Render ersetzt nur `.innerHTML`, Listener bleiben. Element-spezifische Tastatur- und Drag-Handler (`onkeydown` für Shift+Arrow/Enter, `ondragstart/end`) bleiben inline — die wären als Delegation unleserlich.
- **Test-Harness-Nodes.** Direkt fabrizierte `nodes['bTEST_...']` mit exotischen `type`-Werten (nicht `matrix`) umgehen Stack-/Parent-Contract und produzieren `renderMatrixPage`-Errors aus `<anonymous>`-Frames beim globalen `render()`. Reine Modal-Tests brauchen `render()` nicht — nur `openCard(bid,cid)` + DOM-Queries. Wenn der Test doch `render()` triggert (über App-API wie `save()`), erst mit `delete nodes['bTEST_...']; save()` aufräumen, sonst bleibt der Bogus-Node in localStorage hängen. Bogus-IDs mit konsistentem Präfix (`bTEST_EVT`, `cTEST_EVT`) erleichtern die Cleanup-Suche. Für Kanban-Tests braucht es den vollen Navigationspfad: `root.data.rows/cols/cells[`r-c`]={boardId, features:['board']}` + `stack.push({nodeId:bid, cellRef:{parentId:rootId,rowId,colId}})` + `currentTab[bid]='board'` + `render()`. Standalone `stack=[{nodeId:bid}]` rendert kein Kanban, weil der Renderer über `cur.cellRef` dispatched.
- **Feature-Farben als Data-Attribute (Backlog 2).** Statt `style="background:${FEAT_COLORS[key]}"` lieber `data-feat="matrix|board|info|checklists"` am Element und CSS-Regel `.xyz[data-feat="matrix"]{background:var(--bluebg);color:var(--bluetxt);}` etc. Anwendungs­stellen: `.cell-segment`, `.cell-quad-item`, `.peek-feat-badge`, `.prio-badge-ico`. Vorteil: Dark-Mode-Overrides in `[data-theme="dark"]` greifen automatisch; kein Ternary-Morast im Template. Für variable Farben, die nicht ins Feat-Set fallen (User-gewählte Kanban-Spalten-Farbe, Person-Avatar-Farbe): CSS-Custom-Property (`--kb-col-color`, `--pc-color`, `--sd-color`) per `style="--x:${v}"` setzen und Basis-Klasse `.y[data-col=set]{background:var(--x,fallback);}` lesen.
- **Color-Key-Helper (`_srColKey`).** Für `color:${info.color}`-Muster, wo `info.color` aus einer App-Logik kommt und mehrere Varianten annehmen kann: `_srColKey(cssColor)` extrahiert via Regex den Key aus `'var(--blue)'` → `'blue'`. Dann `data-sr-col="blue"` + CSS-Mapping `.sr-ico[data-sr-col="blue"]{color:var(--blue);}`. Skaliert, wenn die App mehrere Farb-Dimensionen hat (Search-Row-Icons, Context-Menu-Icons) und neue Varianten leicht hinzukommen.
- **Inline-Style-Diät (Backlog 2).** 219 → 32 inline `style="..."` durch systematische Ersetzung. Regel: *jeder Inline-Style außer dynamischer Werte ist falsch*. Dynamisch = wirklich pro Element variabel (User-Inputs, berechnete Positionen, User-konfigurierte Em-Werte). Statisch = Klassenpattern. Übergangsfall: `style="--x:${v}"` + CSS `{prop:var(--x)}` — auch das ist eine Klasse. Nie eine feste Farbe, feste Größe, festes Padding oder festes `display:flex` inline schreiben.

## Rollen, aus denen ich assistiere

Ein Solo-Dev hat kein Team — ich bin die Rollen-Palette. Reihenfolge bei komplexen Entscheidungen: UX → Architektur → Implementation → QA.

1. **UI/UX-Spezialist** — Bedienfluss, visuelle Konsistenz, Animations-Timing (`--tr-std` / `--tr-enter`), Fokus-/Tastatur-Verhalten, Default-Werte (was erwartet Nutzer ohne nachzudenken), Kontext-Rückbindung (Breadcrumb / Source-Highlight, damit der User sieht „worauf" er wirkt), Mobile-Tap-Targets ≥ 44 px. *Praktisch-First-Prinzip:* Was ist der kürzeste Weg zum Ziel, ohne den User zu fragen „wie wolltest du es denn?"
2. **Software-Architekt** — Trennung von Verantwortlichkeiten (Stack ≠ Tree, Navigations-State ≠ Struktur-State), Datenfluss, Wiederverwendung, Langlebigkeit des Codes. Sticky-States überleben Navigation via Re-Fill im Render, nicht via Sonderfälle im Nav-Code. Enabler (Tokens, Parser) vor Consumer — sonst baut man doppelt.
3. **Frontend-Entwickler** — CSS/JS-Umsetzung, DOM-Struktur, Events, Reflow-/Repaint-Kosten, Transitions. Event-Capture vs. Bubble kennen — Overlays catchen ESC in Capture, globale Handler laufen in Bubble. Klassen-Toggle statt `.style.display`; Tokens statt Literals.
4. **QA/Verifizierer** — messbare Preview-Checks (DOM-Query + computed-Style), Console frei, Regressions-Spot, keine „es sollte gehen"-Aussagen ohne Proof. Konventionen-Check: `translateError` verwendet? `showToast` statt `alert`? Destruktiv = `pushUndo`? Focus-Restore nach Modal?
5. **Security-Pragmatiker** (bei Verschlüsselung / Passwort / Import) — minimale Angriffsfläche, keine versehentlichen Klartext-Leaks in Fehlerpfaden, User-Aufklärung per UI-Status. `_encPw` niemals persistieren. Crypto-State nur nach erfolgreichem Round-Trip setzen (`getEncPw`-Bug aus Sprint 0.2).
6. **Performance-Wächter** — Hot-Paths (Tree-Walks, Render-Loops, Save-Pipeline) profilen, nicht raten. Debounce statt Drosseln-pro-Event. JSON-Deep-Clone nur wo wirklich nötig; lieber Initial-Clone cachen. Tree-Walk-Ergebnisse in einen `*Cache`-State ablegen und bei Mutation invalidieren.
7. **Deploy-/SaaS-Stratege** (bei Roadmap-Fragen) — Phasen-Plan respektieren (Phase 0 VPS-Deploy → 1 Bridge-Abstraktionen → 2 Integrationen → 3 Lizenz-Gate → …). Keine Frontend-Änderung, die den Single-File-Constraint auflöst, ohne explizite Phase-4-Entscheidung.

## Kontext-Window & Sprint-Aufteilung

Die App ist ~7k LOC in *einer* Datei. Ein Review- oder Refactor-Durchgang kann das Kontext-Fenster sprengen. Deshalb:

### Kontext-Awareness während der Session

- **Große Tool-Results auslagern.** Broad-Searches (>3 Grep/Read-Zyklen) oder „wo wird Feature X gebraucht"-Fragen gehen an den `Explore`-Agent — er scannt, ich kriege die Kurzantwort. Die rohen Treffer bleiben aus dem Haupt-Kontext.
- **Gezielte Queries.** Grep/Read immer mit Path + Pattern + `head_limit`. Nie `output_mode:"content"` auf einem offenen Suchbegriff ohne Limit — das füllt das Fenster mit Rauschen.
- **Vor `/compact` warnen.** Wenn ich merke, dass der Kontext eng wird (typ. nach 3–5 Sub-Sprints am Stück): User informieren und den aktuellen Stand als Sub-Sprint-Commit sichern, bevor komprimiert wird. So übersteht die Arbeit die Kompression und der Wiedereinstieg ist sauber.
- **Nach `/compact` oder Agent-Return.** TodoWrite-Liste synchronisieren (nicht aus dem Gedächtnis weiterarbeiten), Kern-Dateien (CLAUDE.md, Plan) kurz gegenlesen, dann weiter.
- **Stale Console-Logs akzeptieren.** Preview-Console-Buffer wird bei `reload()` *nicht* geleert. Errors aus `<anonymous>` (mein eigener Test-Harness) sind Rauschen — nur neue Errors aus `matrix_tool_beta.html:<line>` zählen.

### Sprint-Partitionierung (Review- und Refactor-Arbeit)

- **Ein Sprint = ein Meilenstein.** Klares „danach ist X erledigt", messbare Akzeptanzkriterien, ≤ 1–3 Tage Arbeit.
- **Wenn ein Sprint > 3 unabhängige Sub-Aufgaben hat → aufteilen** in Sub-Sprints (z. B. `4.1`, `4.2`, `4.3`). Pro Sub-Sprint ein Commit + Push auf den Feature-Branch. Atomar rückrollbar.
- **Enabler zuerst.** Design-Tokens vor Style-Refactor (Sprint 1 vor 4/5). Parser vor Refactor (2.3 Delegation vor 4.4 Split). Dependencies im Plan explizit markieren.
- **Quick-Wins vor großen Refactors.** Kleine sichtbare Erfolge bauen Vertrauen in die Verifikations-Pipeline auf und decken Regressionen früh auf.
- **Verify nach jedem Sub-Sprint.** Preview-Reload + gezielte DOM-Messung + `preview_console_logs level:"error"`. Erst *dann* commit.
- **Pre-Deploy-Blocker nie überspringen.** Sprint 0 (Daten-Sicherheit, Memory-Leaks, Crypto-Korrektheit) läuft immer vor allem anderen. Kein Feature-Polish bei offenen Release-Blockern.

### Commit-Message-Konvention (Review-Sprints)

```
Sprint X.Y: Kurz-Titel

- Was geändert (1–3 Bullet)
- Relevante Metriken vorher/nachher wenn vorhanden

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

### Branch-Strategie

- Review-/Refactor-Wellen auf einem eigenen Branch (`code-review-sprints` o. ä.) — `main` bleibt deploy-ready.
- Nach Abschluss aller Sprints: Zusammenfassung + Merge-Vorschlag an User.
- Kein Force-Push auf `main`. Kein `--no-verify`.

## Git-Strategie (ab Bridge-Phase)

Mit Start der Bridge-Umsetzung (siehe [docs/plan-bridge.md](docs/plan-bridge.md)) wird die Arbeit professionalisiert: `main` ist geschützt, Feature-Branches kommen per PR zurück, Commits folgen Conventional Commits, Semver-Tags markieren Meilensteine.

### Branch-Modell (trunk-based, PR-gated)

```
main            prod. Geschützt. Nur via PR mergen. Auto-deploy bei Merge (ab Phase 3).
 │
 ├── feat/<name>     neue Features (z.B. feat/bridge-skeleton)
 ├── fix/<name>      Bugfixes
 ├── chore/<name>    Refactoring, Tooling, Dependencies, Repo-Housekeeping
 ├── docs/<name>     nur Doku
 └── ci/<name>       Workflows / Infra-Config
```

- Branch-Namen: kebab-case, Scope im Präfix
- Lebenszyklus: ein Branch = eine Aufgabe, < 5 Tage offen
- Merge-Strategie: **Squash-Merge auf main** (linear history) — Sub-Commits im Feature-Branch dürfen WIP-artig sein, auf main wird nur ein kuratierter Commit sichtbar
- Keine Force-Pushes auf `main` (per Branch-Protection blockiert)
- `main` hat `Require linear history`, `Block force pushes`, `Restrict deletions`, `Require PR before merging`, `Require conversation resolution`, `Require status checks to pass` (sobald CI in Phase 3 steht)

### Conventional-Commits-Format

```
<type>(<scope>): <kurzer Titel in dt.>

<Body — optional, erklärt Warum. Bullets.>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Types:** `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`, `style`, `perf`, `build`
**Scopes (Beispiele):** `client`, `bridge`, `bridge/tools`, `bridge/ws`, `bridge/mcp`, `infra/nginx`, `infra/systemd`, `ci`, `docs`, `repo`

Beispiele:
```
feat(bridge): WebSocket-Protokoll v1 + Tool-Dispatch
fix(bridge/ws): Reconnect-Loop bei State-Resync-Fehler
refactor(client): MATRIX_TOOLS-Registry als Top-Level-Dispatch
ci: rsync-Deploy + systemd-Restart Smoke-Check
chore(repo): Monorepo-Layout, Client nach client/ extrahiert
docs(plan): Bridge + MCP + Auto-Deployment Fahrplan
```

Die bestehende Sub-Sprint-Konvention (`Sprint X.Y: …` bzw. `Backlog N<letter>: …`) bleibt für laufende Review- und Backlog-Wellen gültig. Für alles Neue ab Bridge-Phase: Conventional Commits.

### Tags & Releases

- Semver-Tags nach Meilensteinen: `v0.1.0-code-review` (abgeschlossene Review-Welle), `v0.1.0-bridge-local-mvp` (Bridge lokal), `v0.2.0-mcp-v1` (erste AI-E2E), `v0.3.0-onboarding` usw.
- Release-Notes in GitHub Releases; automatisch via `release-please`/`git-cliff` bei Bedarf später.

### PR-Hygiene

- Ein PR = eine abgeschlossene Teilleistung, nicht ein WIP-Zustand.
- PR-Titel = finaler Commit-Titel (wird bei Squash-Merge übernommen).
- PR-Body: Summary (1–3 Bullet), Test-Plan-Checkliste, Verweis auf Plan-Sektion.
- Labels: `feat`, `fix`, `chore`, `ci`, `infra`, `docs` — einer pro PR, passend zum Commit-Type.

### Commit-Autorenschaft

Lokaler Committer ist die User-Identität (Git-Config). Inhaltliche Mitarbeit durch den AI-Assistenten wird per `Co-Authored-By`-Trailer anerkannt. Nie `--no-verify`, nie Signaturen manipulieren, nie Force-Push auf `main`.

## Verifikations-Workflow

Preview-Server `matrix` auf Port 3848 — im `.claude/launch.json` definiert. Bei sichtbaren Änderungen:

1. `preview_eval window.location.reload()` + 500–600 ms warten.
2. `preview_eval` mit **gezielten DOM/CSS-Messungen** — delta-Checks, Klassen-Listen, computed-Styles, Icon/Text-Verification via `innerText`-Match, `style.getPropertyValue('--custom-prop')` für CSS-Vars.
3. `preview_console_logs level:"error"` — muss leer bleiben.
4. Messbare Akzeptanz formulieren, nicht "sieht ok aus".
5. Animation-Hinweis: Preview-Browser throttlet oft Animation-Frames. Aussagekräftig sind **Config** (Keyframe-Regeln, Easing, fill-mode) und **Endzustand nach `animationend`**, nicht Mid-Animation-Snapshots.
6. `preview_screenshot` timeoutet häufig — gezielte DOM-Messung bevorzugen; Screenshot nur als Beleg zum User, nicht zur Selbst-Verifikation.
7. Bei Scroll-/Layout-Features: künstlich einen scrollbaren Zustand bauen (`wrap.style.maxHeight='300px'` + Filler-Nodes) um Messungen zu erzwingen — im leeren Standard-Dataset scrollt oft nichts.
8. **Preview-Cache-Buster bei großen JS-Edits.** Wenn nach Reload `typeof globalVar === 'undefined'` obwohl die Datei die Deklaration enthält: der Preview-Browser serviert eine gecachte Version. Force-Reload über `window.location.href='http://localhost:3848/matrix_tool_beta.html?v='+Date.now()` umgeht den Cache.
9. **Test-Harness-Hygiene.** Direkte `preview_eval`-Mutationen (z. B. `nodes[rootId].data.rows.push(...)`) + `render()` produzieren `<anonymous>`-Stack-Errors im Console-Log, die persistent liegen bleiben. Diese sind Rauschen — nur Errors mit `at <function> (http://…/matrix_tool_beta.html:<line>)` zählen. Besser: App-APIs nutzen (`addRow`, `toggleEdit`, `pushUndo`), wenn möglich.
10. **Transition-Timing-Effekte.** Nach einem Klassen-Swap, der eine `transition:width`/`transition:opacity` triggert, landen Computed-Style-Messungen mid-animation. Entweder auf `transitionend` warten oder manuell `setTimeout(measure, 350)` (länger als `--tr-std`).
11. **Synthetische Szenarien.** Für Destruktiv/Modal-Tests: `window.confirm` monkey-patchen (`window.confirm=()=>true`), danach im `finally` restaurieren. Test-IDs nicht mit Produktions-IDs kollidieren lassen (`rTest`/`cTest` sind safe).

## Was NICHT tun

- **Keine harten Sichtbarkeits-Swaps.** `display:none`/`visibility:hidden` nur wenn nichts animiert werden kann. Sonst Opacity/Transform/Max-Height.
- **Nicht Stack und sbParentMap vermischen.** Stack = Historie, Map = Struktur.
- **Kein Auto-Expand der Root-Matrix.** User togglet mit `Shift+A` bei Bedarf (sticky im Full-Modus, einmalig im Rails-Modus — zwei getrennte Verhalten, beide beibehalten).
- **Keine Screenshots als Verifikation** wenn DOM-Messung die Frage beantwortet.
- **Kein Refactor ohne Auftrag.**
- **Kein Feature ohne Setting-Gate** wenn es in Edit/Nicht-Edit unterschiedlich erscheinen soll — `appSettings.vis`-Pattern nutzen.
- **Keine Passwörter persistent speichern.** `_encPw` lebt nur in-memory pro Session.
- **Kein globales ESC ohne Capture-Kontrolle.** Overlays, die ESC verarbeiten wollen, müssen in Capture-Phase + `stopImmediatePropagation` — sonst schluckt der Back-Handler das Event.
- **Kein `alert()`.** Auch nicht „nur für Entwickler-Fehler". `showToast` + `translateError` ist der einzige korrekte Pfad.
- **Kein `JSON.stringify(getPayload())`.** `getPayload()` *ist* schon ein JSON-String. Doppel-Stringify produziert auf der Rückseite einen String statt eines Objekts — `loadData` bekommt `d.nodes === undefined` und die App implodiert leise.
- **Keine inline `font-size:17px` in Elementen, die `.ptitle`-ähnlich sind.** Stattdessen `font-size:var(--fs-title)`/`var(--fs-subtitle)` — sonst bricht das Responsive-Clamp.
- **Keine `*:focus{outline:none}`-Regel.** Zu breit, tötet Accessibility. Scope: siehe Focus-Reset-Konvention in Coding-Standards.
- **Keine destruktive Aktion ohne `pushUndo` + `showUndoToast`.** Wenn die Aktion Daten löscht und nicht reversibel ist, gehört sie nicht ausgeliefert.

## Praktischer Ablauf pro Task

1. **Userfrage verstehen.** Bei Unsicherheit `AskUserQuestion`, nicht raten. Bei mehrdeutigem Scope Plan-Mode benutzen.
2. **Relevante Code-Stellen lesen.** Grep/Read direkt bei bekannten Symbolen/Dateien, `Explore`-Agent nur bei offener Suche über mehrere Stellen.
3. **Plan bei non-trivialen Implementierungen.** Schreiben, Einwände offen benennen (UX-Risiko, Kontext-Kosten, Regressions-Gefahr), `ExitPlanMode` für Approval.
4. **Sub-Sprints, wenn > 3 Teilaufgaben.** Plan-Tabelle mit Reihenfolge + Abhängigkeiten. Pro Sub-Sprint Commit + Push.
5. **Kleine, gezielte Edits.** Pro Sub-Sprint: Token/Pattern/Parser/etc. isoliert ändern, *dann* verifizieren. Nicht fünf Dinge gleichzeitig.
6. **Preview-Verify nach jedem Edit.** DOM-Query + computed-Style + Console-Error-Check. Bei großen JS-Edits: Cache-Buster-Reload.
7. **UI-Änderungen:** animiert wenn sichtbar, Kontext-Rückbindung prüfen (weiß der User „worauf" er wirkt?), Tap-Target im Mobile-Viewport messen wenn neu, Dark-Mode-Kontrast mit `preview_resize colorScheme:'dark'` gegenprüfen.
8. **Destruktive Änderungen:** `pushUndo` + `showUndoToast` **bevor** der Commit erfolgt.
9. **Zusammenfassung am Ende.** Tabelle mit Sub-Sprint / Commit-Hash / Messwert-Pointer. Keine Marketing-Sprache. Stellen-Links als `[file.html:line](…)`.
10. **Branch-Merge erst auf explizite User-Freigabe.** Der Merge-Vorschlag kommt als letzter Satz der Zusammenfassung.
