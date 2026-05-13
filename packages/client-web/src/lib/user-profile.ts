// User-Profile (Welle D.3) — Bio + Timezone + Language.
//
// Per-User-Profil-Daten. Lazy upsert: wenn der User noch keine Row
// hat, legt setUserProfile beim ersten Update eine an (via upsert).
//
// Sync-online, kein safe-mutation-Wrapper — Profile-Daten sind nicht
// in der ECS-Atom-Zwiebel und brauchen keinen Offline-Replay-Pfad
// (analog Account-Identity-Mutations).

import { supabase } from './supabase';

export type UserProfileRow = {
  user_id: string;
  bio: string | null;
  timezone: string | null;
  language: string | null;
  // Welle D.2 — Public Storage-URL aus bucket 'avatars'. NULL = kein
  // Avatar gesetzt; Render-Stellen fallen auf den email/name-basierten
  // Initial-Avatar zurueck.
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

// Lazy-Read: Row kann fehlen (User hat nie was gesetzt) → null.
export async function fetchMyUserProfile(userId: string): Promise<UserProfileRow | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as UserProfileRow | null) ?? null;
}

export type UserProfilePatch = {
  bio?: string | null;
  timezone?: string | null;
  language?: string | null;
  avatar_url?: string | null;
};

// Upsert-Update. Leer-Strings werden auf NULL normalisiert.
export async function setUserProfile(userId: string, patch: UserProfilePatch): Promise<void> {
  const payload: Record<string, unknown> = { user_id: userId };
  if ('bio' in patch) {
    const v = patch.bio?.trim() || null;
    if (v && v.length > 500) throw new Error('Bio maximal 500 Zeichen.');
    payload.bio = v;
  }
  if ('timezone' in patch) {
    const v = patch.timezone?.trim() || null;
    if (v && v.length > 64) throw new Error('Timezone maximal 64 Zeichen.');
    payload.timezone = v;
  }
  if ('language' in patch) {
    const v = patch.language?.trim() || null;
    if (v && !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(v)) {
      throw new Error('Sprach-Code ungueltig (z.B. de, en, de-DE).');
    }
    payload.language = v;
  }
  if ('avatar_url' in patch) {
    const v = patch.avatar_url?.trim() || null;
    if (v && v.length > 1024) throw new Error('Avatar-URL zu lang.');
    payload.avatar_url = v;
  }
  const { error } = await supabase.from('user_profiles').upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
}
