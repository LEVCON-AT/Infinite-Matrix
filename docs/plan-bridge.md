# Plan: Bridge + MCP + Auto-Deployment

**Erstellt:** 2026-04-18
**Status:** entworfen, Implementierung steht aus
**Voraus:** Branch `code-review-sprints` → `main` gemerged
**Repo:** `github.com/LEVCON-AT/Infinite-Matrix`
**Owner:** admin@levcon.at
**Interim-Domain:** `matrix.levcon.at` (wird mit SaaS-Phase + finalem Produktnamen umgezogen — s. Abschnitt 2)
**VPS:** IONOS Deutschland (Ubuntu LTS)

Dieser Plan führt die Infinite-Matrix-App von heutiger Single-File-HTML auf ein Bridge-System (Node+TS auf VPS) mit MCP-Unterstützung, reverse-proxyt über nginx, mit GitHub-Actions-Auto-Deploy. Nach Abschluss kann Claude Desktop / Cursor / jeder MCP-Client via AI-Tool-Calls die laufende Matrix-Session lesen und manipulieren. Das ist die Grundlage für AI-Onboarding, Shift+C-Helper, E-Mail-Ingest, Messenger-Integration, n8n und Ticket-System-Adapter — alle hängen genau an dieser Infrastruktur.

Der Client (matrix_tool_beta.html) **bleibt Single-File** per CLAUDE.md §Arbeitsprinzipien #5. Die Bridge ist ein separates Projekt im gleichen Monorepo.

---

## Inhalt

1. [Ziel & Nicht-Ziel](#1-ziel--nicht-ziel)
2. [Annahmen + offene User-Entscheidungen](#2-annahmen--offene-user-entscheidungen)
3. [Architektur-Übersicht](#3-architektur-übersicht)
4. [Tech-Stack (mit Begründungen)](#4-tech-stack-mit-begründungen)
5. [Git-Strategie & Repo-Layout](#5-git-strategie--repo-layout)
6. [Phase 0 — Repo-Restructure & Git-Setup](#phase-0--repo-restructure--git-setup)
7. [Phase 1 — Bridge-Skeleton + Client-Tools (lokal)](#phase-1--bridge-skeleton--client-tools-lokal)
8. [Phase 2 — VPS-Infrastruktur](#phase-2--vps-infrastruktur)
9. [Phase 3 — CI/CD mit GitHub Actions](#phase-3--cicd-mit-github-actions)
10. [Phase 4 — MATRIX_TOOLS v1 (Tool-Liste)](#phase-4--matrix_tools-v1-tool-liste)
11. [Phase 5 — First AI-E2E-Proof (Abnahme)](#phase-5--first-ai-e2e-proof-abnahme)
12. [Artefakte (komplette Dateien zum Copy-Paste)](#artefakte-komplette-dateien-zum-copy-paste)
13. [Runbook](#runbook)
14. [Risiken](#risiken)

---

## 1. Ziel & Nicht-Ziel

### Ziel

- Ein lauffähiger Bridge-Prozess (Node 22 + TypeScript + Fastify + SQLite) auf einem VPS.
- WebSocket-Sync zwischen Matrix-HTML-Client und Bridge (State-Snapshots + Tool-Call-Dispatch).
- MCP-Server (Model-Context-Protocol) auf der Bridge, über HTTP-Transport erreichbar.
- ~15–20 erste `MATRIX_TOOLS` im Client, aufrufbar via MCP, validiert via Zod.
- nginx als TLS-Terminator + Static-Server für Client + Reverse-Proxy für WS und MCP.
- GitHub-Actions-Workflow: auf jedem Merge in `main` lint → typecheck → test → build → SSH-Deploy → systemd-Restart → Smoke-Check.
- Protected main-Branch, Feature-Branches via PR, Conventional-Commits, Semver-Tags.
- Abnahme: Claude Desktop erstellt via Prompt eine neue Matrix-Struktur in der laufenden Browser-Session.

### Explizit nicht Ziel (später)

- Multi-User / Accounts (SaaS-Roadmap Phase 5)
- Collaborative-Editing / Yjs (Phase 6)
- Staging-Environment — kommt später als zweiter systemd-Service + Nginx-vhost, wenn erste Prod-Deploys instabil werden.
- E-Mail-Ingest, Slack-Slash-Commands, Jira-Sync, iCal-Sync — alles danach als Adapter auf derselben Bridge.
- Desktop-App (Tauri) — Phase 7
- Template-Marketplace — nach AI-Onboarding

---

## 2. Annahmen + offene User-Entscheidungen

### Fixe Annahmen

- VPS: Ubuntu **22.04 LTS oder 24.04 LTS** (Server-Edition, ≥1 vCPU, ≥1 GB RAM, ≥20 GB Disk)
- Node **22 LTS** (Support bis 2027-04)
- Browser: Chrome/Edge/Firefox aktuell
- Repo bleibt: `github.com/LEVCON-AT/Infinite-Matrix`

### Entscheidungen (Stand Planerstellung)

- [x] **Domain (interim):** `matrix.levcon.at` — A-Record auf IONOS-VPS-IP setzen (+ AAAA für IPv6 falls vorhanden)
- [x] **VPS:** IONOS Deutschland, Ubuntu LTS (22.04 oder 24.04)
- [x] **Bearer-Token:** Bridge akzeptiert in v1 einen einzigen Bearer-Token (aus `.env`), Client trägt ihn beim ersten Launch via Prompt oder Query-Param ein, speichert in localStorage. Kein Account-System.
- [x] **E-Mail für Certbot:** `admin@levcon.at`
- [x] **GitHub Actions Runner:** public runners, keine Self-hosted nötig

### Offen — für spätere SaaS-Phase

- [ ] **Finaler Produktname + Zieldomain** — Matrix wird aus `matrix.levcon.at` auf eigene Domain umziehen, sobald Produktname steht. Der Umzug ist dank Bearer-Token-Auth + reinem DNS/nginx-Config-Swap unaufwendig: neue Domain beantragen → A-Record → certbot erneuern → nginx `server_name` anpassen → `.github/secrets/DEPLOY_HOST` updaten. Keine Code-Änderungen nötig.

---

## 3. Architektur-Übersicht

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER'S LAPTOP                                   │
│                                                                         │
│  ┌────────────────────┐         ┌──────────────────────────────┐       │
│  │  Matrix HTML       │         │  Claude Desktop / Cursor     │       │
│  │ /matrix_tool_beta  │         │  (MCP client)                │       │
│  │                    │         │                              │       │
│  │  - State authority │         │  spricht stdio MCP           │       │
│  │  - MATRIX_TOOLS    │         │  via mcp-remote-shim         │       │
│  │  - WS client       │         └───────────────┬──────────────┘       │
│  └──────────┬─────────┘                         │                       │
│             │  wss://matrix.levcon.at/ws      │  https://…/mcp        │
└─────────────┼───────────────────────────────────┼───────────────────────┘
              │                                   │
              ▼                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          VPS (Ubuntu LTS)                               │
│                                                                         │
│     ┌────────────────────────────────────────────────────────────┐    │
│     │                  nginx (:443, TLS via LE)                   │    │
│     │  /               → /var/www/matrix/matrix_tool_beta.html   │    │
│     │  /ws             → proxy → http://127.0.0.1:3849/ws        │    │
│     │  /mcp            → proxy → http://127.0.0.1:3849/mcp       │    │
│     │  /healthz        → proxy → http://127.0.0.1:3849/healthz   │    │
│     └────────────────────────────┬───────────────────────────────┘    │
│                                  │                                      │
│     ┌────────────────────────────▼───────────────────────────────┐    │
│     │       systemd service: matrix-bridge (Node 22, :3849)      │    │
│     │                                                             │    │
│     │   ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌─────────────┐│    │
│     │   │ Fastify │  │ WS       │  │ MCP     │  │ Tool        ││    │
│     │   │ HTTP    │  │ Handler  │  │ HTTP    │  │ Dispatcher  ││    │
│     │   │ + auth  │  │          │  │ SSE     │  │ (Zod)       ││    │
│     │   └────┬────┘  └────┬─────┘  └────┬────┘  └──────┬──────┘│    │
│     │        └────────────┼─────────────┴──────────────┘       │    │
│     │                     │                                     │    │
│     │              ┌──────▼──────┐                              │    │
│     │              │   SQLite    │  /opt/matrix-bridge/data/   │    │
│     │              │   (state,   │  matrix.db                   │    │
│     │              │   snapshots,│                              │    │
│     │              │   audit)    │                              │    │
│     │              └─────────────┘                              │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                                                                         │
│     UFW: 22, 80, 443 only · fail2ban: SSH · certbot: auto-renew        │
└─────────────────────────────────────────────────────────────────────────┘
```

**Wichtige Invarianten:**

- **Client ist State-Authority.** Das echte State lebt im Browser (per CLAUDE.md). Bridge hält nur den letzten Snapshot für MCP-Queries. Schreib-Tools routen über Bridge → Client → Mutation → Bridge → MCP.
- **Ein aktiver Client pro Bridge** (v1). Zweiter Client wird abgelehnt. Multi-Session kommt mit Accounts (Phase 5).
- **MCP läuft remote**, nicht als lokaler stdio-Prozess. User konfiguriert Claude Desktop mit dem `mcp-remote`-Shim.
- **Bearer-Token-Auth** (v1). Sekret im Bridge-`.env`, Client trägt's manuell ein. Kein User-Registry.

---

## 4. Tech-Stack (mit Begründungen)

| Komponente | Wahl | Warum diese |
|---|---|---|
| Laufzeit | Node 22 LTS | LTS bis 2027, bester MCP-SDK-Support, Fastify-stabil. |
| Sprache | TypeScript 5.x | Typsicherheit für Tool-Schemas, Refactoring-Kapital für später. |
| Web-Framework | Fastify 5 | Schneller als Express, bessere Type-Safety, gute WS-/SSE-Support. |
| Package-Manager | pnpm 9 | Schnell, Disk-effizient, beste Monorepo-Basis. |
| WebSocket | @fastify/websocket | Native Fastify-Integration. |
| MCP | @modelcontextprotocol/sdk (TS) | Offizielle Anthropic-SDK, Streamable-HTTP-Transport eingebaut. |
| DB | SQLite via better-sqlite3 | Zero-Admin (eine Datei), schneller als Postgres für single-user, Backup = rsync. Postgres später bei Bedarf. |
| Validierung | Zod | Single-Source für TS-Types + Runtime-Validation + MCP-JSON-Schema-Ableitung. |
| Logging | pino | Fastify-Default, strukturiertes JSON, journalctl-freundlich. |
| Test | vitest | Schneller als Jest, native TS, keine Config-Akrobatik. |
| Lint/Format | biome | Eine Binary statt ESLint+Prettier-Kaskade, ~30× schneller. |
| Web-Server | nginx | Battle-tested, TLS, WS-Proxy, Static-Serving in einem. |
| TLS | Let's Encrypt / certbot | Gratis, auto-renew via systemd-timer. |
| Prozess-Manager | systemd | Kein extra Daemon (pm2 etc.), Journald + Security-Directives inklusive. |
| Firewall | UFW + fail2ban | Ubuntu-Standard, minimal-invasiv. |
| CI/CD | GitHub Actions (public runners) | Repo ist ohnehin dort, ~2000 Free-Minuten/Monat reichen für Solo-Dev. |
| Deployment | rsync + SSH | Einfach, kein Docker-Overhead, sofort reversibel. |

**Warum kein Docker (in v1)?**
Bridge ist ein einziger Node-Prozess mit einer SQLite-Datei. Docker/Compose wäre zusätzliche Ebene, die wir noch nicht brauchen. systemd erledigt Restart, Logging und Ressourcenbegrenzung gut genug. Wechsel auf Docker später ist möglich (v2), wenn Multi-Tenant kommt.

**Warum kein PocketBase (jetzt)?**
CLAUDE.md nennt PocketBase als SaaS-Ziel — das gilt für Phase 5+ (Accounts, Realtime-Admin). In v1 brauchen wir davon nichts; SQLite + Fastify reichen. PocketBase bringt Go-Hooks-Overhead mit, wenn wir ohnehin Node brauchen (MCP-SDK ist primär Node/Python).

---

## 5. Git-Strategie & Repo-Layout

### Branch-Modell (trunk-based, PR-gated)

```
main            ── prod. Geschützt. Nur via PR mergen. Auto-deploy bei Merge.
 │
 ├── feat/<name>     neue Features (z.B. feat/matrix-tools-v1)
 ├── fix/<name>      Bugfixes
 ├── chore/<name>    Refactoring, Tooling, Dependencies
 ├── docs/<name>     Nur Doku
 └── ci/<name>       Nur Workflows/Infra
```

- Branch-Namen: kebab-case, scope im Präfix
- Lebenszyklus: Branch für genau eine Aufgabe, <5 Tage
- Merge-Strategie: **Squash-Merge** (eine Commit pro PR auf main, Historie im PR bleibt)
- Keine Force-Pushes auf `main` (per Branch-Protection blockiert)

### Commit-Konvention (Conventional Commits + Projekt-Spezifika)

```
<type>(<scope>): <kurzer Titel in dt.>

<Body — optional, erklärt Warum. Bullets.>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

**Types:** `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`, `style`, `perf`, `build`
**Scopes (Beispiele):** `client`, `bridge`, `bridge/tools`, `infra/nginx`, `infra/systemd`, `ci`, `docs`

Beispiele:
```
feat(bridge): WebSocket-Protokoll v1 + Tool-Dispatch
fix(bridge/ws): Reconnect-Loop bei State-Resync-Fehler
ci: rsync-Deploy + systemd-Restart Smoke-Check
refactor(client): MATRIX_TOOLS-Registry als Top-Level-Dispatch
```

Die bestehende Sub-Sprint-Konvention aus CLAUDE.md (`Sprint X.Y: …`) bleibt für Review-Sprints gültig — wir erweitern um Conventional-Commits für alle Neuentwicklungen.

### Tags & Releases

- Semver-Tags nach Meilensteinen: `v0.1.0` (Bridge-MVP), `v0.2.0` (MCP v1), `v0.3.0` (AI-Onboarding) usw.
- Release-Notes initial manuell in GitHub Releases, später automatisch via `release-please` oder `git-cliff` (kein Muss).

### Branch Protection Rules für `main` (GitHub Settings → Branches)

- [x] Require a pull request before merging
- [x] Require status checks to pass (siehe Phase 3): `test-bridge`
- [x] Require branches to be up to date before merging
- [x] Require conversation resolution before merging
- [x] Require linear history (wegen Squash-Merge)
- [x] Block force pushes
- [x] Do not allow deletions
- [ ] Require signed commits (optional, kann nerven bei AI-Coauthor-Setup)
- [ ] Require approval (bei Solo-Dev entweder: User is admin und kann approval bypassen, oder: deaktivieren — wir entscheiden beim Setup)

### Repo-Layout nach Phase 0

```
infinite-matrix/
├── client/
│   └── matrix_tool_beta.html       # einziger Client-File (umgezogen)
├── bridge/
│   ├── src/
│   │   ├── index.ts                # Fastify bootstrap
│   │   ├── config.ts               # Env-Loading + Zod-Schema
│   │   ├── db.ts                   # better-sqlite3 init
│   │   ├── auth.ts                 # Bearer-Token-Hook
│   │   ├── protocol.ts             # Client↔Bridge Message-Types
│   │   ├── ws.ts                   # WebSocket-Handler
│   │   ├── mcp.ts                  # MCP-Server setup
│   │   ├── dispatcher.ts           # Tool-Dispatch-Logik
│   │   ├── tools/                  # eine Datei pro Tool-Gruppe
│   │   │   ├── index.ts            # Tool-Registry
│   │   │   ├── matrix.ts
│   │   │   ├── row-col.ts
│   │   │   ├── cell.ts
│   │   │   ├── board-card.ts
│   │   │   ├── info-link.ts
│   │   │   ├── checklist.ts
│   │   │   ├── alias.ts
│   │   │   ├── query.ts
│   │   │   ├── template.ts
│   │   │   └── settings.ts
│   │   └── state/
│   │       ├── session.ts          # aktive Client-Session
│   │       └── snapshot.ts         # letzter State-Snapshot
│   ├── test/
│   │   └── *.test.ts
│   ├── package.json
│   ├── tsconfig.json
│   ├── biome.json
│   └── vitest.config.ts
├── infra/
│   ├── nginx/
│   │   └── matrix.conf
│   ├── systemd/
│   │   └── matrix-bridge.service
│   └── scripts/
│       ├── setup-vps.sh            # einmaliges Provisioning
│       ├── install-deps.sh         # node, nginx, sqlite, certbot
│       └── harden.sh               # UFW, fail2ban, SSH
├── docs/
│   ├── plan-bridge.md              # dieses Dokument
│   ├── protocol.md                 # (später) Client↔Bridge-Protokoll-Ref
│   ├── tools.md                    # (später) MATRIX_TOOLS-Referenz
│   └── ops.md                      # (später) Runbook
├── .github/
│   └── workflows/
│       ├── deploy.yml              # main → VPS
│       └── pr.yml                  # PR-Checks (lint, typecheck, test)
├── .gitignore
├── BACKLOG.md                      # bestehend
├── CLAUDE.md                       # bestehend, wird ergänzt
├── README.md                       # (neu)
└── .editorconfig                   # (optional)
```

**V1-Ordner** (parallel bestehend, nicht Teil der neuen Struktur):

`V1/` hält die aktuell vom User produktiv genutzte App-Version inkl. bisheriger Artefakte (`_check.js`, `matrix-data.json`, `email-integration-konzept.md`, `Archiv/`, `matrix_tool_beta.html`). Der User benutzt `V1/` weiter, während wir in `client/`, `bridge/`, `infra/` die v2-Architektur aufbauen. `V1/` wird **im Git versioniert** (damit die Historie nicht verschwindet), aber **nicht deployt**, **nicht gelint**, **nicht getestet** — Excludes in `biome.json`, `tsconfig.json`, `.github/workflows/*.yml` (`paths:`-Filter) und nginx-Setup greifen nicht auf V1 zu. Wenn User v2 stabil findet, wird V1 bei passender Gelegenheit gelöscht — in der Zwischenzeit nicht anfassen.

---

## Phase 0 — Repo-Restructure & Git-Setup

**Ziel:** Sauberer Monorepo-Baum, `main` ist geschützt, PR-Flow funktioniert, CLAUDE.md bringt Git-Konvention nach.

**Branch:** `chore/repo-restructure`
**Aufwand:** 0.5 Tag

### Sub-Schritte

**0.1 Vorarbeit**

- [x] `code-review-sprints` ist in `main` gemerged (separater Prompt vor Phase-Start)
- [x] Root-Artefakte sind vom User nach `V1/` verschoben (User hält dort die laufende App-Version, die sie privat weiter benutzt — V1 ist also keine reine Archiv-Ablage, sondern die produktive Parallel-Installation, solange v2 entsteht)
- [ ] Status-Check am Start: `git status` zeigt sauberen Tree, `ls` am Root zeigt `BACKLOG.md`, `CLAUDE.md`, `V1/`, `docs/`, `bridge/` (leer), `client/` (leer), `infra/` (leer), `.github/` (leer). Falls noch Artefakte im Root liegen: erst räumen, dann weiter.
- [ ] Entscheidung zu Client-Quelle für Phase 0.2: `cp V1/matrix_tool_beta.html client/matrix_tool_beta.html` (V1 bleibt intakt als User-Arbeitskopie), oder alternativ aus dem git-Stand vor Move extrahieren. Empfehlung: `cp` aus V1, weil das genau der letzte stabile Stand ist.

**0.2 Restructure**

- [ ] `cp V1/matrix_tool_beta.html client/matrix_tool_beta.html` (V1 bleibt unangetastet als User-Arbeitskopie)
- [ ] `.claude/launch.json` anpassen — Preview-Server muss aus `client/` servieren (oder aus Root, beides funktioniert mit relativem Pfad)
- [ ] `docs/plan-bridge.md` ist schon da (dieses Dokument)
- [ ] `bridge/`, `infra/`, `.github/workflows/` als leere Gerüste anlegen (mit `.gitkeep`)
- [ ] `.gitignore` schreiben (node_modules, dist, *.db, .env, .env.local, coverage, .DS_Store)
- [ ] `README.md` minimal schreiben (2-3 Absätze: Was ist Infinite Matrix, wie lokal starten, wo deployt)
- [ ] `.editorconfig` mit Projektstandards (2 Space, LF, UTF-8)
- [ ] Commit: `chore(repo): Monorepo-Layout, Client nach client/ verschoben`

**0.3 Git-Setup (auf GitHub)**

- [ ] Branch-Protection-Rules für `main` setzen (Liste aus Abschnitt 5)
- [ ] GitHub Environment `production` anlegen (für spätere Actions-Secrets)
- [ ] Labels für PRs anlegen: `feat`, `fix`, `chore`, `ci`, `infra`, `docs`

**0.4 CLAUDE.md ergänzen**

- [ ] Neue Sektion „Git-Strategie" mit Branch-Modell + Conventional-Commits
- [ ] Commit: `docs(claude): Git-Strategie + Commit-Konvention aufgenommen`

**Abnahme Phase 0:**
- Repo-Layout matched Abschnitt 5
- `main` auf GitHub ist geschützt
- `matrix_tool_beta.html` liegt unter `client/`, Preview-Server rendert wie vorher
- CLAUDE.md Git-Sektion ist drin

---

## Phase 1 — Bridge-Skeleton + Client-Tools (lokal)

**Ziel:** Lokal lauffähige Bridge, WebSocket-Sync zum Client funktioniert, erste Tools via MCP aufrufbar. Noch kein Deploy.

**Branch:** `feat/bridge-skeleton`
**Aufwand:** 2–3 Tage (Kern), danach Tools inkrementell

### 1.1 Bridge-Projekt initialisieren

```bash
cd bridge
pnpm init
pnpm add fastify @fastify/websocket @fastify/cors @modelcontextprotocol/sdk better-sqlite3 zod pino pino-pretty
pnpm add -D typescript tsx @types/node @types/better-sqlite3 vitest @biomejs/biome
```

Dateien: `package.json` (Scripts), `tsconfig.json`, `biome.json`, `vitest.config.ts` — siehe [Artefakte](#artefakte-komplette-dateien-zum-copy-paste).

**Scripts:**
- `pnpm dev` — `tsx watch src/index.ts`
- `pnpm build` — `tsc`
- `pnpm start` — `node dist/index.js`
- `pnpm test` — `vitest run`
- `pnpm lint` — `biome check src test`
- `pnpm typecheck` — `tsc --noEmit`

**Commit:** `feat(bridge): Projekt-Skeleton, Build-Pipeline`

### 1.2 Fastify-Bootstrap + Health

`src/index.ts`: Fastify-App, GET `/healthz` → 200 `{ ok, uptime }`. Port aus `config.ts` (default 3849).
`src/config.ts`: Zod-Schema für Env-Vars (PORT, TOKEN, DB_PATH, LOG_LEVEL).
`src/db.ts`: better-sqlite3 init, Migration v1 (Tabellen `sessions`, `snapshots`, `audit_log`).
`src/auth.ts`: Fastify-Hook — prüft `Authorization: Bearer <token>` auf alle Routen außer `/healthz`.

**Commit:** `feat(bridge): Fastify+SQLite-Bootstrap, Health + Bearer-Auth`

### 1.3 Client↔Bridge-Protokoll (Types)

`src/protocol.ts`: Zod-Schemas für alle Messages:

```typescript
// Client → Bridge
ClientHello        { clientId, protocolVersion, clientVersion }
ClientSnapshot     { version, payload: JSON }
ClientToolResult   { callId, ok: true, result: JSON }
ClientToolError    { callId, ok: false, error: { code, message } }
ClientPong         { seq }

// Bridge → Client
BridgeHelloAck     { sessionId, serverVersion }
BridgeToolCall     { callId, tool, args }
BridgeStateRequest {}
BridgePing         { seq }
BridgeNotice       { level: 'info'|'warn'|'error', message }
```

Alle Nachrichten haben `type`-Discriminator. `protocol.ts` exportiert `clientMsgSchema` und `bridgeMsgSchema` (Zod Union).

**Commit:** `feat(bridge): Protokoll-Types (Zod)`

### 1.4 WebSocket-Handler + Session-State

`src/state/session.ts`: Singleton `CurrentSession` — hält genau eine aktive WS-Connection, `pendingToolCalls` (Map<callId, Deferred>), `latestSnapshot`.
`src/ws.ts`: Fastify-Plugin, Route `/ws`:
- Beim Connect: prüfe Token (aus `?token=…` oder `Authorization`-Header beim Upgrade)
- Wenn schon Session aktiv: neue Connection bekommt `notice` "session busy" und wird geschlossen
- Beim Disconnect: Session räumen, pending Tool-Calls mit Fehler rejecten
- Routing: eingehende Message → Zod-parse → in Session einspeisen (Snapshot speichern, Tool-Result resolven)

**Commit:** `feat(bridge): WebSocket-Handler + Session-State`

### 1.5 Client-seitig: `BridgeClient` + `MATRIX_TOOLS`

Im `client/matrix_tool_beta.html` (am Ende der existierenden `<script>`-Sektion):

```javascript
// --- Bridge-Connection ---
const BRIDGE_URL = localStorage.getItem('bridgeUrl') || '';  // leer = kein Bridge-Mode
const BRIDGE_TOKEN = localStorage.getItem('bridgeToken') || '';

const BridgeClient = (() => {
  let ws = null;
  let reconnectTimer = null;

  function connect() { /* WS-Open, onmessage dispatch, onclose reconnect */ }
  function sendSnapshot() { ws?.send(JSON.stringify({ type:'snapshot', version, payload: getPayload() })); }
  function handleToolCall(msg) { /* MATRIX_TOOLS[msg.tool](msg.args) → sendResult */ }
  function sendResult(callId, result) { ws?.send(JSON.stringify({ type:'tool.result', callId, ok:true, result })); }

  return { connect, sendSnapshot };
})();

if (BRIDGE_URL) BridgeClient.connect();
```

```javascript
// --- MATRIX_TOOLS Registry (beginnt mit 5, wird in Phase 4 auf ~20 erweitert) ---
const MATRIX_TOOLS = {
  'matrix.state.get': async (args) => ({ snapshot: JSON.parse(getPayload()) }),
  'matrix.navigate':  async ({ alias }) => { /* existiert schon als ^alias-Logik */ },
  'matrix.create':    async ({ label, rows, cols }) => { /* wraps addMatrix-Flow */ },
  'card.create':      async ({ boardRef, name, colId, priority }) => { /* wraps addKbCard */ },
  'alias.resolve':    async ({ alias }) => aliasIndex[alias.toLowerCase()] || null,
};
```

Hooks in existierende Mutation-Pfade: nach jeder mutierenden Operation `BridgeClient.sendSnapshot()`. Pragmatisch: ein Wrapper um `save()`, der zusätzlich Snapshot schickt (debounced wie fileSaveTimer).

**Commit:** `feat(client): BridgeClient + erste MATRIX_TOOLS`

### 1.6 Tool-Dispatcher (Bridge-seitig)

`src/dispatcher.ts`:
- `invokeTool(name, args): Promise<result>`:
  1. Validiere `args` via Zod-Schema aus `tools/index.ts`
  2. Falls keine Session: `throw ToolError('no-session', 'No active matrix session')`
  3. Generiere `callId`
  4. Hinterlege Deferred in `session.pendingToolCalls`
  5. Sende `{ type:'tool.call', callId, tool:name, args }` an WS
  6. Warte auf Result (Timeout 15s)
  7. Schreibe Audit-Log-Eintrag
  8. Gib Result zurück

**Commit:** `feat(bridge): Tool-Dispatcher mit Zod-Validation`

### 1.7 MCP-Server

`src/mcp.ts`:
- Initialisiere `@modelcontextprotocol/sdk` mit Streamable-HTTP-Transport
- Registriere alle Tools aus `tools/index.ts` (jedes Tool = `{ name, description, inputSchema (Zod→JSONSchema), handler: (args) => dispatcher.invokeTool(name, args) }`)
- Mounte auf Fastify unter `/mcp`

**Commit:** `feat(bridge): MCP-Server mit ersten 5 Tools`

### 1.8 Lokaler E2E-Test

- Terminal 1: `cd bridge && pnpm dev` (Bridge auf `:3849`, Bearer-Token aus `.env`)
- Terminal 2: Preview-Server für Client (bestehender `matrix`-Server in `.claude/launch.json`, Port 3848)
- Browser: `http://localhost:3848/matrix_tool_beta.html?bridge=ws://localhost:3849/ws&token=<devtoken>` — speichert `bridgeUrl`/`bridgeToken` in localStorage, öffnet WS
- In Browser-Console: `BridgeClient` sollte `CONNECTED` loggen
- Claude Desktop konfigurieren (Config-Datei `~/Library/Application Support/Claude/claude_desktop_config.json` auf macOS bzw. `%APPDATA%\Claude\claude_desktop_config.json` auf Windows):

```json
{
  "mcpServers": {
    "infinite-matrix-local": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "http://localhost:3849/mcp",
        "--header",
        "Authorization: Bearer <devtoken>"
      ]
    }
  }
}
```

- Claude Desktop neustarten → Tools-Liste zeigt `matrix.state.get` usw.
- Prompt in Claude: „Liste mir die aktuellen Matrix-Aliasse auf." → ruft `matrix.state.get` → zeigt Struktur
- Prompt: „Leg eine neue Matrix an mit dem Namen 'Weekly' und Zeilen Mo-Fr, Spalten Prio/Tasks/Notes." → ruft `matrix.create` → Browser rendert neue Matrix animiert

**Commit + Tag:** `v0.1.0-bridge-local-mvp`

### Abnahme Phase 1

- Bridge startet ohne Fehler, `GET /healthz` liefert 200
- Browser connected via WS, Snapshot-Sync fließt
- Claude Desktop listet MATRIX_TOOLS
- Drei erfolgreiche Tool-Calls: `state.get`, `matrix.create`, `card.create`
- Vitest: 5 grüne Unit-Tests auf Protokoll + Dispatcher

---

## Phase 2 — VPS-Infrastruktur

**Ziel:** VPS einmalig provisioniert, gehärtet, nginx+TLS steht, systemd kennt `matrix-bridge`, Deploy-Target ist bereit.

**Aufwand:** 0.5 Tag (strikt nach Anleitung)

Ich strukturiere als drei Scripts plus manuelle TLS-Initialisierung. Scripts sind unter `infra/scripts/` committed, damit der Setup reproduzierbar bleibt.

### 2.1 VPS bestellen + Erstzugang

Bei Provider wählen: Ubuntu 22.04 LTS oder 24.04 LTS Server, 1 vCPU / 1 GB / 20 GB reicht. SSH-Key beim Provisioning hinterlegen (oder später via Web-Console hinzufügen).

DNS-A-Record: `matrix.levcon.at` → VPS-IP. (AAAA analog für IPv6.)

Erster Login als root:

```bash
ssh root@<vps-ip>
```

### 2.2 Deploy-User anlegen + SSH härten

`infra/scripts/setup-vps.sh` enthält die folgenden Schritte (hier inline zum Lesen):

```bash
# --- als root ---
adduser deploy --disabled-password
usermod -aG sudo deploy

# Sudo ohne Passwort für deploy-User (nur für systemctl-Restart der Bridge)
cat > /etc/sudoers.d/deploy-matrix <<'EOF'
deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart matrix-bridge, /bin/systemctl status matrix-bridge, /usr/bin/rsync
EOF
chmod 440 /etc/sudoers.d/deploy-matrix

# SSH-Key für deploy
mkdir -p /home/deploy/.ssh
# Public Key reinschreiben (aus Actions-Generator, s.u.)
nano /home/deploy/.ssh/authorized_keys
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

# SSH härten
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#*KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
sshd -t && systemctl restart ssh
```

### 2.3 Firewall + fail2ban

```bash
# UFW
apt update && apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp  comment 'SSH'
ufw allow 80/tcp  comment 'HTTP (redirect)'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

# fail2ban
apt install -y fail2ban
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
EOF
systemctl enable --now fail2ban
```

### 2.4 Node, nginx, sqlite, pnpm, certbot installieren

```bash
# Node 22 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# pnpm (global via corepack — schlanker als npm -g)
corepack enable
corepack prepare pnpm@9 --activate

# nginx
apt install -y nginx

# SQLite CLI (für Debug; Lib kommt über better-sqlite3)
apt install -y sqlite3

# certbot + nginx-Plugin
apt install -y certbot python3-certbot-nginx

# Service-User für Bridge (kein Login)
useradd -r -s /usr/sbin/nologin -d /opt/matrix-bridge matrix-bridge

# Verzeichnisstruktur
mkdir -p /opt/matrix-bridge/data
chown -R matrix-bridge:matrix-bridge /opt/matrix-bridge

mkdir -p /var/www/matrix
chown -R deploy:deploy /var/www/matrix
```

**Versions-Check nach Install:**
```bash
node -v      # v22.x
pnpm -v      # 9.x
nginx -v     # ≥1.18
sqlite3 -version
certbot --version
```

### 2.5 .env anlegen

```bash
sudo -u matrix-bridge nano /opt/matrix-bridge/.env
```

Inhalt (Beispiel):
```
PORT=3849
HOST=127.0.0.1
NODE_ENV=production
LOG_LEVEL=info
DB_PATH=/opt/matrix-bridge/data/matrix.db
BRIDGE_TOKEN=<32-zufällige-Zeichen>
```

Token generieren: `openssl rand -hex 32`. Der **selbe Token** wird später im Client einmalig eingetragen.

`chmod 600 /opt/matrix-bridge/.env`

### 2.6 systemd-Unit installieren

Datei aus `infra/systemd/matrix-bridge.service` nach `/etc/systemd/system/matrix-bridge.service` kopieren (kommt beim ersten Deploy, oder manuell einmalig).

```bash
cp /path/to/matrix-bridge.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable matrix-bridge
# Start erst nach erstem Deploy (Code liegt noch nicht)
```

### 2.7 nginx + TLS

Site-Config aus `infra/nginx/matrix.conf` nach `/etc/nginx/sites-available/matrix.conf` kopieren. Placeholder `matrix.levcon.at` durch echte Domain ersetzen.

```bash
cp /path/to/matrix.conf /etc/nginx/sites-available/matrix.conf
ln -sf /etc/nginx/sites-available/matrix.conf /etc/nginx/sites-enabled/matrix.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

TLS-Zertifikat holen (certbot schreibt die ssl_*-Zeilen automatisch in die Site-Config):

```bash
certbot --nginx -d matrix.levcon.at \
  --agree-tos \
  -m admin@levcon.at \
  --no-eff-email \
  --redirect \
  --hsts
```

Auto-Renew wird über systemd-Timer `certbot.timer` aktiviert (ist nach Install bereits enabled). Test:

```bash
certbot renew --dry-run
```

### 2.8 Health-Probe

Noch steht keine Bridge, aber der Pfad muss 502 liefern (nicht 404 o.ä.):

```bash
curl -i https://matrix.levcon.at/healthz
# erwartet: 502 Bad Gateway (Bridge läuft nicht)
```

Nach erstem Deploy dann 200 `{ok:true,uptime:…}`.

### Abnahme Phase 2

- SSH als `deploy` funktioniert, `root` ist blockiert
- `ufw status` zeigt 22/80/443 open, Rest deny
- `fail2ban-client status` zeigt `sshd` jail aktiv
- Node 22, pnpm, nginx, sqlite, certbot installiert
- `/opt/matrix-bridge/`, `/var/www/matrix/` existieren mit korrekten Owners
- `.env` liegt, Mode 600
- nginx + TLS stehen, `https://matrix.levcon.at/healthz` liefert 502 (Bridge down is erwartet)
- systemd kennt `matrix-bridge` (Start noch pending)

---

## Phase 3 — CI/CD mit GitHub Actions

**Ziel:** `git push main` → automatisch getestet, gebaut, deployt, Smoke-gecheckt. Kein manueller SSH-Step mehr.

**Branch:** `ci/github-actions`
**Aufwand:** 0.5–1 Tag

### 3.1 SSH-Deploy-Key

Auf dem VPS:
```bash
sudo -u deploy ssh-keygen -t ed25519 -f /home/deploy/.ssh/gh-actions -C "gh-actions@matrix" -N ''
cat /home/deploy/.ssh/gh-actions.pub >> /home/deploy/.ssh/authorized_keys
cat /home/deploy/.ssh/gh-actions   # → private Key, dieser kommt in GitHub Secret
```

### 3.2 GitHub Secrets (Repo → Settings → Secrets → Actions, Environment `production`)

- `DEPLOY_HOST` = `matrix.levcon.at`
- `DEPLOY_USER` = `deploy`
- `DEPLOY_SSH_KEY` = Inhalt von `gh-actions` (private)
- `DEPLOY_KNOWN_HOSTS` = Output von `ssh-keyscan -H matrix.levcon.at` (einmalig lokal generieren, vollständig einfügen)

Optional:
- `BRIDGE_TOKEN` nicht in Secrets — liegt nur auf dem VPS. Workflow braucht ihn nicht.

### 3.3 Workflows

**`.github/workflows/pr.yml`** — läuft auf jeder PR:
- Lint (`pnpm lint`)
- Typecheck (`pnpm typecheck`)
- Test (`pnpm test`)
- Build (`pnpm build`)

**`.github/workflows/deploy.yml`** — läuft auf `push: main`:
- Reuses PR-Checks als Needs
- Baut Bridge
- Rsynct Bridge-Build nach `/opt/matrix-bridge/` (via deploy-User)
- Startet `pnpm install --prod` dort (Dev-Deps bleiben im Repo gebaut)
- Rsynct Client nach `/var/www/matrix/`
- Falls `.service` oder `nginx/*.conf` verändert wurden: rsync dorthin + reload (systemd-unit-Path benötigt sudo → separater Schritt)
- `systemctl restart matrix-bridge`
- Smoke-Checks: `GET /healthz` (https), `GET /` liefert 200 und enthält den erwarteten Titel

**Konflikt-Handling:**
- `concurrency: group: deploy-prod, cancel-in-progress: false` — kein Überlappen
- Workflow scheitert deutlich, wenn Smoke-Check nicht durchgeht; manuelle Eingriffe via SSH möglich

Komplette yml-Dateien siehe [Artefakte](#artefakte-komplette-dateien-zum-copy-paste).

### 3.4 Erster Deploy

- Phase-1-Branch mergen nach `main` via PR
- Actions-Run beobachten
- Nach Erfolg: `https://matrix.levcon.at/healthz` → 200
- Browser auf `https://matrix.levcon.at/` → Matrix lädt, fragt einmalig nach Bridge-Token (kleines Modal im Client, `?token=` in URL oder Prompt), verbindet

### Abnahme Phase 3

- PR-Check grün
- Main-Deploy-Workflow grün, Laufzeit < 4 min
- Zwei consecutive Pushes deployen sauber (concurrency hält)
- Kaputten Code zum Rollback-Test: absichtlich brechen, Deploy scheitert im Test-Step, Prod bleibt stabil

---

## Phase 4 — MATRIX_TOOLS v1 (Tool-Liste)

**Ziel:** Vollständiger Tool-Katalog, mit dem AI die wesentlichen Matrix-Operationen durchführen kann. Reicht für AI-Onboarding und Shift+C-Helper.

**Branch:** pro Tool-Gruppe ein Branch (`feat/tools-matrix`, `feat/tools-card`, …)
**Aufwand:** 3–5 Tage, parallel machbar

Jedes Tool bekommt:
1. Zod-Schema (Args) in `bridge/src/tools/<gruppe>.ts`
2. JSON-Schema-Ableitung für MCP
3. Client-Implementierung in `client/matrix_tool_beta.html` (`MATRIX_TOOLS[name]`)
4. Vitest auf Bridge-Seite (Schema-Validation + Dispatch-Mock)

### Tool-Katalog

**Gruppe `matrix` — Struktur-Navigation:**
- `matrix.state.get(args: { subtreeRef? })` → Snapshot (ganz oder Teilbaum)
- `matrix.navigate(args: { target: { alias? | path? } })`
- `matrix.edit_mode.set(args: { on: boolean })`

**Gruppe `matrix-crud`:**
- `matrix.create(args: { parentRef?, label, rows?: string[], cols?: string[], alias? })`
- `matrix.rename(args: { ref, label })`
- `matrix.delete(args: { ref })` — nutzt bestehenden `pushUndo`-Flow
- `row.add(args: { matrixRef, label, alias? })`
- `row.delete(args: { matrixRef, rowId })`
- `col.add(args: { matrixRef, label, alias? })`
- `col.delete(args: { matrixRef, colId })`

**Gruppe `cell`:**
- `cell.get(args: { matrixRef, rowId, colId })`
- `cell.feature.add(args: { cellRef, feature: 'matrix'|'board'|'info'|'checklists' })`
- `cell.alias.set(args: { cellRef, alias })`

**Gruppe `board-card`:**
- `card.create(args: { boardRef, name, colId?, priority?, deadline?, tags?: string[], who?: string[], alias? })`
- `card.update(args: { cardRef, patch })` (nur bekannte Felder aus Zod-Schema)
- `card.move(args: { cardRef, targetColId?, targetBoardRef? })`
- `card.delete(args: { cardRef })`
- `card.done.toggle(args: { cardRef })`
- `card.recurrence.set(args: { cardRef, recur: RecurSpec })`

**Gruppe `info-link`:**
- `info.field.add(args: { boardRef, label, value })`
- `info.field.update(args: { fieldRef, value })`
- `info.field.delete(args: { fieldRef })`
- `link.add(args: { boardRef, label, url, alias? })`
- `link.delete(args: { linkRef })`

**Gruppe `checklist`:**
- `checklist.add(args: { boardRef, label })`
- `checklist.item.add(args: { checklistRef, text })`
- `checklist.item.toggle(args: { itemRef })`

**Gruppe `alias`:**
- `alias.resolve(args: { alias })` → Ref
- `alias.set(args: { ref, alias })`

**Gruppe `query`:**
- `query.cards(args: { filter: { due?: 'today'|'week'|'month'|'overdue', tag?, who?, priority?, aliasMatch?, scope?: 'current'|'tree' }, limit? })`
- `query.aliases(args: { prefix? })`

**Gruppe `template`:**
- `template.list()` — hardcoded initial (Projektplan, GTD, Life-Layout, Decision-Matrix, Reading-List)
- `template.instantiate(args: { templateId, parentRef, label? })`

**Gruppe `settings`:**
- `settings.get()`
- `settings.set(args: { key, value })`

**Gruppe `meta`:**
- `undo.last()`
- `status()` → Session-Info

Insgesamt ~35 Tools. Für ersten AI-E2E-Proof (Phase 1) reichen 5. Phase 4 baut auf 35 aus, in Reihenfolge: matrix-crud → card → alias → query → template → info-link → checklist → settings.

**Commit-Pattern:** `feat(bridge/tools): <gruppe>-Tools implementiert`

### Abnahme Phase 4

- Alle 35 Tools definiert, schemavalidiert, client-seitig implementiert
- MCP-Inspector (`npx @modelcontextprotocol/inspector`) zeigt vollständigen Tool-Katalog
- Vitest-Coverage ≥ 80 % für `tools/*` und `dispatcher.ts`
- Manueller Smoke: Claude Desktop kann jedes Tool mindestens einmal erfolgreich aufrufen

---

## Phase 5 — First AI-E2E-Proof (Abnahme)

**Ziel:** Das Versprechen des Plans demonstrieren — AI steuert die Matrix.

**Abnahme-Szenario:**

1. Bridge läuft auf VPS, `https://matrix.levcon.at/healthz` = 200
2. Browser-Session offen, mit Bridge verbunden (grünes Indicator-Pill im Topbar)
3. Claude Desktop konfiguriert mit `mcp-remote` auf `https://matrix.levcon.at/mcp`
4. Prompt: „Erstelle eine Wochenplanungs-Matrix. Zeilen: Mo bis Fr. Spalten: Prioritäten, Aufgaben, Notizen."
5. → `matrix.create` wird aufgerufen, Browser zeigt neue Matrix animiert
6. Prompt: „Füge in Montag → Aufgaben eine Karte 'Team-Standup', hohe Priorität, heute fällig, Alias 'standup'."
7. → `matrix.navigate` + `cell.feature.add` + `card.create` in Folge, Browser zeigt Karte mit Prio-Badge
8. Prompt: „Welche Karten sind diese Woche fällig?"
9. → `query.cards` mit filter.due='week', Claude antwortet strukturiert
10. Prompt: „Setze 'standup' auf erledigt."
11. → `alias.resolve` → `card.done.toggle`, Browser zeigt Häkchen-Animation
12. Ctrl+Z im Browser → Undo funktioniert (MCP-Calls sind reguläre Mutationen)

Wenn alle Schritte grün: **Tag `v0.2.0-mcp-v1` setzen, Backlog-Item 3 (Integration-Basis) als abgeschlossen markieren**. Ab hier kann das Team (also du + AI) parallel an E-Mail-Ingest, Slack-Notifier, AI-Onboarding arbeiten.

---

## Artefakte (komplette Dateien zum Copy-Paste)

Alles in diesem Abschnitt ist produktionsfertig. Domain- und Pfad-Placeholder sind markiert mit `<…>` oder `example.com`.

### `infra/systemd/matrix-bridge.service`

```ini
[Unit]
Description=Infinite Matrix Bridge (WebSocket + MCP)
After=network.target
Documentation=https://github.com/LEVCON-AT/Infinite-Matrix

[Service]
Type=simple
User=matrix-bridge
Group=matrix-bridge
WorkingDirectory=/opt/matrix-bridge
EnvironmentFile=/opt/matrix-bridge/.env
ExecStart=/usr/bin/node /opt/matrix-bridge/dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=matrix-bridge

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ReadWritePaths=/opt/matrix-bridge/data
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
ProtectClock=true
ProtectHostname=true
ProtectProc=invisible
ProcSubset=pid
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=true
RestrictRealtime=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryDenyWriteExecute=true
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged @resources
CapabilityBoundingSet=
AmbientCapabilities=
UMask=0027

# Resources
LimitNOFILE=65536
MemoryMax=512M

[Install]
WantedBy=multi-user.target
```

### `infra/nginx/matrix.conf`

```nginx
# /etc/nginx/sites-available/matrix.conf
# Domain-Placeholder: matrix.levcon.at

# HTTP → HTTPS redirect (certbot --redirect überschreibt bzw. ergänzt dies)
server {
    listen 80;
    listen [::]:80;
    server_name matrix.levcon.at;

    # certbot ACME challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS: Client + Bridge-Proxy
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name matrix.levcon.at;

    # certbot fügt ssl_certificate + ssl_certificate_key automatisch hinzu
    # ssl_certificate     /etc/letsencrypt/live/matrix.levcon.at/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/matrix.levcon.at/privkey.pem;
    # include             /etc/letsencrypt/options-ssl-nginx.conf;
    # ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    # Security Headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' wss://matrix.levcon.at https://matrix.levcon.at; worker-src 'self' blob:; object-src 'none'; base-uri 'self';" always;

    # Client assets (single HTML + optional assets)
    root /var/www/matrix;
    index matrix_tool_beta.html;

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/html text/css application/javascript application/json image/svg+xml;

    # Client — kurzer Cache, wir deployen häufig
    location = / {
        try_files /matrix_tool_beta.html =404;
        add_header Cache-Control "public, max-age=300, must-revalidate" always;
    }

    location = /matrix_tool_beta.html {
        add_header Cache-Control "public, max-age=300, must-revalidate" always;
    }

    # WebSocket für Matrix ↔ Bridge
    location /ws {
        proxy_pass http://127.0.0.1:3849/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # MCP (Streamable-HTTP / SSE)
    location /mcp {
        proxy_pass http://127.0.0.1:3849/mcp;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # MCP nutzt long-lived SSE → kein Buffering, langer Timeout
        proxy_buffering off;
        proxy_read_timeout 3600s;
        chunked_transfer_encoding on;
    }

    # Health (debug / uptime monitoring)
    location = /healthz {
        proxy_pass http://127.0.0.1:3849/healthz;
        access_log off;
    }

    # Alles andere blocken (keine Listings, kein Zugriff auf versteckte Dateien)
    location ~ /\. { deny all; access_log off; log_not_found off; }
}
```

### `.github/workflows/pr.yml`

```yaml
name: PR Checks

on:
  pull_request:
    branches: [main]
    paths:
      - 'bridge/**'
      - 'client/**'
      - '.github/workflows/**'

permissions:
  contents: read

jobs:
  bridge:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: bridge
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: bridge/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test -- --run
      - run: pnpm build
```

### `.github/workflows/deploy.yml`

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: deploy-prod
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      bridge-sha: ${{ steps.hash.outputs.sha }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: bridge/pnpm-lock.yaml

      - name: Install & Build
        working-directory: bridge
        run: |
          pnpm install --frozen-lockfile
          pnpm lint
          pnpm typecheck
          pnpm test -- --run
          pnpm build

      - name: Hash build
        id: hash
        working-directory: bridge
        run: echo "sha=$(sha256sum dist/index.js | cut -d' ' -f1 | head -c 12)" >> "$GITHUB_OUTPUT"

      - name: Package artifact
        run: |
          mkdir -p artifact/bridge
          cp -r bridge/dist artifact/bridge/dist
          cp bridge/package.json bridge/pnpm-lock.yaml artifact/bridge/
          mkdir -p artifact/client
          cp client/matrix_tool_beta.html artifact/client/

      - uses: actions/upload-artifact@v4
        with:
          name: deploy-artifact
          path: artifact/
          retention-days: 7

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/download-artifact@v4
        with: { name: deploy-artifact, path: artifact }

      - name: Setup SSH
        env:
          SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}
        run: |
          mkdir -p ~/.ssh
          chmod 700 ~/.ssh
          echo "$SSH_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          echo "$KNOWN_HOSTS" > ~/.ssh/known_hosts

      - name: Deploy bridge
        env:
          HOST: ${{ secrets.DEPLOY_HOST }}
          USER: ${{ secrets.DEPLOY_USER }}
        run: |
          set -euo pipefail

          # Stage bridge artifact under /tmp (deploy user), then atomic swap
          rsync -az --delete \
            -e "ssh -i ~/.ssh/id_ed25519" \
            artifact/bridge/ \
            "$USER@$HOST:/tmp/matrix-bridge-stage/"

          ssh -i ~/.ssh/id_ed25519 "$USER@$HOST" bash -s <<'REMOTE'
            set -euo pipefail
            cd /tmp/matrix-bridge-stage
            # Install prod deps here (as deploy), then sync to /opt
            pnpm install --prod --frozen-lockfile --ignore-scripts
            # Rebuild better-sqlite3 native (if needed — prebuild ships usually)
            # pnpm rebuild better-sqlite3

            # Sync to service dir (owned by matrix-bridge)
            sudo rsync -az --delete \
              --chown=matrix-bridge:matrix-bridge \
              /tmp/matrix-bridge-stage/ \
              /opt/matrix-bridge/

            sudo systemctl restart matrix-bridge
            sleep 2
            curl -fsS http://127.0.0.1:3849/healthz || (sudo journalctl -u matrix-bridge -n 50 && exit 1)
          REMOTE

      - name: Deploy client
        env:
          HOST: ${{ secrets.DEPLOY_HOST }}
          USER: ${{ secrets.DEPLOY_USER }}
        run: |
          rsync -az --delete \
            -e "ssh -i ~/.ssh/id_ed25519" \
            artifact/client/ \
            "$USER@$HOST:/var/www/matrix/"

      - name: Smoke test
        env:
          HOST: ${{ secrets.DEPLOY_HOST }}
        run: |
          set -euo pipefail
          # Healthz through nginx
          curl -fsS "https://$HOST/healthz" | grep -q '"ok":true'
          # Client reachable
          curl -fsS -o /dev/null -w "%{http_code}\n" "https://$HOST/" | grep -q 200
```

**Deployed sudo-Befehle** (erlaubt in `/etc/sudoers.d/deploy-matrix`):
- `/bin/systemctl restart matrix-bridge`
- `/bin/systemctl status matrix-bridge`
- `/usr/bin/rsync`

Das reicht für den Workflow. Wenn später nginx-Configs mit-deployt werden sollen, zusätzliche sudo-Einträge für `nginx -s reload` und gezielter rsync-Pfad.

### `bridge/package.json` (Skizze)

```json
{
  "name": "matrix-bridge",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest",
    "lint": "biome check src test",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=22"
  },
  "dependencies": {
    "@fastify/cors": "^10",
    "@fastify/websocket": "^11",
    "@modelcontextprotocol/sdk": "^1",
    "better-sqlite3": "^11",
    "fastify": "^5",
    "pino": "^9",
    "pino-pretty": "^11",
    "zod": "^3"
  },
  "devDependencies": {
    "@biomejs/biome": "^1",
    "@types/better-sqlite3": "^7",
    "@types/node": "^22",
    "tsx": "^4",
    "typescript": "^5",
    "vitest": "^2"
  }
}
```

### `bridge/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["test", "dist", "node_modules"]
}
```

### `.gitignore` (Root)

```
# Node
node_modules/
dist/
build/
coverage/
*.tsbuildinfo

# Env / Secrets
.env
.env.local
.env.*.local

# SQLite
*.db
*.db-journal
*.db-shm
*.db-wal

# OS / IDE
.DS_Store
Thumbs.db
*.swp
.vscode/
.idea/

# Logs
*.log
logs/

# Runtime
.pids/
```

### `infra/scripts/setup-vps.sh` (einmalig als root auf frischer VPS)

Das Script ruft die drei Phasen 2.2 + 2.3 + 2.4 auf. Template liegt im Repo, wird auf dem VPS ausgeführt:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run as root."
  exit 1
fi

echo "=== Creating deploy user ==="
if ! id deploy &>/dev/null; then
  adduser deploy --disabled-password --gecos ""
  usermod -aG sudo deploy
fi

echo "=== Sudoers entry for deploy ==="
cat > /etc/sudoers.d/deploy-matrix <<'EOF'
deploy ALL=(ALL) NOPASSWD: /bin/systemctl restart matrix-bridge, /bin/systemctl status matrix-bridge, /usr/bin/rsync
EOF
chmod 440 /etc/sudoers.d/deploy-matrix

echo "=== SSH hardening ==="
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#*KbdInteractiveAuthentication.*/KbdInteractiveAuthentication no/' /etc/ssh/sshd_config
sshd -t
systemctl restart ssh

echo "=== UFW ==="
apt update && apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp  comment 'SSH'
ufw allow 80/tcp  comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

echo "=== fail2ban ==="
apt install -y fail2ban
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
EOF
systemctl enable --now fail2ban

echo "=== Node 22 + pnpm ==="
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
corepack enable
corepack prepare pnpm@9 --activate

echo "=== nginx + sqlite3 + certbot ==="
apt install -y nginx sqlite3 certbot python3-certbot-nginx

echo "=== matrix-bridge service user + dirs ==="
if ! id matrix-bridge &>/dev/null; then
  useradd -r -s /usr/sbin/nologin -d /opt/matrix-bridge matrix-bridge
fi
mkdir -p /opt/matrix-bridge/data
chown -R matrix-bridge:matrix-bridge /opt/matrix-bridge

mkdir -p /var/www/matrix
chown -R deploy:deploy /var/www/matrix

echo ""
echo "=== Setup done ==="
echo "Next manual steps:"
echo "  1. Paste SSH key into /home/deploy/.ssh/authorized_keys"
echo "  2. Generate BRIDGE_TOKEN: openssl rand -hex 32"
echo "  3. Create /opt/matrix-bridge/.env (as matrix-bridge user)"
echo "  4. Install /etc/systemd/system/matrix-bridge.service"
echo "  5. Install /etc/nginx/sites-available/matrix.conf + enable"
echo "  6. Run: certbot --nginx -d matrix.levcon.at ..."
echo "  7. First deploy via GitHub Actions"
```

---

## Runbook

### Lokal starten (Entwickler-Modus)

```bash
# Terminal 1: Bridge
cd bridge
cp .env.example .env    # Token etc. eintragen
pnpm install
pnpm dev                 # :3849

# Terminal 2: Client (Preview-Server)
# Via .claude/launch.json: preview_start matrix
# oder: cd client && python -m http.server 3848
```

Browser: `http://localhost:3848/matrix_tool_beta.html?bridge=ws://localhost:3849/ws&token=<devtoken>`

### Deploy

Kein manueller Schritt nötig: PR → main → Actions-Workflow. Fortschritt in GitHub-UI.

Manuell (Notfall):
```bash
# Lokal bauen
cd bridge && pnpm build
rsync -avz dist/ deploy@matrix.levcon.at:/tmp/matrix-bridge-stage/dist/
rsync -avz package.json pnpm-lock.yaml deploy@matrix.levcon.at:/tmp/matrix-bridge-stage/
ssh deploy@matrix.levcon.at "
  cd /tmp/matrix-bridge-stage && pnpm install --prod --frozen-lockfile
  sudo rsync -az --delete --chown=matrix-bridge:matrix-bridge /tmp/matrix-bridge-stage/ /opt/matrix-bridge/
  sudo systemctl restart matrix-bridge
"
```

### Logs lesen

```bash
ssh deploy@matrix.levcon.at 'journalctl -u matrix-bridge -n 100 -f'
```

JSON-Logs per `pino-pretty` beim Lesen formatieren:
```bash
ssh deploy@matrix.levcon.at 'journalctl -u matrix-bridge -n 200 --output=cat' | npx pino-pretty
```

### Backup

SQLite ist eine einzige Datei:
```bash
# On VPS
sudo -u matrix-bridge sqlite3 /opt/matrix-bridge/data/matrix.db ".backup /tmp/matrix-$(date +%F).db"
# Rsync zu dir nach Hause
```

Automatisieren später via systemd-timer (täglich, letzte 7 behalten).

### Rollback

Deploy-Artefakte bleiben 7 Tage in GitHub Actions. Für schnellen Rollback:
1. Letzte bekannte gute Workflow-Run auswählen
2. „Re-run jobs" → „Re-run all jobs"
3. Deployt die alte Version erneut

Alternativ: manuell via rsync eine alte Version zurückspielen.

### Zertifikat-Renew prüfen

```bash
sudo certbot renew --dry-run
sudo systemctl list-timers | grep certbot
```

Certbot erneuert auto über `certbot.timer` (täglich 2x).

### Bearer-Token drehen

```bash
# On VPS
NEW=$(openssl rand -hex 32)
sudo -u matrix-bridge sed -i "s|^BRIDGE_TOKEN=.*|BRIDGE_TOKEN=$NEW|" /opt/matrix-bridge/.env
sudo systemctl restart matrix-bridge
# Token kommunizieren (neu ins Client-localStorage eingeben, Claude Desktop config updaten)
```

---

## Risiken

| Risiko | Wahrscheinlichkeit | Impact | Mitigation |
|---|---|---|---|
| MCP-SDK-API-Breaks | mittel | mittel | Pin auf konkrete Version, monatl. Check auf neue Version |
| WebSocket-Reconnect-Loops bei Flaky-Netz | hoch | klein | Exponential-Backoff (1s/2s/4s/8s/max 30s) + State-Resync-Protocol |
| SQLite-Concurrency bei Multi-Tab | hoch bei Multi-Use | mittel | v1: nur eine Session, zweiter Client read-only → notice |
| AI-Halluzinationen bei Tool-Calls | hoch | klein | Zod-Validation auf Bridge, strukturierte Fehler zurück zu MCP, LLM iteriert |
| VPS-Ausfall | klein | groß | Backup + dokumentierter Rebuild-Path (setup-vps.sh + certbot + Deploy) |
| Token-Leak in Client-localStorage | mittel bei Shared-Device | mittel | Kurzer Lifespan empfohlen + Token-Rotation im Runbook |
| Let's-Encrypt-Rate-Limit bei Test | niedrig | mittel | certbot `--staging` für Tests nutzen, prod erst am Schluss |
| better-sqlite3 Native-Build auf VPS | mittel | klein | `npm rebuild` im Deploy einmalig, sonst prebuild-ships |
| Nginx 502 bei Bridge-Restart | klein | klein | systemd `Restart=on-failure`, Smoke-Check im Deploy |

---

## Nach Abschluss: nächste Schritte (nicht mehr Teil dieses Plans)

Der Plan endet mit Phase 5 + Tag `v0.2.0-mcp-v1`. Was dann auf dieselbe Infrastruktur aufbauen kann — jeweils neue Feature-Branches:

- **AI-Onboarding** (3–6 Wochen): Dialog-Flow, Template-Matching, Live-Preview-UI, interaktive Iteration
- **Shift+C-Helper im Client**: Chat-Overlay aus Suchfeld heraus, spricht dasselbe MCP
- **E-Mail-Adresse pro Alias**: Postmark/Mailgun Inbound-Parse → Bridge-Endpoint → MCP-Tool-Calls
- **Slack/Teams-Slash-Commands**: analog
- **n8n-Webhook-Adapter**: trivial wenn MCP steht
- **Jira/Linear/GitHub-Issues-Adapter**: OAuth-Flow auf Bridge + periodic sync + Live-Hooks
- **Staging-Umgebung nachrüsten**: zweiter systemd-Service + Nginx-vhost auf `staging.matrix.levcon.at`

Jedes dieser Features ist ein eigener Plan in `docs/plan-<feature>.md`.

---

**Ende des Plans.**
