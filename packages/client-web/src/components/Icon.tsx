// Zentrale SVG-Icon-Komponente. Paths aus Heroicons v2 (MIT-Lizenz,
// heroicons.com/outline) — dasselbe Set das HyperUI/Tailwind-UI nutzt.
// Konsistente 24x24 ViewBox, stroke-width 1.75 (zwischen outline 2 und
// solid 0 — wirkt sauber ohne zu duenn zu sein).
//
// Verwendung:
//   <Icon name="chevron-right" />          default 16px
//   <Icon name="x" size={20} />            groessere Icons z.B. in Buttons
//   <Icon name="check" class="text-green"/> CSS-driven Color (currentColor)
//
// Erweitern: neuen IconName-Eintrag in der Union + Path-Eintrag im ICONS-
// Record. Path direkt von heroicons.com/outline kopieren.

import type { Component, JSX } from 'solid-js';

export type IconName =
  | 'chevron-right'
  | 'chevron-left'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-double-left'
  | 'chevron-double-right'
  | 'x'
  | 'x-circle'
  | 'check'
  | 'check-circle'
  | 'plus'
  | 'minus'
  | 'search'
  | 'sparkles'
  | 'arrow-path'
  | 'sun'
  | 'moon'
  | 'question-mark'
  | 'pencil'
  | 'trash'
  | 'bars-3'
  | 'cog'
  | 'ellipsis-horizontal'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrows-pointing-out'
  | 'document-text'
  | 'calendar'
  | 'clipboard-document'
  | 'tag'
  | 'user'
  | 'arrow-uturn-left'
  | 'paint-brush'
  | 'archive-box'
  | 'link';

// Heroicons v2 outline path-data. 24x24 viewBox.
const ICONS: Record<IconName, JSX.Element> = {
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-up': <path d="m18 15-6-6-6 6" />,
  'chevron-double-left': (
    <>
      <path d="m18 18-6-6 6-6" />
      <path d="m11 18-6-6 6-6" />
    </>
  ),
  'chevron-double-right': (
    <>
      <path d="m6 18 6-6-6-6" />
      <path d="m13 18 6-6-6-6" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  'x-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <path d="m5.6 5.6 2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  'arrow-path': (
    <>
      <path d="M4 12a8 8 0 0 1 14-5.3L20 9" />
      <path d="M20 4v5h-5" />
      <path d="M20 12a8 8 0 0 1-14 5.3L4 15" />
      <path d="M4 20v-5h5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1 1M17.4 17.4l1 1M5.6 18.4l1-1M17.4 6.6l1-1" />
    </>
  ),
  moon: <path d="M20 15.3A8 8 0 1 1 8.7 4a7 7 0 0 0 11.3 11.3Z" />,
  'question-mark': (
    <>
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-1 .4-1.5 1.1-1.5 2.2v.5" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  pencil: (
    <>
      <path d="m16.5 4.5 3 3" />
      <path d="M18 6 8 16l-3 1 1-3L16 4a1.4 1.4 0 0 1 2 0Z" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6h16" />
      <path d="M9 6V4h6v2" />
      <path d="M6 6v13a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  'bars-3': (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </>
  ),
  cog: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8A1.7 1.7 0 0 0 3.2 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
  'ellipsis-horizontal': (
    <>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  'arrow-up': (
    <>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </>
  ),
  'arrow-down': (
    <>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </>
  ),
  'arrows-pointing-out': (
    <>
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3 14 10" />
      <path d="M3 21l7-7" />
    </>
  ),
  'document-text': (
    <>
      <path d="M14 3v5h5" />
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-5Z" />
      <path d="M8 13h8M8 17h5" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 10h16" />
      <path d="M9 3v4M15 3v4" />
    </>
  ),
  'clipboard-document': (
    <>
      <rect x="5" y="5" width="14" height="16" rx="2" />
      <path d="M9 5V3h6v2" />
    </>
  ),
  tag: (
    <>
      <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9-9-9Z" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </>
  ),
  'arrow-uturn-left': (
    <>
      <path d="M9 15 3 9l6-6" />
      <path d="M3 9h10a6 6 0 0 1 6 6v6" />
    </>
  ),
  'paint-brush': (
    <>
      <path d="m14 6 4 4L8 20l-4 1 1-4Z" />
      <path d="m14 6 3-3 4 4-3 3" />
    </>
  ),
  'archive-box': (
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 1 0-5.6l2.8-2.8a4 4 0 0 1 5.6 5.6L17 12.6" />
      <path d="M14 10a4 4 0 0 1 0 5.6l-2.8 2.8a4 4 0 0 1-5.6-5.6L7 11.4" />
    </>
  ),
};

type Props = {
  name: IconName;
  size?: number;
  class?: string;
};

const Icon: Component<Props> = (p) => {
  // flex-shrink:0 + display:block verhindert, dass der Icon im Flex-
  // Container durch andere Items "zerdrueckt" wird (resultiert sonst in
  // width:0). width/height Attribute allein reichen im Flex-Kontext nicht.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={p.size ?? 16}
      height={p.size ?? 16}
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={p.class}
      aria-hidden="true"
      style={{ flex: '0 0 auto', display: 'block' }}
    >
      {ICONS[p.name]}
    </svg>
  );
};

export default Icon;
