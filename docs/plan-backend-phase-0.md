# Backend Phase 0 — Supabase-SaaS-Fundament

> **Status (2026-04-30):** ✅ Phase 0 + Audit-Welle KOMPLETT live, an Phase 1 + 3 übergeben. 8/9 Erfolgs-Kriterien grün, #8 Backup deferred (siehe Stream G B1-G-006). Live auf `staging.matrix.levcon.at/app/`. Aktueller Welle-Stand: Memory `project_object_layer_phase3.md` + `project_phase1_state.md`.

## Kontext

Nach abgeschlossenem Phase 4 (Bridge + MCP) und V2 (Checklisten) wechselt das Projekt den Charakter: vom lokalen Single-File-Tool mit AI-Bridge zu einer **Multi-User-SaaS** mit echtem Backend. Zentrale Entscheidung siehe `CLAUDE.md` / Session-Protokoll vom 2026-04-21:

- **Online-First** wird zur Primär-Strategie.
- **Supabase self-hosted** auf dem eigenen VPS (matrix.levcon.at) als Backend.
- **SolidJS + Vite** als neuer SaaS-Client (der aktuelle `matrix_tool_beta.html` bleibt als Standalone-Offline-Build einfrieren).
- **Multi-User-fähiges Schema von Tag 1**, Single-User-Logic als erster Implementierungs-Schritt.
- **Offline wird Sekundärpfad** via PWA-Cache + Standalone-Build; keine CRDTs, keine echte Offline-Edit-Merge-Logik.

## Zielbild

```
Dein VPS (systemd + docker-compose, nginx-TLS-terminiert)
│
├── nginx
│   ├── matrix.levcon.at/         → SaaS-Client (Static, Vite-Build)
│   ├── matrix.levcon.at/api/*    → Kong (Supabase API-Gateway)
│   ├── matrix.levcon.at/auth/*   → GoTrue (Auth)
│   ├── matrix.levcon.at/realtime → Realtime (WS)
│   ├── matrix.levcon.at/bridge/* → Matrix-Bridge (MCP, WS für AI)
│   └── matrix.levcon.at/standalone/ → Single-File-Offline-Build (IMX-Import)
│
├── docker-compose (Supabase-Stack)
│   ├── postgres-db (Primär-Datenspeicher)
│   ├── gotrue (Auth: OAuth + Magic-Link)
│   ├── postgrest (REST-API auf DB via RLS)
│   ├── realtime (Logical-Replication → WebSocket-Broadcast)
│   ├── storage (Asset-Uploads, ab Phase 1+)
│   ├── kong (API-Gateway, Rate-Limiting, CORS)
│   └── studio (nur für Admin, hinter SSH-Tunnel)
│
└── Matrix-Bridge (Node, systemd-Service, wie bisher)
    ├── rollte bisher: WebSocket-Relay zwischen Browser + MCP
    ├── neue Rolle: zusätzlich AI-Action-Layer gegen Supabase
    │   (Service-Role-Key im Bridge-Env, niemals im Browser)
    └── SQLite-Persistenz entfällt — Audit-Log wandert nach Postgres
```

## Non-Goals (explizit aus Phase 0 ausgeklammert)

- **CRDT / Operational-Transform**: kein echtes Merge für Offline-Edits. Offline = Read-Only-Cache + Queue-Replay-bei-Reconnect. Konflikte = Last-Writer-Wins mit Toast.
- **Billing / Subscriptions**: Phase 3+. Zuerst funktioniert's für dich selbst und eingeladene Einzel-User.
- **Mobile-Native-Apps**: PWA reicht für Phase 0. React-Native/Capacitor-Port ist Phase 5+.
- **Cell-Level-ACLs**: Schema muss es vorbereiten (ownable entities), aber UI/Policies erst in Phase 2+.
- **Team-Workspaces / Invites**: Schema ab Tag 1, UI ab Phase 1.
- **Zero-Downtime-Deploys**: ein VPS, ein Service-Restart ist OK. Blau/Grün kommt später.

## Status (Stand 2026-04-21)

| Phase | Scope | Status |
|---|---|---|
| 0a | Supabase-Stack, nginx, Hardening | ✅ done |
| 0b | Magic-Link-Auth + Workspace-Trigger | ✅ done |
| 0c.1 | Workspaces + Memberships + RLS-Helper | ✅ done |
| 0c.2 | Matrix-Schema (10 Tabellen, Composite-FKs, Uniform-RLS) | ✅ done |
| 0c.3 | Import-Endpoint | ➡ verschmolzen in 0d.6 (Client-seitig) |
| 0c.4 | RLS-Policy-Tests | ⏸ nach 0d mit Echtdaten |
| 0d.1 | SolidJS-Skeleton (Vite 5 + SolidJS 1.9 + TS + Router + Supabase-JS) | ✅ done |
| 0d.2 | Magic-Link-Login + Route-Guard | ✅ done |
| 0d.3 | Workspace-Switcher + Node-Tree | ✅ done |
| 0d.4 | MatrixView (read-only Rendering) | ➡ **nächster Sprint** |
| 0d.5 | BoardView (Kanban + Checklisten-Read) | pending |
| 0d.6 | Import-Dialog (localStorage-JSON → DB, UUID-Mapping) | pending |
| 0e | Write-API + Realtime + Bridge-Rolle neu | pending |
| 0f | Feature-Parität (Keyboard, Aliases, Undo) + `/frontend-design`-Style-Pass | pending |
| 0g | Standalone-Freeze + PWA-Cache | pending |

## Voraussetzungen (vor Phase 0a)

| # | Prüfpunkt | Aktion falls nicht gegeben |
|---|---|---|
| 1 | VPS hat ≥ 4 GB RAM (8 GB komfortabel) | Upgrade beim Provider |
| 2 | Disk ≥ 40 GB für Postgres + Backups | Upgrade oder eigenes Volume |
| 3 | SMTP-Provider für Magic-Link-Mails | Postmark / Mailgun / SES (Kosten: ~0-5 €/Monat bei <1k Mails) |
| 4 | OAuth-Apps bei Google + LinkedIn registriert | Google Cloud Console / LinkedIn Developer |
| 5 | Domain-Strategie: Subdomain oder Pfad? | Aktuell: Pfad (`/api`, `/auth`, …) — einfacher, ein TLS-Cert reicht |
| 6 | Backup-Ziel: externer S3/Backblaze-Bucket | Rechnung-/Account-Einrichtung |

**Aktion 0:** User bestätigt RAM-Kapazität und SMTP-Plan. Ohne diese zwei Infos kann Phase 0a nicht starten.

---

## Phase 0a — Infrastruktur + Supabase-Stack

**Ziel:** Supabase läuft auf dem VPS, ist per HTTPS erreichbar, ist nicht öffentlich ohne Auth, hat Backup-Automatik.

### 0a.1 — VPS-Vorbereitung

- Docker + docker-compose-plugin installieren.
- Swap konfigurieren (wenn RAM < 8 GB, 2-4 GB Swap einrichten).
- UFW-Regeln: Port 22 (SSH), 80, 443 offen. Alles andere dicht.
- Verzeichnis `/opt/supabase/` für den Stack, owned by service-user, nicht root.

### 0a.2 — Supabase-Stack deployen

- `supabase/docker-compose.yml` aus dem offiziellen Supabase-Repo klonen, Fork in `infra/supabase/` des eigenen Repos committen (anpassbar halten).
- `.env` generieren:
  - `POSTGRES_PASSWORD` (50+ char random)
  - `JWT_SECRET` (für Auth-Tokens)
  - `ANON_KEY`, `SERVICE_ROLE_KEY` (aus JWT-Secret abgeleitet via Supabase-CLI)
  - `SITE_URL=https://matrix.levcon.at`
  - `GOTRUE_SMTP_*` (SMTP-Provider-Credentials)
- Image-Tags pinnen (keine `:latest`).

### 0a.3 — nginx erweitern

- `infra/nginx/matrix.conf` ergänzen um:
  - `/auth/*` → Kong-Upstream mit korrekter Path-Rewrite
  - `/api/*` → Kong-Upstream
  - `/realtime/*` → WS-Upgrade zu Realtime-Service
- TLS-Cert bleibt das bestehende (Let's Encrypt, auto-renewed).
- Rate-Limiting-Zonen für Auth (max 5 req/s pro IP) und API (max 50 req/s pro Token).

### 0a.4 — Backup-Automatik

- systemd-Timer `matrix-backup.service` + `.timer`: nächtliches `pg_dump` + `rclone copy` nach S3-Bucket.
- Retention: 14 Tage täglich, 6 Monate wöchentlich.
- Restore-Procedure dokumentieren in `docs/runbook-backup.md`.

### 0a.5 — Monitoring

- Supabase-Studio auf localhost binden, Admin-Zugriff nur via SSH-Tunnel (nie öffentlich).
- `docker compose logs` → journald-Integration via Docker-Log-Driver.
- Minimal-Uptime-Check (Healthcheck-Endpoint → Uptimerobot oder systemd-Timer + curl + Email).

### 0a.6 — Hardening

- `ProtectSystem`/`SystemCallFilter` für docker-compose analog zu `matrix-bridge.service`.
- Service-Role-Key **nur** im Bridge-Env (`/opt/matrix-bridge/.env`), niemals irgendwohin exportiert.
- Erste Penetrationsbereitschaft: ASVS-L2-Checkliste gegen den Stack laufen.

**Commit-Scope:** `infra/supabase`, `infra/nginx`, `docs/`. Kein Code im Client oder Bridge in dieser Phase.

**Verifikation:** 
- `curl https://matrix.levcon.at/auth/v1/health` → 200.
- Studio erreichbar via SSH-Tunnel.
- `pg_dump`-Job läuft nachts erfolgreich, Restore-Test auf Staging-VPS einmalig.

---

## Phase 0b — Auth-Schicht

**Ziel:** User kann sich einloggen via Google, LinkedIn oder Magic-Link. Ein `auth.users`-Row entsteht. Ein Workspace für diesen User wird automatisch angelegt.

### 0b.1 — OAuth-Provider konfigurieren

- Google Cloud Console: OAuth-Client anlegen, Redirect-URI `https://matrix.levcon.at/auth/v1/callback`.
- LinkedIn Developer: analog.
- Credentials in GoTrue-Env.
- Magic-Link-SMTP bereits in 0a konfiguriert.

### 0b.2 — Workspace-Auto-Create-Trigger

- Postgres-Trigger auf `auth.users` INSERT:
  ```sql
  CREATE FUNCTION public.create_workspace_for_user() RETURNS trigger ...
  ```
- Legt `public.workspaces` (default_name aus User-E-Mail-Prefix) und `public.memberships` (role='owner') an.
- **Migration-File** in `infra/supabase/migrations/0001_auth_bootstrap.sql`.

### 0b.3 — Login-Prototyp (minimaler SolidJS-Stub)

- Neues Verzeichnis `client-saas/` (parallel zum bestehenden `client/`).
- Vite + SolidJS init (`pnpm create vite client-saas --template solid-ts`).
- `supabase-js` als Dependency.
- Einzige Seite: Login-Form mit drei Buttons (Google, LinkedIn, Magic-Link-E-Mail).
- Nach erfolgreichem Login: zeige User-E-Mail + Workspace-ID als Text (kein App-UI noch).

**Verifikation:** 
- Login mit allen drei Providern → User + Workspace + Membership-Row in DB.
- Logout löscht Session-Cookie.
- Session-Refresh funktioniert.

---

## Phase 0c — Schema-Design + Migration

**Ziel:** Das heutige JSON-Model (nodes, cells, kbCards, checklists, items, links) ist als relationale Tabellen abgebildet. RLS-Policies verhindern Zugriff auf fremde Workspaces. Ein Import-Endpoint migriert einen localStorage-Dump in die DB.

### 0c.1 — Tabellen (Kern, Phase 0)

```sql
-- Workspaces + Membership
workspaces        (id uuid PK, name text, owner_id uuid → auth.users, created_at)
memberships       (workspace_id uuid FK, user_id uuid FK, role text CHECK owner/admin/editor/viewer, created_at)

-- Rekursive Matrix-Struktur
-- „nodes" heute = matrix | board ; behalten als ein Table mit Discriminator
nodes             (id uuid PK, workspace_id uuid FK, type text CHECK matrix|board, 
                   label text, alias text, data jsonb, -- data bleibt JSONB für Phase 0
                   parent_cell_id uuid NULL FK self, -- für rekursive Cell-Bindung
                   created_at, updated_at, created_by, updated_by)

-- Cells (Matrix-Feld, verbindet Zeile × Spalte × optional Board/Matrix-Child)
cells             (id uuid PK, matrix_id uuid FK nodes, row_id uuid, col_id uuid,
                   alias text, features text[], 
                   board_id uuid NULL FK nodes, child_matrix_id uuid NULL FK nodes,
                   data jsonb, -- Info-Felder, Link-Liste etc.
                   UNIQUE(matrix_id, row_id, col_id))

rows              (id uuid PK, matrix_id uuid FK, label text, position int)
cols              (id uuid PK, matrix_id uuid FK, label text, position int)

-- Kanban (wenn cells.board_id gesetzt)
kb_cols           (id uuid PK, board_id uuid FK nodes, label text, position int, color text)
kb_cards          (id uuid PK, board_id uuid FK nodes, col_id uuid FK kb_cols,
                   name text, note text, tags text[], who text[], deadline date,
                   recur jsonb, priority int, done bool, archived bool,
                   alias text, source_cl_id uuid NULL, source_label text NULL,
                   checklist_ref uuid NULL FK checklists, 
                   checklist jsonb NULL, -- V2-Inline-Karten-Checkliste
                   done_occurrences date[], created_at, updated_at)

-- Checklisten (Standalone)
checklists        (id uuid PK, board_id uuid FK nodes, label text,
                   recur jsonb, close_mode text, action jsonb, history jsonb,
                   position int, created_at, updated_at)
checklist_items   (id uuid PK, checklist_id uuid FK, text text, done bool, 
                   level int CHECK 0..2, position int)

-- Links (inkl. Mailvorlagen)
links             (id uuid PK, board_id uuid FK nodes, type text CHECK url|mail,
                   label text, url text, alias text, data jsonb)

-- Audit
audit_log         (id bigserial PK, workspace_id uuid, user_id uuid, 
                   action text, args jsonb, result jsonb, ok bool, created_at)
```

Kommentar: **JSONB für `data`** (bei nodes + cells) bleibt als Übergangsstruktur erhalten — verhindert, dass wir jede Info-Text-Zeile, jede Tag-Definition in eigene Tabellen ziehen müssen. Kann später ausgezogen werden, wenn bestimmte Felder queryable werden müssen.

### 0c.2 — RLS-Policies

Alle User-Facing-Tabellen bekommen RLS mit folgendem Muster:

```sql
ALTER TABLE nodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nodes_workspace_access" ON nodes
  USING (workspace_id IN (
    SELECT workspace_id FROM memberships 
    WHERE user_id = auth.uid()
  ));

CREATE POLICY "nodes_workspace_write" ON nodes
  FOR INSERT/UPDATE/DELETE
  USING (workspace_id IN (
    SELECT workspace_id FROM memberships 
    WHERE user_id = auth.uid() AND role IN ('owner','admin','editor')
  ));
```

Analog für `cells`, `kb_cards`, `checklists`, `checklist_items`, `links`, `audit_log`.

`workspaces` hat eigene Policy: lesen wenn Member, updaten wenn owner.

### 0c.3 — Import-Endpoint *(gestrichen — verschmolzen in 0d.6)*

> **Entscheidung 2026-04-21:** Der Import wird client-seitig im SolidJS-Client gemacht (parsen + Inserts via Supabase-JS mit User-Token → RLS greift automatisch). Spart ~300 Zeilen PL/pgSQL und Postgres-RPC-Exposition. Ursprünglicher Entwurf bleibt als Referenz untenstehend.

- Edge-Function (Deno, supabase-eigen) oder Bridge-Endpoint (Node): `POST /import/localstorage`.
- Input: der komplette `getPayload()`-JSON-Dump aus dem Single-File-Client.
- Prozess:
  1. Neuen Workspace anlegen (oder existierenden des Users wiederverwenden).
  2. `nodes` rekursiv durchwandern, in DB schreiben.
  3. `cells`, `kb_cards`, `checklists` etc. aus jedem Node nachziehen.
  4. UUID-Mapping: alte String-IDs (`n7`, `n42`) → neue UUIDs. Mapping-Tabelle in memory während Import, Alias-Referenzen umschreiben.
  5. `rebuildAliasIndex`-Äquivalent als DB-Prozedur.
- Transaktional: alles-oder-nichts.

### 0c.4 — Migration-Setup

- Supabase-CLI-Migrations in `infra/supabase/migrations/`.
- Pro Schema-Änderung ein Migration-File. Versioniert, applied via `supabase db push`.
- Schema-Snapshot in `infra/supabase/schema.sql` auto-generiert nach jedem Push (für Review).

**Verifikation:** 
- Eigenen localStorage-Dump exportieren, via `/import/localstorage` hochladen.
- `SELECT count(*) FROM nodes WHERE workspace_id = '…'` stimmt mit dem Original-Node-Count überein.
- RLS-Test: Als User B anmelden, `GET /api/nodes` → leeres Array (kein Zugriff auf User A's Daten).

---

## Phase 0d — SaaS-Client (SolidJS) Read-Only

**Ziel:** Der SaaS-Client rendert die Matrix-Struktur aus der DB — read-only. Keine Mutationen. Navigation funktioniert (Stack, Cell-Drill-Down).

### 0d.1 — Projekt-Struktur

```
client-saas/
├── src/
│   ├── main.tsx                  Entry + Supabase-Client-Init
│   ├── auth/                     Login + Session-Guard
│   ├── lib/supabase.ts           Typed Client (aus Schema generiert)
│   ├── state/                    Solid-Stores für Workspace, aktueller Node etc.
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── Matrix.tsx
│   │   ├── Cell.tsx
│   │   ├── Board.tsx
│   │   ├── CardModal.tsx
│   │   └── Checklist.tsx
│   └── types/                    geteilt mit Bridge via Monorepo-Shared
├── index.html
├── vite.config.ts
└── package.json
```

### 0d.2 — Typ-Generierung

- `pnpm supabase gen types typescript --local` → `client-saas/src/lib/database.types.ts`.
- Automatisch bei Schema-Migration aktualisiert (pre-commit-Hook).

### 0d.3 — State-Management

- Solid-Signal pro Workspace: aktueller Node, Stack, Edit-Mode.
- Daten-Fetch via supabase-js mit RLS (automatisch scoped auf eingeloggten User).
- Kein Re-Fetch-per-Click — alles reaktiv via Signals.

### 0d.4 — UI-Port (Read-Only)

- Visuelles Design 1:1 aus `matrix_tool_beta.html` übernehmen (CSS-Tokens kopieren).
- Komponenten: Sidebar-Tree, Matrix-Gitter, Cell-Inhalt, Kanban-Board, Checkliste, Card-Modal.
- **Alles nur Lesen.** Edit-Buttons deaktiviert/versteckt.

**Verifikation:** 
- SaaS-Client zeigt importierte Matrix exakt so, wie sie im Single-File-Client aussieht.
- Navigation (Klick auf Cell → Sub-Matrix) funktioniert.
- Responsive-Breakpoints wie im Single-File.

---

## Phase 0e — Write-API + Realtime

**Ziel:** Alle bestehenden Mutations-Operationen sind gegen die DB verdrahtet. Ein zweiter Tab sieht Änderungen live.

### 0e.1 — Mutation-Layer

Zwei Design-Optionen:

**Option A: Pure-Supabase-Client-Writes**
- Jeder Handler ruft direkt `supabase.from('nodes').update(...)`.
- Einfach, aber: komplexe Operationen (z. B. `_transformChecklistToCard`) brauchen mehrere Statements — die werden im Client zusammengestellt und nicht atomar. Bei Netzwerk-Abbruch mittendrin = inkonsistenter Zustand.

**Option B: RPC-Functions (Postgres-Funktionen)**
- Komplexe Operationen als `CREATE FUNCTION matrix.transform_checklist_to_card(...) RETURNS json`.
- Client ruft `supabase.rpc('transform_checklist_to_card', args)`.
- Atomar in einer Transaktion.
- **Ausgewählter Ansatz für komplexe Operations.** Simple Single-Table-Mutations (Toggle, Rename) bleiben Pure-Client.

Mapping der 50 MATRIX_TOOLS:
- ~30 Simple-CRUD → Pure-Client-Writes
- ~15 Multi-Step (Transform, Clone, Move-mit-Descendants) → RPC
- ~5 Read-Only (query, status, settings.get) → direkte Selects/RPC

### 0e.2 — Realtime-Subscriptions

- Client abonniert beim Workspace-Join:
  ```ts
  supabase.channel('workspace:' + wsId)
    .on('postgres_changes', {event:'*', schema:'public', filter:'workspace_id=eq.'+wsId}, handler)
    .subscribe();
  ```
- Handler patched lokalen Store → UI re-rendert automatisch (Solid-Signals).
- Optimistic UI: Mutation erst lokal anwenden, dann DB-Response + Realtime-Broadcast-Ack → Rollback wenn Fehler.

### 0e.3 — Bridge-Rolle neu

- Bridge spricht gegen Supabase (nicht mehr gegen Browser-WS für Datenzugriff).
- MCP-Tool-Handler werden RPC-Calls oder Client-Writes mit Service-Role-Key.
- AI kann jetzt arbeiten, auch wenn kein Browser-Tab offen ist — Bridge hat DB-Zugriff.
- Bridge-Browser-WS bleibt nur für „Zeige dem User was die AI gerade macht" (optional).

### 0e.4 — Konflikt-Handling

- Last-Writer-Wins auf Zell-/Card-Ebene, via `updated_at`-Column + optimistic-concurrency-Token (`version`-Integer).
- User A und B editieren dieselbe Karte gleichzeitig: letzter Save gewinnt, dem anderen wird „veraltet, neu laden?"-Toast gezeigt.
- Kein Auto-Merge, keine CRDT — zu komplex für den Wert in Phase 0.

**Verifikation:** 
- Zwei Browser-Tabs, beide eingeloggt mit selbem User → Änderung in Tab A erscheint innerhalb 1 s in Tab B.
- Mit zweitem User (via Membership-Row manuell gesetzt) → beide sehen dieselben Daten.
- AI-Tool-Call via MCP → Änderung erscheint im Browser live.

---

## Phase 0f — Feature-Parität mit Single-File

**Ziel:** Der SaaS-Client kann alles, was `matrix_tool_beta.html` kann. Kein Feature-Rückschritt.

Das ist kein einzelner Sprint, sondern eine Check-Liste:

- [ ] Matrix erstellen/umbenennen/löschen
- [ ] Row/Col CRUD
- [ ] Cell-Features (Info, Aufgaben, Checklisten, Sub-Matrix)
- [ ] Kanban: Karten, Spalten, Drag+Drop, Recur
- [ ] Checklisten V2 komplett (alle 5 Cluster: Nesting, Alias-Autocomplete, Paste, Recur, History, Events, Transform-to-Card)
- [ ] Sidebar-Tree, Minimap, Frequency-Matrix
- [ ] Command-Palette (`^alias`, `^n`, `^copy`, `^cl-to-card`, etc.)
- [ ] Alle Shortcuts, alle Settings
- [ ] Dark-Mode, Responsive-Breakpoints
- [ ] Export/Import (JSON + IMX verschlüsselt) — für Migration auf/von Standalone

Erfolg: jede V-Verifikation aus dem bestehenden `CLAUDE.md` läuft auch im SaaS-Client grün.

**Realistischer Zeitrahmen:** 8-12 Wochen, wenn konzentriert gearbeitet wird. Kein Feature-Deadline-Druck — Qualität > Geschwindigkeit.

---

## Phase 0g — Standalone-Freeze + Offline-PWA-Cache

**Ziel:** Der Single-File-Client wird eingefroren als eigenständiges Artifact. Der SaaS-Client wird PWA-fähig.

### 0g.1 — Standalone-Build einfrieren

- `packages/client-standalone/matrix.html` wird als `client-standalone/matrix.html` kopiert + verschoben.
- Separates Deployment-Target: `matrix.levcon.at/standalone/`.
- Keine Weiterentwicklung dort — Bugfixes nur wenn kritisch.
- Release-Notes-File `client-standalone/CHANGELOG.md` frozen-at V2.4.

### 0g.2 — SaaS-Client PWA-fähig

- Service-Worker via `vite-plugin-pwa`.
- Cache-First für Assets, Network-First für API.
- IndexedDB-Cache der letzten Workspace-Daten.
- Offline-Modus:
  - Read funktioniert auf Cache-Stand.
  - Write-Versuche → „Du bist offline. Änderungen werden beim Reconnect gespeichert." + Pending-Queue in IndexedDB.
  - Reconnect: Queue abarbeiten; bei Konflikten „veraltet" + Neuladen.
- PWA-Manifest, Install-Prompt.

**Verifikation:** 
- Client installieren (Chrome Install-Icon).
- Netzwerk kappen → App läuft weiter, Read funktioniert.
- Karte bearbeiten offline → wird beim Reconnect zur DB synced.

---

## Dependencies zwischen Phasen

```
0a Infra ──┬──▶ 0b Auth ──┬──▶ 0c Schema ──┬──▶ 0d Read-Client ──┬──▶ 0e Write+Realtime ──▶ 0f Feature-Parity ──▶ 0g PWA+Freeze
           │              │                │                    │
           └──────────────┴────────────────┴────────────────────┴──▶ Backup/Monitoring-Tasks (parallel)
```

Phase 0e kann erst starten, wenn 0d einen funktionierenden Read-Only-Client hat. Parallelität zwischen 0a/0b/0c ist möglich (Infra-Arbeit und Schema-Design können überlappen).

---

## Risiken und Unknowns

| Risiko | Wahrscheinlichkeit | Impact | Gegenmaßnahme |
|---|---|---|---|
| Supabase-Stack auf VPS frisst mehr RAM als angenommen | mittel | hoch | VPS-Monitoring in 0a, Upgrade bei Bedarf |
| RLS-Policies sind schwieriger zu debuggen als App-Auth | hoch | mittel | Policy-Testsuite mit Fixtures in 0c |
| SolidJS ist weniger dokumentiert als React | niedrig | niedrig | Dokumentations-Bookmarks, Community-Discord aktiv |
| Realtime-Broadcast-Latenz zu hoch für „live" | niedrig | mittel | Messung in 0e; Fallback auf Polling |
| Offline-Queue führt zu Datenverlust bei Konflikten | mittel | hoch | Klare UX: „veraltet, neu laden", kein Silent-Overwrite |
| SMTP-Deliverability (Magic-Link landet im Spam) | hoch | mittel | SPF/DKIM/DMARC korrekt; Postmark statt Gmail-SMTP |
| Vendor-Lock an Supabase-Realtime-Syntax | niedrig | niedrig | Abstraction-Layer `client-saas/src/lib/realtime.ts` |

---

## Success-Kriterien Phase 0

Phase 0 ist abgeschlossen, wenn:

1. Ich (User) kann mich auf `https://matrix.levcon.at` einloggen (alle drei Provider).
2. Meine bestehende localStorage-Matrix ist importiert und sieht identisch aus.
3. Alle Features aus `packages/client-standalone/matrix.html@v0.3.0-checklist-v2` sind im SaaS-Client verfügbar.
4. Ein zweiter User kann eingeladen werden (manuell via DB-Insert in `memberships`) und sieht den geteilten Workspace live.
5. PWA-Install funktioniert; Offline-Read + Reconnect-Queue funktioniert.
6. Standalone-Client ist einfrieren und als Fallback deploybar.
7. Alle V-Checks aus dem bestehenden `CLAUDE.md` laufen grün (auch im SaaS).
8. Backup läuft automatisch, Restore wurde einmal getestet.
9. Keine bekannten Sicherheitslücken (ASVS-L2-Pass).

---

## Phase 1+ Ausblick (außerhalb dieses Plans)

- **Phase 1:** Invite-Flow UI, Workspace-Rollen-Management-UI, Live-Cursor/Presence.
- **Phase 2:** Matrix-Share mit Einzel-Usern (feingranularere Berechtigungen).
- **Phase 3:** Billing + Subscriptions + Stripe-Integration + Free-Tier-Quotas.
- **Phase 4:** Cell-/Column-Level-ACLs.
- **Phase 5:** Mobile-Native (Capacitor-PWA-Wrap oder React-Native).
- **Phase 6:** Marktreife + DSGVO-Dokumentation + Terms + Privacy.

---

## Commit-Konventionen in `feat/backend-phase-0`

Analog zum bestehenden Branch-Modell:

```
feat(infra/supabase): Docker-Compose-Skeleton + TLS-Routing
feat(auth): OAuth-Google + Magic-Link via GoTrue
feat(schema): initiales Datenmodell + RLS-Policies
feat(import): localStorage→DB-Importer mit UUID-Mapping
feat(saas-client): Vite+Solid-Setup + Login-Flow
feat(saas-client/read): Matrix-Rendering aus DB
feat(saas-client/write): Mutation-Layer + Realtime-Subscribe
feat(saas-client/features): Checkliste-V2-Port
feat(saas-client/pwa): Service-Worker + IndexedDB-Cache
chore(standalone): matrix_tool_beta.html in client-standalone/ einfrieren
```

Sub-Sprint-Granularität wie in V2: ein Sprint = ein abgeschlossener Meilenstein, ≤ 3 Tage Arbeit, Verifikation vor dem Commit.

---

## Entscheidungen, die noch anstehen

1. **SMTP-Provider** (Postmark, Mailgun, SES, eigener Mailcow?). Betrifft 0a.
2. **VPS-RAM-Status** (aktuelle Größe + Upgrade-Option). Betrifft 0a.
3. **Monorepo-Layout**: bleibt `client/` und wir ergänzen `client-saas/` + `client-standalone/`? Oder echtes pnpm-Workspace mit `packages/{bridge,client-standalone,client-saas,shared-types}`? (Letzteres sauberer, aber Umbau-Aufwand.)
4. **Staging-Umgebung**: zweiter VPS für Staging-Tests, oder separate Postgres-DB auf demselben VPS mit eigener Subdomain? Betrifft 0a.

Offen → in Kick-Off-Session zu Phase 0a klären.

---

## Phase-0-Abschluss + Audit-Welle (2026-04-25)

Phase 0 ist nach ~141 Commits abgeschlossen, Multi-User-Live-Verify durch (admin@levcon.at + albi.enric@gmail.com mit Cross-Membership). Die `feat/backend-phase-0`-Arbeit ist via `--no-ff`-Merge `2084676` lokal in `main` integriert (push pendet, Audit-Welle läuft durchstartet).

Vor Phase 1 wurde eine Audit-Welle eingelegt — drei Hygiene-Sprints (Q1–Q3) und sechs tiefere Audit-Sprints (A1–A6) entlang `docs/claude/`-Standards:

| Sprint | Output |
|---|---|
| AU-Q1 / Q2 / Q3 | Code-Hygiene Quick-Wins, Alias-Index dedupliziert, JSONB-Reader zentralisiert |
| AU-A1 | [`docs/audit/A1-rollen-findings.md`](audit/A1-rollen-findings.md) — 7 Rollen-Reviews |
| AU-A2 | [`docs/audit/A2-asvs-verify-report.md`](audit/A2-asvs-verify-report.md) — ASVS-L2 + CORS-URL-Validation |
| AU-A3 | WCAG-AA Pass: Focus-Trap (`lib/dialog.ts:installFocusTrap`), `--text2`-Kontrast 4.7:1, `aria-modal` in 4 Modals |
| AU-A4 | [`docs/audit/A4-style-findings.md`](audit/A4-style-findings.md) — Style-Konvention-Audit |
| AU-A5 | [`docs/audit/A5-checklist-luecken.md`](audit/A5-checklist-luecken.md) — 14/14 Audit-Commits trigger-konform |
| AU-A6 | Doku-Sync (CLAUDE.md + plan-backend-phase-0.md + claude/styles.md) |

**Findings als Follow-up-Mini-Sprints festgehalten** (siehe `A4-style-findings.md`):
- AU-A4.1: `noNonNullAssertion`-Sweep (~116 Stellen, ~2h)
- AU-A4.2: a11y-Sweep (~64 Lint-Errors, ~2h)
- AU-A4.3: Focus-Restore-Helper konsolidieren (~10 Modals, ~1h)
- AU-A4.4: restliche Lint-Quick-Wins + `--fs-base`/`--fs-small`-Tokens (~30 min)

Diese sind kein Phase-0-Blocker, sondern Eintritts-Karte für Phase 1.

**Phase-0-Erfolgs-Kriterien:** 8 von 9 grün, #8 (automatisches Backup + Restore-Test) deferred per User („kein Produktivbetrieb"). Siehe `~/.claude/projects/.../memory/project_phase0_status.md`.
