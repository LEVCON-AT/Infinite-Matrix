// Date-Format-Helper (Q.3.C — Single-Source nach Doublet-Audit + D.3-V2).
//
// Vorher: 6 Komponenten haben jeweils eigene `toLocaleString('de-DE', ...)`-
// Logik definiert. Konsolidiert hier auf zwei Public-Funktionen +
// einem Date-Only-Helper. Try/Catch wickelt fehlerhafte ISO-Strings
// (Date-Parsing wirft nicht, gibt Invalid-Date — wir checken explizit).
//
// D.3-V2 (2026-05-13): locale + timezone aus user_profiles.language /
// timezone wird zur Boot-Zeit gesetzt (App.tsx createEffect). Defaults
// bleiben de-DE + Browser-Default-TZ, damit nicht-eingeloggte Pfade +
// User ohne Profil-Row unveraendert funktionieren.
//
// Verwendung:
//   formatDateDE(iso)         → "01.05.2026"
//   formatDateTimeDE(iso)     → "01.05.2026, 14:32"
//   formatDateTimeWithSecsDE  → "01.05.2026, 14:32:05"

// Mutable Module-State — gesetzt durch setUserDateContext beim Profil-
// Boot. Reaktive Signals waeren ueberdimensioniert: die Werte aendern
// sich nur bei Login/Logout/Profil-Save, und ein Re-Render der Date-
// Strings tritt durch den auslosenden createEffect ohnehin auf.
let activeLocale = 'de-DE';
let activeTimezone: string | undefined; // undefined = Browser-Default
let activeShortLocale = 'de-AT';

export function setUserDateContext(ctx: {
  language: string | null | undefined;
  timezone: string | null | undefined;
}): void {
  // language → toLocaleString-Locale. Wir validieren minimal: nur BCP-47-
  // Form (a-z, A-Z, 0-9, dash) durchlassen, sonst fallback Default.
  const lang = (ctx.language ?? '').trim();
  if (lang && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(lang)) {
    activeLocale = lang;
    // Short-Locale fuer formatRelativeDeShort: wenn der User explizit de-
    // setzt, halten wir den AT-Stil als Wuensch der Originalfunktion bei.
    activeShortLocale = lang.startsWith('de') ? lang : lang;
  } else {
    activeLocale = 'de-DE';
    activeShortLocale = 'de-AT';
  }
  // timezone: einfach durchreichen, ungueltige Werte ignoriert Intl.
  // Aber wenn der User leeren String setzt, zurueck zum Browser-Default.
  const tz = (ctx.timezone ?? '').trim();
  activeTimezone = tz || undefined;
}

export function resetUserDateContext(): void {
  activeLocale = 'de-DE';
  activeShortLocale = 'de-AT';
  activeTimezone = undefined;
}

function withTz<T extends Intl.DateTimeFormatOptions>(opts: T): T {
  if (activeTimezone) {
    return { ...opts, timeZone: activeTimezone };
  }
  return opts;
}

function isValidDate(d: Date): boolean {
  return !Number.isNaN(d.getTime());
}

export function formatDateDE(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isValidDate(d)) return iso;
  return d.toLocaleDateString(activeLocale, withTz({}));
}

export function formatDateTimeDE(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isValidDate(d)) return iso;
  return d.toLocaleString(
    activeLocale,
    withTz({
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
  );
}

export function formatDateTimeWithSecsDE(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isValidDate(d)) return iso;
  return d.toLocaleString(
    activeLocale,
    withTz({
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  );
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
// vor X Tagen (< 7) / Lokal-Datum. Fuer Cards/Cells wo aelteres
// Material das exakte Datum braucht (Vorlagen-Liste, Aktivitaet-Stream).
//
// D.3-V2: i18n der relative-Strings (heute/gestern/Tagen) bleibt
// V3 — der reine Date-Fallback nutzt aber bereits activeShortLocale.
export function formatRelativeDeShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isValidDate(d)) return iso;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return 'heute';
  if (days === 1) return 'gestern';
  if (days < 7) return `vor ${days} Tagen`;
  return d.toLocaleDateString(activeShortLocale, withTz({}));
}
