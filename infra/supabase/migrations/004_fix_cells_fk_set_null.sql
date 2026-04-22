-- ═══════════════════════════════════════════════════════════════
-- Phase 0e.1.b.1 — Composite-FK ON DELETE SET NULL: nur das
--                  Link-Feld, nicht die workspace_id nullen.
--
-- Bug im 002-Schema:
--   FOREIGN KEY (child_matrix_id, workspace_id)
--     REFERENCES nodes(id, workspace_id) ON DELETE SET NULL
-- nullt beim Loeschen des Ziel-Node BEIDE Spalten der FK-Klausel.
-- Folge: cells.workspace_id wird NULL → NOT NULL-Constraint bricht,
-- Delete schlaegt mit "null value in column workspace_id" fehl.
--
-- Fix (PG15+): ON DELETE SET NULL (child_matrix_id) — explizite
-- Spalte(n). workspace_id bleibt erhalten.
--
-- Idempotent: DROP IF EXISTS mit allen bekannten Constraint-Namen
-- (auto-generiert vs. hier explizit benannt) + ADD.
-- ═══════════════════════════════════════════════════════════════

-- 1. Alte FKs droppen (beide moeglichen Namen abgedeckt).
ALTER TABLE public.cells
  DROP CONSTRAINT IF EXISTS cells_child_matrix_id_workspace_id_fkey;
ALTER TABLE public.cells
  DROP CONSTRAINT IF EXISTS cells_board_id_workspace_id_fkey;
ALTER TABLE public.cells
  DROP CONSTRAINT IF EXISTS cells_child_matrix_fkey;
ALTER TABLE public.cells
  DROP CONSTRAINT IF EXISTS cells_board_fkey;

-- 2. Neu anlegen mit korrektem Spalten-Scope fuer SET NULL.
ALTER TABLE public.cells
  ADD CONSTRAINT cells_child_matrix_fkey
    FOREIGN KEY (child_matrix_id, workspace_id)
    REFERENCES public.nodes(id, workspace_id)
    ON DELETE SET NULL (child_matrix_id);

ALTER TABLE public.cells
  ADD CONSTRAINT cells_board_fkey
    FOREIGN KEY (board_id, workspace_id)
    REFERENCES public.nodes(id, workspace_id)
    ON DELETE SET NULL (board_id);
