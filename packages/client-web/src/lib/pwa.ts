// PWA-Foundation fuer den SaaS-Client (Plan 0g.2).
//
// registerServiceWorker() ruft das virtuelle Modul `virtual:pwa-register`
// von vite-plugin-pwa auf. Im Prod-Build ist das ein echter Service-
// Worker-Register; im Dev-Server ein No-Op (wir haben `devOptions.enabled
// = false` in der vite.config, damit HMR sauber bleibt).
//
// installPromptSignal() + triggerInstallPrompt() kapseln den
// `beforeinstallprompt`-Event. Der Browser feuert ihn EINMAL, wenn die
// App fuer einen Install kandidiert. Wir halten das deferred-Prompt-
// Objekt in einem Solid-Signal, damit UI-Komponenten reaktiv den
// Install-Button zeigen/verstecken koennen.

import { createSignal } from 'solid-js';

// vite-plugin-pwa legt das Virtual-Module erst zur Build-Time an. Der
// Import ist daher nur im echten Build aufloesbar — im Dev-Server
// liefert das Plugin einen No-Op-Shim, der die API bereitstellt ohne
// Service-Worker zu registrieren.

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const [deferredPrompt, setDeferredPrompt] =
  createSignal<BeforeInstallPromptEvent | null>(null);
const [installed, setInstalled] = createSignal<boolean>(false);

export function installPromptSignal() {
  return { deferredPrompt, installed };
}

// Triggert das Browser-Prompt. Aufrufer bekommt true bei 'accepted',
// false bei 'dismissed'. Darf nur in einem User-Gesture-Handler
// aufgerufen werden — der Browser blockt das Prompt sonst.
export async function triggerInstallPrompt(): Promise<boolean> {
  const ev = deferredPrompt();
  if (!ev) return false;
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    // Event ist nach dem ersten prompt() verbraucht — deferred-Slot
    // leeren, damit der Button verschwindet.
    setDeferredPrompt(null);
    return choice.outcome === 'accepted';
  } catch {
    setDeferredPrompt(null);
    return false;
  }
}

export function registerServiceWorker(): void {
  if (typeof window === 'undefined') return;

  // beforeinstallprompt-Event abfangen + deferred halten. Ohne
  // preventDefault() zeigt Chrome auf Android den eigenen Mini-
  // Infobar-Prompt; wir wollen den eigenen Button stattdessen.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    setDeferredPrompt(e as BeforeInstallPromptEvent);
  });

  // appinstalled feuert nach erfolgreichem Install aus BELIEBIGEM Pfad
  // (auch aus dem Browser-Menue, nicht nur unserem Button). Wir merken
  // uns das, damit der Button in neuen Sessions verschwindet.
  window.addEventListener('appinstalled', () => {
    setDeferredPrompt(null);
    setInstalled(true);
  });

  // Dynamisch importieren, weil das Virtual-Module nur zur Build-Time
  // existiert. In Tests / SSR bleibt registerServiceWorker ein No-Op.
  void import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({ immediate: true });
    })
    .catch(() => {
      // Dev-Server oder Build ohne PWA-Plugin — einfach still
      // weiterlaufen.
    });
}
