# Supabase-Stack — Deploy-Anleitung

## Voraussetzungen
- VPS mit Docker + docker-compose-plugin (check: [infra/scripts/vps-check.sh](../scripts/vps-check.sh))
- DNS-Record `staging.matrix.levcon.at → VPS-IP`
- TLS-Cert für `staging.matrix.levcon.at` (certbot wird im Deploy-Flow aufgerufen)
- Ionos-SMTP-Credentials bereit (Login-Mail für Magic-Link-Versand)

## Ablauf

### 1. Lokal: `.env` ausfüllen

```bash
cd infra/supabase
cp .env.example .env
nano .env
```

Pflichtfelder (markiert mit `[TODO]`):
- `POSTGRES_PASSWORD` — `openssl rand -base64 32`
- `JWT_SECRET` — `openssl rand -base64 40`
- `SECRET_KEY_BASE` — `openssl rand -hex 32`
- `SMTP_PASS` — aus Ionos-Mail-Panel
- `DASHBOARD_PASSWORD` — für Studio-Basic-Auth

### 2. Lokal: `ANON_KEY` + `SERVICE_ROLE_KEY` generieren

```bash
cd infra/supabase   # muss in dem Dir sein — Script liest .env aus ../supabase/.env
bash ../scripts/supabase-genkeys.sh
# → Output in .env einfügen
```

### 3. Lokal: nginx-Config + DNS + TLS

- DNS-A-Record für `staging.matrix.levcon.at` auf die VPS-IP einrichten.
- TLS-Cert auf VPS holen:
  ```bash
  ssh vps "sudo certbot certonly --nginx -d staging.matrix.levcon.at"
  ```

### 4. Auf VPS: Stack hochschieben

```bash
# Von deinem lokalen Rechner
rsync -av --exclude='.env' --exclude='volumes/db/data/' \
  infra/supabase/ \
  root@87.106.25.91:/opt/supabase/

# .env separat (enthält Secrets — `--exclude` oben verhindert versehentliches Überschreiben beim Re-Deploy)
scp infra/supabase/.env root@87.106.25.91:/opt/supabase/.env

# nginx-Vhost
scp infra/nginx/staging.matrix.levcon.at.conf \
  root@87.106.25.91:/etc/nginx/sites-available/staging.matrix.levcon.at

# Script
scp infra/scripts/supabase-deploy.sh root@87.106.25.91:/tmp/
```

### 5. Auf VPS: Stack starten

```bash
ssh vps
sudo ln -sf /etc/nginx/sites-available/staging.matrix.levcon.at \
  /etc/nginx/sites-enabled/staging.matrix.levcon.at
sudo nginx -t && sudo systemctl reload nginx

# Stack deployen
sudo bash /tmp/supabase-deploy.sh
```

Das Script fragt bei jedem Schritt (Pull, Start, Studio) nach.

### 6. Verifikation

```bash
# Auf dem VPS
curl -sf http://127.0.0.1:8000/auth/v1/health && echo

# Von außen (deinem Rechner)
curl -sfI https://staging.matrix.levcon.at/auth/v1/health
```

Sollte `HTTP/2 200` liefern mit `{"version":"...","name":"GoTrue","description":"..."}`

### 7. Studio (Admin-UI)

Studio läuft nicht standardmäßig mit. On-Demand starten:

```bash
ssh vps "cd /opt/supabase && docker compose --profile admin up -d"
```

Dann SSH-Tunnel:
```bash
ssh -L 3002:127.0.0.1:3002 vps
# Browser → http://localhost:3002
# Basic-Auth-User/Pass aus .env
```

Nach Nutzung wieder runterfahren:
```bash
ssh vps "cd /opt/supabase && docker compose --profile admin down"
```

## Memory-Budget

Stack idle ~1.6 GB:
- postgres: 800 MB (limit)
- realtime: 350 MB (limit)
- auth, rest, kong: je 200 MB (limit)
- vector: 100 MB (limit)

Plus Bridge (~45 MB) + n8n (~330 MB) + nginx (~15 MB) + System (~200 MB) = ~2.3 GB.
Bei 3.8 GB RAM + 4 GB Swap → ~1.5 GB Puffer für Spitzen.

## Troubleshooting

- **`db` startet nicht**: `docker compose logs db | tail -30` — meist Permission-Problem auf `volumes/db/data/` (muss 999:999).
- **Auth `500 SMTP`**: Ionos-Credentials checken; oft ist es Port 587 mit STARTTLS.
- **Realtime-WS bricht ab**: nginx-`proxy_read_timeout` auf 3600s (ist in der Config so gesetzt).
- **OOM-Kills**: `dmesg | grep -i kill` — falls Container gekillt werden, Memory-Limits anpassen oder VPS upgraden.
