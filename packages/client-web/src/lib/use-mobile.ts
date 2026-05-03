// Mobile-Viewport-Detection — Single-Source-of-Truth fuer Phone/Tablet/Desktop.
//
// Eine Hook (`useMobile()`) gibt drei reaktive Solid-Signals zurueck.
// Eine zweite Funktion (`useViewportClasses()`) setzt `body.dataset.viewport`
// und `body.dataset.platform`, damit CSS-Selektoren wie
// `body[data-viewport="phone"]` und `body[data-platform="ios"]` greifen
// koennen. Beide Funktionen muessen genau einmal pro App-Boot gemountet
// werden (idempotent, mehrfacher Aufruf ist safe).
//
// Breakpoint-Werte: 500px Phone-Cutoff, 1024px Tablet-Cutoff. Wir nutzen
// hier bewusst PIXEL-Werte (statt rem) im matchMedia-Query, weil
// Mobile-Browser rem-basierte MQs unterschiedlich aufloesen — pixel-
// basiert ist universal kompatibel. Plus Fallback ueber window.innerWidth
// fuer Browser, deren matchMedia-Implementierung Edge-Cases hat.

import { type Accessor, createSignal } from 'solid-js';

type ViewportState = {
  phone: Accessor<boolean>;
  tablet: Accessor<boolean>;
  desktop: Accessor<boolean>;
};

const PHONE_MAX_PX = 500;
const TABLET_MAX_PX = 1024;

const [phone, setPhone] = createSignal<boolean>(false);
const [tablet, setTablet] = createSignal<boolean>(false);
const [desktop, setDesktop] = createSignal<boolean>(true);

let mqInitialized = false;

function recompute(): void {
  if (typeof window === 'undefined') return;
  const w = window.innerWidth;
  // Robust: pixel-basiert via window.innerWidth. matchMedia waere die
  // saubere Loesung, aber manche Mobile-Browser (Samsung-Internet,
  // aeltere Chrome-Android-Versionen) haben Bugs bei min-width-AND-
  // max-width-Kombinationen.
  const isPhone = w <= PHONE_MAX_PX;
  const isTablet = w > PHONE_MAX_PX && w <= TABLET_MAX_PX;
  setPhone(isPhone);
  setTablet(isTablet);
  setDesktop(!isPhone && !isTablet);
}

function ensureMq(): void {
  if (mqInitialized) return;
  if (typeof window === 'undefined') return;
  mqInitialized = true;

  // Initial-Compute synchron — body.dataset.viewport ist sofort gesetzt.
  recompute();

  // Reaktiv: window-resize + orientationchange. resize feuert auf
  // jedem Browser, orientationchange ist iOS-Safari-spezifisch und
  // teils noetig wenn nur die Bildschirm-Drehung stattfindet ohne
  // Resize-Event (alte iOS-Versionen).
  window.addEventListener('resize', recompute, { passive: true });
  window.addEventListener('orientationchange', recompute, { passive: true });
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

  // Reaktiv via window-resize-Listener (recompute setzt die Signals,
  // dieser Listener spiegelt sie nach body.dataset). KEIN onCleanup —
  // dieser Hook wird genau einmal in App() gerufen, body lebt so lange
  // wie das Document, also kein Leak.
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateViewportClass, { passive: true });
    window.addEventListener('orientationchange', updateViewportClass, { passive: true });
  }

  // Platform: einmalig.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let platform: 'ios' | 'android' | 'desktop' = 'desktop';
  if (/iPhone|iPad|iPod/i.test(ua)) platform = 'ios';
  else if (/Android/i.test(ua)) platform = 'android';
  body.dataset.platform = platform;

  updateViewportClass();
}
