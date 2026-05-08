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

// Lange relative Zeitangabe: heute / vor 1 Tag / vor X Tagen / vor 1
// Monat / vor X Monaten / vor 1 Jahr / vor X Jahren. Fuer „letzte
// Aktivitaet"-Indikatoren in Listen wo das exakte Datum weniger
// wichtig als das Alter ist.
export function formatRelativeDeLong(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isValidDate(d)) return iso;
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return 'heute';
  if (days === 1) return 'vor 1 Tag';
  if (days < 30) return `vor ${days} Tagen`;
  const months = Math.floor(days / 30);
  if (months === 1) return 'vor 1 Monat';
  if (months < 12) return `vor ${months} Monaten`;
  const years = Math.floor(months / 12);
  return years === 1 ? 'vor 1 Jahr' : `vor ${years} Jahren`;
}

// Kurze relative Zeitangabe mit Datum-Fallback: heute / gestern /
// vor X Tagen (< 7) / DE-Lokal-Datum. Fuer Cards/Cells wo aelteres
// Material das exakte Datum braucht (Vorlagen-Liste, Aktivitaet-Stream).
export function formatRelativeDeShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isValidDate(d)) return iso;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'heute';
  if (days === 1) return 'gestern';
  if (days < 7) return `vor ${days} Tagen`;
  return d.toLocaleDateString('de-AT');
}
