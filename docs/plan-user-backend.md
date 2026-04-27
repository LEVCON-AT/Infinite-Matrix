# Roadmap — User-Backend & Doku-Sektion

Status: 2026-04-27. Aufgenommen nach A.0 (AI-Provider-Keys) ist live.

Dieses Dokument inventarisiert **alles was im User-orientierten Backend
noch fehlt** und ordnet jeden Punkt einer Phase zu. Phase A/B/C kommen
aus dem KI-First-Plan (`~/.claude/plans/hallo-so-ich-m-chte-streamed-
matsumoto.md`); Phase D/E/F sind hier neu definiert.

## Zusammenfassung — was fehlt heute, was steht schon

**Live (Phase 1 + 2 bisher):**
- Workspace-CRUD (Owner kann Delete + Ownership-Transfer)
- Multi-Tenant-RLS auf allen Content-Tabellen
- Member-Lifecycle: Invite/Redeem/Deactivate/Reactivate/Remove + Role-Change + Audit-Log
- NodeTree-Avatare (Live-Presence + Static-Creator)
- Live-Cursor pro Cell/Card/Item/Field
- User-Prefs DB-Sync (vis + activity Level pro User Cross-Device)
- AI-Provider-Keys (A.0): User legt eigene Anthropic/OpenAI/Gemini-Keys ab,
  pgcrypto-Encryption, Persistent-Hint
- Cell-Doku-Feature (DocRow + DocsPopup, attached-Cell)

**Bewusst spaeter (Out-of-Scope-Vermerke):**
- WebAuthn/Passkey (Supabase noch beta)
- Quota-Enforcement fuer AI-Calls
- Master-Key-Rotation-Tool
- Mail-Inbound (Mailgun/Postmark)

---

## Phase A — KI-First-Foundation (laufend)

| # | Status | Scope |
|---|---|---|
| **A.0** | ✅ LIVE | AI-Provider-Keys (Tabelle + RPCs + Encryption + Persistent-Hint + Settings-Tab) |
| **A.1** | TODO | MCP-HTTP-Server: portiert Bridge-Tools (matrix/cell/card/checklist) als Cloud-Service. **Wichtig:** self-hosted Supabase hat kein Edge-Functions-Service — wir brauchen einen externen Node-Service (eigener Container im Stack oder neue Bridge-Cloud-Variante) |
| **A.2** | TODO | AI-Assist-Pipe: LLM-Tool-Use-Loop, ruft mcp-call. **Beinhaltet auch:** Test-Call-Button im AddProviderModal — heute UI vorbereitet, Backend fehlt. Ohne A.2 ist A.0 funktional unvollstaendig |
| **A.3** | TODO | Inline-Help-Drawer (rechts ausklappbar, Chat mit Page-Context) |
| **A.4** | TODO | Onboarding-Wizard: 5 Steps, Step-1 = AI-Provider-Setup mit Direct-Links + Skip |
| **A.5** | TODO | Eingeladener-User-Tour (Tooltips + Skip) |
| **A.6** | TODO | Cell-Suggest-Modal bei leerer Cell |

**Reihenfolge-Empfehlung:** A.1 → A.2 (damit Test-Call live wird) → A.3 (sofort nutzbar) → B.1 (SSO erleichtert A.4) → A.4 → A.5 → A.6.

---

## Phase B — Auth-Welle

| # | Status | Scope |
|---|---|---|
| **B.1** | TODO | SSO Google + Microsoft + Email+Password (Magic-Link bleibt Default). Login.tsx Buttons |
| **B.2** | TODO | TOTP-MFA + 8 Backup-Codes (one-time-anzeige + .txt-Download) |
| **B.3** | TODO | Step-Up-Auth: Session-Freshness 5min vor Workspace-Delete/Owner-Transfer/MFA-Aenderung |

---

## Phase C — Integrations / Webhooks

| # | Status | Scope |
|---|---|---|
| **C.1** | TODO | workspace_events + workspace_webhooks + dispatch-Service. HMAC-Signing, SSRF-Schutz |
| **C.2** | TODO | In-App-Inbox: notifications-Tabelle + Glocken-Icon + Read-State |
| **C.3** | TODO | Quick-Rules: 3-4 vordefinierte Templates (Checklist closed → Webhook etc.) |

---

## Phase D — User-Profile & Account-Lifecycle (NEU)

User-orientiertes Account-Backend. Heute fast vollstaendig leer (AccountProfile read-only, AccountSecurity nur Logout, kein Avatar, keine Account-Loeschung). **Vor Welle B (Auth) sinnvoll bauen, weil B.3 Step-Up auf Email-Aenderung etc. einhakt.**

### D.1 — Display-Name + Email-Aenderung

**Scope:**
- Display-Name editierbar in AccountProfile (Schreibpfad `auth.updateUser({ data: { display_name } })` + Sync nach Workspace-Members RPC).
- Email-Aenderung: `auth.updateUser({ email })` triggert Verify-Mail-Roundtrip an alte+neue Adresse. UI mit Pending-State "Email-Wechsel angefordert — bitte beide Mailboxen pruefen".
- Email-Verification-Resend: Button "Verify-Mail erneut senden" wenn `email_confirmed_at` NULL ist.

**Aufwand:** ~0.5 Sprints.
**Voraussetzungen:** Keine — direkt baubar.
**Datei-Touch:** `routes/settings/AccountProfile.tsx` (Edit-Mode), `lib/auth.ts` (Update-Helper), neuer `lib/account.ts`.

### D.2 — Avatar-Upload

**Scope:**
- Supabase-Storage-Bucket `avatars/` (RLS: insert/update self, read all members of shared workspaces).
- AccountProfile: File-Picker + Crop-Preview (square, 256×256, JPEG-encoded).
- Migration 019: Spalte `auth.users.user_metadata.avatar_url` setzen + Cleanup-Trigger bei User-Delete.
- Render in: PresenceStack (Header), TreeAvatar (NodeTree-Creator), MembersList. Fallback bleibt Initial-Buchstabe.

**Aufwand:** ~1 Sprint (Storage-Setup im docker-compose, RLS-Policies, UI).
**Voraussetzungen:** Supabase-Storage-Service muss im docker-compose sein (vermutlich noch nicht). Pruefen + ggf. zusaetzlicher Container.
**Datei-Touch:** Migration 019 (storage-bucket-policy), `lib/avatars.ts` neu, `routes/settings/AccountProfile.tsx`, alle Avatar-Render-Stellen.

### D.3 — Bio + Timezone + Language

**Scope:**
- Tabelle `user_profiles` (user_id PK + bio + timezone + language). User-Preferences-Pattern wie 017.
- Timezone-Default via `Intl.DateTimeFormat().resolvedOptions().timeZone`, override im Profil.
- Language-Pref ist Vorbereitung (i18n kommt spaeter, Default 'de').
- Bio (160 Zeichen, in MembersList sichtbar).
- **Wichtig fuer D.3:** Timezone-Quelle fuer Recurring-Cards — heute nutzen recur-Berechnungen UTC (siehe `lib/recur.ts`?). User-Timezone ist Voraussetzung fuer "every Monday 9am LOCAL TIME".

**Aufwand:** ~1 Sprint.
**Voraussetzungen:** Recur-Berechnungslogik anpassen — ggf. eigener Mini-Sprint D.3a "Timezone in Recurring-Cards" davorziehen wenn das parallel reift.
**Datei-Touch:** Migration 019 oder 020 (`user_profiles` table), `lib/profile.ts`, `routes/settings/AccountProfile.tsx`, `lib/recur.ts` (TZ-Aware).

### D.4 — Account-Loeschung Self-Service

**Scope:**
- Settings → Konto → Sicherheit erweitern: Type-To-Confirm-Modal "Account loeschen" mit Email-Bestaetigung.
- RPC `delete_self_account()` (SECURITY DEFINER):
  - Pruefe ob User Owner irgendeines Workspaces ist.
  - Wenn Single-Member-Workspace: Workspace mit-loeschen (cascade).
  - Wenn Multi-Member-Workspace mit Owner-Rolle: **Block** mit Hinweis "Erst Owner-Transfer machen". Self-Service-Loeschung darf keine "Workspace ohne Owner"-Situation erzeugen.
  - Sonst: User aus allen Memberships entfernen + auth.users-Eintrag loeschen via service-role-Call.
- Step-Up-Auth Pflicht (B.3 als Voraussetzung — oder zumindest Email-OTP-Bestaetigung).
- Cascade-Tests: alle FKs mit ON DELETE CASCADE/SET NULL pruefen (insbesondere `nodes.created_by`, `workspace_audit.actor_id`, `user_preferences.user_id`).

**Aufwand:** ~1 Sprint.
**Voraussetzungen:** B.3 (Step-Up) — wenn nicht, dann mit Email-OTP-StepUp arbeiten.
**Datei-Touch:** Migration 020 (RPC), `routes/settings/AccountSecurity.tsx`, `components/DeleteAccountModal.tsx` neu.

### D.5 — Multi-Session-Management

**Scope:**
- Session-Tabelle (oder Supabase-Auth-Admin-API verwenden falls verfuegbar).
- Settings → Konto → Sicherheit: aktive Sessions mit Geraet/IP/letzter-Aktivitaet anzeigen, "Diese Session abmelden"-Button + "Alle anderen abmelden".
- **Heute-Status:** AccountSecurity-Skeleton dokumentiert Phase 2+ explizit als Defer.

**Aufwand:** ~1 Sprint.
**Voraussetzungen:** B.1 oder zumindest Session-API-Verfuegbarkeit pruefen.
**Datei-Touch:** `routes/settings/AccountSecurity.tsx` (Erweiterung), `lib/sessions.ts` neu.

---

## Phase E — Wiki/Doku-Sektion (NEU)

User-Vision: "Aufbau wie klassische Online-Doku heute, Tool-Doku, API-Doku, …". **Grundaufbau** — Struktur soll erweiterbar sein, der Inhalt waechst spaeter.

Heute existiert nur ein Cell-Doku-Feature (DocRow + DocsPopup, attached-Cell). Das ist Granular-Notiz, nicht Wiki. Phase E baut **darueber** ein zweites Konstrukt fuer Workspace-weite + Plattform-weite Doku.

### E.1 — Wiki-Page-Schema

**Scope:**
- Tabelle `wiki_pages`:
  - id, workspace_id (NULL fuer Plattform-Doku), parent_id (Hierarchie), slug (URL-pfad), title, content (Markdown), kind (`workspace` | `tool-help` | `api`), position, created_by, created_at, updated_at.
  - Workspace-Pages: workspace_id gesetzt + RLS via workspace-membership.
  - Plattform-Pages: workspace_id NULL + RLS read-public, write nur via service-role (du als Maintainer).
- Slugs unique pro (workspace_id, parent_id).
- Hierarchie 3-4 Ebenen tief (mehr verwirrt).
- Auto-Generated-TOC pro Page (aus Markdown-Headings).

**Aufwand:** ~0.5 Sprints (nur Schema + RLS + 1 RPC).

### E.2 — Wiki-Tab + Tree-View + Page-Editor

**Scope:**
- Neuer Top-Level-Tab `/w/<wsId>/wiki` parallel zu `/w/<wsId>` und `/w/<wsId>/settings`.
- Linke Sidebar: Page-Tree (analog NodeTree, aber fuer wiki_pages).
- Rechts: Markdown-Editor (Edit-Mode) / Markdown-Renderer (View-Mode). Wiederverwendung von `markdown-lite.ts` aus DocsPopup, ggf. Erweiterung.
- Sucht-Bar in Sidebar (full-text-search via Postgres `to_tsvector`).
- Slug-basierte URLs: `/w/<wsId>/wiki/getting-started`, `/w/<wsId>/wiki/api/mcp-tools`.

**Aufwand:** ~2 Sprints.
**Voraussetzungen:** E.1 (Schema).
**Datei-Touch:** `routes/Wiki.tsx`, `components/WikiTree.tsx`, `components/WikiEditor.tsx`, `lib/wiki.ts`.

### E.3 — Tool-Help-Section (Plattform-Pages)

**Scope:**
- Plattform-Pages mit `kind = 'tool-help'`. workspace_id NULL.
- Initial-Content (du seedest das einmalig): "Was ist Matrix?", "Cells erklaert", "Tastatur-Shortcuts", "Wie funktioniert der Workspace-Switcher?".
- Settings → Hilfe Link-Pfad: `/help/getting-started` (workspace-agnostisch erreichbar).
- Render-Komponente identisch zur Wiki-View (E.2), nur kein Edit-Button fuer Non-Maintainer.

**Aufwand:** ~0.5 Sprints (Routing + Initial-Seed) + Inhalt-Pflege ist on-going (kein Sprint-Item).

### E.4 — API-Doku-Generation

**Scope:**
- Plattform-Pages mit `kind = 'api'`. Auto-generated aus dem MCP-Tool-Schema (sobald A.1 live ist und das Schema von der mcp-call-Edge-Function exposed wird).
- Build-Script `scripts/gen-api-docs.ts`: liest mcp-call /tools-Endpoint → erzeugt Markdown-Pages "Tool: matrix.create_node — Args, Return, Beispiele".
- CI-Job: bei Schema-Aenderung re-gen + Update der Plattform-Pages.

**Aufwand:** ~1 Sprint.
**Voraussetzungen:** A.1 (mcp-call) muss live sein.

### E.5 — Wiki-Versionen + Attachments (spaeter)

**Defer** auf Phase 3+. Wer mag kann jede Wiki-Page versionieren + Files anhaengen — Schema dafuer designen wenn die Basisstruktur (E.1-E.4) genug Reife hat.

---

## Phase F — Workspace-Polish (NEU, kleine Luecken)

Quick-Wins die das Tool "abrundend" wirken lassen. Kein eigener Sprint pro Item — Bundle als ein Mini-Sprint.

| # | Scope | Aufwand |
|---|---|---|
| **F.1** | Workspace-Rename (heute fehlt der Edit-Pfad — WorkspaceGeneral zeigt Name nur read-only) | ~0.2 Sprints |
| **F.2** | Workspace-Description (Freitext, in Switcher anzeigen) | ~0.3 Sprints |
| **F.3** | Workspace-Logo/Icon (kleiner Identifier neben Name — Storage-Bucket-Pattern wie D.2) | ~0.3 Sprints |
| **F.4** | Default-Rolle pro Workspace ("neue Mitglieder werden default editor/viewer") — heute Hardcoded auf `editor` in InviteForm | ~0.2 Sprints |
| **F.5** | Email-Verification-Status-Badge im AccountProfile (heute kein Hinweis ob Email verified) | ~0.2 Sprints |
| **F.6** | Resend-Verification-Mail-Button (auf AccountProfile + Login-Page) | ~0.2 Sprints |

**Bundle-Sprint F:** ~1.5 Sprints insgesamt, ein Branch + ein Commit.

---

## Quer-Themen (in keinem Sprint zentral, aber relevant)

### Timezone in Recurring-Cards

Heute speichert `kb_cards.recur` und `checklists.recur` als JSONB ohne Timezone-Info. Recurrence-Berechnungen laufen vermutlich UTC. Konsequenz: User in Wien sieht "Daily 09:00" und das ist UTC, nicht Wien.

**Plan:** Wenn D.3 (User-Timezone in user_profiles) live ist, recur.ts ueberarbeiten:
- Eingabe-UI zeigt Times in User-Timezone.
- Persistent-Storage in UTC + `tz`-Stempel (so wie iCal-VEVENT).
- Render-Code rechnet auf User-Timezone zurueck.

**Aufwand:** ~0.5 Sprints. Eigener Mini-Sprint D.3a oder Teil von D.3.

### Audit-Log-Vollstaendigkeit

Heute werden gelogged: invite.created/accepted/revoked, member.deactivated/reactivated/removed, role.changed, ownership.transferred, workspace.delete (vermutlich). Fehlt:
- node.created/deleted (struktureller Audit fuer Compliance).
- cell.feature_added/removed.
- card.created/moved/deleted (hochfrequent — eventuell nicht).
- doc.created/updated/deleted.

**Plan:** Detail-Audit-Sprint (siehe Polish-Tasks unten — wird **jetzt** ausgefuehrt).

### RLS + RPC-Konsistenz

Pruefung aller Tabellen + RPCs auf:
- FORCE RLS aktiv (Defense gegen service-role-Bypass)
- Alle 4 CRUD-Policies definiert
- Jede SECURITY DEFINER RPC setzt `search_path` explizit (Anti-Schema-Hijacking)
- Jede RPC validiert `auth.uid() IS NOT NULL` und Role-Gating

**Plan:** Polish-Sprint **jetzt** (siehe unten).

### API-Schema-Export / OpenAPI

Heute keine offene API-Spec. Mit A.1 (mcp-call) wird die Schema-Liste verfuegbar — daraus laesst sich automatisch eine OpenAPI/AsyncAPI-Doku generieren. Anker fuer E.4.

---

## Polish-Tasks (jetzt, dieser Sprint)

Zwei konkrete Backend-Polish-Tasks die der User gewaehlt hat — werden direkt in dieser Session umgesetzt, nicht in Phase D/E/F:

### P.1 — RLS + RPC-Konsistenz-Sweep

- Pro Migration einen Mini-Audit machen: ENABLE + FORCE RLS, alle 4 CRUD-Policies, RPC-search_path, auth.uid()-Check.
- Findings als Patch-Migration **019** raus (idempotent, fixt nur fehlende Stellen).
- Audit-Report in `docs/audit/B0-rls-rpc-sweep.md`.

### P.2 — Audit-Log-Vollstaendigkeit

- Pro Mutation-Pfad pruefen: Audit-Eintrag vorhanden?
- Fehlende Eintraege ergaenzen: node.created/deleted, cell.feature_added/removed, doc.created/updated/deleted.
- Patch-Migration **019** oder **020** mit `emit_audit`-Calls in den entsprechenden RPCs (oder Trigger pro Tabelle).
- Audit-Report in `docs/audit/B0-audit-log-coverage.md`.

---

## Zeitplan-Empfehlung

Vorschlag fuer die naechsten Wellen, falls du linear durchziehen willst:

```
Welle 1 (Polish, jetzt):          P.1 + P.2
Welle 2 (Account-Lifecycle):      D.1 + D.5 + F.5 + F.6  (~1 Sprint)
Welle 3 (KI-Pipe-Foundation):     A.1 + A.2  (~2 Sprints)
Welle 4 (Auth):                   B.1 + B.2 + B.3  (~2 Sprints)
Welle 5 (KI-User-facing):         A.3 + A.4 + A.5 + A.6  (~3 Sprints)
Welle 6 (Profile-Polish):         D.2 + D.3 + D.4  (~3 Sprints, braucht B.3 fuer D.4)
Welle 7 (Workspace-Polish):       F.1-F.4  (~1 Sprint)
Welle 8 (Wiki):                   E.1 + E.2 + E.3  (~3 Sprints)
Welle 9 (Integrations):           C.1 + C.2 + C.3  (~3 Sprints)
Welle 10 (API-Doku):              E.4 (braucht A.1)  (~1 Sprint)
```

**Grobschaetzung:** 22 Sprints fuer alles, ohne Phase-3-Items (Mail-Inbound, vollstaendiger Rules-Builder, WebAuthn, voller i18n).

---

## Update-Pfad fuer dieses Dokument

Nach jedem abgeschlossenen Sprint hier den Status-Spalten-Wert auf ✅ LIVE setzen + Datum + Commit-Hash. So bleibt das Dokument als Laufmonitor nutzbar.
