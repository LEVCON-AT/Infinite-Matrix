// Drag-Context — globaler State + Pointer-Adapter fuer In-Flight-Drags.
//
// Zwei Schichten:
//   1. activeDrag()/startDrag()/endDrag() — Solid-Signals als Single-
//      Source. Source-Komponenten setzen, Drop-Targets lesen reaktiv.
//      bindDragSource()/bindDropTarget() sind Convenience-Wrapper, die
//      HTML5-DragEvents korrekt verkabeln (dataTransfer + activeDrag()).
//   2. PointerDragAdapter — auf Touch-Geraeten emuliert er HTML5-Drag-
//      Events via PointerEvents (200ms Long-Press, Float-Ghost,
//      Auto-Scroll, elementsFromPoint-Hit-Test). Components bleiben
//      unveraendert; sie sehen ganz normale DragEvents, nur dass die
//      vom Adapter dispatched werden statt vom Browser.
//
// Warum diese Schichtung: HTML5-Drag-API funktioniert auf Touch-Geraeten
// nicht zuverlaessig (iOS Safari ignoriert Touch fuer DnD, Chrome
// Android braucht touchAction-Tricks). Anstatt alle Drag-Sites der App
// auf PointerEvents umzubauen (8 Komponenten, ~600 LOC Drag-Code),
// generieren wir auf Touch synthetische DragEvents — die Components
// reagieren ohne Aenderung.
//
// Phase Mobile-S3 — adapter mounted in App.tsx via installPointerDragAdapter().

import { type Accessor, createSignal } from 'solid-js';

export type DragAtomType = 'task' | 'link' | 'doc' | 'checklist';

export type DragSource = {
  atom: DragAtomType;
  atomId: string;
  // Optional: bei einem Drag aus einer existing Manifestation (z.B.
  // Tagesansicht-Event) tragen wir die Manifestation-ID, damit der
  // Drop-Handler entscheiden kann ob er moven oder add-en soll.
  sourceManifId?: string;
  // Display-Hilfen fuer Visual-Feedback (Drag-Ghost spaeter).
  label?: string;
  // Optional fuer atom='link': URL fuer den Snapshot in
  // atom_manifestations.display_meta.url. Damit InfoLinks (cell.data.links
  // jsonb, kein FK) auch nach dem Drop ohne Source-Lookup angezeigt
  // werden koennen — die display_meta sind self-contained.
  url?: string;
  // WV.WV.8: Workspace-Scope fuer den MIME-Payload
  // `application/x-matrix-atom-ref`. Erlaubt cross-window /
  // cross-tab-Drag und MCP-Tool-Konsumenten den Atom eindeutig zu
  // referenzieren. Optional — Caller die das nicht setzen
  // produzieren ein Payload mit `workspaceId: undefined` (Drop-
  // Targets innerhalb der App lesen primaer activeDrag(), nicht das
  // dataTransfer-JSON).
  workspaceId?: string;
};

// WV.WV.8: Custom-MIME-Type fuer den Atom-Reference-Drag.
// „ref" macht klar, dass das Payload eine Referenz auf ein
// existing Atom ist (atom_type + atom_id), kein Atom-Inhalt.
// Frueherer Name `application/x-matrix-atom` hatte das Mehrdeutig
// gemacht — Welle WV.WV consolidiert auf `-ref`.
export const ATOM_REF_MIME = 'application/x-matrix-atom-ref';

// JSON-Payload-Shape fuer ATOM_REF_MIME. Versioniert ueber `v` —
// Konsumenten, die einen unbekannten `v`-Wert sehen, brechen ab
// (Forward-Compat-Vertrag).
export type AtomRefPayload = {
  v: 1;
  atomType: DragAtomType;
  atomId: string;
  workspaceId: string | null;
  sourceManifId?: string;
};

export function encodeAtomRefPayload(src: DragSource): string {
  const payload: AtomRefPayload = {
    v: 1,
    atomType: src.atom,
    atomId: src.atomId,
    workspaceId: src.workspaceId ?? null,
    ...(src.sourceManifId ? { sourceManifId: src.sourceManifId } : {}),
  };
  return JSON.stringify(payload);
}

// Defensive Decoder fuer Konsumenten ausserhalb der App (z.B. Welle B
// MCP-Bridge, die Drag-Payloads von externen Sources akzeptiert).
// Returns null bei JSON-Parse-Fehler oder Schema-Drift.
export function decodeAtomRefPayload(raw: string): AtomRefPayload | null {
  try {
    const obj = JSON.parse(raw) as unknown;
    if (typeof obj !== 'object' || obj === null) return null;
    const o = obj as Record<string, unknown>;
    if (o.v !== 1) return null;
    if (typeof o.atomType !== 'string') return null;
    if (typeof o.atomId !== 'string') return null;
    const at = o.atomType;
    if (at !== 'task' && at !== 'link' && at !== 'doc' && at !== 'checklist') return null;
    return {
      v: 1,
      atomType: at,
      atomId: o.atomId,
      workspaceId: typeof o.workspaceId === 'string' ? o.workspaceId : null,
      ...(typeof o.sourceManifId === 'string' ? { sourceManifId: o.sourceManifId } : {}),
    };
  } catch {
    return null;
  }
}

const [active, setActive] = createSignal<DragSource | null>(null);

export const activeDrag: Accessor<DragSource | null> = active;

export function startDrag(src: DragSource): void {
  setActive(src);
  if (typeof document !== 'undefined') {
    document.body.dataset.dragging = src.atom;
  }
}

export function endDrag(): void {
  setActive(null);
  if (typeof document !== 'undefined') {
    delete document.body.dataset.dragging;
  }
}

// Convenience: HTML5-Drag-Events korrekt verkabeln. Aufrufer ruft
// `bindDragSource(el, () => DragSource | null)` und bekommt
// onDragStart/onDragEnd-Handler retour.
export function bindDragSource(opts: {
  build: () => DragSource | null;
}): {
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
} {
  return {
    onDragStart: (e) => {
      const src = opts.build();
      if (!src) {
        e.preventDefault();
        return;
      }
      startDrag(src);
      // dataTransfer setzen ist trotzdem noetig — manche Browser
      // ignorieren das Drag-Event sonst. Wir tragen den Atom-Typ
      // ein; das Empfaenger-Modell liest aber primaer aus activeDrag().
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try {
          // WV.WV.8: JSON-Payload mit ATOM_REF_MIME. Drop-Targets
          // innerhalb der App lesen primaer activeDrag() (Solid-
          // Signal); der MIME-Eintrag ist Pflicht damit der Browser
          // den Drag akzeptiert + fuer cross-window/MCP-Konsumenten.
          e.dataTransfer.setData(ATOM_REF_MIME, encodeAtomRefPayload(src));
        } catch {
          /* manche Browser werfen — egal, wir haben activeDrag(). */
        }
      }
    },
    onDragEnd: () => {
      endDrag();
    },
  };
}

// Drop-Target-Helpers: bindDropTarget verkabelt onDragEnter / -Over /
// -Leave / -Drop. Aufrufer bekommt den DragSource im onDrop-Callback.
export function bindDropTarget(opts: {
  // Filter: gibt false zurueck wenn dieses Drop-Target den aktuellen
  // Drag NICHT akzeptiert (z.B. Calendar-Tag akzeptiert nur 'task').
  // Default: alle akzeptieren.
  accepts?: (src: DragSource) => boolean;
  onEnter?: (src: DragSource) => void;
  onLeave?: () => void;
  onDrop: (src: DragSource) => void;
}): {
  onDragEnter: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
} {
  function isAccepted(): DragSource | null {
    const src = active();
    if (!src) return null;
    if (opts.accepts && !opts.accepts(src)) return null;
    return src;
  }

  return {
    onDragEnter: (e) => {
      const src = isAccepted();
      if (!src) return;
      e.preventDefault();
      opts.onEnter?.(src);
    },
    onDragOver: (e) => {
      const src = isAccepted();
      if (!src) return;
      // preventDefault ist Pflicht damit Drop ueberhaupt feuert.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    },
    onDragLeave: (e) => {
      // Browser feuert dragleave auch beim Wechsel auf Kind-Elemente.
      // Wir filtern: Leave nur wenn target=currentTarget oder relatedTarget
      // nicht im Container.
      const ct = e.currentTarget as HTMLElement | null;
      const rt = e.relatedTarget as HTMLElement | null;
      if (!ct) return;
      if (rt && ct.contains(rt)) return;
      opts.onLeave?.();
    },
    onDrop: (e) => {
      const src = isAccepted();
      if (!src) return;
      e.preventDefault();
      e.stopPropagation();
      opts.onDrop(src);
      endDrag();
    },
  };
}

// ════════════════════════════════════════════════════════════════════
// Pointer-Adapter — emuliert HTML5-Drag fuer Touch-Geraete.
// ════════════════════════════════════════════════════════════════════
//
// Verwendung: einmal `installPointerDragAdapter()` in App.tsx aufrufen.
// Idempotent — mehrfache Aufrufe sind safe.
//
// Funktionsweise:
//   1. capture-pointerdown auf body: filter pointerType==='touch' UND
//      target.closest('[draggable="true"]'). Mouse/Pen ignorieren wir
//      (nativer HTML5-Drag funktioniert dort).
//   2. 200ms Long-Press-Timer. Cancel bei Move > 8px vor Trigger oder
//      bei pointerup. Verhindert Konflikt mit Scroll-Geste.
//   3. Long-Press fired: synthetic 'dragstart' dispatchen auf Source.
//      Der Component-Handler ruft startDrag(), wir haben activeDrag().
//   4. pointermove: hit-test via elementsFromPoint, bestimme aktuelles
//      Drop-Target. Bei Wechsel: dragleave(old) + dragenter(new) +
//      dragover(new). Float-Ghost folgt dem Finger.
//   5. pointerup: wenn auf Drop-Target → drop. dragend feuert immer.
//   6. pointercancel: dragend.
//
// Synthetisches DataTransfer: HTML5 verlangt es als Property auf
// DragEvent. Wir konstruieren ein Stub-Objekt mit den Methoden, die
// existing Components nutzen (setData/getData/effectAllowed/dropEffect/
// setDragImage). Dispatchen ein Event, dem wir nachtraeglich
// `dataTransfer` als own-property anhaengen — Solid-Handler lesen das
// transparent.

class SyntheticDataTransfer {
  effectAllowed = 'all';
  dropEffect = 'none';
  types: string[] = [];
  files: FileList = new DataTransfer().files; // leer aber typkonform
  private store = new Map<string, string>();

  setData(type: string, data: string): void {
    this.store.set(type, data);
    if (!this.types.includes(type)) this.types.push(type);
  }
  getData(type: string): string {
    return this.store.get(type) ?? '';
  }
  clearData(type?: string): void {
    if (type) {
      this.store.delete(type);
      this.types = this.types.filter((t) => t !== type);
    } else {
      this.store.clear();
      this.types = [];
    }
  }
  setDragImage(_img: Element, _x: number, _y: number): void {
    // No-op — wir rendern eigenen Float-Ghost.
  }
}

type AdapterState =
  | { phase: 'idle' }
  | {
      phase: 'pressing';
      sourceEl: HTMLElement;
      pointerId: number;
      startX: number;
      startY: number;
      timer: number;
    }
  | {
      phase: 'dragging';
      sourceEl: HTMLElement;
      pointerId: number;
      ghost: HTMLElement | null;
      currentDropEl: HTMLElement | null;
      dataTransfer: SyntheticDataTransfer;
    };

let state: AdapterState = { phase: 'idle' };
let adapterInstalled = false;
let scrollRaf: number | null = null;
let lastPointerY = 0;
let lastPointerX = 0;

const LONG_PRESS_MS = 200;
const MOVE_CANCEL_THRESHOLD_PX = 8;
const AUTO_SCROLL_EDGE_PX = 64;
const AUTO_SCROLL_SPEED_PX_PER_FRAME = 8;

function dispatchSynthDragEvent(
  type: 'dragstart' | 'dragenter' | 'dragover' | 'dragleave' | 'drop' | 'dragend',
  target: EventTarget,
  clientX: number,
  clientY: number,
  dataTransfer: SyntheticDataTransfer,
  relatedTarget: EventTarget | null = null,
): boolean {
  // DragEvent constructor mit dataTransfer ist nicht ueberall
  // unterstuetzt. Stattdessen: einen Standard-Event erzeugen und
  // dataTransfer als read-only own-property anhaengen. Solid-Listener
  // lesen das transparent.
  const ev = new Event(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(ev, 'dataTransfer', {
    value: dataTransfer,
    enumerable: true,
  });
  Object.defineProperty(ev, 'clientX', { value: clientX, enumerable: true });
  Object.defineProperty(ev, 'clientY', { value: clientY, enumerable: true });
  Object.defineProperty(ev, 'pageX', { value: clientX + window.scrollX, enumerable: true });
  Object.defineProperty(ev, 'pageY', { value: clientY + window.scrollY, enumerable: true });
  Object.defineProperty(ev, 'relatedTarget', {
    value: relatedTarget,
    enumerable: true,
  });
  return target.dispatchEvent(ev);
}

function findDragSource(el: EventTarget | null): HTMLElement | null {
  if (!(el instanceof Element)) return null;
  const draggable = el.closest('[draggable="true"]');
  return draggable instanceof HTMLElement ? draggable : null;
}

function findDropTarget(x: number, y: number, sourceEl: HTMLElement): HTMLElement | null {
  // elementsFromPoint gibt die Stack-Reihenfolge top-down. Wir nehmen
  // das oberste Element, das NICHT der Source und NICHT der Float-Ghost
  // ist. Drop-Targets identifizieren wir nicht ueber ein Marker-
  // Attribut, sondern ueber das pure Vorhandensein im DOM — die
  // Komponenten haben eigene preventDefault-Logik in dragenter/over.
  const els = document.elementsFromPoint(x, y);
  for (const el of els) {
    if (!(el instanceof HTMLElement)) continue;
    if (el === sourceEl || sourceEl.contains(el)) continue;
    if (el.dataset.dragGhost === 'yes') continue;
    return el;
  }
  return null;
}

function makeFloatGhost(source: HTMLElement, x: number, y: number): HTMLElement {
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.dataset.dragGhost = 'yes';
  ghost.style.position = 'fixed';
  ghost.style.left = '0';
  ghost.style.top = '0';
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.transform = `translate(${x - rect.width / 2}px, ${y - rect.height / 2}px) scale(1.05)`;
  ghost.style.transformOrigin = 'center';
  ghost.style.pointerEvents = 'none';
  ghost.style.opacity = '0.92';
  ghost.style.boxShadow = 'var(--shadow-2xl)';
  ghost.style.borderRadius = 'var(--radius-lg)';
  ghost.style.zIndex = 'var(--z-toast)';
  ghost.style.transition =
    'transform 75ms cubic-bezier(0, 0, 0.2, 1), opacity 75ms cubic-bezier(0, 0, 0.2, 1)';
  document.body.appendChild(ghost);
  return ghost;
}

function moveFloatGhost(ghost: HTMLElement, x: number, y: number): void {
  const w = ghost.offsetWidth;
  const h = ghost.offsetHeight;
  ghost.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px) scale(1.05)`;
}

function destroyFloatGhost(ghost: HTMLElement | null): void {
  if (!ghost) return;
  // Cancel-Animation: zurueck zur Mitte + fade. Pflicht laut
  // animations.md §3 (sichtbare State-Aenderung animiert).
  ghost.style.transition =
    'transform 160ms cubic-bezier(0.4, 0, 1, 1), opacity 160ms cubic-bezier(0.4, 0, 1, 1)';
  const currentTransform = ghost.style.transform;
  ghost.style.transform = currentTransform.replace('scale(1.05)', 'scale(0.9)');
  ghost.style.opacity = '0';
  setTimeout(() => {
    ghost.parentNode?.removeChild(ghost);
  }, 200);
}

function startAutoScroll(): void {
  if (scrollRaf !== null) return;
  const tick = (): void => {
    if (state.phase !== 'dragging') {
      scrollRaf = null;
      return;
    }
    const vh = window.innerHeight;
    if (lastPointerY < AUTO_SCROLL_EDGE_PX) {
      window.scrollBy(0, -AUTO_SCROLL_SPEED_PX_PER_FRAME);
    } else if (lastPointerY > vh - AUTO_SCROLL_EDGE_PX) {
      window.scrollBy(0, AUTO_SCROLL_SPEED_PX_PER_FRAME);
    }
    scrollRaf = requestAnimationFrame(tick);
  };
  scrollRaf = requestAnimationFrame(tick);
}

function stopAutoScroll(): void {
  if (scrollRaf !== null) {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = null;
  }
}

function transitionToDragging(
  pressingState: Extract<AdapterState, { phase: 'pressing' }>,
  x: number,
  y: number,
): void {
  const dt = new SyntheticDataTransfer();
  // dragstart synthetisch dispatchen — Component-Handler ruft
  // startDrag(), setzt activeDrag().
  const accepted = dispatchSynthDragEvent('dragstart', pressingState.sourceEl, x, y, dt);
  // wenn der Handler preventDefault() ruft, dispatchEvent gibt false
  // zurueck — wir brechen ab.
  if (!accepted) {
    state = { phase: 'idle' };
    return;
  }
  // Nur uebernehmen wenn der Handler tatsaechlich activeDrag() gesetzt
  // hat. Wenn der early-aborted (z.B. boardUi.sort()!=='manual'), ist
  // activeDrag noch null — kein echter Drag, also abbrechen.
  if (!active()) {
    state = { phase: 'idle' };
    return;
  }
  const ghost = makeFloatGhost(pressingState.sourceEl, x, y);
  state = {
    phase: 'dragging',
    sourceEl: pressingState.sourceEl,
    pointerId: pressingState.pointerId,
    ghost,
    currentDropEl: null,
    dataTransfer: dt,
  };
  startAutoScroll();
}

function onPointerDown(e: PointerEvent): void {
  // Mouse/Pen → native HTML5-Drag uebernimmt. Touch → Adapter aktiv.
  if (e.pointerType !== 'touch') return;
  if (state.phase !== 'idle') return;
  const sourceEl = findDragSource(e.target);
  if (!sourceEl) return;
  // Wir starten Long-Press; nicht preventDefault, sonst geht Tap-Click
  // verloren. preventDefault passiert erst im Long-Press-Trigger.
  const pressing: Extract<AdapterState, { phase: 'pressing' }> = {
    phase: 'pressing',
    sourceEl,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    timer: 0,
  };
  pressing.timer = window.setTimeout(() => {
    if (state.phase !== 'pressing' || state.pointerId !== pressing.pointerId) return;
    transitionToDragging(pressing, lastPointerX, lastPointerY);
  }, LONG_PRESS_MS);
  state = pressing;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
}

function onPointerMove(e: PointerEvent): void {
  if (e.pointerType !== 'touch') return;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  if (state.phase === 'pressing') {
    if (state.pointerId !== e.pointerId) return;
    const dx = Math.abs(e.clientX - state.startX);
    const dy = Math.abs(e.clientY - state.startY);
    if (dx > MOVE_CANCEL_THRESHOLD_PX || dy > MOVE_CANCEL_THRESHOLD_PX) {
      // Vor Long-Press-Trigger zu viel Bewegung → User wollte scrollen,
      // kein Drag.
      window.clearTimeout(state.timer);
      state = { phase: 'idle' };
    }
    return;
  }
  if (state.phase === 'dragging' && state.pointerId === e.pointerId) {
    e.preventDefault();
    if (state.ghost) moveFloatGhost(state.ghost, e.clientX, e.clientY);
    const newDrop = findDropTarget(e.clientX, e.clientY, state.sourceEl);
    if (newDrop !== state.currentDropEl) {
      if (state.currentDropEl) {
        dispatchSynthDragEvent(
          'dragleave',
          state.currentDropEl,
          e.clientX,
          e.clientY,
          state.dataTransfer,
          newDrop,
        );
      }
      if (newDrop) {
        dispatchSynthDragEvent(
          'dragenter',
          newDrop,
          e.clientX,
          e.clientY,
          state.dataTransfer,
          state.currentDropEl,
        );
      }
      state.currentDropEl = newDrop;
    }
    if (state.currentDropEl) {
      dispatchSynthDragEvent(
        'dragover',
        state.currentDropEl,
        e.clientX,
        e.clientY,
        state.dataTransfer,
      );
    }
  }
}

function onPointerUp(e: PointerEvent): void {
  if (e.pointerType !== 'touch') return;
  if (state.phase === 'pressing' && state.pointerId === e.pointerId) {
    window.clearTimeout(state.timer);
    state = { phase: 'idle' };
    return;
  }
  if (state.phase === 'dragging' && state.pointerId === e.pointerId) {
    e.preventDefault();
    const draggingState = state;
    const dropEl = draggingState.currentDropEl;
    if (dropEl) {
      dispatchSynthDragEvent('drop', dropEl, e.clientX, e.clientY, draggingState.dataTransfer);
    }
    dispatchSynthDragEvent(
      'dragend',
      draggingState.sourceEl,
      e.clientX,
      e.clientY,
      draggingState.dataTransfer,
    );
    destroyFloatGhost(draggingState.ghost);
    stopAutoScroll();
    state = { phase: 'idle' };
    // Falls der Component-Handler endDrag() nicht ruft (z.B. drop ohne
    // accepts), sicherstellen dass wir activeDrag() abraeumen.
    if (active()) endDrag();
  }
}

function onPointerCancel(e: PointerEvent): void {
  if (e.pointerType !== 'touch') return;
  if (state.phase === 'pressing' && state.pointerId === e.pointerId) {
    window.clearTimeout(state.timer);
    state = { phase: 'idle' };
    return;
  }
  if (state.phase === 'dragging' && state.pointerId === e.pointerId) {
    const draggingState = state;
    dispatchSynthDragEvent(
      'dragend',
      draggingState.sourceEl,
      e.clientX,
      e.clientY,
      draggingState.dataTransfer,
    );
    destroyFloatGhost(draggingState.ghost);
    stopAutoScroll();
    state = { phase: 'idle' };
    if (active()) endDrag();
  }
}

// Verhindert dass wir Drag-Lift versehentlich auf Tap aufloesen, wenn
// der User sehr kurz auf eine draggable-Card tippt — Touch-Click ist
// dann ein normaler Tap, kein Drag.
//
// Aufruf: in App.tsx einmalig.
export function installPointerDragAdapter(): void {
  if (adapterInstalled) return;
  if (typeof document === 'undefined') return;
  adapterInstalled = true;

  // capture=true: wir wollen den Long-Press-Timer starten BEVOR der
  // Component eigene pointerdown-Handler verarbeitet (z.B. Tap).
  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
  document.addEventListener('pointerup', onPointerUp, { capture: true, passive: false });
  document.addEventListener('pointercancel', onPointerCancel, { capture: true, passive: true });

  // Verhindert dass der Browser bei Touch auf draggable-Element
  // automatisch eine Selection oder Native-Drag startet, die mit
  // unserem Adapter konfligiert.
  if (!document.querySelector('style[data-mobile-drag-adapter]')) {
    const css = document.createElement('style');
    css.dataset.mobileDragAdapter = 'yes';
    css.textContent = `
      [data-viewport="phone"] [draggable="true"],
      [data-viewport="tablet"] [draggable="true"] {
        touch-action: pan-y;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
      }
    `;
    document.head.appendChild(css);
  }
}
