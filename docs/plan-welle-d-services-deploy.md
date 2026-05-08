# Welle WV.D — Server-Side Services Deploy

Drei neue Services aus Welle D landen auf dem VPS:

| Service | Sprint | Port | systemd-Unit |
|---|---|---|---|
| `alias-resolve` | D.6 | 8084 | `matrix-alias-resolve.service` |
| `oauth-bridge` | D.3.f.2 | 8085 | `matrix-oauth-bridge.service` |
| `mail-bridge` | D.3.d | 8086 | `matrix-mail-bridge.service` |

nginx terminiert TLS und proxied `/api/resolve/`, `/api/oauth-bridge/`, `/api/mail-bridge/` an die jeweiligen Loopback-Ports.

---

## One-Time VPS Bootstrap

Auszufuehren als root auf `staging.matrix.levcon.at` (analog zu `infra/services/calendar-inbound-sync/README.md`).

### 1. Service-User anlegen

```bash
for svc in alias-resolve oauth-bridge mail-bridge; do
  sudo useradd --system --no-create-home --shell /usr/sbin/nologin "matrix-$svc" || true
  sudo mkdir -p "/opt/matrix-$svc"
  sudo chown -R "matrix-$svc:matrix-$svc" "/opt/matrix-$svc"
done
```

### 2. .env-Files

Werte siehe `infra/services/<svc>/README.md`. Modus 0600, Owner = Service-User.

```bash
# /opt/matrix-alias-resolve/.env
PORT=8084
HOST=127.0.0.1
DATABASE_URL=postgresql://supabase_admin:<pw>@127.0.0.1:5432/postgres
SUPABASE_JWT_SECRET=<JWT_SECRET aus supabase/.env>
FRONTEND_BASE_URL=https://staging.matrix.levcon.at/app

# /opt/matrix-oauth-bridge/.env
PORT=8085
HOST=127.0.0.1
DATABASE_URL=postgresql://supabase_admin:<pw>@127.0.0.1:5432/postgres
SUPABASE_JWT_SECRET=<JWT_SECRET aus supabase/.env>
SUPABASE_URL=https://supabase.matrix.levcon.at
SUPABASE_SERVICE_ROLE_KEY=<service-role-jwt>

# /opt/matrix-mail-bridge/.env
PORT=8086
HOST=127.0.0.1
DATABASE_URL=postgresql://supabase_admin:<pw>@127.0.0.1:5432/postgres
SUPABASE_JWT_SECRET=<JWT_SECRET aus supabase/.env>
```

DB-Passwort + JWT-Secret + Service-Role-Key liegen in `/opt/matrix-supabase/supabase/.env` (Bind-Mount Source).

```bash
for svc in alias-resolve oauth-bridge mail-bridge; do
  sudo chmod 0600 "/opt/matrix-$svc/.env"
  sudo chown "matrix-$svc:matrix-$svc" "/opt/matrix-$svc/.env"
done
```

### 3. systemd-Units installieren

```bash
sudo cp /opt/matrix-repo/infra/systemd/matrix-alias-resolve.service /etc/systemd/system/
sudo cp /opt/matrix-repo/infra/systemd/matrix-oauth-bridge.service /etc/systemd/system/
sudo cp /opt/matrix-repo/infra/systemd/matrix-mail-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable matrix-alias-resolve.service matrix-oauth-bridge.service matrix-mail-bridge.service
```

(Noch nicht starten — erst nach erstem Code-Deploy in Schritt 5.)

### 4. nginx-Reload

`infra/nginx/staging.matrix.levcon.at.conf` enthaelt bereits die drei `location /api/{resolve,oauth-bridge,mail-bridge}/`-Bloecke. Nach Deploy-Mirror-Update:

```bash
sudo cp /opt/matrix-repo/infra/nginx/staging.matrix.levcon.at.conf \
        /etc/nginx/sites-available/staging.matrix.levcon.at
sudo nginx -t
sudo systemctl reload nginx
```

### 5. Erster Code-Deploy (manuell, V1)

CI-Pipeline-Erweiterung (auto-deploy.yml) folgt — V1 manueller Deploy pro Service:

```bash
# Pro Service
cd /opt/matrix-repo/infra/services/<svc>
npm ci --omit=dev
npm run build
sudo rsync -a --delete dist/ node_modules/ package.json /opt/matrix-<svc>/
sudo chown -R "matrix-<svc>:matrix-<svc>" "/opt/matrix-<svc>"
sudo systemctl start matrix-<svc>.service
```

### 6. Smoke-Tests

```bash
# alias-resolve (erwartet 401 ohne JWT)
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8084/api/resolve/foo

# oauth-bridge (erwartet 401 ohne JWT)
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8085/exchange

# mail-bridge (erwartet 401 ohne JWT)
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8086/test_connect

# Logs
sudo journalctl -u matrix-alias-resolve -u matrix-oauth-bridge -u matrix-mail-bridge -f --since '2 min ago'
```

---

## Frontend-Wiring (bereits in main)

| Lib | Pfad | Wirkung |
|---|---|---|
| oauth-flow | `packages/client-web/src/lib/oauth-flow.ts` | `supportsServerSideOAuth(provider)` + Server-Branch in `completeOAuthFlow` (POST `/api/oauth-bridge/exchange`). |
| AccountChannels | `packages/client-web/src/routes/settings/AccountChannels.tsx` | `canUseBrowserOauth` akzeptiert sowohl PKCE- als auch Server-Side-Provider. |
| mail-generic | `packages/client-web/src/lib/channels/mail-generic.ts` | Bridges `listInboxes/listMessages/sendMessage/testConnect` auf `/api/mail-bridge/`. |

`SERVER_SIDE_OAUTH_PROVIDERS` in `oauth-flow.ts` listet aktuell `slack`, `gmail`, `discord`. Bei Bedarf erweitern (z.B. wenn Azure-App ohne SPA-Profil registriert ist).

---

## Provider-Slot-Konfiguration (Admin-UI)

`oauth_provider_slots`-Tabelle wird per Admin-Dashboard befuellt (`docs/plan-welle-d.md` D.3.e). Pro Provider:

- `client_id` (public)
- `client_secret_encrypted` (nur fuer Server-Side-Provider noetig)
- `auth_url`, `token_url`
- `default_scopes[]`

Frontend rendert „OAuth-Verbinden"-Button nur wenn fuer den Provider ein Slot konfiguriert ist UND der User Workspace-Member mit dem Slot-Workspace ist.
