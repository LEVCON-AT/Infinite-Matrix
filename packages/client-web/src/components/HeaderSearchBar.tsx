// Zentrales Such-/Steuerfeld im Workspace-Header.
//
// Vereint in einem Input-Feld:
//   - Text-Suche ueber den kompletten Workspace (DB-ilike via searchWorkspace)
//   - Command-Execution ueber `^`-Prefix (parseCommand + executeCommand)
//   - Alias-Navigation (in-memory aliasIndex — sofort reaktiv)
//
// Dropdown-Layout abhaengig vom Mode:
//   - idle (leerer Input, fokussiert): History-Liste
//   - search (Text ohne `^`): Result-Gruppen oben, Haarlinie, Alias-Treffer unten
//   - command (`^...`): Alias-Treffer oben, Haarlinie, Command-Verben unten
//   - colpick (Sub-Prompt fuer `^n X -m Y`): Inline-Select im Dropdown
//
// Fokussiert wird via `f`-Shortcut im Workspace-Global-KeyDown. Der
// alte `/`-GlobalSearch-Modal und `^`-CommandPalette-Modal bleiben
// parallel verfuegbar (DeadKey-Sicherheit auf DE-Layouts).
//
// History via localStorage (lib/search-history.ts). Alt+Up/Down cycled
// durch letzte 25 Eingaben.

import { useNavigate } from '@solidjs/router';
import {
  type Component,
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { dispatchAliasResult } from '../lib/alias-dispatch';
import { cellTarget } from '../lib/alias-dispatch';
import { type AliasEntry, aliasIndexSignal, getAliasMatches } from '../lib/alias-index';
import { resolveAlias } from '../lib/alias-resolve';
import {
  COMMAND_VERBS,
  type CommandUiHooks,
  executeCommand,
  parseCommand,
  reportOutcome,
} from '../lib/commands';
import { openDocsPopup } from '../lib/docs-ui';
import { translateDbError } from '../lib/errors';
import { highlightSubstring } from '../lib/match-highlight';
import { moveCardToBoard } from '../lib/mutations';
import { rememberFocus } from '../lib/navigation-focus';
import { type SearchResult, matchExcerpt, searchWorkspace } from '../lib/search';
import { type HistoryEntry, loadHistory, pushHistory } from '../lib/search-history';
import { supabase } from '../lib/supabase';
import { showToast } from '../lib/toasts';
import type { NodeRow } from '../lib/types';
import { exportWorkspaceWithUi, importWorkspaceWithUi } from '../lib/workspace-io';
import { type ResetScope, runResetAll, runResetScope } from '../lib/workspace-reset';
import Icon from './Icon';

type Props = {
  workspaceId: string;
  currentNode: NodeRow | undefined;
  currentCellId?: string;
  currentFeature?: 'info' | 'checklists' | 'docs';
  onShowHelp: () => void;
  // Damit wir die HeaderSearchBar von aussen fokussieren koennen
  // (`f`-Global-Keybind in Workspace.tsx).
  registerFocus?: (fn: () => void) => void;
};

type ColPickState = {
  cardId: string;
  cardLabel: string;
  boardId: string;
  boardLabel: string;
  cols: Array<{ id: string; label: string }>;
  selectedIdx: number;
};

// Flat-Item-Typ: eine Zeile im Dropdown. Alle moeglichen Kinds in eine
// diskriminierte Union — selectedIdx laeuft ueber diese Liste, damit
// Arrow-Keys + Enter einfach den richtigen Eintrag treffen.
type FlatItem =
  | { kind: 'history'; id: string; entry: HistoryEntry }
  | { kind: 'alias'; id: string; entry: AliasEntry }
  | { kind: 'result'; id: string; result: SearchResult }
  | { kind: 'verb'; id: string; verb: (typeof COMMAND_VERBS)[number] };

type Group = {
  label: string;
  kind: 'node' | 'card' | 'checklist' | 'cell' | 'doc';
  items: SearchResult[];
};

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
  return [
    { label: 'Matrizen & Boards', kind: 'node', items: sort(nodes) },
    { label: 'Karten', kind: 'card', items: sort(cards) },
    { label: 'Checklisten', kind: 'checklist', items: sort(checklists) },
    { label: 'Dokumentation', kind: 'doc', items: sort(docs) },
    { label: 'Zellen', kind: 'cell', items: sort(cells) },
  ].filter((g) => g.items.length > 0) as Group[];
}

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

const HeaderSearchBar: Component<Props> = (p) => {
  const navigate = useNavigate();

  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<SearchResult[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [flashOk, setFlashOk] = createSignal(false);
  const [flashErr, setFlashErr] = createSignal(false);
  const [selectedIdx, setSelectedIdx] = createSignal(0);
  const [focused, setFocused] = createSignal(false);
  const [colPick, setColPick] = createSignal<ColPickState | null>(null);
  const [historyCursor, setHistoryCursor] = createSignal(-1);
  let historyDraft = '';
  const [history, setHistory] = createSignal<HistoryEntry[]>(loadHistory(p.workspaceId));

  let inputRef: HTMLInputElement | undefined;
  let colSelectRef: HTMLSelectElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queryId = 0;
  let flashOkTimer: ReturnType<typeof setTimeout> | undefined;
  let flashErrTimer: ReturnType<typeof setTimeout> | undefined;

  // aliasIndex reagiert auf realtime-Refreshes; derive matches reaktiv.
  // Prefix-Strip von `^` passiert in getAliasMatches.
  const _aliasIndex = aliasIndexSignal(p.workspaceId);
  const aliasMatches = createMemo<AliasEntry[]>(() => {
    // Dependency-Trigger — auch wenn query trim-leer ist, sollen Updates
    // aus dem Index sichtbar werden.
    void _aliasIndex();
    const q = query().trim();
    if (!q) return [];
    const stripped = q.startsWith('^') ? q.slice(1) : q;
    if (!stripped) return [];
    return getAliasMatches(p.workspaceId, stripped, 8);
  });

  const mode = createMemo<'idle' | 'search' | 'command' | 'colpick'>(() => {
    if (colPick()) return 'colpick';
    const q = query();
    if (q.startsWith('^')) return 'command';
    if (q.trim().length > 0) return 'search';
    return 'idle';
  });

  // Commands, die zum Text-Nach-`^` passen (Substring, case-insensitiv).
  const matchingVerbs = createMemo(() => {
    const raw = query().trim();
    if (!raw.startsWith('^')) return [] as typeof COMMAND_VERBS;
    const token = raw.slice(1).trim().toLowerCase();
    if (!token) return COMMAND_VERBS;
    const firstWord = token.split(/\s+/)[0];
    return COMMAND_VERBS.filter((v) =>
      v.verb === '<alias>'
        ? false // Der Alias-Eintrag taucht nicht als Command auf — Aliase sind oben.
        : v.verb.toLowerCase().includes(firstWord),
    );
  });

  // Flat-Index-Liste fuer Keyboard-Navigation + Enter-Dispatch.
  const flatItems = createMemo<FlatItem[]>(() => {
    const m = mode();
    if (m === 'colpick') return [];
    if (m === 'idle') {
      return history().map((h, i) => ({
        kind: 'history' as const,
        id: `h-${i}-${h.ts}`,
        entry: h,
      }));
    }
    if (m === 'command') {
      const aliases: FlatItem[] = aliasMatches().map((a) => ({
        kind: 'alias' as const,
        id: `a-${a.kind}-${a.id}`,
        entry: a,
      }));
      const verbs: FlatItem[] = matchingVerbs().map((v, i) => ({
        kind: 'verb' as const,
        id: `v-${i}-${v.verb}`,
        verb: v,
      }));
      return [...aliases, ...verbs];
    }
    // search mode
    const resList: FlatItem[] = results().map((r) => ({
      kind: 'result' as const,
      id: `r-${r.kind}-${(r as { nodeId?: string; cellId?: string; cardId?: string; checklistId?: string; docId?: string }).nodeId ?? (r as { cellId?: string }).cellId ?? (r as { cardId?: string }).cardId ?? (r as { checklistId?: string }).checklistId ?? (r as { docId?: string }).docId ?? ''}`,
      result: r,
    }));
    const aliasesBelow: FlatItem[] = aliasMatches().map((a) => ({
      kind: 'alias' as const,
      id: `a-${a.kind}-${a.id}`,
      entry: a,
    }));
    return [...resList, ...aliasesBelow];
  });

  const groupedResults = createMemo<Group[]>(() => groupResults(results()));

  const showDropdown = createMemo(
    () =>
      focused() &&
      (mode() !== 'idle' || (mode() === 'idle' && history().length > 0) || error() !== null),
  );

  // Debounced DB-Search. Nur in search-mode aktiv; mode-switch cancelt.
  createEffect(() => {
    const m = mode();
    const q = query();
    if (timer) clearTimeout(timer);
    if (m !== 'search') {
      // beim Modus-Wechsel alte Results wegwerfen, damit das Dropdown
      // nicht stale-Eintraege neben der Help-Liste zeigt.
      if (results().length > 0) setResults([]);
      setBusy(false);
      return;
    }
    if (q.trim().length < 2) {
      setResults([]);
      setBusy(false);
      return;
    }
    const myId = ++queryId;
    setBusy(true);
    timer = setTimeout(async () => {
      try {
        const rs = await searchWorkspace(q, p.workspaceId);
        if (myId !== queryId) return;
        setResults(rs);
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

  // Selection resetten wenn Liste sich aendert.
  createEffect(() => {
    // tracked dep
    void flatItems().length;
    setSelectedIdx((cur) => {
      const len = flatItems().length;
      if (len === 0) return 0;
      return Math.min(cur, len - 1);
    });
  });

  // History-Refresh auf Workspace-Wechsel.
  createEffect(() => {
    setHistory(loadHistory(p.workspaceId));
  });

  // Bar von aussen fokussierbar machen (Workspace.tsx-Keybind `f`).
  onMount(() => {
    if (p.registerFocus) {
      p.registerFocus(() => {
        inputRef?.focus();
      });
    }
  });

  onCleanup(() => {
    if (timer) clearTimeout(timer);
    if (flashOkTimer) clearTimeout(flashOkTimer);
    if (flashErrTimer) clearTimeout(flashErrTimer);
  });

  function triggerFlashOk() {
    setFlashOk(true);
    if (flashOkTimer) clearTimeout(flashOkTimer);
    flashOkTimer = setTimeout(() => setFlashOk(false), 600);
  }

  function triggerFlashErr(msg: string) {
    setError(msg);
    setFlashErr(true);
    if (flashErrTimer) clearTimeout(flashErrTimer);
    flashErrTimer = setTimeout(() => setFlashErr(false), 300);
  }

  const uiHooks: CommandUiHooks = {
    onShowHelp: () => {
      p.onShowHelp();
      inputRef?.blur();
    },
    onOpenDocs: () => {
      openDocsPopup();
      inputRef?.blur();
    },
    onColPick: (args) => {
      setColPick({ ...args, selectedIdx: 0 });
      // Focus ins Select sobald das DOM es rendert.
      setTimeout(() => colSelectRef?.focus(), 0);
    },
    onNavigateAlias: async (alias) => {
      try {
        const outcome = await resolveAlias(alias, p.workspaceId);
        if (!outcome.ok) return { ok: false, msg: outcome.msg };
        dispatchAliasResult(outcome.result, {
          workspaceId: p.workspaceId,
          navigate,
          onError: (msg) => showToast(msg, 'error'),
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, msg: translateDbError(err) };
      }
    },
    onResetHere: async () => {
      let scope: ResetScope | null = null;
      let nodeLabel: string | undefined;
      if (p.currentFeature === 'info' && p.currentCellId) {
        scope = { kind: 'feature-info', cellId: p.currentCellId };
      } else if (p.currentFeature === 'checklists' && p.currentCellId) {
        scope = { kind: 'feature-checklists', cellId: p.currentCellId };
      } else if (p.currentCellId) {
        scope = { kind: 'cell', cellId: p.currentCellId };
      } else if (p.currentNode) {
        nodeLabel = p.currentNode.label;
        scope =
          p.currentNode.type === 'matrix'
            ? { kind: 'matrix', matrixNodeId: p.currentNode.id }
            : { kind: 'board', boardNodeId: p.currentNode.id };
      }
      if (!scope) {
        showToast(
          'Keine aktive Ebene zum Leeren. Oeffne eine Matrix/Zelle/Feature und versuch es nochmal.',
          'error',
        );
        return false;
      }
      return await runResetScope({
        workspaceId: p.workspaceId,
        scope,
        nodeLabel,
      });
    },
    onResetAll: async (skipConfirm) => {
      const result = await runResetAll({
        workspaceId: p.workspaceId,
        skipConfirm,
      });
      if (result) {
        inputRef?.blur();
        setTimeout(() => navigate(`/w/${p.workspaceId}/n/${result.rootMatrixId}`), 0);
        return true;
      }
      return false;
    },
    onExportWorkspace: (encrypted) =>
      exportWorkspaceWithUi({ workspaceId: p.workspaceId, encrypted }),
    onImportWorkspace: () =>
      importWorkspaceWithUi({
        workspaceId: p.workspaceId,
        currentNode: p.currentNode,
      }),
  };

  async function applyCommand() {
    const raw = query().trim();
    const cmd = parseCommand(raw);
    if (!cmd) {
      triggerFlashErr('Command nicht erkannt.');
      return;
    }
    setBusy(true);
    setError(null);
    const outcome = await executeCommand(cmd, {
      workspaceId: p.workspaceId,
      currentNode: p.currentNode,
      currentCellId: p.currentCellId,
      currentFeature: p.currentFeature,
      ui: uiHooks,
    });
    setBusy(false);

    if (colPick()) {
      // Waehrend ColPick aktiv ist bleibt der Input sichtbar, aber
      // das Dropdown zeigt das Select. Keine success-Meldung — die
      // kommt erst nach ColPick-Confirm.
      return;
    }

    reportOutcome(outcome);
    if (outcome.ok) {
      // Push in History + Input leeren + Flash.
      setHistory(pushHistory(p.workspaceId, { kind: 'command', raw }));
      setQuery('');
      setResults([]);
      setError(null);
      triggerFlashOk();
    } else {
      triggerFlashErr(outcome.message);
    }
  }

  async function applyResult(r: SearchResult) {
    try {
      switch (r.kind) {
        case 'node':
          navigate(`/w/${p.workspaceId}/n/${r.nodeId}`);
          break;
        case 'cell':
          rememberFocus(r.matrixId, r.rowId, r.colId);
          navigate(cellTarget(p.workspaceId, r));
          break;
        case 'card':
          navigate(`/w/${p.workspaceId}/n/${r.boardId}?card=${r.cardId}`);
          break;
        case 'checklist-board':
          navigate(`/w/${p.workspaceId}/n/${r.boardId}`);
          break;
        case 'checklist-cell':
          navigate(`/w/${p.workspaceId}/c/${r.cellId}/checklists`);
          break;
        case 'doc':
          openDocsPopup({ initialDocId: r.docId });
          inputRef?.blur();
          break;
      }
      const raw = query().trim();
      setHistory(pushHistory(p.workspaceId, { kind: 'search', raw }));
      setQuery('');
      setResults([]);
      triggerFlashOk();
    } catch (err) {
      triggerFlashErr(translateDbError(err));
    }
  }

  async function applyAliasEntry(a: AliasEntry) {
    const res = await uiHooks.onNavigateAlias(a.alias);
    if (res.ok) {
      const raw = query().trim();
      setHistory(
        pushHistory(p.workspaceId, {
          kind: raw.startsWith('^') ? 'command' : 'search',
          raw,
        }),
      );
      setQuery('');
      setResults([]);
      triggerFlashOk();
    } else {
      triggerFlashErr(res.msg);
    }
  }

  function applyHistoryEntry(h: HistoryEntry) {
    setQuery(h.raw);
    setHistoryCursor(-1);
    historyDraft = '';
    // Enter direkt nach Apply: wir fokussieren, damit ein erneutes
    // Enter die Aktion ausfuehrt (nicht sofort, weil der User evtl.
    // noch editieren moechte).
    setTimeout(() => inputRef?.focus(), 0);
  }

  function applyVerb(v: (typeof COMMAND_VERBS)[number]) {
    // Bei Klick auf Command-Zeile: Syntax in Input schreiben, damit der
    // User die Argumente ausfuellen kann. Bei Stubs erst nach Enter der
    // "kommt spaeter"-Toast.
    if (v.verb === '<alias>') return;
    const txt = `^${v.syntax}`;
    setQuery(txt);
    setTimeout(() => {
      inputRef?.focus();
      // Cursor ans Ende setzen, sonst kleben Argumente mitten drin.
      try {
        inputRef?.setSelectionRange(txt.length, txt.length);
      } catch {
        /* ignore */
      }
    }, 0);
  }

  function performEnter() {
    if (colPick()) {
      void onColPickConfirm();
      return;
    }
    const items = flatItems();
    const idx = Math.max(0, Math.min(selectedIdx(), items.length - 1));
    const it = items[idx];

    if (it) {
      switch (it.kind) {
        case 'history':
          applyHistoryEntry(it.entry);
          return;
        case 'alias':
          void applyAliasEntry(it.entry);
          return;
        case 'result':
          void applyResult(it.result);
          return;
        case 'verb':
          applyVerb(it.verb);
          return;
      }
    }

    // Kein Item ausgewaehlt — Fallback je nach Mode.
    if (mode() === 'command') {
      void applyCommand();
      return;
    }
    // search / idle mit leerem Query: nichts zu tun.
  }

  async function onColPickConfirm() {
    const state = colPick();
    if (!state) return;
    const col = state.cols[state.selectedIdx];
    if (!col) return;
    setBusy(true);
    try {
      const posRes = await supabase
        .from('task_manifestations')
        .select('position')
        .eq('container_id', col.id)
        .eq('kind', 'kanban')
        .eq('workspace_id', p.workspaceId)
        .order('position', { ascending: false })
        .limit(1);
      if (posRes.error) throw posRes.error;
      const topPos =
        posRes.data && posRes.data.length > 0
          ? (posRes.data[0] as { position: number }).position
          : -1;
      await moveCardToBoard(state.cardId, state.boardId, col.id, topPos + 1);
      showToast(
        `Karte "${state.cardLabel}" in "${state.boardLabel}" / "${col.label}" verschoben.`,
        'success',
      );
      const raw = query().trim();
      setHistory(pushHistory(p.workspaceId, { kind: 'command', raw }));
      setQuery('');
      setResults([]);
      setColPick(null);
      triggerFlashOk();
    } catch (err) {
      triggerFlashErr(translateDbError(err));
      setColPick(null);
    } finally {
      setBusy(false);
    }
  }

  function onInputKeyDown(e: KeyboardEvent) {
    // Alt+Up/Down: History-Cycling.
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const h = history();
      if (h.length === 0) return;
      let cursor = historyCursor();
      if (cursor === -1) {
        historyDraft = query();
        cursor = h.length; // zeigt initial auf "out of range" (= draft)
      }
      if (e.key === 'ArrowUp') {
        cursor = Math.max(0, cursor - 1);
      } else {
        cursor = cursor + 1;
      }
      if (cursor >= h.length) {
        setQuery(historyDraft);
        setHistoryCursor(-1);
      } else {
        setQuery(h[cursor].raw);
        setHistoryCursor(cursor);
      }
      return;
    }

    // Jede andere Taste resettet den History-Cursor.
    if (historyCursor() !== -1 && e.key !== 'Enter' && e.key !== 'Escape') {
      setHistoryCursor(-1);
      historyDraft = '';
    }

    if (e.key === 'ArrowDown') {
      const len = flatItems().length;
      if (len === 0) return;
      e.preventDefault();
      setSelectedIdx((i) => (i + 1) % len);
      return;
    }
    if (e.key === 'ArrowUp') {
      const len = flatItems().length;
      if (len === 0) return;
      e.preventDefault();
      setSelectedIdx((i) => (i - 1 + len) % len);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      performEnter();
      return;
    }
    if (e.key === 'Escape') {
      // Erster ESC: Dropdown schliessen (Input behaelt Content, bleibt
      // fokussiert). Zweiter ESC: Input leeren falls befuellt, sonst
      // blur → Workspace-Global-ESC navigiert eine Ebene hoch.
      if (showDropdown() && focused()) {
        e.preventDefault();
        e.stopPropagation();
        setFocused(false);
        return;
      }
      if (query().length > 0) {
        e.preventDefault();
        e.stopPropagation();
        setQuery('');
        setResults([]);
        setError(null);
        return;
      }
      // Leer + Dropdown schon zu → Blur, globaler Handler uebernimmt.
      inputRef?.blur();
      return;
    }
  }

  function onInputBlur() {
    // 150ms Delay, damit Mouse-Click auf Dropdown-Item den Event
    // noch verarbeiten kann bevor wir es schliessen.
    setTimeout(() => {
      if (document.activeElement !== inputRef) setFocused(false);
    }, 150);
  }

  return (
    <div
      class="header-search-wrap"
      classList={{
        'is-focused': focused(),
        'is-success': flashOk(),
        'is-error': flashErr(),
      }}
    >
      <span class="header-search-icon" aria-hidden="true">
        <Show when={mode() === 'command'} fallback={<Icon name="sparkles" size={15} />}>
          <span class="header-search-caret">^</span>
        </Show>
      </span>
      <input
        ref={inputRef}
        class="header-search-input"
        type="text"
        value={query()}
        placeholder="Suchen, ^Kommando, Alias (f zum Fokussieren)"
        autocomplete="off"
        spellcheck={false}
        onFocus={() => setFocused(true)}
        onBlur={onInputBlur}
        onInput={(e) => {
          const raw = e.currentTarget.value;
          // Keine gefaehrlichen Chars strippen — User will suchen koennen,
          // auch nach Tags oder Anführungszeichen. Bewusst minimal.
          setQuery(raw);
          if (error()) setError(null);
          // Defensive: wenn der User tippt, ist der Input per definitionem
          // fokussiert. Manche Edge-Cases (Navigation hat kurz Focus auf
          // Board/Matrix gezogen, onFocus-Flanke fuer die Rueckkehr ist
          // verloren) koennen focused() stale auf false stehen lassen —
          // das setFocused(true) hier heilt den Fall ohne weitere Logik.
          if (!focused()) setFocused(true);
        }}
        onKeyDown={onInputKeyDown}
      />
      <Show when={busy()}>
        <span class="header-search-busy" aria-hidden="true">
          …
        </span>
      </Show>
      <Show when={showDropdown()}>
        <div
          class="header-search-dropdown"
          // biome-ignore lint/a11y/useSemanticElements: bewusst <div role="listbox"> — Header-Dropdown rendert mehrere Match-Sektionen, kein nativer <select> moeglich.
          role="listbox"
          tabIndex={-1}
        >
          <Switch>
            <Match when={colPick()}>
              {(state) => (
                <div class="header-search-colpick">
                  <div class="header-search-colpick-title">
                    Karte <strong>{state().cardLabel}</strong> in{' '}
                    <strong>{state().boardLabel}</strong> — Spalte:
                  </div>
                  <select
                    ref={colSelectRef}
                    class="header-search-colpick-select"
                    size={Math.min(6, state().cols.length)}
                    value={state().selectedIdx}
                    onChange={(e) => {
                      const idx = Number.parseInt(e.currentTarget.value, 10);
                      const cur = colPick();
                      if (cur) setColPick({ ...cur, selectedIdx: idx });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void onColPickConfirm();
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setColPick(null);
                        setTimeout(() => inputRef?.focus(), 0);
                      }
                    }}
                  >
                    <For each={state().cols}>
                      {(col, idx) => <option value={idx()}>{col.label || '(leer)'}</option>}
                    </For>
                  </select>
                </div>
              )}
            </Match>

            <Match when={mode() === 'idle'}>
              <Show
                when={history().length > 0}
                fallback={
                  <p class="header-search-hint">
                    Suche tippen · ^Kommando · Alt+↑↓ fuer letzte Eingaben
                  </p>
                }
              >
                <div class="header-search-section">
                  <h4 class="header-search-section-head">Letzte Eingaben</h4>
                  <For each={history()}>
                    {(h, i) => {
                      const gIdx = () => i();
                      return (
                        <button
                          type="button"
                          class="header-search-row header-search-row-history"
                          classList={{ 'is-selected': gIdx() === selectedIdx() }}
                          onMouseEnter={() => setSelectedIdx(gIdx())}
                          onClick={() => applyHistoryEntry(h)}
                        >
                          <span class="header-search-row-badge" data-hist-kind={h.kind}>
                            {h.kind === 'command' ? '^' : '⌕'}
                          </span>
                          <span class="header-search-row-text">{h.raw}</span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </Match>

            <Match when={mode() === 'command'}>
              {/* Alias-Matches oben, Haarlinie, dann Commands. */}
              <Show when={aliasMatches().length > 0}>
                <div class="header-search-section">
                  <h4 class="header-search-section-head">Aliase</h4>
                  <For each={aliasMatches()}>
                    {(a) => {
                      const flat = flatItems();
                      const gIdx = () =>
                        flat.findIndex(
                          (it) => it.kind === 'alias' && it.id === `a-${a.kind}-${a.id}`,
                        );
                      return (
                        <button
                          type="button"
                          class="header-search-row header-search-row-alias"
                          classList={{ 'is-selected': gIdx() === selectedIdx() }}
                          onMouseEnter={() => setSelectedIdx(gIdx())}
                          onClick={() => void applyAliasEntry(a)}
                        >
                          <span class="header-search-row-badge" data-alias-kind={a.kind}>
                            {a.subLabel ?? a.kind}
                          </span>
                          <span class="header-search-row-text">
                            <span class="header-search-alias-token">^{a.alias}</span>
                            <Show when={a.label}>
                              <span class="header-search-row-sub"> · {a.label}</span>
                            </Show>
                          </span>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>
              <Show when={aliasMatches().length > 0 && matchingVerbs().length > 0}>
                <hr class="header-search-divider" />
              </Show>
              <Show when={matchingVerbs().length > 0}>
                <div class="header-search-section">
                  <h4 class="header-search-section-head">Commands</h4>
                  <For each={matchingVerbs()}>
                    {(v) => {
                      const flat = flatItems();
                      const gIdx = () =>
                        flat.findIndex((it) => it.kind === 'verb' && it.verb.verb === v.verb);
                      return (
                        <button
                          type="button"
                          class="header-search-row header-search-row-verb"
                          classList={{
                            'is-selected': gIdx() === selectedIdx(),
                            'is-stub': !v.supported,
                          }}
                          onMouseEnter={() => setSelectedIdx(gIdx())}
                          onClick={() => applyVerb(v)}
                          title={v.supported ? 'Syntax einfuegen' : 'Noch nicht ready'}
                        >
                          <code class="header-search-verb-syntax">{v.syntax}</code>
                          <span class="header-search-row-sub">{v.description}</span>
                          <Show when={!v.supported}>
                            <span class="header-search-stub-tag">bald</span>
                          </Show>
                        </button>
                      );
                    }}
                  </For>
                </div>
              </Show>
              <Show when={aliasMatches().length === 0 && matchingVerbs().length === 0}>
                <p class="header-search-hint">
                  Kein Alias, kein Command — Enter fuehrt versuchsweise aus.
                </p>
              </Show>
            </Match>

            <Match when={mode() === 'search'}>
              <Show
                when={groupedResults().length > 0 || aliasMatches().length > 0}
                fallback={
                  <Switch>
                    <Match when={query().trim().length < 2}>
                      <p class="header-search-hint">
                        Mindestens 2 Zeichen fuer Suche — oder Alias-Token direkt.
                      </p>
                    </Match>
                    <Match when={busy()}>
                      <p class="header-search-hint">Suche laeuft…</p>
                    </Match>
                    <Match when>
                      <p class="header-search-hint">Keine Treffer.</p>
                    </Match>
                  </Switch>
                }
              >
                {/* Haupt-Results in Gruppen. */}
                <For each={groupedResults()}>
                  {(g) => (
                    <div class="header-search-section">
                      <h4 class="header-search-section-head">{g.label}</h4>
                      <For each={g.items}>
                        {(r) => {
                          const flat = flatItems();
                          const rid =
                            (
                              r as {
                                nodeId?: string;
                                cellId?: string;
                                cardId?: string;
                                checklistId?: string;
                                docId?: string;
                              }
                            ).nodeId ??
                            (r as { cellId?: string }).cellId ??
                            (r as { cardId?: string }).cardId ??
                            (r as { checklistId?: string }).checklistId ??
                            (r as { docId?: string }).docId ??
                            '';
                          const gIdx = () =>
                            flat.findIndex(
                              (it) => it.kind === 'result' && it.id === `r-${r.kind}-${rid}`,
                            );
                          const excerpt =
                            r.kind === 'card' && (r as { note?: string }).note
                              ? matchExcerpt((r as { note: string }).note, query(), 120)
                              : r.kind === 'doc' && (r as { content?: string }).content
                                ? matchExcerpt((r as { content: string }).content, query(), 120)
                                : null;
                          return (
                            <button
                              type="button"
                              class="header-search-row header-search-row-result"
                              classList={{ 'is-selected': gIdx() === selectedIdx() }}
                              onMouseEnter={() => setSelectedIdx(gIdx())}
                              onClick={() => void applyResult(r)}
                            >
                              <span class="header-search-row-badge" data-type={badgeDataType(r)}>
                                {badgeLabel(r)}
                              </span>
                              <span class="header-search-row-text">
                                <span class="header-search-row-title">
                                  <For each={highlightSubstring(r.title, query())}>
                                    {(part) =>
                                      part.mark ? (
                                        <mark class="sr-mark">{part.text}</mark>
                                      ) : (
                                        <>{part.text}</>
                                      )
                                    }
                                  </For>
                                  <Show when={r.alias}>
                                    <span class="header-search-alias-inline"> ^{r.alias}</span>
                                  </Show>
                                </span>
                                <Show when={excerpt}>
                                  <span class="header-search-row-sub">
                                    <For each={highlightSubstring(excerpt as string, query())}>
                                      {(part) =>
                                        part.mark ? (
                                          <mark class="sr-mark">{part.text}</mark>
                                        ) : (
                                          <>{part.text}</>
                                        )
                                      }
                                    </For>
                                  </span>
                                </Show>
                              </span>
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  )}
                </For>

                {/* Haarlinie vor Alias-Sektion, nur wenn beides existiert. */}
                <Show when={groupedResults().length > 0 && aliasMatches().length > 0}>
                  <hr class="header-search-divider" />
                </Show>

                <Show when={aliasMatches().length > 0}>
                  <div class="header-search-section">
                    <h4 class="header-search-section-head">Aliase</h4>
                    <For each={aliasMatches()}>
                      {(a) => {
                        const flat = flatItems();
                        const gIdx = () =>
                          flat.findIndex(
                            (it) => it.kind === 'alias' && it.id === `a-${a.kind}-${a.id}`,
                          );
                        return (
                          <button
                            type="button"
                            class="header-search-row header-search-row-alias"
                            classList={{ 'is-selected': gIdx() === selectedIdx() }}
                            onMouseEnter={() => setSelectedIdx(gIdx())}
                            onClick={() => void applyAliasEntry(a)}
                          >
                            <span class="header-search-row-badge" data-alias-kind={a.kind}>
                              {a.subLabel ?? a.kind}
                            </span>
                            <span class="header-search-row-text">
                              <span class="header-search-alias-token">^{a.alias}</span>
                              <Show when={a.label}>
                                <span class="header-search-row-sub"> · {a.label}</span>
                              </Show>
                            </span>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </Show>
            </Match>
          </Switch>

          <Show when={error()}>
            <p class="header-search-error" role="alert">
              {error()}
            </p>
          </Show>
        </div>
      </Show>
    </div>
  );
};

export default HeaderSearchBar;
