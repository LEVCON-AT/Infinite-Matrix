// WV.WV.4 — Drag-Hover-Navigation Helper-Library
//
// Pattern: User drag-t Atom + Canvas wird gedimmt + gaussian-blurred,
// User navigiert per Hover ueber den NavTree zum Ziel-Widget, dropt dort
// ohne Drag-Cancel.
//
// Verbindlich verankert in `style.md` §6.5 + Memory
// `feedback_drag_hover_navigation.md`. Komponenten-Anlage gemaess
// `code-quality.md` §6.5 (Audit existing → Globalitaet → Token →
// Animation → Memory-Verweis).
//
// Foundation, die wir wiederverwenden:
//   - `lib/drag-context.ts` setzt `document.body.dataset.dragging = atomType`
//     waehrend activeDrag() aktiv ist. Das CSS-Pattern in styles.css
//     (`body[data-dragging] .ws-main { opacity / filter }`) kuemmert sich
//     um Canvas-Dim + Backdrop-Blur.
//   - `bindSectionDragExpand` (lib/sidebar-section-controls.ts) wird in
//     Workspace.tsx einzeln auf NavTree-Sidebar-Sections angewendet —
//     das ist der NavTree-Auto-Expand-on-Drag-Hover-Mechanismus.
//   - `bindDropTarget` (drag-context.ts) liefert die Hover/Drop-Logik
//     pro Drop-Target.
//
// Diese Library exposiert kleine API-Anchor fuer kuenftige Erweiterungen
// (Pulse-Animation auf NavTree-Header, Modal-Variante des Patterns
// fuer §9.B.3 Doc-Editor → NavTree-Suche). V1 ist die CSS-Foundation
// allein ausreichend — Komponente `<DragHoverNavigator />` (siehe
// components/DragHoverNavigator.tsx) mountet einen unsichtbaren Layer-
// Anchor in der Workspace-Shell + bindet `activeDrag()`-Tracking.

import { activeDrag } from './drag-context';

// Tracker-Hook fuer kuenftige Erweiterungen — heute nur Re-Export der
// existing activeDrag()-Lesefunktion, damit Komponenten via
// `useDragHoverState()` einen einheitlichen Konsum-Pfad haben (statt
// jede Komponente direkt aus drag-context.ts zu lesen).
//
// Konsumenten:
//   - components/DragHoverNavigator.tsx (Workspace-Shell)
//   - components/NodeTree.tsx (Pulse-Animation, post-WV.WV.6)
//   - components/CanvasDimScrim.tsx (V2 — falls Filter-Per-Cell-Override
//     nötig wird)
export function useDragHoverState() {
  return {
    activeAtom: () => activeDrag(),
    isDragActive: () => activeDrag() !== null,
  };
}
