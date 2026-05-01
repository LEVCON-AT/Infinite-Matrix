// Globaler State fuer das Create-Manifestation-Modal (Phase 4 T.1.G.2.A
// + T.AC.D.1 atom-aware).
//
// Drop-Handler in verschiedenen Komponenten (SidebarCalendarMini,
// spaeter Kanban-Spalten, Checklist-Positions) setzen den State auf
// einen Modal-Auftrag. Workspace.tsx rendert das Modal global, damit
// es nicht pro Drop-Target dupliziert werden muss.
//
// T.AC.D.1: atomType + atomLabel + atomUrl ersetzen das task-spezifische
// taskId/taskLabel-Feld. Fuer atomType='task' bleibt atomId === task.id;
// fuer 'link'/'checklist' ist atomId die Link- bzw. Checklist-ID.

import { type Accessor, createSignal } from 'solid-js';

export type ManifestationAtomType = 'task' | 'link' | 'checklist';

export type ManifestationModalRequest = {
  workspaceId: string;
  atomType: ManifestationAtomType;
  atomId: string;
  atomLabel: string;
  // Nur fuer atomType='link': URL fuer Snapshot in display_meta.
  atomUrl?: string;
  defaultDate: string; // 'YYYY-MM-DD'
};

const [request, setRequest] = createSignal<ManifestationModalRequest | null>(null);

export const manifestationModalRequest: Accessor<ManifestationModalRequest | null> = request;

export function openManifestationModal(req: ManifestationModalRequest): void {
  setRequest(req);
}

export function closeManifestationModal(): void {
  setRequest(null);
}
