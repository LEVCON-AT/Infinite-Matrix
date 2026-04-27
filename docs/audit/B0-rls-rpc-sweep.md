# B0 — RLS + RPC-Konsistenz-Sweep

**Datum:** 2026-04-28
**Branch:** feat/backend-polish-rls-audit
**Migrations:** 019_security_consistency_patch.sql

## Auftrag

Backend-Polish-Welle 1 (siehe `docs/plan-user-backend.md` → Polish-Tasks).
Nach Abschluss von A.0 (AI-Provider-Keys) den gesamten DB-Layer auf vier
Kriterien pruefen:

1. Tabellen-RLS-Pflicht: ENABLE + FORCE + alle CRUD-Policies (oder
   explicit-Block-Policy wo nicht erlaubt).
2. SECURITY DEFINER-RPCs: `SET search_path` + auth.uid()-Check + GRANT.
3. Backwards-Compat-Drift: wurden alte Tabellen aus 001-008 nachtraeglich
   um RLS ergaenzt?
4. Realtime-Publication-Drift: fehlen neuere Tabellen in der
   Realtime-Publication?

## Ergebnis (Kurz)

**Stack ist sehr konsistent.** Von 18 Migrationen + 18 Tabellen + 19
SECURITY DEFINER RPCs sind nur **2 defensive Mini-Defizite** offen, beide
ohne sicherheitskritische Auswirkung:

| # | Befund | Severity |
|---|---|---|
| 1 | `public.urlsafe_b64encode(bytea)` (Migration 011) ohne `SET search_path` | low — Util-Funktion, kein Service-Role-Pfad |
| 2 | `public._ai_master_key()` (Migration 018) ohne `SET search_path` | low — Util-Funktion, intern in set_ai_provider |

Beide gefixt in `019_security_consistency_patch.sql` durch
`CREATE OR REPLACE FUNCTION` mit identischem Body und ergaenztem
`SET search_path = public, extensions`.

## Befunde im Detail

### Tabellen-RLS-Status (alle 18 Tabellen)

| Tabelle | ENABLE | FORCE | Policies | Status |
|---|---|---|---|---|
| workspaces | 001 | 009 | S/I/U/D | ✅ |
| memberships | 001 | 009 | S/I/U/D | ✅ |
| nodes | 002 | 009 | S/I/U/D | ✅ |
| rows | 002 | 009 | S/I/U/D | ✅ |
| cols | 002 | 009 | S/I/U/D | ✅ |
| cells | 002 | 009 | S/I/U/D | ✅ |
| kb_cols | 002 | 009 | S/I/U/D | ✅ |
| kb_cards | 002 | 009 | S/I/U/D | ✅ |
| checklists | 002 | 009 | S/I/U/D | ✅ |
| checklist_items | 002 | 009 | S/I/U/D | ✅ |
| links | 002 | 009 | S/I/U/D | ✅ |
| audit_log | 002 | 009 | S/I (intentional) | ✅ append-only |
| docs | 007 | 009 | S/I/U/D | ✅ |
| workspace_invites | 010 | 010 | S only (write via RPC) | ✅ |
| workspace_audit_log | 011 | 011 | S/I (immutable) | ✅ append-only |
| user_preferences | 017 | 017 | S/I/U/D | ✅ |
| user_ai_providers | 018 | 018 | S only (write via RPC) | ✅ |
| ai_call_log | 018 | 018 | S only (insert via service-role) | ✅ |

**Verdict:** Alle 18 Tabellen haben ENABLE + FORCE RLS. Wo direct-writes
verboten sind, gibt es explizite Block-Policies (workspace_invites,
user_ai_providers, ai_call_log). Append-only-Tabellen (audit_log,
workspace_audit_log) blockieren UPDATE/DELETE per Trigger zusaetzlich.
**Kein Defizit.**

### SECURITY DEFINER RPCs (alle 19)

Geprueft: `search_path` SET, `auth.uid()`-Check (oder Pendant), GRANT auf
`authenticated` oder `service_role`.

✅ OK (17 Funktionen):
- handle_new_user, is_workspace_member, workspace_role_of, can_write_workspace
- create_invite, redeem_invite, revoke_invite, list_workspace_members,
  get_workspace_owners
- deactivate_member, reactivate_member, remove_member, change_member_role
- transfer_workspace_ownership, delete_workspace
- set_ai_provider, delete_ai_provider, set_ai_provider_default

⚠ Mangelhaft (2 Funktionen):
- **urlsafe_b64encode(bytea)** (Migration 011): SQL-Language-Funktion ohne
  `SET search_path`. Nutzt `encode()` und `translate()` — beides eingebaute
  Postgres-Builtins, theoretisch nicht-hijackbar, aber inkonsistent zur
  Hausnorm.
- **_ai_master_key()** (Migration 018): plpgsql-Funktion ohne
  `SET search_path`. Nutzt `current_setting()` — eingebaut, aber gleiche
  Defensive-Begruendung wie #1.

**Fix in 019:** beide CREATE OR REPLACE mit identischem Body und
ergaenztem `SET search_path = public, extensions`.

### Backwards-Compat-Drift

Tabellen aus 001-008:
- 001-002: RLS schon in Original-Migration aktiviert.
- 009: `FORCE ROW LEVEL SECURITY` retroaktiv auf alle 13 damaligen
  Tabellen nachgezogen. Saubere Sicherheit gegen service-role-Bypass.
- 006-008: nur strukturelle Aenderungen, keine RLS-Lecks.
- 007 (docs): von Anfang an mit RLS + Grants.

**Kein Drift gefunden.**

### Realtime-Publication-Drift

Migration 005 publiziert: nodes, cells, rows, cols, kb_cols, kb_cards,
checklists, checklist_items, links. Alle mit `REPLICA IDENTITY FULL`.

Spaeter:
- 007 (docs): ALTER PUBLICATION ADD + REPLICA IDENTITY FULL ✅
- 010 (workspace_invites): NICHT publiziert — bewusst (Token-sensitiv)
- 011 (workspace_audit_log): NICHT publiziert — bewusst (audit-only)
- 016 (nodes.created_by): Spalten-Erweiterung, keine neue Tabelle
- 017 (user_preferences): NICHT publiziert — user-private, kein Workspace-Broadcast
- 018 (user_ai_providers, ai_call_log): NICHT publiziert — user-private

**Verdict:** Alle Realtime-relevanten Tabellen sind drin. Auslassungen
sind bewusst und korrekt. Kein Defizit.

## Patch-Migration 019

```sql
-- urlsafe_b64encode: search_path nachtragen
CREATE OR REPLACE FUNCTION public.urlsafe_b64encode(p_bytes bytea)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
SET search_path = public, extensions
AS $$
  SELECT translate(encode(p_bytes, 'base64'), E'+/=\n', '-_');
$$;

-- _ai_master_key: search_path nachtragen
CREATE OR REPLACE FUNCTION public._ai_master_key()
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE k text;
BEGIN
  k := current_setting('app.ai_master_key', true);
  IF k IS NULL OR length(k) < 16 THEN
    RAISE EXCEPTION 'ai_master_key_missing'
      USING HINT = '...';
  END IF;
  RETURN k;
END $$;
```

Idempotent (CREATE OR REPLACE). Keine Schema-Aenderung, nur
Funktions-Header-Properties.

## Folgerungen

- Es war kein kritisches Loch zu finden — die Hausnorm `SET search_path`
  + `auth.uid()`-Check + Block-Policy fuer RPC-only-Writes ist gut etabliert.
- Beim naechsten neuen RPC: bitte den Pattern aus `change_member_role`
  weiter verwenden (siehe `docs/claude/architektur.md` Section "Tool-
  Trio-Regel" und Migration 014 als Vorbild).
- Empfehlung: pre-commit-Hook der bei `CREATE FUNCTION ... SECURITY
  DEFINER` ohne `SET search_path` warnt. **Phase 3+ Item, nicht jetzt.**

## Verifikation nach Apply

Nach `bash infra/scripts/supabase-migrate.sh` auf staging:

```sql
-- Funktion-Header-Test: prosrc bleibt identisch, proconfig zeigt search_path
SELECT proname, proconfig
FROM pg_proc
WHERE proname IN ('urlsafe_b64encode', '_ai_master_key');
-- erwartet: proconfig enthaelt 'search_path=public, extensions'

-- Smoke: invite-Flow + ai-provider-flow funktionieren weiter
-- (Browser-Test, kein automatisierter Pfad).
```
