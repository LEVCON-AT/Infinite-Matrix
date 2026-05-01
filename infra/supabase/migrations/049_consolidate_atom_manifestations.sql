-- ═══════════════════════════════════════════════════════════════
-- Q.2 — Konsolidierung: task_manifestations → atom_manifestations
--
-- Migration 044 hat atom_manifestations als polymorphe Tabelle angelegt
-- und einen Sync-Trigger eingerichtet, der task_manifestations →
-- atom_manifestations spiegelt. Damit gab es zwei Quellen der Wahrheit
-- mit Trigger-Glue. Diese Migration loest die Dual-Write-Architektur
-- auf:
--
--   1. Sync-Trigger entfernen (task_manifestations → atom_manifestations
--      laeuft nicht mehr).
--   2. Sicherheits-Backfill: alles was aktuell in task_manifestations
--      steht aber NICHT in atom_manifestations muss vor dem Drop
--      gespiegelt werden (Migration 044's Backfill war idempotent;
--      hier wiederholen wir ihn defensiv falls Drift entstanden ist).
--   3. task_manifestations DROP TABLE — atom_manifestations ist ab
--      jetzt sole source of truth.
--   4. Aus supabase_realtime entfernen (Tabelle existiert nicht mehr).
--
-- Wichtig: dieser SQL-Apply MUSS koordiniert mit dem Code-Deploy
-- erfolgen, der lib/tasks.ts + queries.ts + mutations.ts auf
-- atom_manifestations umstellt. SQL und Code sind ein einziger Commit
-- (Q.2).
-- ═══════════════════════════════════════════════════════════════

-- ─── Defensive-Backfill ───────────────────────────────────────
-- task_manifestations.id ist seit Migration 044 das gemeinsame ID-
-- Feld (atom_manifestations.id == task_manifestations.id beim
-- gespiegelten Row). Falls ein Insert die Spiegelung verpasst hat
-- (z.B. nach manuellem Trigger-Disable), holen wir das hier nach.
INSERT INTO public.atom_manifestations (
  id, atom_type, atom_id, workspace_id, kind, container_id,
  position, level, display_meta, created_at
)
SELECT
  tm.id,
  'task'::public.atom_type,
  tm.task_id,
  tm.workspace_id,
  tm.kind::text::public.atom_manifestation_kind,
  tm.container_id,
  tm.position,
  tm.level,
  tm.display_meta,
  tm.created_at
FROM public.task_manifestations tm
ON CONFLICT (id) DO NOTHING;

-- ─── Sync-Trigger entfernen ───────────────────────────────────
-- Funktion bleibt im Schema (kein Drop) — falls die Migration fehl-
-- schlaegt und reverted wird, soll der naechste Apply nicht ueber
-- "Function fehlt" stolpern. Ohne Trigger feuert die Funktion aber
-- nicht mehr.
DROP TRIGGER IF EXISTS task_manif_sync_to_atom ON public.task_manifestations;

-- ─── task_manifestations dropt aus supabase_realtime ───────────
-- DROP TABLE wuerde implizit aus der Publication genommen, aber wir
-- machen es explizit damit das DDL deterministisch ist (Re-Apply
-- ohne Fehler).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'task_manifestations'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.task_manifestations;
  END IF;
END $$;

-- ─── DROP TABLE ────────────────────────────────────────────────
-- CASCADE damit FK-Constraints (z.B. von task_manifestations.task_id
-- → tasks.id mit ON DELETE CASCADE) sauber abgewickelt werden.
DROP TABLE IF EXISTS public.task_manifestations CASCADE;

-- Sync-Trigger-Funktion bleibt im Schema als no-op-Resource. Der
-- Naechste Schema-Sweep kann sie entfernen wenn klar ist dass kein
-- Rollback noetig ist.

-- ─── get_admin_stats anpassen ─────────────────────────────────
-- Migration 048 verweist in der Stats-RPC auf task_manifestations —
-- nach DROP TABLE wuerde der Call fehlschlagen. Wir ersetzen die
-- Funktion: task_manifestations_total faellt aus dem Result raus,
-- atom_manifestations_total bleibt. Der Frontend-Konsument
-- (lib/admin.ts/AdminStats) wird im Q.2-Code-Sweep entsprechend
-- angepasst.
CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_users          int;
  v_users_recent   int;
  v_workspaces     int;
  v_tasks          int;
  v_atom_manifs    int;
  v_audit_24h      int;
  v_now            timestamptz := now();
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*) INTO v_users FROM auth.users;
  SELECT count(*) INTO v_users_recent
    FROM auth.users
   WHERE last_sign_in_at >= v_now - interval '30 days';
  SELECT count(*) INTO v_workspaces FROM public.workspaces;
  SELECT count(*) INTO v_tasks FROM public.tasks;
  SELECT count(*) INTO v_atom_manifs FROM public.atom_manifestations;
  SELECT count(*) INTO v_audit_24h
    FROM public.system_audit_log
   WHERE created_at >= v_now - interval '24 hours';

  RETURN jsonb_build_object(
    'users_total', v_users,
    'users_active_30d', v_users_recent,
    'workspaces_total', v_workspaces,
    'tasks_total', v_tasks,
    'atom_manifestations_total', v_atom_manifs,
    'audit_events_24h', v_audit_24h,
    'as_of', v_now
  );
END $$;

-- ─── Smoke-Verifikation (manuell nach Apply) ──────────────────
-- 1. SELECT to_regclass('public.task_manifestations');  -- sollte NULL sein
-- 2. SELECT count(*) FROM public.atom_manifestations WHERE atom_type='task';
--    -- sollte gleich der vorher in task_manifestations gewesenen Count sein
-- 3. SELECT trigger_name FROM information_schema.triggers
--      WHERE event_object_table='atom_manifestations';
--    -- Sync-Trigger task_manif_sync_to_atom ist weg (auf task_manifestations)
-- 4. SELECT * FROM pg_publication_tables
--      WHERE tablename IN ('task_manifestations','atom_manifestations');
--    -- nur atom_manifestations mit pubname='supabase_realtime'
