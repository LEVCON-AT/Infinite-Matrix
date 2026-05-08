# oauth-bridge (Welle WV.D.3.f.2)

Server-Side OAuth-Token-Exchange + Refresh fuer Provider die client_secret brauchen (slack, gmail).

Browser-PKCE-Pfad fuer Public-Clients (Microsoft SPA) bleibt im Frontend (`lib/oauth-flow.ts`).

## Endpoints

- `POST /exchange` — code → tokens. Body: `{ provider, code, code_verifier, redirect_uri }`.
- `POST /refresh` — refresh_token-Flow. Body: `{ provider }`. Persistiert direkt via service-role.

## Env

```
PORT=8085
HOST=127.0.0.1
DATABASE_URL=postgresql://supabase_admin:<pw>@127.0.0.1:5432/postgres
SUPABASE_JWT_SECRET=<JWT_SECRET aus supabase/.env>
SUPABASE_URL=https://supabase.matrix.levcon.at
SUPABASE_SERVICE_ROLE_KEY=<service-role-jwt>
```

## nginx-Snippet

```
location /api/oauth-bridge/ {
    proxy_pass http://127.0.0.1:8085/;
    proxy_http_version 1.1;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Content-Type $http_content_type;
}
```

## Frontend-Wiring (V2)

`lib/oauth-flow.ts` muss um Server-Side-Branch erweitert werden: wenn `supportsBrowserPkce(provider) === false` → POST zu `/api/oauth-bridge/exchange` statt direkt an `slot.token_url`. Dadurch funktioniert AccountChannels-„OAuth-Verbinden" auch fuer slack/gmail.
