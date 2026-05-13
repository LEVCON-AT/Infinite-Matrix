// list-my-sessions — Welle B.5.
//
// Liefert die aktiven Sessions des aufrufenden Users (auth.sessions-
// Tabelle). Pure Read, kein AAL2-Step-Up noetig — wer eingeloggt ist
// darf seine eigenen Sessions sehen. Detail-Reduktion: kein Token-
// Material, nur Metadaten (IP, UA, aal, created_at, updated_at).
//
// Self-hosted Schema: auth.sessions hat
//   id, user_id, created_at, updated_at, factor_id, aal, not_after,
//   refreshed_at, user_agent, ip
//
// Wir filtern auf nicht-abgelaufen (`not_after IS NULL OR not_after > now()`).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { type AuthClaims, requireAuth } from '../_shared/auth.ts';
import { errorResponse, jsonResponse } from '../_shared/cors.ts';

type SessionRow = {
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

function getServiceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    // service-role hat Default-Schema public — fuer auth-Tabellen brauchen
    // wir den auth-Schema-Override per Query.
    db: { schema: 'auth' as never },
  });
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse('GET or POST required', 405);
  }
  const claims: AuthClaims = await requireAuth(req);
  const supabase = getServiceClient();

  // auth.sessions querien — Supabase-JS mit `db.schema = 'auth'`-Override.
  // Wir nutzen .from('sessions') in dem Client.
  const { data, error } = await supabase
    .from('sessions')
    .select('id, user_id, created_at, updated_at, refreshed_at, not_after, aal, user_agent, ip')
    .eq('user_id', claims.sub)
    .order('refreshed_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('list-my-sessions:', error);
    return errorResponse('Konnte Sessions nicht laden.', 500);
  }

  const now = Date.now();
  const rows = ((data as SessionRow[] | null) ?? []).filter((s) => {
    if (!s.not_after) return true;
    return new Date(s.not_after).getTime() > now;
  });

  return jsonResponse({ sessions: rows });
};

export default handler;
