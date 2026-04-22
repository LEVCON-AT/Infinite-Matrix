// PostgREST / Supabase-Fehler in deutsche, verstaendliche Toasts uebersetzen.
// Orientierung am Alt-Client: translateError(err, fallback).

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

  // PostgreSQL-SQLSTATE-Codes (via PostgREST durchgereicht)
  switch (e.code) {
    case '23505':
      return aliasHint(e) ?? 'Wert ist bereits vergeben (unique constraint).';
    case '23503':
      return 'Verweis existiert nicht oder wurde geloescht.';
    case '23514':
      return 'Eingabe verletzt eine Regel (check constraint).';
    case '42501':
      return 'Keine Berechtigung — RLS blockiert.';
    case 'PGRST116':
      return 'Kein Datensatz gefunden.';
  }

  if (e.status === 401) return 'Nicht eingeloggt.';
  if (e.status === 403) return 'Keine Berechtigung.';
  if (e.status === 404) return 'Ressource nicht gefunden.';
  if (e.status && e.status >= 500) return 'Server-Fehler, bitte kurz warten.';

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
