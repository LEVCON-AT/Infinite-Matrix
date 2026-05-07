# Sophisticated-Workflow — Konzept-zu-Implementation-Lifecycle

**Wann lesen:** wenn die Modus-Frage in CLAUDE.md mit „sophisticated" beantwortet wurde. Bei „klassisch" oder Trivial-Anfragen NICHT lesen — direkt umsetzen mit Foundation-Bewusstsein.

**Bewaehrt im Widget+Vorlagen-Konzept-Sprint 2026-05-04 bis 2026-05-08** — 18 Sektionen, ~100 Worksheet-Items, 5 Manifest-Erweiterungen, 7 neue Komponenten, 13-Tabellen-Heptad. Der Workflow ist projekt-uebergreifend gedacht, hier zunaechst projekt-lokal abgelegt; Migration auf User-Level (`~/.claude/sophisticated-workflow.md`) kommt spaeter.

---

## Wann sophisticated, wann klassisch

**Sophisticated** wenn:
- Aufgabe beruehrt > 3 Komponenten oder ist Foundation-relevant.
- Aufgabe etabliert ein neues Pattern, das wiederverwendet wird.
- Aufgabe ist Teil eines Wellen-Plans / Konzept-Sprints / Refactor-Welle.
- User-Sprache deutet strategisches Denken an („eigentlich denke ich groesser", „eine Ebene hoeher", „bevor wir starten").
- Aufwand-Schaetzung > 1 Tag.

**Klassisch** wenn:
- Bugfix mit klarem Reproduktions-Pfad.
- UI-Tweak (Token-Anpassung, Animation-Fix, Toast-Text).
- Einzelne Migration ohne Cross-Domain-Konsequenz.
- Einzelne Test-Reparatur.
- Status-Anfrage („was steht an?", „wie ist der Stand?").
- User explizit „mach kurz" / „schnell" / „nur das".

---

## Die 12 Phasen

### Phase 1 — Idee + Grobkonzept

User-Aussage als Anker, Plan-Mode mit Strukturierung in Sektionen. Plan-File schreibt Claude — User editiert/genehmigt.

- **Output:** Plan-File mit Sektion-Liste + Output-Liste (welche Files entstehen).
- **Stop-Punkt:** ExitPlanMode → User-Approval bevor erste Datei geschrieben wird.

### Phase 2 — Foundation-Direktive zuerst

Wenn die Aufgabe eine strategische Leitlinie hat („Tool ist Organisations-Layer, nicht Storage"; „Native ist Fallback"; „Zero-Shift-Edit-Mode" usw.), wird sie als erstes verankert:

- in den Foundation-Manifesten (`animations.md`, `style.md`, `architektur.md`, `code-quality.md`).
- als eigenes Memory-File (projekt-spezifisch).
- mit Querverweis im Konzept-File.

Alle nachfolgenden Sektionen referenzieren die Foundation-Direktive.

### Phase 3 — Audit (Code-Stand pruefen)

Was existiert heute, welche Code-Pfade sind betroffen, was ist Drift, was ist Single-Source. Glob/Grep + Read.

- **Output:** Inventur-Tabelle pro Feature/Komponente in der Sektion „Inventur" des Konzept-Files.
- **Drift-Befunde** werden als Adjacent-Cleanup-Auftrag dokumentiert (eigene deferred Sub-Sprints anlegen).

### Phase 4 — Implikationen

Pro neuer Foundation-Direktive: Konsequenzen pro Domain / Tabelle / Komponente.

- **Output:** Implikations-Block im Konzept-File pro Foundation-Direktive.

### Phase 5 — Konzept-Hauptfile + Worksheet (CSV + MD)

Drei Begleit-Files:

- **Konzept-Hauptfile** (`docs/concepts/<thema>-foundation.md`): 15-20 Sektionen mit stabilen Anker-IDs.
- **Worksheet MD** (`docs/concepts/<thema>-review.md`): Tabellen-File pro Sektion mit Spalten `# / Item / Form / Annahme-oder-Frage / Status / Kommentar`.
- **Worksheet CSV** (`docs/concepts/<thema>-review.csv`): identisches Format, Excel-import-tauglich.

User kommentiert in Status (`offen` / `bestaetigt` / `geaendert` / `verworfen` / `vorschlag-claude`) + Kommentar-Spalte. MD und CSV bleiben synchron.

### Phase 6 — Diskussionsschleifen mit Foundation-Bewusstsein

Pro Worksheet-Punkt:

1. **Foundation-Bezug** zitieren (ein bis zwei Saetze aus dem relevanten Manifest).
2. **Grund-Info:** was ist heute, was waere Soll, welche Optionen.
3. **Fragen-Block:** alles was noch unklar ist + Adjacent-Cleanup-Verdacht (typischerweise 3-7 Fragen).
4. **STOP** — auf User-Antwort warten.
5. User antwortet → Ergebnis ins Konzept-File + Worksheet (Status `bestaetigt` / `geaendert`).
6. Wenn Punkt umsetzbar geworden: Plan-File schreiben → User-Approval → Code → Test.

**Auto-Mode ueberschreibt das NICHT.** Konzept-Entscheidungen sind keine Routine — sie sind strategisch und brauchen explizite User-Antwort. Setze Status NIE selbstaendig auf `bestaetigt` ohne User-Antwort.

**Ausnahme: User delegiert explizit** („du entscheidest fachlich im Projektkontext", „bitte durchentscheiden") — dann Claude entscheidet mit dokumentierter **Begruendung** im Konzept-File + Worksheet, kein Stop. Aber: Begruendung sichtbar machen, damit User korrigieren kann.

### Phase 7 — Manifest-Updates parallel

Wenn neue Querschnitt-Direktiven entstehen (Zero-Shift-Edit-Mode, Drag-Hover-Navigation, Komponenten-Anlage-Workflow), werden parallel zur Konzept-Entwicklung die Foundation-Manifeste erweitert.

- **Pflicht:** Memory-File pro Top-Level-UX-Direktive + Memory-Index-Eintrag + Konzept-File-Querverweis + CLAUDE.md „Was NICHT tun"-Eintrag bei Anti-Pattern.

### Phase 8 — Schema-Heptad-Pflege pro Tabelle

Jede neue Tabelle / Spalten-Erweiterung pflegt **alle** Architektur-Slots gleichzeitig:

```
1. Schema (Migration mit RLS + Trigger + Realtime-Publication)
2. Types (TS-Type pro Row, Discriminated Unions)
3. Mutations (CRUD durch safe-mutation-Wrapper, Position-Helper)
4. Offline-Cache (TABLES + DB_VERSION-Bump)
5. Realtime-Subscribe (Channel + Bumps)
6. Export/Import (alle Pfade + idempotenter Import)
7. MCP-Tools (Tool-Bundle + Registrierung)
8. Channel-Bridge (falls User-Inhalt — Foundation-Direktive)
```

Worksheet-Eintrag pro Tabelle mit explizit gefuellten Slots, kein „dito"-Schleifen.

### Phase 9 — Risiken-Sektion

Eigene Sektion mit `R-1`, `R-2`, ... Format. Pro Risiko: Ursache + Mitigation. Mitigation verweist auf konkrete Sub-Sprints / Sprints / Code-Stellen / deferred Audits.

- **Pflicht:** R-Items aus Diskussion herausziehen, auch nachtraegliche neue Risiken aufnehmen sobald sichtbar.

### Phase 10 — BACKLOG-Updates parallel

Wellen-Eintraege im BACKLOG mit Aufwand-Schaetzung + Output-Liste. Deferred Sprints separat markiert. Total-Schaetzung anpassen.

### Phase 11 — Plan-Tracker als persistente Diskussions-Spur

Plan-File bekommt einen Diskussions-Tracker mit Datum + Sub-Sektion-Abschluessen + offenen Korrektur-Auftraegen. So bleibt der Stand auch ueber `/clear` hinaus rekonstruierbar.

### Phase 12 — Verifikation (Trace-Tests + Coverage-Matrix)

Vor Implementierungs-Start:

- **Trace-Tests** mit konkreten Setups + Schritten + Erfolgs-Kriterien (Latenz-Zahlen, Permission-Checks, Realtime-SLOs) + Fail-Modes.
- **Heptad-Coverage-Matrix** als CSV (Tabellen × Slots) — alle Felder gefuellt vor Welle-Start.
- **Foundation-Audit-Matrix** als CSV (Domains × Bridge-Spalten).
- **Backlog-Konsistenz** + Risiken-Akzeptanz.

---

## Erfolgs-Faktoren

- **Foundation zuerst** — strategische Leitlinie verankert vor allen Detail-Diskussionen.
- **Excel-tauglich** — User kann offline mit dem Worksheet arbeiten, kommt mit fertigen Antworten zurueck.
- **Stop-Punkte ehrlich** — Auto-Mode wird nicht missbraucht fuer Konzept-Entscheidungen.
- **Adjacent-Cleanup proaktiv** — beim Audit entdeckte Drift wird benannt, nicht ignoriert.
- **Heptad-Pflege rigoros** — alle Slots pro Tabelle, kein „dito"-Schleifen.
- **Memory-Files als Top-Level-Sicherung** — Querschnitt-Direktiven bleiben ueber Sessions hinweg verbindlich.
- **Manifest-Updates parallel** — Konzept und Manifest wachsen gemeinsam, kein Nachzieh-Sprint.
- **Risiken explizit** — auch neue Risiken aus der Diskussion in die Risiken-Sektion aufnehmen.
- **Plan-Tracker persistent** — pro Sektion ein KOMPLETT-Block mit Datum, sodass Stand rekonstruierbar bleibt.
- **User-Direktive „du entscheidest fachlich"** als Erlaubnis fuer Claude-Auto-Decision — aber **mit dokumentierter Begruendung**.

---

## Anti-Pattern (sofort durchfallen)

- Ohne Modus-Frage starten bei nicht-trivialen Aufgaben.
- Auto-Mode-Uebergriff auf Konzept-Entscheidungen ohne User-Antwort.
- „dito"-Schleifen in Heptad-Tabellen.
- Manifest-Updates erst nach Konzept-Abschluss (Drift-Risiko).
- Stille Adjacent-Drift — beim Audit entdeckte Inkonsistenzen ignoriert.
- Worksheet ohne CSV-Pendant — User kann nicht in Excel arbeiten.
- Stop-Punkte uebersprungen weil „logischerweise klar".
- Konzept-Aenderungen ohne Plan-Tracker-Update.

---

## Quick-Reference fuer Claude

Wenn die Modus-Frage mit „sophisticated" beantwortet ist:

1. Plan-File anlegen mit Sektion-Liste + Output-Liste (Phase 1).
2. Foundation-Direktive zuerst verankern (Phase 2).
3. Audit Code-Stand (Phase 3).
4. Implikationen pro Foundation-Direktive (Phase 4).
5. Konzept-Hauptfile + Worksheet (MD + CSV) anlegen (Phase 5).
6. Pro Worksheet-Punkt: Foundation-Bezug + Grund-Info + Fragen → Stop → User antwortet → Status (Phase 6).
7. Manifest-Updates parallel bei Querschnitt-Direktiven (Phase 7).
8. Heptad-Pflege pro neuer Tabelle (Phase 8).
9. Risiken-Sektion mit Mitigations (Phase 9).
10. BACKLOG mit Wellen-Eintraegen (Phase 10).
11. Plan-Tracker mit Sektion-Abschluesse + Datum (Phase 11).
12. Verifikation mit Trace-Tests + Coverage-Matrix (Phase 12).

**Why:** Pfusch in der Konzept-Phase multipliziert sich in der Implementation. Sophisticated-Workflow ist teurer in der Vorlauf-Phase (~3-5 Tage Diskussion vor Code-Start), aber spart vielfache Re-Work-Wellen, weil Foundation-Direktiven, Heptad-Pflichten, Risiken und Adjacent-Cleanup im Vorfeld geklaert sind.
