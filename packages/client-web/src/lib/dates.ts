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

// D.3-V3 (2026-05-13): Relative-Strings via Intl.RelativeTimeFormat —
// browser-native, plurale + locale-Auswahl ohne eigene String-Tabelle.
// numeric: 'auto' liefert „heute / gestern / vor 2 Tagen" idiomatisch
// pro Locale; numeric: 'always' wuerde „vor 0 Tagen" sagen, das wollen
// wir nicht.
//
// Funktionsnamen behalten den „De"-Suffix aus History-Gruenden — die
// Aufrufer-API bleibt stabil, intern ist's lokalisiert.

let cachedRelLocale = '';
let cachedRelAuto: Intl.RelativeTimeFormat | null = null;
let cachedRelAlways: Intl.RelativeTimeFormat | null = null;

function relAuto(): Intl.RelativeTimeFormat {
  if (cachedRelAuto && cachedRelLocale === activeLocale) return cachedRelAuto;
  cachedRelLocale = activeLocale;
  cachedRelAuto = new Intl.RelativeTimeFormat(activeLocale, { numeric: 'auto' });
  cachedRelAlways = new Intl.RelativeTimeFormat(activeLocale, { numeric: 'always' });
  return cachedRelAuto;
}

function relAlways(): Intl.RelativeTimeFormat {
  if (cachedRelAlways && cachedRelLocale === activeLocale) return cachedRelAlways;
  relAuto(); // setzt beide
  return cachedRelAlways as Intl.RelativeTimeFormat;
}

// Lange relative Zeitangabe: heute / gestern / vor X Tagen / vor X
// Monaten / vor X Jahren — pro user_profiles.language lokalisiert.
export function formatRelativeDeLong(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isValidDate(d)) return iso;
  const diffMs = d.getTime() - Date.now();
  const days = Math.round(diffMs / 86_400_000);
  if (Math.abs(days) <= 1) return relAuto().format(days, 'day');
  if (Math.abs(days) < 30) return relAlways().format(days, 'day');
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return relAlways().format(months, 'month');
  const years = Math.round(months / 12);
  return relAlways().format(years, 'year');
}

// Kurze relative Zeitangabe mit Datum-Fallback: heute / gestern /
// vor X Tagen (< 7) / Lokal-Datum. Fuer Cards/Cells wo aelteres
// Material das exakte Datum braucht (Vorlagen-Liste, Aktivitaet-Stream).
export function formatRelativeDeShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!isValidDate(d)) return iso;
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (Math.abs(days) <= 1) return relAuto().format(days, 'day');
  if (Math.abs(days) < 7) return relAlways().format(days, 'day');
  return d.toLocaleDateString(activeShortLocale, withTz({}));
}
