import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type Component,
} from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import type {
  BoardContent,
  KbCardRow,
  KbColRow,
  LinkRow,
  LinkType,
} from '../lib/types';
import { useEditMode } from '../lib/edit-mode';
import { useBoardUi } from '../lib/board-ui-state';
import {
  addBoardLink,
  addCard,
  addChecklist,
  addKbCol,
  delBoardLink,
  delCard,
  delKbCol,
  InvalidUrlError,
  moveCard,
  renameKbCol,
  restoreBoardLink,
  restoreCard,
  setBoardLinkLabel,
  setBoardLinkType,
  setBoardLinkUrl,
  setCardPosition,
  setKbColColor,
  setKbColPosition,
  toggleCardDone,
} from '../lib/mutations';
import { showToast, showUndoToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';
import CardOverlay from './CardOverlay';
import ChecklistPanel from './ChecklistPanel';

type Props = {
  workspaceId: string;
  boardId: string;
  content: BoardContent | undefined;
  onChanged?: () => void;
};

// Liefert N/M fuer eine Karte — inline-Checkliste oder resolved via ref.
function checklistProgress(
  card: KbCardRow,
  content: BoardContent,
): { done: number; total: number } | null {
  if (card.checklist_ref) {
    const items = content.checklistItems.filter(
      (it) => it.checklist_id === card.checklist_ref,
    );
    if (items.length === 0) return null;
    return { done: items.filter((i) => i.done).length, total: items.length };
  }
  const inline = card.checklist;
  if (Array.isArray(inline) && inline.length > 0) {
    return {
      done: inline.filter((i) => i.done).length,
      total: inline.length,
    };
  }
  return null;
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

// Deadline-State relativ zu heute:
//   overdue  = strikt vor heute
//   today    = heute
//   soon     = innerhalb der naechsten 3 Tage (heute exklusiv)
//   future   = spaeter
// Donecards bekommen keinen State — "erledigt" ueberschreibt
// das Dringlichkeitssignal.
function deadlineState(
  iso: string | null,
  done: boolean,
): 'overdue' | 'today' | 'soon' | 'future' | null {
  if (!iso || done) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays <= 3) return 'soon';
  return 'future';
}

// Comparator-Factory fuer Card-Sort. In allen Modi sortieren wir
// done-Karten ans Ende (erledigt = weniger relevant). Null-Werte
// (kein Deadline, keine Prio) landen ebenfalls hinten.
function sortComparator(
  mode: 'deadline' | 'priority' | 'name',
): (a: KbCardRow, b: KbCardRow) => number {
  return (a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (mode === 'deadline') {
      const aHas = !!a.deadline;
      const bHas = !!b.deadline;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && a.deadline !== b.deadline) {
        return a.deadline! < b.deadline! ? -1 : 1;
      }
    } else if (mode === 'priority') {
      const ap = a.priority;
      const bp = b.priority;
      const aHas = ap != null;
      const bHas = bp != null;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && ap !== bp) return (ap as number) - (bp as number);
    } else if (mode === 'name') {
      const cmp = a.name.localeCompare(b.name);
      if (cmp !== 0) return cmp;
    }
    // Tiebreaker: bestehende Position, stabil.
    return a.position - b.position;
  };
}

const BoardView: Component<Props> = (p) => {
  const editMode = useEditMode();
  const boardUi = useBoardUi(p.boardId);

  // Drag-State: welche Card wird gerade gezogen, welcher Col-Container
  // ist gerade der Hover-Drop-Target. Keine DOM-Klasse anfassen —
  // reaktive Signale treiben classList.
  const [draggingCardId, setDraggingCardId] = createSignal<string | null>(null);
  const [dragOverColId, setDragOverColId] = createSignal<string | null>(null);

  function onCardDragStart(card: KbCardRow, e: DragEvent) {
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/matrix-card-id', card.id);
    // Fallback fuer Browser die den custom-type ignorieren.
    e.dataTransfer.setData('text/plain', card.id);
    setDraggingCardId(card.id);
  }

  function onCardDragEnd() {
    setDraggingCardId(null);
    setDragOverColId(null);
  }

  function onColDragOver(colId: string, e: DragEvent) {
    // Nur wenn eine Card gezogen wird (draggingCardId gesetzt).
    // Der dataTransfer-Typ-Check ist unzuverlaessig im dragover-Event
    // (Firefox/Chrome-Diff), deshalb verlassen wir uns auf das Signal.
    if (!draggingCardId()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dragOverColId() !== colId) setDragOverColId(colId);
  }

  function onColDragLeave(colId: string, e: DragEvent) {
    // Nur wenn wir wirklich den Container verlassen (nicht ein Child
    // betreten). relatedTarget ist das neu-fokussierte Element;
    // wenn es ausserhalb des aktuellen Col-Divs liegt, leaven.
    const related = e.relatedTarget as Node | null;
    const current = e.currentTarget as HTMLElement;
    if (related && current.contains(related)) return;
    if (dragOverColId() === colId) setDragOverColId(null);
  }

  async function onColDrop(colId: string, e: DragEvent) {
    const cardId =
      e.dataTransfer?.getData('text/matrix-card-id') ||
      e.dataTransfer?.getData('text/plain') ||
      draggingCardId();
    setDraggingCardId(null);
    setDragOverColId(null);
    if (!cardId) return;
    e.preventDefault();
    const card = (p.content?.kbCards ?? []).find((c) => c.id === cardId);
    if (!card || card.col_id === colId) return;
    await wrap(() =>
      moveCard({
        cardId: card.id,
        boardId: p.boardId,
        workspaceId: p.workspaceId,
        toColId: colId,
      }),
    );
  }
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedCardId, setSelectedCardId] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  // Deep-Link ?card=<id> → CardOverlay direkt oeffnen (Quicknav).
  // Erst wenn content vorhanden ist und die Karte wirklich existiert.
  // Query-Param danach aufraeumen, damit ein Refresh die Karte nicht
  // erneut oeffnet und die URL sauber bleibt.
  createEffect(() => {
    const content = p.content;
    if (!content) return;
    const want = searchParams.card;
    if (!want || typeof want !== 'string') return;
    const exists = content.kbCards.some((c) => c.id === want);
    if (!exists) return;
    setSelectedCardId(want);
    setSearchParams({ card: undefined }, { replace: true });
  });

  const [showArchived, setShowArchived] = createSignal(false);
  const [filter, setFilter] = createSignal('');
  let filterInputRef: HTMLInputElement | undefined;

  const visibleCols = createMemo<KbColRow[]>(() => p.content?.kbCols ?? []);
  // Archiv-Filter: per Default ausgeblendet. Toggle-Button im Board-Head
  // setzt showArchived — dann kommen die archivierten Karten mit
  // kb-card-archived-Klasse sichtbar rein.
  const activeCards = createMemo<KbCardRow[]>(() => {
    const all = showArchived()
      ? p.content?.kbCards ?? []
      : (p.content?.kbCards ?? []).filter((c) => !c.archived);
    const q = filter().trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      if (c.alias && c.alias.toLowerCase().includes(q)) return true;
      if ((c.tags ?? []).some((t) => t.toLowerCase().includes(q))) return true;
      if ((c.who ?? []).some((w) => w.toLowerCase().includes(q))) return true;
      return false;
    });
  });
  const archivedCount = createMemo(
    () => (p.content?.kbCards ?? []).filter((c) => c.archived).length,
  );

  const cardsByCol = createMemo(() => {
    const map = new Map<string, KbCardRow[]>();
    for (const c of activeCards()) {
      const arr = map.get(c.col_id);
      if (arr) arr.push(c);
      else map.set(c.col_id, [c]);
    }
    // Sort pro Spalte. Position-Order kommt schon sortiert aus der
    // Query — nichts zu tun im 'manual'-Modus.
    const mode = boardUi.sort();
    if (mode !== 'manual') {
      const cmp = sortComparator(mode);
      for (const list of map.values()) list.sort(cmp);
    }
    return map;
  });

  // Treffer-Counter fuer den Filter: ueber cardsByCol zaehlen, damit
  // die Zahl genau dem entspricht, was gerendert wird.
  const totalCardsShown = createMemo(() =>
    Array.from(cardsByCol().values()).reduce((n, l) => n + l.length, 0),
  );
  const totalCardsAll = createMemo(
    () =>
      (showArchived()
        ? p.content?.kbCards ?? []
        : (p.content?.kbCards ?? []).filter((c) => !c.archived)
      ).length,
  );

  const selectedCard = createMemo(() => {
    const id = selectedCardId();
    if (!id) return undefined;
    return (p.content?.kbCards ?? []).find((c) => c.id === id);
  });

  async function wrap<T>(fn: () => Promise<T>, successMsg?: string) {
    if (busy()) return;
    setBusy(true);
    try {
      await fn();
      if (successMsg) showToast(successMsg, 'success');
      p.onChanged?.();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onAddCol() {
    await wrap(() =>
      addKbCol({ workspaceId: p.workspaceId, boardId: p.boardId }),
    );
  }

  async function onRenameCol(col: KbColRow, newLabel: string) {
    if (newLabel === col.label) return;
    await wrap(() => renameKbCol(col.id, newLabel));
  }

  async function onColorCol(col: KbColRow, color: string | null) {
    if ((color ?? null) === (col.color ?? null)) return;
    await wrap(() => setKbColColor(col.id, color));
  }

  async function onMoveCol(col: KbColRow, direction: 'left' | 'right') {
    const list = visibleCols();
    const idx = list.findIndex((c) => c.id === col.id);
    if (idx < 0) return;
    const neighbourIdx = direction === 'left' ? idx - 1 : idx + 1;
    if (neighbourIdx < 0 || neighbourIdx >= list.length) return;
    const neighbour = list[neighbourIdx];
    await wrap(async () => {
      await setKbColPosition(col.id, neighbour.position);
      await setKbColPosition(neighbour.id, col.position);
    });
  }

  async function onDelCol(col: KbColRow) {
    const count = (cardsByCol().get(col.id) ?? []).length;
    if (count > 0) {
      if (
        !window.confirm(
          `Spalte "${col.label || '(leer)'}" loeschen? Enthaelt ${count} Karte(n) — werden mitgeloescht.`,
        )
      ) {
        return;
      }
    }
    await wrap(() => delKbCol(col.id), 'Spalte geloescht.');
  }

  async function onAddCard(col: KbColRow) {
    await wrap(() =>
      addCard({
        workspaceId: p.workspaceId,
        boardId: p.boardId,
        colId: col.id,
      }),
    );
  }

  async function onDelCard(card: KbCardRow) {
    if (!window.confirm(`Karte "${card.name || '(ohne Titel)'}" loeschen?`)) {
      return;
    }
    const snap: KbCardRow = { ...card };
    await wrap(() => delCard(card.id));
    showUndoToast(`Karte "${snap.name || '(ohne Titel)'}" geloescht.`, () => {
      void (async () => {
        try {
          await restoreCard(snap);
          showToast('Karte wiederhergestellt.', 'success');
          p.onChanged?.();
        } catch (err) {
          showToast(translateDbError(err), 'error');
        }
      })();
    });
  }

  async function onMoveCard(card: KbCardRow, toColId: string) {
    if (toColId === card.col_id) return;
    await wrap(() =>
      moveCard({
        cardId: card.id,
        boardId: p.boardId,
        workspaceId: p.workspaceId,
        toColId,
      }),
    );
  }

  // Within-column-Reorder: Swap mit direktem Listen-Nachbarn. Positionen
  // sind pro Spalte eindeutig nicht garantiert, aber auch nicht per UNIQUE
  // erzwungen — Swap bleibt also safe. cardsByCol() ist bereits nach
  // position sortiert (fetchBoardContent ordnet kb_cards aufsteigend).
  async function onMoveCardWithin(card: KbCardRow, direction: 'up' | 'down') {
    const list = cardsByCol().get(card.col_id) ?? [];
    const idx = list.findIndex((c) => c.id === card.id);
    if (idx < 0) return;
    const neighbourIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (neighbourIdx < 0 || neighbourIdx >= list.length) return;
    const neighbour = list[neighbourIdx];
    await wrap(async () => {
      await setCardPosition(card.id, neighbour.position);
      await setCardPosition(neighbour.id, card.position);
    });
  }

  async function onAddChecklist() {
    await wrap(() =>
      addChecklist({ workspaceId: p.workspaceId, boardId: p.boardId }),
    );
  }

  // Board-Links: Add via Prompt (URL dann Label). Invalid-URL liefert
  // eine freundliche Fehler-Toast, Sanitization greift im
  // Mutations-Layer.
  async function onAddLink() {
    const rawUrl = window.prompt(
      'URL oder E-Mail-Adresse:',
      'https://',
    );
    if (!rawUrl) return;
    const raw = rawUrl.trim();
    if (!raw) return;
    // Simple Heuristik: enthaelt @ ohne :// → wohl eine Mail.
    const looksLikeMail = raw.includes('@') && !/^[a-z]+:\/\//i.test(raw);
    const type: LinkType = looksLikeMail ? 'mail' : 'url';
    const label = window.prompt('Anzeigetext (optional):', '') ?? '';
    try {
      await addBoardLink({
        workspaceId: p.workspaceId,
        boardId: p.boardId,
        type,
        label,
        url: raw,
      });
      p.onChanged?.();
    } catch (err) {
      if (err instanceof InvalidUrlError) {
        showToast('URL ist ungueltig.', 'error');
      } else {
        showToast(translateDbError(err), 'error');
      }
    }
  }

  async function onDelLink(link: LinkRow) {
    if (
      !window.confirm(
        `Link "${link.label || link.url}" loeschen?`,
      )
    ) {
      return;
    }
    const snap: LinkRow = { ...link };
    await wrap(() => delBoardLink(link.id));
    showUndoToast(`Link "${snap.label || snap.url}" geloescht.`, () => {
      void (async () => {
        try {
          await restoreBoardLink(snap);
          showToast('Link wiederhergestellt.', 'success');
          p.onChanged?.();
        } catch (err) {
          showToast(translateDbError(err), 'error');
        }
      })();
    });
  }

  async function onRenameLink(link: LinkRow, label: string) {
    if (label.trim() === link.label) return;
    await wrap(() => setBoardLinkLabel(link.id, label));
  }

  async function onLinkUrl(link: LinkRow, url: string) {
    if (url.trim() === link.url) return;
    try {
      await setBoardLinkUrl(link.id, url);
      p.onChanged?.();
    } catch (err) {
      if (err instanceof InvalidUrlError) {
        showToast('URL ist ungueltig.', 'error');
      } else {
        showToast(translateDbError(err), 'error');
      }
    }
  }

  async function onLinkType(link: LinkRow, type: LinkType) {
    if (type === link.type) return;
    await wrap(() => setBoardLinkType(link.id, type));
  }

  async function onToggleCardDone(card: KbCardRow, done: boolean) {
    if (done === card.done) return;
    await wrap(() => toggleCardDone(card.id, done));
  }

  return (
    <Show when={p.content} fallback={<p class="hint">Lade Board…</p>}>
      {(_) => (
        <div class="board">
          {/* Board-Header: Filter-Suche + Archiv-Toggle. Immer sichtbar,
              sobald das Board Karten hat — Suche sparen sich leere
              Boards. */}
          <Show when={(p.content!.kbCards ?? []).length > 0}>
            <div class="board-header-bar">
              <input
                ref={filterInputRef}
                type="text"
                class="board-filter-input"
                placeholder="Suche (Name, Alias, #Tag, @Person)…"
                value={filter()}
                onInput={(e) => setFilter(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && filter()) {
                    e.preventDefault();
                    e.stopPropagation();
                    setFilter('');
                  }
                }}
              />
              <Show when={filter()}>
                <span class="board-filter-count hint">
                  {totalCardsShown()}/{totalCardsAll()}
                </span>
                <button
                  type="button"
                  class="board-filter-clear"
                  onClick={() => {
                    setFilter('');
                    filterInputRef?.focus();
                  }}
                  title="Filter loeschen"
                  aria-label="Filter loeschen"
                >
                  ✕
                </button>
              </Show>
              <select
                class="board-sort-select"
                value={boardUi.sort()}
                title="Sortierung"
                onChange={(e) =>
                  boardUi.setSort(
                    (e.currentTarget as HTMLSelectElement).value as
                      | 'manual'
                      | 'deadline'
                      | 'priority'
                      | 'name',
                  )
                }
              >
                <option value="manual">Manuell</option>
                <option value="deadline">Deadline</option>
                <option value="priority">Prioritaet</option>
                <option value="name">Name</option>
              </select>
              <Show when={archivedCount() > 0}>
                <button
                  type="button"
                  class="btn-subtle board-archive-toggle"
                  classList={{ active: showArchived() }}
                  onClick={() => setShowArchived((v) => !v)}
                  aria-pressed={showArchived()}
                  title={
                    showArchived()
                      ? 'Archivierte Karten ausblenden'
                      : 'Archivierte Karten anzeigen'
                  }
                >
                  {showArchived() ? 'Archiv: an' : 'Archiv: aus'}{' '}
                  <span class="hint">({archivedCount()})</span>
                </button>
              </Show>
            </div>
          </Show>

          {/* Links-Leiste. Im View-Mode Chips als <a>, im Edit-Mode
              Inline-Edit: Typ, Label, URL + Delete. */}
          <Show when={(p.content!.links ?? []).length > 0 || editMode()}>
            <div class="board-links">
              <For each={p.content!.links ?? []}>
                {(link) => (
                  <Show
                    when={editMode()}
                    fallback={
                      <a
                        class="board-link-chip"
                        data-link-type={link.type}
                        href={
                          link.type === 'mail' ? `mailto:${link.url}` : link.url
                        }
                        target={link.type === 'url' ? '_blank' : undefined}
                        rel={
                          link.type === 'url' ? 'noopener noreferrer' : undefined
                        }
                        title={link.url}
                      >
                        <span class="link-ico">
                          {link.type === 'mail' ? '✉' : '↗'}
                        </span>
                        <span>{link.label || link.url}</span>
                        <Show when={link.alias}>
                          <span class="link-alias">^{link.alias}</span>
                        </Show>
                      </a>
                    }
                  >
                    <div
                      class="board-link-edit"
                      data-link-type={link.type}
                    >
                      <select
                        class="board-link-type"
                        value={link.type}
                        title="Link-Typ"
                        onChange={(e) =>
                          onLinkType(
                            link,
                            (e.currentTarget as HTMLSelectElement)
                              .value as LinkType,
                          )
                        }
                      >
                        <option value="url">URL</option>
                        <option value="mail">Mail</option>
                      </select>
                      <input
                        class="board-link-label"
                        type="text"
                        value={link.label}
                        placeholder="Label"
                        onBlur={(e) =>
                          onRenameLink(link, e.currentTarget.value)
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                      />
                      <input
                        class="board-link-url"
                        type="text"
                        value={link.url}
                        placeholder={
                          link.type === 'mail'
                            ? 'name@example.com'
                            : 'https://...'
                        }
                        onBlur={(e) => onLinkUrl(link, e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                      />
                      <button
                        type="button"
                        class="mx-del-btn"
                        title="Link loeschen"
                        aria-label="Link loeschen"
                        onClick={() => onDelLink(link)}
                        disabled={busy()}
                      >
                        ✕
                      </button>
                    </div>
                  </Show>
                )}
              </For>
              <Show when={editMode()}>
                <button
                  type="button"
                  class="btn-subtle board-link-add-btn"
                  onClick={onAddLink}
                  disabled={busy()}
                >
                  + Link
                </button>
              </Show>
            </div>
          </Show>

          {/* Kanban-Spalten */}
          <Show
            when={visibleCols().length > 0}
            fallback={
              <div class="board-empty">
                <p class="hint">
                  Board ohne Spalten.
                  <Show when={editMode()}>
                    {' '}
                    + Spalte, um zu starten.
                  </Show>
                </p>
                <Show when={editMode()}>
                  <button
                    type="button"
                    class="btn-subtle"
                    onClick={onAddCol}
                    disabled={busy()}
                  >
                    + Spalte
                  </button>
                </Show>
              </div>
            }
          >
            <div class="board-cols">
              <For each={visibleCols()}>
                {(col, colIdx) => {
                  const list = () => cardsByCol().get(col.id) ?? [];
                  const collapsed = () => boardUi.isCollapsed(col.id);
                  return (
                    <div
                      class="kb-col"
                      classList={{
                        'kb-col-collapsed': collapsed(),
                        'kb-col-drag-over': dragOverColId() === col.id,
                      }}
                      style={col.color ? { '--kb-col-color': col.color } : undefined}
                      data-has-color={col.color ? 'yes' : 'no'}
                      onDragOver={(e) => onColDragOver(col.id, e)}
                      onDragLeave={(e) => onColDragLeave(col.id, e)}
                      onDrop={(e) => onColDrop(col.id, e)}
                    >
                      <header
                        class="kb-col-head"
                        classList={{ 'mx-editable': editMode() }}
                      >
                        <button
                          type="button"
                          class="kb-col-collapse-btn"
                          title={
                            collapsed() ? 'Spalte aufklappen' : 'Spalte kollabieren'
                          }
                          aria-label={
                            collapsed() ? 'Spalte aufklappen' : 'Spalte kollabieren'
                          }
                          aria-expanded={!collapsed()}
                          onClick={() => boardUi.toggleCol(col.id)}
                        >
                          {collapsed() ? '▸' : '▾'}
                        </button>
                        <input
                          class="mx-head-input"
                          type="text"
                          value={col.label}
                          placeholder="(Spalte)"
                          readOnly={!editMode()}
                          tabIndex={editMode() ? 0 : -1}
                          onBlur={(e) => {
                            if (!editMode()) return;
                            onRenameCol(col, e.currentTarget.value.trim());
                          }}
                          onKeyDown={(e) => {
                            if (!editMode()) return;
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              (e.currentTarget as HTMLInputElement).blur();
                            }
                          }}
                        />
                        <input
                          type="color"
                          class="kb-col-color-picker"
                          value={col.color ?? '#888888'}
                          title="Spalten-Farbe"
                          disabled={!editMode()}
                          tabIndex={editMode() ? 0 : -1}
                          onChange={(e) => onColorCol(col, e.currentTarget.value)}
                        />
                        <button
                          type="button"
                          class="mx-del-btn"
                          title="Farbe entfernen"
                          aria-label="Farbe entfernen"
                          tabIndex={editMode() && col.color ? 0 : -1}
                          onClick={() => onColorCol(col, null)}
                          disabled={!editMode() || !col.color}
                        >
                          ○
                        </button>
                        <button
                          type="button"
                          class="mx-move-btn"
                          title="Spalte nach links"
                          aria-label="Spalte nach links"
                          tabIndex={editMode() ? 0 : -1}
                          onClick={() => onMoveCol(col, 'left')}
                          disabled={busy() || !editMode() || colIdx() === 0}
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          class="mx-move-btn"
                          title="Spalte nach rechts"
                          aria-label="Spalte nach rechts"
                          tabIndex={editMode() ? 0 : -1}
                          onClick={() => onMoveCol(col, 'right')}
                          disabled={busy() || !editMode() || colIdx() === visibleCols().length - 1}
                        >
                          ›
                        </button>
                        <button
                          type="button"
                          class="mx-del-btn"
                          title="Spalte loeschen"
                          aria-label="Spalte loeschen"
                          tabIndex={editMode() ? 0 : -1}
                          onClick={() => onDelCol(col)}
                          disabled={busy() || !editMode()}
                        >
                          ✕
                        </button>
                        <span class="kb-col-count">{list().length}</span>
                      </header>

                      <Show
                        when={!collapsed() && list().length > 0}
                        fallback={
                          <Show when={!collapsed()}>
                            <p class="kb-col-empty hint">leer</p>
                          </Show>
                        }
                      >
                        <ul class="kb-cards">
                          <For each={list()}>
                            {(card, cardIdx) => {
                              const progress = createMemo(() =>
                                checklistProgress(card, p.content!),
                              );
                              const deadline = fmtDate(card.deadline);
                              return (
                                <li
                                  class="kb-card"
                                  classList={{
                                    'kb-card-done': card.done,
                                    'kb-card-archived': card.archived,
                                    'kb-card-dragging':
                                      draggingCardId() === card.id,
                                  }}
                                  role="button"
                                  tabIndex={0}
                                  draggable={true}
                                  onDragStart={(e) => onCardDragStart(card, e)}
                                  onDragEnd={onCardDragEnd}
                                  onClick={() => setSelectedCardId(card.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setSelectedCardId(card.id);
                                    }
                                  }}
                                >
                                  <div class="kb-card-name">
                                    <input
                                      type="checkbox"
                                      class="kb-card-done-checkbox"
                                      checked={card.done}
                                      aria-label="Erledigt"
                                      title={card.done ? 'Wieder offen' : 'Als erledigt markieren'}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) => {
                                        onToggleCardDone(card, e.currentTarget.checked);
                                      }}
                                    />
                                    <span class="kb-card-title-text">
                                      {card.name || '(ohne Titel)'}
                                    </span>
                                    <Show when={card.alias}>
                                      <span class="kb-card-alias">
                                        ^{card.alias}
                                      </span>
                                    </Show>
                                  </div>

                                  <Show
                                    when={
                                      (card.tags?.length ?? 0) > 0 ||
                                      (card.who?.length ?? 0) > 0 ||
                                      deadline ||
                                      card.priority != null ||
                                      card.recur != null ||
                                      progress()
                                    }
                                  >
                                    <div class="kb-card-meta">
                                      <For each={card.tags ?? []}>
                                        {(t) => <span class="kb-tag">#{t}</span>}
                                      </For>
                                      <For each={card.who ?? []}>
                                        {(w) => <span class="kb-who">@{w}</span>}
                                      </For>
                                      <Show when={deadline}>
                                        <span
                                          class="kb-deadline"
                                          data-deadline-state={
                                            deadlineState(card.deadline, card.done) ?? 'none'
                                          }
                                        >
                                          ⏱ {deadline}
                                        </span>
                                      </Show>
                                      <Show when={card.priority != null}>
                                        <span class="kb-prio">
                                          P{card.priority}
                                        </span>
                                      </Show>
                                      <Show when={card.recur != null}>
                                        <span class="kb-recur">↻</span>
                                      </Show>
                                      <Show when={progress()}>
                                        <span class="kb-cl-progress">
                                          ✓ {progress()!.done}/
                                          {progress()!.total}
                                        </span>
                                      </Show>
                                    </div>
                                  </Show>

                                  {/* Karten-Aktionen (Move/Del) immer sichtbar —
                                      Karten sind keine strukturellen Daten. */}
                                  <div
                                    class="kb-card-edit-bar"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      class="mx-move-btn"
                                      title={
                                        boardUi.sort() !== 'manual'
                                          ? 'Sortierung aktiv — Reihenfolge automatisch'
                                          : 'Karte nach oben'
                                      }
                                      aria-label="Karte nach oben"
                                      onClick={() => onMoveCardWithin(card, 'up')}
                                      disabled={
                                        busy() ||
                                        cardIdx() === 0 ||
                                        boardUi.sort() !== 'manual'
                                      }
                                    >
                                      ↑
                                    </button>
                                    <button
                                      type="button"
                                      class="mx-move-btn"
                                      title={
                                        boardUi.sort() !== 'manual'
                                          ? 'Sortierung aktiv — Reihenfolge automatisch'
                                          : 'Karte nach unten'
                                      }
                                      aria-label="Karte nach unten"
                                      onClick={() => onMoveCardWithin(card, 'down')}
                                      disabled={
                                        busy() ||
                                        cardIdx() === list().length - 1 ||
                                        boardUi.sort() !== 'manual'
                                      }
                                    >
                                      ↓
                                    </button>
                                    <select
                                      class="kb-card-move"
                                      value={card.col_id}
                                      title="In andere Spalte verschieben"
                                      onChange={(e) =>
                                        onMoveCard(
                                          card,
                                          (e.currentTarget as HTMLSelectElement).value,
                                        )
                                      }
                                    >
                                      <For each={visibleCols()}>
                                        {(opt) => (
                                          <option value={opt.id}>
                                            → {opt.label || '(Spalte)'}
                                          </option>
                                        )}
                                      </For>
                                    </select>
                                    <button
                                      type="button"
                                      class="mx-del-btn"
                                      title="Karte loeschen"
                                      aria-label="Karte loeschen"
                                      onClick={() => onDelCard(card)}
                                      disabled={busy()}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                </li>
                              );
                            }}
                          </For>
                        </ul>
                      </Show>

                      {/* "+ Karte" immer verfuegbar — Karten sind keine Struktur. */}
                      <Show when={!collapsed()}>
                        <button
                          type="button"
                          class="kb-card-add-btn"
                          onClick={() => onAddCard(col)}
                          disabled={busy()}
                          title="Karte hinzufuegen"
                        >
                          + Karte
                        </button>
                      </Show>
                    </div>
                  );
                }}
              </For>

              {/* Letzte Spalte im Edit-Mode: "+ Spalte" */}
              <Show when={editMode()}>
                <div class="kb-col kb-col-add">
                  <button
                    type="button"
                    class="kb-col-add-btn"
                    onClick={onAddCol}
                    disabled={busy()}
                    title="Spalte hinzufuegen"
                  >
                    + Spalte
                  </button>
                </div>
              </Show>
            </div>
          </Show>

          {/* Standalone-Checklisten. Section wird gerendert, sobald
              Listen da sind ODER der Edit-Mode aktiv ist (damit der
              "+ Checkliste"-Button erreichbar bleibt). */}
          <Show
            when={
              (p.content!.checklists ?? []).length > 0 || editMode()
            }
          >
            <section class="board-checklists">
              <h3 class="board-section-title">Checklisten</h3>
              <Show when={(p.content!.checklists ?? []).length > 0}>
                <ul class="cl-list">
                  <For each={p.content!.checklists}>
                    {(cl) => {
                      const items = () =>
                        p.content!.checklistItems
                          .filter((it) => it.checklist_id === cl.id)
                          .sort((a, b) => a.position - b.position);
                      return (
                        <ChecklistPanel
                          checklist={cl}
                          items={items()}
                          workspaceId={p.workspaceId}
                          onChanged={() => p.onChanged?.()}
                        />
                      );
                    }}
                  </For>
                </ul>
              </Show>
              <Show when={editMode()}>
                <button
                  type="button"
                  class="btn-subtle cl-add-btn"
                  onClick={onAddChecklist}
                  disabled={busy()}
                >
                  + Checkliste
                </button>
              </Show>
            </section>
          </Show>

          <Show when={selectedCard()}>
            <CardOverlay
              card={selectedCard()!}
              content={p.content!}
              onClose={() => setSelectedCardId(null)}
              onChanged={() => p.onChanged?.()}
            />
          </Show>
        </div>
      )}
    </Show>
  );
};

export default BoardView;
