// Sessions-Client (Welle B.5). Spricht die Edge-Functions
// `list-my-sessions` + `revoke-session` an.
//
// Sync-online, kein Cache — Sessions sind kurzlebig + sicherheits-
// kritisch. UI laedt frisch jedes Mal.

import { callEdgeFunction } from './edge-functions';
import { supabase } from './supabase';

export type SessionRow = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string | null;
  refreshed_at: string | null;
  not_after: string | null;
  aal: string | null;
  user_agent: string | null;
  ip: string | null;
};

export async function listMySessions(): Promise<SessionRow[]> {
  const { data, error } = await callEdgeFunction<unknown, { sessions: SessionRow[] }>(
    'list-my-sessions',
    {},
  );
  if (error) throw new Error(error.message);
  return data?.sessions ?? [];
}

export async function revokeSession(sessionId: string): Promise<void> {
  const { error } = await callEdgeFunction<{ sessionId: string }, { revoked: true }>(
    'revoke-session',
    { sessionId },
  );
  if (error) {
    const msg =
      error.status === 401
        ? 'Step-Up erforderlich (Authenticator-Code).'
        : error.status === 403
          ? 'Diese Session gehoert nicht dir.'
          : error.status === 404
            ? 'Session bereits beendet.'
            : 'Session konnte nicht beendet werden.';
    throw new Error(msg);
  }
}

// Identifiziert die "aktuelle" Session in der Liste. Supabase-JS legt
// die session_id nicht direkt in session, aber die access_token-JWT
// hat ein `session_id`-Claim seit GoTrue v2.10+. Beim Self-Hosted
// klappt das — wir parsen den Claim out-of-band.
export async function getCurrentSessionId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1])) as { session_id?: string };
    return payload.session_id ?? null;
  } catch {
    return null;
  }
}
