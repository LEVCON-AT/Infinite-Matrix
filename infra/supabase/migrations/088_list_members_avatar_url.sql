-- 088_list_members_avatar_url.sql — D.2-V2 Avatar everywhere.
--
-- Erweitert list_workspace_members um avatar_url aus user_profiles
-- (LEFT JOIN — User ohne user_profiles-Row liefert NULL). Damit koennen
-- TreeAvatar / AvatarStack / Marker-Tooltip die echten Avatars rendern
-- statt nur die email/name-Initialen.
--
-- Schema-Bruch fuer TABLE-Returning-Funktion: DROP + CREATE noetig.

DROP FUNCTION IF EXISTS public.list_workspace_members(uuid);
CREATE OR REPLACE FUNCTION public.list_workspace_members(p_workspace_id uuid)
RETURNS TABLE (
  user_id        uuid,
  email          text,
  display_name   text,
  avatar_url     text,
  role           public.workspace_role,
  joined_at      timestamptz,
  deactivated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_role public.workspace_role;
BEGIN
  v_role := public.workspace_role_of(p_workspace_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
    SELECT
      m.user_id,
      u.email::text,
      NULLIF(u.raw_user_meta_data->>'display_name', '')::text,
      up.avatar_url,
      m.role,
      m.created_at,
      m.deactivated_at
    FROM public.memberships m
    JOIN auth.users u ON u.id = m.user_id
    LEFT JOIN public.user_profiles up ON up.user_id = m.user_id
    WHERE m.workspace_id = p_workspace_id
    ORDER BY
      m.deactivated_at NULLS FIRST,
      CASE m.role
        WHEN 'owner'   THEN 0
        WHEN 'admin'   THEN 1
        WHEN 'editor'  THEN 2
        WHEN 'viewer'  THEN 3
      END,
      m.created_at;
END
$$;

GRANT EXECUTE ON FUNCTION public.list_workspace_members(uuid) TO authenticated, service_role;
