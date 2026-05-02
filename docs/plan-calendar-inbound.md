# Plan: Calendar-Inbound (Welle I)

**Status:** V1 fertig (I.1–I.9 + I.12). I.10 (Google OAuth Push) + I.11 (Microsoft Graph Push) sind als Adapter-Stubs vorhanden, deferred zu V2.

## Kontext

Outbound (Matrix → externe Calendars) war ab V1 Subscribe-Feed live: `lib/calendar-export.ts` (One-Shot ICS-Export) + Migration 058 + `infra/services/calendar-feed/` (Live-ICS-Feed mit Token-URL). Welle I ist die **Inverse**: externe Kalender (Outlook/Google/Apple/Nextcloud/Mailcow) sollen IN Matrix fliessen, importierte Termine sollen sichtbar im Calendar erscheinen, und vor allem als Quelle fuer Tasks und weitere Manifestationen dienen — entlang Atom-Zwiebel-Modell (`docs/claude/architektur.md §1`).

User-Decisions vorab:

- **V1-Scope: alle drei Kanaele parallel** — ICS-Subscribe (Pull-URL), Google + Microsoft OAuth (Push), ICS-Upload (One-Shot). In V1 sind ICS-Subscribe + Upload vollstaendig; Google + MS sind Stubs (V2).
- **Tasks-Ableitung: User-Wahl pro Ableitung** — Snapshot (one-shot Copy) vs. Live verbunden. Recurring-Scope (Instanz vs. Serie) und Multi-Day-Behandlung als first-class Modal-Optionen.
- **Sync-Intervall einstellbar** — pro Calendar 5min..24h, default 15min.

## Architektur-Entscheidungen

1. **Neuer atom_type='imported_event'** als 5. Wert im Enum (Migration 059). Eigene Source-Tabelle `external_events` (analog `tasks`/`links`/`docs`/`checklists`). Polymorpher Cascade-Trigger nach Pattern aus Migration 044.
2. **Provider-Vielfalt mit einheitlicher Storage** — `external_calendars` mit `kind`-Diskriminator (`ics_subscribe` / `google` / `microsoft` / `upload`). OAuth-Tokens at-rest verschluesselt mit `pgp_sym_encrypt(..., app.ai_master_key)` (Pattern aus `user_ai_providers`).
3. **Workspace × User Scope** — Calendar-Verbindungen sind workspace-scoped: derselbe User kann „Outlook-Privat" in Workspace A einbinden, aber nicht in Workspace B. RLS auf `user_id + workspace_id`.
4. **Sync-Pfad** — Node-Service `calendar-inbound-sync` (Pattern wie `webhook-dispatcher`). LISTEN/NOTIFY `calendar_sync_due` fuer „Pull-jetzt"-Knopf. Cron-Loop alle 60s liest `list_due_external_calendars()` und syncs Calendars deren `last_sync_at < now() - sync_interval_minutes`. Webhook-Endpoints fuer Google/MS Push (V2).
5. **Visual-Discrimination** — `display_meta.source_provider` + `display_meta.source_color` (User-waehlbar). Calendar-Chip rendert farbigen `border-left` + Provider-Icon. Filter-Toggle „Importierte Termine" in Calendar-Toolbar (persistiert in localStorage).
6. **Tasks-Ableitung mit User-Wahl** — `DeriveTaskModal` zeigt: Sync-Mode (Snapshot/Live), Recurring-Scope (Instanz/Serie), Multi-Day-Behandlung (V1 nur Single-Task, V2 deferred Per-Day). Verbindung via `tasks.derived_from_external_event_id` + `tasks.derive_sync_mode` + `tasks.derive_scope`.
7. **Live-Sync Konflikt-Resolution** — Worker UPDATE'et `tasks.{label, note, deadline, recur}` aus Event-Update; Felder die der User editiert hat (`tasks.local_overrides`) werden **nicht** ueberschrieben. Trigger `_tasks_track_local_overrides` markiert User-Edits automatisch; der Sync-Worker setzt session-setting `tasks.from_external_sync='on'` damit sein eigener UPDATE nicht als „User-Edit" missverstanden wird.

## Build-Sequence + Status

| # | Sprint | Inhalt | Status |
|---|---|---|---|
| 1 | **I.1** | Migration 059 — atom_type Enum-Extend + external_calendars + external_events + Cascade-Trigger + Mirror-Trigger + tasks-FK + Realtime | ✅ |
| 2 | **I.2** | Migration 060 — RPCs (create/update/delete/trigger_sync/import_ics/derive_task) + Service-Helper (get_credentials/update_credentials/upsert_event_batch/mark_orphaned/live_sync_derived) | ✅ |
| 3 | **I.3** | `infra/services/calendar-inbound-sync/` — index.ts (LISTEN + Cron + Webhook-Endpoint) + adapters/ics-subscribe.ts (node-ical + Conditional GET) + Stubs adapters/google.ts + adapters/microsoft.ts | ✅ |
| 4 | **I.4** | systemd-Unit `matrix-calendar-inbound.service` + nginx-Snippet `infra/nginx/snippets/calendar-inbound.conf` + .env.example + README | ✅ |
| 5 | **I.5** | `lib/calendar-inbound.ts` (Client-API) + `lib/types.ts` ExternalCalendar/ExternalEvent + `lib/offline-cache.ts` TABLES + DB_VERSION=9 + `lib/atom-manifestations.ts` AtomKind erweitert + `lib/ics-parser.ts` (Mini-RFC-5545-Parser fuer Upload-Preview) | ✅ |
| 6 | **I.6** | `routes/settings/AccountCalendars.tsx` (Liste + Pull-Now + Color-Picker + Sync-Intervall-Select + Toggle + Loeschen) + `components/AddExternalCalendarModal.tsx` (4 Tabs ICS-URL / Upload / Google / Microsoft) + Settings-Subnav-Eintrag | ✅ |
| 7 | **I.7** | `routes/Calendar.tsx` Filter-Toggle „Importierte Termine" + `lib/calendar.ts` `buildEvents` erweitert um `imported_event` + Calendar-Chip border-left in `source_color` + Provider-Icon | ✅ |
| 8 | **I.8** | `components/ImportedEventDetailModal.tsx` (Read-only Snapshot + Aktions-Section) + `components/DeriveTaskModal.tsx` (Snapshot/Live + Recurring-Scope + Multi-Day-Hinweis) + `lib/imported-event-modal-state.ts` global state + `lib/atom-routing.ts` `case 'imported_event'` | ✅ |
| 9 | **I.9** | DB-Trigger `_tasks_track_local_overrides` (Migration 059) + `live_sync_derived_tasks`-RPC (Migration 060) + Sync-Worker ruft `eventIdsForLiveSync` + `liveSyncDerived` (I.3) + TaskDetail-Banner „Aus externem Termin abgeleitet" | ✅ |
| 10 | **I.10** | Google OAuth Adapter + Watch-Channel + Push-Webhook-Endpoint + 7d-Renew-Cron | ⏸ deferred V2 |
| 11 | **I.11** | Microsoft Graph Adapter + Subscription + Push-Webhook + 3d-Renew-Cron | ⏸ deferred V2 |
| 12 | **I.12** | docs/plan-calendar-inbound.md + docs/claude/architektur.md §1 erweitert + Smoke-Verifikations-Liste | ✅ |

## Verifikation

### Migration-Apply (User-required: supabase_admin)

```bash
docker exec -it matrix-supabase-db psql -U supabase_admin -d postgres -f infra/supabase/migrations/059_calendar_inbound.sql
docker exec -it matrix-supabase-db psql -U supabase_admin -d postgres -f infra/supabase/migrations/060_calendar_inbound_rpcs.sql
```

### Smoke-Sequence

1. **Schema-Quad** ist konsistent:
   - `\dT atom_type` zeigt 5 Werte
   - `\d external_calendars` + `\d external_events` zeigt RLS aktiviert
   - Trigger `_imported_event_mirror_to_atom_manif` + `_tasks_track_local_overrides` existieren
2. **Service-Deploy** (`infra/services/calendar-inbound-sync/README.md`):
   - `curl -sS http://127.0.0.1:8083/healthz` → `ok`
   - `journalctl -u matrix-calendar-inbound -f` zeigt LISTEN-Log
3. **ICS-Subscribe E2E**:
   - In Outlook „Kalender veroeffentlichen" → ICS-URL kopieren
   - Settings → Konto → Externe Kalender → ICS-URL-Tab → Submit
   - Nach <15min ODER „Sync"-Knopf: Calendar-View zeigt Termine mit blauer `border-left`
4. **ICS-Upload E2E**:
   - 50-Event-`.ics` herunterladen → File-Upload-Tab → Preview zeigt erste 5 → „N Termine importieren" → Toast + Calendar-View aktualisiert
5. **Recurring**: weekly RRULE Outlook-Termin abonnieren → expandiert via existing `recurFiresOn` (selber Code-Pfad wie Tasks)
6. **Multi-Day**: 3-taegiger Termin → Calendar-Range-Render ueber 3 Tage
7. **Task-Ableitung Snapshot**: ImportedEventDetailModal → „Task ableiten" → DeriveTaskModal Default → Submit → Task-Detail zeigt „Aus externem Termin abgeleitet (Snapshot)"-Banner; Outlook-Termin verschieben → Task BLEIBT alt
8. **Task-Ableitung Live**: Modal → „Live verbunden" → Submit → Banner zeigt grueneren Border + „live verbunden"-Badge; Outlook-Termin verschieben → naechster Sync verschiebt Task mit; Eigene Note am Task → bleibt erhalten beim naechsten Sync
9. **Drag-to-Manifestation USP**: Imported-Event auf Sidebar-Calendar-Tag droppen → `dropAtomOnDate({atomType:'imported_event', ...})` → atom_manifestation kind='calendar' an neuem Tag — selber Code-Pfad wie fuer Tasks. Beweis Atom-Zwiebel-Treue.
10. **Visual-Discrimination**: Filter-Toggle „Importierte Termine" aus → imported_event-Chips ausgeblendet
11. **RLS**: User-Workspace-Cross-Check — kein Leak `external_calendars` zwischen Workspaces

## Offene V2-Punkte

- **Google + Microsoft OAuth Push** (I.10/I.11) — Echtzeit statt 15min-Polling. Stubs sind vorhanden; nur Adapter-Implementierung fehlt.
- **Per-Day-Tasks bei Multi-Day** — `tasks.deadline_end`-Schema + UI-Toggle in DeriveTaskModal.
- **CalDAV-Native** (Apple iCloud / Nextcloud bidirektional) — V3.
- **Bidirektional schreiben** (Matrix-Tasks → Outlook-Termin) — V2, separate Welle.
- **Konflikt-UI bei Live-Sync** — Inline-Action „Externer Termin verschoben — nachziehen?".
- **Webhook-Channel-Renew-Cron** (Google 7d / MS 3d) — sobald I.10/I.11 live sind.
- **`imported_event` in Workspace-Export/Import** — aktuell Sync-only, sollte fuer Backup-Export ergaenzt werden.

## Architektur-Korrektur

`docs/claude/architektur.md §1` wurde erweitert: Atom-Zwiebel-Diskriminator nun `enum('task','link','doc','checklist','imported_event')`. `display_meta.source_provider` + `display_meta.source_color` als Provider-Snapshot fuer Visual-Discrimination.
