// Welle WV.B Stub §13.3 V2.H — link-Atom-Renderer-Stub (View-Only V1).
//
// Rendert eine atom_manifestations(kind='pinned', atom_type='link')-Sicht
// eines link-Atoms als Card: provider-Symbol + Label + URL als safe-Link
// + AtomMarkerBar (schliesst die letzte atom_markers-CHECK-Luecke aus
// §13.3 V1 — Pattern analog InfoFieldAtomCard).
//
// V1-Tradeoffs (Welle B Vollausbau in Step 9/12/13):
//   - View-Only — kein Inline-Edit fuer Label/URL/Provider.
//   - Kein Drag-Drop (Cross-View deferred zu Welle E §9.13).
//   - Kein click_count-Increment-Tracker — Welle B Step 13 mit
//     mcp_increment_link_click_count-RPC.
//
// Konsumenten:
//   - components/CellInfoPage Section "Atom-Links (Welle B Vorschau)".

import { type Component, Show, createMemo } from 'solid-js';
import type { AtomManifestationRow } from '../lib/atom-manifestations';
import { incrementLinkClickCount } from '../lib/link-clicks';
import { resolveLinkSymbol } from '../lib/symbol-resolution';
import type { AtomMarkerRow, LinkRow } from '../lib/types';
import { sanitizeUrl } from '../lib/url';
import AtomMarkerBar from './AtomMarkerBar';
import AtomSymbol from './AtomSymbol';

type Props = {
  workspaceId: string;
  userId: string;
  atom: LinkRow;
  manifestation: AtomManifestationRow;
  // Workspace-skopierte Markers — AtomMarkerBar filtert intern auf
  // (atom_type, atom_id). Caller liefert die Resource-Liste direkt.
  markers: ReadonlyArray<AtomMarkerRow>;
};

const LinkAtomCard: Component<Props> = (p) => {
  const resolved = createMemo(() =>
    resolveLinkSymbol(p.atom.provider, p.atom.url, p.atom.symbol_override),
  );
  const safeHref = createMemo(() => sanitizeUrl(p.atom.url));
  const displayLabel = createMemo(() => (p.atom.label?.trim().length ? p.atom.label : p.atom.url));

  return (
    <article
      class="ifa-card"
      data-atom-type="link"
      data-provider={p.atom.provider}
      aria-label={`Link ${displayLabel()}`}
    >
      <span class="ifa-symbol" aria-hidden="true">
        <AtomSymbol resolved={resolved()} size={16} />
      </span>
      <span class="ifa-label">{displayLabel()}</span>
      <span class="ifa-value">
        <Show when={safeHref()} fallback={<span class="ifa-value-text">{p.atom.url}</span>}>
          {(href) => (
            <a
              class="ifa-value-link"
              href={href()}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => incrementLinkClickCount(p.atom.id)}
            >
              {p.atom.url}
            </a>
          )}
        </Show>
      </span>
      <Show when={p.userId}>
        <AtomMarkerBar
          workspaceId={p.workspaceId}
          userId={p.userId}
          atomType="link"
          atomId={p.atom.id}
          markers={p.markers}
        />
      </Show>
    </article>
  );
};

export default LinkAtomCard;
