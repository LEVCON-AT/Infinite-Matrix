// Welle WV.C.5 — BulkScalarInput (Konzept §8.2.4).
//
// Single-Input applies-to-all als Default + Drilldown-Button am rechten
// Ende, der eine Liste aufklappt fuer Per-Row-Edit. Auf/Ab-Hotkey
// navigiert. Reuse-Faelle:
// - Bulk-Alias-Vergabe (Welle C.4 — diese Welle).
// - Bulk-Tag-Vergabe (V2).
// - Bulk-Naming-Override (V2).
// - Bulk-Field-Edit fuer typed info_field-Atome (V2).

import { type Component, For, Show, createSignal } from 'solid-js';
import Icon from '../Icon';

export type BulkScalarRow = {
  // Stable Key fuer For + Per-Row-Lookup.
  id: string;
  // Sichtbares Label, z.B. „jan/kunde".
  label: string;
  // Aktueller Wert (vom Caller verwaltet).
  value: string;
};

export type BulkScalarInputProps = {
  // Pattern-Input oben („info-{row}-{col}").
  patternValue: string;
  patternLabel: string;
  patternPlaceholder?: string;
  onPatternInput: (value: string) => void;
  onApplyPattern: () => void;
  // Drilldown-Liste unten: pro Row Wert + Edit.
  rows: ReadonlyArray<BulkScalarRow>;
  onRowInput: (id: string, value: string) => void;
};

const BulkScalarInput: Component<BulkScalarInputProps> = (p) => {
  const [open, setOpen] = createSignal(false);
  let listRef: HTMLDivElement | undefined;

  // Pfeil-Hoch/Pfeil-Runter navigiert zwischen Rows. V1 simpel:
  // tab-order via natuerliches Layout, key-Handler nur Pfeile.
  function handleKeyDown(e: KeyboardEvent, idx: number): void {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const target = listRef?.querySelectorAll<HTMLInputElement>('input.bulk-scalar-row-input')[
      idx + dir
    ];
    target?.focus();
  }

  return (
    <div class="bulk-scalar-input">
      <div class="bulk-scalar-pattern-row">
        <label class="bulk-scalar-pattern-label" for="bulk-scalar-pattern-input">
          {p.patternLabel}
        </label>
        <div class="bulk-scalar-pattern-field">
          <input
            id="bulk-scalar-pattern-input"
            type="text"
            class="bulk-scalar-pattern-input"
            value={p.patternValue}
            placeholder={p.patternPlaceholder ?? '{vorlage}-{row}-{col}'}
            onInput={(e) => p.onPatternInput(e.currentTarget.value)}
            spellcheck={false}
            autocomplete="off"
          />
          <button
            type="button"
            class="bulk-scalar-pattern-apply"
            onClick={p.onApplyPattern}
            title="Auf alle anwenden"
          >
            <Icon name="check" size={12} />
            <span>Auf alle</span>
          </button>
          <button
            type="button"
            class="bulk-scalar-pattern-toggle"
            onClick={() => setOpen(!open())}
            aria-label={open() ? 'Liste schliessen' : 'Per-Zeile editieren'}
            aria-expanded={open()}
          >
            <Icon name="ellipsis-horizontal" size={12} />
          </button>
        </div>
      </div>

      <Show when={open()}>
        <div
          class="bulk-scalar-list"
          ref={(el) => {
            listRef = el;
          }}
        >
          <For each={p.rows}>
            {(row, idx) => {
              const inputId = `bulk-scalar-row-${row.id}`;
              return (
                <div class="bulk-scalar-row">
                  <label class="bulk-scalar-row-label" for={inputId}>
                    {row.label}
                  </label>
                  <input
                    id={inputId}
                    type="text"
                    class="bulk-scalar-row-input"
                    value={row.value}
                    onInput={(e) => p.onRowInput(row.id, e.currentTarget.value)}
                    onKeyDown={(e) => handleKeyDown(e, idx())}
                  />
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};

export default BulkScalarInput;
