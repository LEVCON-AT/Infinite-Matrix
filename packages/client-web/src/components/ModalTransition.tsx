// ModalTransition — Solid-`<Show>`-Wrapper mit Exit-Animation.
//
// Solid `<Show>` removed Children sofort beim when=false, damit gibt
// es keine Exit-Animation. Diese Komponente verzoegert das Unmount
// um die Exit-Duration: setzt zuerst data-state="leaving" auf Backdrop
// + Card (animations.css Pattern), wartet --tr-exit (160ms), dann
// removed sie das Children.
//
// Nutzung (Drop-in fuer <Show when={open()} fallback={...}>):
//
//   <ModalTransition when={open()}>
//     <div class="overlay-scrim">
//       <div class="overlay-card">...</div>
//     </div>
//   </ModalTransition>
//
// CSS (.overlay-scrim[data-state="leaving"], .overlay-card[data-state=
// "leaving"]) liefert die Exit-Animation. Ohne Match: ModalTransition
// faellt auf timeout-basiert zurueck und removed nach 200ms.

import { type JSX, Show, createEffect, createSignal, onCleanup } from 'solid-js';

const EXIT_DURATION_MS = 200; // matched --tr-exit (160ms) + Buffer

export function ModalTransition(props: { when: boolean; children: JSX.Element }) {
  const [present, setPresent] = createSignal(props.when);
  let containerRef: HTMLDivElement | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | null = null;

  createEffect(() => {
    if (props.when) {
      if (exitTimer) {
        clearTimeout(exitTimer);
        exitTimer = null;
      }
      setPresent(true);
      // Falls Backdrop/Card schon data-state="leaving" hatten (Re-Open
      // mitten in Exit-Animation), zuruecksetzen.
      if (containerRef) {
        for (const el of containerRef.querySelectorAll<HTMLElement>('[data-state="leaving"]')) {
          el.removeAttribute('data-state');
        }
      }
    } else if (present()) {
      // Exit-Animation triggern.
      if (containerRef) {
        for (const el of containerRef.querySelectorAll<HTMLElement>(
          '.overlay-scrim, .overlay-card',
        )) {
          el.dataset.state = 'leaving';
        }
      }
      exitTimer = setTimeout(() => {
        setPresent(false);
        exitTimer = null;
      }, EXIT_DURATION_MS);
    }
  });

  onCleanup(() => {
    if (exitTimer) clearTimeout(exitTimer);
  });

  return (
    <Show when={present()}>
      <div ref={containerRef} class="modal-transition-host" style={{ display: 'contents' }}>
        {props.children}
      </div>
    </Show>
  );
}
