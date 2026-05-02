-- ═══════════════════════════════════════════════════════════════
-- Calendar V2 — Subscription-Token fuer Live-ICS-Feed
--
-- User klickt "Calendar abonnieren" in Settings → wir generieren ein
-- Token + zeigen die URL `https://ics.matrix.levcon.at/{token}.ics` an.
-- Der User abonniert die URL in Outlook/Google/Apple Calendar; deren
-- Client pollt periodisch und holt die aktuelle ICS.
--
-- Token: 32 byte gen_random_bytes, hex-encoded (64 char URL-safe).
-- Plain in der DB — der Wert ist URL-zugaenglich, kein Secret. RLS
-- schuetzt: nur der besitzende User sieht/managed seine Tokens.
--
-- Pro (user_id, workspace_id) ist genau ein aktiver Token erlaubt
-- (UNIQUE-Constraint). Re-Issue ueberschreibt den alten — User-flow
-- ist "alten ungueltig machen" via revoke + neuen anlegen.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.calendar_subscriptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  token             text NOT NULL UNIQUE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_accessed_at  timestamptz,
  UNIQUE (user_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS calendar_subscriptions_token_idx
  ON public.calendar_subscriptions (token);

ALTER TABLE public.calendar_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_subscriptions FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_subscriptions_self_select ON public.calendar_subscriptions;
CREATE POLICY calendar_subscriptions_self_select ON public.calendar_subscriptions
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS calendar_subscriptions_no_direct_writes ON public.calendar_subscriptions;
CREATE POLICY calendar_subscriptions_no_direct_writes ON public.calendar_subscriptions
  FOR INSERT WITH CHECK (false);

DROP POLICY IF EXISTS calendar_subscriptions_no_direct_deletes ON public.calendar_subscriptions;
CREATE POLICY calendar_subscriptions_no_direct_deletes ON public.calendar_subscriptions
  FOR DELETE USING (false);

-- ─── RPCs ──────────────────────────────────────────────────────

-- create_calendar_subscription: anlegen oder rotieren. Liefert URL.
-- Der User darf in dem Workspace Member sein (sonst RLS-Block).
CREATE OR REPLACE FUNCTION public.create_calendar_subscription(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_token text;
  v_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
     WHERE workspace_id = p_workspace_id
       AND user_id = v_actor
       AND deactivated_at IS NULL
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_token := encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.calendar_subscriptions (user_id, workspace_id, token)
    VALUES (v_actor, p_workspace_id, v_token)
    ON CONFLICT (user_id, workspace_id) DO UPDATE
      SET token = EXCLUDED.token, created_at = now(), last_accessed_at = NULL
    RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'token', v_token);
END $$;

GRANT EXECUTE ON FUNCTION public.create_calendar_subscription(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_calendar_subscription(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count int;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  WITH d AS (
    DELETE FROM public.calendar_subscriptions
     WHERE user_id = v_actor AND workspace_id = p_workspace_id
     RETURNING 1
  )
  SELECT count(*) INTO v_count FROM d;
  RETURN jsonb_build_object('deleted', v_count);
END $$;

GRANT EXECUTE ON FUNCTION public.revoke_calendar_subscription(uuid) TO authenticated;

-- get_my_calendar_subscription: gibt das aktive Token zurueck (oder NULL).
-- Frontend checked das beim Laden der Settings-Seite.
CREATE OR REPLACE FUNCTION public.get_my_calendar_subscription(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token text;
  v_created timestamptz;
  v_accessed timestamptz;
BEGIN
  SELECT token, created_at, last_accessed_at INTO v_token, v_created, v_accessed
    FROM public.calendar_subscriptions
   WHERE user_id = auth.uid() AND workspace_id = p_workspace_id;
  IF v_token IS NULL THEN
    RETURN jsonb_build_object('exists', false);
  END IF;
  RETURN jsonb_build_object(
    'exists', true,
    'token', v_token,
    'created_at', v_created,
    'last_accessed_at', v_accessed
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_my_calendar_subscription(uuid) TO authenticated;

-- ─── Service-Helper: ICS-Generator ─────────────────────────────
-- Der Calendar-Feed-Service ruft diese RPC mit service-role-Key.
-- Liefert Liste der Events fuer den Token-User in dem Workspace.
-- Token-Lookup + last_accessed_at-Update sind im Service (TCP, nicht
-- RPC) damit ein invalides Token einen 404 statt Errors returnt.
CREATE OR REPLACE FUNCTION public.calendar_feed_events(p_token text)
RETURNS TABLE(
  event_id    uuid,
  event_kind  text,
  label       text,
  description text,
  start_date  date,
  start_time  time,
  end_date    date,
  end_time    time,
  all_day     boolean,
  rrule       text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id uuid;
  v_workspace_id uuid;
BEGIN
  SELECT user_id, workspace_id INTO v_user_id, v_workspace_id
    FROM public.calendar_subscriptions WHERE token = p_token;
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Touch last_accessed_at (best-effort, nicht atomisch).
  UPDATE public.calendar_subscriptions
     SET last_accessed_at = now()
   WHERE token = p_token;

  -- Tasks mit deadline (workspace-weit, RLS uebergehen via DEFINER).
  RETURN QUERY
  SELECT
    t.id AS event_id,
    'task'::text AS event_kind,
    t.label AS label,
    t.note AS description,
    t.deadline AS start_date,
    NULL::time AS start_time,
    t.deadline + interval '1 day' AS end_date,
    NULL::time AS end_time,
    true AS all_day,
    NULL::text AS rrule
  FROM public.tasks t
  WHERE t.workspace_id = v_workspace_id AND t.deadline IS NOT NULL;
END $$;

GRANT EXECUTE ON FUNCTION public.calendar_feed_events(text) TO authenticated, anon;

COMMENT ON TABLE public.calendar_subscriptions IS
  'Calendar V2 — User-eigene ICS-Feed-Tokens pro Workspace.';
COMMENT ON FUNCTION public.calendar_feed_events IS
  'Service-Helper fuer calendar-feed Node-Service. Token-basiert, RLS-bypass via DEFINER.';
