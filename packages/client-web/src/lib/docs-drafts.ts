// Client-side Draft-Persistenz fuer Pending-Doku-Tabs. Ohne diesen
// Mechanismus verliert der User seine nicht-gespeicherten Eingaben,
// wenn der Browser abstuerzt oder er den Tab versehentlich schliesst.
//
// Warum nicht sofort DB-INSERT auf Shift+D?
//   - Jede Popup-Oeffnung wuerde eine leere DB-Row erzeugen, selbst
//     wenn der User nur "mal schauen" wollte.
//   - Cross-User-Workspace: Draft-Docs wuerden in der Recent-Liste
//     aller Mitglieder auftauchen.
//   - localStorage ist fuer "Work-in-Progress" die richtige Schicht.
//
// Draft wird angelegt beim ersten Input, der Default-Werte veraendert
// (title/content/alias weicht ab ODER attached_cell_id gesetzt).
// Sobald der Tab materialisiert (createDoc liefert docId zurueck),
// wird der Draft geloescht. Auch beim Schliessen eines Pending-Tabs
// raeumen wir den Draft auf.
//
// Stabiles clientId pro Tab: erlaubt Round-Trip Draft <-> Tab ohne
// Kollisionen, wenn mehrere Pending-Tabs gleichzeitig offen sind.

export type Draft = {
  clientId: string;
  title: string;
  content: string;
  alias: string;
  sourceAlias: string | null;
  attachedCellId: string | null;
  updatedAt: number;
};

const STORAGE_KEY = (workspaceId: string) =>
  `matrix.docs.drafts.${workspaceId}`;

export function getDrafts(workspaceId: string): Draft[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(workspaceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDraft);
  } catch {
    return [];
  }
}

export function persistDrafts(workspaceId: string, drafts: Draft[]): void {
  try {
    if (drafts.length === 0) {
      localStorage.removeItem(STORAGE_KEY(workspaceId));
    } else {
      localStorage.setItem(STORAGE_KEY(workspaceId), JSON.stringify(drafts));
    }
  } catch {
    // Quota/Private-Mode — silent fail
  }
}

export function removeDraft(workspaceId: string, clientId: string): void {
  const rest = getDrafts(workspaceId).filter((d) => d.clientId !== clientId);
  persistDrafts(workspaceId, rest);
}

// Einfacher Typ-Guard — reicht, weil unsere eigene Write-Logik die
// Struktur garantiert. Falls ein anderes Tool/eine andere Version
// einen kaputten Eintrag schreibt, wird er beim Load verworfen.
function isDraft(v: unknown): v is Draft {
  if (!v || typeof v !== 'object') return false;
  const d = v as Record<string, unknown>;
  return (
    typeof d.clientId === 'string' &&
    typeof d.title === 'string' &&
    typeof d.content === 'string' &&
    typeof d.alias === 'string' &&
    (d.sourceAlias === null || typeof d.sourceAlias === 'string') &&
    (d.attachedCellId === null || typeof d.attachedCellId === 'string') &&
    typeof d.updatedAt === 'number'
  );
}

// Stabiles clientId. crypto.randomUUID ist in allen modernen Browsern
// verfuegbar (Chrome 92+, FF 95+, Safari 15.4+).
export function newClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Defensive fallback — fuer alte Browser / Test-Umgebungen.
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
