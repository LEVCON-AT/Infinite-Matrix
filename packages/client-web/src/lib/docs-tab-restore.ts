// Persistiert die offenen Doku-Tab-IDs pro Workspace in localStorage,
// damit Shift+D nach Popup-Close wieder dieselben Tabs oeffnet. Das
// passt zur "mehrere parallel bearbeiten"-Intention — ohne Restore
// wuerde jeder Shift+D bei einem leeren Pending-Tab starten.
//
// Nur docIds werden persistiert. Pending-Tabs (ohne DB-Row) haben
// keinen Identifier und koennen nicht ueber Sessions hinweg restored
// werden; ihre Arbeit verliert der User beim Schliessen, wenn er nicht
// Titel oder Content getippt hat (gleich wie vor Phase 3).
//
// Stale-Entries (DocId existiert nicht mehr in DB, weil geloescht)
// werden beim Restore-Fetch still uebersprungen. Der naechste
// createEffect-basierte persist schreibt dann die bereinigte Liste
// zurueck — selbst-heilend.

const STORAGE_KEY = (workspaceId: string) => `matrix.docs.tabs.${workspaceId}`;

export function getPersistedTabIds(workspaceId: string): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

export function persistTabIds(workspaceId: string, ids: string[]): void {
  try {
    if (ids.length === 0) {
      localStorage.removeItem(STORAGE_KEY(workspaceId));
    } else {
      localStorage.setItem(STORAGE_KEY(workspaceId), JSON.stringify(ids));
    }
  } catch {
    // Quota voll, privater Browsermode, … — silent fail ist OK, die
    // Tabs leben dann nur fuer die aktuelle Session.
  }
}
