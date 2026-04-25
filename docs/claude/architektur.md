# Architektur: Bridge + MCP-Tools + Git

**Wann lesen:** Bei Bridge-Arbeit, neuen MATRIX_TOOLS, MCP-Endpunkten, Tool-Schemas, Alias-Index-Fragen, oder sobald der Git-Workflow auftaucht (Branch-Modell, Commit-Format, PR-Hygiene).

## Bridge + MCP-Tools — Konventionen (Phase 4+)

Ab Phase 4 ist der **Bridge-Pfad** produktiv: externe AI-Clients (Claude Desktop via `mcp-remote`) rufen `MATRIX_TOOLS` über WebSocket auf, Handler laufen im Browser-Client, mutieren den State wie ein User-Klick. Damit das robust bleibt, gelten folgende Regeln.

### Tool-Trio-Regel

Jedes MATRIX_TOOL hat **drei Artefakte** — fehlt eins, ist das Tool nicht merge-ready:

1. **Bridge-Schema** in `packages/bridge/src/tools/<gruppe>.ts`: Zod-Objekt + `zodToJsonSchema()` für MCP, registriert in `packages/bridge/src/tools/index.ts`
2. **Client-Handler** in `packages/client-standalone/matrix.html` (`MATRIX_TOOLS`-Registry): liest `args`, mutiert `nodes`/`aliasIndex`/etc., ruft `save()` + `render()`, gibt strukturiertes Ergebnis zurück
3. **Vitest** in `packages/bridge/test/<gruppe>.test.ts`: `safeParse` mit valid + invalid Args, Enum-Grenzen, required-Felder-Check — plus Integration via `packages/bridge/test/tool-registry.test.ts` (Gesamtzahl)

### Feature → MCP-Mapping-Pflicht

**Jede neue Mutations-UI-Aktion (Add/Update/Delete/Move/Toggle) bekommt einen MATRIX_TOOL-Eintrag.** Keine Ausnahmen ohne dokumentierte Begründung im Commit. Ausnahme-Kategorien:

- Rein darstellerisch (Scroll, Hover, Highlight) — keine Datenmutation → kein Tool
- Komposition bestehender Tools (AI kann `X.do()` + `Y.do()` selbst verketten) → im Plan oder Feature-Commit notieren „nutzt X+Y"
- Einmalige Import-/Export-Flows → ggf. als `import.*`/`export.*`-Tool spezifisch, wenn AI-steuerbar sinnvoll

**Selbst-Check am Feature-Ende:** „Kann die AI dieses Feature aufrufen, ohne im Browser zu klicken?" — Wenn nein: Tool ergänzen oder schreiben warum nicht. Das `registerAllTools`-Gate in `packages/bridge/test/tool-registry.test.ts` ist die Regressions-Absicherung: neue Produktions-Tools dort in die `expected`-Liste + Count eintragen.

### Ref-Resolver-Konventionen

Alle Refs akzeptieren Alias-Form (`^foo` oder `foo`) und Raw-ID — der Resolver strippt `^` und schlägt in `aliasIndex` nach, fällt auf Node-ID zurück:

- `_resolveNodeRef(ref)` → `nodeId | null` (Matrix oder Board)
- `_resolveBoardRef(ref)` → dasselbe plus `type==='board'`-Check
- `_resolveCardRef(args)` → `{boardId, cardId, card} | null`; akzeptiert `args.cardRef` (Alias) ODER `args.boardRef + args.cardId`
- Cells haben **keinen** eigenen Resolver — stets explizit `matrixRef + rowId + colId` (stabil, eindeutig, nicht von Alias-Setzung abhängig)

Neue Resolver? Gleiches Muster (`^`-Prefix strippen, Alias-Index zuerst, Raw-ID-Fallback, Typ-Check am Ende).

### Alias-Index-Hygiene

`aliasIndex` wird bei jedem Mutations-Pfad, der Aliase **anlegt, löscht oder verschiebt**, neu aufgebaut via `rebuildAliasIndex()`. Gedankenmerker: *Wenn ich an `node.alias`, `cell.alias`, `card.alias` oder `link.alias` drehe → rebuild.*

Besonderer Fallstrick (Sprint 4.3 gefixt): **cross-board `card.move`** verschiebt die Karte, aber der alte `aliasIndex[alias].boardId` zeigt noch aufs Quellboard — folgende Lookups per Alias finden die Karte nicht mehr. Fix: nach cross-board move explizit `rebuildAliasIndex()`. Gilt analog für jede Operation, die den Parent-Zugehörigkeits-Teil einer Alias-Entry ändert.

### Destruktiv-Pattern in Tools

Tools, die Daten löschen/überschreiben ohne triviale Wiederherstellung:

1. `pushUndo('<Deutsches Label>')` **vor** der Mutation
2. Mutation durchführen (Filter, delete, etc.)
3. `showUndoToast('<Label>')` **nach** der Mutation

**Kein `confirm()` in Tool-Handlern.** MCP-Calls laufen headless; ein native-Dialog würde den Handler einfrieren. Der Schutz ist die Undo-Pipeline — User sieht die Aktion im Browser und hat 10 s „Rückgängig".

### Tool-Return-Shape

- **Erfolg:** `{<verb>:true, ...details}` mit Verb-Präfix je nach Aktion (`created`, `deleted`, `updated`, `moved`, `toggled`, `added`, `renamed`, `set`, `undone`, `instantiated`)
- **Fehler:** `{error:'<konkrete deutsche Meldung>'}` — nie werfen, nie `undefined` zurückgeben
- **Weiter-Ketten:** IDs/Refs mitzurückgeben (`boardId`, `cardId`, `matrixId`) — die AI kann den nächsten Call darauf aufbauen
- **Defensive Kopien:** Bei Array- oder Object-Rückgaben `features.slice()`, `JSON.parse(JSON.stringify(tabLabels))` — kein Leak von Live-Referenzen an den Aufrufer

### Sanitization-Pflicht

- **URLs** immer durch `sanitizeUrl()` (`link.add`) — `javascript:`, `data:` und unbekannte Schemes werden abgelehnt
- **Aliase** immer durch `validateAlias(new, old)` — nutze den zurückgegebenen `v.alias` (canonical, lowercase)
- **Arrays** explizit `Array.isArray()`-Check, bevor `.slice()` oder `.filter()`

### Object.assign-Chunking für MATRIX_TOOLS

Die Registry wird sprint-weise erweitert. Statt den gesamten Literal neu zu schreiben, folgt jedes Sprint-Paket dem Muster:

```js
// Basis-Registry schließt:
'status':async()=>{ ... }
});

// ─── Sprint X.Y: <gruppe> ──────────────────────────────
// (Hilfsfunktionen/Konstanten hier, wenn sie Handler-lokal sind)
function _resolveXyzRef(args){ ... }
const XYZ_TEMPLATES = { ... };

Object.assign(MATRIX_TOOLS, {
  'xyz.foo': async (args) => { ... },
  'xyz.bar': async (args) => { ... }
});
```

Vorteil: minimalinvasive Diffs, sauber rückrollbar, leicht review-bar. Ein Helper-/Konstanten-Block zwischen zwei `Object.assign`-Aufrufen ist explizit erlaubt.

### Tool-Naming

- **Dot-separated**, Lesefluss als Satz: `card.done.toggle`, `cell.feature.add`, `matrix.edit_mode.set`
- **Singular** für Aktionen auf Einzel-Items: `row.add`, nicht `rows.add`
- **Query-Präfix** für Read-only Suchen: `query.cards`, `query.aliases`
- **Gruppen-Präfix** stimmt mit Domain überein: `matrix.*`, `cell.*`, `card.*`, `link.*`, `info.field.*`, `checklist.*`, `checklist.item.*`
- **Meta-Präfix-frei** für Session-Level: `status`, `undo.last`

### Testing-Level

- **Schema-Tests (Vitest, Bridge)** — pro Gruppe eine Datei `packages/bridge/test/<gruppe>.test.ts`. Decken: valid Args, fehlende required, Enum-Abweichungen, Range-Grenzen. Kein Dispatch, kein WS — reine Zod-Validation.
- **Integration-Test** (`packages/bridge/test/tool-registry.test.ts`) — `registerAllTools()` + `getTools()`-Count abgeglichen gegen explizite Expected-Liste. Regression-Gate: vergisst man den Import in `tools/index.ts`, bricht der Test.
- **Client-Smoke (Preview)** — echte `MATRIX_TOOLS[name](args)`-Aufrufe via `preview_eval`, Roundtrip über Setup → Call → State-Check → Cleanup. `preview_console_logs level:"error"` nach jedem Szenario.
- **Kein** lokaler WS/MCP-Full-Roundtrip — das ist Phase-5-E2E, läuft dann gegen VPS.

### Bridge-Typ-Deckung (`util/zod-json.ts`)

Der Mini-Konverter deckt aktuell: `string`, `number`, `boolean`, `enum`, `optional`, `default`, `array`, `object`, `record`, `union`, `discriminatedUnion`, `literal`. Neue Zod-Typen? Entweder erweitern oder auf eine vorhandene Darstellung mappen. Unbekannte Typen liefern `{}` — MCP zeigt dann keine Constraint; der Handler **muss** zur Laufzeit validieren.

### Client-Globals, auf die Handler zugreifen dürfen

Stabil und in Tool-Handlern verwendbar (stammen alle aus dem Haupt-Script):

- **Daten:** `nodes`, `rootId`, `stack`, `aliasIndex`, `appSettings`, `editMode`, `_undoStack`
- **Getter/Builder:** `uid()`, `mkMatrix(label)`, `mkBoard(label)`, `getCell(nid,key)`, `getCard(boardId,cardId)`
- **Feature-Manipulation:** `addFeature(cell,feat)`, `removeTree(nid)`, `cleanupCellChildren(cell)`
- **Undo:** `pushUndo(label)`, `showUndoToast(label)`, `_applyUndo(entry)`
- **Alias:** `validateAlias(val,exclude)`, `rebuildAliasIndex()`
- **Persistenz:** `save()`, `saveSettings()`, `getPayload()`, `loadData(d)`, `render()`
- **Sanitization:** `sanitizeUrl(str)`
- **Toggle:** `setCardDone(boardId,cardId,toggle)`, `toggleEdit()`

Nicht zugreifen: interne Render-Helpers, private `_sb*`/`sb*`-Sidebar-State, DOM-Elemente direkt (außer es ist Teil der dokumentierten UI-Aktion wie `matrix.edit_mode.set`, das `document.body.classList` togglet).

## Git-Strategie (ab Bridge-Phase)

Mit Start der Bridge-Umsetzung (siehe [docs/plan-bridge.md](../plan-bridge.md)) wird die Arbeit professionalisiert: `main` ist geschützt, Feature-Branches kommen per PR zurück, Commits folgen Conventional Commits, Semver-Tags markieren Meilensteine.

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
