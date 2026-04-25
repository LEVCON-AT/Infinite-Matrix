# Phase 1 — Collaboration, Settings, VPS-Recovery

**Stand:** 2026-04-25 (Plan committed). **Ziel:** Echte Team-Collaboration auf das Phase-0-Multi-User-Fundament + IA-Backbone für Workspace-Admin (Settings-Page) + VPS-Emergency-Access nach dem heutigen Daten-Vorfall.

Quellen: Vier parallele Role-Reviews (Architekt + UX + Security + Deploy) + sieben Runden Discovery-Fragen. Detailliertes Working-File pro Sub-Sprint unter `~/.claude/plans/p1-*.md` (lokal, nicht im Repo).

## Decisions (User-bestätigt)

| Bereich | Entscheidung |
|---|---|
| Liefermodell | Iterativ A → B → C, separate Commits + Pushes, strikt sequenziell |
| Invite-Token | Single-Use, TTL 7d, hash-stored (SHA-256), 256-bit Random |
| Sign-Up-Flow | Magic-Link + automatisches Redeem an `/invite/:token` |
| ACL-Tiefe | Workspace-Level only (Per-Matrix bleibt Phase 2+) |
| Cursor-Tiefe | Activity-Level (Avatar-Chip auf bearbeiteter Cell/Card/Matrix) |
| Mail-Provider | Supabase-Auth-Mailer + Custom-Template |
| UX-Backbone | Eigene Settings-Page `/settings` mit linker Sub-Nav (Account/Workspace/Integrations) |
| Audit-Log | DB-Tabelle + UI, immutable via Trigger |
| Privacy | Incognito-Toggle pro Browser-Session (sessionStorage) |
| Test-Strategy | Manuell + 3 Playwright-E2E-Smoke-Tests |
| Migration-Style | Pro Sub-Sprint genau eine Migration |
| Backup-Gate | Linie 1 nur (lokales Daily-Snapshot-Cron), Off-VPS auf Phase-1.5 deferred |
| Service-Key-Rotation | Eigener Mini-Sprint P1.0b nach P1.0 |

## Sub-Sprint-Übersicht

| # | Sprint | Scope | Aufwand | Migration | Branch |
|---|---|---|---|---|---|
| **P1.0** | VPS Emergency Access | Rescue-User + Recovery-Skripte (lokal Snapshot) + IONOS-Console-Doku | ~2h | — | `feat/p1-0-emergency-access` |
| **P1.0b** | Service-Role-Key-Rotation | rotate-Skript + Bridge atomarer Re-Load + Bitwarden-Workflow | ~45 min | — | `feat/p1-0b-key-rotation` |
| **P1.A** | Invite-Flow + Settings-Page | `/settings`-Route + Account/Workspace-Sub-Nav + Members-Section + Invite-Form + Audit-Log + Magic-Link-Redeem | ~6-8h | `010_invites` + `011_workspace_audit` | `feat/p1-a-invites` |
| **P1.B** | Rollen-UI + RLS-Tightening | Member-Aktionen + Self-Demote-Trigger + RLS-Map verschärfen | ~3-4h | `012_role_constraints` | `feat/p1-b-roles` |
| **P1.C** | Live-Cursor Activity-Level | Realtime-Broadcast `current_focus` + Avatar-Chip-Overlay + Incognito-Toggle | ~3h | — (broadcast-only) | `feat/p1-c-presence` |
| **Phase-1.5** | Off-VPS-Backup (deferred) | Hetzner Storage Box + age + restic + DR-Drill | ~3-4h | — | später |

## Cross-Cutting

### RLS-Tightening-Map (Migration 012)

| Tabelle | Operation | viewer | editor | admin | owner |
|---|---|---|---|---|---|
| `nodes` / `rows` / `cols` / `cells` | SELECT | ✓ | ✓ | ✓ | ✓ |
| | INSERT/UPDATE/DELETE | ✗ | ✓ | ✓ | ✓ |
| `kb_cards` / `kb_cols` / `checklists` / `checklist_items` / `links` / `docs` | SELECT | ✓ | ✓ | ✓ | ✓ |
| | INSERT/UPDATE/DELETE | ✗ | ✓ | ✓ | ✓ |
| `workspace_members` | SELECT | ✓ | ✓ | ✓ | ✓ |
| | INSERT (via `redeem_invite` RPC) | n/a | n/a | n/a | n/a |
| | UPDATE (via `change_member_role` RPC) | ✗ | ✗ | ✓* | ✓ |
| | DELETE (via `remove_member` RPC) | ✗ | ✗ | ✓* | ✓ |
| `workspaces` | UPDATE (Name etc.) | ✗ | ✗ | ✓ | ✓ |
| | DELETE | ✗ | ✗ | ✗ | ✓ |
| `workspace_invites` | SELECT (workspace-weit) | ✗ | ✗ | ✓ | ✓ |
| | INSERT/UPDATE | ✗ | ✗ | ✓ | ✓ |
| `workspace_audit_log` | SELECT | ✗ | ✗ | ✓ | ✓ |
| | INSERT (nur via SECURITY DEFINER) | n/a | n/a | n/a | n/a |
| | UPDATE/DELETE | ✗ | ✗ | ✗ | ✗ (Trigger blockiert) |

`✓*` = admin darf, aber **nicht gegen owner/admin** (kein "admin demotet owner").

### Anti-Patterns

1. **Keine Offline-Queue für Security-Mutations.** `redeemInvite`, `changeMemberRole`, `removeMember`, `revokeInvite` sind zustandsabhängig — Offline-Replay würde Token-Doppel-Use, Race-Conditions, RLS-Fehler erzeugen. Bei Netz-Fehler: sofort `showToast(err, 'error')`. Steht in expliziter Tension mit CLAUDE.md-Prinzip 17 — wird in `lib/safe-mutation.ts`-Header dokumentiert + in Memory `feedback_saas_security_no_offline.md` als Anti-Pattern.
2. **Token-Pfad-Segment statt Query-Param.** `/invite/:token` — Query-Params landen in nginx-Logs, Proxy-Logs, Browser-History, Referer-Headers.
3. **Audit-Insert nur via SECURITY DEFINER RPC**, nie direkt aus Client-Code. Client hat **kein** INSERT-Recht auf `workspace_audit_log`.
4. **Service-Mutations gehen über `supabase.rpc('...')`**, Reads bleiben `supabase.from(...)`.
5. **RLS ≠ Frontend-Filter.** Jede Workspace-scoped Query bekommt explizit `.eq('workspace_id', wsId)` zusätzlich zur RLS-Policy (Memory `feedback_rls_select_filter.md`).
6. **Token gehasht in DB**, klartext nur im Mail-Link. SHA-256 full + erste 8 byte als Lookup-Index. `timingSafeEqual` beim Vergleich. Generic-Error bei jedem Fail (kein "expired" vs "used"-Leak).

### Drift-Probleme (vor Phase-1-Code fixen)

1. `infra/nginx/staging.matrix.levcon.at.conf:92-98` ist Placeholder ("SaaS folgt in Phase 0d") — Live-Conf existiert nur auf VPS. Nächster Deploy würde Live mit Placeholder überschreiben → Settings-Page-Routes wären 404. **Fix vor P1.A** mit `try_files $uri $uri/ /app/index.html;` für tiefe Pfade.
2. `.github/workflows/pr.yml` hat keinen Path-Filter für `infra/supabase/migrations/**` — Migrations-PRs laufen ohne Schema-Smoke. **Fix in P1.A** mit Postgres-Service-Container + 2× Idempotenz-Lauf.
3. `pr.yml:48` baut client-web ohne `VITE_BASE_PATH=/app/`. **Fix in P1.A** beidseitig (PR + Deploy).

### Konvergente Risiken (Security + Deploy)

- Service-Role-Key liegt klartext in `/opt/matrix-bridge/.env`. → P1.0b adressiert (LoadCredential-Pattern).
- `MemoryDenyWriteExecute` deaktiviert in `matrix-bridge.service` (V8-JIT-Kompromiss). → in P1.0b mit aufnehmen.

## Branch + Merge-Strategie

- Sprint-Branch pro Sub-Sprint, kleine Pushes.
- Merge in `main` erst auf explizite User-Freigabe (CLAUDE.md Punkt 9).
- Phase-1-End: alle 5 Sprint-Branches in `main` + Memory `project_phase1_state.md` final aktualisieren.

## Verifikation Phase 1 gesamt

Nach P1.C komplett:

- `pnpm --filter @infinite-matrix/client-web exec tsc --noEmit` grün.
- `biome lint` 0 Errors.
- `pnpm build` (mit `VITE_BASE_PATH=/app/`).
- 3 Playwright-E2E-Smokes grün (invite-flow, role-changes, presence).
- Migration-Idempotenz: alle Migrationen 010-012 zweimal ohne Fehler in CI-Postgres-Service.
- Live-Smoke: zwei User auf staging, kompletter Phase-1-Flow + Audit-Log-Prüfung.
- RLS-Cross-User-psql-Test: User A in Workspace X kann nicht Daten aus Workspace Y lesen.
- Rate-Limit-Test: Brute-Force gegen `/api/invite/accept` → HTTP 429 nach 5 r/min.
- DR-Drill: P1.0-Recovery-Skripte in Test-VM einmal komplett durch + Report `docs/audit/disaster-drill-2026-Q2.md`.

## Open Questions (zur P1.A-Implementation)

- **Custom-Message in Invite-Mail** (UX-Vorschlag): optional Notiz-Feld? Entscheiden bei Implementation.
- **Audit-Log-Retention:** unbegrenzt vs 90d-Auto-Cleanup für `workspace_invites.email` (DSGVO).
- **CSV-Export für Audit-Log:** deferred auf Phase-1.5.
- **Workspace-Slug** (`/w/<slug>` statt `/w/<uuid>`): deferred.

## Quellen

- Plan-Working-File (lokal): `~/.claude/plans/hallo-so-ich-m-chte-streamed-matsumoto.md` (vollständige Details, Agent-Outputs, Decision-Trace).
- Sub-Sprint-Working-Files: `~/.claude/plans/p1-0-emergency-access.md` (vorbereitet), weitere bei Sprint-Start.
- Phase-0-Plan: `docs/plan-backend-phase-0.md`.
- Memory-Anchor: `~/.claude/projects/.../memory/project_phase1_state.md` (laufend aktualisiert).
