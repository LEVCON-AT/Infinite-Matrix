-- ═══════════════════════════════════════════════════════════════
-- Phase 0c.1 — Workspace + Membership
--
-- Nach Login entsteht automatisch ein Workspace fuer den User.
-- Membership-Rollen: owner (1 pro Workspace), admin, editor, viewer.
-- Multi-User-Kollaboration ist ab Tag 1 moeglich; fuer Phase 0 wird
-- aber nur der Auto-Create-Flow implementiert (kein Invite-UI).
--
-- Idempotent: kann mehrfach angewendet werden (IF NOT EXISTS / OR REPLACE).
-- ═══════════════════════════════════════════════════════════════

-- ─── Rolle-Enum ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workspace_role') THEN
    CREATE TYPE public.workspace_role AS ENUM ('owner','admin','editor','viewer');
  END IF;
END
$$;

-- ─── workspaces ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspaces_owner_idx ON public.workspaces(owner_id);

COMMENT ON TABLE public.workspaces IS
  'Ein Workspace ist die oberste Ownership-Einheit. Ein User kann mehrere haben.';

-- ─── memberships ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.memberships (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         public.workspace_role NOT NULL DEFAULT 'editor',
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON public.memberships(user_id);

COMMENT ON TABLE public.memberships IS
  'Verbindung User <-> Workspace mit Rolle. Ein User kann in mehreren Workspaces verschiedene Rollen haben.';

-- ─── updated_at-Trigger-Helper ────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS workspaces_set_updated_at ON public.workspaces;
CREATE TRIGGER workspaces_set_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Auto-Create-Trigger auf auth.users ───────────────────────
-- Jeder neue User bekommt einen Default-Workspace.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_workspace_id uuid;
  default_name text;
BEGIN
  -- Name aus E-Mail-Prefix ableiten
  default_name := COALESCE(
    NULLIF(split_part(NEW.email, '@', 1), ''),
    'Mein Workspace'
  );

  INSERT INTO public.workspaces (name, owner_id)
  VALUES (default_name, NEW.id)
  RETURNING id INTO new_workspace_id;

  INSERT INTO public.memberships (workspace_id, user_id, role)
  VALUES (new_workspace_id, NEW.id, 'owner');

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

-- Force RLS auch fuer supabase_admin/Eigentuemer NICHT — service_role bypasst ohnehin.
-- Fuer normale User greift die Policy.

-- Lookup-Helper: ist $auth.uid() Member des Workspaces?
CREATE OR REPLACE FUNCTION public.is_workspace_member(wid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE workspace_id = wid AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.workspace_role_of(wid uuid)
RETURNS public.workspace_role LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT role FROM public.memberships
  WHERE workspace_id = wid AND user_id = auth.uid()
  LIMIT 1;
$$;

-- workspaces: SELECT wenn Member
DROP POLICY IF EXISTS workspaces_select ON public.workspaces;
CREATE POLICY workspaces_select ON public.workspaces
  FOR SELECT USING (public.is_workspace_member(id));

-- workspaces: UPDATE/DELETE nur vom Owner (via Rolle)
DROP POLICY IF EXISTS workspaces_update_owner ON public.workspaces;
CREATE POLICY workspaces_update_owner ON public.workspaces
  FOR UPDATE USING (public.workspace_role_of(id) = 'owner');

DROP POLICY IF EXISTS workspaces_delete_owner ON public.workspaces;
CREATE POLICY workspaces_delete_owner ON public.workspaces
  FOR DELETE USING (public.workspace_role_of(id) = 'owner');

-- workspaces: INSERT nur vom eingeloggten User (als Owner)
DROP POLICY IF EXISTS workspaces_insert_self ON public.workspaces;
CREATE POLICY workspaces_insert_self ON public.workspaces
  FOR INSERT WITH CHECK (owner_id = auth.uid());

-- memberships: SELECT wenn Member im selben Workspace
DROP POLICY IF EXISTS memberships_select ON public.memberships;
CREATE POLICY memberships_select ON public.memberships
  FOR SELECT USING (public.is_workspace_member(workspace_id));

-- memberships: Schreiben nur von Owner/Admin
DROP POLICY IF EXISTS memberships_write_owner_admin ON public.memberships;
CREATE POLICY memberships_write_owner_admin ON public.memberships
  FOR ALL USING (public.workspace_role_of(workspace_id) IN ('owner','admin'))
  WITH CHECK (public.workspace_role_of(workspace_id) IN ('owner','admin'));

-- ─── Grants fuer API-Rollen ───────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memberships TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
GRANT ALL ON public.memberships TO service_role;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workspace_role_of(uuid) TO anon, authenticated, service_role;
