# Matrix Webhook-Dispatcher (Welle C.3)

Externer Node-Service. Verbindet sich an die Postgres-DB direkt (kein
Supabase-Edge), `LISTEN`'d auf den `workspace_events_new`-Channel und
dispatched POST-Requests an konfigurierte `workspace_webhooks`.

## Warum extern

Self-hosted Supabase-Stack (siehe `infra/supabase/docker-compose.yml`)
hat **kein** Edge-Functions-Service-Tier. Outbound-HTTP aus PL/pgSQL
ist nicht ohne `http`-Extension moeglich, und die wuerde DNS-/Cert-
Pflege ins DBMS holen — schlechter Ort fuer SSRF-Schutz. Daher ein
schlanker Node-Worker neben Supabase auf demselben VPS.

## Architektur

```
[ workspace_events insert via emit_event-RPC ]
        │
        │ pg_notify('workspace_events_new', event_id)
        ▼
┌────────────────────────────────────────────┐
│ webhook-dispatcher (Node-Service)          │
│  - LISTEN workspace_events_new             │
│  - SELECT event details                    │
│  - SELECT subscribed webhooks              │
│  - SSRF-Check target_url                   │
│  - HMAC-SHA256-Signatur                    │
│  - POST mit 5s timeout, no redirects       │
│  - last_status / fail_count zurueckschreiben│
└────────────────────────────────────────────┘
        │
        ▼ HTTPS POST (X-Webhook-Signature: sha256=...)
[ n8n / Slack / Teams-Bot / Custom-Endpoint ]
```

## SSRF-Schutz

- `target_url` muss `http(s)`-Schema haben (DB-Constraint plus Service-
  Side Re-Check).
- DNS-Aufloesung gegen private IP-Ranges blockiert: 127.0.0.0/8,
  10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, ::1,
  fc00::/7, fe80::/10. Multicast/Reserved auch.
- `redirect: 'manual'` — Service folgt keinem 302-Redirect.
- 5s Timeout auf den Outbound-Call.

## Auto-Disable

Bei 5 aufeinanderfolgenden Fails wird `enabled` automatisch auf `false`
gesetzt. Workspace-Admin reaktiviert manuell ueber Settings/Webhooks.

## HMAC-Signatur-Verifikation (Empfaenger-Side)

```js
const sig = request.headers['x-webhook-signature']; // "sha256=<hex>"
const expected = 'sha256=' + crypto
  .createHmac('sha256', SIGNING_SECRET_HEX_FROM_SETTINGS)
  .update(rawBody)
  .digest('hex');
crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
```

`SIGNING_SECRET_HEX_FROM_SETTINGS` ist der Hex-String, den der User
einmalig nach `create_workspace_webhook` in der UI angezeigt bekam.

## Boot lokal

```sh
pnpm install
DATABASE_URL=postgresql://postgres@localhost:5432/postgres \
  pnpm --filter matrix-webhook-dispatcher dev
```

## VPS-Deploy (TODO eigener Sprint)

- `infra/systemd/matrix-webhook-dispatcher.service` (folgt).
- DATABASE_URL env-var via systemd `Environment=` oder via `.env`-File.
- Soll nicht als root laufen — `User=matrix` mit nur LISTEN/SELECT/
  UPDATE-Rights auf workspace_events + workspace_webhooks (eigene
  Postgres-Role mit beschraenkten Grants).
- Restart=always, RestartSec=5.
- Health-Check via `journalctl -u matrix-webhook-dispatcher`.

## Status

V1 implementiert. **Nicht deployed**. Trigger zum Live-Schalten:
1. systemd-Unit anlegen + `User=matrix` einrichten.
2. DATABASE_URL via env setzen.
3. `pnpm --filter matrix-webhook-dispatcher build && pnpm start`.
4. Verifikation: in UI Webhook anlegen, manuelles Member-Invite,
   Logs `[dispatch] hook=... event=... status=200 ms=...` checken.
