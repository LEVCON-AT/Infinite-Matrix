// Account-Self-Service — D.1 (Display-Name + Email-Aenderung).
//
// Beide Mutations laufen ueber `supabase.auth.updateUser()`. Display-
// Name landet in `raw_user_meta_data.display_name`, lesbar via
// session.user.user_metadata.display_name. Email-Aenderung triggert
// einen Bestaetigungs-Mail-Flow auf die NEUE Adresse — bis zur
// Bestaetigung bleibt die alte Email aktiv (Supabase-Default-Verhalten,
// schuetzt vor Account-Lock bei Tippfehlern).
//
// Sync-online, kein safe-mutation-Wrapper — Auth/Identity ist
// security-kritisch (feedback_saas_security_no_offline.md).

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
}
