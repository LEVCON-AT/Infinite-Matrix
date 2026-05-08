// Welle WV.D Folge — BrandIcon-Component.
//
// Rendert Brand-distinct-Glyphen aus lib/brand-icons.ts. 24x24 viewBox,
// stroke-only (matching Icon.tsx-Heroicons). Optional `colored`-Prop
// rendert mit Brand-Color statt currentColor — fuer Provider-Slot-
// Cards in AccountChannels mit groesserer visueller Praesenz.
//
// Konsumenten siehe lib/brand-icons.ts Header.
//
// Pattern (analog Icon.tsx): pure SVG-Render, kein Reactivity-Overhead,
// flex-shrink:0 + display:block via .icon-Klasse.

import type { Component } from 'solid-js';
import { type BrandKey, brandColor, brandPath } from '../lib/brand-icons';

type Props = {
  brand: BrandKey;
  size?: number;
  // Wenn true: rendert mit Brand-Hex-Color statt currentColor.
  // Default false — token-konform fuer Listen / Picker.
  colored?: boolean;
  class?: string;
};

const BrandIcon: Component<Props> = (p) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={p.size ?? 16}
      height={p.size ?? 16}
      fill="none"
      stroke={p.colored ? brandColor(p.brand) : 'currentColor'}
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={`icon ${p.class ?? ''}`.trim()}
      aria-hidden="true"
    >
      <path d={brandPath(p.brand)} />
    </svg>
  );
};

export default BrandIcon;
