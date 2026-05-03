// BottomSheet — Mobile-Modal-Pattern.
//
// Wrappt Children in einem Sheet, der von unten einschwebt. Backdrop
// dimmt + bloomt. Drag-Handle oben (4px Pille) signalisiert
// Swipe-Down-Dismiss. Snap-Points (50vh / 90vh) via bottomSheetSnap-
// Helper aus animations.ts.
//
// V1: Snap-Switch via Tap-Handle. Swipe-Drag-to-Dismiss kommt in S9
// (braucht globalPointerController-Hook fuer Sheet-Drag).
//
// Pflicht-CSS in styles.css:
//   .bottom-sheet { position: fixed; bottom: 0; left: 0; right: 0;
//                   transform: translateY(100%);
//                   transition: transform var(--tr-base) var(--ease-out); }
//   .bottom-sheet[data-open="true"] { transform: translateY(0); }

import {
  type Accessor,
  type Component,
  type JSX,
  Show,
  createEffect,
  createSignal,
  onCleanup,
} from 'solid-js';
import { bottomSheetClose, bottomSheetOpen, bottomSheetSnap } from '../../lib/animations';

type BottomSheetProps = {
  open: Accessor<boolean>;
  onClose: () => void;
  /**
   * Snap-Points. 'default' = 50vh, 'expanded' = 90vh. V1: nur 'default'
   * bei Open. User kann durch Tap auf Handle expandieren.
   */
  initialSnap?: 'default' | 'expanded';
  /** Aria-Title fuer Screen-Reader. */
  title?: string;
  children: JSX.Element;
};

const BottomSheet: Component<BottomSheetProps> = (props) => {
  let sheetEl: HTMLElement | undefined;
  let backdropEl: HTMLButtonElement | undefined;
  const [snap, setSnap] = createSignal<'default' | 'expanded'>(props.initialSnap ?? 'default');

  // Open/Close-Trigger.
  createEffect(() => {
    if (props.open()) {
      setSnap(props.initialSnap ?? 'default');
      void bottomSheetOpen(sheetEl ?? null, backdropEl ?? null, snap());
    } else if (sheetEl) {
      void bottomSheetClose(sheetEl, backdropEl ?? null);
    }
  });

  // ESC-Key zum Schliessen (Web-Konvention).
  createEffect(() => {
    if (!props.open()) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  const toggleSnap = (): void => {
    const next: 'default' | 'expanded' = snap() === 'default' ? 'expanded' : 'default';
    setSnap(next);
    bottomSheetSnap(sheetEl ?? null, next);
  };

  return (
    <Show when={props.open()}>
      <button
        type="button"
        ref={backdropEl}
        class="bottom-sheet-backdrop"
        onClick={props.onClose}
        aria-label="Sheet schliessen"
        tabIndex={-1}
      />
      <aside ref={sheetEl} class="bottom-sheet" aria-modal="true" aria-label={props.title}>
        <button
          type="button"
          class="bottom-sheet-handle"
          onClick={toggleSnap}
          aria-label={snap() === 'expanded' ? 'Sheet verkleinern' : 'Sheet vergroessern'}
        />
        <div class="bottom-sheet-content">{props.children}</div>
      </aside>
    </Show>
  );
};

export default BottomSheet;
