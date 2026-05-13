// Account-Self-Service — D.1 (Display-Name + Email-Aenderung) + B.4 Audit.
//
// Beide Mutations laufen ueber `supabase.auth.updateUser()`. Display-
// Name landet in `raw_user_meta_data.display_name`, lesbar via
// session.user.user_metadata.display_name. Email-Aenderung triggert
// einen Bestaetigungs-Mail-Flow auf die NEUE Adresse — bis zur
// Bestaetigung bleibt die alte Email aktiv (Supabase-Default-Verhalten,
// schuetzt vor Account-Lock bei Tippfehlern).
//
// B.4 Audit-Coverage: nach erfolgreicher Auth-Mutation schreiben wir
// einen Eintrag in system_audit_log via log_account_event-RPC.
//
// Sync-online, kein safe-mutation-Wrapper — Auth/Identity ist
// security-kritisch (feedback_saas_security_no_offline.md).

import { logAccountEvent } from './account-audit';
import { callEdgeFunction } from './edge-functions';
import { supabase } from './supabase';

export async function setDisplayName(name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed.length > 80) {
    throw new Error('Anzeigename maximal 80 Zeichen.');
  }
  // Leer-String -> null = "Anzeigename entfernen".
  const value = trimmed || null;
  const { error } = await supabase.auth.updateUser({
    data: { display_name: value },
  });
  if (error) throw error;
  // B.4 Audit. Payload nicht der konkrete Name (PII-frei halten), nur
  // ob gesetzt oder entfernt.
  void logAccountEvent('display_name_changed', { cleared: value === null });
}

export async function changeEmail(newEmail: string): Promise<void> {
  const trimmed = newEmail.trim().toLowerCase();
  if (!trimmed) {
    throw new Error('Neue E-Mail darf nicht leer sein.');
  }
  // Minimaler Format-Check; Supabase wirft sonst sowieso. Wir wollen
  // nur den haeufigsten User-Fehler (kein @) sofort erfassen.
  if (!trimmed.includes('@') || trimmed.length > 254) {
    throw new Error('E-Mail-Format ungueltig.');
  }
  const { error } = await supabase.auth.updateUser({ email: trimmed });
  if (error) throw error;
  // B.4 Audit. Email-Domain (nicht Volltext) als Forensik-Bruchstueck.
  const atIdx = trimmed.lastIndexOf('@');
  const domain = atIdx > -1 ? trimmed.slice(atIdx + 1) : null;
  void logAccountEvent('email_change_requested', { new_domain: domain });
}

// D.4 — Self-Service-Account-Loeschung.
//
// Server-Pfad: Edge-Function `delete-self-account` prueft Auth +
// Fresh-AAL2 + Sole-Owner-Status, schreibt Audit, ruft dann
// `auth.admin.deleteUser`. Wir leiten danach noch `signOut()` an,
// damit die lokale Session sauber verschwindet (Supabase invalidiert
// das JWT serverseitig auch ohne, aber das Frontend wuerde sonst
// kurz "ghost-logged-in" wirken).
export async function deleteOwnAccount(confirmEmail: string): Promise<void> {
  const { error } = await callEdgeFunction<
    { confirmEmail: string },
    { deleted: true; user_id: string }
  >('delete-self-account', { confirmEmail });
  if (error) {
    const msg =
      error.status === 422
        ? error.message
        : error.status === 401
          ? 'Erneute Bestaetigung mit Authenticator erforderlich.'
          : 'Konto-Loeschung fehlgeschlagen.';
    throw new Error(msg);
  }
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // Egal — User ist serverseitig schon weg.
  }
}
