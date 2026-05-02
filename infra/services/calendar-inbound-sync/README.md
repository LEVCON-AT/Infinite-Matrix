# matrix-calendar-inbound-sync

Saugt externe Kalender (ICS-Subscribe / Google / Microsoft) in die Matrix-DB.

## Build

```bash
cd infra/services/calendar-inbound-sync
npm install
npm run build
```

## Deploy auf VPS

```bash
# 1. Code nach /opt/matrix-calendar-inbound
sudo mkdir -p /opt/matrix-calendar-inbound/data
sudo cp -r dist node_modules package.json /opt/matrix-calendar-inbound/
sudo chown -R matrix-bridge:matrix-bridge /opt/matrix-calendar-inbound

# 2. .env aus .env.example anlegen, Mode 0600
sudo cp .env.example /opt/matrix-calendar-inbound/.env
sudo chmod 0600 /opt/matrix-calendar-inbound/.env
sudo chown matrix-bridge:matrix-bridge /opt/matrix-calendar-inbound/.env
# DATABASE_URL einsetzen (postgres-User, kein Passwort, Trust-Auth via Unix-Socket)

# 3. systemd-Unit
sudo cp infra/systemd/matrix-calendar-inbound.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now matrix-calendar-inbound.service

# 4. nginx — staging-Conf um Webhook-Endpoints erweitern
sudo cp infra/nginx/snippets/calendar-inbound.conf /etc/nginx/snippets/
# In /etc/nginx/sites-available/staging.matrix.levcon.at.conf innerhalb des
# HTTPS-server-Blocks ergaenzen:  include /etc/nginx/snippets/calendar-inbound.conf;
sudo nginx -t && sudo systemctl reload nginx

# 5. Smoke
curl -sS http://127.0.0.1:8083/healthz   # erwartet 'ok'
sudo journalctl -u matrix-calendar-inbound -f --since '2 min ago'
```

## Endpoints

| Methode | Pfad                                             | Zweck                                                    |
|---------|--------------------------------------------------|----------------------------------------------------------|
| GET     | `/healthz`                                       | Liveness                                                 |
| POST    | `/webhook/google`                                | Google Calendar Push (X-Goog-Channel-ID-Header)           |
| POST    | `/webhook/microsoft/:subscriptionId`             | MS Graph Subscription Push (validation-token-Handshake)   |

## Sync-Auslöser

- **Frontend** ruft `trigger_external_calendar_sync(p_id)` → `pg_notify('calendar_sync_due', id)` → Service syncs sofort.
- **Cron-Loop** (default 60s): `list_due_external_calendars()` liefert ICS-Subscribes deren `last_sync_at < now() - sync_interval_minutes`.
- **Webhook-Push** (Google/MS): externer Provider postet → Service triggert Sync für betroffenen Calendar.

## Architektur-Verweis

Sync-Pfad orientiert sich an `architektur.md` §4 (Mutation-Wrapping/Offline-Pfad ist hier reverse — wir lesen extern, schreiben in DB) und nutzt das Atom-Zwiebel-Modell (`architektur.md §1`): externe Events erscheinen polymorph als `atom_manifestations(atom_type='imported_event')` via Mirror-Trigger aus Migration 059.
