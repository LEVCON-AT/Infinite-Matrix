// Date-Format-Helper (Q.3.C — Single-Source nach Doublet-Audit).
//
// Vorher: 6 Komponenten haben jeweils eigene `toLocaleString('de-DE', ...)`-
// Logik definiert. Konsolidiert hier auf zwei Public-Funktionen +
// einem Date-Only-Helper. Try/Catch wickelt fehlerhafte ISO-Strings
// (Date-Parsing wirft nicht, gibt Invalid-Date — wir checken explizit).
//
// Verwendung:
//   formatDateDE(iso)         → "01.05.2026"
//   formatDateTimeDE(iso)     → "01.05.2026, 14:32"
//   formatDateTimeWithSecsDE  → "01.05.2026, 14:32:05"

function isValidDate(d: Date): boolean {
  return !Number.isNaN(d.getTime());
}

export function formatDateDE(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isValidDate(d)) return iso;
  return d.toLocaleDateString('de-DE');
}

export function formatDateTimeDE(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isValidDate(d)) return iso;
  return d.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateTimeWithSecsDE(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isValidDate(d)) return iso;
  return d.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
