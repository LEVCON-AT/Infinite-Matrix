// Attach-Hook fuer Alias-Autocomplete.
//
// Bindet einen Input oder eine Textarea an den globalen Autocomplete-
// Dropdown: bei Eingabe von `^...` oeffnet sich ein Popup mit matchenden
// Aliases aus dem lib/alias-index.ts-Cache. Enter/Tab uebernimmt, ESC
// schliesst, Pfeile navigieren.
//
// Vorbild: _aaOnInput / _aaOnKeydown / _aaCommit im Alt-Client
// (matrix_tool_beta.html Zeile 5223-5266). Wir halten bewusst `<input>`
// und `<textarea>`; contenteditable wird erst bei Bedarf ergaenzt
// (braucht Range-API statt selectionStart).

import { createSignal } from 'solid-js';
import type { AliasEntry } from './alias-index';
import { getAliasMatches } from './alias-index';

type Target = HTMLInputElement | HTMLTextAreaElement;

type AaUiState = {
  open: boolean;
  anchor: Target | null;
  // Positions im Input-Wert: von start (das `^`) bis end (aktueller Cursor).
  // Beim Commit wird [start, end) durch "^alias " ersetzt.
  start: number;
  end: number;
  query: string;
  matches: AliasEntry[];
  activeIdx: number;
};

const EMPTY: AaUiState = {
  open: false,
  anchor: null,
  start: 0,
  end: 0,
  query: '',
  matches: [],
  activeIdx: 0,
};

const [uiState, setUiState] = createSignal<AaUiState>(EMPTY);

// Read-only Accessor fuer das Singleton-Dropdown.
export const aliasAutocompleteState = uiState;

// Findet das `^token`-Pattern rueckwaerts vom Cursor im Input-Wert.
// Liefert {start, end, query} oder null, wenn kein offenes Token aktiv ist.
// Gueltige Query-Chars: a-zA-Z0-9. Alles andere beendet den Scan.
function parseCaretQuery(
  el: Target,
): { start: number; end: number; query: string } | null {
  const val = el.value;
  const caret = el.selectionStart ?? val.length;
  let i = caret;
  while (i > 0) {
    const c = val[i - 1];
    if (c === '^') return { start: i - 1, end: caret, query: val.slice(i, caret) };
    if (!/[a-zA-Z0-9]/.test(c)) return null;
    i--;
  }
  return null;
}

function close() {
  setUiState(EMPTY);
}

// Token-Insertion via .value-Manipulation — triggert nach dem Schreiben
// einen `input`-Event, damit Solid-Component-Handler (onInput) den neuen
// Wert mitbekommen. `focus()` sorgt dafuer, dass der Caret am richtigen
// Ort steht, auch wenn das Dropdown den Fokus kurz entzogen hat.
function commitAt(el: Target, start: number, end: number, alias: string) {
  const v = el.value;
  const before = v.slice(0, start);
  const after = v.slice(end);
  const insert = `^${alias} `;
  el.value = before + insert + after;
  const caret = (before + insert).length;
  el.setSelectionRange(caret, caret);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.focus();
}

// Fuer onMouseDown im Dropdown: Item-Index aus dem aktuellen State anwenden.
export function commitAliasAutocomplete(idx: number) {
  const s = uiState();
  if (!s.open || !s.anchor) return;
  const entry = s.matches[idx];
  if (!entry) return;
  commitAt(s.anchor, s.start, s.end, entry.alias);
  close();
}

export function closeAliasAutocomplete() {
  close();
}

// Bindet ein Input/Textarea an den Autocomplete-Pfad. Gibt einen Cleanup
// zurueck, den der Caller beim Unmount aufrufen kann.
export function bindAliasAutocomplete(el: Target, wsId: string): () => void {
  const recompute = () => {
    const q = parseCaretQuery(el);
    if (!q) {
      if (uiState().anchor === el) close();
      return;
    }
    const matches = getAliasMatches(wsId, q.query);
    if (matches.length === 0) {
      if (uiState().anchor === el) close();
      return;
    }
    setUiState({
      open: true,
      anchor: el,
      start: q.start,
      end: q.end,
      query: q.query,
      matches,
      activeIdx: 0,
    });
  };

  const onInput = () => recompute();
  const onKeyUp = (e: KeyboardEvent) => {
    // Pfeiltasten ohne Input-Event (Cursor-Move ohne Textaenderung) koennen
    // den Token unter dem Cursor veraendern. Daher zusaetzlich bei keyup.
    if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
      recompute();
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const s = uiState();
    if (!s.open || s.anchor !== el) return;
    if (e.key === 'Escape') {
      // Capture-Niveau nicht noetig — Element-Listener feuert vor dem
      // globalen Overlay-Back-Handler nur dann, wenn kein Overlay aktiv
      // ist. Sollte ein aeusseres Overlay (Card-Modal) ESC schlucken,
      // bleibt die Palette trotzdem lokal reagierend.
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setUiState({
        ...s,
        activeIdx: (s.activeIdx + 1) % s.matches.length,
      });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setUiState({
        ...s,
        activeIdx: (s.activeIdx - 1 + s.matches.length) % s.matches.length,
      });
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      const entry = s.matches[s.activeIdx];
      if (entry) {
        commitAt(el, s.start, s.end, entry.alias);
      }
      close();
      return;
    }
  };
  const onBlur = () => {
    // 150 ms Verzoegerung, damit ein onMouseDown im Dropdown den Commit
    // abschliessen kann, bevor der Blur das Popup wegschneidet.
    window.setTimeout(() => {
      if (document.activeElement !== el && uiState().anchor === el) close();
    }, 150);
  };

  // Cast auf EventListener: Target ist Union (HTMLInputElement | HTMLTextAreaElement),
  // die Overload-Resolution schlaegt bei Union-Types fehl. Die Handler-Signaturen
  // sind intern korrekt getypt.
  const onInputL = onInput as EventListener;
  const onKeyUpL = onKeyUp as EventListener;
  const onKeyDownL = onKeyDown as EventListener;
  const onBlurL = onBlur as EventListener;
  el.addEventListener('input', onInputL);
  el.addEventListener('keyup', onKeyUpL);
  el.addEventListener('keydown', onKeyDownL);
  el.addEventListener('blur', onBlurL);

  return () => {
    el.removeEventListener('input', onInputL);
    el.removeEventListener('keyup', onKeyUpL);
    el.removeEventListener('keydown', onKeyDownL);
    el.removeEventListener('blur', onBlurL);
    if (uiState().anchor === el) close();
  };
}
