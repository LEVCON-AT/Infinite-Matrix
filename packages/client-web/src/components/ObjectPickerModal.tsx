// Welle D.7b — ObjectPickerModal.
//
// Modal-Picker fuer object_ref-Tags. Listet Cells + Nodes (Matrix/Board)
// im Workspace mit Filter + Kind-Tabs. Click auf Eintrag → onPick(kind,
// id, label) -> addAtomTagObjectRef.
//
// Pattern parallel zu AtomPickerModal (overlay-scrim + focus-trap +
// ESC). Daten kommen vom Caller via Workspace-Resources.

import { type Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { CellRow, NodeRow } from '../lib/types';
import Icon from './Icon';

export type ObjectPickerModalProps = {
  cells: CellRow[];
  nodes: NodeRow[];
  // Resolver-Map: cellId → "Zeilen-Label × Spalten-Label" damit Cells
  // mit lesbarem Display-String gerendert werden statt nur ihrer UUID.
  cellLabelById: Map<string, string>;
  onPick: (objectKind: 'cell' | 'node', objectId: string, label: string) => void;
  onClose: () => void;
};

type FilterTab = 'all' | 'cell' | 'node';

type PickerEntry = {
  objectKind: 'cell' | 'node';
  objectId: string;
  label: string;
  alias: string | null;
};

const ObjectPickerModal: Component<ObjectPickerModalProps> = (p) => {
  const [filter, setFilter] = createSignal('');
  const [tab, setTab] = createSignal<FilterTab>('all');
  let dialogEl: HTMLDialogElement | undefined;
  let inputEl: HTMLInputElement | undefined;

  const entries = createMemo<PickerEntry[]>(() => {
    const out: PickerEntry[] = [];
    if (tab() === 'all' || tab() === 'node') {
      for (const n of p.nodes) {
        out.push({
          objectKind: 'node',
          objectId: n.id,
          label: n.label || `(${n.type})`,
          alias: n.alias,
        });
      }
    }
    if (tab() === 'all' || tab() === 'cell') {
      for (const c of p.cells) {
        out.push({
          objectKind: 'cell',
          objectId: c.id,
          label: p.cellLabelById.get(c.id) ?? '(Zelle)',
          alias: c.alias,
        });
      }
    }
    const q = filter().toLowerCase().trim();
    if (!q) return out.slice(0, 100);
    return out
      .filter(
        (e) => e.label.toLowerCase().includes(q) || (e.alias?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 100);
  });

  onMount(() => {
    dialogEl?.showModal();
    inputEl?.focus();
  });

  onCleanup(() => {
    dialogEl?.close();
  });

  function tabLabel(t: FilterTab): string {
    if (t === 'all') return 'Alle';
    if (t === 'cell') return 'Zellen';
    return 'Bereiche';
  }

  return (
    <dialog
      ref={dialogEl}
      class="overlay-modal atom-picker-modal"
      aria-labelledby="object-picker-title"
      onCancel={(e) => {
        e.preventDefault();
        p.onClose();
      }}
    >
      <button
        type="button"
        class="overlay-modal-backdrop-closer"
        onClick={p.onClose}
        aria-label="Schliessen"
        tabIndex={-1}
      />
      <div class="overlay-card">
        <header class="overlay-head">
          <h3 id="object-picker-title">Bereich oder Zelle verlinken</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div class="atom-picker-tabs" role="tablist">
          <For each={['all', 'node', 'cell'] satisfies FilterTab[]}>
            {(t) => (
              <button
                type="button"
                role="tab"
                class="atom-picker-tab"
                classList={{ 'atom-picker-tab-active': tab() === t }}
                aria-selected={tab() === t}
                onClick={() => setTab(t)}
              >
                {tabLabel(t)}
              </button>
            )}
          </For>
        </div>

        <div class="atom-picker-search">
          <Icon name="search" size={14} />
          <input
            ref={(el) => {
              inputEl = el;
            }}
            type="text"
            class="atom-picker-input"
            placeholder="Suche nach Titel oder ^alias…"
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
          />
        </div>

        <div class="atom-picker-list">
          <Show
            when={entries().length > 0}
            fallback={
              <p class="hint atom-picker-empty">Keine passenden Bereiche/Zellen gefunden.</p>
            }
          >
            <ul>
              <For each={entries()}>
                {(e) => (
                  <li>
                    <button
                      type="button"
                      class="atom-picker-item"
                      onClick={() => p.onPick(e.objectKind, e.objectId, e.label)}
                    >
                      <span class={`atom-picker-item-kind atom-picker-kind-${e.objectKind}`}>
                        {e.objectKind}
                      </span>
                      <span class="atom-picker-item-label">{e.label}</span>
                      <Show when={e.alias}>
                        <span class="atom-picker-item-alias">^{e.alias}</span>
                      </Show>
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </Show>
        </div>
      </div>
    </dialog>
  );
};

export default ObjectPickerModal;
