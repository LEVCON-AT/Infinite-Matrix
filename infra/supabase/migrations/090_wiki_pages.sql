-- ═══════════════════════════════════════════════════════════════
-- Welle E.1 — Wiki/Doku-Sektion (Schema-Foundation)
--
-- Eine Wiki-Seite kann zu zwei Welten gehoeren:
--   - workspace_id IS NULL  → Plattform-Doku (`/help/...`, Read-only
--     fuer alle authenticated, Write nur fuer platform_admin)
--   - workspace_id NOT NULL → Workspace-Wiki (Read fuer Workspace-Member,
--     Write fuer can_write_workspace)
--
-- Hierarchie ueber `parent_id` (self-referential FK). 3-4 Ebenen sind
-- der typische Use-Case (Sektion → Unterabschnitt → Seite). Tiefe wird
-- nicht hart eingeschraenkt — die UI rendert eine Tree-View, sehr tiefe
-- Baeume sind ein UX-Problem, kein Schema-Problem.
--
-- Slug + Title:
--   - `slug` ist URL-Bestandteil. Unique pro (parent_id, scope-Tupel).
--   - `title` ist die Anzeige (UTF-8, beliebige Sprache).
--   - Beide werden vom Frontend gepflegt (kein DB-Trigger noetig).
--
-- Position:
--   - Float-Position pro Sibling-Level (gleicher parent_id). Pattern
--     wie kb_cards / nodes (architektur.md §4.5).
--
-- Volltextsuche:
--   - GIN-Index auf to_tsvector(title || ' ' || content_md). Welle E.2
--     wird das ueber einen RPC ausfahren.
--
-- Migration 089 hat task_dependencies; Migration 090 ist Wiki.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.wiki_pages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  parent_id     uuid REFERENCES public.wiki_pages(id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  slug          text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'),
  content_md    text NOT NULL DEFAULT '',
  position      double precision NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wiki_pages_content_size CHECK (length(content_md) <= 256000)
);

-- Slug-Eindeutigkeit pro Sibling-Level. Wir partitionieren auf
-- (workspace_id, parent_id) — getrennte Trees pro Workspace + die
-- Plattform-Welt (workspace_id IS NULL).
-- Postgres-Unique-Indexes nullen mehrere NULLs nicht als gleich; das
-- ist hier OK, weil Wurzeln auf gleicher Ebene (parent_id IS NULL)
-- ebenfalls eindeutige slugs brauchen. Wir nutzen COALESCE-Trick.
CREATE UNIQUE INDEX IF NOT EXISTS wiki_pages_sibling_slug_uq
  ON public.wiki_pages (
    COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(parent_id,    '00000000-0000-0000-0000-000000000000'::uuid),
    slug
  );

CREATE INDEX IF NOT EXISTS wiki_pages_ws_idx
  ON public.wiki_pages(workspace_id)
  WHERE workspace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS wiki_pages_parent_idx
  ON public.wiki_pages(parent_id);
CREATE INDEX IF NOT EXISTS wiki_pages_platform_idx
  ON public.wiki_pages(workspace_id)
  WHERE workspace_id IS NULL;

-- Volltextsuche-Index. Nutzt einfache Konkatenation; Sprache 'simple'
-- damit DE/EN/FR-Inhalte gleichermassen indexiert werden ohne explizite
-- Stemming-Locale (analog notifications-Search-Pattern).
CREATE INDEX IF NOT EXISTS wiki_pages_search_idx
  ON public.wiki_pages
  USING gin (to_tsvector('simple', title || ' ' || content_md));

COMMENT ON TABLE public.wiki_pages IS
  'Welle E.1 — Hierarchische Wiki-Seiten. workspace_id IS NULL = Plattform-Doku, sonst Workspace-Wiki.';
COMMENT ON COLUMN public.wiki_pages.slug IS
  'URL-Slug, eindeutig innerhalb der Geschwister-Ebene (gleiches workspace_id + parent_id). Lowercase, alphanumerisch + Hyphen.';
COMMENT ON COLUMN public.wiki_pages.content_md IS
  'Markdown-Inhalt. 256 KB Cap — fuer reine Dokumentation reichlich, schuetzt vor versehentlichen Mega-Uploads.';

-- updated_at-Trigger (Re-Use der existierenden set_updated_at-Function
-- aus Migration 001).
DROP TRIGGER IF EXISTS wiki_pages_set_updated_at ON public.wiki_pages;
CREATE TRIGGER wiki_pages_set_updated_at
  BEFORE UPDATE ON public.wiki_pages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── RLS aktivieren ──────────────────────────────────────────
ALTER TABLE public.wiki_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wiki_pages FORCE ROW LEVEL SECURITY;

-- SELECT:
--   - Plattform-Pages (workspace_id IS NULL): jeder eingeloggte User.
--   - Workspace-Pages: nur Workspace-Member.
DROP POLICY IF EXISTS wiki_pages_select ON public.wiki_pages;
CREATE POLICY wiki_pages_select ON public.wiki_pages
  FOR SELECT
  USING (
    workspace_id IS NULL
    OR public.is_workspace_member(workspace_id)
  );

-- INSERT / UPDATE / DELETE:
--   - Plattform-Pages: nur platform_admin (helper `is_platform_admin`
--     existiert seit Migration 042).
--   - Workspace-Pages: can_write_workspace (owner/admin/editor).
DROP POLICY IF EXISTS wiki_pages_write ON public.wiki_pages;
CREATE POLICY wiki_pages_write ON public.wiki_pages
  FOR ALL
  USING (
    CASE
      WHEN workspace_id IS NULL THEN public.is_platform_admin()
      ELSE public.can_write_workspace(workspace_id)
    END
  )
  WITH CHECK (
    CASE
      WHEN workspace_id IS NULL THEN public.is_platform_admin()
      ELSE public.can_write_workspace(workspace_id)
    END
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wiki_pages TO authenticated;
GRANT ALL ON public.wiki_pages TO service_role;

-- ─── Smoke-Verifikation (manuell nach Apply) ─────────────────
-- 1. \d+ public.wiki_pages
-- 2. SELECT relrowsecurity, relforcerowsecurity FROM pg_class
--      WHERE relname = 'wiki_pages'; -- beide true
-- 3. -- Duplicate-Slug-Sibling muss raisen:
--    INSERT (parent_id=NULL, ws=NULL, slug='intro'), INSERT (gleich); 2. raised unique_violation.
-- 4. -- Slug-Format muss raisen:
--    INSERT (slug='Hallo Welt'); → check_violation
