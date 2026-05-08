// Welle WV.D Folge — Brand-Distinct-Glyphen pro Channel-Provider.
//
// Konzept-Verankerung: §12.3.2 (Auto-Symbol pro Link-Provider) +
// Memory `project_widget_vorlagen_konzept.md` Verbleibend „Brand-SVG-
// Bundle". V1 in symbol-resolution.ts mappt alle Provider auf
// generische Heroicons (cloud / chat-bubble / envelope) — diese Datei
// liefert brand-distinct Glyphen, die in der UI wie Heroicons
// gerendert werden (24x24 viewBox, currentColor-kompatibel) und
// Provider visuell trennscharf machen ohne Trademark-Kopien.
//
// Pattern: monochromatische SVG-Pfade mit currentColor. Brand-Farbe
// als optionaler Hint — Component rendert Default in --text-Farbe oder
// kann per Prop auf brandColor gesetzt werden (z.B. fuer
// Provider-Slot-Cards in AccountChannels).
//
// Konsumenten:
//   - components/BrandIcon (Render-Component).
//   - lib/channels-meta CHANNEL_PROVIDER_BRAND_KEY (Mapping
//     ChannelProvider → BrandKey).
//   - routes/settings/AccountChannels (Provider-Slot-Cards).
//   - components/ChannelWidget / DriveWidget / ChannelPickerModal /
//     ChannelTokenSetupModal.
//
// Pflege: neue Provider → Eintrag hier + in CHANNEL_PROVIDER_BRAND_KEY
// + ggf. Brand-Color in BRAND_COLORS. Heroicons-Fallback bleibt in
// channels-meta.CHANNEL_PROVIDER_ICON falls BrandIcon-Render scheitert.

// Brand-Keys decken die 13 Channel-Provider aus types.ChannelProvider.
// 'mail-generic' bekommt einen neutralen Brand-Marker (Generic-Mail).
export type BrandKey =
  | 'outlook'
  | 'gmail'
  | 'mail-generic'
  | 'onenote'
  | 'onedrive'
  | 'drive'
  | 'dropbox'
  | 'nextcloud'
  | 'slack'
  | 'teams'
  | 'discord'
  | 'whatsapp'
  | 'telegram';

// Brand-Farben fuer Provider-Slot-Cards. Werden NUR fuer „Highlight"-
// Render benutzt (z.B. wenn Provider verbunden ist + Card ist gross).
// In der Liste / im Picker rendert BrandIcon mit currentColor — bleibt
// damit token-konform und passt in Dark-Mode.
export const BRAND_COLORS: Record<BrandKey, string> = {
  outlook: '#0078D4',
  gmail: '#EA4335',
  'mail-generic': '#6B7280',
  onenote: '#7719AA',
  onedrive: '#0078D4',
  drive: '#1A73E8',
  dropbox: '#0061FF',
  nextcloud: '#0082C9',
  slack: '#4A154B',
  teams: '#5059C9',
  discord: '#5865F2',
  whatsapp: '#25D366',
  telegram: '#26A5E4',
};

// Brand-distinct Glyphen — 24x24 viewBox, currentColor-kompatibel.
// Bewusst KEINE 1:1 Logo-Kopien sondern brand-evokative monochrome
// Marker. Trademark-sicher, aber visuell trennscharf zwischen den
// 13 Providern.
export const BRAND_PATHS: Record<BrandKey, string> = {
  // Outlook — Briefumschlag mit O auf der Klappe
  outlook:
    'M3 7v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2Zm2 0 5 4 5-4M16 7v10M19 8h2v8h-2',
  // Gmail — Briefumschlag mit M-Innenform
  gmail: 'M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-9 6Zm0 0 9 6 9-6m-9 6V19',
  // Mail-Generic — neutraler Briefumschlag
  'mail-generic': 'M3 7h18v10H3Zm0 0 9 6 9-6',
  // OneNote — aufgeschlagenes Notizbuch mit N
  onenote: 'M5 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5Zm0 0v16M9 8v8l5-8v8',
  // OneDrive — Wolke mit nach oben weisendem Pfeil
  onedrive: 'M7 17a4 4 0 0 1 0-7 5 5 0 0 1 9-1 4 4 0 0 1 1 8H7Zm5-8v8m-3-5 3-3 3 3',
  // Drive — Dreiecks-Konstruktion (3 verbundene Dreiecke)
  drive: 'm12 4 8 14h-6l-3-5 3-5Zm0 0L4 18h6l3-5-3-5Zm-3 9h6l3 5H6Z',
  // Dropbox — vier Diamanten (Box-Shape)
  dropbox: 'm6 6 6 4-6 4 6 4 6-4-6-4 6-4-6 4ZM7 16l5 3 5-3',
  // Nextcloud — drei Kreise in Wolke
  nextcloud:
    'M5 14a4 4 0 0 1 4-4 5 5 0 0 1 9 0 3 3 0 0 1 0 6H9a4 4 0 0 1-4-4Zm5 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0Zm4 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0Z',
  // Slack — vier Quadrate kreuz-foermig (Hash-Pattern)
  slack:
    'M9 4h2v6H9Zm0 10h2v6H9ZM4 9h6v2H4Zm10 0h6v2h-6ZM9 4a2 2 0 0 0-2 2v3M14 14h3a2 2 0 0 0 2-2M9 19a2 2 0 0 1-2-2v-3M14 9V6a2 2 0 0 1 2-2',
  // Teams — Chat-Bubble mit T-Shape
  teams:
    'M4 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3l-4 3v-3H6a2 2 0 0 1-2-2Zm4 2h6m-3 0v6',
  // Discord — Sprachsteuerungs-Pille mit zwei „Augen"
  discord:
    'M5 8a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3l-2 2-1-2H8a3 3 0 0 1-3-3Zm4 3a1 1 0 1 0 2 0 1 1 0 1 0-2 0Zm4 0a1 1 0 1 0 2 0 1 1 0 1 0-2 0Z',
  // WhatsApp — Telefon im Chat-Bubble
  whatsapp:
    'M5 18 6 14a7 7 0 1 1 4 4Zm5-9 1 1 1-1 2 2-1 2 1 1c1.5 2.5 4 4 5 4l1-1 2 2-1 1c-1 .5-3 .5-5-1s-3.5-3-5-5c-1-2-1-4-.5-5l1-1Z',
  // Telegram — Papierflieger mit Bogen-Spur
  telegram: 'm3 11 18-7-3 16-6-5-3 5-1-6 10-7-12 4Z',
};

// Helper: gibt SVG-Pfad-String zurueck; null wenn brandKey unbekannt.
// Component (BrandIcon) nutzt das fuer einen sicheren Render.
export function brandPath(key: BrandKey): string {
  return BRAND_PATHS[key];
}

// Helper: gibt Brand-Color zurueck. Component nutzt das wenn Caller
// `colored={true}` setzt — sonst rendert mit currentColor.
export function brandColor(key: BrandKey): string {
  return BRAND_COLORS[key];
}
