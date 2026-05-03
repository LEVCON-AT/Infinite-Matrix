// Cross-View-Tab-Hover-Drop — USP fuer Mobile-Drag.
//
// Auf Desktop kann der User eine Karte aus Kanban auf Calendar, Tree
// oder eine andere Sicht ziehen, um eine zusaetzliche Manifestation
// derselben Atom zu erstellen ("Drag-to-Create-Manifestation"). Auf
// Phone gibt es kein Side-by-Side-Layout — die andere Sicht ist erst
// nach View-Wechsel erreichbar.
//
// Loesung: Tab-Hover-Drop. Der User long-presst eine Karte (Pointer-
// Adapter aktiv), zieht den Finger ueber einen Bottom-Tab. Wenn der
// Finger 600ms ueber dem Tab verharrt, wechselt die Sicht (mit Cross-
// fade). Der Drag-State ueberlebt den View-Wechsel — der Float-Ghost
// ist auf <body> portal-mounted, der globalPointerController-State ist
// Modul-lokal. In der neuen Sicht kann der User den Finger auf ein
// Drop-Target absetzen → Manifestation in der Ziel-Sicht.
//
// V1 (Mobile-S10): Tab-Hover-Detection + Dwell-Pulse + View-Wechsel.
// Manifestation-Erstellung in Ziel-Sicht ist NICHT in dieser Datei,
// sondern in den existing Drop-Handlern der Ziel-Sichten (z.B.
// Calendar onDayDrop). Dieser Modul ruft sie nicht direkt — er sorgt
// nur dafuer, dass der User die Ziel-Sicht waehrend des Drags
// erreichen kann.

import { activeDrag } from './drag-context';
import { tabHoverPulse } from './animations';

const DWELL_MS = 600;

type TabState = {
  el: HTMLElement;
  route: string;
  dwellStart: number;
  rafId: number | null;
};

let currentTab: TabState | null = null;
let installed = false;
let navigateFn: ((href: string) => void) | null = null;

function clearCurrentTab(): void {
  if (!currentTab) return;
  if (currentTab.rafId !== null) {
    cancelAnimationFrame(currentTab.rafId);
  }
  tabHoverPulse(currentTab.el, 0);
  currentTab = null;
}

function tickDwell(): void {
  if (!currentTab) return;
  const now = performance.now();
  const elapsed = now - currentTab.dwellStart;
  const progress = Math.min(elapsed / DWELL_MS, 1);
  tabHoverPulse(currentTab.el, progress);
  if (progress >= 1) {
    // Dwell erreicht → View-Wechsel.
    const route = currentTab.route;
    clearCurrentTab();
    if (navigateFn) navigateFn(route);
    return;
  }
  currentTab.rafId = requestAnimationFrame(tickDwell);
}

function findTab(target: EventTarget | null): { el: HTMLElement; route: string } | null {
  if (!(target instanceof Element)) return null;
  const tab = target.closest<HTMLElement>('[data-mobile-drop-tab]');
  if (!tab) return null;
  const route = tab.dataset.mobileDropTab;
  if (!route) return null;
  return { el: tab, route };
}

function onPointerMove(e: PointerEvent): void {
  if (e.pointerType !== 'touch') return;
  if (!activeDrag()) return;
  const els = document.elementsFromPoint(e.clientX, e.clientY);
  let found: { el: HTMLElement; route: string } | null = null;
  for (const el of els) {
    const tab = findTab(el);
    if (tab) {
      found = tab;
      break;
    }
  }
  if (!found) {
    clearCurrentTab();
    return;
  }
  if (currentTab && currentTab.el === found.el) {
    // Schon dort — Tick laeuft.
    return;
  }
  // Neuer Tab → starte Dwell.
  clearCurrentTab();
  currentTab = {
    el: found.el,
    route: found.route,
    dwellStart: performance.now(),
    rafId: null,
  };
  currentTab.rafId = requestAnimationFrame(tickDwell);
}

function onPointerUp(_e: PointerEvent): void {
  // Drop oder Cancel — Dwell-Timer abbrechen ohne View-Wechsel.
  clearCurrentTab();
}

export function installCrossViewTabDrop(navigate: (href: string) => void): void {
  if (installed) return;
  if (typeof document === 'undefined') return;
  installed = true;
  navigateFn = navigate;
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  document.addEventListener('pointerup', onPointerUp, { capture: true, passive: true });
  document.addEventListener('pointercancel', onPointerUp, { capture: true, passive: true });
}
