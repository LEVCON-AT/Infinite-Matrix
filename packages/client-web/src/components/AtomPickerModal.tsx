// Welle D.7b — AtomPickerModal.
//
// Modal-Picker fuer atom_ref-Tags. Listet alle Atome im Workspace
// (Tasks/Links/Docs/Checklists) mit Filter + atomType-Tabs. Click auf
// Eintrag → onPick(atomType, atomId, label) -> addAtomTagAtomRef.
//
// Daten kommen vom Caller (workspace-resources via Props). Pattern
// analog ImportedEventDetailModal — overlay-scrim + focus-trap + ESC.

import { type Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { installFocusRestore, installFocusTrap } from '../lib/dialog';
import type { AtomKind } from '../lib/atom-manifestations';
import Icon from './Icon';

export type AtomPickerEntry = {
  atomType: AtomKind;
  atomId: string;
  label: string;
  alias: string | null;
};

export type AtomPickerModalProps = {
  // Flache Entry-Liste vom Caller. Caller bereitet Tasks/Links/Docs/
  // Checklists/Imported-Events in das einheitliche Format auf — der
  // Modal bleibt source-agnostisch.
  entries: AtomPickerEntry[];
  onPick: (atomType: AtomKind, atomId: string, label: string) => void;
  onClose: () => void;
};

type FilterTab = 'all' | 'task' | 'link' | 'doc' | 'checklist' | 'imported_event';

const AtomPickerModal: Component<AtomPickerModalProps> = (p) => {
  const [filter, setFilter] = createSignal('');
  const [tab, setTab] = createSignal<FilterTab>('all');
  let containerEl: HTMLDivElement | undefined;
  let inputEl: HTMLInputElement | undefined;

  const filtered = createMemo<AtomPickerEntry[]>(() => {
    const tabSel = tab();
    const out = tabSel === 'all' ? p.entries : p.entries.filter((e) => e.atomType === tabSel);
    const q = filter().toLowerCase().trim();
    if (!q) return out.slice(0, 100);
    return out
      .filter(
        (e) => e.label.toLowerCase().includes(q) || (e.alias?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 100);
  });

  onMount(() => {
    const restoreFocus = installFocusRestore();
    onCleanup(restoreFocus);
    if (containerEl) {
      const release = installFocusTrap(containerEl);
      onCleanup(release);
    }
    inputEl?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        p.onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  function tabLabel(t: FilterTab): string {
    if (t === 'all') return 'Alle';
    if (t === 'task') return 'Tasks';
    if (t === 'link') return 'Links';
    if (t === 'doc') return 'Dokus';
    if (t === 'checklist') return 'Checklisten';
    return 'Termine';
  }

  return (
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        ref={(el) => {
          containerEl = el;
        }}
        class="overlay-card atom-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="atom-picker-title"
      >
        <header class="overlay-head">
          <h3 id="atom-picker-title">Atom verlinken</h3>
          <button
            type="button"
            class="overlay-close"
            onClick={p.onClose}
            aria-label="Schliessen"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <div class="atom-picker-tabs" role="tablist">
          <For each={['all', 'task', 'link', 'doc', 'checklist'] as FilterTab[]}>
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
            when={filtered().length > 0}
            fallback={<p class="hint atom-picker-empty">Keine passenden Atome gefunden.</p>}
          >
            <ul>
              <For each={filtered()}>
                {(e) => (
                  <li>
                    <button
                      type="button"
                      class="atom-picker-item"
                      onClick={() => p.onPick(e.atomType, e.atomId, e.label)}
                    >
                      <span class={`atom-picker-item-kind atom-picker-kind-${e.atomType}`}>
                        {e.atomType}
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
    </div>
  );
};

export default AtomPickerModal;
