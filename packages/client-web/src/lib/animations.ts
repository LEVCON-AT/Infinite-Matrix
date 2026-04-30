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
