// Helpers fuer rekurrente Karten.
//
// Konvention aus dem HTML-Vorbild (client/matrix_tool_beta.html):
//  - Eine Karte mit `recur.type !== 'none'` wird NIE auf `card.done=true`
//    gesetzt. Stattdessen wird der heutige Tag (YYYY-MM-DD) in
//    `card.done_occurrences[]` gepusht.
//  - "Heute erledigt?" ist dann: `done_occurrences.includes(todayIso())`.
//  - Non-recur Karten verwenden weiter das boolean-Feld `card.done`.
//
// So kann dieselbe Karte-Row beliebig oft "wiederkehren", ohne dass
// eine neue Instanz gespawnt wird — der Nutzer sieht immer die eine
// Karte und deren Historie an Abhak-Daten.

import type { KbCardRow } from './types';

export function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isRecurCard(card: KbCardRow): boolean {
  const r = card.recur;
  if (!r || typeof r !== 'object') return false;
  const t = (r as { type?: unknown }).type;
  return typeof t === 'string' && t !== 'none';
}

export function isCardDone(card: KbCardRow): boolean {
  if (isRecurCard(card)) {
    return (card.done_occurrences ?? []).includes(todayIso());
  }
  return card.done;
}

// Pure: gibt das neue done_occurrences-Array zurueck, nachdem heute
// hinzugefuegt ODER entfernt wurde (je nach Wunsch). Existierende
// Eintraege bleiben erhalten.
export function toggleOccurrence(
  occurrences: string[] | null | undefined,
  date: string,
  done: boolean,
): string[] {
  const list = occurrences ?? [];
  if (done) {
    if (list.includes(date)) return list;
    return [...list, date];
  }
  return list.filter((d) => d !== date);
}
