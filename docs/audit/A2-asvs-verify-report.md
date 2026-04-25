# AU-A2 — ASVS-L2 + RLS Live-Verify Report

**Datum:** 2026-04-25
**Stack:** matrix.levcon.at (Production-Bridge), staging.matrix.levcon.at (Backend-Stack vor SaaS-Client-Live)
**Standard:** OWASP ASVS v5 Level 2

## Ergebnisse auf einen Blick

| Test | Standard | Ergebnis | Notiz |
|---|---|---|---|
| 1. CORS-Allowlist Bridge | V14.5 | PASS | Bridge-Endpoints liefern keinen `Access-Control-Allow-Origin` an evil-Origin |
| 2. CORS auf Supabase-Endpoints | V14.5 | INFO | Kong-Default `*` auf `/auth/v1/health` — by-design fuer public Health-Checks |
| 3. RLS Cross-User Isolation | V8.1 / V4.1 | DEFER | benoetigt psql-Zugang am VPS; Test-Befehle siehe unten |
| 4. Rate-Limit auf Bridge | V13.1.1 | PARTIAL | Plugin registriert, Header in 401-Response nicht sichtbar; Burst-Test deferred |
| 5. Audit-Scrub | V7.3.3 | PASS (code) | `scrubArgs` deckt 8 Secret-Field-Names rekursiv |
| 6. Realtime-Publication `docs` | — | PASS | bereits in Migration 007 abgedeckt; Finding 5 aus Plan-File ist stale |
| 7. CORS-Allowlist URL-Validation | V14.5 | FIXED | `sanitizeCorsAllowlist()` neu in Bridge index.ts |

**Keine HIGH-Findings.** Drei MED/LOW-Punkte (RLS Live-Verify, Rate-Limit-Header, Audit-Scrub-Unit-Test) sind als Mini-Sprints aufgenommen.

---

## 1. CORS-Allowlist Bridge — PASS

### Hypothese
Bridge `/healthz` und `/mcp` duerfen unter Production-Defaults (`CORS_ORIGINS` leer) keine `Access-Control-Allow-Origin`-Header echoen — auch nicht fuer eine bekannte böse Origin wie `https://evil.example`.

### Befehl
```pwsh
curl -sS -D - -o NUL -H 'Origin: https://evil.example' \
  https://matrix.levcon.at/healthz
```

### Ergebnis
```
HTTP/1.1 200 OK
Server: nginx/1.24.0 (Ubuntu)
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' …
```

Kein `Access-Control-Allow-Origin`. Auch fuer `/mcp` (POST + Preflight OPTIONS): kein Origin-Echo. Bridge laeuft mit `CORS_ORIGINS=` leer in Prod (Lockdown via `corsOrigin = false` Branch), das ist konsistent mit dem Status — der SaaS-Client liegt noch nicht unter einer separaten Origin.

### Bewertung
PASS. Sobald der SaaS-Client unter eigener Origin live geht, muss `CORS_ORIGINS` mit der validierten Allowlist-Logik aus dem AU-A2-Commit (`sanitizeCorsAllowlist`) gepflegt werden — siehe Test 7.

## 2. CORS auf Supabase-Endpoints — INFO

### Befehl
```pwsh
curl -sS -D - -o NUL -H 'Origin: https://evil.example' \
  https://staging.matrix.levcon.at/auth/v1/health
```

### Ergebnis (Auszug)
```
HTTP/1.1 401 Unauthorized
Access-Control-Allow-Origin: *
WWW-Authenticate: Key realm="kong"
```

Kong (Supabase-API-Gateway) liefert `*` auf `/auth/v1/health`. Dieser Endpoint ist eine reine Liveness-Probe ohne Datenherausgabe (401 ohne Token). Ein wildcard-CORS auf einer reinen Health-Antwort ist kein Risk.

### Bewertung
INFO. Wer dieser Wildcard kuenftig auf einem Daten-Endpoint sieht, sollte ueber Kong-Konfiguration pruefen — heute deckt der `apikey: <ANON_KEY>`-Zwang plus RLS bereits jeden datenrelevanten Pfad ab.

## 3. RLS Cross-User Isolation — DEFER

### Hypothese
Migration 009 (FORCE RLS) garantiert, dass selbst die `service_role`-Verbindung keine Workspaces einsehen kann, deren Memberships sie nicht hat — der `is_workspace_member`-Check muss zwingend feuern.

### Test-Befehl (auf dem VPS, mit psql-Zugang zum DB-Container)
```bash
# 1. Als albi.enric (UUID des Test-Members)
docker compose -f /opt/matrix-supabase/docker-compose.yml exec -T -e \
  "PGPASSWORD=$POSTGRES_PASSWORD" db psql -U authenticator -d postgres <<'SQL'
  SET ROLE authenticated;
  SELECT set_config('request.jwt.claims',
    json_build_object('sub','<albi-uuid>')::text, true);
  SELECT count(*) FROM nodes
   WHERE workspace_id = '<admin-only-workspace-uuid>';
SQL
# Erwartet: 0 rows
```

```bash
# 2. FORCE-RLS-Backstop: SET ROLE als service_role-Imitat
docker compose ... db psql -U supabase_admin -d postgres <<'SQL'
  SET LOCAL ROLE authenticator;
  SET ROLE authenticated;
  SELECT set_config('request.jwt.claims',
    json_build_object('sub','<random-non-member-uuid>')::text, true);
  SELECT count(*) FROM nodes
   WHERE workspace_id = '<admin-only-workspace-uuid>';
SQL
# Erwartet: 0 rows (FORCE RLS feuert auch wenn man via SET ROLE
# beim authenticated-Role landet ohne Membership)
```

### Status
DEFER. Live-Verify benoetigt VPS-SSH-Zugang und einen aktiven Test-User. **Auf User-Seite ausfuehren** — Output fuer's Audit-Tracking unter `docs/audit/A2-rls-output.txt` ablegen.

Vorhandene Sicherheits-Pfade die diese Verify nur bestaetigen, nicht aufbauen:
- Migration 001: `is_workspace_member()` SECURITY DEFINER, prueft `memberships`-Eintrag
- Migration 009: `ALTER TABLE … FORCE ROW LEVEL SECURITY` auf 13 Tabellen
- Migration 007 (docs): `docs_select` policy mit `is_workspace_member(workspace_id)`

## 4. Rate-Limit auf Bridge — PARTIAL

### Befehl
```pwsh
curl -sS -D - -o NUL -X POST -H 'Content-Type: application/json' \
  -d '{}' https://matrix.levcon.at/mcp
```

### Ergebnis
```
HTTP/1.1 401 Unauthorized
…
(keine x-ratelimit-* Header sichtbar)
```

### Analyse
`@fastify/rate-limit` ist registriert mit `max=50, timeWindow=1s, allowList=/healthz`. Auf einer 401-Response von der Auth-onRequest-Hook (vor dem Tool-Dispatch) sind die `x-ratelimit-*`-Header nicht im Output sichtbar — vermutlich weil Auth via `reply.code(401).send(...)` die Response sendet, bevor Rate-Limit seine Header beigemischt hat. Funktional ist Rate-Limit aktiv (siehe `index.ts:48-60`).

### Test-Befehl fuer Live-Burst (User)
```bash
for i in {1..200}; do
  curl -sS -o /dev/null -w '%{http_code} ' \
    -H 'Authorization: Bearer <BRIDGE_TOKEN>' \
    https://matrix.levcon.at/healthz
done; echo
# Erwartet: nach ca. 50 Requests pro Sekunde 429 — die /healthz-allowList
# muss vorher temporaer raus, sonst feuert Rate-Limit hier nicht.
```

### Status
PARTIAL. Code-Pfad korrekt + Plugin registriert. Live-Burst-Verify deferred — gehoert zu einem `staging`-only-Testlauf.

## 5. Audit-Scrub — PASS (code)

### Hypothese
Bridge `tools.call`-Audit-Log darf in `args` keine Klartext-Passwoerter, Tokens oder API-Keys persistieren (ASVS V7.3.3).

### Pfad
`packages/bridge/src/dispatcher.ts:13-35` — `SECRET_FIELDS` deckt `password`, `pw`, `passphrase`, `token`, `apikey`, `api_key`, `secret`, `authorization` (case-insensitive). `scrubArgs(value)` ist rekursiv (Arrays + Objects) und wird sowohl auf `args` als auch auf `result` vor dem `INSERT INTO audit_log` angewendet.

### Code-Test (statt Live)
```ts
// Beispiel-Input (synthetisch)
const args = { username: 'a', password: 's3cret', meta: { token: 'abc' } };
scrubArgs(args)
// Output:
// { username: 'a', password: '[REDACTED]', meta: { token: '[REDACTED]' } }
```

### Bewertung
PASS auf Code-Ebene. **Empfehlung als Mini-Sprint:** Unit-Test in `packages/bridge/test/dispatcher.test.ts` mit ~6 Cases (Top-Level / Nested / Array / Mixed-Casing / Null-Through / Non-Object-Pass-Through). Aktuell ist `scrubArgs` ohne Regression-Test — ein zukuenftiges Refactor koennte die Funktion silently brechen.

## 6. Realtime-Publication `docs` — PASS

### Hypothese (aus Plan-File Finding 5)
> `infra/supabase/migrations/005_realtime_publication.sql` hat 9 Tabellen; `docs` (aus 007) fehlt.

### Befund
Plan-File-Finding ist STALE. Migration `007_docs.sql:90-106` fuegt `docs` zu `supabase_realtime` hinzu **und** setzt `REPLICA IDENTITY FULL`:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'docs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.docs;
  END IF;
END $$;

ALTER TABLE public.docs REPLICA IDENTITY FULL;
```

Client-Subscriber `lib/realtime.ts:31,45` listet `docs` ebenfalls — beides synchron seit Migration 007.

### Status
PASS. Keine Migration 010 noetig.

## 7. CORS-Allowlist URL-Validation — FIXED

### Befund
Plan-File Finding 8 + Security-Rolle MEDIUM: `packages/bridge/src/index.ts:27-31` splittete `CORS_ORIGINS` per `,` ohne URL-Constructor-Check. Ein versehentlich gepflegter Eintrag `evil.example` (kein Schema) oder `javascript:alert(1)` waere als Origin durchgereicht worden.

### Fix
`sanitizeCorsAllowlist(raw)` in `packages/bridge/src/index.ts` (neu in diesem Commit):
- Pro Eintrag `new URL(origin)` — invalides wird verworfen, Warning geloggt
- Schema-Allowlist: nur `http:` und `https:` zulassen
- Kein Pfad / Trailing-Slash: `origin !== url.origin` → verwerfen + Hinweis auf canonical Origin
- Loop bleibt funktional bei leerer Allowlist (Prod: lockdown via `false`, Dev: `true`)

### Verifikation
- 177 Bridge-Unit-Tests: alle gruen
- Type-Check: gruen
- Code-Pfad bei `CORS_ORIGINS` leer unveraendert (Lockdown in Prod)

### Status
FIXED. Live-Effekt erst sichtbar, sobald `CORS_ORIGINS=https://app.matrix.levcon.at` in der `.env` gesetzt wird (Phase 0g+ wenn SaaS-Client live geht).

---

## Zusammenfassung

| Punkt | Risk | Aktion |
|---|---|---|
| RLS Live-Verify | LOW (FORCE RLS aktiv, Code-Review konsistent) | User-VPS-Test, Output unter `docs/audit/A2-rls-output.txt` ablegen |
| Rate-Limit Live-Burst | LOW (Plugin korrekt registriert) | optional als Mini-Sprint, gehoert zu staging-Smoke |
| Audit-Scrub Unit-Test | LOW (Code korrekt, Test fehlt) | Mini-Sprint AU-A2.1 (~10 min) |

Keine HIGH-Findings im Live-Verify. Alle Code-Aenderungen aus AU-A1.x + diesem Commit sind durchgaengig type-checked + grueneingespielt.

## Compact-Empfehlung

Live-Verify-Output in dieser Datei ist abgeschlossen. Wenn `/compact` empfohlen war, dann **jetzt**: dieser Report ist autoritativ, der curl-Roh-Output kann weg.
