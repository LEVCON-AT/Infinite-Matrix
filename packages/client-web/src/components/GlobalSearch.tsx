// Global-Search-Palette. Oeffnet via "/". Input + Live-Ergebnisliste,
// gruppiert nach Typ (Nodes / Karten / Checklisten / Zellen).
//
// Kernflow:
//   - query ändert sich -> 180ms Debounce -> searchWorkspace()
//   - Pfeiltasten navigieren die Liste (ArrowDown/ArrowUp im Input OK,
//     der Browser sendet ins Input nichts, da keine Multi-Line)
//   - Enter oeffnet den selektierten Eintrag
//   - ESC schliesst (capture phase, damit globale ESC-Nav nicht greift)
//
// Dispatch-Logik uebernimmt AliasQuicknav's Muster — Cell-Treffer
// priorisiert childMatrixId > boardId > checklists > info > Overlay auf
// Parent-Matrix.

import { useNavigate } from '@solidjs/router';
import {
  type Component,
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { cellTarget } from '../lib/alias-dispatch';
import { installFocusRestore } from '../lib/dialog';
import { openDocsPopup } from '../lib/docs-ui';
import { translateDbError } from '../lib/errors';
import { rememberFocus } from '../lib/navigation-focus';
import { type SearchResult, matchExcerpt, searchWorkspace } from '../lib/search';
import { showToast } from '../lib/toasts';

type Props = {
  workspaceId: string;
  onClose: () => void;
};

type Group = {
  label: string;
  kind: 'node' | 'card' | 'checklist' | 'cell' | 'doc';
  items: SearchResult[];
};

// Gruppiert Results in die 5 Sektionen. Innerhalb jeder Sektion
// alphabetisch nach Title sortiert — stabil, ohne Rank-Magie.
function groupResults(rs: SearchResult[]): Group[] {
  const nodes: SearchResult[] = [];
  const cards: SearchResult[] = [];
  const checklists: SearchResult[] = [];
  const cells: SearchResult[] = [];
  const docs: SearchResult[] = [];
  for (const r of rs) {
    if (r.kind === 'node') nodes.push(r);
    else if (r.kind === 'card') cards.push(r);
    else if (r.kind === 'checklist-board' || r.kind === 'checklist-cell') checklists.push(r);
    else if (r.kind === 'cell') cells.push(r);
    else if (r.kind === 'doc') docs.push(r);
  }
  const sort = (xs: SearchResult[]) =>
    xs.slice().sort((a, b) => a.title.localeCompare(b.title, 'de'));
  const groups: Group[] = [
    { label: 'Matrizen & Boards', kind: 'node', items: sort(nodes) },
    { label: 'Karten', kind: 'card', items: sort(cards) },
    { label: 'Checklisten', kind: 'checklist', items: sort(checklists) },
    { label: 'Dokumentation', kind: 'doc', items: sort(docs) },
    { label: 'Zellen', kind: 'cell', items: sort(cells) },
  ];
  return groups.filter((g) => g.items.length > 0);
}

// Flache, gruppen-preserved Liste fuer Keyboard-Navigation. Einmal
// gebaut, damit ↑↓-Index stabil bleibt solange die Results sich nicht
// aendern.
function flatten(groups: Group[]): SearchResult[] {
  const out: SearchResult[] = [];
  for (const g of groups) for (const it of g.items) out.push(it);
  return out;
}

// cellTarget aus lib/alias-dispatch wiederverwenden. Die SearchResult-
// Shape ist strukturell identisch zu AliasResolveResult's cell-variant
// (childMatrixId, boardId, features, matrixId, cellId); der shared
// Helper ist derselbe.

const GlobalSearch: Component<Props> = (p) => {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<SearchResult[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  // Focus-Restore via lib/dialog-Helper (Sprint AU-A4.3).
  onMount(() => {
    onCleanup(installFocusRestore());
    setTimeout(() => inputRef?.focus(), 0);
  });

  // ESC in capture — sonst schluckt die globale ESC-Nav das Event.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  // Debounced Search — bei jedem query()-Change ein Timer neu starten.
  // Ergebnis-Update reset'et selectedIdx auf 0, damit Enter immer den
  // obersten Treffer oeffnet.
  //
  // Race-Schutz via queryId: wenn zwei Searches parallel laufen (User
  // tippt weiter), verwirft das aeltere Ergebnis sich selbst.
  let queryId = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(() => {
    const q = query();
    if (timer) clearTimeout(timer);
    const myId = ++queryId;
    if (q.trim().length < 2) {
      setResults([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    timer = setTimeout(async () => {
      try {
        const r = await searchWorkspace(q, p.workspaceId);
        if (myId !== queryId) return;
        setResults(r);
        setSelectedIdx(0);
      } catch (err) {
        if (myId !== queryId) return;
        showToast(translateDbError(err), 'error');
        setResults([]);
      } finally {
        if (myId === queryId) setBusy(false);
      }
    }, 180);
  });

  const groups = () => groupResults(results());
  const flat = () => flatten(groups());

  function dispatch(r: SearchResult) {
    switch (r.kind) {
      case 'node':
        navigate(`/w/${p.workspaceId}/n/${r.nodeId}`);
        return;
      case 'cell':
        rememberFocus(r.matrixId, r.rowId, r.colId);
        navigate(cellTarget(p.workspaceId, r));
        return;
      case 'card':
        navigate(`/w/${p.workspaceId}/n/${r.boardId}?card=${r.cardId}`);
        return;
      case 'checklist-board':
        navigate(`/w/${p.workspaceId}/n/${r.boardId}`);
        return;
      case 'checklist-cell':
        navigate(`/w/${p.workspaceId}/c/${r.cellId}/checklists`);
        return;
      case 'doc':
        openDocsPopup({ initialDocId: r.docId });
        return;
    }
  }

  function openSelected() {
    const list = flat();
    if (list.length === 0) return;
    const idx = Math.max(0, Math.min(selectedIdx(), list.length - 1));
    const r = list[idx];
    try {
      dispatch(r);
      p.onClose();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    }
  }

  function onInputKeyDown(e: KeyboardEvent) {
    const list = flat();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (list.length === 0) return;
      setSelectedIdx((i) => (i + 1) % list.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.length === 0) return;
      setSelectedIdx((i) => (i - 1 + list.length) % list.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      openSelected();
    }
  }

  // Snippet: fuer Card-Notizen und Doc-Content ein Kontext-Fenster um
  // das Match herum (HTML-Parity — ohne Fenster-Suche konnte der User
  // nur den Anfang des Texts sehen, nicht warum der Treffer gelistet
  // wurde). matchExcerpt zentriert auf das erste Vorkommen des Terms.
  function subtitleFor(r: SearchResult): string | null {
    const term = query().trim();
    if (r.kind === 'card' && r.note) return matchExcerpt(r.note, term, 140);
    if (r.kind === 'doc' && r.content) return matchExcerpt(r.content, term, 140);
    return null;
  }

  // Wraps alle Vorkommen von `term` im `text` in <mark>-Tags. Gibt JSX-
  // Array zurueck. Case-insensitiv, erhaelt Original-Casing im Match.
  // Kein Regex-Escape noetig — wir splitten mit toLowerCase-indexOf.
  function highlight(text: string, term: string) {
    if (!term || !text) return [text];
    const lower = text.toLowerCase();
    const needle = term.toLowerCase();
    const parts: (string | { mark: string })[] = [];
    let pos = 0;
    while (pos < text.length) {
      const hit = lower.indexOf(needle, pos);
      if (hit < 0) {
        parts.push(text.slice(pos));
        break;
      }
      if (hit > pos) parts.push(text.slice(pos, hit));
      parts.push({ mark: text.slice(hit, hit + term.length) });
      pos = hit + term.length;
    }
    return parts;
  }

  // Kind-Labels fuer Badges.
  function badgeLabel(r: SearchResult): string {
    if (r.kind === 'node') return r.nodeType === 'matrix' ? 'Matrix' : 'Board';
    if (r.kind === 'card') return 'Karte';
    if (r.kind === 'checklist-board') return 'Checkliste (Board)';
    if (r.kind === 'checklist-cell') return 'Checkliste (Zelle)';
    if (r.kind === 'doc') return 'Doku';
    return 'Zelle';
  }

  function badgeDataType(r: SearchResult): string {
    if (r.kind === 'node') return r.nodeType;
    if (r.kind === 'card') return 'card';
    if (r.kind === 'checklist-board' || r.kind === 'checklist-cell') return 'checklist';
    if (r.kind === 'doc') return 'doc';
    return 'cell';
  }

  // Global Offset eines Results in flat() — fuer aria-selected.
  function globalIdxOf(target: SearchResult, list: SearchResult[]): number {
    return list.indexOf(target);
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop-Klick zum Schliessen — Tastatur-Schliessen via globalem ESC-Capture-Handler im onMount.
    <div
      class="overlay-scrim global-search-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        class="overlay-card global-search-card"
        // biome-ignore lint/a11y/useSemanticElements: bewusst <div role="dialog"> — native <dialog>-API erfordert showModal()-Refactor aller 10 Modals + neue Focus-Mechanik. ARIA-Modal-Pattern korrekt umgesetzt (role+aria-modal+Focus-Trap+Focus-Restore).
        role="dialog"
        aria-modal="true"
        aria-label="Suche im Workspace"
      >
        <div class="global-search-head">
          <span class="global-search-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            ref={inputRef}
            class="global-search-input"
            type="text"
            value={query()}
            placeholder="Suchen in Matrizen, Boards, Karten, Checklisten…"
            autocomplete="off"
            spellcheck={false}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={onInputKeyDown}
          />
          <Show when={busy()}>
            <span class="global-search-busy" aria-hidden="true">
              …
            </span>
          </Show>
        </div>

        <div
          class="global-search-body"
          // biome-ignore lint/a11y/useSemanticElements: <div role="listbox"> — natives <select> kann Match-Sektionen + Badges + Multiline-Items nicht rendern.
          role="listbox"
          tabIndex={-1}
        >
          <Show when={query().trim().length < 2}>
            <p class="global-search-hint">
              Mindestens 2 Zeichen eingeben. ↑↓ waehlen, Enter oeffnen, Esc schliessen.
            </p>
          </Show>
          <Show when={query().trim().length >= 2 && !busy() && flat().length === 0}>
            <p class="global-search-hint">Keine Treffer.</p>
          </Show>
          <For each={groups()}>
            {(g) => (
              <section class="global-search-group">
                <h4 class="global-search-group-title">{g.label}</h4>
                <ul class="global-search-list">
                  <For each={g.items}>
                    {(r) => {
                      const gIdx = () => globalIdxOf(r, flat());
                      const isSelected = () => gIdx() === selectedIdx();
                      return (
                        // biome-ignore lint/a11y/useKeyWithClickEvents: Tastatur-Bedienung erfolgt im Input via onKeyDown (↑↓ Enter Esc) — Selektion wird programmatisch per setSelectedIdx + Enter dispatched.
                        <li
                          class="global-search-item"
                          classList={{ 'global-search-item-selected': isSelected() }}
                          // biome-ignore lint/a11y/useSemanticElements: <li role="option"> in einer ARIA-Listbox; <option> ist nur in <select> valide.
                          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: ARIA-Listbox-Pattern.
                          role="option"
                          aria-selected={isSelected()}
                          tabIndex={-1}
                          onMouseEnter={() => setSelectedIdx(gIdx())}
                          onClick={() => {
                            try {
                              dispatch(r);
                              p.onClose();
                            } catch (err) {
                              showToast(translateDbError(err), 'error');
                            }
                          }}
                        >
                          <span class="global-search-badge" data-type={badgeDataType(r)}>
                            {badgeLabel(r)}
                          </span>
                          <div class="global-search-text">
                            <div class="global-search-title">
                              <For each={highlight(r.title, query().trim())}>
                                {(part) =>
                                  typeof part === 'string' ? (
                                    <>{part}</>
                                  ) : (
                                    <mark class="sr-mark">{part.mark}</mark>
                                  )
                                }
                              </For>
                              <Show when={r.alias}>
                                <span class="global-search-alias">^{r.alias}</span>
                              </Show>
                            </div>
                            <Show when={subtitleFor(r)}>
                              <div class="global-search-subtitle">
                                <For each={highlight(subtitleFor(r) as string, query().trim())}>
                                  {(part) =>
                                    typeof part === 'string' ? (
                                      <>{part}</>
                                    ) : (
                                      <mark class="sr-mark">{part.mark}</mark>
                                    )
                                  }
                                </For>
                              </div>
                            </Show>
                          </div>
                        </li>
                      );
                    }}
                  </For>
                </ul>
              </section>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

export default GlobalSearch;
