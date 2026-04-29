# AU-B1 / Stream A — Schema/SQL/RLS

**Datum:** 2026-04-29
**Scope:** Migrationen 015–023 + 030–036 (15 Dateien)
**Methode:** Code-Reviewer-Agent, Prüfung gegen FORCE-RLS-Pattern (009), Schema-Vier-Artefakte-Regel (checklisten.md), Audit-Coverage (020), SECURITY-DEFINER-Hygiene.

---

## Bewertungs-Übersicht

| Severity | Count |
|---|---:|
| CRITICAL | 1 |
| HIGH | 6 |
| MEDIUM | 4 |
| LOW | 3 |
| INFO | 2 |

---

## Cross-Cutting-Beobachtungen

Migration 030 bricht als einzige die seit 009 durchgehaltene FORCE-RLS-Konvention — alle 6 neuen Tabellen haben nur ENABLE, kein FORCE. Das ist das einzige echte Security-Defizit. Darüber hinaus ist die Schema-Vier-Artefakte-Regel für den Object-Layer (030/033/034/035) hinsichtlich Export nur halb erfüllt: `export.ts` und `subtree-import.ts` kennen weder `objects` noch `groups` noch `soft_groups`. Die Migrationsnummern 024–029 sind nirgendwo dokumentiert, was CI-Workflows und Onboarding-Fehler verursachen kann.

---

## Findings

### [CRITICAL] B1-A-001 — Alle 6 Object-Layer-Tabellen fehlt FORCE ROW LEVEL SECURITY

**File:** `infra/supabase/migrations/030_object_layer.sql:217–222`

**Was:** `objects`, `object_tags`, `groups`, `group_members`, `soft_groups`, `soft_group_members` erhalten nur `ENABLE ROW LEVEL SECURITY`, aber kein `FORCE ROW LEVEL SECURITY`.

**Warum:** Ohne FORCE ist der Tabelleneigentümer (postgres-User, von dem service_role abgeleitet ist) nicht an die RLS-Policies gebunden. Das heißt: jeder Code-Pfad der mit service_role oder als Tabellenowner läuft — einschließlich Bridge-Code, Backup-Scripts, Admin-Queries — umgeht die `is_workspace_member`-/`can_write_workspace`-Policies komplett. Migration 009 hat genau dieses Pattern retroaktiv für alle 13 damaligen Tabellen gefixt und ist dokumentierter Projektstandard. Migration 030 bricht ihn als einzige.

**Fix:**
```sql
ALTER TABLE public.objects            FORCE ROW LEVEL SECURITY;
ALTER TABLE public.object_tags        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.groups             FORCE ROW LEVEL SECURITY;
ALTER TABLE public.group_members      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.soft_groups        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.soft_group_members FORCE ROW LEVEL SECURITY;
```
Entweder als Patch-Migration (031 oder nächste freie Nummer) oder im nächsten Schema-Sprint inline ergänzen.

**Effort:** S
**Regel:** CLAUDE.md „FORCE ROW LEVEL SECURITY" + Migration 009 + B0-rls-rpc-sweep.md Pattern

---

### [HIGH] B1-A-002 — `_ai_master_key()` als IMMUTABLE deklariert, aber nicht immutable

**File:** `infra/supabase/migrations/018_user_ai_providers.sql:42–51` + Patch in `019_security_consistency_patch.sql:39–53`

**Was:** Die Funktion ruft `current_setting('app.ai_master_key', true)` auf. `current_setting()` liefert einen GUC-Wert der sich pro Session/Transaktion ändern kann — das ist kein immutabler Wert. PostgreSQL darf IMMUTABLE-Funktionen aggressiv cachen und Ergebnisse plan-übergreifend wiederverwenden. Wenn der GUC im laufenden Server geändert wird (z.B. `SET LOCAL app.ai_master_key = '...'`), kann Postgres den alten Wert aus dem Cache zurückgeben.

**Warum:** In der Praxis kaum ausnutzbar (der Master-Key wird nicht on-the-fly gewechselt), aber die Deklaration ist falsch und könnte bei zukünftigen Refactorings (Key-Rotation, per-Session-Key-Injection) zu Bugs führen. Korrekte Volatility-Kategorie: `STABLE` (deterministisch innerhalb einer Transaktion, aber nicht cross-Transaktion).

**Fix:**
```sql
CREATE OR REPLACE FUNCTION public._ai_master_key()
RETURNS text
LANGUAGE plpgsql
STABLE  -- nicht IMMUTABLE: current_setting() ist session-abhängig
SET search_path = public, extensions
AS $$ ... $$;
```
Die B0-Patch-Migration 019 hat `search_path` korrekt nachgezogen, aber IMMUTABLE dabei belassen.

**Effort:** S
**Regel:** PostgreSQL-Docs IMMUTABLE/STABLE/VOLATILE Semantik; CLAUDE.md „Messbare Verifikation"

---

### [HIGH] B1-A-003 — `delete_workspace` emittiert kein Audit-Log vor dem CASCADE-Delete

**File:** `infra/supabase/migrations/015_workspace_lifecycle.sql:116–158`

**Was:** `delete_workspace()` löscht die Workspace-Row via `DELETE FROM public.workspaces WHERE id = p_workspace_id`. Das CASCADE-löscht auch `workspace_audit_log`. Es gibt keinen Audit-Eintrag in einem workspace-unabhängigen System-Log. Der Migrations-Header (Z. 32–34) dokumentiert das explizit: „Kein Audit-Insert: der gesamte workspace_audit_log wird mitgelöscht."

Der B0-Coverage-Report (Zeile 26) listet `workspace.deleted` als bereits existierenden Action-String auf — das stimmt nicht. Dieser String existiert nirgendwo in den Migrationen.

**Warum:** Forensik-Anforderung: ein Owner kann einen Workspace löschen und es gibt keinerlei überprüfbare Spur — weder wer gelöscht hat, noch wann. Bei Kompromittierung eines Owner-Accounts ist Post-Mortem nicht möglich. Die Formulierung „Forensik-Wunsch wäre ein cross-workspace system_audit_log (eigener Sprint)" ist richtig, sollte aber als HIGH-offenes Item im Tracking stehen, nicht nur als Kommentar.

**Fix:** Kurzfristig: einen `system_audit_log`-Eintrag (workspace-unabhängig) vor dem DELETE schreiben. Mittelfristig: eigene Tabelle `public.system_audit_log` ohne `workspace_id`-FK.

**Effort:** M
**Regel:** CLAUDE.md Arbeitsprinzip 7 (Datenhoheit), B0-audit-log-coverage.md Forensik-Anforderung

---

### [HIGH] B1-A-004 — `ai_call_log` fehlen explizite UPDATE/DELETE-Block-Policies

**File:** `infra/supabase/migrations/018_user_ai_providers.sql:281–289`

**Was:** `ai_call_log` hat:
- `ai_call_log_self_read` (SELECT, auth.uid() = user_id) ✓
- `ai_call_log_no_user_writes` (INSERT, WITH CHECK false) ✓
- Keine explizite UPDATE-Policy
- Keine explizite DELETE-Policy

**Warum:** Mit FORCE RLS und ohne permissive UPDATE/DELETE-Policy sind diese Operationen de facto blockiert (PostgreSQL deny-by-default bei fehlendem Match). Das ist korrekt im Sinne des Ergebnisses, aber inkonsistent zum Projekt-Standard: alle anderen „schreiben nur via RPC"-Tabellen (`user_ai_providers`, `workspace_audit_log`, `workspace_invites`) haben explizite Block-Policies für jeden verbotenen Pfad. Wenn jemand später eine permissive UPDATE-Policy für einen anderen Zweck hinzufügt, fehlt der sichtbare Widerstand.

Hinweis: Selbst mit den Lücken liegt kein aktiver RLS-Bypass vor, da FORCE aktiv ist.

**Fix:**
```sql
DROP POLICY IF EXISTS ai_call_log_no_user_updates ON public.ai_call_log;
CREATE POLICY ai_call_log_no_user_updates ON public.ai_call_log
  FOR UPDATE USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS ai_call_log_no_user_deletes ON public.ai_call_log;
CREATE POLICY ai_call_log_no_user_deletes ON public.ai_call_log
  FOR DELETE USING (false);
```

**Effort:** S
**Regel:** B0-rls-rpc-sweep.md Pattern (explicit Block-Policy for RPC-only-write Tabellen)

---

### [HIGH] B1-A-005 — Numerische Lücke 024–029 vollständig undokumentiert

**File:** `infra/supabase/migrations/` — zwischen `023_create_workspace_rpc.sql` und `030_object_layer.sql`

**Was:** Sechs Migrationsnummern (024, 025, 026, 027, 028, 029) existieren nicht. Weder in der Migration-Dateiliste noch in README, noch in einem anderen Dokument ist erklärt, warum die Nummerierung von 023 auf 030 springt.

**Warum:** Supabase wendet Migrationen in Dateinamen-Reihenfolge an. Wenn in Zukunft CI-Scripts, Deployment-Checks oder ein anderer Entwickler prüft, ob alle erwarteten Migrationen vorhanden sind (z.B. durch Zählen oder Gap-Detection), wird die Lücke fälschlicherweise als Fehler interpretiert. Oder schlimmer: jemand verwendet 024–029 für neue Sprints und erzeugt einen Ordering-Conflict auf Systemen wo 030 bereits angewendet wurde. Das Supabase-CLI (`supabase db diff`) könnte die Lücke auch als Fehler melden.

**Fix:** Minimal: `infra/supabase/README.md` oder ein `infra/supabase/migrations/GAPS.md` mit: „Nummern 024–029 wurden übersprungen. Hintergrund: [Grund, z.B. reserviert für abgebrochene Sprints / bewusstes Spacing]." Besser: konsequente Nummerierung von Anfang an, aber das ist im Nachhinein nicht mehr rückgängig zu machen.

**Effort:** S
**Regel:** CLAUDE.md Migration-Header-Doku-Anforderung (Punkt 6 der Audit-Prüfung)

---

### [HIGH] B1-A-006 — Export/Import kennt weder Objects noch Groups (Schema-Vier-Artefakte-Lücke)

**File:** `packages/client-web/src/lib/export.ts:124–186` + `packages/client-web/src/lib/export.ts:238–317`

**Was:** `exportWorkspace()` und `fetchWorkspaceRowsForExport()` laden die Tabellen `objects`, `object_tags`, `groups`, `group_members`, `soft_groups`, `soft_group_members` nicht. Der `WorkspaceExport`-Typ hat kein entsprechendes Feld. `subtree-import.ts` kennt diese Tabellen ebenfalls nicht.

Die in Migrations 030/033/034/035 eingeführten FKs `rows.object_id`, `cols.object_id`, `kb_cols.object_id`, `nodes.object_id` zeigen in das Object-Layer. Ein Export via `select('*')` zieht zwar die UUID-Felder mit, aber ohne die `objects`-Tabelle selbst im Export sind die IDs beim Import in einen anderen Workspace wertlos (Fremd-UUIDs zeigen ins Leere).

**Warum:** Laut Schema-Vier-Artefakte-Regel (CLAUDE.md Memory `feedback_schema_quad.md`, checklisten.md Trigger „Strukturelle Änderung") ist Export/Import gleichrangig zu Schema + Mutations + MCP. Migration 030 selbst erwähnt: „Mutations + MCP + Export folgen in O.2/O.3" — aber diese Nachlieferung fehlt bislang. Die `object_id`-FKs in rows/cols/nodes machen jeden Workspace-Export heute zu einem Partial-Export mit stillen Datenlücken.

**Fix:** `WorkspaceExport`-Shape um `objects`/`object_tags`/`groups`/`group_members` erweitern; `exportWorkspace()` lädt diese Tabellen parallel; Import remappt UUIDs via separater `objects`-Remap-Map (analog zu nodeIdMap, cellIdMap). `soft_groups`/`soft_group_members` können bewusst ausgelassen werden (ephemer, 60-Tage-TTL — aber das muss dokumentiert sein).

**Effort:** L
**Regel:** CLAUDE.md Memory `feedback_schema_quad.md`; checklisten.md „Trigger: Strukturelle Änderung"

---

### [HIGH] B1-A-007 — `_mcp_assert_writer` nicht als SECURITY DEFINER deklariert, wird aber aus SECURITY-DEFINER-Kontext aufgerufen

**File:** `infra/supabase/migrations/021_mcp_tools.sql:124–143`

**Was:** `_mcp_assert_writer` ist als normale (non-SECURITY-DEFINER) Funktion mit `STABLE` deklariert. Alle aufrufenden MCP-RPCs sind SECURITY DEFINER. Wenn ein SECURITY-DEFINER-RPC `_mcp_assert_writer` aufruft, läuft diese Helper-Funktion im Security-Context des SECURITY-DEFINER-Aufrufers (d.h. als Funktionseigentümer), nicht als der authentifizierte User.

Konkret: `auth.uid()` wird in `_mcp_assert_writer` aufgerufen, aber `workspace_role_of()` ist selbst SECURITY DEFINER und liest intern `auth.uid()`. Da `workspace_role_of` korrekt implementiert ist (liest JWT-Context), funktioniert der Role-Check de facto korrekt. Jedoch ist das ein fragiles Muster: es hängt davon ab, dass `auth.uid()` im SECURITY-DEFINER-Kontext den JWT des Original-Callers zurückgibt (was in Supabase/PostgREST der Fall ist, weil der JWT-Context als GUC gesetzt wird, nicht als DB-Rolle).

**Warum:** Dies ist kein aktiver Bug in der aktuellen Supabase-Konfiguration, aber ein Design-Risiko: bei anderen Postgres-Setups (Self-Hosted ohne PostgREST-JWT-GUC) könnte `auth.uid()` in einem SECURITY-DEFINER-Kontext NULL zurückgeben. Der explizite `auth.uid() IS NULL`-Check am Anfang von `_mcp_assert_writer` wäre dann immer erfüllt und würde 'unauthenticated' werfen — was die API bricht aber sicher ist. Allerdings wäre es auch möglich, dass `auth.uid()` den Owner-User statt den aufgerufenen User zurückgibt.

**Fix-Option A (empfohlen):** `_mcp_assert_writer` als `SECURITY DEFINER` deklarieren. Der `auth.uid()`-Check und `workspace_role_of`-Call laufen dann explizit im Definer-Kontext mit JWT-GUC.

**Fix-Option B:** Im Header der Funktion einen klaren Kommentar ergänzen: „Funktioniert korrekt weil Supabase JWT-Claims als GUC setzt; in Non-Supabase-Setups ggf. als SECURITY DEFINER redefinieren."

**Effort:** S
**Regel:** B0-rls-rpc-sweep.md Abschnitt SECURITY DEFINER RPCs; CLAUDE.md Arbeitsprinzip 1 (Wurzel finden, nicht Symptom unterdrücken)

---

### [MEDIUM] B1-A-008 — `object_backlinks_v` ohne `security_invoker`-Deklaration

**File:** `infra/supabase/migrations/035_object_detail.sql:295–357`

**Was:** `object_backlinks_v` ist eine plain `CREATE OR REPLACE VIEW` ohne `WITH (security_invoker = true)`. Der Kommentar (Z. 293–294) sagt: „RLS ueber underlying-Tabellen". Das stimmt in PostgreSQL 15+ nur für Views mit `security_invoker = true`. Ohne diese Option läuft die View im Security-Context des View-Eigentümers (security-definer-Verhalten für Views), und RLS der unterliegenden Tabellen wird mit den Rechten des View-Owners ausgewertet — nicht des aufrufenden Users.

Im Supabase-Stack ist der View-Owner typischerweise `postgres` (BYPASSRLS). Das bedeutet: die RLS-Checks auf `rows`, `cols`, `kb_cols`, `nodes`, `objects` werden **nicht** durchgesetzt, wenn ein authenticated User die View abfragt.

**Warum:** Das ist ein tatsächlicher RLS-Bypass über die View für alle authenticated User — sie können Backlinks aus Workspaces sehen, in denen sie keine Mitglieder sind. Das Projekt-Pattern (Migration 018, `user_ai_providers_safe`) verwendet korrekt `WITH (security_invoker = true)`.

**Fix:**
```sql
CREATE OR REPLACE VIEW public.object_backlinks_v
  WITH (security_invoker = true) AS
  -- ... (bestehender Body unverändert)
```

**Effort:** S
**Regel:** Migration 018 Pattern (`user_ai_providers_safe` mit `security_invoker = true`); PostgreSQL-Docs View Security

---

### [MEDIUM] B1-A-009 — Migration 036 wrapped in `BEGIN`/`COMMIT` — kollidiert mit Supabase-Migration-Runner

**File:** `infra/supabase/migrations/036_label_templates.sql:25` + `036_label_templates.sql:258`

**Was:** Migration 036 beginnt mit `BEGIN;` (Z. 25) und endet mit `COMMIT;` (Z. 258). Alle anderen Migrationen (015–035) haben kein explizites Transaction-Management.

**Warum:** Der Supabase-CLI-Migration-Runner wrappt jede Migration automatisch in eine Transaktion. Ein explizites `BEGIN`/`COMMIT` innerhalb einer bereits laufenden Transaktion erzeugt in PostgreSQL eine verschachtelte Transaktion (Savepoint-Semantik), was im Supabase-Runner zu einem Fehler führen kann: `ERROR: there is already a transaction in progress`. Bei einigen Postgres-Versionen / Runner-Konfigurationen wird das als Warning behandelt und das `COMMIT` schließt die innere Pseudo-Transaktion, nicht die äußere — was de facto korrekt ist. Bei anderen Konfigurationen kann es den Runner in einen inkonsistenten Zustand bringen.

Zusätzlich: Die DO-$$-Blöcke in Z. 39–51, 61–73, 88–100 sind idempotent via `IF NOT EXISTS`-Check, aber das explizite `BEGIN`/`COMMIT` ist redundant und führt zu Inkonsistenz mit den anderen 14 Migrationen.

**Fix:** `BEGIN;` und `COMMIT;` aus 036 entfernen.

**Effort:** S
**Regel:** Konsistenz mit Migrationen 015–035; Supabase-CLI-Dokumentation

---

### [MEDIUM] B1-A-010 — `mcp_search_objects` ignoriert `p_limit` wenn Wert < 1

**File:** `infra/supabase/migrations/033_object_rpcs.sql:178–179`

**Was:**
```sql
LIMIT GREATEST(p_limit, 1);
```
Das Clampen auf `min 1` ist korrekt dokumentiert im COMMENT. Aber: es gibt keine Obergrenze. Ein LLM-Tool-Call könnte `p_limit = 10000` übergeben und die gesamte `objects`-Tabelle eines großen Workspaces zurückgeben. Da die Funktion über einen SECURITY-DEFINER-RPC für alle `authenticated` User zugänglich ist, ist das ein potenzielles Performance/Volume-Angriffsszenario.

**Fix:**
```sql
LIMIT GREATEST(LEAST(COALESCE(p_limit, 8), 50), 1);
```
Clamp auf max 50 (oder eine andere sinnvolle Grenze). Dokumentation im COMMENT anpassen.

**Effort:** S
**Regel:** CLAUDE.md Arbeitsprinzip 1 (Praktikabilität); Best Practice für paginierte RPC-APIs

---

### [MEDIUM] B1-A-011 — Label-Template-Export enthält keine `objects`-Dereferenzierung — stille Datenverluste beim Import

**File:** `packages/client-web/src/lib/export.ts:143–153` (nodes/docs/checklists via `select('*')`)

**Was:** `select('*')` zieht zwar `label_template` und `title_template` mit (kein Feldlisten-Problem). Aber `label_template` kann dynamische Platzhalter enthalten: `{row.object}`, `{column.object}`. Nach einem Import in einen anderen Workspace zeigen die `object_id`-FKs in rows/cols auf UUIDs, die in dem neuen Workspace nicht existieren. Der Template-Resolver (`lib/label-template.ts`) fällt in diesem Fall auf `row.label`/`col.label` zurück — kein Crash, aber das Template rendert falsch bis die Object-Layer-Daten (B1-A-006) mitimportiert werden.

**Warum:** Nicht isoliert fixbar ohne B1-A-006 zu lösen. Das Finding dokumentiert die Abhängigkeit: B1-A-006 ist Voraussetzung für korrektes Template-Import-Verhalten.

**Fix:** Teil des B1-A-006-Fixes: beim Import den `object_id`-FK in rows/cols über die objects-Remap-Map durchreichen.

**Effort:** (inkl. in B1-A-006)
**Regel:** checklisten.md „Neuer FK: Remap-Map um das Feld erweitern"

---

### [LOW] B1-A-012 — Sammelfinding: Inkonsistente Migration-Header-Dokumentation

**Files:**
- `016_node_created_by.sql:1` — Header ohne `═══`-Rahmen (alle anderen Migrationen außer 016 haben ihn)
- `022_log_ai_call.sql:1` — Header kürzer, fehlt Referenz auf Phase/Plan-Dokument
- `023_create_workspace_rpc.sql:1` — hat vollständigen `═══`-Rahmen ✓

**Was:** Drei der 15 Migrationen weichen vom etablierten Header-Format ab (langer `═══`-Rahmen + Was/Warum/Phase-Referenz).

**Fix:** Stilanpassung der Header — keine funktionalen Auswirkungen.

**Effort:** S
**Regel:** Audit-Punkt 6 (Migration-Header-Doku); CLAUDE.md Konsistenzgebot

---

### [LOW] B1-A-013 — `mcp_create_object` schreibt `home_ref_id = NULL` ohne Validierung gegen unbekannte `home_ref_kind`

**File:** `infra/supabase/migrations/033_object_rpcs.sql:65–73`

**Was:** `home_ref_kind` und `home_ref_id` werden unvalidiert in die Tabelle geschrieben. Es gibt keinen Check, ob `home_ref_kind` zu einem existierenden Eintrag in der entsprechenden Tabelle passt (der FK ist polymorph / kein DB-FK). Ein LLM-Tool könnte `home_ref_kind = 'row'` mit `home_ref_id = <uuid einer Node>` setzen — semantisch falsch, kein DB-Fehler.

**Fix:** Optionale Validierung: wenn `home_ref_id IS NOT NULL AND home_ref_kind IS NOT NULL`, prüfen ob der Eintrag in der korrekten Tabelle existiert. Oder im Kommentar explizit dokumentieren dass kein DB-FK existiert und Caller verantwortlich ist.

**Effort:** S
**Regel:** CLAUDE.md Arbeitsprinzip 10 (Messbare Verifikation)

---

### [LOW] B1-A-014 — `soft_groups` und `soft_group_members` nicht in Realtime-Publication

**File:** `infra/supabase/migrations/030_object_layer.sql` — keine `ALTER PUBLICATION`-Anweisung für neue Tabellen

**Was:** `objects`, `object_tags`, `groups`, `group_members`, `soft_groups`, `soft_group_members` werden nicht zur Realtime-Publication (aus Migration 005) hinzugefügt. `nodes`, `rows`, `cols`, `cells` etc. sind alle publiziert.

**Warum:** Bei Multi-User-Awareness (zwei User arbeiten gleichzeitig) sehen Browser-Clients keine Live-Updates wenn ein anderer User ein Object anlegt/umbenennt oder einer Gruppe hinzufügt. Das ist bewusst akzeptierbar in Phase 3 (Single-User-Focus), aber sollte dokumentiert sein. Für `objects` speziell ist es relevant: das Autocomplete-Dropdown (`mcp_search_objects`) würde bei einem parallelen Object-Create des anderen Users erst nach Reload aktualisieren.

**Fix:** Dokumentation in 030 ergänzen: „Realtime bewusst NICHT publiziert — Phase 3 Single-User-Scope. Für Multi-User: `ALTER PUBLICATION supabase_realtime ADD TABLE public.objects;` in separatem Sprint." Kein funktionales Fix nötig.

**Effort:** S
**Regel:** B0-rls-rpc-sweep.md Abschnitt Realtime-Publication-Drift

---

### [INFO] B1-A-015 — `_mcp_resolve_workspace` fehlt GRANT für direkte Verwendbarkeit

**File:** `infra/supabase/migrations/021_mcp_tools.sql:85–120`

**Was:** `_mcp_resolve_workspace`, `_mcp_validate_label`, `_mcp_validate_alias` haben kein `GRANT EXECUTE TO authenticated`. Sie werden ausschließlich aus SECURITY-DEFINER-Funktionen aufgerufen (die mit dem Eigentümer-Kontext laufen und daher automatisch Ausführungsrechte haben). Als Helper-Funktionen mit `_`-Prefix ist das korrekt — kein direktes GRANT nötig.

**Warum gelistet:** Zur Klarstellung für zukünftige Reviewer — der fehlende GRANT ist bewusstes Design, nicht Vergessen.

**Effort:** None
**Regel:** n/a — bewusstes Design-Pattern

---

### [INFO] B1-A-016 — `workspace.deleted` in B0-Coverage-Report falsch als „existierend" gelistet

**File:** `docs/audit/B0-audit-log-coverage.md:26`

**Was:** Der B0-Coverage-Report (Zeile 26) listet `workspace.deleted` als existierenden Action-String in `workspace_audit_log` auf. Eine Grep-Suche über alle Migrationen (`015_workspace_lifecycle.sql`, alle anderen) findet diesen String nirgendwo. `delete_workspace()` schreibt bewusst keinen Audit-Eintrag (Header Z. 32–34 erklärt warum).

**Warum:** Der Report-Eintrag ist ein redaktioneller Fehler — jemand hat den geplanten String bereits als implementiert gelistet. Dies ist der Hintergrund für B1-A-003 (das tatsächliche Finding).

**Fix:** B0-Coverage-Report korrigieren: `workspace.deleted` aus der „IST-Stand vor 020"-Liste entfernen oder mit Hinweis „geplant, nicht implementiert — Forensik-Lücke" markieren.

**Effort:** S
**Regel:** Dokumentations-Konsistenz

---

## Zusammenfassung Top-Prioritäten

| Prio | ID | Severity | Effort | Kurztitel |
|---|---|---|---|---|
| 1 | B1-A-001 | CRITICAL | S | FORCE RLS auf 6 Object-Layer-Tabellen fehlt |
| 2 | B1-A-008 | MEDIUM | S | `object_backlinks_v` ohne `security_invoker` — RLS-Bypass |
| 3 | B1-A-006 | HIGH | L | Export/Import kennt Objects/Groups nicht |
| 4 | B1-A-003 | HIGH | M | `delete_workspace` ohne System-Audit-Spur |
| 5 | B1-A-002 | HIGH | S | `_ai_master_key` falsch als IMMUTABLE |
| 6 | B1-A-009 | MEDIUM | S | `BEGIN`/`COMMIT` in Migration 036 |
| 7 | B1-A-005 | HIGH | S | Lücke 024–029 undokumentiert |
| 8 | B1-A-004 | HIGH | S | `ai_call_log` fehlen UPDATE/DELETE-Block-Policies |
