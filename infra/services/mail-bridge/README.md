# mail-bridge (Welle WV.D.3.d)

IMAP+SMTP-Bridge fuer mail-generic Provider. Browser kann keinen TCP-Socket fuer IMAP/SMTP oeffnen — dieser Service proxy't pro User-Request.

## Endpoints

- `POST /list_folders` — Liste der IMAP-Folder.
- `POST /list_messages` — Body: `{ folder_id, limit? }`. Liefert `messages[]`.
- `POST /send` — Body: `{ to[], cc?, bcc?, subject?, body_text }`.
- `POST /test_connect` — Verifiziert IMAP-Verbindung.

Auth: Bearer User-JWT, validiert per HMAC.

## Credentials-Format

Speicherung in `user_oauth_tokens.generic_credentials_encrypted` (provider='mail-generic') als JSON:

```json
{
  "imap_host": "imap.example.com",
  "imap_port": 993,
  "smtp_host": "smtp.example.com",
  "smtp_port": 465,
  "username": "alice@example.com",
  "app_password": "xxxxx-xxxxx-xxxxx"
}
```

User-Setup: ChannelTokenSetupModal pasted das JSON manuell in den Token-Input. Dabei muss `set_oauth_token` mit `p_generic_credentials` gerufen werden statt `p_access_token`.

## Env

```
PORT=8086
HOST=127.0.0.1
DATABASE_URL=postgresql://supabase_admin:<pw>@127.0.0.1:5432/postgres
SUPABASE_JWT_SECRET=<JWT_SECRET aus supabase/.env>
```

## nginx-Snippet

```
location /api/mail-bridge/ {
    proxy_pass http://127.0.0.1:8086/;
    proxy_http_version 1.1;
    proxy_set_header Authorization $http_authorization;
    # Mail-Send kann groesser sein als Default 1MB.
    client_max_body_size 25M;
    proxy_read_timeout 60s;
}
```

## Frontend-Wiring (V2)

`lib/channels/mail-generic.ts` (V2) muss diese Endpoints rufen statt direkt IMAP/SMTP. ChannelProviderImpl.listInboxes → POST /list_folders, listMessages → /list_messages, sendMessage → /send, testConnect → /test_connect.
