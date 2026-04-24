// Modal mit Live-Vorschau fuer Paste in eine Checkliste. Wird aus dem
// ChecklistPanel getriggert, wenn ein mehrzeiliger Text in einen
// Item-Input kopiert wird. User sieht geparsten Struktur-Vorschlag
// (Items mit Einrueckungs-Level) und kann vor dem Committen den
// Text noch bearbeiten.
//
// Vorbild: `_clPasteOpen` + `_clPasteUpdatePreview` + `_clPasteCommit`
// im HTML-Client (matrix_tool_beta.html ~Z6079-6134). Bewusst minimal:
// keine Item-Rearrange-UI, kein Level-Tuning pro Item — Parser ist
// autoritativ, der User korrigiert ueber den Textarea-Text.

import { For, Show, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import { parsePastedText, type ParsedPasteItem } from '../lib/checklist-paste-parse';
import Icon from './Icon';

type Props = {
  initialText: string;
  checklistLabel?: string;
  onCommit: (items: ParsedPasteItem[]) => void;
  onClose: () => void;
};

const ChecklistPastePopup: Component<Props> = (p) => {
  const [raw, setRaw] = createSignal(p.initialText);
  const items = createMemo<ParsedPasteItem[]>(() => parsePastedText(raw()));

  let textareaRef: HTMLTextAreaElement | undefined;

  onMount(() => {
    // ESC in Capture-Phase, sonst schluckt der globale Back-Handler
    // (oder das dahinterliegende Overlay, z.B. Card-Modal).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));

    // Textarea direkt fokussieren + Cursor ans Ende. Der initiale Text
    // kommt aus dem Paste-Event; User soll sofort tippen koennen.
    requestAnimationFrame(() => {
      if (!textareaRef) return;
      textareaRef.focus();
      const len = textareaRef.value.length;
      textareaRef.setSelectionRange(len, len);
    });
  });

  function commit() {
    const list = items();
    if (list.length === 0) return;
    p.onCommit(list);
  }

  return (
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div class="overlay-card cl-paste-card" role="dialog" aria-modal="true">
        <header class="overlay-head">
          <h3>Aus Zwischenablage einfuegen</h3>
          <button
            type="button"
            class="overlay-close"
            onClick={p.onClose}
            aria-label="Schliessen"
          >
            <Icon name="x" size={18} />
          </button>
        </header>
        <Show when={p.checklistLabel}>
          <p class="cl-paste-breadcrumb">Checkliste: {p.checklistLabel}</p>
        </Show>
        <div class="cl-paste-body">
          <label class="cl-paste-label">
            Text
            <textarea
              ref={textareaRef}
              class="cl-paste-ta"
              value={raw()}
              placeholder="Eine Zeile pro Punkt. Einrueckung via 2 Spaces oder Tab."
              rows={8}
              onInput={(e) => setRaw(e.currentTarget.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                }
              }}
            />
          </label>
          <div class="cl-paste-prev-label">
            Vorschau ({items().length} {items().length === 1 ? 'Punkt' : 'Punkte'})
          </div>
          <div class="cl-paste-prev">
            <Show
              when={items().length > 0}
              fallback={<div class="cl-paste-empty">Keine Punkte erkannt.</div>}
            >
              <For each={items()}>
                {(it) => (
                  <div
                    class="cl-paste-item"
                    style={{ '--cl-level': it.level }}
                  >
                    <span class="cl-paste-bullet" aria-hidden="true">•</span>
                    <span class="cl-paste-text">{it.text}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
        <footer class="overlay-foot cl-paste-foot">
          <button type="button" class="btn-subtle" onClick={p.onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            class="btn-primary"
            onClick={commit}
            disabled={items().length === 0}
          >
            Einfuegen (Strg+Enter)
          </button>
        </footer>
      </div>
    </div>
  );
};

export default ChecklistPastePopup;
