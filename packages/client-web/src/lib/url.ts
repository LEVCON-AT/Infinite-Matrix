// URL-Sanitization — verhindert XSS via javascript:/data:/vbscript:-URLs
// in Link-Feldern. Port aus client/matrix_tool_beta.html:8660 mit der
// gleichen Liberal-Semantik: akzeptiert jede nicht-gefaehrliche URL inkl.
// http/https/mailto/tel/relative — nur die drei bekannten Script-Schemes
// werden abgelehnt.
//
// Rueckgabe: sanitized URL (unveraendert ausser Trim) oder null.

const DANGEROUS_PREFIXES = ['javascript:', 'data:', 'vbscript:'];

export function sanitizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  for (const p of DANGEROUS_PREFIXES) {
    if (lower.startsWith(p)) return null;
  }
  return trimmed;
}
