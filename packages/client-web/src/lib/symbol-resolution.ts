// Welle WV.B.6 — Symbol-Resolution Foundation.
//
// Konzept §12.3 — Auto-Symbole pro Field-Type + Provider, plus
// User-Override + Favicon-Fallback.
//
// Resolution-Order (§12.3.4):
//   1. User-Override (manuelle Auswahl via IconPicker, gespeichert in
//      info_fields.symbol_override / links.symbol_override).
//   2. Favicon-Fetch (nur fuer link.provider='url', SW-Cache TTL 30d).
//   3. Auto-Symbol vom Provider / Field-Type (Konzept §12.3.1/2).
//   4. Generisches Fallback (globe / document).
//
// V1-Scope:
//   - Pure-Function-Resolver fuer Heroicons-Defaults.
//   - Brand-SVG-Bundle-Assets (Welle B fortgesetzt) — diese Datei
//     liefert die Mapping-Helper, der tatsaechliche SVG-Inline-Render
//     kommt mit IconPicker-Komponente.
//   - Favicon-Service-Worker-Cache wird nur angedeutet — eigener
//     Sub-Sprint (Welle B fortgesetzt) implementiert SW-Caching.
//
// Konsumenten:
//   - components/CellInfoPage Form-Widget (Welle B+C fortgesetzt).
//   - components/TemplateWidgetRenderer (Welle A) — kann ResolvedSymbol
//     fuer Widget-Header nutzen.
//   - IconPicker-Modal (Welle B fortgesetzt).

import type { IconName } from '../components/Icon';
import type { InfoFieldValueType, LinkProvider } from './types';

// ─── Auto-Symbol pro Field-Type (Konzept §12.3.1) ──────────────
// 10 Heroicons-Defaults pro value_type. IconName-Enum aus components/Icon
// limitiert was wir hier benutzen koennen — fehlen IconName-Werte
// (banknotes, calculator, at-symbol, etc.), nehmen wir Fallback aus
// existing IconName-Set.

const FIELD_TYPE_SYMBOL: Record<InfoFieldValueType, IconName> = {
  text: 'document-text',
  // 'calculator' ist nicht in IconName — wir nehmen 'cog' als Fallback
  // bis IconName erweitert wird (Welle B fortgesetzt).
  number: 'cog',
  date: 'calendar',
  // 'banknotes' / 'currency-euro' nicht in IconName — Fallback.
  currency: 'tag',
  boolean: 'check-circle',
  email: 'envelope',
  // 'phone' nicht in IconName — Fallback bis IconName-Erweiterung
  // (Welle B fortgesetzt). 'envelope' ist visuell verwandt (Kontakt).
  phone: 'envelope',
  url: 'link',
  enum: 'list-bullet',
  // 'at-symbol' nicht in IconName — Fallback auf 'tag' (Alias-Marker).
  'alias-ref': 'tag',
};

// ─── Auto-Symbol pro Link-Provider (Konzept §12.3.2) ───────────
// 15 Provider. Brand-Icons (slack/notion/...) sind als externe SVGs
// gedacht — V1 mappen wir auf Heroicons-Fallbacks bis Brand-Bundle
// in Welle B fortgesetzt einzieht. Exporttabelle separat damit
// Component pro Provider eigene Logic ziehen kann (z.B. Favicon
// fuer 'url', SVG-Sprite fuer 'slack').

const LINK_PROVIDER_SYMBOL: Record<LinkProvider, IconName> = {
  // url: Favicon-bevorzugt (siehe resolveLinkSymbol). Fallback Heroicon.
  url: 'arrow-top-right-on-square',
  mail: 'envelope',
  'mail-generic': 'envelope',
  // Brand-Provider — V1-Fallback auf generic Icons. Welle B
  // fortgesetzt: Brand-SVG-Sprites einbinden.
  onenote: 'document-text',
  notion: 'document-text',
  onedrive: 'archive-box',
  drive: 'archive-box',
  dropbox: 'archive-box',
  nextcloud: 'archive-box',
  slack: 'envelope',
  teams: 'users',
  whatsapp: 'envelope',
  discord: 'users',
  telegram: 'envelope',
  filesystem: 'archive-box',
};

// ─── Resolver ──────────────────────────────────────────────────

export type SymbolSource = 'override' | 'favicon' | 'auto' | 'fallback';

export type ResolvedSymbol = {
  iconName: IconName;
  source: SymbolSource;
  // Wenn source='favicon': URL des Favicon-Bildes (vom Caller via
  // <img>-Tag gerendert, nicht via Icon-Component).
  faviconUrl?: string;
};

// Resolved Symbol fuer einen typed Info-Field. Caller liefert override
// (info_fields.symbol_override) optional — Auto bei null.
export function resolveInfoFieldSymbol(
  valueType: InfoFieldValueType,
  symbolOverride: string | null,
): ResolvedSymbol {
  if (symbolOverride && isKnownIconName(symbolOverride)) {
    return { iconName: symbolOverride, source: 'override' };
  }
  return { iconName: FIELD_TYPE_SYMBOL[valueType] ?? 'document-text', source: 'auto' };
}

// Resolved Symbol fuer einen Link. Bei provider='url' und kein
// override: faviconUrl gesetzt — Caller kann <img src=faviconUrl>
// rendern oder auf iconName-Fallback ausweichen wenn Favicon-Fetch
// scheitert.
export function resolveLinkSymbol(
  provider: LinkProvider,
  url: string,
  symbolOverride: string | null,
): ResolvedSymbol {
  if (symbolOverride && isKnownIconName(symbolOverride)) {
    return { iconName: symbolOverride, source: 'override' };
  }
  if (provider === 'url') {
    const favicon = buildFaviconUrl(url);
    if (favicon) {
      return { iconName: 'arrow-top-right-on-square', source: 'favicon', faviconUrl: favicon };
    }
  }
  return { iconName: LINK_PROVIDER_SYMBOL[provider] ?? 'link', source: 'auto' };
}

// ─── Favicon-URL-Builder ───────────────────────────────────────
// V1: Google s2 favicon-Service. Cache TTL 30d via Service-Worker
// (separater Sub-Sprint — V1 hier nur die Hostname-basierte URL).
//
// Datenfluss:
//   buildFaviconUrl('https://example.com/path') →
//     'https://www.google.com/s2/favicons?domain=example.com&sz=32'
//
// SW-Cache: keyed auf hostname, TTL 30d. Fallback auf Heroicon-Auto
// wenn SW nicht erreichbar / Image-Load failed.

function buildFaviconUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=32`;
  } catch {
    return null;
  }
}

// ─── IconName-Validation ───────────────────────────────────────
// Pruefe ob ein User-eingegebener Icon-Name im IconName-Domain liegt.
// Caller (IconPicker) sollte direkt aus IconName-Liste waehlen, das
// hier ist defensive fuer alte Override-Werte aus DB.

function isKnownIconName(name: string): name is IconName {
  // V1: keine reflexive IconName-Liste — wir akzeptieren jeden String
  // als plausibel und lassen Icon-Component selbst entscheiden ob
  // er den Namen rendert. Welle B fortgesetzt: ICON_NAMES-Whitelist
  // exportieren aus components/Icon.tsx.
  return name.length > 0 && /^[a-z][a-z0-9-]*$/.test(name);
}

// ─── Re-Export der Maps fuer Tests + IconPicker ────────────────
export const FIELD_TYPE_SYMBOL_MAP: Readonly<Record<InfoFieldValueType, IconName>> =
  FIELD_TYPE_SYMBOL;
export const LINK_PROVIDER_SYMBOL_MAP: Readonly<Record<LinkProvider, IconName>> =
  LINK_PROVIDER_SYMBOL;
