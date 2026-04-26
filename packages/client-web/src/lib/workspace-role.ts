// Phase 1 (P1.B.3) — Pure-Helpers + globales Viewer-Signal fuer
// Rollen-basiertes UI-Gating.
//
// Workspaces + Rollen werden in mehreren Stellen separat geladen
// (Workspace.tsx hat ein lokales fetchMyWorkspaces-Resource, Settings.tsx
// auch). Statt eines zusaetzlichen zentralen Caches reichen wir die
// Rolle als Prop weiter (NodeTree, MatrixView, CellInfoPage) UND
// pflegen ein globales `viewerActive`-Signal fuer Komponenten, die zu
// tief im Baum stecken (CellOverlay -> Toggle, CardOverlay -> Notes,
// NodeTree-Drag-Drop) — Prop-Drilling waere dort invasiv und das
// Verhalten ist reine Boolean-Frage.
//
// RLS auf der DB-Seite (Migration 002:326-357 + 009 FORCE) ist die
// authoritative Sperre. Diese Helpers sind reine UX-Schicht.

import { type Accessor, createSignal } from 'solid-js';
import type { WorkspaceRole } from './types';

// Read-write-Berechtigung. owner|admin|editor duerfen schreiben — viewer
// nicht. Spiegelt die DB-Funktion can_write_workspace (Migration 002).
export function canWrite(role: WorkspaceRole | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor';
}

export function isViewer(role: WorkspaceRole | undefined): boolean {
  return role === 'viewer';
}

// Globaler Read-only-State. Workspace.tsx ruft setViewerActive() im
// createEffect, sobald myRole() bekannt ist. Tiefe Komponenten lesen
// es via useViewerActive() ohne Prop-Drilling.
const [viewerActive, setViewerActive] = createSignal<boolean>(false);

export function useViewerActive(): Accessor<boolean> {
  return viewerActive;
}

export function setViewerActiveValue(v: boolean): void {
  setViewerActive(v);
}
