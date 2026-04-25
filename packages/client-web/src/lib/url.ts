// URL-Sanitization — verhindert XSS via Script-Schemes (javascript:,
// data:, vbscript:, blob:, file:, intent:, etc.) in Link-Feldern.
// Port aus packages/client-standalone/matrix.html:8660 mit folgender
// ASVS-V5.1.4-Verschaerfung: Allowlist statt Denylist.
//
// Erlaubte Schemes: https, http, mailto, tel.
// Relative URLs (kein Scheme) sind erlaubt — der Browser interpretiert
// sie im Origin der Hosting-Seite, kein Cross-Scheme-Risiko.
// Alle anderen Schemes (blob:, file:, ssh:, ftp:, intent:, custom://)
// werden abgelehnt.
//
// Rueckgabe: sanitized URL (unveraendert ausser Trim) oder null.

const ALLOWED_SCHEMES = new Set(['https:', 'http:', 'mailto:', 'tel:']);

export function sanitizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Scheme-Detection mit URL-Constructor. Wirft fuer relative URLs —
  // die akzeptieren wir per try/catch-Fallback.
  try {
    // Base = ein dummy https-Origin; wirft trotzdem fuer reine Schemes
    // ohne authority (z.B. "javascript:alert(1)" parsed als URL mit
    // protocol='javascript:'). Das ist genau was wir wollen.
    const u = new URL(trimmed, 'https://example.invalid');
    // Wenn das Original-Scheme nicht in der Allowlist ist UND der Parser
    // einen Scheme-Anteil erkannt hat, ablehnen. Bei relativen URLs
    // uebernimmt der Parser https: aus der Base — die schiessen wir
    // unten ueber den startsWith-Heuristik-Check ab.
    const trimmedLower = trimmed.toLowerCase();
    const hasOwnScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmedLower);
    if (hasOwnScheme && !ALLOWED_SCHEMES.has(u.protocol)) {
      return null;
    }
    return trimmed;
  } catch {
    // URL-Constructor wirft fuer komplett kaputten Input ("\0", etc.).
    // Sicherheitshalber abweisen.
    return null;
  }
}
