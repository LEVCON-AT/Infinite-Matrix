// Globaler State fuer ImportedEventDetailModal (Welle I.8).
//
// Click auf einen imported_event-Calendar-Chip oeffnet das Detail-Modal
// mit Read-only-Snapshot + Aktions-Section (Task ableiten, Manifestation
// hinzufuegen). Workspace.tsx rendert das Modal global, damit es nicht
// pro Calendar-Variante dupliziert werden muss.

import { type Accessor, createSignal } from 'solid-js';

export type ImportedEventModalSnapshot = {
  summary: string;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string; // 'YYYY-MM-DD' (= startDate wenn nicht Range)
  time: string | null; // 'HH:MM' bei timed
  isRange: boolean;
  isRecurring: boolean;
  url: string | null;
  sourceProvider: string | null;
  sourceColor: string | null;
};

export type ImportedEventModalRequest = {
  workspaceId: string;
  eventId: string;
  snapshot: ImportedEventModalSnapshot;
};

const [request, setRequest] = createSignal<ImportedEventModalRequest | null>(null);

export const importedEventModalRequest: Accessor<ImportedEventModalRequest | null> = request;

export function openImportedEventModal(req: ImportedEventModalRequest): void {
  setRequest(req);
}

export function closeImportedEventModal(): void {
  setRequest(null);
}
