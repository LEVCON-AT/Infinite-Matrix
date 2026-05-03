// MobileTreeDrawer — Backdrop + Edge-Swipe-Geste fuer den NodeTree-Drawer.
//
// Der NodeTree selbst lebt weiterhin in <aside class="ws-sidebar"> in
// Workspace.tsx (Single-Source). Auf Phone verwandelt CSS die Sidebar
// in einen fixed-position-Drawer mit translateX-Transition. Diese
// Komponente rendert nur:
//   1. Backdrop hinter dem Drawer (mit onClick = onClose)
//   2. Edge-Swipe-Detector am linken Bildschirmrand (~16px breit)
//
// Der Drawer-Open-State lebt in Workspace.tsx und setzt
// body.dataset.treeDrawer = 'open' | undefined — CSS reagiert darauf.

import { type Accessor, type Component, Show, createEffect, onCleanup } from 'solid-js';

type MobileTreeDrawerProps = {
  open: Accessor<boolean>;
  onOpen: () => void;
  onClose: () => void;
};

const MobileTreeDrawer: Component<MobileTreeDrawerProps> = (props) => {
  // Body-Klassen-Sync: open-State → body.dataset.treeDrawer.
  createEffect(() => {
    if (typeof document === 'undefined') return;
    if (props.open()) {
      document.body.dataset.treeDrawer = 'open';
    } else {
      delete document.body.dataset.treeDrawer;
    }
  });

  // Edge-Swipe-from-left-Detector. PointerDown am linken Rand (<16px),
  // PointerMove ueber 64px Distanz nach rechts → onOpen(). Nur bei
  // Touch-Pointers, sonst trifft Mouse-Click auf Buttons aus.
  let edgeStartX: number | null = null;
  let edgePointerId: number | null = null;

  const onEdgePointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    if (e.clientX > 16) return;
    if (props.open()) return;
    edgeStartX = e.clientX;
    edgePointerId = e.pointerId;
  };

  const onEdgePointerMove = (e: PointerEvent): void => {
    if (edgePointerId !== e.pointerId) return;
    if (edgeStartX === null) return;
    const dx = e.clientX - edgeStartX;
    if (dx > 64) {
      props.onOpen();
      edgeStartX = null;
      edgePointerId = null;
    }
  };

  const onEdgePointerUp = (e: PointerEvent): void => {
    if (edgePointerId !== e.pointerId) return;
    edgeStartX = null;
    edgePointerId = null;
  };

  createEffect(() => {
    if (typeof document === 'undefined') return;
    document.addEventListener('pointerdown', onEdgePointerDown, { passive: true });
    document.addEventListener('pointermove', onEdgePointerMove, { passive: true });
    document.addEventListener('pointerup', onEdgePointerUp, { passive: true });
    document.addEventListener('pointercancel', onEdgePointerUp, { passive: true });
    onCleanup(() => {
      document.removeEventListener('pointerdown', onEdgePointerDown);
      document.removeEventListener('pointermove', onEdgePointerMove);
      document.removeEventListener('pointerup', onEdgePointerUp);
      document.removeEventListener('pointercancel', onEdgePointerUp);
    });
  });

  // ESC schliesst Drawer.
  createEffect(() => {
    if (!props.open()) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  return (
    <Show when={props.open()}>
      <button
        type="button"
        class="mobile-tree-drawer-backdrop"
        data-open="true"
        onClick={props.onClose}
        aria-label="Drawer schliessen"
        tabIndex={-1}
      />
    </Show>
  );
};

export default MobileTreeDrawer;
