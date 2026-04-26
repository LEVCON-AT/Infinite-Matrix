// Phase-1.C: Ephemeres Incognito-Signal. Ueberschreibt den persistierten
// Activity-Level (siehe lib/settings.ts) temporaer auf "off" — solange
// der Toggle aktiv ist, wird kein Presence-Channel subscribed.
//
// Bewusst kein localStorage-Persist: "kurz unsichtbar" und "permanent
// unsichtbar" sind zwei verschiedene Wuensche. Permanente
// Unsichtbarkeit setzt man im Settings auf 'off'. Reload-Reset ist
// gewollt — User soll nicht zufaellig dauerhaft incognito bleiben.
//
// Pattern analog zu workspace-role.ts (viewerActive): Modul-Level-
// Signal, Zugriff via useIncognito()/setIncognitoValue/toggleIncognito.

import { type Accessor, createSignal } from 'solid-js';

const [incognito, _setIncognito] = createSignal<boolean>(false);

export function useIncognito(): Accessor<boolean> {
  return incognito;
}

export function setIncognitoValue(v: boolean): void {
  _setIncognito(v);
}

export function toggleIncognito(): void {
  _setIncognito((v) => !v);
}
