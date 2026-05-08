// Welle WV.C.4 — Bulk-Hotkey-Installer (Konzept §8.2.1).
//
// Globaler Keydown-Listener, der im Edit-Mode die Bulk-Hotkeys nach
// Konzept routet:
//   ESC          → clearSelection
//   Strg+A       → selectAllInMatrix(activeMatrixId)
//   Enter        → onEnter (Bulk-Wizard oeffnen mit Vorlage-Wahl)
//   1-9          → onPickSlot(N) — Direkt-Wizard mit Slot N vorausgewaehlt
//   Alt+1-9      → onAltSlot(N) — Vorlage destruktiv entfernen
//   Alt+Entf     → onAltDelete — Cells komplett leeren
//
// Strg+Click + Shift+Click sind nicht global — werden im Cell-Click-
// Handler installiert (cell-selection-hotkeys, MatrixView-Integration
// folgt in C.4-Wiring).
//
// Caller (Workspace.tsx) installiert via installBulkHotkeys() einmal
// im Mount.

import { onCleanup, onMount } from 'solid-js';
import {
  activeMatrixId,
  clearSelection,
  selectAllInMatrix,
  selectionCount,
} from './cell-selection';
import { useEditMode } from './edit-mode';
import { showToast } from './toasts';

export type BulkHotkeyHandlers = {
  // Slot N gedrueckt mit aktiver Selektion (1-9). Caller oeffnet
  // BulkWizardModal mit preselectedTemplateId via Slot-Resolver.
  onPickSlot: (slot: number) => void;
  // Enter mit aktiver Selektion. Wizard oeffnet mit Step 1 (Vorlage-Wahl).
  onEnter: () => void;
  // Alt+1-9 — destruktiv: Vorlage von Cells entfernen. Caller oeffnet
  // DangerousDeleteModal('remove-template').
  onAltSlot: (slot: number) => void;
  // Alt+Entf — destruktiv: Cells komplett leeren. Caller oeffnet
  // DangerousDeleteModal('clear-cells').
  onAltDelete: () => void;
};

export function installBulkHotkeys(handlers: BulkHotkeyHandlers): void {
  onMount(() => {
    const editMode = useEditMode();

    const isTextInput = (t: EventTarget | null): boolean => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true;
      if (el.isContentEditable) return true;
      return false;
    };

    const onKey = (e: KeyboardEvent) => {
      if (!editMode()) return;
      if (isTextInput(e.target)) return;

      // ESC: Selektion clear (nur wenn welche da).
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && selectionCount() > 0) {
        e.preventDefault();
        clearSelection();
        return;
      }

      // Strg+A: alle Cells der aktuellen Matrix.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'a' || e.key === 'A')) {
        const mid = activeMatrixId();
        if (!mid) return;
        e.preventDefault();
        selectAllInMatrix(mid);
        return;
      }

      // 1-9 / Alt+1-9 — nur mit aktiver Selektion.
      if (!e.ctrlKey && !e.metaKey && /^[1-9]$/.test(e.key)) {
        if (selectionCount() === 0) return;
        const slot = Number(e.key);
        if (e.altKey) {
          e.preventDefault();
          handlers.onAltSlot(slot);
          return;
        }
        e.preventDefault();
        handlers.onPickSlot(slot);
        return;
      }

      // Alt+Entf / Alt+Backspace.
      if (e.altKey && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (selectionCount() === 0) return;
        e.preventDefault();
        handlers.onAltDelete();
        return;
      }

      // Enter mit Selektion.
      if (e.key === 'Enter' && !e.altKey && !e.ctrlKey && !e.metaKey && selectionCount() > 0) {
        e.preventDefault();
        handlers.onEnter();
        return;
      }
    };

    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });
}

// Click-Handler-Helper fuer Strg+Click + Shift+Click. Caller (MatrixView)
// uebergibt das aktuelle Cell-Click-Event und nutzt die Resolver-Lib.
//
// Returnwert: true wenn der Klick als Selektions-Action behandelt wurde
// und der Caller den Default-Klick (Cell-Edit etc.) NICHT ausloesen
// soll. false = Default weiterlaufen lassen.
export function handleCellSelectionClick(
  e: MouseEvent,
  cellId: string,
  matrixId: string,
  isEditMode: boolean,
): boolean {
  if (!isEditMode) return false;
  // V1: nur Strg/Cmd + Click → toggle. Shift+Click → range — beides
  // ist in cell-selection.ts abgebildet, aber Range braucht Anker.
  if (e.shiftKey && !e.altKey) {
    // Caller importiert lib/cell-selection.ts und ruft selectRange(
    //   lastAnchorId(), cellId, matrixId) — wir machen das hier:
    void import('./cell-selection').then((mod) => {
      const anchor = mod.lastAnchorId() ?? cellId;
      mod.selectRange(anchor, cellId, matrixId);
    });
    return true;
  }
  if (e.ctrlKey || e.metaKey) {
    void import('./cell-selection').then((mod) => mod.toggleCell(cellId));
    return true;
  }
  return false;
}

// Toast-Helper falls 1-9 ohne aktive Selektion (Slot leer-Pfad triggert
// Templates-Picker, non-Edit triggert nichts).
export function showSlotNoSelectionHint(): void {
  showToast('Selektiere zuerst Cells, dann waehle einen Slot.', 'info');
}
