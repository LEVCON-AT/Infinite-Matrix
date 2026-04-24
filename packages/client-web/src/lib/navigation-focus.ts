// Pro Matrix die letzte fokussierte Zelle merken.
//
// Wird bei jedem Cell-Focus (Maus/Tab/Arrows/Hotkeys) aktualisiert.
// Beim Re-Mount einer Matrix-View wird auf genau diese Zelle fokussiert,
// damit der User nach Sidebar-Nav oder ESC-Back sofort weiter mit
// Pfeiltasten/1-2 navigieren kann.
//
// Map statt Single-Signal: So ueberlebt die Position pro Matrix den
// Wechsel zwischen Matrizen (User in A, nach B, zurueck in A → gleiche
// Zelle).

import { createSignal } from 'solid-js';

export type FocusCoord = {
  rowId: string;
  colId: string;
};

const [focusMap, setFocusMap] = createSignal<Map<string, FocusCoord>>(new Map());

export function rememberFocus(
  matrixId: string,
  rowId: string,
  colId: string,
): void {
  setFocusMap((prev) => {
    const next = new Map(prev);
    next.set(matrixId, { rowId, colId });
    return next;
  });
}

export function getLastFocus(matrixId: string): FocusCoord | undefined {
  return focusMap().get(matrixId);
}

// Getter, der reaktiv die Focus-Coord einer Matrix liefert.
// Muss im createEffect-Kontext gerufen werden, damit der Effect neu
// laeuft, wenn sich die Coord fuer die aktuelle Matrix aendert.
export function useLastFocus(matrixId: string): FocusCoord | undefined {
  return focusMap().get(matrixId);
}
