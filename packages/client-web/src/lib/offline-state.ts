// Globales Offline-Flag. Wird von offline-cache.withCache() gesetzt,
// wenn eine Query aus dem Cache beantwortet wurde (statt vom Server).
// Wird beim naechsten erfolgreichen Read wieder zurueckgesetzt.
//
// UI-Konsument: Workspace-Header zeigt ein "Offline"-Badge solange
// offlineState() === true.

import { createSignal } from 'solid-js';

const [offline, setOfflineRaw] = createSignal(false);

// Anzahl der Pending-Cache-Fallbacks. Erst wenn alle Queries wieder
// erfolgreich live laufen, wechseln wir zurueck auf online. Sonst
// flackert das Badge bei jedem Teil-Fail.
let fallbackDepth = 0;

export function offlineState() {
  return offline();
}

export function markCacheFallback(): void {
  fallbackDepth += 1;
  setOfflineRaw(true);
}

export function markLiveSuccess(): void {
  if (fallbackDepth > 0) fallbackDepth -= 1;
  if (fallbackDepth === 0) setOfflineRaw(false);
}

export function resetOfflineState(): void {
  fallbackDepth = 0;
  setOfflineRaw(false);
}
