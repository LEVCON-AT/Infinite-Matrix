-- ═══════════════════════════════════════════════════════════════
-- WV.D.3.g — template_widgets.type CHECK += 'channel'
--
-- Konzept §13.4 + plan-welle-d.md §4.1.
--
-- Migration 067 hat type CHECK auf 7 Werte gesetzt: kanban, checklist,
-- info, doc, link, calendar, smart_summary. Welle D.3 fuegt 'channel'
-- hinzu — generische Mail/Chat-Widget-Type, die via
-- widget_external_channels.provider + external_ref auf einen konkreten
-- Slack-Channel / Outlook-Folder / Teams-Chat zeigt.
--
-- Drive-Provider bekommen einen separaten Type 'drive' in WV.D.5
-- (File-Pick-UI ist anders geformt als Message-Liste).
--
-- Idempotent: ALTER TABLE ... DROP CONSTRAINT + ADD CONSTRAINT.
--
-- Apply (User-Go-Pflicht):
--   docker exec matrix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f 079_template_widgets_channel_type.sql
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- DROP existing CHECK + neu mit erweitertem Set. Constraint-Name folgt
-- Postgres-Default-Naming ('<table>_<col>_check'). Wir droppen idempotent
-- — wenn der Name abweicht, faengt das DO-Block ab.
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
    FROM pg_constraint
   WHERE conrelid = 'public.template_widgets'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%type = ANY%';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.template_widgets DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.template_widgets
  ADD CONSTRAINT template_widgets_type_check
    CHECK (type IN (
      'kanban','checklist','info','doc','link','calendar','smart_summary',
      'channel'
    ));

COMMIT;

COMMENT ON CONSTRAINT template_widgets_type_check ON public.template_widgets IS
  'WV.D.3.g: erweiterter Widget-Type-Set inkl. ''channel'' (Mail/Chat-Bridge).';
