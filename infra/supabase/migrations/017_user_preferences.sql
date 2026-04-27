-- 017_user_preferences.sql — User-spezifische App-Settings DB-Sync.
--
-- Phase-2-Sprint "DB-Sync Activity-Prefs". Bisher leben vis-Settings +
-- ActivityLevel nur in localStorage pro Browser-Profil. Heisst: User
-- aendert auf Device A "Aktivitaet aus", Device B sieht weiter "present".
-- Speziell ActivityLevel ist Multi-User-Awareness-Setting — muss konsistent
-- pro User sein, nicht pro Browser.
--
-- Schema: eine Zeile pro User, prefs als jsonb (offen halten — dieser
-- Sprint laed nur das aus settings.ts, kuenftige Sprints koennen Theme,
-- Notifications, etc. mit-aufnehmen ohne Schema-Aenderung).
-- updated_at fuer Last-Write-Wins-Konflikt-Aufloesung.
--
-- RLS: streng auth.uid() = user_id. Kein Cross-User-Read, kein
-- Cross-User-Write. ON DELETE CASCADE auf auth.users — User-Delete
-- raeumt auch die Prefs auf.

CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prefs      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id)
);

COMMENT ON TABLE public.user_preferences IS
  'User-spezifische Praeferenzen (vis-Settings, ActivityLevel, ...). DB-Sync-Quelle fuer settings.ts.';
COMMENT ON COLUMN public.user_preferences.prefs IS
  'Frei strukturiertes jsonb-Object. Aktuell: { vis: {<key>: edit|always|never}, activity: { level: off|present|full } }.';

-- updated_at-Trigger (set_updated_at-Helper aus 001).
DROP TRIGGER IF EXISTS user_preferences_set_updated_at ON public.user_preferences;
CREATE TRIGGER user_preferences_set_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS: nur eigener Datensatz.
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_preferences_self_select ON public.user_preferences;
CREATE POLICY user_preferences_self_select ON public.user_preferences
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_preferences_self_insert ON public.user_preferences;
CREATE POLICY user_preferences_self_insert ON public.user_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_preferences_self_update ON public.user_preferences;
CREATE POLICY user_preferences_self_update ON public.user_preferences
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_preferences_self_delete ON public.user_preferences;
CREATE POLICY user_preferences_self_delete ON public.user_preferences
  FOR DELETE USING (auth.uid() = user_id);
