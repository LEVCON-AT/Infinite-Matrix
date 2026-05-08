# Plan — Welle WV.D (Channel-Bridges)

Konzept-Quelle: `docs/concepts/widget-vorlagen-foundation.md` §13, §14, §15, §16.5.

Aufwand: ~25d. Welle D ist der naechste grosse Block nach Welle WV.A/B/C
(vollstaendig commited 2026-05-08). Welle D verbindet die Native-Atom-
Foundation mit externen Providern (Mail / Doc / Drive / Messenger) ueber
OAuth + Provider-APIs.

---

## 1. Sub-Sprint-Reihenfolge

| # | Sub-Sprint | Output | Dauer | Abhaengig von |
|---|---|---|---|---|
| **D.1** | Migration `user_oauth_tokens` + `widget_external_channels` | DDL + RLS + Realtime + ENUM `channel_provider` | 1d | WV.A (Vorlagen-Foundation) |
| **D.2** | OAuth-Foundation (Lazy-Refresh + Master-Key-Encryption + Admin-Dashboard-Provider-Slots) | `lib/oauth-tokens.ts` + Refresh-Pattern + Verify-Buttons | 3d | D.1 |
| **D.3** | Mail-Channel-Bridge V1 (mail-generic IMAP+SMTP + Slack + Teams) | `lib/channels/mail-generic.ts` + `slack.ts` + `teams.ts` + Mail-Widget | 6d | D.2 |
| **D.4** | OneNote-Doc-Sync V1 (Workspace ↔ Notebook, Cell ↔ Section, Doc-Atom ↔ Page) | `lib/channels/onenote.ts` + Sync-Logic | 4d | D.2 |
| **D.5** | Cloud-Drive-Bridge V1 (OneDrive + Google Drive + Dropbox + Nextcloud + pCloud) | `lib/channels/drive.ts` + File-Pick-UI | 5d | D.2 |
| **D.6** | Public-Alias-Resolve-Endpoint (Member-only V1, Login-Redirect bei Non-Member) | API-Route `/resolve/<alias>` + Bridge-Tool | 2d | D.2 |
| **D.7** | AI-Tool `alias.expand_to_text` (markdown / plain / html) | Bridge-Tool + Tests | 1d | D.6 |
| **D.8** | Schema-Heptad-Pflege + Widget-Toggles („extern / native / off") | Types/Mutations/Cache/Realtime/Export/MCP fuer alle Bridge-Tabellen + Widget-Inspector-Toggle-Editor | 3d | D.1-D.7 |

**Buffer:** ~1d fuer Smoke + Cross-Provider-Edge-Cases.

---

## 2. Tabellen-Spec

### 2.1 D.1 — `user_oauth_tokens`

```sql
CREATE TABLE user_oauth_tokens (
  id                            uuid PK DEFAULT gen_random_uuid(),
  user_id                       uuid FK auth.users CASCADE,
  provider                      channel_provider,            -- ENUM, V1 13 Werte
  access_token_encrypted        bytea NOT NULL,              -- pgp_sym_encrypt
  refresh_token_encrypted       bytea NULL,
  generic_credentials_encrypted bytea NULL,                  -- mail-generic: {imap_host, smtp_host, username, app_password}
  expires_at                    timestamptz NULL,
  scopes                        text[] NULL,
  created_at                    timestamptz DEFAULT now(),
  updated_at                    timestamptz DEFAULT now(),
  UNIQUE (user_id, provider)
);
```

**ENUM `channel_provider`** (V1):
- Mail: `outlook`, `gmail`, `mail-generic` (IMAP+SMTP)
- Doc: `onenote`
- Drive: `onedrive`, `drive` (Google), `dropbox`, `nextcloud`
- Messenger: `slack`, `teams`, `discord`, `whatsapp`, `telegram`

**V2-Erweiterung** (deferred): `protonmail`, `pcloud`, `kdrive`, `magentacloud`, `tresorit`, `mailbox-org`, `notion`.

**RLS:** SELECT/WRITE nur Owner. **NICHT in Realtime** (sensible Daten, Cross-Tab-Refresh nicht noetig).

**Encryption:** `pgp_sym_encrypt(plain, app.ai_master_key)`. Decrypt nur in Server-Side-RPC, nie im Client. Pattern aus `user_ai_providers` (Phase 2).

### 2.2 D.1 — `widget_external_channels`

```sql
CREATE TABLE widget_external_channels (
  id              uuid PK,
  widget_id       uuid FK template_widgets ON DELETE CASCADE,
  workspace_id    uuid FK workspaces ON DELETE CASCADE,
  provider        channel_provider,
  external_ref    jsonb DEFAULT '{}'::jsonb,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (widget_id, provider)
);
```

**`external_ref`-Format pro Provider:**
- `outlook`/`gmail`/`mail-generic`: `{folder_id, thread_filter}` oder `{subscription_id}`
- `onenote`: `{notebook_id, section_id}`
- `onedrive`/`drive`/`dropbox`/`nextcloud`: `{folder_id, root_path}`
- `slack`/`teams`/`discord`: `{workspace_id, channel_id}`
- `whatsapp`/`telegram`: `{chat_id, account_phone}`

**RLS:** SELECT alle Workspace-Members, WRITE per `can_write_workspace`. Realtime: ja (Cross-Tab-Member-Sync).

---

## 3. OAuth-Foundation (D.2)

### 3.1 Lazy-Refresh-Pattern

```ts
// lib/oauth-tokens.ts
export async function getValidAccessToken(
  userId: string,
  provider: ChannelProvider,
): Promise<{ token: string; expiresAt: Date | null } | null> {
  const row = await fetchOAuthTokenRow(userId, provider);
  if (!row) return null;
  if (row.expires_at && row.expires_at < new Date(Date.now() + 60_000)) {
    // Innerhalb 60s vor Expiry → Refresh-Call zur Provider-API.
    if (!row.refresh_token_encrypted) return null; // App-Password — kein Refresh moeglich.
    const refreshed = await refreshAccessToken(provider, row);
    await storeRefreshedToken(refreshed);
    return refreshed;
  }
  return row;
}
```

Refresh-Calls laufen via Server-Side-RPC `refresh_oauth_token(user_id, provider)` damit Master-Key nicht ins Frontend muss. Decrypt + HTTP-Refresh-Call + Re-Encrypt + UPDATE.

### 3.2 Provider-Slots im Admin-Dashboard

Memory `feedback_admin_dashboard_config_gate.md`: User-Konfig + Verify-Button pro Provider in Admin-Dashboard. Without `app.ai_master_key` + Provider-Client-ID/Secret konfiguriert → Provider ist im UI ausgegraut.

UI: pro Provider Karte mit Status (`konfiguriert` / `fehlt` / `ungueltig`) + Test-Connect-Button. Bei Test-Fail: konkrete Fehlermeldung („Client-ID falsch" / „Scope fehlt" / „Network").

### 3.3 OAuth-Flow

V1 — Authorization-Code-Flow mit PKCE:
1. User klickt „Mit Outlook verbinden" → Open-Window mit Auth-URL.
2. Provider redirected zu `https://matrix.levcon.at/oauth/callback?code=...&state=...`.
3. Server-Side-Endpoint tauscht code → access_token + refresh_token.
4. Tokens werden via `pgp_sym_encrypt` verschluesselt + in `user_oauth_tokens` gespeichert.
5. Provider-Slot im Admin-UI wechselt zu `verbunden`.

PKCE-Code-Verifier wird in HTTP-only-Cookie zwischen Open-Window und Callback gespeichert.

---

## 4. Channel-Bridges (D.3-D.5)

### 4.1 D.3 — Mail-Channel-Bridge V1

**Provider:** `mail-generic` (IMAP+SMTP), `slack`, `teams`. Outlook/Graph + Gmail-API V2 deferred (Welle WV.D-Phase-2).

**Mail-Widget-Layout:**
- Liste eingehender Mails (latest 20, paginiert).
- Click → Original-Mail im Provider-UI (Thread-URL).
- Reply-Button → Open-Window mit pre-fuelltem Body (Alias-Expansion bei Send via §14.3 `alias.expand_to_text`).

**`mail-generic`-Setup:**
- User gibt IMAP-Server, SMTP-Server, Username, App-Password an (Sicherheits-Hinweis: App-Password ist heikler als OAuth — UI macht das klar).
- Verify-Button testet Connect zu beiden Servern.
- Speicherung in `user_oauth_tokens.generic_credentials_encrypted` als JSON-Blob.

### 4.2 D.4 — OneNote-Doc-Sync V1

**Mapping (Konzept §13.2):**
- Workspace ↔ Notebook (configured pro Workspace via Admin-UI).
- Cell ↔ Section (Default-Mapping ueber `widget_external_channels.external_ref.section_id`).
- Doc-Atom ↔ Page (1:1, Sync-Direction bidirektional Last-Write-Wins).

**Sync-Trigger:**
- Bei Doc-Atom-Edit im Native: Push zu OneNote via Graph-API.
- Polling alle 5min: Fetch Page-Content-Updates → Native-Doc-Atom updaten.
- Realtime: nicht moeglich (Graph-API hat kein WebSocket — V2 Subscription-API mit Webhook-Endpoint).

**Konflikt-Resolution:**
- Last-Write-Wins basierend auf Provider-`lastModifiedDateTime`.
- Bei beiden Seiten Edit < 60s: Toast „Konflikt — letzte Aenderung uebernommen".

### 4.3 D.5 — Cloud-Drive-Bridge V1

**Provider V1:** `onedrive`, `drive` (Google), `dropbox`, `nextcloud`, `pcloud` (V2 deferred — Konzept §13.3).

**Drive-Widget-Layout:**
- Liste Files im konfigurierten Folder (Provider-spezifisch).
- File-Pick-UI: User waehlt Datei → Link wird zu link-Atom (provider=drive/onedrive/dropbox/nextcloud).
- Drag-Source: User zieht File aus dem Widget → wird Cell-Link-Atom (Welle WV.B addCellAtomLink).

**View-Link vs. Download-Link:**
- Default: View-Link (oeffnet Provider-UI). User-Toggle pro Widget: „Download-Link bevorzugen" (V1 Widget-Config).

---

## 5. Public-Alias-Resolve + AI-Tool (D.6 + D.7)

### 5.1 D.6 — Public-Alias-Resolve-Endpoint

**Route:** `https://matrix.levcon.at/api/resolve/:alias`.

**V1 — Member-only:**
- Auth-Check: User muss eingeloggt + Member im Workspace des Alias sein.
- Bei Non-Member: HTTP-401 + Login-Redirect zu `/login?return=/api/resolve/:alias`.
- Bei Member: HTTP-302 zur tatsaechlichen Atom-URL (`/w/:wsId/c/:cellId/info` oder `/w/:wsId/n/:nodeId` etc).

**V2-Optional (Konzept §14.1):**
- Public-Read fuer Workspace-public-Atomen. Nicht V1.

### 5.2 D.7 — AI-Tool `alias.expand_to_text`

**Bridge-Tool:**
```ts
{
  name: 'alias.expand_to_text',
  schema: z.object({
    alias: z.string(),
    format: z.enum(['markdown', 'plain', 'html']).default('markdown'),
  }),
}
```

**Output (Konzept §14.3):**
- `markdown`: `[Vertragsdaten ABC](^vertrag-abc)` — fuer Markdown-Konsumenten.
- `plain`: `Vertragsdaten ABC (^vertrag-abc)` — fuer Mail-Compose.
- `html`: `<a href="...">Vertragsdaten ABC</a>` — fuer Rich-Text-Editoren.

**Permission-Check:** Tool darf nur Atome leak'en, die der calling User-Token sehen darf (RLS via service-role-Bypass-Verbot — Tool laeuft mit User-Context).

---

## 6. Schema-Heptad-Pflege (D.8)

Pro Tabelle (2 Tabellen × 8 Heptad-Slots = 16 Aufgaben) gemaess `architektur.md` §3:

| Slot | `user_oauth_tokens` | `widget_external_channels` |
|---|---|---|
| 1. Schema | D.1 | D.1 |
| 2. Types (`lib/types.ts`) | NEU | NEU |
| 3. Mutations | `lib/oauth-tokens.ts` (D.2) | `lib/widget-channels.ts` (D.2) |
| 4. Cache | TABLES + DB_VERSION+1 (`widget_external_channels` ja, `user_oauth_tokens` NEIN — nicht client-cachen) | TABLES + DB_VERSION+1 |
| 5. Realtime | n/a — kein Realtime-Subscribe (sensible Daten) | direct table |
| 6. Export/Import | NEIN — User-private Tokens werden NICHT exportiert | `lib/export.ts` workspace-only |
| 7. MCP | `bridge/src/tools/oauth-tokens.ts` neu (admin-only Tool fuer connect/disconnect) | `bridge/src/tools/widget-channels.ts` neu |
| 8. Channel-Bridge §14 | = die Bridge-Identitaet selbst | = die Bridge-Verknuepfung selbst |

**Widget-Toggles (D.8):**
- Pro Widget im Designer-Inspector ein 3-Modus-Toggle:
  - `extern` (Default) — Daten kommen aus dem Channel-Bridge-Provider.
  - `native` — Daten leben in der Welle-WV.B-Atom-Foundation (links/checklists/info_fields/docs).
  - `off` — Widget rendert leer.

Default `extern` ist Konzept-Direktive §14.7 — Tool ist Organisations-Layer, nicht primaerer Storage.

---

## 7. Risiken + Mitigation (Welle-D-spezifisch)

| ID | Risiko | Mitigation |
|---|---|---|
| R-WV-D.1 | OAuth-Komplexitaet pro Provider (Outlook/Graph + Gmail + Drive + Slack + Teams sind 5+ verschiedene OAuth-Flows). | V1 nur 1 Provider pro Domain (mail-generic, onenote, onedrive). V2 weitere Provider. Pro Provider eigener Test-Connect-Endpoint im Admin-Dashboard. |
| R-WV-D.2 | Token-Refresh-Race — paralleler Read + Refresh fuer denselben User × Provider. | DB-Lock per `SELECT ... FOR UPDATE NOWAIT` im Refresh-Pfad. Bei Konflikt: zweiter Reader wartet auf den ersten. |
| R-WV-D.3 | Provider-Rate-Limits (Slack 1 req/sec, Graph 10000/10min etc). | Per-Provider Rate-Limit-Wrapper in `lib/channels/rate-limit.ts`. Backoff + Retry. |
| R-WV-D.4 | Webhook-Endpoint-Sicherheit (Provider sendet Updates → unser Server, kein User-Context). | HMAC-Signature pro Provider verifizieren (Slack, Graph). User-Auth ueber gespeicherte Subscription-ID → user_oauth_tokens-Lookup. |
| R-WV-D.5 | App-Master-Key-Rotation (alle Tokens muessen re-encrypted werden). | V1 ohne Rotation (Master-Key bleibt static). V2: Postgres-Function `rotate_master_key(old, new)` mit Lock auf user_oauth_tokens. |

---

## 8. Test-Strategie

**Pro Sub-Sprint:**
- Migration: `psql` Smoke + Idempotency-Re-Apply.
- Types: `tsc --noEmit` clean.
- OAuth-Flow: Manual Smoke pro Provider (Test-Account).
- Channel-Sync: Cross-User Test (User A speichert in Native → User B sieht Update via Realtime).
- MCP-Tools: Vitest pro Tool.

**Welle-D-Akzeptanzkriterien:**
1. User verbindet OneNote-Provider via Admin-UI → Token landet verschluesselt in DB.
2. Cell mit OneNote-Section angelegt → Doc-Atom syncs zu/von OneNote-Page.
3. Mail-Widget mit IMAP-Setup zeigt eingehende Mails.
4. Drive-Widget zeigt Files aus konfiguriertem Folder, File-Pick erzeugt Cell-Link-Atom.
5. AI-Tool `alias.expand_to_text` mit allen 3 Formaten getestet.
6. Public-Alias-Resolve-Endpoint redirected Member zu Atom-URL, Non-Member zu Login.

---

## 9. Definition-of-Done — Welle D

- [ ] D.1 Migration applied + idempotent (077)
- [ ] D.2 OAuth-Foundation live + 1 Provider verbindbar
- [ ] D.3 Mail-Channel-Bridge mind. 1 Konsument (Cell-Mail-Widget)
- [ ] D.4 OneNote-Sync Roundtrip-klar
- [ ] D.5 Drive-Bridge mind. 1 Provider-File-Pick funktional
- [ ] D.6 Public-Alias-Resolve mit Member-Auth
- [ ] D.7 AI-Tool `alias.expand_to_text` Bridge-registriert
- [ ] D.8 Heptad-Pflege komplett + Widget-Toggles („extern / native / off")
- [ ] tsc + biome clean
- [ ] vite build clean
- [ ] Manual Smoke (Akzeptanzkriterien 1-6)
- [ ] Memory-Update: `project_widget_vorlagen_konzept.md` setzt Welle D auf live
- [ ] Konzept-File-Update §16.10 Aufwand-Tabelle: Welle D ✅
