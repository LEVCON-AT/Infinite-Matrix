// Drag-Context (Phase 4 T.1.G.2) — globaler State fuer In-Flight-Drags.
//
// Das HTML5-Drag-and-Drop-API ist tueckisch: dataTransfer.getData() ist
// im dragover-/drag-Handler nicht zuverlaessig (Browser zeigen die Daten
// erst beim drop). Plus: wir wollen Solid-reaktiv wissen, ob ein Drag
// gerade laeuft, um Drop-Targets visuell hervorzuheben.
//
// Loesung: globale Solid-Signals fuer den Drag-State. Source-Komponente
// ruft startDrag(), Drop-Targets lesen activeDrag() reaktiv. Beim
// dragend (success oder cancel) wird endDrag() aufgerufen.
//
// Phase T.1.G.2 deckt nur Atom='task' ab. T.AC erweitert auf
// link/doc/checklist; das atom-Feld ist als Discriminator schon da.

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
};

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
          e.dataTransfer.setData('application/x-matrix-atom', `${src.atom}:${src.atomId}`);
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
