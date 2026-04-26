// Datenbank-Fehler in endkundentaugliche Toasts uebersetzen.
//
// Regel (Memory feedback_user_facing_toasts): Toast-Text muss ohne
// Tech-Jargon (RLS, FK, JSONB, constraint, SQLSTATE) auskommen. Das
// technische Detail (e.code, e.status) gehoert in den begleitenden
// console.error('<funktionsname>:', err) — die Aufrufer sind dafuer
// zustaendig.

type SbError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
  status?: number;
};

export function translateDbError(err: unknown, fallback = 'Unerwarteter Fehler.'): string {
  if (!err) return fallback;
  const e = err as SbError;

  // PostgreSQL-SQLSTATE-Codes (via PostgREST durchgereicht). Texte
  // sind bewusst Konsequenz-orientiert formuliert, nicht technisch.
  switch (e.code) {
    case '23505':
      return aliasHint(e) ?? 'Dieser Wert ist hier bereits vergeben.';
    case '23503':
      return 'Verknuepfter Eintrag existiert nicht mehr — wahrscheinlich wurde er geloescht.';
    case '23514':
      return 'Eingabe ist nicht gueltig — bitte pruefe das Format.';
    case '42501':
      return 'Keine Berechtigung fuer diese Aktion.';
    case 'PGRST116':
      return 'Eintrag nicht gefunden.';
  }

  if (e.status === 401) return 'Bitte erneut einloggen.';
  if (e.status === 403) return 'Keine Berechtigung fuer diese Aktion.';
  if (e.status === 404) return 'Eintrag nicht gefunden.';
  if (e.status && e.status >= 500) return 'Server-Problem. Bitte gleich erneut probieren.';

  if (err instanceof Error) return err.message || fallback;
  if (typeof e.message === 'string' && e.message) return e.message;
  return fallback;
}

function aliasHint(e: SbError): string | null {
  const detail = (e.details || '').toLowerCase();
  const msg = (e.message || '').toLowerCase();
  if (detail.includes('alias') || msg.includes('alias')) {
    return 'Alias ist schon vergeben in diesem Workspace.';
  }
  return null;
}
