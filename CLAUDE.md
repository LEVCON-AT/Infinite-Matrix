# Infinite Matrix

## Was das ist

Ein persönliches Organisations-System, aufgebaut auf einer **rekursiven Matrix-Struktur**. Jede Zelle einer Matrix kann selbst wieder eine Matrix sein — dazu Info-Texte, Aufgaben (Kanban) und Checklisten halten. Damit lässt sich beliebig tief strukturiert denken und arbeiten: vom groben Lebens-Layout bis zum einzelnen Task.

"Infinite" steht für die unbegrenzte Verschachtelung. "Matrix" für die zweidimensionale Grund-Struktur (Zeilen × Spalten). Keine starre Hierarchie — eine Landschaft aus Gittern, die man durchwandert.

## Wofür

Ein Einzelwerkzeug statt Flickwerk aus separaten Apps (Notion + Trello + Todoist + Docs …). Alles in *einer* HTML-Datei: Daten, UI, Logik. **Offline-first, self-hosted, ohne Drittanbieter-Account** — lokal im Browser (localStorage + File System Access API); optional AI-steuerbar über eine **selbstgehostete Bridge** (WebSocket + MCP) auf eigenem VPS. AES-GCM-Verschlüsselung für sensible Inhalte; verschlüsselte Exports als `.imx`, plain als `.json`.

Nutzerprofil: jemand, der strukturiert denkt und ein Werkzeug will, das seinen Denkstrukturen folgt — statt ihn in vorgefertigte Schemata zu zwingen.

## Was es unterscheidet

- **Ein Gitter als Atom.** Nicht Liste, nicht Baum, nicht Tag — Matrix. Zwei Achsen sind der natürliche Rahmen für Strukturiertes.
- **Rekursion ohne Ende.** Jede Zelle kann zur neuen Matrix werden. Keine künstliche Decke.
- **Datei statt Cloud, Bridge statt SaaS.** Single-File-HTML öffnet im Browser wie ein Dokument (localStorage + verschlüsselte `.imx`-Dateien). Für AI-Integration: selbstgehostete Bridge auf eigenem Server (Node + SQLite + nginx/TLS), kein Drittanbieter zwischen User und Daten.
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

Eine Datei: `packages/client-standalone/matrix.html`. Kein Build. Kein Framework. Keine npm-Dependencies. CSS inline, JS inline, Icons als Inline-SVG. Persistenz: localStorage als Primärspeicher + optional File System Access API mit Auto-Save. Seit Phase 0g.1 eingefroren bei v0.3.0-checklist-v2 — neue Features wandern in `packages/client-web` (SaaS-Client).

Konsequenz: Jede Änderung am Standalone bleibt inline, bleibt portabel, bleibt eine Datei.

Daneben: SolidJS-basierter `packages/client-web/` (Supabase-Backend, Multi-Tenant) + Bridge in `packages/bridge/`. Diese haben eigene Build-Pipelines.

## Arbeitsprinzipien

1. **Praktikabilität vor Eleganz; schlaue Methoden vor brute-force.** Drei richtige Zeilen schlagen ein Framework. Wurzel finden, nicht Symptom unterdrücken.
2. **Minimal-invasiv.** Eine Änderung fasst nur das an, was die Aufgabe löst. Keine Refactorings "weil ich eh hier bin". Keine spekulativen Optionen/Flags.
3. **Bestehendes wiederverwenden.** Vor dem Neuschreiben prüfen: gibt es schon einen Helper, CSS-Klasse, State-Variable, Pattern?
4. **Animated, wenn sichtbar.** Sichtbare State-Änderungen animieren, nie harte `display:none`/`visibility:hidden`-Swaps. Projekt-Standard: `220 ms cubic-bezier(.4, 0, .2, 1)` für Transitions, `180 ms cubic-bezier(.16, 1, .3, 1)` für Enter-Animationen. Bei scaleY-Animationen immer `transform-origin: left center` (damit SVG-Dots nicht verrutschen). Smooth-Scroll über `scrollIntoView({behavior:'smooth'})` — respektiert `prefers-reduced-motion`.
5. **Single-File-Constraint (packages/client-standalone/matrix.html).** Nichts extrahieren. CSS und JS bleiben in der HTML-Datei. Gilt **nicht** für den client-web (das ist der Vite/Solid-Build).
6. **Deutsch.** UI-Strings deutsch. Kommentare konsistent zur umgebenden Datei.
7. **Datenhoheit beim User.** Im Offline-Modus: nichts geht je an einen Server. Im Bridge-Modus: Datenfluss ausschließlich zum **eigenen** Server (self-hosted VPS), authentifiziert mit einem Token, den der User selbst generiert. Kein Drittanbieter, kein Tracking. Verschlüsselung (AES-GCM, PBKDF2, 100k iterations) für sensible Exports. Bridge-Snapshot wird als JSON in der User-eigenen SQLite persistiert — gleiche Eigentumslogik wie localStorage.
8. **Risiko-Aktionen bestätigen lassen.** Destruktives (git reset, rm, Branch-Delete) und Außenwirkung (push, PR, Comment) vorab abnicken lassen.
9. **Keine Rückgängig-Diskussion.** Wenn User "revertiere" sagt: sofort machen, nicht erklären.
10. **Messbare Verifikation.** Behauptungen mit Zahlen belegen (`maxDelta < 1px`, `activeInDom === expectedId`), nicht "sieht passend aus".
11. **Kontext behalten, nicht rekonstruieren.** Wenn eine Aktion ein Menü/Dialog öffnet: zeig Breadcrumb + highlight die Source-Row (oder das Source-Element). User soll nie raten müssen, "worauf" er gerade wirkt.
12. **Fehler sind UI.** Jeder erwartbare Fehler läuft über `showToast(msg, {type:'error'})` + `translateError(err, fallback)` — niemals `alert()`, niemals nur `console.error`. Bei großem Dataset mit `await`: zusätzlich `showLoading()`/`hideLoading()`. Stille Misserfolge sind verboten.
13. **Destruktives kriegt Undo.** Alles, was Daten verliert (`delRow`, `delCol`, `sbDelete` …), muss zuerst `pushUndo(label)` rufen und nach der Mutation `showUndoToast(label)` anbieten. User darf nicht durch einen Klick dauerhaft verlieren.
14. **Tokens vor Literals.** Vor einem neuen Magic-Number / Hex-Color / ms-Duration: existiert ein Token in `:root` (`--space-*`, `--tr-*`, `--focus-*`, `--shadow-*`, `--fs-*`, `ICO_SIZE.*`)? Falls nicht und der Wert taucht ≥2× auf: neuen Token anlegen statt Inline-Literal.
15. **Focus-Restore bei Modals.** Modal öffnen: `_pushFocusRestore()` + `_pushModal(closeFn)`. Modal schließen: `_popModal(closeFn)` + `_popFocusRestore()` (letzteres restauriert `document.activeElement` vor dem Öffnen). Ohne: Fokus landet im Void, Tastatur-Flow bricht.
16. **Animations-Hygiene.** Jede State-Änderung, die das Auge sieht, läuft über `transform`/`opacity` + `--tr-std`/`--tr-enter`. Keine `setTimeout`-Animationen; CSS + `animationend` bleiben autoritativ. `@media (prefers-reduced-motion: reduce)` respektieren (smooth-scroll macht das automatisch).
17. **Offline-Pfad gehört zur Mutation.** Im `client-web`: jede neue schreibende Funktion läuft durch den Optimistic-Wrapper aus `lib/safe-mutation.ts` (`runOptimisticUpdate` / `runOptimisticInsert` / `runOptimisticDelete`) **oder** über einen privaten `update*`/`mutateXData`-Helper, der bereits gewrappt ist. Jede neue lesende Funktion bekommt einen IDB-Cache-Fallback (Pattern: live fetch → bei Erfolg `mergeRows`/`putAll`, bei `isNetworkError` → `getByWorkspace`/`getById` + `markCacheFallback()`). Konsequenz: ein neues Feature ohne Offline-Pfad ist **kein fertiges Feature** — analog zur `pushUndo`/`showUndoToast`-Regel. Multi-Step-Operationen werden in einzelne Specs zerlegt; FIFO-Replay liefert die richtige Reihenfolge. Echte Concurrency-Limits (JSONB-Read-Modify-Write-Race, Position-Kollisionen) im Datei-Header dokumentieren statt offline auszublenden.

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
- **Keine `*:focus{outline:none}`-Regel.** Zu breit, tötet Accessibility. Scope: siehe [docs/claude/styles.md](docs/claude/styles.md).
- **Keine destruktive Aktion ohne `pushUndo` + `showUndoToast`.** Wenn die Aktion Daten löscht und nicht reversibel ist, gehört sie nicht ausgeliefert.
- **Keine neue `client-web`-Mutation ohne Offline-Pfad.** Jede schreibende Funktion fließt durch `safe-mutation.ts` oder einen bereits gewrappten Helper (`updateCard`/`updateCell`/`updateRow`/`updateCol`/`updateKbCol`/`updateChecklist`/`updateItem`/`updateBoardLink`/`updateDoc`/`mutateCellData`/`mutateNodeData`/`readChecklistHistory`). Direkte `supabase.from(...).insert/update/delete()` ohne Wrapper sind ein Review-Stop, analog zu `alert()`-Aufrufen.
- **Kein `git clean` im Deploy-Mirror.** Auf `/opt/matrix-repo` (VPS) liegen Bind-Mount-Volumes (`infra/supabase/volumes/db/data/`, `volumes/storage/`, …) im Working-Tree, aber nicht im Repo. Ein globales `git clean -fd` wischt die ganze Postgres-DB. Wenn untracked-Files den ff-merge blockieren: gezielter `git clean -fd -- <pfad>` ODER manuelles Aufraeumen — niemals Pauschal-Clean. `.gitignore` schuetzt nicht gegen `git clean -fd`, nur gegen `git add` — das ist die teuer gelernte Regel von 2026-04-25.

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

## Dokumenten-Landkarte

Diese Datei (CLAUDE.md) ist der **Single Entry Point**: Projektidentität, Arbeitsprinzipien, Was-Nicht-Tun, Ablauf pro Task. Alles andere ist in Unter-Dokumenten und wird **nur gelesen, wenn die Anforderung dazu passt**:

| Datei | Inhalt | Lesen wenn … |
|---|---|---|
| [docs/claude/architektur.md](docs/claude/architektur.md) | Bridge + MCP-Tools-Konventionen + Git-Strategie | … Bridge-/MCP-Arbeit, neue MATRIX_TOOLS, Branch-/Commit-Fragen |
| [docs/claude/rollen.md](docs/claude/rollen.md) | Die sieben Perspektiven (UX/Arch/Frontend/QA/Security/Perf/Deploy) | … komplexe Entscheidung mit mehreren Perspektiven |
| [docs/claude/standards.md](docs/claude/standards.md) | WCAG / OWASP / 12-Factor / systemd / RFCs | … Security/Accessibility/Infra/Auth-Änderung |
| [docs/claude/styles.md](docs/claude/styles.md) | Coding-Standards (Namespaces, CSS-Tokens, Delegation, Undo-Pattern…) | … konkrete Implementation am Client (Sidebar/Modal/Toast/etc.) |
| [docs/claude/checklisten.md](docs/claude/checklisten.md) | Trigger-basierte Checklisten für Commits | … **vor jedem Commit** — mindestens ein Trigger passt immer |
| [docs/claude/workflow.md](docs/claude/workflow.md) | Kontext-Awareness, Sprint-Aufteilung, Verifikations-Workflow | … längere Review-/Refactor-Welle, Preview-Verifikation einrichten |

### Externe Referenzen

| Was | Wo | Wann lesen |
|---|---|---|
| Bridge-Deployment-Plan | `docs/plan-bridge.md` | Bei Bridge-/VPS-Arbeit, besonders Phase 2+ |
| Backend-Phase-0-Plan | `docs/plan-backend-phase-0.md` | Bei client-web/Supabase-Arbeit |
| Pre-Phase-1-Audit-Reports | `docs/audit/A1..A5-*.md` | Bei Frage „was wurde im Audit 2026-04-25 gefunden / wie wurde es behoben" |
| MCP-Tool-Beispiele | `packages/bridge/src/tools/*.ts` | Als Pattern beim Neubau |
| Client-Handler-Patterns | `packages/client-standalone/matrix.html` — suche `MATRIX_TOOLS={` | Beim Hinzufügen neuer Tool-Handler |
| nginx/systemd-Config | `infra/nginx/matrix.conf`, `infra/systemd/matrix-bridge.service` | Bei Deploy/Infra-Arbeit |
| CI/CD-Workflow | `.github/workflows/deploy.yml`, `pr.yml` | Bei CI-Anpassungen |
| Memory-Files (Session-Wissen) | `~/.claude/projects/…/memory/` | Automatisch beim Session-Start gelesen |

**Regel für Claude:** Lies nicht präventiv alle Sub-Dokumente. Nur das, was die aktuelle Aufgabe betrifft. Bei Zweifel — Aufgaben-Scope prüfen, dann gezielt öffnen.
