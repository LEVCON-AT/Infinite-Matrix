-- ═══════════════════════════════════════════════════════════════
-- WV.D.5.a — template_widgets.type CHECK += 'drive'
--
-- Konzept §13.3 + plan-welle-d.md §4.3.
--
-- Welle WV.D.3.g hat 'channel' fuer Mail/Chat-Bridge eingefuehrt.
-- Cloud-Drive-Provider (OneDrive/Drive/Dropbox/Nextcloud) bekommen
-- jetzt einen eigenen Type 'drive' — File-Pick-UI ist anders geformt
-- als Message-Liste (Folder-Tree statt Thread-Liste).
--
-- Idempotent: ALTER TABLE ... DROP CONSTRAINT + ADD CONSTRAINT.
--
-- Apply:
--   docker exec matrix-supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 -f 080_template_widgets_drive_type.sql
-- ═══════════════════════════════════════════════════════════════

BEGIN;

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
      'channel','drive'
    ));

COMMIT;

COMMENT ON CONSTRAINT template_widgets_type_check ON public.template_widgets IS
  'WV.D.5.a: erweiterter Widget-Type-Set inkl. ''channel'' + ''drive'' (Cloud-Drive-Bridge).';
