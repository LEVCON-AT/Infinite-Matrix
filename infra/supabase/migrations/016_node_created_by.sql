-- 016_node_created_by.sql — Knoten-Ersteller-Tracking.
--
-- Phase-2-Welle "NodeTree Mini-Avatar". nodes.created_by haelt den
-- User, der den Knoten angelegt hat. ON DELETE SET NULL bewahrt den
-- Knoten bei User-Loeschung (Workspace darf nicht zerfallen). Default
-- auth.uid() greift fuer alle JWT-basierten Inserts (RLS-Pfad). Die
-- Bridge mit Service-Role muss expliziten user_id-Param mitgeben oder
-- toleriert NULL ("Ersteller unbekannt"-Avatar).
--
-- Backfill: bestehende Nodes erben den Workspace-Owner — nicht ideal
-- (der echte Ersteller ist nicht mehr feststellbar), aber besser als
-- NULL mit "unbekannt"-Avatar fuer historische Knoten. Workspace-Owner
-- ist immer ein bekannter Member.
--
-- Schema-Quad-Sweep:
--  - Mutations:   Default greift, Code-Change nicht erforderlich. Nur
--                 NodeRow-Type ergaenzt.
--  - MCP-Tools:   Bridge nutzt Service-Role -> auth.uid()=NULL. Nicht
--                 angepasst (Bridge ist Standalone, kein Multi-User-
--                 Pfad in Phase 1). Bei Bridge-Multi-User-Roadmap:
--                 explicit-Param in Tool-Signaturen.
--  - Export:      created_by mit-exportieren (gehoert zum Knoten).
--  - Import:      created_by NICHT uebernehmen — Default greift fuer
--                 den importierenden User.

ALTER TABLE public.nodes
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.nodes
  ALTER COLUMN created_by SET DEFAULT auth.uid();

UPDATE public.nodes n
SET created_by = w.owner_id
FROM public.workspaces w
WHERE w.id = n.workspace_id AND n.created_by IS NULL;

CREATE INDEX IF NOT EXISTS nodes_created_by_idx ON public.nodes(created_by);

COMMENT ON COLUMN public.nodes.created_by IS
  'User der den Knoten erstellt hat. NULL nach User-Delete (ON DELETE SET NULL).';
