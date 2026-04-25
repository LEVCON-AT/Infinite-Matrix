// Singleton-Dropdown fuer Alias-Autocomplete. Wird in Workspace.tsx genau
// einmal gerendert; Sichtbarkeit, Position und Content liest die Komponente
// aus `lib/use-alias-autocomplete` (globales Signal).
//
// Vorbild: das `.aa-pop`-Popup im Alt-Client (Zeile 5207-5220).

import { type Component, For, Show, createMemo } from 'solid-js';
import { aliasAutocompleteState, commitAliasAutocomplete } from '../lib/use-alias-autocomplete';

// Feste Offsets: knapp unter dem Input, minimales Leading.
const POPUP_GAP_PX = 4;
const POPUP_MAX_W = 320;

const AliasAutocomplete: Component = () => {
  const s = aliasAutocompleteState;

  // Bounding-Rect des aktuellen Anchors. Reactive ueber s() — solange das
  // Popup offen ist, liest Solid bei jedem Re-render neu. Das reicht fuer
  // unsere Zwecke (Popup schliesst bei Scroll nicht, aber neu positioniert
  // sich bei jedem keystroke via onInput → setUiState).
  const pos = createMemo(() => {
    const st = s();
    if (!st.open || !st.anchor) return null;
    const r = st.anchor.getBoundingClientRect();
    return { left: r.left, top: r.bottom + POPUP_GAP_PX };
  });

  return (
    <Show when={s().open && pos() && s().matches.length > 0}>
      <div
        class="alias-ac-popup"
        style={{
          position: 'fixed',
          left: `${pos()!.left}px`,
          top: `${pos()!.top}px`,
          'max-width': `${POPUP_MAX_W}px`,
          'z-index': '10000',
        }}
        // biome-ignore lint/a11y/useSemanticElements: bewusst <div role="listbox"> — Popup wird absolut positioniert via Portal, kein nativer <select> moeglich.
        role="listbox"
        aria-label="Alias-Vorschlaege"
        tabIndex={-1}
      >
        <For each={s().matches}>
          {(m, i) => (
            <div
              class="alias-ac-item"
              classList={{ active: s().activeIdx === i() }}
              // biome-ignore lint/a11y/useSemanticElements: <div role="option"> — <option> ist nur in <select> valide.
              role="option"
              aria-selected={s().activeIdx === i()}
              tabIndex={-1}
              onMouseDown={(e) => {
                // onMouseDown (nicht onClick) + preventDefault: der Focus
                // bleibt auf dem Input, onBlur feuert nicht, der Commit
                // hinterher setzt den Cursor korrekt.
                e.preventDefault();
                commitAliasAutocomplete(i());
              }}
            >
              <span class="alias-ac-name">^{m.alias}</span>
              <Show when={m.label}>
                <span class="alias-ac-label">{m.label}</span>
              </Show>
              <Show when={m.subLabel}>
                <span class="alias-ac-kind">{m.subLabel}</span>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
};

export default AliasAutocomplete;
