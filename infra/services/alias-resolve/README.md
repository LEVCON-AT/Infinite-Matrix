# alias-resolve (Welle WV.D.6)

Public-Alias-Resolve-Endpoint mit Member-Auth + 302-Redirect.

## Endpoint

`GET /api/resolve/:alias`

- **Auth**: Bearer-JWT ODER Cookie `sb-access-token`.
- Bei Member: 302 → Frontend-Atom-URL.
- Bei Non-Member: 401 + Header `X-Login-Redirect`.

## Env

```
PORT=8084
HOST=127.0.0.1
DATABASE_URL=postgresql://supabase_admin:<pw>@127.0.0.1:5432/postgres
SUPABASE_JWT_SECRET=<JWT_SECRET aus supabase/.env>
FRONTEND_BASE_URL=https://staging.matrix.levcon.at/app
```

## systemd-Unit (Beispiel)

```ini
[Unit]
Description=Matrix Alias-Resolve
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/matrix-alias-resolve
ExecStart=/usr/bin/node dist/index.js
EnvironmentFile=/opt/matrix-alias-resolve/.env
User=matrix-alias-resolve
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

## nginx-Snippet

```
location /api/resolve/ {
    proxy_pass http://127.0.0.1:8084/api/resolve/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Authorization $http_authorization;
}
```

## Deploy

CI-Pipeline-Erweiterung folgt — V1 manueller Deploy:

```sh
ssh root@vps "cd /opt && rsync -az alias-resolve/ /opt/matrix-alias-resolve/"
systemctl restart matrix-alias-resolve
```

Frontend-Wiring: bei Click auf `^alias`-Mention nicht-resolvable wird die Page zu `/api/resolve/<alias>` navigiert; Server-302 routet zur Atom-Page.
