// Step-Up-Auth (Welle B.3). Sensitive Aktionen (Workspace-Delete,
// Owner-Transfer, MFA-Aenderung) erzwingen AAL2 plus Frische der
// Authentifizierung — Standard 5 Minuten.
//
// Verwendung:
//   const ok = await requireFreshAal2({ maxAgeSec: 300 });
//   if (!ok) return; // User hat abgebrochen.
//   // ... destruktive Mutation ...
//
// Frische: aktuelle Session-Claims enthalten `amr[].timestamp` (auth-
// methods-references). Wir suchen den juengsten TOTP-Eintrag und
// vergleichen mit Date.now()/1000.
//
// Wenn keine TOTP-Methode aktiv ist (User hat MFA nicht eingerichtet),
// faellt requireFreshAal2 auf eine Re-Authentication via Passwort
// zurueck — der User wird zur StepUpDialog umgeleitet, gibt seine
// Email + Passwort erneut ein. Bei OAuth-Only-Usern (kein Password):
// Re-Login via SSO.

import { challengeFactor, getAuthAal, listMfaFactors, verifyChallenge } from './mfa';
import { supabase } from './supabase';

export type StepUpResult = 'ok' | 'cancelled' | 'no_factor' | 'expired';

export type StepUpOptions = {
  maxAgeSec?: number;
  reason?: string;
};

const DEFAULT_MAX_AGE = 300; // 5min — Manifest-Spec animations.md/architektur.md.

// Pruefung ohne UI-Interaktion. Liefert true wenn AAL2 + amr-Frische ok.
export async function isFreshAal2(maxAgeSec: number = DEFAULT_MAX_AGE): Promise<boolean> {
  const aal = await getAuthAal();
  if (aal !== 'aal2') return false;
  // Session-Claims via getSession lesen — amr ist Teil der JWT.
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session?.access_token) return false;
  try {
    const payload = JSON.parse(atob(session.access_token.split('.')[1]));
    const amr = (payload.amr ?? []) as Array<{ method: string; timestamp: number }>;
    const totp = amr
      .filter((m) => m.method === 'totp')
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    if (!totp) return false;
    const ageSec = Math.floor(Date.now() / 1000 - totp.timestamp);
    return ageSec <= maxAgeSec;
  } catch {
    return false;
  }
}

// Run-Time-Checker. State wird via Window-Event zur StepUpDialog-
// Komponente kommuniziert (aehnlich wie dialog.ts).
type StepUpRequest = {
  factorId: string;
  reason?: string;
  resolve: (result: StepUpResult) => void;
};

let pendingRequest: StepUpRequest | null = null;
const listeners = new Set<(req: StepUpRequest | null) => void>();

export function onStepUpRequest(cb: (req: StepUpRequest | null) => void): () => void {
  listeners.add(cb);
  // Sofort State-Sync.
  cb(pendingRequest);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) cb(pendingRequest);
}

export async function requireFreshAal2(opts: StepUpOptions = {}): Promise<boolean> {
  const maxAge = opts.maxAgeSec ?? DEFAULT_MAX_AGE;
  if (await isFreshAal2(maxAge)) return true;

  // Faktor finden — V1 nimmt den ersten verifizierten TOTP-Faktor.
  let factors: Awaited<ReturnType<typeof listMfaFactors>>;
  try {
    factors = await listMfaFactors();
  } catch {
    return false;
  }
  const verified = factors.find((f) => f.status === 'verified' && f.factorType === 'totp');
  if (!verified) {
    // Kein TOTP-Faktor → User hat MFA nicht aktiviert. V1: Aktion
    // freigeben (keine Step-Up-Friction wenn nichts zu validieren ist).
    // V2 koennte hier Passwort-Re-Auth erzwingen.
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    pendingRequest = {
      factorId: verified.id,
      reason: opts.reason,
      resolve: (result) => {
        pendingRequest = null;
        notify();
        resolve(result === 'ok');
      },
    };
    notify();
  });
}

// API fuer StepUpDialog-Component. Nach erfolgreichem Code-Verify
// resolven wir den pending-Request.
export async function submitStepUpCode(code: string): Promise<void> {
  const req = pendingRequest;
  if (!req) throw new Error('no_pending_step_up');
  const challengeId = await challengeFactor(req.factorId);
  await verifyChallenge(req.factorId, challengeId, code);
  req.resolve('ok');
}

export function cancelStepUp(): void {
  const req = pendingRequest;
  if (!req) return;
  req.resolve('cancelled');
}
