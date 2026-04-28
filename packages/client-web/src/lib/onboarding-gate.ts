// Onboarding-Gate (A.4b).
//
// Aufgerufen vom App.tsx-Route-Guard fuer eingeloggte User auf
// nicht-onboarding-Routen. Pruefen:
//   1. user_metadata.onboarding_done === true → nichts tun.
//   2. Sonst: gibt es Workspace mit Inhalt (>=1 Knoten)?
//      → JA  → onboarding_done backfillen + nichts redirecten
//              (User aus Phase 0 hat noch nie gesehen, ist aber durch).
//      → NEIN → navigate('/onboarding') mit workspaceId als Query-Param.
//
// "Inhalt" = mindestens ein Knoten (matrix oder board). Kein Knoten =
// leerer Auto-Workspace aus Migration 001 trigger = neuer User der
// noch nie etwas getan hat.
//
// Race-Condition: handle_new_user-Trigger ist synchron in derselben
// Tx wie der auth.users-Insert — bis der Browser die JWT-Session hat,
// existiert der Workspace bereits. Wir machen trotzdem eine Retry-
// Schleife (max 3x 500ms) fuer Edge-Cases.

import type { useNavigate } from '@solidjs/router';
import { fetchMyWorkspaces } from './queries';
import { supabase } from './supabase';

type Navigate = ReturnType<typeof useNavigate>;

// Modul-lokal: einmal pro Session reicht. Verhindert dass jeder
// Route-Wechsel den Gate erneut feuert (createEffect koennte sonst
// mehrfach ausloesen).
let gateRanForUserId: string | null = null;

export function resetOnboardingGate(): void {
  gateRanForUserId = null;
}

export async function checkAndMaybeRedirectToOnboarding(
  userId: string,
  navigate: Navigate,
): Promise<void> {
  if (gateRanForUserId === userId) return;
  gateRanForUserId = userId;

  // 1) user_metadata.onboarding_done bereits gesetzt? Dann fertig.
  const { data: userData } = await supabase.auth.getUser();
  if (userData.user?.user_metadata?.onboarding_done === true) {
    return;
  }

  // 2) Workspaces holen (Retry-Loop fuer Trigger-Race).
  let workspaces: Awaited<ReturnType<typeof fetchMyWorkspaces>> = [];
  for (let i = 0; i < 3; i += 1) {
    try {
      workspaces = await fetchMyWorkspaces();
      if (workspaces.length > 0) break;
    } catch (err) {
      console.error('onboarding-gate fetchMyWorkspaces:', err);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (workspaces.length === 0) {
    // Trigger nicht gegriffen? Weiter laufen lassen — User wird auf
    // einer leeren Welt landen, App.tsx zeigt Fallback. Onboarding
    // ohne Workspace ist sinnlos.
    console.warn('onboarding-gate: keine Workspaces nach 3 Retries.');
    return;
  }

  // Default-Workspace = der erste in der Liste (bei neuem User exakt
  // einer, durch handle_new_user). Bei existing User: wenn IRGEND-EIN
  // Workspace nodes hat → backfillen, kein Redirect.
  const defaultWs = workspaces[0];
  if (!defaultWs) return;

  const hasContent = await anyWorkspaceHasNodes(workspaces.map((w) => w.id));
  if (hasContent) {
    // Backfill: User hat schon Inhalt → Onboarding bereits "passiert".
    await markOnboardingDone();
    return;
  }

  // 3) Wirklich brand-neu → Onboarding starten.
  navigate(`/onboarding?ws=${encodeURIComponent(defaultWs.id)}`, { replace: true });
}

// Einmal-Pruefung: hat IRGEND-EIN Workspace einen Knoten? Wenn ja →
// User ist nicht "neu" und kann ohne Wizard weitermachen.
async function anyWorkspaceHasNodes(workspaceIds: string[]): Promise<boolean> {
  for (const wsId of workspaceIds) {
    const { count, error } = await supabase
      .from('nodes')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', wsId)
      .limit(1);
    if (error) {
      console.warn('onboarding-gate count nodes:', error.message);
      continue;
    }
    if ((count ?? 0) > 0) return true;
  }
  return false;
}

export async function markOnboardingDone(): Promise<void> {
  const { error } = await supabase.auth.updateUser({ data: { onboarding_done: true } });
  if (error) throw error;
}

// Wizard-Skip ohne Provider/ohne Inhalt → onboarding_done=true, naechster
// Reload zeigt keinen Wizard mehr. AiProviderHint-Banner aus A.0 bleibt.
export async function markOnboardingSkipped(): Promise<void> {
  await markOnboardingDone();
}
