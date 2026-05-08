// WV.WV.5 — WidgetPicker-Modal.
//
// Generischer Picker fuer kompatible Widget-Slots in einer Cell mit
// einer oder mehreren Vorlagen-Instanzen. Caller fuehrt die Routing-
// Entscheidung via `chooseWidgetSlot()` aus `lib/widget-picker.ts` —
// dieser Modal rendert nur, wenn `action === 'picker'`.
//
// Konzept-Verankerung:
//   - §9.10b: WidgetPicker als Generalisierung des KanbanColPicker.
//   - §9.A.6: Multi-Root-Widget-Disambiguierung — Root-Widgets
//     prominent (oben), non-Root als Fallback-Option.
//
// Patterns wiederverwendet (`code-quality.md` §6.5):
//   - `<dialog class="overlay-modal">` + ESC + Backdrop-Closer
//     (analog AtomPickerModal).
//   - `.atom-picker-list` / `.atom-picker-item` CSS-Klassen
//     (Picker-CSS-Foundation aus Welle D.7b — globaler Reuse).
//   - Section-Header `.widget-picker-section` ist neu (1 zusaetzliche
//     CSS-Klasse) — Root-vs-Non-Root-Trenner.
//
// Animation: native `<dialog>` + `--ease-out-expo` aus styles.css
// `dialog.overlay-modal` Block (Foundation aus Welle U).

import { type Component, For, Show, createMemo, onCleanup, onMount } from 'solid-js';
import type { WidgetSlotOption } from '../lib/widget-picker';
import Icon from './Icon';

export type WidgetPickerProps = {
  // Liste kompatibler Slots, Root-First-sortiert. Caller liefert
  // bereits via chooseWidgetSlot()-Ergebnis. Picker rendert ohne
  // weitere Sortierung — wir gruppieren nur.
  slots: WidgetSlotOption[];
  // Optional: Atom-Label fuer Modal-Title („Wo soll '{label}' hin?").
  atomLabel?: string;
  onPick: (slot: WidgetSlotOption) => void;
  onClose: () => void;
};

const WidgetPicker: Component<WidgetPickerProps> = (p) => {
  let dialogEl: HTMLDialogElement | undefined;

  const groups = createMemo(() => {
    const roots = p.slots.filter((s) => s.isRoot);
    const others = p.slots.filter((s) => !s.isRoot);
    return { roots, others };
  });

  onMount(() => {
    // Native showModal() liefert Backdrop, Focus-Trap und Focus-
    // Restore. Erster Listenpunkt kriegt initialFocus.
    dialogEl?.showModal();
    const firstBtn = dialogEl?.querySelector<HTMLButtonElement>('.atom-picker-item');
    firstBtn?.focus();
  });

  onCleanup(() => {
    dialogEl?.close();
  });

  return (
    <dialog
      ref={dialogEl}
      class="overlay-modal widget-picker-modal"
      aria-labelledby="widget-picker-title"
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
          <h3 id="widget-picker-title">
            <Show when={p.atomLabel} fallback="Widget waehlen">
              Wo soll „{p.atomLabel}" hin?
            </Show>
          </h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div class="atom-picker-list">
          <Show
            when={p.slots.length > 0}
            fallback={<p class="hint atom-picker-empty">Keine kompatiblen Widgets.</p>}
          >
            <Show when={groups().roots.length > 0}>
              <div class="widget-picker-section">
                <span class="widget-picker-section-label">Haupt-Widgets</span>
              </div>
              <ul>
                <For each={groups().roots}>{(s) => <SlotItem slot={s} onPick={p.onPick} />}</For>
              </ul>
            </Show>
            <Show when={groups().others.length > 0}>
              <div class="widget-picker-section">
                <span class="widget-picker-section-label">Weitere Widgets</span>
              </div>
              <ul>
                <For each={groups().others}>{(s) => <SlotItem slot={s} onPick={p.onPick} />}</For>
              </ul>
            </Show>
          </Show>
        </div>
      </div>
    </dialog>
  );
};

const SlotItem: Component<{
  slot: WidgetSlotOption;
  onPick: (s: WidgetSlotOption) => void;
}> = (p) => {
  const subtitle = () => {
    const parts: string[] = [];
    if (p.slot.sectionLabel) parts.push(p.slot.sectionLabel);
    if (p.slot.slotLabel) parts.push(p.slot.slotLabel);
    return parts.join(' · ');
  };

  return (
    <li>
      <button
        type="button"
        class="atom-picker-item"
        classList={{ 'widget-picker-item-root': p.slot.isRoot }}
        onClick={() => p.onPick(p.slot)}
      >
        <span
          class={`atom-picker-item-kind atom-picker-kind-${widgetKindClass(p.slot.widgetType)}`}
        >
          {widgetTypeLabel(p.slot.widgetType)}
        </span>
        <span class="atom-picker-item-label">
          {p.slot.templateName}
          <Show when={subtitle()}>
            <span class="widget-picker-item-sub"> — {subtitle()}</span>
          </Show>
        </span>
        <Show when={p.slot.isRoot}>
          <span class="widget-picker-item-rootbadge" aria-label="Haupt-Widget">
            Haupt
          </span>
        </Show>
      </button>
    </li>
  );
};

function widgetTypeLabel(t: WidgetSlotOption['widgetType']): string {
  if (t === 'kanban') return 'Kanban';
  if (t === 'checklist') return 'Liste';
  if (t === 'info') return 'Info';
  if (t === 'doc') return 'Doku';
  if (t === 'link') return 'Link';
  if (t === 'calendar') return 'Kalender';
  return 'Summary';
}

// Mappt WidgetType auf existing atom-picker-kind-Klasse fuer Farbe.
// Wiederverwendung der Welle-D-Picker-Foundation.
function widgetKindClass(t: WidgetSlotOption['widgetType']): string {
  if (t === 'kanban') return 'task';
  if (t === 'checklist') return 'checklist';
  if (t === 'doc') return 'doc';
  if (t === 'link') return 'link';
  return 'cell';
}

export default WidgetPicker;
