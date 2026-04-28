// Singleton-Dropdown fuer Object-Autocomplete (Phase 3 Welle O.2b).
//
// Pattern aus AliasAutocomplete uebernommen — einmal in App.tsx
// gerendert, liest objectSuggestState-Signal, positioniert sich per
// fixed unter dem aktuellen anchor.
//
// User-Pfade:
//   - Tippen in einer Row/Col/KbCol-Header-Input → Suggestions
//   - Pfeil-Up/Down → highlight
//   - Enter (mit highlight) → Pick (Cross-Cut auf existing Object)
//   - Click auf Item → Pick
//   - Escape / Blur → close
//
// Cross-Cut entsteht NUR bei explicit Pick — Auto-Object-Anlage bei
// Plain-Rename (kein Pick) bleibt wie in O.2a (ensureObjectFor*).

import { type Component, For, Show, createMemo } from 'solid-js';
import { objectSuggestState, pickObjectSuggest } from '../lib/use-object-suggest';

const POPUP_GAP_PX = 4;
const POPUP_MAX_W = 360;

const ObjectSuggestion: Component = () => {
  const s = objectSuggestState;

  const pos = createMemo(() => {
    const st = s();
    if (!st.open || !st.anchor) return null;
    const r = st.anchor.getBoundingClientRect();
    // Width der Anchor uebernehmen, damit das Dropdown buendig steht.
    return { left: r.left, top: r.bottom + POPUP_GAP_PX, minWidth: r.width };
  });

  return (
    <Show when={s().open && s().hits.length > 0 && pos()}>
      {(anchorPos) => (
        <div
          class="object-suggest-popup"
          style={{
            position: 'fixed',
            left: `${anchorPos().left}px`,
            top: `${anchorPos().top}px`,
            'min-width': `${anchorPos().minWidth}px`,
            'max-width': `${POPUP_MAX_W}px`,
            'z-index': '10000',
          }}
          // biome-ignore lint/a11y/useSemanticElements: bewusst <div role="listbox"> — fixed-Popup, kein nativer <select> moeglich.
          role="listbox"
          aria-label="Object-Vorschlaege"
          tabIndex={-1}
        >
          <div class="object-suggest-head">
            <span>Bestehende Objekte</span>
            <span class="object-suggest-hint">Enter = uebernehmen, Esc = neu anlegen</span>
          </div>
          <For each={s().hits}>
            {(hit, i) => (
              <div
                class="object-suggest-item"
                classList={{ 'object-suggest-active': s().activeIdx === i() }}
                // biome-ignore lint/a11y/useSemanticElements: <div role="option"> bewusst.
                role="option"
                aria-selected={s().activeIdx === i()}
                tabIndex={-1}
                onMouseDown={(e) => {
                  // onMouseDown statt onClick + preventDefault: Focus
                  // bleibt auf Input, Blur feuert nicht zwischen Klick
                  // und Pick.
                  e.preventDefault();
                  pickObjectSuggest(i());
                }}
              >
                <span class="object-suggest-label">{hit.label}</span>
                <Show when={hit.type_label}>
                  {(type) => <span class="object-suggest-type">{type()}</span>}
                </Show>
                <Show when={hit.alias}>
                  {(alias) => <span class="object-suggest-alias">^o.{alias()}</span>}
                </Show>
              </div>
            )}
          </For>
        </div>
      )}
    </Show>
  );
};

export default ObjectSuggestion;
