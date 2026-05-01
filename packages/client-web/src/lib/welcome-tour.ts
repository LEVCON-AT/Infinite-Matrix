// Welcome-Tour (A.5 V1).
//
// Beim ersten Login eines eingeladenen Users (nicht Owner): zeigt
// 3-Slide Welcome-Modal mit Hinweisen zu Sidebar / Cells / Command-
// Palette. Status persistiert in user_preferences.welcome_tour_done.
//
// Owner werden nicht getriggert — sie sehen den Onboarding-Wizard
// (A.4) der Workspace-Erstanlage erledigt. Eingeladene User haben
// keinen Wizard-Trigger; deshalb dieses leichtgewichtige Pendant.

import { loadUserPrefs, saveUserPrefs } from './user-prefs';

const PREF_KEY = 'welcome_tour_done';

// Memo, damit wir nicht mehrfach gegen die DB prefen.
let cachedDone: boolean | null = null;

export async function isWelcomeTourDone(): Promise<boolean> {
  if (cachedDone !== null) return cachedDone;
  const row = await loadUserPrefs();
  const done = Boolean(row?.prefs?.[PREF_KEY]);
  cachedDone = done;
  return done;
}

export async function markWelcomeTourDone(): Promise<void> {
  const row = await loadUserPrefs();
  const next = { ...(row?.prefs ?? {}), [PREF_KEY]: true };
  await saveUserPrefs(next);
  cachedDone = true;
}

// Reset bei SignOut — sonst zeigt der naechste User auf demselben
// Browser keinen Welcome trotz first-time.
export function resetWelcomeTourCache(): void {
  cachedDone = null;
}
