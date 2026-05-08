// Welle WV.C — Globaler Bulk-Wizard-State.
//
// Lass die Hotkey-Handler + SlotHintToolbar das Bulk-Wizard-Modal
// global oeffnen, ohne dass die einzelnen Caller die Workspace-weiten
// Daten (templates / instances / hotkey-slots / aliases) selbst laden
// muessen. Der globale Manager (components/bulk/BulkWizardManager) liest
// das Signal + steuert das Modal.

import { createSignal } from 'solid-js';

export type BulkWizardOpenRequest = {
  // Wenn gesetzt: Slot N — Wizard skippt Step 1 (Vorlage-Wahl).
  preselectedTemplateId?: string | null;
  // Optional: ein freundlicher Toast-Text wenn nichts geoeffnet wird
  // (z.B. „Slot 6 ist frei").
  hintIfNoTemplate?: string;
};

const [openRequest, setOpenRequest] = createSignal<BulkWizardOpenRequest | null>(null);

export { openRequest };

export function openBulkWizard(request: BulkWizardOpenRequest = {}): void {
  setOpenRequest(request);
}

export function closeBulkWizard(): void {
  setOpenRequest(null);
}

// Signal fuer DangerousDeleteModal-Triggers (Alt+1-9 / Alt+Entf).
// Manager rendert das Modal mit den Cells aus der aktuellen Selektion.
export type DangerousDeleteRequest =
  | { kind: 'remove-template'; slot: number }
  | { kind: 'clear-cells' };

const [deleteRequest, setDeleteRequest] = createSignal<DangerousDeleteRequest | null>(null);

export { deleteRequest };

export function openDangerousDelete(req: DangerousDeleteRequest): void {
  setDeleteRequest(req);
}

export function closeDangerousDelete(): void {
  setDeleteRequest(null);
}
