-- ═══════════════════════════════════════════════════════════════
-- WV.B.2 — links-EXTENDED (provider/provider_meta/symbol_override/click_count)
--
-- Konzept-Verankerung: §12.3.2 (15 Provider) + §12.3.5 (symbol_override).
--
-- Was:
--   1. ADD provider text mit CHECK (15 Werte).
--   2. ADD provider_meta jsonb (Provider-spezifische Metadaten).
--   3. ADD symbol_override text (User-Override fuer Auto-Symbol).
--   4. ADD click_count int + Increment-Trigger.
--   5. DROP type (clean-cut, Daten via provider='url'-Default vorab gesetzt).
--
-- Clean-cut-Pflicht (Memory `feedback_clean_cut_no_prod_data.md`):
-- User hat 2026-05-06 bestaetigt „keine relevanten Daten". Wir setzen
-- alle bestehenden Rows auf provider='url' und droppen die alte
-- type-Spalte direkt. Kein Dual-Write.
--
-- Schema-Heptad pro links (siehe `architektur.md` §3):
--   - Schema:       diese Migration.
--   - Types:        lib/types.ts — LinkRow.type → LinkRow.provider.
--   - Mutations:    lib/mutations.ts existing addLink/updateLink/deleteLink
--                   bekommen provider-Pflicht-Param.
--   - Cache:        offline-cache.ts — DB_VERSION-Bump (Schema-Drift).
--   - Realtime:     existing publication bleibt — REPLICA IDENTITY FULL eh
--                   schon via Migration 045.
--   - Export:       export.ts/subtree-import.ts traegt links auch nach
--                   Spalten-Rename ohne Re-Cast (jsonb).
--   - MCP:          existing link.add/delete bekommt provider-Param.
--   - Channel-Bridge: pro Link-Provider (=Provider-Detection,
--                   §12.3.2 — Welle B basiert; volle OAuth-Bridges
--                   Welle D).
--
-- Apply:
--   docker exec matrix-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f 073_links_extended.sql
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── Stage 1: ADD-Spalten (alle nullable bzw. mit Default) ────
ALTER TABLE public.links ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE public.links ADD COLUMN IF NOT EXISTS provider_meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.links ADD COLUMN IF NOT EXISTS symbol_override text;
ALTER TABLE public.links ADD COLUMN IF NOT EXISTS click_count integer NOT NULL DEFAULT 0;

-- ─── Stage 2: provider-Werte fuellen ──────────────────────────
-- Default fuer existing Rows aus type-Spalte: type='mail' → 'mail',
-- type='url' → 'url'. Andere Werte gibt es nicht (Enum link_type).
-- Heuristik fuer Brand-Provider (onenote/notion/...) entfaellt —
-- User hat keine Bestandsdaten (Clean-Cut, §12.3.2 Hinweis).
UPDATE public.links SET provider = type::text WHERE provider IS NULL;

-- Stage 3: provider NOT NULL + CHECK (15 Werte aus §12.3.2).
ALTER TABLE public.links ALTER COLUMN provider SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'links_provider_check'
      AND conrelid = 'public.links'::regclass
  ) THEN
    ALTER TABLE public.links
      ADD CONSTRAINT links_provider_check
      CHECK (provider IN (
        'url',
        'mail',
        'mail-generic',
        'onenote',
        'notion',
        'onedrive',
        'drive',
        'dropbox',
        'nextcloud',
        'slack',
        'teams',
        'whatsapp',
        'discord',
        'telegram',
        'filesystem'
      ));
  END IF;
END $$;

-- ─── Stage 4: type-Spalte droppen ─────────────────────────────
ALTER TABLE public.links DROP COLUMN IF EXISTS type;
-- public.link_type ENUM bleibt fuers erste — falls noch andere Tabellen
-- es referenzieren. DROP TYPE separat wenn nichts mehr darauf zeigt.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE t.typname = 'link_type' AND a.attnum > 0
  ) THEN
    DROP TYPE IF EXISTS public.link_type;
  END IF;
END $$;

-- ─── Stage 5: Click-Counter-Trigger ───────────────────────────
-- Inkrement-RPC fuer Frontend (analog atoms-Click-Tracking). UI ruft
-- mcp_increment_link_click_count(link_id) — Trigger nicht noetig, das
-- ist eine Mutation-RPC.
CREATE OR REPLACE FUNCTION public.mcp_increment_link_click_count(p_link_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.links
  SET click_count = click_count + 1
  WHERE id = p_link_id
    AND public.is_workspace_member(workspace_id)
  RETURNING click_count INTO v_count;
  IF v_count IS NULL THEN
    RAISE EXCEPTION 'link not found or no access';
  END IF;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mcp_increment_link_click_count(uuid) TO authenticated;

COMMENT ON COLUMN public.links.provider IS
  'WV.B.2: 15 Provider-Werte aus Konzept §12.3.2. Bestimmt Auto-Symbol-Resolution + Bridge-Konfig in Welle D. Default url. Replaces former type-Spalte (link_type).';
COMMENT ON COLUMN public.links.provider_meta IS
  'WV.B.2: Provider-spezifische Metadaten (z.B. {channel_id, thread_ts} bei slack, {notebook_id, section_id, page_id} bei onenote). Keys konvergieren mit Welle D Bridge-Layern.';
COMMENT ON COLUMN public.links.symbol_override IS
  'WV.B.2: User-Override fuer das Auto-Symbol des Provider/Field-Type. NULL = Auto-Logik (siehe lib/symbol-resolution.ts §12.3.4).';
COMMENT ON COLUMN public.links.click_count IS
  'WV.B.2: Click-Tracking fuer „beliebte Links"-Sortierung. Inkrement via mcp_increment_link_click_count RPC.';

COMMIT;
