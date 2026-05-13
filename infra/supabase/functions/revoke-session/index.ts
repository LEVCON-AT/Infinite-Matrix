// revoke-session — Welle B.5.
//
// Beendet eine spezifische auth.sessions-Row des aufrufenden Users.
// AAL2-Step-Up Pflicht (Frische 5min) — Session-Mgmt ist sensibel
// (Account-Take-Over-Vektor wenn ohne).
//
// Server-autoritativ:
//   - Auth-Token valide, AAL2 fresh.
//   - sessionId im Body, muss user_id = claims.sub haben (sonst 403 —
//     User darf nur seine eigenen Sessions revoken).
//   - DELETE FROM auth.sessions WHERE id = sessionId AND user_id = claims.sub.
//
// Refresh-Tokens haengen per FK an der Session und CASCADE-en weg.
// Das aktuelle JWT bleibt bis zu seinem `exp` gueltig — aber refreshen
// klappt nicht mehr, also de-facto-Logout < `JWT_EXPIRY`-Fenster.
//
// Audit: account.session_revoked nach erfolgreichem Delete.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { type AuthClaims, requireAuth, requireFreshAal2 } from '../_shared/auth.ts';
import { errorResponse, jsonResponse } from '../_shared/cors.ts';

type RequestBody = {
  sessionId: string;
};

async function readBody(req: Request): Promise<RequestBody | null> {
  try {
    const b = (await req.json()) as Partial<RequestBody>;
    if (typeof b.sessionId !== 'string' || !b.sessionId) return null;
    return { sessionId: b.sessionId };
  } catch {
    return null;
  }
}

function getServiceClient(schema: 'public' | 'auth') {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: schema as never },
  });
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return errorResponse('POST required', 405);
  }
  const claims: AuthClaims = await requireAuth(req);
  requireFreshAal2(claims, 300);

  const body = await readBody(req);
  if (!body) {
    return errorResponse('Body must be { sessionId: string }', 422);
  }

  const authDb = getServiceClient('auth');

  // Ownership-Check zuerst — der DELETE-Filter wuerde sonst silent
  // 0 rows treffen und wir kennen den Grund nicht (existiert nicht /
  // gehoert anderem User).
  const { data: rows, error: selErr } = await authDb
    .from('sessions')
    .select('id, user_id')
    .eq('id', body.sessionId)
    .limit(1);
  if (selErr) {
    console.error('revoke-session select:', selErr);
    return errorResponse('Konnte Session nicht pruefen.', 500);
  }
  const row = (rows as Array<{ id: string; user_id: string }> | null)?.[0];
  if (!row) {
    return errorResponse('Session nicht gefunden.', 404);
  }
  if (row.user_id !== claims.sub) {
    return errorResponse('Diese Session gehoert nicht dir.', 403);
  }

  const { error: delErr } = await authDb.from('sessions').delete().eq('id', body.sessionId);
  if (delErr) {
    console.error('revoke-session delete:', delErr);
    return errorResponse('Konnte Session nicht beenden.', 500);
  }

  // Audit direkt — `log_account_event` haengt an `auth.uid()`, das aber
  // bei service-role-Client NULL ist. Wir schreiben deshalb mit
  // explizitem actor_id-Snapshot ins system_audit_log (das Pattern
  // analog zu delete-self-account/index.ts).
  const publicDb = getServiceClient('public');
  const { error: auditErr } = await publicDb.from('system_audit_log').insert({
    action: 'account.session_revoked',
    actor_id: claims.sub,
    workspace_id: null,
    workspace_name: null,
    payload: { session_id: body.sessionId },
  });
  if (auditErr) {
    console.error('revoke-session audit:', auditErr);
    // Nicht blocken.
  }

  return jsonResponse({ revoked: true, session_id: body.sessionId });
};

export default handler;
