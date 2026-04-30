// Sidebar-Sektion-Controls (Phase 4 T.1.G.2.D).
//
// Zwei Helfer:
//
//   1. bindSectionDragExpand(el, onExpand): Drag-Hover-Hold auf einem
//      Sektion-Header. Wenn der User einen aktiven Drag (lib/drag-context)
//      ueber den Header haelt, wird nach SECTION_HOLD_MS die Sektion
//      expandiert. Damit kann der User eine Karte ueber „KALENDER"
//      ziehen und Calendar klappt sich auf, sodass er weiter in die
//      jetzt sichtbaren Tag-Zellen droppen kann.
//
//   2. installGlobalSectionShortcuts({onCalendar, onTree}): globale
//      Tastatur-Toggle fuer K (Calendar) und N (NodeTree). Skip wenn
//      Fokus in input/textarea/contenteditable oder Modal-offen.
//
// Beide Helper geben Cleanup-Funktionen zurueck (fuer onCleanup im
// Aufrufer). Animations-Timing folgt CLAUDE.md (220 ms cubic-bezier).

import { activeDrag } from './drag-context';

const SECTION_HOLD_MS = 350;

export function bindSectionDragExpand(
  el: HTMLElement | null | undefined,
  onExpand: () => void,
): () => void {
  if (!el) return () => {};
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  function clear() {
    if (holdTimer != null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }
  function onDragEnter(e: DragEvent) {
    if (!activeDrag()) return;
    e.preventDefault();
    el?.setAttribute('data-drag-hover', '1');
    if (holdTimer != null) return;
    holdTimer = setTimeout(() => {
      holdTimer = null;
      onExpand();
    }, SECTION_HOLD_MS);
  }
  function onDragOver(e: DragEvent) {
    if (!activeDrag()) return;
    // preventDefault ist Pflicht damit drop ueberhaupt erwogen wird —
    // aber wir DROPPEN nicht auf dem Header, wir expandieren nur. Daher
    // explizit dropEffect='none' damit der Cursor nicht „drop" zeigt.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  }
  function onDragLeave(e: DragEvent) {
    const ct = e.currentTarget as HTMLElement | null;
    const rt = e.relatedTarget as Node | null;
    if (ct && rt && ct.contains(rt)) return;
    el?.removeAttribute('data-drag-hover');
    clear();
  }
  function onDrop() {
    el?.removeAttribute('data-drag-hover');
    clear();
  }
  el.addEventListener('dragenter', onDragEnter);
  el.addEventListener('dragover', onDragOver);
  el.addEventListener('dragleave', onDragLeave);
  el.addEventListener('drop', onDrop);
  return () => {
    el.removeEventListener('dragenter', onDragEnter);
    el.removeEventListener('dragover', onDragOver);
    el.removeEventListener('dragleave', onDragLeave);
    el.removeEventListener('drop', onDrop);
    clear();
  };
}

function isEditableTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  const ce = (el as HTMLElement).isContentEditable;
  return !!ce;
}

export function installGlobalSectionShortcuts(opts: {
  onCalendar: () => void;
  onTree: () => void;
}): () => void {
  function onKey(e: KeyboardEvent) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (isEditableTarget(document.activeElement as Element | null)) return;
    // Skip wenn ein Modal offen ist — das Modal soll seine eigenen
    // Shortcuts behalten.
    if (document.body.dataset.modalOpen === '1') return;
    if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      opts.onCalendar();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      opts.onTree();
    }
  }
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}
