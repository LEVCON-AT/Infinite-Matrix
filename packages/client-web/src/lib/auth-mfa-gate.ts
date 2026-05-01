// MFA-Gate fuer Login-Flow.
//
// Nach erfolgreichem Login (Email+Pass / SSO / Magic-Link) ist die
// Session AAL1. Wenn der User einen verifizierten TOTP-Faktor hat,
// muss er ihn jetzt einloesen, sonst bleibt die Session unter-
// privilegiert (kein Step-Up moeglich, keine sensitiven Aktionen).
//
// Mechanik:
//   - App.tsx ruft beim Auth-Change `checkMfaGate()` auf.
//   - checkMfaGate liest AAL + Faktors. Wenn aal1 + verifizierter
//     Faktor: oeffnet MfaGateDialog (Singleton).
//   - User gibt 6-stelligen Code → AAL2 → Dialog schliesst.
//   - User klickt Cancel oder ESC → automatischer signOut().
//
// Unterschied zu auth-step-up.ts:
//   - Step-Up wird VOR sensitiver Mutation aufgerufen, Cancel = ok
//     (Mutation bricht ab).
//   - Login-Gate wird DIREKT NACH Login getriggert, Cancel = signOut
//     (User wollte gar nicht rein).

import { consumeBackupCode, looksLikeBackupCode } from './backup-codes';
import { challengeFactor, getAuthAal, listMfaFactors, verifyChallenge } from './mfa';

type GateRequest = {
  factorId: string;
  resolve: (verified: boolean) => void;
};

let pendingGate: GateRequest | null = null;
const gateListeners = new Set<(req: GateRequest | null) => void>();

export function onMfaGateRequest(cb: (req: GateRequest | null) => void): () => void {
  gateListeners.add(cb);
  cb(pendingGate);
  return () => gateListeners.delete(cb);
}

function notifyGate() {
  for (const cb of gateListeners) cb(pendingGate);
}

let checking = false;

// Single-Flight-Check. Idempotent — wenn schon ein Gate offen ist,
// no-op. Wenn AAL bereits aal2 oder Session nicht aal1, no-op.
export async function checkMfaGate(): Promise<void> {
  if (pendingGate || checking) return;
  checking = true;
  try {
    const aal = await getAuthAal();
    if (aal !== 'aal1') return; // bereits aal2 ODER nicht eingeloggt
    let factors: Awaited<ReturnType<typeof listMfaFactors>>;
    try {
      factors = await listMfaFactors();
    } catch {
      return;
    }
    const verified = factors.find((f) => f.status === 'verified' && f.factorType === 'totp');
    if (!verified) return; // kein TOTP konfiguriert
    pendingGate = {
      factorId: verified.id,
      resolve: () => {
        // wird von submit/cancel ueberschrieben
      },
    };
    notifyGate();
  } finally {
    checking = false;
  }
}

export async function submitMfaGateCode(code: string): Promise<void> {
  const req = pendingGate;
  if (!req) throw new Error('no_pending_gate');
  // Backup-Code-Pfad: User hat seine App verloren. Akzeptiert ohne
  // AAL2-Upgrade — Session bleibt aal1, sensitive Aktionen brauchen
  // dann erneuten Setup eines TOTP-Faktors. UX-Hinweis dazu im Dialog.
  if (looksLikeBackupCode(code)) {
    await consumeBackupCode(code);
    pendingGate = null;
    notifyGate();
    return;
  }
  // TOTP-Pfad: 6-stelliger Code, AAL1 → AAL2.
  const challengeId = await challengeFactor(req.factorId);
  await verifyChallenge(req.factorId, challengeId, code);
  pendingGate = null;
  notifyGate();
}

// Cancel = User will sich nicht via MFA verifizieren → signOut.
// Caller (Dialog) ruft signOut nach Cancel auf, damit der Hook hier
// keine zirkulaere Abhaengigkeit zu lib/auth bekommt.
export function dismissMfaGate(): void {
  pendingGate = null;
  notifyGate();
}
