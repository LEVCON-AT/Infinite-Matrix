// Globaler State fuer das Create-Manifestation-Modal (Phase 4 T.1.G.2.A
// + T.AC.D.1 atom-aware + T.AC.D.4 edit-mode).
//
// Drop-Handler in verschiedenen Komponenten (SidebarCalendarMini,
// spaeter Kanban-Spalten, Checklist-Positions) setzen den State auf
// einen Modal-Auftrag. Workspace.tsx rendert das Modal global, damit
// es nicht pro Drop-Target dupliziert werden muss.
//
// T.AC.D.1: atomType + atomLabel + atomUrl ersetzen das task-spezifische
// taskId/taskLabel-Feld. Fuer atomType='task' bleibt atomId === task.id;
// fuer 'link'/'checklist' ist atomId die Link- bzw. Checklist-ID.
//
// T.AC.D.4: mode='edit' + manifId + existingDisplayMeta. Calendar-Event
// kriegt einen ✏️-Button, der diesen Modus oeffnet. Submit ruft
// updateManifestation/updateAtomManifestation statt addManifestation.

import { type Accessor, createSignal } from 'solid-js';

export type ManifestationAtomType = 'task' | 'link' | 'checklist';
export type ManifestationModalMode = 'create' | 'edit';

export type ManifestationModalRequest = {
  workspaceId: string;
  atomType: ManifestationAtomType;
  atomId: string;
  atomLabel: string;
  // Nur fuer atomType='link': URL fuer Snapshot in display_meta.
  atomUrl?: string;
  defaultDate: string; // 'YYYY-MM-DD'
  // T.AC.D.4: edit-Mode. mode='edit' verlangt manifId + existingDisplayMeta.
  mode?: ManifestationModalMode;
  manifId?: string;
  existingDisplayMeta?: Record<string, unknown>;
};

const [request, setRequest] = createSignal<ManifestationModalRequest | null>(null);

export const manifestationModalRequest: Accessor<ManifestationModalRequest | null> = request;

export function openManifestationModal(req: ManifestationModalRequest): void {
  setRequest(req);
}

export function closeManifestationModal(): void {
  setRequest(null);
}
