# Matrix AI-Proxy

Self-hosted Node-Service. Wraps **OpenAI** + **Gemini** API-Calls, weil
deren Endpoints keine browser-direkten CORS-Header anbieten. Anthropic
geht direkt aus dem Browser via `anthropic-dangerous-direct-browser-
access`-Flag — dieser Proxy ist nur für die anderen zwei.

## Endpoints

```
POST /api/ai-proxy/openai
  Authorization: Bearer <user_jwt>
  Body:    { apiKey, model, messages, tools, ... }
  Returns: SSE-stream

POST /api/ai-proxy/gemini/{model}
  Authorization: Bearer <user_jwt>
  Body:    { apiKey, contents, systemInstruction, tools, ... }
  Returns: SSE-stream
```

## Sicherheit V1

- Origin-Whitelist: `staging.matrix.levcon.at`, `matrix.levcon.at`,
  `localhost:*`.
- `Authorization: Bearer ...`-Header Pflicht (User-JWT, nicht
  validiert — V2 macht jwks-Verify).
- nginx zusätzlich mit Rate-Limit (siehe unten).
- `apiKey` kommt vom Frontend im Body. V2 wird stattdessen via
  service_role-RPC server-side aus `user_ai_providers` decryptet.

## Boot lokal

```sh
PORT=8081 pnpm --filter matrix-ai-proxy dev
```

## VPS-Deploy

```ini
# /etc/systemd/system/matrix-ai-proxy.service
[Unit]
Description=Matrix AI-Proxy
After=network.target

[Service]
Type=simple
User=matrix
WorkingDirectory=/opt/matrix-repo/infra/services/ai-proxy
Environment=PORT=8081
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```nginx
# In staging.matrix.levcon.at.conf
location /api/ai-proxy/ {
  proxy_pass http://127.0.0.1:8081/;
  proxy_http_version 1.1;
  proxy_buffering off;          # SSE-stream nicht puffern
  proxy_read_timeout 300s;       # lange LLM-Calls
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $remote_addr;
  # Rate-Limit (zusaetzlich zu Origin-Check im Service)
  limit_req zone=ai_proxy burst=20 nodelay;
}
```

```nginx
# Im http {} Block
limit_req_zone $binary_remote_addr zone=ai_proxy:10m rate=30r/m;
```

Build + Start:

```sh
cd /opt/matrix-repo/infra/services/ai-proxy
pnpm install
pnpm build
sudo systemctl enable --now matrix-ai-proxy
sudo nginx -s reload
```

## Smoke-Test

```sh
# Service direkt
curl -X POST http://127.0.0.1:8081/openai \
  -H 'authorization: Bearer test' \
  -H 'content-type: application/json' \
  -d '{"apiKey":"sk-...","model":"gpt-4o","messages":[{"role":"user","content":"hi"}],"stream":true}'

# Via nginx
curl -X POST https://staging.matrix.levcon.at/api/ai-proxy/openai ...
```

## V2 Roadmap

- jwks-Verify gegen Supabase-public-key.
- service_role-RPC `get_my_provider_credential(p_kind)` für decrypted
  Key (Browser sieht ihn nie).
- Token-Cost-Counting + Per-User-Quotas.
