// MFA-Helper (Welle B.2). Nutzt Supabase eingebauten TOTP-Flow.
//
// Enrollment-Flow:
//   1. enrollTotp() → factorId + qrSvg + secret. UI zeigt QR-Code.
//   2. verifyTotpEnrollment(factorId, challengeId, code) → bestaetigt.
//      Nach Erfolg ist der Factor aktiv und AAL2 verfuegbar.
//   3. listMfaFactors() → aktuelle Faktoren in Settings.
//   4. unenrollMfa(factorId) → entfernen.
//
// Login-Challenge-Flow:
//   1. signInWithPassword/signInWithOAuth → Session mit AAL1.
//   2. listMfaFactors() — wenn TOTP-Factor existiert: Challenge.
//   3. challengeAndVerify(factorId, code) → Session bekommt AAL2.
//
// Step-Up (B.3): listMfaFactors → ausserhalb von 5min seit AAL2 →
// challengeAndVerify erneut. siehe lib/auth-step-up.ts.

import { supabase } from './supabase';

export type MfaFactor = {
  id: string;
  factorType: 'totp' | 'phone';
  status: 'verified' | 'unverified';
  friendlyName?: string;
  createdAt: string;
};

export type EnrollmentInit = {
  factorId: string;
  qrCode: string; // SVG-Markup
  secret: string; // Base32-Secret fuer manuelle Eingabe in Authenticator-App
  uri: string; // otpauth://-URI
};

export async function enrollTotp(friendlyName?: string): Promise<EnrollmentInit> {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: friendlyName ?? 'Authenticator',
  });
  if (error) throw error;
  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

export async function verifyTotpEnrollment(factorId: string, code: string): Promise<void> {
  const challenge = await supabase.auth.mfa.challenge({ factorId });
  if (challenge.error) throw challenge.error;
  const verify = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code,
  });
  if (verify.error) throw verify.error;
}

export async function listMfaFactors(): Promise<MfaFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  const all = data?.totp ?? [];
  return all.map((f) => ({
    id: f.id,
    factorType: f.factor_type as 'totp',
    status: f.status as 'verified' | 'unverified',
    friendlyName: f.friendly_name ?? undefined,
    createdAt: f.created_at,
  }));
}

export async function unenrollMfa(factorId: string): Promise<void> {
  // B.3 — Step-Up. Faktor-Entfernen ist sensitiv (gleichbedeutend mit
  // MFA-Aenderung). Fresh AAL2 in den letzten 5min Pflicht. Nur wenn
  // der Faktor verifiziert ist; pending-Faktoren (Enrollment-Cleanup
  // bei cancelEnrollment) brauchen keine Step-Up.
  const factors = await listMfaFactors();
  const target = factors.find((f) => f.id === factorId);
  if (target?.status === 'verified') {
    const { requireFreshAal2 } = await import('./auth-step-up');
    const ok = await requireFreshAal2({
      reason: 'MFA entfernen ist sicherheitsrelevant. Bitte bestaetige.',
    });
    if (!ok) throw new Error('step_up_cancelled');
  }
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

// Login-Challenge: nach erfolgreicher Email/Pass-Anmeldung mit
// existierendem TOTP-Factor. Liefert challengeId — die UI fragt
// dann den 6-stelligen Code ab und ruft verifyChallenge.
export async function challengeFactor(factorId: string): Promise<string> {
  const { data, error } = await supabase.auth.mfa.challenge({ factorId });
  if (error) throw error;
  return data.id;
}

export async function verifyChallenge(
  factorId: string,
  challengeId: string,
  code: string,
): Promise<void> {
  const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
  if (error) throw error;
}

// Komfort-Helper: liefert true wenn aktuelle Session AAL2 hat.
// Fuer Step-Up (B.3) und sensitive UI-Sektionen.
export async function getAuthAal(): Promise<'aal1' | 'aal2' | null> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) return null;
  return (data?.currentLevel as 'aal1' | 'aal2') ?? null;
}
