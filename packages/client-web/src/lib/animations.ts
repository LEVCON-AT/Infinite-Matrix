// Animation-Helper (Phase 4 T.1.X — Projekt-Standard).
//
// CLAUDE.md-Konvention: 220ms cubic-bezier(.4,0,.2,1) fuer Standard-
// Transitions, 180ms cubic-bezier(.16,1,.3,1) fuer Enter-Animationen.
// `prefers-reduced-motion: reduce` deaktiviert die Animationen automatisch
// (CSS-Media-Query in styles.css).
//
// Verwendung:
//   import { pageEnter, listStaggerEnter, slideHorizontal } from '../lib/animations';
//   <div ref={(el) => pageEnter(el)} class="my-page">…</div>
//   pageEnter(ref) — Element fadet+sliched ein, einmalig.
//   listStaggerEnter(container) — direkte Kinder bekommen 30ms-Delay-Treppe.
//   slideHorizontal(container, dir) — In-/Out-Slide bei Inhalt-Wechsel.

const MOTION_PREF = (() => {
  if (typeof window === 'undefined' || !window.matchMedia) return 'no-preference';
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'normal';
  } catch {
    return 'normal';
  }
})();

function reducedMotion(): boolean {
  return MOTION_PREF === 'reduce';
}

// Page-Enter: opacity 0 + translateY(8px) → opacity 1 + translateY(0).
// 180ms enter-cubic. Idempotent; wenn das Element schon animiert ist,
// passiert nichts. ref-Callback-Pattern: pageEnter(el) im Solid-ref.
export function pageEnter(el: HTMLElement | null): void {
  if (!el) return;
  if (reducedMotion()) return;
  if (el.dataset.entered === '1') return;
  el.dataset.entered = '1';
  el.style.opacity = '0';
  el.style.transform = 'translateY(8px)';
  el.style.willChange = 'opacity, transform';
  // Doppel-rAF: garantiert dass der Browser den Initial-Style commit-ed
  // bevor wir den Transition-Trigger setzen. Ohne das skipped Chrome
  // gelegentlich die Animation.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!el.isConnected) return;
      el.style.transition =
        'opacity 180ms cubic-bezier(.16, 1, .3, 1), transform 180ms cubic-bezier(.16, 1, .3, 1)';
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });
  });
  // Nach Abschluss: will-change zuruecksetzen (Browser-Hint, sonst
  // bleibt das Element unnoetig im Compositor).
  const onEnd = (e: TransitionEvent) => {
    if (e.target !== el) return;
    el.style.willChange = '';
    el.style.transition = '';
    el.removeEventListener('transitionend', onEnd);
  };
  el.addEventListener('transitionend', onEnd);
}

// List-Stagger: erste 8 direkte Kinder fade-in mit 30ms-Treppe, Rest
// erscheint instant. Aufruf einmalig nach Mount des Containers.
export function listStaggerEnter(container: HTMLElement | null, max = 8): void {
  if (!container) return;
  if (reducedMotion()) return;
  if (container.dataset.staggered === '1') return;
  container.dataset.staggered = '1';
  const children = Array.from(container.children) as HTMLElement[];
  for (let i = 0; i < Math.min(children.length, max); i++) {
    const child = children[i];
    child.style.opacity = '0';
    child.style.transform = 'translateY(4px)';
    child.style.willChange = 'opacity, transform';
    const delay = i * 30;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!child.isConnected) return;
        child.style.transition = `opacity 180ms cubic-bezier(.16, 1, .3, 1) ${delay}ms, transform 180ms cubic-bezier(.16, 1, .3, 1) ${delay}ms`;
        child.style.opacity = '1';
        child.style.transform = 'translateY(0)';
      });
    });
    const onEnd = (e: TransitionEvent) => {
      if (e.target !== child) return;
      child.style.willChange = '';
      child.style.transition = '';
      child.removeEventListener('transitionend', onEnd);
    };
    child.addEventListener('transitionend', onEnd);
  }
}

// Cross-Direction-Slide bei Inhalt-Wechsel (Monats-Wechsel im Calendar,
// Tages-Wechsel in der Tagesansicht, Filter-Wechsel in der Agenda).
// Aufruf VOR dem Daten-Update: aktuellen Inhalt slide-out, der naechste
// rAF kann dann den neuen Inhalt sliden-in. Da Solid-Render synchron
// und reaktiv ist, packen wir den Out + Update + In in eine kleine
// Choreografie.
//
// Nutzung:
//   await slideOut(container, 'left');
//   setData(newData);
//   await slideIn(container, 'right');
export function slideOut(
  container: HTMLElement | null,
  direction: 'left' | 'right',
): Promise<void> {
  if (!container || reducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    const dx = direction === 'left' ? '-24px' : '24px';
    container.style.willChange = 'opacity, transform';
    container.style.transition = 'opacity 110ms ease-out, transform 110ms ease-out';
    container.style.opacity = '0';
    container.style.transform = `translateX(${dx})`;
    const onEnd = () => {
      container.removeEventListener('transitionend', onEnd);
      resolve();
    };
    container.addEventListener('transitionend', onEnd);
    // Timeout-Safety: wenn transitionend nicht feuert (Container hidden
    // oder display:none), trotzdem aufloesen.
    setTimeout(() => {
      container.removeEventListener('transitionend', onEnd);
      resolve();
    }, 200);
  });
}

export function slideIn(container: HTMLElement | null, direction: 'left' | 'right'): void {
  if (!container) return;
  if (reducedMotion()) {
    container.style.opacity = '1';
    container.style.transform = '';
    return;
  }
  // Pre-State: Element kommt von der entgegengesetzten Seite.
  const dx = direction === 'left' ? '24px' : '-24px';
  container.style.transition = '';
  container.style.opacity = '0';
  container.style.transform = `translateX(${dx})`;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!container.isConnected) return;
      container.style.transition =
        'opacity 220ms cubic-bezier(.4, 0, .2, 1), transform 220ms cubic-bezier(.4, 0, .2, 1)';
      container.style.opacity = '1';
      container.style.transform = 'translateX(0)';
      const onEnd = () => {
        container.style.willChange = '';
        container.style.transition = '';
        container.removeEventListener('transitionend', onEnd);
      };
      container.addEventListener('transitionend', onEnd);
    });
  });
}

// Fade-Swap bei Inhalt-Wechsel: opacity 0→1, KEIN translateX. Fuer
// Sidebar-Tagesansicht-Tag-Wechsel — wo Slide-L/R bei der schmalen
// Sidebar-Breite zu hektisch wirkt. Aufruf VOR dem Daten-Update:
//   await fadeOut(container);
//   setData(newData);
//   fadeIn(container);
export function fadeOut(container: HTMLElement | null): Promise<void> {
  if (!container || reducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    container.style.willChange = 'opacity';
    container.style.transition = 'opacity 80ms ease-out';
    container.style.opacity = '0';
    const onEnd = () => {
      container.removeEventListener('transitionend', onEnd);
      resolve();
    };
    container.addEventListener('transitionend', onEnd);
    setTimeout(() => {
      container.removeEventListener('transitionend', onEnd);
      resolve();
    }, 160);
  });
}

export function fadeIn(container: HTMLElement | null): void {
  if (!container) return;
  if (reducedMotion()) {
    container.style.opacity = '1';
    return;
  }
  container.style.transition = '';
  container.style.opacity = '0';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!container.isConnected) return;
      container.style.transition = 'opacity 160ms cubic-bezier(.16, 1, .3, 1)';
      container.style.opacity = '1';
      const onEnd = () => {
        container.style.willChange = '';
        container.style.transition = '';
        container.removeEventListener('transitionend', onEnd);
      };
      container.addEventListener('transitionend', onEnd);
    });
  });
}

// Click-Pulse fuer Aktions-Pills (z.B. Status-Toggle im TaskDetail,
// Heute-Button im Calendar). 220ms scale 1→1.03→1, ohne Layout-
// Reflow. Aufruf onClick(e) → clickPulse(e.currentTarget).
export function clickPulse(el: HTMLElement | null): void {
  if (!el) return;
  if (reducedMotion()) return;
  el.style.transition = 'transform 110ms cubic-bezier(.4, 0, .2, 1)';
  el.style.transform = 'scale(1.03)';
  const onUp = () => {
    el.style.transform = 'scale(1)';
    setTimeout(() => {
      el.style.transition = '';
      el.style.transform = '';
    }, 120);
  };
  setTimeout(onUp, 110);
}

// ─── Animations-Manifest §2.7-2.9 Helpers (Q.3.A) ─────────────────
// Class-Toggle-Pattern. Klassen + Tokens leben in styles.css.
// Async-Helper resolven bei animationend/transitionend; bei
// prefers-reduced-motion: reduce → sofortige Resolve.

// Internal: warten auf einmaligen animation/transition-Event.
function waitOnce(
  el: HTMLElement,
  evt: 'animationend' | 'transitionend',
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const onEnd = (e: Event) => {
      if (e.target !== el) return;
      el.removeEventListener(evt, onEnd);
      resolve();
    };
    el.addEventListener(evt, onEnd);
    // Safety: wenn Element hidden ist (display:none-Vorfahre, fehlende
    // Animation-Definition, etc.), feuert das Event nie. timeoutMs * 2
    // als Cap, damit der Caller nie haengt.
    setTimeout(() => {
      el.removeEventListener(evt, onEnd);
      resolve();
    }, timeoutMs);
  });
}

// §2.7 — Drill-Down: Old-Layer skaliert raus, New-Layer skaliert rein.
// Aufruf nach DOM-Insert beider Layer (oldEl noch sichtbar, newEl
// frisch gemountet). Layer werden parallel animiert.
export function drillDown(oldEl: HTMLElement | null, newEl: HTMLElement | null): Promise<void> {
  if (!oldEl || !newEl) return Promise.resolve();
  if (reducedMotion()) return Promise.resolve();
  oldEl.classList.add('drill-down-out');
  newEl.classList.add('drill-down-in');
  // 600ms = --tr-slow * 2 (Safety-Cap).
  return Promise.all([
    waitOnce(oldEl, 'animationend', 600),
    waitOnce(newEl, 'animationend', 600),
  ]).then(() => {
    oldEl.classList.remove('drill-down-out');
    newEl.classList.remove('drill-down-in');
  });
}

// §2.7 — Drill-Up: umgekehrte Skalen.
export function drillUp(oldEl: HTMLElement | null, newEl: HTMLElement | null): Promise<void> {
  if (!oldEl || !newEl) return Promise.resolve();
  if (reducedMotion()) return Promise.resolve();
  oldEl.classList.add('drill-up-out');
  newEl.classList.add('drill-up-in');
  return Promise.all([
    waitOnce(oldEl, 'animationend', 600),
    waitOnce(newEl, 'animationend', 600),
  ]).then(() => {
    oldEl.classList.remove('drill-up-out');
    newEl.classList.remove('drill-up-in');
  });
}

// §2.8 — Collapsible binden. Setzt --collapsible-natural via
// scrollHeight, toggelt data-open. Trigger-Element bekommt
// aria-expanded synchron, damit .chevron-rotate-Klasse mitzieht.
//
// Verwendung:
//   const cleanup = bindCollapsible(buttonEl, contentEl);
//   onCleanup(cleanup);
// contentEl muss .collapsible-Klasse tragen, triggerEl die
// .chevron-rotate-Klasse (oder eigenes [aria-expanded]-Element).
export function bindCollapsible(
  triggerEl: HTMLElement | null,
  contentEl: HTMLElement | null,
  initialOpen = false,
): () => void {
  if (!triggerEl || !contentEl) return () => {};

  function setNatural() {
    // scrollHeight in px ist hier zwingend (Runtime-derived). Token-
    // Free-Pass laut Manifest §2.8.
    contentEl?.style.setProperty('--collapsible-natural', `${contentEl.scrollHeight}px`);
  }

  function applyState(open: boolean) {
    if (!contentEl || !triggerEl) return;
    if (open) {
      setNatural();
      contentEl.dataset.open = 'true';
      triggerEl.setAttribute('aria-expanded', 'true');
      // Nach Open-Transition: max-height auf 'none' freigeben, damit
      // nachfolgendes Resize sauber durchschlaegt.
      const onEnd = (e: TransitionEvent) => {
        if (e.target !== contentEl || e.propertyName !== 'max-height') return;
        contentEl.style.removeProperty('--collapsible-natural');
        contentEl.style.maxHeight = 'none';
        contentEl.removeEventListener('transitionend', onEnd);
      };
      contentEl.addEventListener('transitionend', onEnd);
    } else {
      // Close: aktuelle max-height von 'none' auf scrollHeight setzen,
      // dann auf 0. Sonst springt die Transition.
      if (contentEl.style.maxHeight === 'none') {
        setNatural();
        contentEl.style.maxHeight = `${contentEl.scrollHeight}px`;
        // Reflow erzwingen, dann data-open entfernen → Transition.
        void contentEl.offsetHeight;
      }
      contentEl.dataset.open = 'false';
      contentEl.style.maxHeight = '';
      triggerEl.setAttribute('aria-expanded', 'false');
    }
  }

  // Initial-State setzen ohne Animation (kurz Transition deaktivieren).
  const initialTransition = contentEl.style.transition;
  contentEl.style.transition = 'none';
  applyState(initialOpen);
  // Reflow vor Transition wieder freischalten.
  void contentEl.offsetHeight;
  contentEl.style.transition = initialTransition;

  function onClick() {
    const isOpen = contentEl?.dataset.open === 'true';
    applyState(!isOpen);
  }
  triggerEl.addEventListener('click', onClick);

  return () => {
    triggerEl?.removeEventListener('click', onClick);
  };
}

// §2.9 — Modal-Open (Bloom). Backdrop + Dialog parallel animieren.
// Aufruf nach DOM-Insert. Beide Elemente brauchen die Klassen
// .modal-bloom-backdrop / .modal-bloom-dialog.
export function openModal(backdrop: HTMLElement | null, dialog: HTMLElement | null): Promise<void> {
  if (!backdrop || !dialog) return Promise.resolve();
  if (reducedMotion()) {
    backdrop.dataset.open = 'true';
    dialog.dataset.open = 'true';
    return Promise.resolve();
  }
  // Doppel-rAF: garantiert Browser commit-ed Initial-State (opacity:0 +
  // scale-pop-in) bevor data-open=true die Transition triggert.
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        backdrop.dataset.open = 'true';
        dialog.dataset.open = 'true';
        // Resolve bei Dialog-transitionend (Dialog hat laengere Animation).
        const onEnd = (e: TransitionEvent) => {
          if (e.target !== dialog || e.propertyName !== 'transform') return;
          dialog.removeEventListener('transitionend', onEnd);
          resolve();
        };
        dialog.addEventListener('transitionend', onEnd);
        // Safety-Cap: --tr-enter ~220ms; 480ms = 2x.
        setTimeout(() => {
          dialog.removeEventListener('transitionend', onEnd);
          resolve();
        }, 480);
      });
    });
  });
}

// §2.9 — Modal-Close. Setzt data-state="leaving" → exit-Animation
// (--tr-exit / --ease-in). DOM-Remove nach resolve.
export function closeModal(
  backdrop: HTMLElement | null,
  dialog: HTMLElement | null,
): Promise<void> {
  if (!backdrop || !dialog) return Promise.resolve();
  if (reducedMotion()) {
    delete backdrop.dataset.open;
    delete dialog.dataset.open;
    return Promise.resolve();
  }
  backdrop.dataset.state = 'leaving';
  dialog.dataset.state = 'leaving';
  delete backdrop.dataset.open;
  delete dialog.dataset.open;
  return waitOnce(dialog, 'transitionend', 360);
}

// §2.7 — Drill-Navigate via View-Transitions API (Q.3.A.6).
//
// Wickelt einen Solid-Router navigate() in document.startViewTransition()
// und setzt eine Direction-Klasse auf <html>, damit das CSS
// (::view-transition-old/new(ws-main)) das passende Drill-Down/Up-
// Pattern animiert.
//
// Browser-Support: Chrome ≥111, Edge ≥111, Safari ≥18. In Browsern
// ohne API faellt der Aufruf auf instant-navigate zurueck — kein
// visueller Defekt, nur fehlende Animation.
//
// prefers-reduced-motion: skip Animation, navigate sofort. Das matched
// die Manifest-§3-Konvention.
//
// Verwendung:
//   drillNavigate(navigate, `/w/${ws}/c/${cellId}`, 'down');
//   drillNavigate(navigate, `/w/${ws}/n/${parentNodeId}`, 'up');
export function drillNavigate(
  navigate: (href: string) => void,
  href: string,
  direction: 'down' | 'up',
): void {
  if (typeof document === 'undefined') {
    navigate(href);
    return;
  }
  type DocWithVT = Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };
  const doc = document as DocWithVT;
  if (reducedMotion() || typeof doc.startViewTransition !== 'function') {
    navigate(href);
    return;
  }
  const root = document.documentElement;
  const cls = direction === 'up' ? 'view-transition-drill-up' : 'view-transition-drill-down';
  root.classList.add(cls);
  const tx = doc.startViewTransition(() => {
    navigate(href);
  });
  tx.finished
    .catch(() => {
      // Abbruch durch nachfolgenden Trigger ist harmlos.
    })
    .finally(() => {
      root.classList.remove(cls);
    });
}
