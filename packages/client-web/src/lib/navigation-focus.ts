// Geteilter Fokus-Speicher: welche Zelle hat der User zuletzt angefasst.
// Wird bei Klick (oder Overlay-Sprung) gesetzt und beim Re-Mount einer
// Matrix-View wieder auf die entsprechende .mx-cell fokussiert — damit
// der User nach ESC-zurueck sofort mit 1/2 den naechsten Sprung macht,
// ohne erst per Tab/Klick die Zelle zu treffen.

import { createSignal } from 'solid-js';

export type LastFocusCell = {
  matrixId: string;
  rowId: string;
  colId: string;
};

const [lastFocusCell, setLastFocusCell] = createSignal<LastFocusCell | null>(null);

export { lastFocusCell, setLastFocusCell };
