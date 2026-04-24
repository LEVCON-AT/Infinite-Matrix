// Globales Progress-State fuer lange laufende Operationen (Import,
// Export-inkl-Backup, potenziell Bulk-Resets).
//
// Pattern:
//   1. Caller startet: `startProgress('Import laeuft...')`
//   2. Workload ruft waehrenddessen `setProgressPhase('Zeilen einfuegen', 3, 13)`
//      bei jedem Phasen-Schritt. Modul-level-State — keine Prop-Threading.
//   3. Caller beendet: `endProgress()`.
//
// ProgressOverlay (Component) liest das Signal und blendet einen
// Scrim ueber die ganze UI + eine Karte mit Label/Phase/Progress-Bar
// ein. Solange das Overlay aktiv ist, ist die Oberflaeche nicht
// klickbar (Scrim fang Pointer-Events ab).

import { createSignal } from 'solid-js';

export type ProgressState = {
  title: string;
  phase: string;
  current: number;
  total: number;
};

const [progress, setProgress] = createSignal<ProgressState | null>(null);

export function useProgress() {
  return progress;
}

export function startProgress(title: string): void {
  setProgress({ title, phase: 'Starte…', current: 0, total: 1 });
}

// Aktualisiert Phase + Fortschritt. Wenn kein Progress aktiv ist
// (kein startProgress-Call vorangegangen), no-op — so koennen Executor-
// Funktionen diese API bedenkenlos aufrufen, auch wenn sie nicht aus
// dem Import-Flow kommen (z.B. einzelne Mutations-Calls).
export function setProgressPhase(
  phase: string,
  current: number,
  total: number,
): void {
  const cur = progress();
  if (!cur) return;
  setProgress({ title: cur.title, phase, current, total });
}

export function endProgress(): void {
  setProgress(null);
}
