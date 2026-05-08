-- ═══════════════════════════════════════════════════════════════
-- WV.D.1 — user_oauth_tokens + widget_external_channels (Channel-Bridges)
--
-- Konzept §13 (Channel-Bridges) + §15 Heptad-Slot 8.
--
-- Tabellen:
--   user_oauth_tokens — Token-Storage pro (User × Provider). Tokens
--     verschluesselt (pgp_sym_encrypt mit app.ai_master_key, analog
--     user_ai_providers aus Phase 2).
--   widget_external_channels — Verknuepft template_widgets zu einem
--     externen Provider-Ref (thread_id, channel_id, folder_id etc).
--     Tokens bleiben User-Privat — der calling User authentifiziert
--     mit eigenem user_oauth_tokens-Eintrag.
--
-- Provider-Liste (V1 + V2-Backlog):
--   V1: outlook, gmail, mail-generic, onenote, onedrive, drive,
--       dropbox, nextcloud, slack, teams, discord, whatsapp, telegram
--   V2: protonmail, pcloud, kdrive, magentacloud, tresorit, mailbox-org,
--       notion (DB-Row+Page Sync deferred §13.2)
--
-- RLS:
--   user_oauth_tokens: SELECT/WRITE nur Owner (user_id = auth.uid()).
--   widget_external_channels: SELECT alle Workspace-Members,
--     WRITE per can_write_workspace.
--
-- Realtime: REPLICA IDENTITY FULL fuer beide Tabellen
--   + supabase_realtime publication.
--
-- Apply (User-Go-Pflicht):
--   docker exec matrix-supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 -f 077_user_oauth_tokens.sql
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ─── Provider-Whitelist (V1 + V2-flag-erweiterbar) ──────────────
-- Neue Provider werden via ALTER TYPE hinzugefuegt — V1 13 Werte.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'channel_provider') THEN
    CREATE TYPE public.channel_provider AS ENUM (
      'outlook',
      'gmail',
      'mail-generic',
      'onenote',
      'onedrive',
      'drive',
      'dropbox',
      'nextcloud',
      'slack',
      'teams',
      'discord',
      'whatsapp',
      'telegram'
    );
  END IF;
END $$;

-- ─── user_oauth_tokens ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_oauth_tokens (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider                      public.channel_provider NOT NULL,
  -- Verschluesselte Token (pgp_sym_encrypt mit app.ai_master_key).
  -- Plaintext landet NIE in dieser Tabelle.
  access_token_encrypted        bytea NOT NULL,
  refresh_token_encrypted       bytea NULL,
  -- mail-generic / IMAP+SMTP: kein OAuth, sondern App-Password.
  -- generic_credentials_encrypted haelt {imap_host, smtp_host,
  -- username, app_password} als verschluesseltes JSON.
  generic_credentials_encrypted bytea NULL,
  expires_at                    timestamptz NULL,
  -- OAuth-Scopes als Array — fuer Cross-Check ob Re-Auth noetig
  -- (z.B. wenn User Calendar-Write-Scope nachtraeglich erfordert).
  scopes                        text[] NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_oauth_tokens_unique_per_user_provider UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS user_oauth_tokens_user_idx
  ON public.user_oauth_tokens(user_id);

-- updated_at-Trigger (Pattern aus existing Schema).
CREATE OR REPLACE FUNCTION public._user_oauth_tokens_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS user_oauth_tokens_touch_updated_at ON public.user_oauth_tokens;
CREATE TRIGGER user_oauth_tokens_touch_updated_at
  BEFORE UPDATE ON public.user_oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION public._user_oauth_tokens_touch_updated_at();

-- ─── widget_external_channels ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.widget_external_channels (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  widget_id       uuid NOT NULL REFERENCES public.template_widgets(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider        public.channel_provider NOT NULL,
  -- Provider-Native-Identifier (z.B. {thread_id, folder_id, channel_id}).
  -- Format pro Provider unterschiedlich — wir typisieren nicht.
  external_ref    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT widget_external_channels_unique_per_widget UNIQUE (widget_id, provider)
);

CREATE INDEX IF NOT EXISTS widget_external_channels_workspace_idx
  ON public.widget_external_channels(workspace_id);
CREATE INDEX IF NOT EXISTS widget_external_channels_provider_idx
  ON public.widget_external_channels(provider);

-- ─── RLS ───────────────────────────────────────────────────────
ALTER TABLE public.user_oauth_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_oauth_tokens_select ON public.user_oauth_tokens;
CREATE POLICY user_oauth_tokens_select ON public.user_oauth_tokens
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_oauth_tokens_insert ON public.user_oauth_tokens;
CREATE POLICY user_oauth_tokens_insert ON public.user_oauth_tokens
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_oauth_tokens_update ON public.user_oauth_tokens;
CREATE POLICY user_oauth_tokens_update ON public.user_oauth_tokens
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_oauth_tokens_delete ON public.user_oauth_tokens;
CREATE POLICY user_oauth_tokens_delete ON public.user_oauth_tokens
  FOR DELETE
  USING (user_id = auth.uid());

ALTER TABLE public.widget_external_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS widget_external_channels_select ON public.widget_external_channels;
CREATE POLICY widget_external_channels_select ON public.widget_external_channels
  FOR SELECT
  USING (is_workspace_member(workspace_id));

DROP POLICY IF EXISTS widget_external_channels_insert ON public.widget_external_channels;
CREATE POLICY widget_external_channels_insert ON public.widget_external_channels
  FOR INSERT
  WITH CHECK (can_write_workspace(workspace_id));

DROP POLICY IF EXISTS widget_external_channels_update ON public.widget_external_channels;
CREATE POLICY widget_external_channels_update ON public.widget_external_channels
  FOR UPDATE
  USING (is_workspace_member(workspace_id))
  WITH CHECK (can_write_workspace(workspace_id));

DROP POLICY IF EXISTS widget_external_channels_delete ON public.widget_external_channels;
CREATE POLICY widget_external_channels_delete ON public.widget_external_channels
  FOR DELETE
  USING (can_write_workspace(workspace_id));

-- ─── Realtime ──────────────────────────────────────────────────
ALTER TABLE public.user_oauth_tokens REPLICA IDENTITY FULL;
ALTER TABLE public.widget_external_channels REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    -- user_oauth_tokens NICHT in Realtime — sensible Daten, kein
    -- Cross-Tab-Bedarf. Mutation-Refresh laeuft per Caller.
    EXECUTE format(
      'ALTER PUBLICATION supabase_realtime ADD TABLE %s',
      'public.widget_external_channels'
    );
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

COMMENT ON TABLE public.user_oauth_tokens IS
  'WV.D.1: OAuth-Token-Storage pro (User × Provider). pgp_sym_encrypt mit app.ai_master_key. RLS: nur Owner (user_id=auth.uid()).';
COMMENT ON TABLE public.widget_external_channels IS
  'WV.D.1: Widget zu externem Provider-Ref (Channel/Thread/Folder/Page). Tokens bleiben User-Privat in user_oauth_tokens — Bridge-Auth pro calling User.';
