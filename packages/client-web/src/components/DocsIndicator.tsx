// Welle D.9 — DocsIndicator.
//
// Mini-Icon mit Count fuer Atom-Chips (Kanban-Card / Calendar-Chip /
// Sidebar-Tree-Atom). Zeigt nur dann etwas, wenn count > 0 — kein
// "+0"-Stub, der die Karte unnoetig dekoriert.
//
// Click delegiert an den Caller (typisch: oeffnet Atom-Detail-Modal
// oder direkt das DocsPopup mit dem ersten gepinnten Doc).

import { type Component, Show } from 'solid-js';
import Icon from './Icon';

export type DocsIndicatorProps = {
  count: number;
  onClick?: (e: MouseEvent) => void;
  title?: string;
};

const DocsIndicator: Component<DocsIndicatorProps> = (p) => {
  return (
    <Show when={p.count > 0}>
      <button
        type="button"
        class="docs-indicator"
        onClick={(e) => {
          e.stopPropagation();
          p.onClick?.(e);
        }}
        title={p.title ?? `${p.count} Doku${p.count === 1 ? '' : 's'} angeheftet`}
        aria-label={`${p.count} Dokus`}
      >
        <Icon name="document-text" size={11} />
        <span class="docs-indicator-count">{p.count}</span>
      </button>
    </Show>
  );
};

export default DocsIndicator;
