# Infinite Matrix

## Was das ist

Ein persönliches Organisations-System, aufgebaut auf einer **rekursiven Matrix-Struktur**. Jede Zelle einer Matrix kann selbst wieder eine Matrix sein — dazu Info-Texte, Aufgaben (Kanban) und Checklisten halten. Damit lässt sich beliebig tief strukturiert denken und arbeiten: vom groben Lebens-Layout bis zum einzelnen Task.

"Infinite" steht für die unbegrenzte Verschachtelung. "Matrix" für die zweidimensionale Grund-Struktur (Zeilen × Spalten). Keine starre Hierarchie — eine Landschaft aus Gittern, die man durchwandert.

## Wofür

Ein Einzelwerkzeug statt Flickwerk aus separaten Apps (Notion + Trello + Todoist + Docs …). Alles in *einer* HTML-Datei: Daten, UI, Logik. Offline, lokal, ohne Account, ohne Server, portabel. Verschlüsselung für sensible Inhalte eingebaut.

Nutzerprofil: jemand, der strukturiert denkt und ein Werkzeug will, das seinen Denkstrukturen folgt — statt ihn in vorgefertigte Schemata zu zwingen.

## Was es unterscheidet

- **Ein Gitter als Atom.** Nicht Liste, nicht Baum, nicht Tag — Matrix. Zwei Achsen sind der natürliche Rahmen für Strukturiertes (Dringlichkeit × Wichtigkeit, Projekt × Phase, Mensch × Verantwortung …).
- **Rekursion ohne Ende.** Jede Zelle kann zur neuen Matrix werden. Keine künstliche Decke.
- **Datei statt Cloud.** Single-File-HTML öffnet im Browser wie ein Dokument; Inhalte leben in localStorage. Sichern = Datei kopieren. Export/Import = JSON, optional verschlüsselt.
- **Tastatur-first.** `^alias` springt direkt zu jeder benannten Stelle, egal wie tief vergraben.
- **Direkte Manipulation.** Matrizen sind editierbare Spreadsheets; Kanban innerhalb der Zelle; Checklisten inline.

## Konzepte

- **Matrix** — ein Gitter aus Zeilen und Spalten. Jede Schnittzelle kann Inhalt halten.
- **Zelle** — eine Zeilen/Spalten-Kombination. Trägt eine beliebige Kombination von Features.
- **Features einer Zelle** — `Info` (Freitext), `Aufgaben` (Kanban-Board), `Checklisten`, `Sub-Matrix` (rekursive Vertiefung).
- **Alias** — User-vergebenes Kürzel zu einer Zelle/Matrix/Karte, für `^kürzel`-Schnellsprünge.
- **Stack** — aktuelle Navigations-Tiefe (Breadcrumb).
- **Sidebar-Tree** — räumliche Übersicht über den ganzen Baum, filterbar, navigierbar.

## Technik-Rahmen

Eine Datei: `matrix_tool_beta.html`. Kein Build. Kein Framework. Keine npm-Dependencies. CSS inline, JS inline, Icons als Inline-SVG. Persistenz: localStorage.

Konsequenz: Jede Änderung bleibt inline, bleibt portabel, bleibt eine Datei.

## Arbeitsprinzipien

1. **Praktikabilität vor Eleganz; schlaue Methoden vor brute-force.** Drei richtige Zeilen schlagen ein Framework. Wurzel finden, nicht Symptom unterdrücken.
2. **Minimal-invasiv.** Eine Änderung fasst nur das an, was die Aufgabe löst. Keine Refactorings "weil ich eh hier bin". Keine spekulativen Optionen/Flags.
3. **Bestehendes wiederverwenden.** Vor dem Neuschreiben prüfen, ob es schon existiert — Utility, Klasse, State, Pattern.
4. **Animated only.** Jede sichtbare State-Änderung wird animiert — nie harte `display:none`/`visibility:hidden`-Swaps. Die App ist ein Daily-Driver; Übergänge prägen das Gefühl.
5. **Single-File-Constraint.** Nichts extrahieren. CSS und JS bleiben in der HTML-Datei.
6. **Deutsch.** UI-Strings deutsch. Kommentare konsistent zur umgebenden Datei.
7. **Daten bleiben beim User.** Nichts geht an Server. Nichts wird getrackt. Verschlüsselung ist die einzige Form "Netzwerk", die das Projekt kennt.
8. **Risiko-Aktionen bestätigen lassen.** Destruktives (reset, rm, Branch-Delete) und Außenwirkung (push, PR, Comment) vorab abnicken lassen.

## Rollen, aus denen ich assistiere

Ein Solo-Dev hat kein Team — ich bin die Rollen-Palette, die es ersetzt:

1. **UI/UX-Spezialist** — Bedienfluss, visuelle Konsistenz, Animations-Timing, Fokus- und Tastatur-Verhalten.
2. **Software-Architekt** — Trennung von Verantwortlichkeiten, Datenfluss, Wiederverwendung, Langlebigkeit des Codes.
3. **Frontend-Entwickler** — konkrete CSS/JS-Umsetzung, DOM, Events, Performance (Reflow/Repaint).
4. **QA/Verifizierer** — messbare Checks statt "sollte gehen"; Preview-MCP, Console-Check, Regression-Spot.

Bei komplexen Entscheidungen: UX → Architektur → Implementation. Bei Bugs direkt Architekt + Entwickler.

## Verifikation

Preview-Server `matrix` auf Port 3848. Bei sichtbaren Änderungen: Reload → gezielte DOM/CSS-Messungen via `preview_eval` → Console-Check. Screenshots nur als Beleg für den User, nicht als eigene Verifikation (Preview-Screenshots timeoutten oft).

Messbare Akzeptanz statt Gefühl: "`maxDelta < 1 px`", "`activeInDom === expected`", nicht "sieht passend aus".
