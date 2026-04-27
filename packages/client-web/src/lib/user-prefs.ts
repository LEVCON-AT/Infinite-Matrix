// User-Preferences DB-Sync — Phase-2-Sprint US.
//
// Liest/schreibt die public.user_preferences-Zeile fuer den aktuellen
// JWT-User. Single-Row pro User, prefs ist ein freies jsonb-Object;
// Migration 017 enthaelt die Tabelle + RLS-Policies (auth.uid() =
// user_id streng durchgesetzt).
//
// Strategie:
//   - loadUserPrefs(): live read mit isNetworkError-Fallback. Bei
//     Offline kein Throw — Caller behaelt seinen lokalen State.
//   - saveUserPrefs(prefs): UPSERT (insert oder update). Bei Offline
//     leise schlucken — beim naechsten Online wird per State-Change
//     erneut versucht. Kein safe-mutation-Wrapper, weil Settings nicht
//     security-kritisch sind und Conflict-Resolution per
//     Last-Write-Wins reicht (updated_at-Trigger).
//
// Bewusst KEIN Realtime-Subscribe: zwei offene Devices schreiben sich
// nicht in Echtzeit zu — bei Mount + Focus-Re-Sync erfolgt der
// Abgleich. Bei Bedarf spaeter erweitern.

import { isNetworkError } from './mutation-queue';
import { supabase } from './supabase';

export type UserPrefs = Record<string, unknown>;

export type UserPrefsRow = {
  prefs: UserPrefs;
  updated_at: string;
};

// Read: gibt null zurueck wenn (a) noch keine Zeile existiert, (b) der
// Read offline scheitert. Beides ist nicht-erronisch — Caller behaelt
// seinen lokalen State weiter.
export async function loadUserPrefs(): Promise<UserPrefsRow | null> {
  try {
    const { data, error } = await supabase
      .from('user_preferences')
      .select('prefs, updated_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      prefs: (data.prefs as UserPrefs) ?? {},
      updated_at: data.updated_at as string,
    };
  } catch (err) {
    if (isNetworkError(err)) return null;
    console.error('loadUserPrefs:', err);
    return null;
  }
}

// Write: UPSERT auf der Single-Row. user_id wird vom auth.uid()-Default
// aus der DB nicht gesetzt (existiert kein DEFAULT) — wir muessen es
// explizit aus der Session lesen. Bei Offline schlucken wir den Fehler;
// der naechste State-Change versucht's erneut.
export async function saveUserPrefs(prefs: UserPrefs): Promise<void> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id;
    if (!userId) return;
    const { error } = await supabase
      .from('user_preferences')
      .upsert({ user_id: userId, prefs }, { onConflict: 'user_id' });
    if (error) throw error;
  } catch (err) {
    if (isNetworkError(err)) return;
    console.error('saveUserPrefs:', err);
  }
}
