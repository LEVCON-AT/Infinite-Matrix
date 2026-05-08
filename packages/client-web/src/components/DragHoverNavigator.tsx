// WV.WV.4 — DragHoverNavigator (Querschnitt-Komponente §9.B).
//
// Verbindlich verankert in `style.md` §6.5 + Memory
// `feedback_drag_hover_navigation.md`. Komponenten-Anlage gemaess
// `code-quality.md` §6.5.
//
// Pattern: User drag-t Atom (task / link / doc / checklist /
// imported_event) → Canvas wird gedimmt + gaussian-blurred, User
// navigiert per Hover ueber den NavTree zum Ziel-Widget und dropt
// dort ohne Drag-Cancel.
//
// V1-Implementierung (WV.WV.4):
//   - Komponente wird **einmal** in der Workspace-Shell gemountet.
//   - CSS-Foundation: `body[data-dragging] .ws-main { opacity / filter }`
//     (siehe styles.css Drag-Hover-Navigation-Block). Wird automatisch
//     aktiv waehrend `activeDrag()` aktiv ist (drag-context.ts setzt
//     `document.body.dataset.dragging`).
//   - NavTree-Auto-Expand: `bindSectionDragExpand` bereits live in
//     Workspace.tsx auf den Sidebar-Sections. Kein neuer Code hier.
//   - Drop-Target-Detection: `bindDropTarget` pro Drop-Target — bereits
//     live in BoardView/ChecklistPanel/SidebarCalendarMini etc.
//
// Reuse-Faelle (Konzept §9.B.2):
//   - 9.6c link/mail × calendar (Hauptkalender-Drop)
//   - 9.9 doc × kanban (Spaltenwahl-Modal)
//   - 9.10 doc × checklist (Root-Widget-Logik)
//   - 9.13 info_field × kanban (Adapter-Dialog)
//
// V2-Erweiterungen (post-WV.WV):
//   - Pulse-Animation auf NavTree-Section-Header beim Drag-Hover
//     (Konzept §9.B.4 — `tabHoverPulse`-Adapter aus lib/animations.ts).
//   - Modal-Variante des Patterns (§9.B.3 Doc-Editor → NavTree-Suche
//     ohne aktiven Drag) als separate Komponente DragHoverPickerModal.
//   - Per-Cell-Override des Canvas-Dim-Filters wenn der User direkt
//     ueber dem Drop-Target hovert (Filter abdrehen damit Drop-Visual
//     nicht durch den Blur verdeckt wird).
//
// Heute reicht die CSS-Foundation. Die Komponente bleibt als
// Reuse-Anchor + dokumentierter Mount-Punkt — sie rendert nichts
// Sichtbares.

import { type Component, createEffect, onCleanup } from 'solid-js';
import { useDragHoverState } from '../lib/drag-hover-nav';

const DragHoverNavigator: Component = () => {
  const { isDragActive } = useDragHoverState();

  // Effect-Anchor fuer kuenftige Erweiterungen (Pulse-Animation,
  // Modal-Trigger). Heute nur ein No-Op-Reader auf das Signal —
  // garantiert dass die Komponente reaktiv im Workspace-Lifecycle
  // haengt (sonst koennte ein Tree-Shaker sie wegoptimieren).
  createEffect(() => {
    void isDragActive();
  });

  onCleanup(() => {
    // Defensive-Reset: falls die Komponente unmounted wird, waehrend
    // ein Drag noch aktiv ist (z.B. Workspace-Wechsel mit
    // Tasten-Shortcut), raeumen wir das body-Attribut auf. drag-
    // context.endDrag() macht das normalerweise — der Reset hier
    // schliesst nur den Edge-Case.
    if (typeof document !== 'undefined' && document.body.dataset.dragging) {
      delete document.body.dataset.dragging;
    }
  });

  // Keine sichtbaren Children — der visuelle Effekt lebt in
  // styles.css (.ws-main-Selektor + body[data-dragging]).
  return null;
};

export default DragHoverNavigator;
