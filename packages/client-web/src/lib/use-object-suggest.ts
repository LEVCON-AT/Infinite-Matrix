// Globaler Singleton-State fuer Object-Autocomplete-Dropdown (Phase 3
// Welle O.2b). Pattern aus lib/use-alias-autocomplete.ts uebernommen:
//
//   - Genau ein Dropdown lebt im DOM (in App.tsx eingehaengt).
//   - Caller (MatrixView Row/Col-Inputs, BoardView KbCol-Inputs)
//     ruft openObjectSuggest({anchor, query, workspaceId, onPick})
//     bei jedem Tippen → debounced Search → state.hits gefuellt →
//     Singleton-Component re-rendert.
//   - User-Interaction: Pfeil-Up/Down → navigate, Enter → commit,
//     Escape oder Blur → close.
//   - commitObjectSuggest() returnt den aktiven Hit (oder null wenn
//     keiner highlighted) — der Caller entscheidet ob Pick oder
//     Plain-Rename.
//
// Cross-Cut-Aktivierung: bei Pick uebergibt der Caller das hit.id an
// seine renameRow/renameCol/renameKbCol-Callback, die dann zusaetzlich
// zu label das object_id setzt → die existing-Identitaet wird auf
// einer weiteren Stelle gerne (Cross-Cut entsteht, fuer Backlinks-
// Filter in O.5 sichtbar).

import { createSignal } from 'solid-js';
import { type ObjectSearchHit, searchObjects } from './objects';

export type ObjectSuggestState = {
  open: boolean;
  anchor: HTMLElement | null;
  workspaceId: string;
  query: string;
  hits: ObjectSearchHit[];
  activeIdx: number; // -1 = nichts ausgewaehlt
  onPick: ((hit: ObjectSearchHit | null) => void) | null;
  // currentObjectId: wenn die Row schon einen Object-Ref hat, blenden
  // wir diesen Hit aus (verhindert "linke dich auf dich selbst")
  currentObjectId: string | null;
};

const EMPTY: ObjectSuggestState = {
  open: false,
  anchor: null,
  workspaceId: '',
  query: '',
  hits: [],
  activeIdx: -1,
  onPick: null,
  currentObjectId: null,
};

const [state, setState] = createSignal<ObjectSuggestState>(EMPTY);
export const objectSuggestState = state;

let searchTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 200;
const MAX_HITS = 8;

// ─── Open / Update ──────────────────────────────────────────
// Wird aus dem onInput-Handler des Row/Col-Inputs aufgerufen.
// Idempotent — wenn schon offen, aktualisiert nur query/anchor/onPick.
export function openObjectSuggest(args: {
  anchor: HTMLElement;
  workspaceId: string;
  query: string;
  currentObjectId: string | null;
  onPick: (hit: ObjectSearchHit | null) => void;
}): void {
  const cur = state();
  setState({
    open: true,
    anchor: args.anchor,
    workspaceId: args.workspaceId,
    query: args.query,
    hits: cur.hits, // beibehalten bis neue Search-Result reinkommt
    activeIdx: -1, // Reset highlight beim Tippen
    onPick: args.onPick,
    currentObjectId: args.currentObjectId,
  });
  scheduleSearch();
}

function scheduleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void runSearch();
  }, DEBOUNCE_MS);
}

async function runSearch(): Promise<void> {
  const cur = state();
  if (!cur.open) return;
  const q = cur.query.trim();
  if (!q || q.length < 2) {
    // < 2 Zeichen: kein Search, kein Dropdown-Inhalt
    setState({ ...cur, hits: [], activeIdx: -1 });
    return;
  }
  try {
    const raw = await searchObjects(cur.workspaceId, q, MAX_HITS);
    // Aktuellen object_id ausblenden — kein Self-Link-Vorschlag
    const filtered = cur.currentObjectId ? raw.filter((h) => h.id !== cur.currentObjectId) : raw;
    // Wenn waehrend des Roundtrips closed wurde, abbrechen
    const after = state();
    if (!after.open) return;
    setState({ ...after, hits: filtered, activeIdx: -1 });
  } catch (err) {
    console.warn('searchObjects:', err);
    const after = state();
    setState({ ...after, hits: [], activeIdx: -1 });
  }
}

// ─── Close ──────────────────────────────────────────────────
export function closeObjectSuggest(): void {
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  setState(EMPTY);
}

// ─── Keyboard-Navigation ────────────────────────────────────
export function navigateObjectSuggest(direction: 'up' | 'down'): void {
  const cur = state();
  if (!cur.open || cur.hits.length === 0) return;
  if (direction === 'down') {
    const next = Math.min(cur.activeIdx + 1, cur.hits.length - 1);
    setState({ ...cur, activeIdx: next });
  } else {
    const next = Math.max(cur.activeIdx - 1, -1);
    setState({ ...cur, activeIdx: next });
  }
}

// ─── Commit ─────────────────────────────────────────────────
// Returnt den aktiven Hit oder null wenn keiner ausgewaehlt.
// Caller entscheidet basierend darauf ob es ein Pick oder ein
// Plain-Rename ist.
export function commitObjectSuggest(): ObjectSearchHit | null {
  const cur = state();
  if (!cur.open || cur.activeIdx < 0 || cur.activeIdx >= cur.hits.length) {
    closeObjectSuggest();
    return null;
  }
  const hit = cur.hits[cur.activeIdx] ?? null;
  cur.onPick?.(hit);
  closeObjectSuggest();
  return hit;
}

// ─── Click-Pick (vom Singleton-Component) ───────────────────
export function pickObjectSuggest(idx: number): ObjectSearchHit | null {
  const cur = state();
  if (idx < 0 || idx >= cur.hits.length) {
    closeObjectSuggest();
    return null;
  }
  const hit = cur.hits[idx] ?? null;
  cur.onPick?.(hit);
  closeObjectSuggest();
  return hit;
}
