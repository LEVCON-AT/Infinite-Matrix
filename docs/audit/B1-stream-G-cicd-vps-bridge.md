# AU-B1 / Stream G — CI/CD + VPS + Bridge

**Datum:** 2026-04-29
**Scope:** `.github/workflows/deploy.yml` + `pr.yml`, `infra/nginx/`, `infra/systemd/`, `infra/supabase/docker-compose.yml` + `.env.example`, Migrationen 015-036 (Deploy-Sicht), `packages/bridge/`, Plan-Dokumente
**Methode:** Code-Reviewer-Agent, statische Analyse, Memory-Pattern-Hunt (VPS-Lessons, Schema-Quad, Spa-Subpath, Pauschal-Clean, V8-JIT).

---

## Bewertungs-Übersicht

| Severity | Count |
|---|---:|
| CRITICAL | 2 |
| HIGH | 5 |
| MEDIUM | 9 |
| LOW | 3 |
| INFO | 4 |
| **Gesamt** | **23** |

---

## Cross-Cutting-Beobachtungen

1. **Bridge-Tools sind vollständig für die Standalone-Phase** (50 Tools in `tool-registry.test.ts`), aber keine einzige der Object/Group/SoftGroup-RPCs aus Migrationen 030-035 ist in der Bridge als Tool registriert. Das ist ein dokumentierter, aber unvollständiger Schema-Quad. **Cross-Stream:** Stream F B1-F-010 hat dasselbe vermutet — bestätigt.

2. **Off-VPS-Backup ist explizit deferred** (Phase-1.5) — alle lokalen Snapshots liegen auf demselben Host. Totaler Host-Ausfall (Hardware, Account-Sperre) = vollständiger Datenverlust.

3. **`matrix.conf` (matrix.levcon.at) und `staging.matrix.levcon.at.conf` sind zwei parallele nginx-Konfigs** für denselben VPS — Supabase-Routen (`/auth/v1/`, `/rest/v1/`, `/realtime/v1/`) sind nur in `staging.matrix.levcon.at.conf` definiert. Smoke-Test in CI trifft `$HOST` ohne `/app/`-Suffix und kann so eine falsche Config validieren.

4. **`dist/`-Ordner ist im Repo committed** (`packages/bridge/dist/`). Build-Artefakte sind versioniert — CI baut trotzdem neu, aber alte `dist/`-Stände können Verwirrung stiften.

---

## Findings

### [CRITICAL] B1-G-001 — `app.ai_master_key`-GUC fehlt in `.env.example` und im Deploy-Pfad

**File:** `infra/supabase/.env.example` (komplett), `infra/supabase/migrations/018_user_ai_providers.sql:45-49`

**Was:** Migration 018 erwartet eine Postgres-GUC `app.ai_master_key` (gesetzt via `ALTER DATABASE postgres SET app.ai_master_key = '…'`). Ohne sie schlägt jeder Aufruf von `set_ai_provider()` oder `get_my_provider_credential()` mit `ai_master_key_missing` fehl. `.env.example` enthält keinen Hinweis auf diesen Schritt. `infra/scripts/supabase-migrate.sh` setzt die GUC nicht. Es gibt kein Deploy-Script, das `ALTER DATABASE` auslöst.

**Warum:** Auf einer frischen VPS-Installation (nach Datenverlust oder Neuaufsetzen) würde die AI-Provider-Funktion komplett stumm brechen — `set_ai_provider()` wirft eine Exception, die der Frontend-User als uninformatives Scheitern sieht.

**Fix:** `.env.example` um `AI_MASTER_KEY=` (mit Kommentar + `openssl rand -base64 32`-Generieranweisung) ergänzen. In `supabase-migrate.sh` oder einem separaten `supabase-setup.sh` nach dem ersten DB-Start `ALTER DATABASE postgres SET app.ai_master_key = '${AI_MASTER_KEY}'` ausführen.

**Effort:** S
**Memory/Regel:** CLAUDE.md „Datenhoheit beim User"; Setup-Reproduzierbarkeit

---

### [CRITICAL] B1-G-002 — Pauschal `git clean` auf Migrations-Directory kann Migrations-Gap erzeugen

**File:** `.github/workflows/deploy.yml:193`

```bash
sudo git -C /opt/matrix-repo clean -fd -- infra/supabase/migrations/
```

**Was:** Der Kommentar erklärt korrekt, dass kein globales clean passiert — aber das gezielte clean auf `infra/supabase/migrations/` löscht untracked SQL-Files im migrations/-Verzeichnis auf dem VPS. Falls jemand lokal eine Migration manuell auf dem VPS angewandt hat (Notfall-Patch) und die Datei noch nicht im Repo ist, löscht dieser Step sie weg.

**Warum:** Außerdem: wenn jemals bind-mount-Volumes _innerhalb_ eines Unterordners von `infra/supabase/` liegen (z.B. `infra/supabase/volumes/db/data/` — das ist der **aktuelle Postgres-Daten-Bind-Mount** aus `docker-compose.yml:39`), würde ein breiter gefasster Pfad diese treffen. Eine Fehltipp-Variation würde sofort die Postgres-DB killen. Memory `feedback_no_pauschal_git_clean.md` erinnert genau an dieses Risiko.

**Fix:** Den clean-Step durch ein `git status --porcelain -- infra/supabase/migrations/` mit Warnung ersetzen, oder den Schritt gänzlich entfernen (Migrations sind idempotent, untracked SQLs in `/migrations/` sind kein Problem für `supabase-migrate.sh`).

**Effort:** S
**Memory/Regel:** Memory `feedback_no_pauschal_git_clean.md`, CLAUDE.md „Was NICHT tun"

---

### [HIGH] B1-G-003 — PR-Workflow führt kein `pnpm lint` für `client-web` durch

**File:** `.github/workflows/pr.yml:57-60`

**Was:**
```yaml
- name: Typecheck + Build (client-web)
  working-directory: packages/client-web
  run: |
    pnpm typecheck
    pnpm build
```
`pnpm lint` fehlt im PR-Job für `client-web`. Der Deploy-Workflow führt lint + typecheck + build aus (deploy.yml:88-90), der PR-Check nur typecheck + build.

**Warum:** Memory `feedback_biome_jsx_suppression.md` betont explizit: vor jedem Commit `npm run lint` laufen lassen — CI muss exakt das prüfen, was pre-commit gefordert wird. Ein PR mit Lint-Fehlern im `client-web` wird durchgelassen und erst beim Deploy entdeckt (wo er dann den Build bricht).

**Fix:** `pnpm lint` als ersten Schritt im `client-web`-PR-Job ergänzen, analog zu bridge (pr.yml:30).

**Effort:** XS
**Memory/Regel:** Memory `feedback_biome_jsx_suppression.md`

---

### [HIGH] B1-G-004 — Smoke-Test validiert falschen Host / falsche URL-Struktur

**File:** `.github/workflows/deploy.yml:329-333`

**Was:**
```bash
curl -fsS "https://$HOST/healthz" | grep -q '"ok":true'
curl -fsS -o /dev/null -w "%{http_code}\n" "https://$HOST/" | grep -q 200
curl -fsS -o /dev/null -w "%{http_code}\n" "https://$HOST/standalone/" | grep -q 200
```
`$HOST` ist `secrets.DEPLOY_HOST` = `staging.matrix.levcon.at`. Der Healthz-Endpunkt der Bridge ist in `matrix.conf` (Port 443, `server_name matrix.levcon.at`) definiert — nicht in `staging.matrix.levcon.at.conf`.

**Warum:** Der Smoke-Test trifft die `staging.`-Domain, die kein `/healthz` proxied. Der Test schlägt entweder fehl oder validiert das Falsche (wenn ein Catch-all antwortet). `"https://$HOST/"` auf Status 200 — `staging.matrix.levcon.at.conf:131-134` liefert dort ein hartkodiertes 200-HTML-Snippet, was kein echter Funktionsnachweis ist.

**Fix:** Smoke-Test auf `/app/` ausrichten (SaaS-Client-Deploy) und Bridge-Healthz über internen SSH-Tunnel oder direkten Port testen, da der Bridge-Service auf `matrix.levcon.at` hört, nicht auf `staging.`.

**Effort:** S
**Memory/Regel:** Memory `feedback_spa_subpath_router.md` (analog: zwei Domains, zwei Configs)

---

### [HIGH] B1-G-005 — Object-Layer-RPCs (Migrationen 033-035) ohne Bridge-Tool-Coverage

**File:** `packages/bridge/test/tool-registry.test.ts:16-67`, `infra/supabase/migrations/033_object_rpcs.sql`, `infra/supabase/migrations/034_group_rpcs.sql`, `infra/supabase/migrations/035_object_detail.sql`

**Was:** Schema-Quad-Regel (Memory `feedback_schema_quad.md`): jede strukturelle Schema-Änderung braucht Schema + Mutations + MCP-Tool-Trio + Export/Import. Migrationen 033/034/035 liefern 15 neue RPCs (`mcp_create_object`, `mcp_search_objects`, `mcp_set_object_home_ref`, `mcp_update_object`, `mcp_set_object_parent`, `mcp_add_object_tag`, `mcp_remove_object_tag`, `mcp_delete_object`, `mcp_create_group`, `mcp_add_group_members`, `mcp_remove_group_members`, `mcp_rename_group`, `mcp_delete_group`, `mcp_create_soft_group`, `mcp_promote_soft_group`). Kein einziges dieser Tools taucht im `tool-registry.test.ts`-Expected-Array auf, und es gibt keine `src/tools/objects.ts` oder `src/tools/groups.ts` im Quellbaum.

**Warum:** Die Migration 030/033-036 liegt auf Production (laut Memory `project_object_layer_phase3.md`), die Bridge-Seite fehlt vollständig. KI über die Bridge kann das Object-Layer nicht ansprechen.

**Fix:** `packages/bridge/src/tools/objects.ts` + `packages/bridge/src/tools/groups.ts` anlegen, in `registerAllTools()` einhängen, `tool-registry.test.ts` expected-Array erweitern.

**Effort:** L
**Memory/Regel:** Memory `feedback_schema_quad.md`, checklisten.md

---

### [HIGH] B1-G-006 — Off-VPS-Backup fehlt; lokale Retention = 7 Tage, kein Off-Site-Pfad

**File:** `infra/recovery/README.md:8-10`, `infra/recovery/backup-cron.timer:6`

**Was:** Memory `project_backend_phase0_state.md` bestätigt: Erfolgs-Kriterium #8 (Backup) ist deferred. Backup-Cron läuft täglich auf dem VPS, schreibt nach `/opt/recovery/snapshots/` (7-Tage-Retention). Kein Off-Site-Ziel. Kein IONOS-Snapshot automatisch aktiviert.

**Warum:** Totaler Host-Ausfall = vollständiger Datenverlust aller Workspaces, Nodes, Karten, Checklisten und AI-Provider-Keys (verschlüsselt, aber weg). Phase-1.5 (Hetzner Storage Box + restic) ist geplant aber nicht umgesetzt.

**Fix:** IONOS-Panel-Snapshot aktivieren (manuell, sofort). Phase-1.5-Sprint zeitlich einplanen.

**Effort:** M (Phase-1.5-Sprint)
**Memory/Regel:** `project_backend_phase0_state.md` Erfolgs-Kriterium #8

---

### [HIGH] B1-G-007 — `dist/`-Verzeichnis im Repo committed, aber kein `.gitignore`-Eintrag

**File:** `packages/bridge/dist/` (kompletter Verzeichnisbaum vorhanden)

**Was:** Kompilierte JS-Dateien + Source-Maps sind im Repository eingecheckt. Das erzeugt: (a) Merge-Konflikte bei parallelen Branches, (b) Sicherheitsrisiko wenn Secret-Werte jemals in config.js landen, (c) CI baut sowieso neu, der committed `dist/` hat keine Funktion.

**Warum:** Im Artifact-Build wird `pnpm deploy --filter ... --prod artifact/bridge` benutzt, das das `dist/` aus dem frischen Build nimmt — nicht aus dem Repository. Der repository-`dist/` ist also toter Code im Repo.

**Fix:** `packages/bridge/dist/` in `.gitignore` ergänzen, `dist/` aus Tracking entfernen (`git rm -r --cached packages/bridge/dist/`).

**Effort:** XS
**Memory/Regel:** Repo-Hygiene

---

### [MEDIUM] B1-G-008 — `staging.matrix.levcon.at.conf` hat kein CSP-Header

**File:** `infra/nginx/staging.matrix.levcon.at.conf:32-35`

**Was:** `matrix.conf` setzt einen vollständigen CSP-Header (Zeile 52). `staging.matrix.levcon.at.conf` setzt nur HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy — kein `Content-Security-Policy`. Der SaaS-Client (`/app/`) ist die primäre Anwendung auf `staging.matrix.levcon.at` und hat keinen CSP-Schutz.

**Fix:** CSP analog zu `matrix.conf` ergänzen, angepasst für `connect-src` auf die Supabase-Endpunkte.

**Effort:** S
**Memory/Regel:** OWASP ASVS V14.4 (Content-Security-Policy)

---

### [MEDIUM] B1-G-009 — `staging.matrix.levcon.at.conf`: Rate-Limit-Zonen auskommentiert

**File:** `infra/nginx/staging.matrix.levcon.at.conf:7-8, 62, 91`

**Was:** Die Auth-Rate-Limit-Zones (`supabase_auth`, `supabase_api`) sind auskommentiert. Die einzige aktive Rate-Limitation ist die `matrix_invite_redeem`-Zone (Zeile 78). Alle anderen Endpunkte — `/auth/v1/` (Magic-Link, OAuth), `/rest/v1/` (alle PostgREST-Calls) — sind ohne Ratenlimit öffentlich erreichbar.

**Warum:** ASVS V13.1.1-Verstoß. Magic-Link-Spam möglich.

**Fix:** `matrix_api` und `matrix_ws`-Zonen aus `rate-limit.conf` auch für staging aktivieren, zumindest für `/auth/v1/`.

**Effort:** S
**Memory/Regel:** OWASP ASVS V13.1.1

---

### [MEDIUM] B1-G-010 — `ssl_prefer_server_ciphers off` in staging vs. `on` in matrix.conf

**File:** `infra/nginx/staging.matrix.levcon.at.conf:27`, `infra/nginx/matrix.conf:36`

**Was:** Inkonsistente TLS-Konfiguration. Auf Staging läuft der SaaS-Client mit Auth-Daten — schwächere TLS-Konfiguration als auf der Standalone-Seite ist nicht begründet.

**Fix:** `ssl_prefer_server_ciphers on` + gleiche `ssl_ciphers`-Liste wie `matrix.conf` in `staging.matrix.levcon.at.conf`. Alternativ auslagern in eine shared-`ssl-params.conf`.

**Effort:** XS
**Memory/Regel:** OWASP TLS-Hardening

---

### [MEDIUM] B1-G-011 — Migration 036 wrapped in `BEGIN/COMMIT`, alle anderen nicht — Inkonsistenz

**File:** `infra/supabase/migrations/036_label_templates.sql:25`, `030_object_layer.sql` (kein BEGIN/COMMIT)

**Was:** Migration 036 hat explizites `BEGIN;`/`COMMIT;`. Alle anderen Migrationen laufen mit psql-Default-Autocommit. **Cross-Stream:** Stream A B1-A-009 hat das mit anderem Argument (Supabase-CLI-Doppel-Transaction) gefunden. Beide Sichten sind gültig.

**Warum:** `supabase-migrate.sh` führt jede Migration einzeln aus und bricht bei `ON_ERROR_STOP=1` ab, aber ohne explizite Transaktion ist ein Partial-Apply möglich.

**Fix:** Konflikt mit Stream A: dort wird empfohlen das `BEGIN`/`COMMIT` aus 036 zu entfernen. Hier wird empfohlen alle Migrationen damit zu wrappen. Synthesis muss entscheiden — vermutlich Stream A's Sicht (Konsistenz mit dem Migrations-Runner-Default).

**Effort:** S
**Memory/Regel:** Konsistenz mit Migrations-Runner

---

### [MEDIUM] B1-G-012 — `docker-compose.yml` hat keinen Storage-Service, aber `PGRST_DB_SCHEMAS` enthält storage

**File:** `infra/supabase/docker-compose.yml`, `infra/recovery/README.md:133`

**Was:** Das `storage`-Schema wird von PostgREST eingeschlossen (`PGRST_DB_SCHEMAS: public,storage,graphql_public`), ohne dass ein Storage-Service existiert. Wenn Frontend-Code versucht Storage-RPCs aufzurufen, bekommen sie eine unerwartete Antwort.

**Fix:** Entweder `storage` aus `PGRST_DB_SCHEMAS` entfernen, oder Storage-Service mit `profiles: [storage]` ergänzen und dokumentieren.

**Effort:** S

---

### [MEDIUM] B1-G-013 — `SECRET_KEY_BASE` fehlt in `.env.example` mit Pflicht-Markierung

**File:** `infra/supabase/.env.example:35`

**Was:** `SECRET_KEY_BASE=` steht ohne `[TODO]`-Markierung und ohne Generier-Anweisung. Realtime braucht das als Phoenix-Secret — ein leeres `SECRET_KEY_BASE` führt zu einem Startup-Fehler des Realtime-Containers.

**Fix:** `# [TODO] 64 Zeichen hex: openssl rand -hex 32` als Kommentar ergänzen.

**Effort:** XS
**Memory/Regel:** Setup-Reproduzierbarkeit

---

### [MEDIUM] B1-G-014 — Migration-Lücke: 024-029 fehlen zwischen 023 und 030

**File:** `infra/supabase/migrations/`

**Was:** Migrationen springen von `023_create_workspace_rpc.sql` direkt auf `030_object_layer.sql`. **Cross-Stream:** Stream A B1-A-005 hat dasselbe als HIGH gefunden.

**Fix:** Entweder Platzhalter-Migrations (`024_reserved.sql` … `029_reserved.sql`) anlegen, oder in 030 dokumentieren warum die Nummern übersprungen wurden.

**Effort:** S

---

### [MEDIUM] B1-G-015 — `plan-bridge.md` beschreibt Phase-0 als "Implementierung steht aus"

**File:** `docs/plan-bridge.md:5`

**Was:** Bridge ist vollständig implementiert und auf Production deployed (Memory `project_phase1_state.md`). Plan-Dokument hat seit der initialen Erstellung keinen Status-Update bekommen.

**Fix:** Status auf `live (Phase 4 + V2.2 deployed auf matrix.levcon.at)` aktualisieren, abgeschlossene Phasen als ✅ markieren.

**Effort:** S
**Memory/Regel:** Doku-Konsistenz

---

### [MEDIUM] B1-G-016 — `plan-backend-phase-0.md` zeigt 0d.4 als "nächster Sprint" — veraltet

**File:** `docs/plan-backend-phase-0.md:64`

**Was:** Memory `project_backend_phase0_state.md` meldet "Phase 0 + Audit-Welle KOMPLETT". Der Plan zeigt 0d.4 als "nächster Sprint".

**Fix:** Status-Tabelle auf aktuellen Stand bringen, oder Verweis auf Memory-Files als Quelle der Wahrheit setzen.

**Effort:** S
**Memory/Regel:** Doku-Konsistenz

---

### [LOW] B1-G-017 — `backup-cron.service` läuft als `User=root` ohne Begründung

**File:** `infra/recovery/backup-cron.service:12-13`

**Was:** Der Backup-Service läuft als root. Über-Privileg im Vergleich zu `matrix-bridge.service` (dedizierter User).

**Fix:** Dedizierten `backup`-User mit `docker`-Gruppe.

**Effort:** S
**Memory/Regel:** Prinzip des geringsten Privilegs

---

### [LOW] B1-G-018 — `staging.matrix.levcon.at.conf`: `ssl_session_timeout 10m` vs. `1d` in matrix.conf

**File:** `infra/nginx/staging.matrix.levcon.at.conf:29`, `infra/nginx/matrix.conf:43`

**Was:** Inkonsistenz ohne dokumentierten Grund. `ssl_session_tickets off` fehlt in `staging.matrix.levcon.at.conf`.

**Fix:** `ssl_session_tickets off` in `staging.matrix.levcon.at.conf` ergänzen.

**Effort:** XS

---

### [LOW] B1-G-019 — `AuthenticationMethods publickey password` im rescue-sshd-Block ist `OR`, nicht `AND`

**File:** `infra/recovery/README.md:45-56`

**Was:** Mehrere Methoden mit Leerzeichen getrennt = OR-Semantik in OpenSSH. Dokumentation in README.md:101 sagt "beide Faktoren werden gefordert" — das stimmt nicht. Für echtes 2FA bräuchte man `AuthenticationMethods publickey,password` (Komma = AND).

**Fix:** Dokumentation korrigieren oder auf Komma-Syntax umstellen für echtes 2FA.

**Effort:** S
**Memory/Regel:** OpenSSH-Doku-Korrektheit

---

### [INFO] B1-G-020 — WS-Token via Query-Param ist in Logs sichtbar (bekanntes Pattern)

**File:** `packages/bridge/dist/ws.js:11-14`

**Was:** Memory `project_vps_deploy_lessons.md` Bug 2 bestätigt: WS-Token via Query-Param ist notwendig. nginx-Config hat kein `access_log off` für den `/ws`-Location-Block.

**Fix:** `access_log off;` im `/ws`-Block von `matrix.conf` ergänzen.

**Effort:** XS
**Memory/Regel:** Memory `project_vps_deploy_lessons.md`

---

### [INFO] B1-G-021 — Kong 2.8.1 ist EOL (aktuell ist 3.x)

**File:** `infra/supabase/docker-compose.yml:185`

**Was:** Kong 2.8.x hat EOL erreicht. Kein sofortiger Bug, aber bei einem Sicherheits-Audit relevant.

**Fix:** Kong 3.x evaluieren in einem separaten Sprint.

**Effort:** M

---

### [INFO] B1-G-022 — `zod-to-json-schema`-CI-Check ist irreführend

**File:** `packages/bridge/package.json`, `deploy.yml:109`

**Was:** CI-Check auf `zod-to-json-schema` ergibt "FEHLT" — was aber kein Problem ist (eigene Implementierung in `zod-json.ts`).

**Fix:** Den `zod-to-json-schema`-Check aus dem CI-Step entfernen oder klarstellen.

**Effort:** XS

---

### [INFO] B1-G-023 — `supabase-migrate.sh` führt Migrations als `supabase_admin` aus, CI-Bootstrap als `postgres`

**File:** `infra/scripts/supabase-migrate.sh:68`, `.github/workflows/pr.yml:91`

**Was:** Diskrepanz zwischen CI-Verhalten und Production. Aktuell keine bekannte Migration die das trifft, aber potenzieller False-Negative im Idempotenz-Test.

**Fix:** Dokumentieren oder CI-User vereinheitlichen.

---

## Zusammenfassung Top-Prioritäten

| Priorität | Finding | Sofort-Risiko |
|---|---|---|
| 1 | B1-G-001 — `app.ai_master_key` fehlt in Setup-Pfad | AI-Provider auf frischer DB stumm kaputt |
| 2 | B1-G-006 — Off-VPS-Backup fehlt | Totaler Datenverlust bei Host-Ausfall |
| 3 | B1-G-005 — Object-RPCs ohne Bridge-Tool | Schema-Quad unvollständig, KI kann Object-Layer nicht steuern |
| 4 | B1-G-003 — PR fehlt `client-web`-Lint | Lint-Fehler landen auf main |
| 5 | B1-G-004 — Smoke-Test trifft falsche Domain/Endpunkte | Deploy-Verifikation gibt falsches OK |
| 6 | B1-G-007 — `dist/` im Repo | Repo-Hygiene |
| 7 | B1-G-002 — Gezielter clean auf migrations/ mit Gefährdungspotenzial | Notfall-Patches verlierbar |
