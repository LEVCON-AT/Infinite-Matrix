# Migration-Nummern — Lücken-Dokumentation

> AU-B1 K11a (B1-A-005 / B1-G-014 / CC10): Die Lücke zwischen `023_create_workspace_rpc.sql` und `030_object_layer.sql` ist bewusst, damit Code-Review-Hinweise hier landen statt CI-Gap-Detection-Fehler zu erzeugen.

## Übersicht

| Nummer | Status | Hintergrund |
|---|---|---|
| `024` – `029` | bewusst übersprungen | reservierte Slots, nicht angewendet |
| `030_object_layer.sql` | live | Phase 3 O.1 — Object-Layer Schema-Foundation |
| `031`, `032` | übersprungen | siehe unten |
| `033_object_rpcs.sql` | live | O.2a — MCP-RPC-Family für Object-CRUD |
| `034_group_rpcs.sql` | live | O.3 — Group + SoftGroup-Operationen |
| `035_object_detail.sql` | live | O.4.A — Backlinks-View + Detail-Resolver |
| `036_label_templates.sql` | live | O.8.A — label_template / title_template |
| `037_b1_security_patch.sql` | live | AU-B1 K1 — FORCE RLS + REVOKE EXECUTE + Block-Policies |
| `038_b1_security_patch_2.sql` | live | AU-B1 K9 — _mcp_assert_writer SECURITY DEFINER + memberships-Policy |
| `039_system_audit_log.sql` | live | AU-B1 K11a — Workspace-Delete-Forensik |

## Begründung der Lücken

**024–029:** Während Welle A (KI-First, 28.04.) waren mehrere Sprints in Planung — die Nummern wurden zugeteilt, aber die jeweiligen Migrationen sind nicht entstanden:
- `024` – Edge-Function-Hooks für Provider-Test (von `set_ai_provider` integriert, separate Migration nicht nötig)
- `025` – workspace_invitations-Erweiterung um `oauth_provider_hint` (defer auf Welle B)
- `026` – `mcp_call_log`-Aggregat-View (per `ai_call_log` direkt gequeryt, keine View nötig)
- `027`-`029` – nicht zugeteilt

**031, 032:** Während Welle O (Object-Layer, 28.04.):
- `031` – `objects.last_seen_at` Tracking (defer auf Phase-3-Polish, nicht kritisch)
- `032` – `object_attrs` JSON-Schema-Validation (defer)

## Konsequenz für Tooling

- **Supabase-CLI**: wendet Migrations in Dateinamen-Reihenfolge an. Lücken werden ignoriert.
- **`supabase-migrate.sh`**: verwendet Glob `*.sql`, keine Gap-Detection.
- **CI (pr.yml)**: kein Gap-Check aktiv.

Falls in Zukunft ein Tool eingeführt wird, das Lücken als Fehler interpretiert: dieses Dokument zeigt, dass die fehlenden Nummern bewusst sind.

## Nicht wiederverwenden

Die übersprungenen Nummern dürfen **nicht** für neue Migrationen genutzt werden — Production-DBs haben die `038`/`039`-Migrationen bereits angewendet. Eine nachträgliche `024_*.sql` würde lexikographisch vor `030_*.sql` einsortiert und beim nächsten `supabase-migrate.sh`-Lauf neu ausgeführt — Idempotenz-Bruch-Risiko.

Neue Migrationen ab `040` aufwärts.
