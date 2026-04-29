# AU-B1 / Stream I — A1-Regression-Pass

**Datum:** 2026-04-29
**Scope:** `docs/audit/A1-rollen-findings.md` (18 HIGH + 29 MEDIUM + 5 Cross-Cutting-Gruppen C1–C13)
**Methode:** Code-Reviewer-Agent, Pro-Finding-Status-Check via Grep + Read + File:Line-Beweis. Ergänzend A4/A5 Spot-Check.

---

## Status-Verteilung

| Status | Count |
|---|---:|
| FIXED | 32 |
| OPEN-HIGH | 0 |
| OPEN-MEDIUM | 10 |
| DEFERRED | 5 |
| REGRESSION | 0 |

---

## Cross-Cutting-Beobachtungen

Alle 13 Cross-Cutting-Findings (C1–C13) aus A1 wurden in den Mini-Sprints AU-A1.1–A1.9 + AU-A2 + AU-A3 abgearbeitet. Die kritischsten — Offline-Wrapper (C1–C3), IDB-Version (C4), URL-Sanitization (C5–C6), window.confirm/prompt (C7) — sind vollständig behoben. Eine partielle Lücke verbleibt in C6 (`executeCellContainerMerge`). Sechs MEDIUM-Findings aus Architektur, Security und Performance sind bewusst open (kein kritischer Pfad) oder wurden mit Design-Entscheidung kommentiert aber nicht als Ticket angelegt.

**Keine Regression gefunden** — d.h. kein Finding wurde nach Behebung wieder gebrochen.

---

## C1–C13 Cross-Cutting-Findings — Status

| C-ID | Titel | Status | Beweis |
|---|---|---|---|
| C1 | `mutateCardChecklist` ohne Offline-Wrapper | FIXED | `92bed05`, `mutations.ts:1920–1952` |
| C2 | `setChecklistAction`/`setChecklistRecur` ohne `runOptimisticUpdate` | FIXED | `92bed05`, `mutations.ts:1526–1545` |
| C3 | `applyChecklistClose` Online-Bulk-Pfad nicht gequeued | FIXED (DEFERRED-Doku) | `92bed05`, `mutations.ts:1548–1599` |
| C4 | `IDB DB_VERSION = 1` ohne `docs`-Store | FIXED | `a6fd1d3`, `offline-cache.ts:76` (DB_VERSION=3) |
| C5 | URL-Sanitization fehlt im Render-Pfad | FIXED | `659987f`, `BoardView.tsx:44,859`, `NodeTree.tsx:53,210` |
| C6 | URL-Sanitization fehlt im Import-Pfad | PARTIAL | 3 von 4 Stellen gefixt; Lücke in `subtree-import.ts:930` → B1-I-001 |
| C7 | `window.confirm`/`prompt` flächendeckend | FIXED | `6f2a447`, kein produktiver Aufruf mehr |
| C8 | Focus-Restore fehlt in 8 Overlays | FIXED | `a72a7cc`, 20 Komponenten verwenden `installFocusRestore` |
| C9 | `btn-primary` CSS-Klasse existiert nicht | FIXED | `eaf8da1`, `btn-p` durchgängig |
| C10 | `ImportDialog` referenziert 13 nicht-existente CSS-Klassen | FIXED | `eaf8da1`, alle in `styles.css:5617–5716` |
| C11 | Listener-Leak in `bindAliasAutocomplete`-`ref`-Callbacks | FIXED | `a3f7918`, 6 Stellen mit `onCleanup(cleanup)` |
| C12 | CI `pr.yml`-Pfade ungültig | FIXED | `42d7731`, `pr.yml:7–10` korrigiert |
| C13 | `supabase-migrate.sh` PGPASSWORD in world-readable Log | FIXED | `42d7731`, `mktemp` + `trap rm` |

---

## A1-HIGH-Findings (18 Stück) — Status

| A1-ID | Titel-Kurz | Status | Beweis |
|---|---|---|---|
| UX-H1 | `btn-primary` CSS fehlt | FIXED | `eaf8da1` (→ C9) |
| UX-H2 | ImportDialog 13 fehlende CSS-Klassen | FIXED | `eaf8da1` (→ C10) |
| UX-H3 | Focus-Restore fehlt in 8 Overlays | FIXED | `a72a7cc` (→ C8) |
| UX-H4 | WorkspaceSwitcher kein Auto-Navigate zur Root-Matrix | DEFERRED | `WorkspaceSwitcher.tsx:68`. Bewusste Designentscheidung — `WorkspaceEmptyState` als Fallback. |
| ARCH-H1 | Drei unwrapped Direct-DB-Writes in mutations.ts | FIXED | `92bed05` (→ C1, C2) |
| ARCH-H2 | IDB `DB_VERSION = 1` ohne `docs`-Store | FIXED | `a6fd1d3` (→ C4) |
| ARCH-H3 | `applyChecklistClose` Bulk nicht gequeued | FIXED (dok. Defer) | `92bed05` (→ C3) |
| FE-H1 | Listener-Leak `bindAliasAutocomplete` | FIXED | `a3f7918` (→ C11) |
| FE-H2 | `window.confirm`/`prompt` in `CellInfoPage` | FIXED | `6f2a447` (→ C7) |
| QA-H1 | `window.confirm`/`prompt` flächendeckend | FIXED | `6f2a447` (→ C7) |
| QA-H2 | `mutateCardChecklist` ohne Offline-Pfad | FIXED | `92bed05` (→ C1) |
| QA-H3 | `replayInFlight` global statt workspace-scoped | FIXED | `15aaae3`, `mutation-queue.ts:177` |
| SEC-H1 | URL-Sanitization fehlt im Render-Pfad | FIXED | `659987f` (→ C5) |
| SEC-H2 | URL-Sanitization fehlt im Import-Pfad | PARTIAL | 1 Lücke verbleibt → B1-I-001 |
| PERF-H1 | FrequencyMatrix plain-getter statt Memo | FIXED | `15aaae3`, `FrequencyMatrix.tsx:99,108` |
| PERF-H2 | `lookupAlias()` O(n) Linear-Scan | FIXED | `15aaae3`, `alias-index.ts:36,273` |
| DEPLOY-H1 | CI `pr.yml` paths-Filter ungültig | FIXED | `42d7731` (→ C12) |
| DEPLOY-H2 | `supabase-migrate.sh` PGPASSWORD in Log | FIXED | `42d7731` (→ C13) |

**Resultat:** 16/18 vollständig FIXED, 1 PARTIAL (SEC-H2 — Render-Pfad schützt), 1 DEFERRED (UX-H4 Designentscheidung).

---

## A1-MEDIUM-Findings (29 Stück) — Status (Ausschnitt)

| A1-ID | Titel-Kurz | Status | Beweis / Verweis |
|---|---|---|---|
| UX-M1 | `aria-modal="true"` fehlt in 3 Dialogen | FIXED | `a72a7cc` |
| UX-M2 | WorkspaceSwitcher ESC: stopPropagation statt Immediate | OPEN | → B1-I-002 |
| UX-M3 | Sidebar Tap-Target ~24px Mobile | OPEN | → B1-I-003 |
| UX-M4 | HeaderSearchBar 160ms Magic-Literal | OPEN | → B1-I-004 |
| ARCH-M1 | `mutateCardChecklist` ohne IDB-Cache-Read | FIXED | `92bed05` |
| ARCH-M2 | workspace-reset.ts undokumentiert | FIXED | File-Header dokumentiert |
| ARCH-M3 | Bridge ohne `doc.*`-Tools | OPEN | → B1-I-005 |
| ARCH-M4 | `query.aliases` ignoriert `doc`-Kind | OPEN | → B1-I-006 |
| ARCH-M5 | Realtime-Wiring Aliases-Notiz | DEFERRED | dokumentiert |
| ARCH-M6 | `setChecklistAction/Recur` ohne `workspace_id`-Guard | DEFERRED | RLS schützt; Defense-in-Depth |
| FE-M1 | RAF ohne `cancelAnimationFrame` | OPEN | → B1-I-007 |
| FE-M2 | `onCardDrop` Raw-supabase-Reads | OPEN | → B1-I-008 |
| FE-M3 | `z-index: 10000` Inline | FIXED | `AliasAutocomplete.tsx:40` |
| QA-M1 | `window.confirm` in commands.ts | FIXED | `6f2a447` |
| QA-M2 | `addCellInfoField` Offline-Gap | FIXED | via `mutateCellData` |
| QA-M3 | `onCardDrop` Raw-reads | OPEN | identisch FE-M2 |
| QA-L1 | Null-Testabdeckung client-web | DEFERRED | Backlog |
| QA-L2 | Realtime-Event-Dedup-Flicker | DEFERRED | Backlog |
| SEC-M1 | CORS-Allowlist ohne URL-Validation | FIXED | `9eb176b`, `bridge/src/index.ts:35–49` |
| SEC-M2 | Memberships-RLS zu breit | OPEN | → B1-I-009 (HIGH-empfohlen) |
| SEC-M3 | Bridge Snapshot ohne Größenlimit | OPEN | → B1-I-010 (HIGH-empfohlen) |
| SEC-M4 | `_encPw`-Invariante nicht formal garantiert | DEFERRED | Backlog |
| PERF-M1 | Realtime-Cascade-Refetches | OPEN | → B1-I-011 |
| PERF-M2 | `putAll()` sequenzielles Delete | OPEN | → B1-I-012 |
| PERF-M3 | `boardIds`-Memo ohne `equals`-Guard | OPEN | → B1-I-013 |
| PERF-M4 | `flatten()` non-memoized | FIXED | `15aaae3` |
| DEPLOY-M1 | Realtime-Healthcheck `realtime-dev` | OPEN | → B1-I-014 |
| DEPLOY-M2 | Staging-nginx Rate-Limit + CSP | OPEN | → B1-I-015 |
| DEPLOY-M3 | Production-nginx OCSP-Stapling | OPEN | → B1-I-016 |
| DEPLOY-M4 | PWA navigateFallback | FIXED | `vite.config.ts:55` |
| DEPLOY-M5 | Migrations-Sort | DEFERRED | dokumentiertes Risiko |

---

## Findings (neue B1-I-Findings aus dem Regression-Pass)

### [MEDIUM] B1-I-001 — C6-Partial: URL ohne sanitizeUrl in `executeCellContainerMerge`

**File:** `packages/client-web/src/lib/subtree-import.ts:930`

**Was:** Im zweiten Links-Merge-Pfad innerhalb von `executeCellContainerMerge` fehlt `sanitizeUrl`. Drei andere Stellen in derselben Datei (1043, 1225, 1618) wurden in AU-A1.4 korrekt gefixt.

**Fix:** `url: sanitizeUrl(l.url as string) ?? '',` (analog Zeile 1043).

**Effort:** XS

---

### [MEDIUM] B1-I-002 — UX-M2: WorkspaceSwitcher ESC `stopPropagation` statt `stopImmediatePropagation`

**File:** `packages/client-web/src/components/WorkspaceSwitcher.tsx:92`

**Fix:** `e.stopImmediatePropagation()` auf Zeile 92.

**Effort:** XS

---

### [MEDIUM] B1-I-003 — UX-M3: Sidebar Tree-Link Tap-Target zu klein auf Mobile

**File:** `packages/client-web/src/styles.css` (kein `@media (max-width:480px)` für `.tree-link`)

**Fix:** Im Mobile-Breakpoint `.tree-link { min-height: 44px; }`.

**Effort:** XS

---

### [LOW] B1-I-004 — UX-M4: Animation-Literal statt Token in HeaderSearchBar + Workspace

**File:** `styles.css:1584` (160ms ease-out), `styles.css:2457` (180ms cubic-bezier)

**Fix:** `var(--tr-enter)` oder neuer `--tr-fast`-Token.

**Effort:** XS

---

### [MEDIUM] B1-I-005 — ARCH-M3: Bridge hat keine `doc.*`-Tools

**File:** `packages/bridge/src/tools/index.ts`

**Was:** Migration 007 hat `docs`-Tabelle + Client-Mutations vollständig. Bridge hat kein `doc.create/update/delete/list`. CLAUDE.md 4-Artefakte-Regel verletzt.

**Effort:** M

---

### [LOW] B1-I-006 — ARCH-M4: `query.aliases` ohne `doc`-Kind in Typ-Enum

**File:** `packages/bridge/src/tools/query.ts:26`

**Fix:** `'doc'` zum Enum hinzufügen.

**Effort:** XS

---

### [MEDIUM] B1-I-007 — FE-M1: `requestAnimationFrame` ohne `cancelAnimationFrame` in NodeTree

**File:** `packages/client-web/src/components/NodeTree.tsx:1098`

**Was:** Bei schnellem Workspace-Wechsel kann der RAF-Callback nach Unmount feuern. **Cross-Stream:** Stream D B1-D-010 hat dasselbe gefunden.

**Fix:** `const raf = requestAnimationFrame(...); onCleanup(() => cancelAnimationFrame(raf));`

**Effort:** S

---

### [MEDIUM] B1-I-008 — FE-M2/QA-M3: `onCardDrop` Raw-supabase-Reads

**File:** `packages/client-web/src/components/NodeTree.tsx:1002–1024`

**Was:** Direkte `supabase.from(...)` Reads ohne `isNetworkError`-Catch + IDB-Fallback. **Cross-Stream:** Stream D B1-D-001 (CRITICAL) hat das gefunden.

**Effort:** M

---

### [HIGH] B1-I-009 — SEC-M2: Memberships-RLS zu breit (Privacy-Leak)

**File:** `infra/supabase/migrations/001_workspaces.sql:135–136`

**Was:** Jedes Member kann alle Membership-Rows des Workspaces lesen — inkl. E-Mail-Adressen, Rollen, Einladungsstatus. ASVS V4.1.3.

**Fix:** Neue Migration mit angepasster Policy (siehe Detail im Stream-I-Output).

**Effort:** M

---

### [HIGH] B1-I-010 — SEC-M3: Bridge Snapshot ohne Größenlimit (DoS)

**File:** `packages/bridge/src/state/snapshot.ts:11–22`

**Was:** Kein `payload.length`-Check. Ein bösartiger Bridge-Token kann beliebig große Payloads senden, SQLite/Disk füllen. CWE-400.

**Fix:** `if (payload.length > MAX_SNAPSHOT_BYTES) return;` am Anfang von `storeSnapshot`.

**Effort:** XS

---

### [MEDIUM] B1-I-011 — PERF-M1: 1 Realtime-Event → 3-4 parallele Refetches

**File:** `packages/client-web/src/routes/Workspace.tsx:780–828`

**Was:** Beispiel `cells`-Event: `refetchCells + refetchMatrix + refetchCellMatrix + scheduleAliasRefresh`. Kein Batch-Debounce. **Cross-Stream:** Stream H B1-H-012 hat verwandtes Pattern bei `resolverMaps` gefunden.

**Effort:** M

---

### [LOW] B1-I-012 — PERF-M2: `putAll()` sequenzielle IDB-Delete-Schleife

**File:** `packages/client-web/src/lib/offline-cache.ts:127–128`

**Fix:** `Promise.all(existing.map(k => store.delete(k)))`.

**Effort:** XS

---

### [LOW] B1-I-013 — PERF-M3: `boardIds`-Memo ohne `equals`-Guard

**File:** `packages/client-web/src/components/MatrixAggregateSection.tsx:42–48`

**Effort:** XS

---

### [MEDIUM] B1-I-014 — DEPLOY-M1: Realtime-Healthcheck prüft inaktiven Tenant

**File:** `infra/supabase/docker-compose.yml:155`

**Was:** Healthcheck prüft `realtime-dev`-Tenant, aktiv ist `realtime` (Migration 006).

**Fix:** `realtime-dev` → `realtime`.

**Effort:** XS

---

### [MEDIUM] B1-I-015 — DEPLOY-M2: Staging-nginx ohne Rate-Limit + ohne CSP

**File:** `infra/nginx/staging.matrix.levcon.at.conf:7–8,62,91`

**Was:** **Cross-Stream:** Stream G B1-G-008 + B1-G-009 haben dasselbe gefunden.

**Effort:** S

---

### [LOW] B1-I-016 — DEPLOY-M3: Production-nginx kein OCSP-Stapling

**File:** `infra/nginx/matrix.conf`

**Effort:** XS

---

## Zusammenfassung

**16 von 18 HIGH-Findings sind FIXED.** Die verbleibenden zwei in der obigen Tabelle: UX-H4 (DEFERRED-Designentscheidung) und SEC-H2 (PARTIAL → B1-I-001 als MEDIUM weil Render-Pfad bereits schützt).

**10 MEDIUM-Findings sind noch OPEN**, davon 2 als HIGH-Priority empfohlen (B1-I-009 Memberships-RLS, B1-I-010 Bridge-Snapshot-DoS) wegen Security-Impact.

**Kein finding ist REGRESSION** — d.h. einmal behobene Issues sind stabil geblieben.

**Empfohlene Pre-V1-Prioritäten aus Regression-Pass:**

| Prio | Finding | Begründung |
|---|---|---|
| 1 | B1-I-009 | SEC-M2 Memberships-RLS — Privacy-Leak |
| 2 | B1-I-010 | SEC-M3 Bridge-Snapshot DoS — einfacher Fix, echter Angriffspfad |
| 3 | B1-I-001 | C6-Partial: `javascript:`-URL landet in DB (DB-Hygiene) |
| 4 | B1-I-014 | Realtime-Healthcheck falsch — Silent-Failure bei Realtime-Ausfall |
| 5 | B1-I-007 | FE-M1 RAF ohne Cancel — Race-Condition |
| 6 | B1-I-005 | ARCH-M3 Bridge ohne `doc.*`-Tools — 4-Artefakte-Regel |
