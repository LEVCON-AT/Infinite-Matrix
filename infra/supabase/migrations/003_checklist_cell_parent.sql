-- ═══════════════════════════════════════════════════════════════
-- Phase 0e.1.b.0 — Checklist vom Board entkoppeln
--
-- Vorher: checklists.board_id NOT NULL -> Checklist muss an einem
-- Board haengen. Spiegelt das Alt-Client-Speichermodell, aber NICHT
-- das Mental-Modell: Checklist ist konzeptionell eigenstaendig und
-- kann in einer Zelle leben, ganz ohne Board (und erst bei Transform
-- zur Karte wird ein Board zwingend).
--
-- Nachher: genau EIN Parent (board_id ODER cell_id).
-- Transforms in 0e.2 haengen dann nur noch um.
--
-- Idempotent via IF NOT EXISTS / IF EXISTS / pg_constraint-Checks.
-- ═══════════════════════════════════════════════════════════════

-- ─── cell_id-Spalte ───────────────────────────────────────────
ALTER TABLE public.checklists
  ADD COLUMN IF NOT EXISTS cell_id uuid;

-- ─── board_id nullable ────────────────────────────────────────
-- IS_NULLABLE-Check, damit die Migration re-run fehlerfrei durchlaeuft.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='checklists'
      AND column_name='board_id' AND is_nullable='NO'
  ) THEN
    ALTER TABLE public.checklists ALTER COLUMN board_id DROP NOT NULL;
  END IF;
END $$;

-- ─── Composite-FK auf cells ───────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checklists_cell_fkey'
  ) THEN
    ALTER TABLE public.checklists
      ADD CONSTRAINT checklists_cell_fkey
      FOREIGN KEY (cell_id, workspace_id)
      REFERENCES public.cells(id, workspace_id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- ─── XOR-Check: genau ein Parent ──────────────────────────────
-- board_id XOR cell_id. Keine Row darf beides gleichzeitig haben
-- (sonst ambigouse Eltern-Beziehung) und keine darf ohne Parent
-- haengen (waere nur ueber workspace_id erreichbar, verwaist in UX).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'checklists_parent_xor'
  ) THEN
    ALTER TABLE public.checklists
      ADD CONSTRAINT checklists_parent_xor
      CHECK (
        (board_id IS NOT NULL AND cell_id IS NULL) OR
        (board_id IS NULL     AND cell_id IS NOT NULL)
      );
  END IF;
END $$;

-- ─── Indexe ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS checklists_cell_idx
  ON public.checklists(cell_id, position) WHERE cell_id IS NOT NULL;

-- checklists_board_idx existierte bereits aus 002; bleibt gueltig,
-- enthaelt jetzt nur noch die board-parented Rows (Postgres zieht
-- NULL-Werte nicht in Standard-Btree-Indexe fuer IS NOT NULL-Filter).

COMMENT ON COLUMN public.checklists.board_id IS
  'Parent-Board. XOR mit cell_id: genau einer der beiden ist gesetzt.';
COMMENT ON COLUMN public.checklists.cell_id IS
  'Parent-Zelle (Checkliste direkt in einer Matrix-Zelle, ohne Board-Zwang).';
