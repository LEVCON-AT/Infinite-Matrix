// Mobile-Viewport-Detection — Single-Source-of-Truth fuer Phone/Tablet/Desktop.
//
// Eine Hook (`useMobile()`) gibt drei reaktive Solid-Signals zurueck.
// Eine zweite Funktion (`useViewportClasses()`) setzt `body.dataset.viewport`
// und `body.dataset.platform`, damit CSS-Selektoren wie
// `body[data-viewport="phone"]` und `body[data-platform="ios"]` greifen
// koennen. Beide Funktionen muessen genau einmal pro App-Boot gemountet
// werden (idempotent, mehrfacher Aufruf ist safe).
//
// Breakpoint-Werte: --mobile-bp = 31.25rem (500px), --tablet-bp = 64rem
// (1024px). matchMedia kann CSS-Custom-Properties NICHT aufloesen, daher
// muessen die Werte hier dupliziert werden (siehe styles.css :root).
// Wenn die Tokens dort sich aendern, hier mit-aendern.
//
// Browser-Verhalten: matchMedia interpretiert rem relativ zur Root-Font-
// Size (Default 16px). Wenn der User die Browser-Schriftgroesse skaliert,
// schiebt sich der Breakpoint analog mit — das ist ein Feature, kein Bug
// (responsive zu User-Accessibility-Settings).

import { type Accessor, createSignal, onCleanup } from 'solid-js';

type ViewportState = {
  phone: Accessor<boolean>;
  tablet: Accessor<boolean>;
  desktop: Accessor<boolean>;
};

const [phone, setPhone] = createSignal<boolean>(false);
const [tablet, setTablet] = createSignal<boolean>(false);
const [desktop, setDesktop] = createSignal<boolean>(true);

let mqInitialized = false;

function ensureMq(): void {
  if (mqInitialized) return;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  mqInitialized = true;

  // Phone: < 31.25rem (500px). Wir nutzen 31.249rem als Obergrenze,
  // damit der Tablet-Bereich exakt bei 31.25rem startet (kein
  // Overlap, kein Gap).
  const mqPhone = window.matchMedia('(max-width: 31.249rem)');
  // Tablet: 31.25rem (500px) - 63.999rem (1023.984px).
  const mqTablet = window.matchMedia(
    '(min-width: 31.25rem) and (max-width: 63.999rem)',
  );

  const update = (): void => {
    const isPhone = mqPhone.matches;
    const isTablet = mqTablet.matches;
    setPhone(isPhone);
    setTablet(isTablet);
    setDesktop(!isPhone && !isTablet);
  };

  mqPhone.addEventListener('change', update);
  mqTablet.addEventListener('change', update);
  update();
}

// Reaktiver Hook fuer JS-Komponenten. Mehrfach aufrufbar (gibt immer
// dieselben Signals zurueck — Singleton-Pattern, kein Per-Caller-State).
export function useMobile(): ViewportState {
  ensureMq();
  return { phone, tablet, desktop };
}

// Body-Klassen-Sync: setzt `body.dataset.viewport = 'phone'|'tablet'|'desktop'`
// und `body.dataset.platform = 'ios'|'android'|'desktop'`. Diese
// Attribute erlauben CSS-Selektoren ohne Container-Query (z.B.
// `body[data-viewport="phone"] .ws-sidebar { display: none; }`).
//
// Platform-Detection: einfacher UA-Sniff, weil pointer:coarse allein
// auf Tablet-Hybriden (iPad-mit-Maus) unzuverlaessig ist. Wir nutzen
// den UA als Hinweis fuer das Gestalt-Bild (iOS-Geste-Konvention,
// Android-Backbutton-Konvention), nicht fuer Feature-Detection.
let viewportSyncMounted = false;

export function useViewportClasses(): void {
  if (viewportSyncMounted) return;
  viewportSyncMounted = true;
  ensureMq();

  if (typeof document === 'undefined') return;
  const body = document.body;

  const updateViewportClass = (): void => {
    if (phone()) {
      body.dataset.viewport = 'phone';
    } else if (tablet()) {
      body.dataset.viewport = 'tablet';
    } else {
      body.dataset.viewport = 'desktop';
    }
  };

  // Initial + reaktiv via createEffect waere die saubere Solid-Loesung,
  // aber dieser Hook wird sehr frueh in App() aufgerufen — bevor ein
  // Owner-Context steht. Wir abonnieren manuell auf die Signals via
  // matchMedia-Events (zweimal: einmal hier fuer body.dataset, einmal
  // in ensureMq fuer setPhone/setTablet/setDesktop). Doppelt, aber
  // entkoppelt.
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mqPhone = window.matchMedia('(max-width: 31.249rem)');
    const mqTablet = window.matchMedia(
      '(min-width: 31.25rem) and (max-width: 63.999rem)',
    );
    mqPhone.addEventListener('change', updateViewportClass);
    mqTablet.addEventListener('change', updateViewportClass);
    onCleanup(() => {
      mqPhone.removeEventListener('change', updateViewportClass);
      mqTablet.removeEventListener('change', updateViewportClass);
    });
  }

  // Platform: einmalig.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let platform: 'ios' | 'android' | 'desktop' = 'desktop';
  if (/iPhone|iPad|iPod/i.test(ua)) platform = 'ios';
  else if (/Android/i.test(ua)) platform = 'android';
  body.dataset.platform = platform;

  updateViewportClass();
}
