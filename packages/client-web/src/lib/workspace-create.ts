// Workspace-Create-Helper (A.4a). Aufgerufen vom Onboarding-Wizard
// (A.4d Re-Run-Pfad) und vom WorkspaceSwitcher-Button "+ Neuer
// Workspace".
//
// Sync-online-only: kein safe-mutation-Wrapper. Begruendung wie bei
// den Security-Mutations (redeemInvite, changeMemberRole, …) — der
// Audit-Trail muss auf der DB landen, bevor der User weitergeht. Ein
// Replay-Queue-Eintrag waere semantisch falsch ("ich habe einen
// Workspace angelegt" ist nichts was offline bestehen koennte).
//
// Errors leiten wir 1:1 weiter; der Caller entscheidet ueber Toast-
// Pfad (translateDbError + showToast).

import { supabase } from './supabase';

export async function createWorkspace(name: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_workspace', { p_name: name });
  if (error) throw error;
  if (typeof data !== 'string') {
    throw new Error('create_workspace: unerwartete Antwort');
  }
  return data;
}
