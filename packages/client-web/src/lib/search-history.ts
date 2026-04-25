// Persistenz fuer die HeaderSearchBar-History. Pro Workspace wird die
// Liste der letzten Eingaben in localStorage gehalten. Cap 25, dedup
// on-push (gleiche raw-Eingabe wandert auf Position 0), neuester
// Eintrag steht immer vorne. Push nur bei Enter-Success (siehe
// HeaderSearchBar — Fehler/Cancel werden nicht gespeichert).
//
// Shape: { kind: 'search' | 'command', raw, ts }. Das `kind` ist
// informativ (Badges im Dropdown); der Dispatch beim Anwenden eines
// History-Eintrags laeuft ueber denselben Parser wie die Live-Eingabe
// — also auch wenn ein User heute eine Search gespeichert hat und
// morgen ein Alias mit demselben Namen existiert, interpretiert die
// Bar es korrekt.

const MAX_ENTRIES = 25;

export type HistoryKind = 'search' | 'command';

export type HistoryEntry = {
  kind: HistoryKind;
  raw: string;
  ts: number;
};

function storageKey(workspaceId: string): string {
  return `matrix-search-history-${workspaceId}`;
}

export function loadHistory(workspaceId: string): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is HistoryEntry =>
        !!e &&
        typeof e === 'object' &&
        (e.kind === 'search' || e.kind === 'command') &&
        typeof e.raw === 'string' &&
        typeof e.ts === 'number',
    );
  } catch {
    return [];
  }
}

export function saveHistory(workspaceId: string, entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(entries));
  } catch {
    /* quota / disabled storage — silent */
  }
}

// Push mit Dedup: gleicher raw wandert auf Position 0. Cap 25. Ueber-
// schreibt den `kind` nicht (ein Entry bleibt seiner urspruenglichen
// Kategorie treu).
export function pushHistory(workspaceId: string, entry: Omit<HistoryEntry, 'ts'>): HistoryEntry[] {
  const raw = entry.raw.trim();
  if (!raw) return loadHistory(workspaceId);
  const current = loadHistory(workspaceId);
  const filtered = current.filter((e) => e.raw !== raw);
  const next: HistoryEntry = { kind: entry.kind, raw, ts: Date.now() };
  const out = [next, ...filtered].slice(0, MAX_ENTRIES);
  saveHistory(workspaceId, out);
  return out;
}

export function clearHistory(workspaceId: string): void {
  try {
    localStorage.removeItem(storageKey(workspaceId));
  } catch {
    /* ignore */
  }
}
