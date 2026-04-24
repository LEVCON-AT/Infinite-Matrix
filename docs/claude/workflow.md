# Workflow: Kontext, Sprints, Verifikation

**Wann lesen:** Am Start einer längeren Review-/Refactor-Welle, beim Planen von Sub-Sprints, beim Einrichten der Preview-Verifikation, oder wenn der Kontext eng wird und ich überlegen muss, was ich wohin auslagere.

---

## Kontext-Window & Sprint-Aufteilung

Die Codebasis: **Client ~8.5k LOC** in `client/matrix_tool_beta.html` (Single-File), plus **Bridge ~900 LOC TypeScript** in `packages/bridge/src/`, plus der neue SolidJS-Client in `packages/client-web/`. Ein Review- oder Refactor-Durchgang am Client kann das Kontext-Fenster sprengen. Deshalb:

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

Für alles Neue ab Bridge-Phase gelten Conventional Commits — siehe [architektur.md](architektur.md#conventional-commits-format).

### Branch-Strategie

- Review-/Refactor-Wellen auf einem eigenen Branch (`code-review-sprints` o. ä.) — `main` bleibt deploy-ready.
- Nach Abschluss aller Sprints: Zusammenfassung + Merge-Vorschlag an User.
- Kein Force-Push auf `main`. Kein `--no-verify`.

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
