// Globaler State fuer das Create-Manifestation-Modal (Phase 4 T.1.G.2.A).
//
// Drop-Handler in verschiedenen Komponenten (SidebarCalendarMini,
// spaeter Kanban-Spalten, Checklist-Positions) setzen den State auf
// einen Modal-Auftrag. Workspace.tsx rendert das Modal global, damit
// es nicht pro Drop-Target dupliziert werden muss.

import { type Accessor, createSignal } from 'solid-js';

export type ManifestationModalRequest = {
  workspaceId: string;
  taskId: string;
  taskLabel: string;
  defaultDate: string; // 'YYYY-MM-DD'
  // Spaeter erweiterbar: kind: 'kanban' | 'checklist' mit container_id +
  // position. Heute nur 'calendar' (Default).
};

const [request, setRequest] = createSignal<ManifestationModalRequest | null>(null);

export const manifestationModalRequest: Accessor<ManifestationModalRequest | null> = request;

export function openManifestationModal(req: ManifestationModalRequest): void {
  setRequest(req);
}

export function closeManifestationModal(): void {
  setRequest(null);
}
