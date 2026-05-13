// Welle WV.B Stub — info_field-Atom-Renderer-Stub (View-Only V1).
//
// Rendert eine atom_manifestations(kind='info')-Sicht eines info_field-
// Atoms als Card: Symbol + Label + value_type-aware Value + AtomMarker-
// Bar (§13.3 V2.G — schliesst die info_field-Luecke aus §13.3 V1).
//
// V1-Tradeoffs (Welle B Vollausbau in Step 8/12/13):
//   - View-Only — kein Inline-Edit der Label/Value-Felder. addInfoField-
//     ForCell-Pfad legt neue Atome an; Aenderungen via Welle B Step 13
//     IconPicker + Form-Widget.
//   - Kein Drag-Drop (Cross-View deferred zu Welle E §9.13).
//   - value_type-Rendering minimal: text/number/currency/date/boolean/
//     email/phone/url distinkt, enum/alias-ref Text-Fallback bis Welle B.
//
// Konsumenten:
//   - components/CellInfoPage Section "Atom-Felder (Welle B Vorschau)".

import { type Component, Match, Show, Switch, createMemo } from 'solid-js';
import type { AtomManifestationRow } from '../lib/atom-manifestations';
import { formatDateDE } from '../lib/dates';
import { resolveInfoFieldSymbol } from '../lib/symbol-resolution';
import type { AtomMarkerRow, InfoFieldRow, InfoFieldValueType } from '../lib/types';
import { sanitizeUrl } from '../lib/url';
import AtomMarkerBar from './AtomMarkerBar';
import AtomSymbol from './AtomSymbol';

type Props = {
  workspaceId: string;
  userId: string;
  atom: InfoFieldRow;
  manifestation: AtomManifestationRow;
  // Workspace-skopierte Markers — AtomMarkerBar filtert intern auf
  // (atom_type, atom_id). Caller liefert die Resource-Liste direkt.
  markers: ReadonlyArray<AtomMarkerRow>;
};

// V1-Tradeoff: currency hardcoded EUR — Welle B liest value_meta.currency.
const CURRENCY_DEFAULT = 'EUR';

function formatNumber(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString('de-DE');
}

function formatCurrency(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString('de-DE', { style: 'currency', currency: CURRENCY_DEFAULT });
}

function formatBoolean(value: string): string {
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'ja' || v === 'yes') return 'Ja';
  if (v === 'false' || v === '0' || v === 'nein' || v === 'no') return 'Nein';
  return value;
}

const InfoFieldAtomCard: Component<Props> = (p) => {
  const resolved = createMemo(() =>
    resolveInfoFieldSymbol(p.atom.value_type as InfoFieldValueType, p.atom.symbol_override),
  );

  const valueDisplay = createMemo<string>(() => {
    const v = p.atom.value ?? '';
    if (!v) return '';
    const t = p.atom.value_type as InfoFieldValueType;
    switch (t) {
      case 'number':
        return formatNumber(v);
      case 'currency':
        return formatCurrency(v);
      case 'date':
        return formatDateDE(v);
      case 'boolean':
        return formatBoolean(v);
      default:
        return v;
    }
  });

  return (
    <article
      class="ifa-card"
      data-atom-type="info_field"
      data-value-type={p.atom.value_type}
      aria-label={`Info-Feld ${p.atom.label}`}
    >
      <span class="ifa-symbol" aria-hidden="true">
        <AtomSymbol resolved={resolved()} size={16} />
      </span>
      <span class="ifa-label">{p.atom.label}</span>
      <span class="ifa-value">
        <Switch fallback={<span class="ifa-value-text">{valueDisplay()}</span>}>
          <Match when={p.atom.value_type === 'url' && p.atom.value}>
            {(_) => {
              const safe = sanitizeUrl(p.atom.value ?? '');
              return safe ? (
                <a class="ifa-value-link" href={safe} target="_blank" rel="noopener noreferrer">
                  {p.atom.value}
                </a>
              ) : (
                <span class="ifa-value-text">{p.atom.value}</span>
              );
            }}
          </Match>
          <Match when={p.atom.value_type === 'email' && p.atom.value}>
            <a class="ifa-value-link" href={`mailto:${p.atom.value}`}>
              {p.atom.value}
            </a>
          </Match>
          <Match when={p.atom.value_type === 'phone' && p.atom.value}>
            <a class="ifa-value-link" href={`tel:${p.atom.value}`}>
              {p.atom.value}
            </a>
          </Match>
        </Switch>
      </span>
      <Show when={p.userId}>
        <AtomMarkerBar
          workspaceId={p.workspaceId}
          userId={p.userId}
          atomType="info_field"
          atomId={p.atom.id}
          markers={p.markers}
        />
      </Show>
    </article>
  );
};

export default InfoFieldAtomCard;
