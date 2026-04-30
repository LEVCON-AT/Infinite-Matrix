-- ═══════════════════════════════════════════════════════════════
-- AU-B1 Welle K1 — Security/Schema-Patch (CRITICAL + HIGH-Security)
--
-- Audit `docs/audit/B1-summary-2026-04-29.md` — sammelt 6 SQL-Findings
-- aus den Streams A + C in eine konsolidierte Patch-Migration:
--
--   B1-A-001 (CRITICAL): FORCE ROW LEVEL SECURITY auf 6 Object-Layer-
--                        Tabellen (Migration 030 hat ENABLE, kein FORCE).
--   B1-A-008 (MEDIUM-Sec): object_backlinks_v ohne security_invoker — RLS-
--                          Bypass ueber den View-Owner (postgres BYPASSRLS).
--   B1-C-002 (CRITICAL): _mcp_resolve_workspace ist SECURITY DEFINER + per
--                        Default fuer authenticated aufrufbar →
--                        Workspace-ID-Enumeration fremder Resourcen.
--   B1-A-002 (HIGH): _ai_master_key falsch als IMMUTABLE deklariert —
--                    `current_setting()` ist GUC-abhaengig (STABLE).
--   B1-A-004 (HIGH): ai_call_log fehlen explizite UPDATE/DELETE-Block-
--                    Policies (Konsistenz mit Pattern in 011/013/018).
--   B1-C-006 (MEDIUM): _mcp_assert_writer ohne expliziten REVOKE FROM
--                      PUBLIC (defense-in-depth gegen direkten User-Aufruf).
--
-- Idempotent — alle Statements `CREATE OR REPLACE` / `DROP IF EXISTS` /
-- `ALTER TABLE … FORCE`. Sicher mehrfach anwendbar.
-- ═══════════════════════════════════════════════════════════════

-- 1) B1-A-001: FORCE RLS auf Object-Layer-Tabellen.
--    Migration 030 hat ENABLE, kein FORCE — service_role + postgres
--    konnten RLS bisher umgehen.
ALTER TABLE public.objects             FORCE ROW LEVEL SECURITY;
ALTER TABLE public.object_tags         FORCE ROW LEVEL SECURITY;
ALTER TABLE public.groups              FORCE ROW LEVEL SECURITY;
ALTER TABLE public.group_members       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.soft_groups         FORCE ROW LEVEL SECURITY;
ALTER TABLE public.soft_group_members  FORCE ROW LEVEL SECURITY;

-- 2) B1-A-008: object_backlinks_v als security_invoker.
--    PostgreSQL 15+ Pattern (analog Migration 018 user_ai_providers_safe).
--    Body unveraendert — Postgres macht das via View-Recreate.
CREATE OR REPLACE VIEW public.object_backlinks_v
  WITH (security_invoker = true) AS
  -- rows
  SELECT
    r.workspace_id,
    r.object_id,
    'row'::text     AS kind,
    r.id            AS ref_id,
    r.label         AS ref_label,
    r.matrix_id     AS node_id,
    n.label         AS node_label,
    n.type::text    AS node_type
  FROM public.rows r
  JOIN public.nodes n ON n.id = r.matrix_id
  WHERE r.object_id IS NOT NULL

  UNION ALL

  -- cols
  SELECT
    c.workspace_id,
    c.object_id,
    'col'::text     AS kind,
    c.id            AS ref_id,
    c.label         AS ref_label,
    c.matrix_id     AS node_id,
    n.label         AS node_label,
    n.type::text    AS node_type
  FROM public.cols c
  JOIN public.nodes n ON n.id = c.matrix_id
  WHERE c.object_id IS NOT NULL

  UNION ALL

  -- kb_cols (Board-Spalten)
  SELECT
    k.workspace_id,
    k.object_id,
    'kb_col'::text  AS kind,
    k.id            AS ref_id,
    k.label         AS ref_label,
    k.board_id      AS node_id,
    n.label         AS node_label,
    n.type::text    AS node_type
  FROM public.kb_cols k
  JOIN public.nodes n ON n.id = k.board_id
  WHERE k.object_id IS NOT NULL

  UNION ALL

  -- nodes (matrix/board mit object_id)
  SELECT
    n.workspace_id,
    n.object_id,
    'node'::text    AS kind,
    n.id            AS ref_id,
    n.label         AS ref_label,
    n.id            AS node_id,
    n.label         AS node_label,
    n.type::text    AS node_type
  FROM public.nodes n
  WHERE n.object_id IS NOT NULL;

-- 3) B1-C-002: _mcp_resolve_workspace nicht oeffentlich aufrufbar.
--    Funktion bleibt SECURITY DEFINER (interne Aufrufer), aber
--    EXECUTE-Rechte werden zurueckgenommen. Aufrufer-Kette ist
--    SECURITY-DEFINER-RPC → Helper, der intern als Function-Owner
--    laeuft — kein expliziter GRANT noetig.
REVOKE EXECUTE ON FUNCTION public._mcp_resolve_workspace(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._mcp_resolve_workspace(text, uuid) FROM authenticated;

-- 4) B1-C-006: _mcp_assert_writer analog absichern.
--    SECURITY INVOKER, aber vorsichtshalber REVOKE FROM PUBLIC fuer
--    Defense-in-Depth (kein direkter User-Aufruf moeglich).
REVOKE EXECUTE ON FUNCTION public._mcp_assert_writer(uuid) FROM PUBLIC;

-- 5) B1-A-002: _ai_master_key als STABLE statt IMMUTABLE.
--    current_setting() ist session/transaction-abhaengig — IMMUTABLE
--    erlaubt Postgres aggressives Caching ueber Plan-Boundaries
--    hinweg. Bei zukuenftiger Key-Rotation oder per-Session-Key-
--    Injection kann das veraltete Werte zurueckgeben.
--    Body + search_path unveraendert — nur Volatility-Kategorie.
CREATE OR REPLACE FUNCTION public._ai_master_key()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
AS $$
DECLARE k text;
BEGIN
  k := current_setting('app.ai_master_key', true);
  IF k IS NULL OR length(k) < 16 THEN
    RAISE EXCEPTION 'ai_master_key_missing'
      USING HINT = 'Postgres-GUC app.ai_master_key muss gesetzt sein (siehe docs/claude/architektur.md).';
  END IF;
  RETURN k;
END $$;

-- 6) B1-A-004: ai_call_log explizite Block-Policies fuer UPDATE/DELETE.
--    FORCE RLS plus deny-by-default macht diese Operationen heute schon
--    blockiert, aber explizite Block-Policies sind Projekt-Standard
--    (vgl. workspace_audit_log in 011, user_ai_providers in 018).
DROP POLICY IF EXISTS ai_call_log_no_user_updates ON public.ai_call_log;
CREATE POLICY ai_call_log_no_user_updates ON public.ai_call_log
  FOR UPDATE USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS ai_call_log_no_user_deletes ON public.ai_call_log;
CREATE POLICY ai_call_log_no_user_deletes ON public.ai_call_log
  FOR DELETE USING (false);

-- ─── Verifikation (informationell, nicht blockierend) ───────
-- Zur Selbstkontrolle nach apply: pruefen dass FORCE RLS aktiv ist
-- und security_invoker auf der View greift.
DO $$
DECLARE
  v_force_count int;
  v_view_secinvoker boolean;
BEGIN
  SELECT count(*) INTO v_force_count
    FROM pg_class
    WHERE relname IN ('objects','object_tags','groups','group_members','soft_groups','soft_group_members')
      AND relrowsecurity = true
      AND relforcerowsecurity = true;
  IF v_force_count <> 6 THEN
    RAISE WARNING 'B1-A-001: FORCE RLS nicht auf allen 6 Object-Layer-Tabellen aktiv (count=%)', v_force_count;
  END IF;

  SELECT (reloptions::text LIKE '%security_invoker=true%') INTO v_view_secinvoker
    FROM pg_class WHERE relname = 'object_backlinks_v' AND relkind = 'v';
  IF NOT COALESCE(v_view_secinvoker, false) THEN
    RAISE WARNING 'B1-A-008: object_backlinks_v ohne security_invoker — bitte manuell pruefen';
  END IF;
END $$;
