// delete-self-account — Welle D.4 Account-Self-Service-Loeschung.
//
// Warum Edge-Function statt RPC: `auth.admin.deleteUser` ist nur mit
// service-role erreichbar. Die service-role darf NIE ins Frontend-JWT.
// Deshalb: Function laeuft mit service-role-Env, prueft selber dass
// der Caller der zu loeschende User ist + Fresh-AAL2-Status hat.
//
// Vor-Pruefungen (Server-autoritativ):
//   - Auth-Token valide.
//   - Fresh AAL2 (TOTP <5min) — analog requireFreshAal2 im Frontend.
//   - confirmEmail im Payload matched die JWT-Email (Tippfehler-Schutz).
//   - User ist NICHT alleiniger Owner aktiver Workspaces — sonst
//     verlieren andere Member den Workspace. RPC `user_owns_solo_workspaces`
//     liefert die Liste; nicht-leer = Block.
//
// Bei Erfolg:
//   - `account.deleted`-Audit-Eintrag (mit user_id-Snapshot).
//   - auth.admin.deleteUser → CASCADE auf alle FK-Tabellen
//     (memberships, user_profiles, atom_markers, etc.).
//
// Failure-Modes:
//   - 401: kein/invalid JWT, AAL1 statt AAL2, AAL2 stale.
//   - 422: confirmEmail-Mismatch oder Sole-Owner-Blocker.
//   - 500: auth.admin.deleteUser-Failure (selten — Postgres-Issue).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { type AuthClaims, requireAuth, requireFreshAal2 } from '../_shared/auth.ts';
import { errorResponse, jsonResponse } from '../_shared/cors.ts';

type RequestBody = {
  confirmEmail: string;
};

async function readBody(req: Request): Promise<RequestBody | null> {
  try {
    const b = (await req.json()) as Partial<RequestBody>;
    if (typeof b.confirmEmail !== 'string') return null;
    return { confirmEmail: b.confirmEmail.trim().toLowerCase() };
  } catch {
    return null;
  }
}

function getServiceClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
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
    return errorResponse('Body must be { confirmEmail: string }', 422);
  }
  if (!claims.email || body.confirmEmail !== claims.email.toLowerCase()) {
    return errorResponse(
      'confirmEmail muss exakt deiner aktuellen Account-Email entsprechen.',
      422,
    );
  }

  const supabase = getServiceClient();

  // Sole-Owner-Blocker: workspaces wo der User alleiniger owner und
  // andere Member aktiv sind. Wir lesen das via direktem SQL —
  // memberships hat eine bekannte Struktur (Migration 002).
  const { data: soloWs, error: soloErr } = await supabase
    .from('memberships')
    .select('workspace_id, role')
    .eq('user_id', claims.sub)
    .eq('role', 'owner');
  if (soloErr) {
    console.error('soloWs:', soloErr);
    return errorResponse('Konnte Workspace-Status nicht pruefen.', 500);
  }
  if (soloWs && soloWs.length > 0) {
    // Pro Workspace pruefen ob noch andere aktive Member existieren.
    for (const row of soloWs) {
      const { count, error: cntErr } = await supabase
        .from('memberships')
        .select('user_id', { count: 'exact', head: true })
        .eq('workspace_id', row.workspace_id)
        .neq('user_id', claims.sub)
        .is('deactivated_at', null);
      if (cntErr) {
        console.error('memberCount:', cntErr);
        return errorResponse('Konnte Mitglieder-Status nicht pruefen.', 500);
      }
      if ((count ?? 0) > 0) {
        return errorResponse(
          'Du bist alleiniger Owner eines Workspace mit anderen Mitgliedern. Bitte uebertrage erst die Eigentuemerschaft oder loesche den Workspace.',
          422,
        );
      }
    }
  }

  // Audit BEFORE delete — sonst gibt es kein record (CASCADE
  // entfernt actor_id auf NULL via ON DELETE SET NULL, das ist ok).
  const { error: auditErr } = await supabase.from('system_audit_log').insert({
    action: 'account.account_deleted',
    actor_id: claims.sub,
    workspace_id: null,
    workspace_name: null,
    payload: { email_domain: (claims.email ?? '').split('@')[1] ?? null },
  });
  if (auditErr) {
    console.error('audit:', auditErr);
    // Nicht blocken — Audit-Fehler darf den User-Loesch-Wunsch nicht
    // ueberstimmen. Aber loggen.
  }

  // Hard-Delete via admin-API. CASCADE laeuft auf user_profiles,
  // memberships (uebrige Workspaces — User war NICHT sole-owner dort),
  // atom_markers etc. (ON DELETE CASCADE im Schema).
  const { error: delErr } = await supabase.auth.admin.deleteUser(claims.sub);
  if (delErr) {
    console.error('admin.deleteUser:', delErr);
    return errorResponse('Account-Loeschung fehlgeschlagen.', 500);
  }

  return jsonResponse({ deleted: true, user_id: claims.sub });
};

export default handler;
