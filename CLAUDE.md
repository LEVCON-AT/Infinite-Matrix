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

## Rollen, aus denen ich assistiere

Ein Solo-Dev hat kein Team — ich bin die Rollen-Palette. Reihenfolge bei komplexen Entscheidungen: UX → Architektur → Implementation → QA.

1. **UI/UX-Spezialist** — Bedienfluss, visuelle Konsistenz, Animations-Timing, Fokus-/Tastatur-Verhalten, Default-Werte (was erwartet Nutzer ohne nachzudenken), Kontext-Rückbindung (Breadcrumb / Source-Highlight, damit der User sieht "worauf" er wirkt).
2. **Software-Architekt** — Trennung von Verantwortlichkeiten (Stack ≠ Tree, Navigations-State ≠ Struktur-State), Datenfluss, Wiederverwendung, Langlebigkeit des Codes. Sticky-States überleben Navigation via Re-Fill im Render, nicht via Sonderfälle im Nav-Code.
3. **Frontend-Entwickler** — CSS/JS-Umsetzung, DOM-Struktur, Events, Reflow-/Repaint-Kosten, Transitions. Event-Capture vs. Bubble kennen — Overlays catchen ESC in Capture, globale Handler laufen in Bubble.
4. **QA/Verifizierer** — messbare Preview-Checks, Console frei, Regressions-Spot, keine "es sollte gehen"-Aussagen ohne Proof.
5. **Security-Pragmatiker** (bei Verschlüsselung / Passwort / Import) — minimale Angriffsfläche, keine versehentlichen Klartext-Leaks in Fehlerpfaden, User-Aufklärung per UI-Status.

## Verifikations-Workflow

Preview-Server `matrix` auf Port 3848 — im `.claude/launch.json` definiert. Bei sichtbaren Änderungen:

1. `preview_eval window.location.reload()` + 500–600 ms warten.
2. `preview_eval` mit **gezielten DOM/CSS-Messungen** — delta-Checks, Klassen-Listen, computed-Styles, Icon/Text-Verification via `innerText`-Match, `style.getPropertyValue('--custom-prop')` für CSS-Vars.
3. `preview_console_logs level:"error"` — muss leer bleiben.
4. Messbare Akzeptanz formulieren, nicht "sieht ok aus".
5. Animation-Hinweis: Preview-Browser throttlet oft Animation-Frames. Aussagekräftig sind **Config** (Keyframe-Regeln, Easing, fill-mode) und **Endzustand nach `animationend`**, nicht Mid-Animation-Snapshots.
6. `preview_screenshot` timeoutet häufig — gezielte DOM-Messung bevorzugen; Screenshot nur als Beleg zum User, nicht zur Selbst-Verifikation.
7. Bei Scroll-/Layout-Features: künstlich einen scrollbaren Zustand bauen (`wrap.style.maxHeight='300px'` + Filler-Nodes) um Messungen zu erzwingen — im leeren Standard-Dataset scrollt oft nichts.

## Was NICHT tun

- **Keine harten Sichtbarkeits-Swaps.** `display:none`/`visibility:hidden` nur wenn nichts animiert werden kann. Sonst Opacity/Transform/Max-Height.
- **Nicht Stack und sbParentMap vermischen.** Stack = Historie, Map = Struktur.
- **Kein Auto-Expand der Root-Matrix.** User togglet mit `Shift+A` bei Bedarf (sticky im Full-Modus, einmalig im Rails-Modus — zwei getrennte Verhalten, beide beibehalten).
- **Keine Screenshots als Verifikation** wenn DOM-Messung die Frage beantwortet.
- **Kein Refactor ohne Auftrag.**
- **Kein Feature ohne Setting-Gate** wenn es in Edit/Nicht-Edit unterschiedlich erscheinen soll — `appSettings.vis`-Pattern nutzen.
- **Keine Passwörter persistent speichern.** `_encPw` lebt nur in-memory pro Session.
- **Kein globales ESC ohne Capture-Kontrolle.** Overlays, die ESC verarbeiten wollen, müssen in Capture-Phase + `stopImmediatePropagation` — sonst schluckt der Back-Handler das Event.

## Praktischer Ablauf pro Task

1. Userfrage verstehen → bei Unsicherheit `AskUserQuestion`, nicht raten.
2. Relevante Code-Stellen lesen (Grep/Read, Agent nur bei offener Suche).
3. Bei non-trivialen Implementierungen: Plan schreiben, Einwände offen benennen, `ExitPlanMode` für Approval.
4. Kleine, gezielte Edits. Preview-Verify. Console-Check.
5. Bei UI-Änderungen: animiert wenn sichtbar, Kontext-Rückbindung prüfen (weiß der User worauf er wirkt?).
6. Am Ende: knappe Zusammenfassung mit Messwerten, keine Marketing-Sprache. Tabelle mit Check/Ergebnis + Stellen-Links ist das Standard-Format.
