# AU-A1 — Rollen-Review (7 Perspektiven)

**Datum:** 2026-04-25
**Scope:** Branch `main`, Commits seit `93a68bf` (Sprint 2a HyperUI) bis `48bac58` (AU-Q3)
**Methode:** 7 parallele Code-Reviewer-Agents, je eine Rolle aus `docs/claude/rollen.md`

## Bewertungs-Übersicht

| Rolle | HIGH | MEDIUM | LOW |
|---|---:|---:|---:|
| 1 — UX | 4 | 4 | 3 |
| 2 — Architektur | 3 | 6 | 4 |
| 3 — Frontend | 2 | 3 | 2 |
| 4 — QA | 3 | 3 | 3 |
| 5 — Security | 2 | 4 | 2 |
| 6 — Performance | 2 | 4 | 2 |
| 7 — Deploy | 2 | 5 | 4 |
| **Summe** | **18** | **29** | **20** |

## Cross-Cutting-Findings (Top-Prios)

Mehrere Rollen haben dieselben Defekte aus unterschiedlichen Blickwinkeln gefunden. Diese sind die echten **Must-Fix-vor-Phase-1**:

| # | Finding | Rollen | Pfad |
|---|---|---|---|
| **C1** | `mutateCardChecklist` ohne Offline-Wrapper (Read+Write direkt gegen Supabase) | Architektur (H1), QA (H2) | `lib/mutations.ts:1809-1833` |
| **C2** | `setChecklistAction`/`setChecklistRecur` ohne `runOptimisticUpdate` | Architektur (H1) | `lib/mutations.ts:1381-1400` |
| **C3** | `applyChecklistClose` Online-Bulk-Update/Delete nicht gequeued | Architektur (H3) | `lib/mutations.ts:1417-1431` |
| **C4** | `IDB DB_VERSION = 1` obwohl `docs`-Store seit Migration 007 erwartet | Architektur (H2) | `lib/offline-cache.ts:74` |
| **C5** | URL-Sanitization fehlt im **Render-Pfad** (BoardView/NodeTree) | Security (H1) | `BoardView.tsx:750`, `NodeTree.tsx:198` |
| **C6** | URL-Sanitization fehlt im **Import-Pfad** (subtree-import + import) | Security (H2) | `lib/subtree-import.ts:831,1104,1303`, `lib/import.ts:353` |
| **C7** | `window.confirm`/`window.prompt` flächendeckend statt `showConfirm`/`showPrompt` | UX (H), QA (H), Frontend (H) | 14+ Komponenten, siehe Liste unten |
| **C8** | Focus-Restore-Pattern fehlt in 8 von 13 Overlays | UX (H) | siehe Liste unten |
| **C9** | `btn-primary` CSS-Klasse existiert nicht — 4 Buttons ungestylt | UX (H) | `ChecklistActionModal/PastePopup/ToCardPopup`, `CommandPalette` |
| **C10** | `ImportDialog` referenziert 13 nicht-existente CSS-Klassen | UX (H) | `ImportDialog.tsx:164-336` |
| **C11** | Listener-Leak in `bindAliasAutocomplete`-`ref`-Callbacks (kein `onCleanup`) | Frontend (H) | `ChecklistPanel.tsx:509`, `CellInfoPage.tsx:273`, weitere |
| **C12** | CI `pr.yml`-Pfade `bridge/**` + `client/**` ungültig — Pipeline läuft nie | Deploy (H) | `.github/workflows/pr.yml:6-8` |
| **C13** | `supabase-migrate.sh` schreibt PGPASSWORD-Output in world-readable `/tmp/migrate.log` | Deploy (H) | `infra/scripts/supabase-migrate.sh:59-60` |

---

## 1 — UX (4 HIGH, 4 MEDIUM, 3 LOW)

### HIGH
- **`btn-primary` ohne CSS-Definition** — `ChecklistActionModal.tsx:237`, `ChecklistPastePopup.tsx:124`, `ChecklistToCardPopup.tsx:197`, `CommandPalette.tsx:418`. Klasse existiert nicht in `styles.css` — 4 Buttons komplett ungestylt, im Dark-Mode unsichtbar. Empfehlung: `.btn-primary` als Alias auf `.btn-p` einrichten oder Markup auf `.btn-p` umbiegen.
- **ImportDialog komplett ungestylt** — `ImportDialog.tsx:164-336` referenziert 13 CSS-Klassen (`.import-actions`, `.import-file-label`, `.import-or`, `.import-textarea`, `.import-stats`, `.import-stat-label`, `.import-stat-n`, `.import-password-form`, `.import-actions-bottom`, `.import-progress`, `.import-progress-label`, `.import-progress-fill`, `.import-progress-bar`, `.import-card`) — keine davon existiert. Empfehlung: CSS-Block analog zu `.command-palette-*` nachliefern.
- **Focus-Restore fehlt in 8 von 13 Overlays** — `SettingsModal`, `KeyboardHelp`, `ChecklistActionModal`, `ImportDialog`, `ChecklistPastePopup`, `ChecklistToCardPopup`, `CellOverlay`, `CardOverlay` haben kein `prevFocus`-Sicher/Restore-Pattern. CLAUDE.md §15 verletzt. Empfehlung: `onMount`/`onCleanup`-Pattern aus `CommandPalette.tsx:90-103` übernehmen.
- **WorkspaceSwitcher ohne Auto-Navigate zur Root-Matrix** — `WorkspaceSwitcher.tsx:74-77` + `Workspace.tsx:178-185`. Nach Workspace-Wechsel landet User auf leerem Canvas. Empfehlung: `createEffect` in `Workspace.tsx`, das bei gesetzter `workspaceId` ohne `nodeId` zur ersten Root-Matrix navigiert.

### MEDIUM
- **`aria-modal="true"` fehlt** — `CommandPalette.tsx:302-305`, `GlobalSearch.tsx:270-274`, `FrequencyMatrix.tsx:221`. Screen-Reader traversiert weiter durch Hintergrund.
- **WorkspaceSwitcher ESC: `stopPropagation` statt `stopImmediatePropagation`** — `WorkspaceSwitcher.tsx:92-95`. Weicht vom Projekt-Standard ab; konstruierbarer Race mit DialogHost.
- **Sidebar Tree-Link Tap-Target ~24px auf Mobile** — `styles.css:2406-2417`. WCAG-Empfehlung 44px verletzt; im `@media (max-width:480px)`-Block fehlt `.tree-link`.
- **HeaderSearchBar-Dropdown 160ms via Magic-Literal statt `--tr-enter`** — `styles.css:1393`. `ws-switcher-fade-in` (`styles.css:2252`) hat dasselbe Problem.

### LOW
- ImportDialog: `aria-labelledby` fehlt auf Dialog-Root → `ImportDialog.tsx:143-145`
- Breadcrumb-Separator inkonsistent: Icon vs. Literal `›` → `Workspace.tsx:893` vs. `925`
- FrequencyMatrix-Flyout: kein Focus-Restore beim Schließen → `FrequencyMatrix.tsx:213-258`

---

## 2 — Architektur (3 HIGH, 6 MEDIUM, 4 LOW)

### HIGH
- **Drei unwrapped Direct-DB-Writes in `mutations.ts`** — `setChecklistAction()` (Z.1381), `setChecklistRecur()` (Z.1393), `mutateCardChecklist` (Z.1816-1831) gehen direkt via `supabase.from(...).update()` ohne `runOptimisticUpdate`. Verletzt CLAUDE.md "Review-Stop". Konsequenz: alle Card-Inline-Checklist-Operationen (`toggleCardInlineItem`, `renameCardInlineItem`, `delCardInlineItem`, `addCardInlineItem`) sind offline silent-fail.
- **`offline-cache.ts` IDB-Schema enthält `docs`-Store, aber `DB_VERSION = 1`** — `lib/offline-cache.ts:74`. Bestehende Browser-Tabs (alle Nutzer vor Docs-Migration) laufen nie durch `upgrade()` → `docs`-Store wird nie angelegt → `putAll('docs', ...)` etc. scheitern silent. Fix: `DB_VERSION = 2` + `if (oldVersion < 2)`-Branch im Upgrade-Callback.
- **`applyChecklistClose` Online-Bulk-Pfad nicht queued** — `lib/mutations.ts:1417-1431`. Bulk-`update({done:false}).eq(...)` und Bulk-`delete()` ohne Wrapper; `try/catch`-Offline-Fallback schützt nicht vor partiellen Aborts. Fix: gewrappte iterierte Calls statt Bulk.

### MEDIUM
- **`mutateCardChecklist` ohne IDB-Cache-Read** — `lib/mutations.ts:1809-1833`. Pattern-Divergenz zu `mutateCellData`/`mutateNodeData`.
- **`workspace-reset.ts:clearBoardContents` 4× direkte Deletes ohne Wrapper** — `lib/workspace-reset.ts:58-78`. Architektonisch akzeptabel (Reset = Multi-Step), aber Inkonsistenz nicht dokumentiert.
- **4-Artefakte-Regel: Bridge hat keine `doc.*`-Tools** — `packages/bridge/src/tools/index.ts`. Migration 007 + Client + Export/Import vorhanden, MCP fehlt.
- **`query.aliases` Bridge-Tool ignoriert `doc`-Kind** — `packages/bridge/src/tools/query.ts:26`. Enum-Lücke.
- **`Workspace.tsx` Realtime-Wiring sauber für Aliases — Notiz** — `routes/Workspace.tsx:709-718`. Rows/Cols/Items haben keine Aliases, daher korrekt; nur als zukünftige Erinnerung dokumentiert.
- **`setChecklistAction`/`setChecklistRecur` ohne `workspace_id`-Guard** — `lib/mutations.ts:1381-1400`. Defense-in-depth fehlt (RLS schützt aber).

### LOW
- `mutations.ts` 2245 LOC (3 Schichten in einer Datei) — bekanntes Finding 10
- `subtree-import.ts` ohne Wrapper — by Design, aber kein erläuternder File-Header
- `offline-cache.ts` ohne Eviction/Size-Limit — Skalierungsthema
- `setChecklistAction`/`setChecklistRecur` haben kein Spec-Shape für Queue → Downstream-Konsequenz von H1

---

## 3 — Frontend (2 HIGH, 3 MEDIUM, 2 LOW)

### HIGH
- **Listener-Leak in `bindAliasAutocomplete`-`ref`-Callbacks** — `ChecklistPanel.tsx:509`, `CellInfoPage.tsx:273`, `ChecklistActionModal.tsx:178`, `CardOverlay.tsx:1093`, `NodeDescription.tsx:83`, `DocsPopup.tsx:947`. `bindAliasAutocomplete` returned Cleanup-Funktion, die in den `ref`-Callbacks verworfen wird. Fix: `ref={(el)=>{const c=bindAliasAutocomplete(el,p.workspaceId); onCleanup(c);}}`
- **`window.confirm`/`window.prompt` in `CellInfoPage.tsx:97,108,115`** — neue Phase-0-Komponente. CLAUDE.md verletzt. Fix: `showPrompt`/`showConfirm` aus `lib/dialog.ts`. Zusätzlich Empfehlung: `onDelField` direkt löschen + `showUndoToast` (Prinzip 13: Undo statt Confirm).

### MEDIUM
- **`requestAnimationFrame` in `NodeTree.createEffect` ohne `cancelAnimationFrame`** — `NodeTree.tsx:1053-1063`. Layout-Thrashing bei Filter-Tipping; Race bei Workspace-Wechsel + Cleanup.
- **Direkte `supabase.from()`-Reads in `onCardDrop` ohne IDB-Fallback** — `NodeTree.tsx:964-992`. Verletzt Prinzip 17.
- **`z-index: 10000` als Inline-Magic-Number in `AliasAutocomplete.tsx:40`** — kein Token, Inline-Style statt CSS-Klasse. Fix: `--z-autocomplete: 10000` als `:root`-Token.

### LOW
- `dotStyle` als statisches Objekt statt reaktiver Getter in `NodeTree.tsx:315` (in Praxis unkritisch)
- `AliasText` `tokenizeAliasText(p.text)` direkt in `each=` ohne explizites Memo (Compiler-internes Memo greift)

---

## 4 — QA (3 HIGH, 3 MEDIUM, 3 LOW)

### HIGH
- **`window.confirm`/`window.prompt` flächendeckend** — `BoardView.tsx:486,507,564,574,595`, `CardOverlay.tsx:423,440`, `CellInfoPage.tsx:97,108,115`, `CellOverlay.tsx:131,280`, `ChecklistPanel.tsx:122,201`, `DocsPopup.tsx:618`, `MatrixView.tsx:201,224`, `lib/commands.ts:660`. 14+ Stellen. CLAUDE.md verbietet `alert()`-Familie. Fix: konsequent `showConfirm`/`showPrompt` aus `lib/dialog.ts`.
- **`mutateCardChecklist` ohne Offline-Pfad** — `lib/mutations.ts:1816-1831`. (Identisch zu Architektur H1) Fix: nach `mutateCellData`-Muster umschreiben.
- **`replayInFlight` global statt workspace-scoped** — `lib/mutation-queue.ts:190,199-203`. Cross-Workspace-Race. Fix: `Map<string,boolean>` per `workspaceId`.

### MEDIUM
- **`window.confirm` in `lib/commands.ts:660`** — Sub-Punkt zu HIGH 1; Bibliotheks-Modul, kann `showConfirm` problemlos importieren.
- **`addCellInfoField` Offline-Gap nicht dokumentiert** — `lib/mutations.ts:1640-1654`. Frische Session ohne Cache-Warmup wird Original-Netzwerkfehler durchschlagen lassen statt Offline-Toast.
- **`onCardDrop` Raw-supabase-Reads** — `NodeTree.tsx:964-989`. (Identisch zu Frontend M2) Fehler werden als DB-Fehler getoastet statt als Offline.

### LOW
- **Null-Testabdeckung in `client-web`** — `package.json:14` (`test: "echo no tests yet"`). Bridge hat 11 Vitest-Files, Client hat keine. Empfehlung: Vitest für `lib/mutations.ts`, `lib/mutation-queue.ts`, `lib/alias-*.ts`.
- **Realtime-Event während Optimistic-Update — kein Dedup** — `lib/realtime.ts:67-68`. Sichtbarer Flicker möglich bei JSONB-Mutationen.
- **`nextCellChecklistPosition` Offline-Status nicht dokumentiert** — `lib/mutations.ts:1128-1142`. Wird nur im `run`-Pfad gerufen; Kommentar hinzufügen.

---

## 5 — Security (2 HIGH, 4 MEDIUM, 2 LOW)

### HIGH
- **URL-Sanitization fehlt im Render-Pfad** — ASVS V5.1.4 / CWE-79. `BoardView.tsx:750` (`href={link.type==='mail'?'mailto:'+link.url:link.url}`), `NodeTree.tsx:198` (Sidebar-Links + `window.open` in Z.1340). `mutations.ts`-Schreibpfad sanitized (Z.1734,1766,1908,1991), aber Render unverteidigt. Fix: `sanitizeUrl(entry.url) ?? '#'` an beiden Stellen.
- **URL-Feld in Subtree-Import ohne Sanitization vor DB-Insert** — ASVS V5.2.1 / CWE-601+CWE-79. `lib/subtree-import.ts:831` (`linksOut`), `1104` (`executeCellContainerMerge`), `1303` (`executeFeatureInfoImport`); auch `lib/import.ts:353`. JSON-Import mit `"url":"javascript:alert(...)"` schreibt direkt in DB. Fix: `sanitizeUrl(l.url) ?? ''` vor Insert + Zod-Schema-Refinement.

### MEDIUM
- **CORS-Allowlist ohne URL-Constructor-Validation** — `packages/bridge/src/index.ts:27-36`. ASVS V1.14.1. (Bekannt als Finding 8 für AU-A2.) Wildcard-Einträge oder Protokoll-freie Werte würden ungeprüft durchgereicht.
- **Memberships-RLS-Policy zu breit** — `infra/supabase/migrations/001_workspaces.sql:135-136`. `is_workspace_member`-Check gibt jedem Member alle Membership-Rows zurück. Bei Multi-User kein Self-Filter. Fix: `user_id = auth.uid() OR workspace_role_of(...) IN ('owner','admin')`.
- **Bridge `snapshot.payload` ohne Größenlimit** — `packages/bridge/src/ws.ts:110`. ASVS V5.1.1 / CWE-400. Bösartiger oder kompromittierter Token kann SQLite/Disk füllen. Fix: Max-Bytes-Check im Snapshot-Branch.
- **`_encPw`-Invariante im `client-web` nicht formal garantiert** — Audit-Note. `export.ts:232-235`, `crypto.ts`. Kein zentraler State, Caller-Verantwortung; aktuell kein Leak gefunden, aber keine Garantie.

### LOW
- `import.ts:204-210` (Alt-Client) überträgt rohen `data`-JSONB ohne Allowlist (Hygiene-Note)
- Bridge `link.add` Zod-Schema ohne `.url()`-Validator → `info-link.ts:31` (Defense-in-Depth-Lücke)

### Sauber gefunden
Crypto-Implementierung (PBKDF2/AES-GCM/100k iter), Audit-Scrub `scrubArgs`, FORCE RLS Migration 009, Auth-Redirect-URI fixiert via `VITE_SITE_URL`, `sanitizeUrl` URL-Constructor-basiert.

---

## 6 — Performance (2 HIGH, 4 MEDIUM, 2 LOW)

### HIGH
- **`FrequencyMatrix` plain-getter statt Memo** — `components/FrequencyMatrix.tsx:92-101,117-118`. `activeCategories()` und `countFor()` werden bei jedem Reactive-Tick neu evaluiert. Bei 50 Zellen × 6 Kategorien: 300× `agg.cards.filter(cat.test)` pro Expand-Klick. Fix: `createMemo<Map<string,Record<key,number>>>` einmal pro `p.aggregates`-Change.
- **`lookupAlias()` O(n) Linear-Scan** — `lib/alias-index.ts:275`. Bei wachsendem Workspace (~500 Aliases) wird jeder Chip-Right-Click teuer. Fix: paralleles `Map<string,AliasEntry>` im `WsState`.

### MEDIUM
- **`buildSidebarTree`-Cascade: 1 Realtime-Event triggert 3-4 parallele Refetches** — `routes/Workspace.tsx:705-718` + `:310-318`. Fix kurzfristig: Guard auf `currentNode()?.type==='matrix'`. Mittelfristig: workspace-weit batch-debounced.
- **`putAll()` IDB sequenzielle `delete()`-Schleife** — `lib/offline-cache.ts:126-133`. Bei 500 Karten: 500 serielle IDB-Ops in einer Transaktion. Fix: `Promise.all(existing.map(k=>store.delete(k)))`.
- **`MatrixAggregateSection.boardIds`-Memo ohne `equals`-Guard** — `components/MatrixAggregateSection.tsx:49-54`. Workspace-weite Node-/Cell-Events triggern Subtree-Walk + Netzwerk-Fetch auch wenn Aggregat unverändert.
- **`flatten()` in FrequencyMatrix non-memoized** — `components/FrequencyMatrix.tsx:79-88,117`. Doppelt reaktiv (expanded() + p.aggregates). Fix: `createMemo` um Aggregate-Recompute zu trennen.

### LOW
- GlobalSearch `groupResults`/`flatten` non-memoized → `components/GlobalSearch.tsx:147-148`
- `docs`-Volltextsuche ohne Index → `lib/search.ts:159-164` (bekanntes tsvector-Limit)

### Sauber gefunden
1 Channel + 10 Listener in `realtime.ts`; `scheduleAliasRefresh` 250ms-Debounce; `buildSidebarTree` als Memo; `cellMap` als Memo; Presence-Identity-Gate.

---

## 7 — Deploy (2 HIGH, 5 MEDIUM, 4 LOW)

### HIGH
- **CI `pr.yml` paths-Filter ungültig** — `.github/workflows/pr.yml:6-8`. `bridge/**` + `client/**` existieren nicht; Repo-Layout ist `packages/bridge/**` + `packages/client-web/**`. PRs triggern Pipeline nicht → ungeprüfte Merges möglich. Auch `working-directory: bridge` falsch (sollte `packages/bridge`).
- **`supabase-migrate.sh` schreibt PGPASSWORD-Output in `/tmp/migrate.log`** — `infra/scripts/supabase-migrate.sh:59-60`. World-readable; Information-Disclosure auf VPS mit Multi-User. Fix: `mktemp` + `trap 'rm -f $LOGFILE' EXIT`.

### MEDIUM
- **Realtime-Healthcheck prüft `realtime-dev`-Tenant statt `realtime`** — `infra/supabase/docker-compose.yml:155`. Migration 006 alias auf `realtime`; Healthcheck testet inaktiven Tenant.
- **Staging-nginx: rate-limit auskommentiert + kein CSP** — `infra/nginx/staging.matrix.levcon.at.conf:7-8,30`. Auth-Endpoints ohne Limit (Credential-Stuffing-Vektor); Production hat CSP, Staging nicht.
- **Production-nginx: kein OCSP-Stapling** — `infra/nginx/matrix.conf:32-44`. Latenz + Privacy-Leak. Fix: `ssl_stapling on; ssl_stapling_verify on; resolver ...`.
- **PWA `navigateFallback: '/index.html'` absolut statt BASE-relativ** — `packages/client-web/vite.config.ts:50`. Bei Sub-Pfad-Deploy 404 auf SW-Reload. Memory-Note `feedback_spa_subpath_router` deckt Router, nicht SW. Fix: `\`${BASE}index.html\``.
- **Migrations-Sort lexikographisch statt version-sort** — `infra/scripts/supabase-migrate.sh:49`. Bei `010_*` würde vor `009_*` sortieren. Fix: `find ... | sort -V`.

### LOW
- Kein `pg_dump`-Cron / Backup-Script → `infra/scripts/` (`supabase-backup.sh` fehlt)
- Kein externes Monitoring (Postgres/Auth/Realtime) → `infra/`
- `vector.yml` im Null-Modus (blackhole-Sink) → `infra/supabase/volumes/logs/vector.yml`
- Deploy-Step fehlt PostgREST-Smoke nach Migration → `.github/workflows/deploy.yml:132-159`

### Sauber gefunden
git-clean-Lesson korrekt umgesetzt (`deploy.yml:155-156`); Realtime-Publication für `docs` in 007 nachgezogen; FORCE RLS in 009 vollständig (13 Tabellen); systemd-Hardening produktionsreif (`PrivateTmp`, `ProtectSystem=strict`, `SystemCallFilter`); Deploy-Artifact-Layout per `pnpm deploy --prod` korrekt isoliert.

---

## Vorgeschlagene Mini-Sprints (AU-A1.x)

Sortiert nach Effort + Cross-Cutting-Wirkung. Jeder Sprint = 1 Commit.

| Sprint | Scope | Findings | Effort |
|---|---|---|---|
| **AU-A1.1** | `confirm`/`prompt` → `showConfirm`/`showPrompt` (14+ Stellen) | C7, UX-H, QA-H, Frontend-H | ~1h |
| **AU-A1.2** | `mutateCardChecklist` + `setChecklistAction`/`setChecklistRecur` + `applyChecklistClose` Offline-Wrapper | C1, C2, C3 | ~1h |
| **AU-A1.3** | `IDB DB_VERSION = 2` + `docs`-Store Upgrade-Branch | C4 | ~15min |
| **AU-A1.4** | URL-Sanitization Render-Pfad (BoardView/NodeTree) + Import-Pfad (subtree-import + import) | C5, C6 | ~30min |
| **AU-A1.5** | `btn-primary` CSS-Alias + ImportDialog-CSS-Block | C9, C10 | ~45min |
| **AU-A1.6** | Focus-Restore in 8 Overlays + `aria-modal` in 3 Dialogs + WorkspaceSwitcher Auto-Navigate | C8, UX-M | ~1h (oder zu A3 schieben) |
| **AU-A1.7** | `bindAliasAutocomplete`-Cleanup in 6 `ref`-Callbacks | C11 | ~20min |
| **AU-A1.8** | CI `pr.yml` paths-Filter fixen + PGPASSWORD `/tmp`-Log | C12, C13 | ~20min |
| **AU-A1.9** | `replayInFlight` workspace-scoped + `lookupAlias` Map-Index + FrequencyMatrix-Memo | QA-H, Perf-H | ~45min |
| **AU-A1.10** | `onCardDrop` IDB-Fallback + WCAG `--text2` (zu A3 verschoben) | Frontend-M, QA-M | ~30min |

**Empfohlene Reihenfolge:** A1.3 → A1.4 → A1.2 → A1.1 → A1.5 → A1.7 → A1.8 → A1.9 → A1.6 (kombiniert mit A3) → A1.10 (kombiniert mit A3).

A1.2 + A1.3 sind die kritischsten (Offline-Datenintegrität). A1.4 ist Security-Critical (XSS-Vektor via Import). A1.1 ist Quick-Win mit hoher Sichtbarkeit (UX-Konsistenz).

## Compact-Empfehlung

Nach Aggregation dieser Datei ist der Context groß (7 Agent-Outputs ≈ 25-30k Token). **Bevor Mini-Sprints AU-A1.x starten:** `/compact` empfehlen, da Plan-File + diese Findings-Datei + Memory autoritativ sind.
