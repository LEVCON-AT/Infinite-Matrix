-- ═══════════════════════════════════════════════════════════════
-- WV.B.3 — atom_markers (star + eye)
--
-- Konzept-Verankerung: §13.6 (Marker-Toggle), §15.1 atom_markers.
--
-- Polymorphe Layer-4-Tabelle (analog atom_tags / atom_pins-bevor-WV.WV.1).
-- Trennt sich in 2 Kinds:
--   star — Workspace-shared, alle Member sehen, mit Counter
--   eye  — User-privat, nur Owner sieht
--
-- Schema-Heptad pro atom_markers:
--   - Schema:       diese Migration.
--   - Types:        lib/types.ts — AtomMarkerRow, AtomMarkerKind.
--   - Mutations:    lib/atom-markers.ts — toggle / list (Workspace-shared
--                   Star + private Eye).
--   - Cache:        offline-cache.ts — TABLES + DB_VERSION-Bump.
--   - Realtime:     direct table mit kind=star Subscription
--                   workspace-wide; kind=eye user-scoped (RLS filtert).
--   - Export:       export.ts — workspace_id-scope + RLS-gefiltert
--                   (eigene eye-Marker mit, fremde nicht).
--   - MCP:          packages/bridge/src/tools/atom-markers.ts neu.
--   - Channel-Bridge: n/a — User-Engagement-Daten.
--
-- Apply:
--   docker exec matrix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f 074_atom_markers.sql
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── Tabelle: atom_markers ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.atom_markers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('star', 'eye')),
  -- Polymorphe Atom-Referenz (analog atom_tags + atom_manifestations).
  -- Kein FK — atom_type entscheidet welche Tabelle der atom_id-Owner ist.
  atom_type     public.atom_type NOT NULL,
  atom_id       uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- Eindeutigkeit: pro User+Atom+Kind nur eine Markierung.
  UNIQUE (user_id, atom_type, atom_id, kind)
);

CREATE INDEX IF NOT EXISTS atom_markers_ws_idx ON public.atom_markers(workspace_id);
-- Index fuer Workspace-Counter (kind='star' aggregate). Index ueber
-- (workspace_id, atom_type, atom_id, kind) damit COUNT(*) ueber Atom
-- den Index nutzt.
CREATE INDEX IF NOT EXISTS atom_markers_atom_idx ON public.atom_markers(workspace_id, atom_type, atom_id, kind);
-- Index fuer User-private Eye-Sicht.
CREATE INDEX IF NOT EXISTS atom_markers_user_idx ON public.atom_markers(user_id, kind);

ALTER TABLE public.atom_markers ENABLE ROW LEVEL SECURITY;

-- ─── RLS Policies ────────────────────────────────────────────
-- SELECT: star sichtbar fuer alle Member; eye nur fuer Owner.
DROP POLICY IF EXISTS atom_markers_select ON public.atom_markers;
CREATE POLICY atom_markers_select ON public.atom_markers
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND (
      kind = 'star'
      OR (kind = 'eye' AND user_id = auth.uid())
    )
  );

-- WRITE: jeder Member kann sich selbst markieren — user_id muss auth.uid() sein.
-- Verhindert „Stars im Namen anderer".
DROP POLICY IF EXISTS atom_markers_write ON public.atom_markers;
CREATE POLICY atom_markers_write ON public.atom_markers
  FOR ALL
  USING (
    user_id = auth.uid() AND public.is_workspace_member(workspace_id)
  )
  WITH CHECK (
    user_id = auth.uid() AND public.is_workspace_member(workspace_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.atom_markers TO authenticated;
GRANT ALL ON public.atom_markers TO service_role;

-- ─── Realtime ───────────────────────────────────────────────
ALTER TABLE public.atom_markers REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'atom_markers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.atom_markers;
  END IF;
END $$;

COMMENT ON TABLE public.atom_markers IS
  'WV.B.3 polymorphe User-Markierungen an Atomen (kind=star Workspace-shared, kind=eye User-privat). UNIQUE(user_id,atom_type,atom_id,kind) - ein User markiert ein Atom maximal einmal pro Kind.';

COMMIT;
