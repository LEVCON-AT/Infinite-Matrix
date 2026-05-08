// Welle WV.C.5 — BulkConflictPicker (Konzept §8.2.4a).
//
// Liste der konflikthaften Items (Cells / Atome / Tags / Channels)
// mit Checkbox pro Item, Group-Toggle „Alle markieren / Alle abmarkieren",
// Konflikt-Art-Tag pro Zeile, Default markiert=ueberspringen,
// Abmarkieren=Aktion mit Confirm-Stufe.
//
// Reuse-Faelle:
// - Bulk-Apply Cells (Welle C.4 — diese Welle).
// - Bulk-Tag Atome (V2).
// - Bulk-Channel-Apply Widgets (V2).
// - Bulk-Schema-Migration (V2).
// - Fundus-Restore-Konflikte (Welle WV.Z).

import { type Component, For, Show, createMemo } from 'solid-js';
import Icon from '../Icon';

export type ConflictKind = 'other-template' | 're-sync' | 'overrides' | 'locked' | 'duplicate';

export type BulkConflictItem = {
  id: string;
  label: string;
  // Detail-Hinweis pro Konfliktart (z.B. „Kanban Default v1").
  detail?: string;
  kind: ConflictKind;
};

export type BulkConflictPickerProps = {
  // Header-Text z.B. „Vorlage „Info Vertrag" wird auf 12 Cells angewendet."
  summary: string;
  items: ReadonlyArray<BulkConflictItem>;
  // Set von skip-IDs (default = alle ids = ueberspringen).
  skipIds: ReadonlySet<string>;
  onToggleItem: (id: string) => void;
  onToggleAll: (allSkip: boolean) => void;
};

const KIND_LABEL: Record<ConflictKind, string> = {
  'other-template': 'andere Vorlage',
  're-sync': 're-sync',
  overrides: 'Overrides',
  locked: 'locked',
  duplicate: 'Duplikat',
};

const BulkConflictPicker: Component<BulkConflictPickerProps> = (p) => {
  const allSkipped = createMemo(() => p.items.every((it) => p.skipIds.has(it.id)));
  const someActed = createMemo(() => p.items.some((it) => !p.skipIds.has(it.id)));

  return (
    <fieldset class="bulk-conflict-picker">
      <legend class="bulk-conflict-legend">Konflikt-Items</legend>
      <p class="bulk-conflict-summary">{p.summary}</p>
      <p class="bulk-conflict-hint">
        Default: ueberspringen. Abmarkieren = ueberschreiben/re-sync — Datenverlust-Confirm folgt
        beim „Weiter".
      </p>

      <div class="bulk-conflict-bulk-actions">
        <button
          type="button"
          class="btn-subtle"
          onClick={() => p.onToggleAll(true)}
          disabled={allSkipped()}
        >
          <Icon name="check" size={12} />
          <span>Alle ueberspringen</span>
        </button>
        <button
          type="button"
          class="btn-subtle"
          onClick={() => p.onToggleAll(false)}
          disabled={someActed() && !allSkipped()}
        >
          <Icon name="no-symbol" size={12} />
          <span>Alle aktiv</span>
        </button>
      </div>

      <ul class="bulk-conflict-list">
        <For each={p.items}>
          {(item) => {
            const skipped = () => p.skipIds.has(item.id);
            return (
              <li class="bulk-conflict-row" classList={{ skipped: skipped() }}>
                <label class="bulk-conflict-label">
                  <input
                    type="checkbox"
                    checked={skipped()}
                    onChange={() => p.onToggleItem(item.id)}
                    aria-label={`${item.label} ${skipped() ? 'ueberspringen' : 'anwenden'}`}
                  />
                  <span class="bulk-conflict-name">{item.label}</span>
                </label>
                <Show when={item.detail}>
                  <span class="bulk-conflict-detail">{item.detail}</span>
                </Show>
                <span class={`bulk-conflict-tag tag-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
              </li>
            );
          }}
        </For>
      </ul>
    </fieldset>
  );
};

export default BulkConflictPicker;
