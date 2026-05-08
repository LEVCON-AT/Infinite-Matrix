-- ═══════════════════════════════════════════════════════════════
-- WV.A.3 — workspace_hotkey_slots + user_hotkey_slots
--
-- Slot-Belegungen pro Workspace (1-9, von Owner gesetzt) und pro
-- User (Override fuer den eigenen Account). Konzept §6.3 + §6.4.
--
-- Plattform-Default-Belegung (Konzept §6.3):
--   Slot 1: Matrix-Vorlage
--   Slot 2: Info-Vorlage
--   Slot 3: Kanban-Vorlage
--   Slot 4: Checkliste-Vorlage
--   Slot 5-9: leer (offen, User 2026-05-06: „muessen wir noch besprechen")
-- Wird in Migration 070 (Default-Vorlagen-Seed) zusammen mit den
-- 5 Plattform-Vorlagen eingespielt.
--
-- Visibility:
--   workspace_hotkey_slots: Owner setzt fuer den ganzen Workspace.
--                           Alle Member sehen die Belegung (Hotkey-
--                           Sichtbarkeit muss Cross-User konsistent
--                           sein, sonst „warum macht 3 bei mir was
--                           anderes als bei dir?").
--   user_hotkey_slots:      User-Privat-Override. Self-only.
--                           Per Konvention NULL = falle auf
--                           workspace_hotkey_slots zurueck.
--
-- Schema-Heptad pro Tabelle:
--   - Schema:       diese Migration.
--   - Types:        lib/types.ts — WorkspaceHotkeySlotRow, UserHotkeySlotRow.
--   - Mutations:    lib/hotkey-slots.ts — setWorkspaceHotkeySlot,
--                   clearWorkspaceHotkeySlot, setUserHotkeySlot,
--                   clearUserHotkeySlot.
--   - Cache:        offline-cache.ts — TABLES + DB_VERSION-Bump.
--   - Realtime:     beide Tabellen — workspace per-Workspace-Member,
--                   user per-Tab-im-User.
--   - Export:       export.ts — workspace_hotkey_slots als Workspace-
--                   Subset; user_hotkey_slots NICHT (User-privat).
--   - MCP:          packages/bridge/src/tools/hotkey-slots.ts neu.
--   - Channel-Bridge: n/a.
--
-- Apply:
--   docker exec matrix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f 069_hotkey_slots.sql
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── workspace_hotkey_slots ──────────────────────────────────
-- id-Spalte (uuid) damit die Tabelle in den IDB-Cache passt
-- (CacheRow.id: string Pflicht). Logischer PK ist (workspace_id, slot)
-- als UNIQUE-Constraint.
CREATE TABLE IF NOT EXISTS public.workspace_hotkey_slots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slot          int NOT NULL CHECK (slot BETWEEN 1 AND 9),
  template_id   uuid NOT NULL REFERENCES public.feature_templates(id) ON DELETE CASCADE,
  set_by        uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  set_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slot)
);

CREATE INDEX IF NOT EXISTS workspace_hotkey_slots_template_idx ON public.workspace_hotkey_slots(template_id);

ALTER TABLE public.workspace_hotkey_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workspace_hotkey_slots_select ON public.workspace_hotkey_slots;
CREATE POLICY workspace_hotkey_slots_select ON public.workspace_hotkey_slots
  FOR SELECT USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS workspace_hotkey_slots_write ON public.workspace_hotkey_slots;
CREATE POLICY workspace_hotkey_slots_write ON public.workspace_hotkey_slots
  FOR ALL
  USING (public.workspace_role_of(workspace_id) = 'owner')
  WITH CHECK (public.workspace_role_of(workspace_id) = 'owner');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_hotkey_slots TO authenticated;
GRANT ALL ON public.workspace_hotkey_slots TO service_role;

-- ─── user_hotkey_slots ───────────────────────────────────────
-- User-Privat. Per Workspace-User-Combo Override. NULL = Workspace-
-- Default uebernehmen (V1 keine explicite NULL-Spalte; Override
-- existiert nur, wenn der User wirklich umbiegen will).
CREATE TABLE IF NOT EXISTS public.user_hotkey_slots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slot          int NOT NULL CHECK (slot BETWEEN 1 AND 9),
  template_id   uuid NOT NULL REFERENCES public.feature_templates(id) ON DELETE CASCADE,
  set_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, workspace_id, slot)
);

CREATE INDEX IF NOT EXISTS user_hotkey_slots_workspace_idx ON public.user_hotkey_slots(workspace_id);

ALTER TABLE public.user_hotkey_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_hotkey_slots_select ON public.user_hotkey_slots;
CREATE POLICY user_hotkey_slots_select ON public.user_hotkey_slots
  FOR SELECT USING (
    user_id = auth.uid() AND public.is_workspace_member(workspace_id)
  );

DROP POLICY IF EXISTS user_hotkey_slots_write ON public.user_hotkey_slots;
CREATE POLICY user_hotkey_slots_write ON public.user_hotkey_slots
  FOR ALL
  USING (
    user_id = auth.uid() AND public.is_workspace_member(workspace_id)
  )
  WITH CHECK (
    user_id = auth.uid() AND public.is_workspace_member(workspace_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_hotkey_slots TO authenticated;
GRANT ALL ON public.user_hotkey_slots TO service_role;

-- ─── Realtime ───────────────────────────────────────────────
-- Beide Tabellen Pflicht (Memory `feedback_realtime_konsistenz.md`):
-- workspace fuer Cross-User-Sicht nach Owner-Aenderung; user fuer
-- Cross-Tab im selben Account.
ALTER TABLE public.workspace_hotkey_slots REPLICA IDENTITY FULL;
ALTER TABLE public.user_hotkey_slots REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'workspace_hotkey_slots'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_hotkey_slots;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_hotkey_slots'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_hotkey_slots;
  END IF;
END $$;

-- ─── Comments ───────────────────────────────────────────────
COMMENT ON TABLE public.workspace_hotkey_slots IS
  'WV.A.3 Workspace-Slot-Belegung 1-9 (Konzept §6.3). Owner-only-Write, alle Member lesen.';
COMMENT ON TABLE public.user_hotkey_slots IS
  'WV.A.3 User-Private-Override pro Workspace+Slot. Self-only. NULL/missing = falle auf workspace_hotkey_slots zurueck.';

COMMIT;
