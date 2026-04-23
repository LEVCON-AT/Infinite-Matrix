// Shared UI-Signal fuer das Docs-Popup. AliasQuicknav, CardOverlay &
// Co. rufen `openDocsPopup({initialDocId?, sourceAlias?, attachedCellId?})`;
// Workspace.tsx beobachtet die Request und mountet das Popup.
//
// Warum ein Signal-Bus und nicht URL-Parameter wie bei `?card=<id>`:
// das Popup ist workspace-global, nicht node-scoped; eine Route dafuer
// waere kuenstlich. Plus: Popup kann mehrere Tabs haben, URL eine
// single-source waere entweder unvollstaendig oder komplex. Signal
// ist die pragmatische Loesung.

import { createSignal } from 'solid-js';

export type OpenDocsRequest = {
  // Falls gesetzt: dieser Doc wird als aktiver Tab geladen (und ggf.
  // neu in die offenen Tabs aufgenommen).
  initialDocId?: string;
  // Falls gesetzt: beim "+ neuer Tab" wird dieser als source_alias
  // vorausgefuellt (Phase 2: Abspringen aus Card/Cell mit Quell-Ref).
  sourceAlias?: string | null;
  // Falls gesetzt: beim "+ neuer Tab" an diese Cell angehaengt.
  attachedCellId?: string | null;
  // Monoton steigender Counter — erlaubt dem Workspace-Effect, auf
  // "jede neue Request reagieren", auch wenn die Payload identisch ist.
  // Wird in openDocsPopup() automatisch erhoeht.
  tick: number;
};

const [request, setRequest] = createSignal<OpenDocsRequest | null>(null);

export function useDocsRequest(): () => OpenDocsRequest | null {
  return request;
}

let tickCounter = 0;

export function openDocsPopup(
  opts: Omit<OpenDocsRequest, 'tick'> = {},
): void {
  tickCounter += 1;
  setRequest({ ...opts, tick: tickCounter });
}

export function clearDocsRequest(): void {
  setRequest(null);
}
