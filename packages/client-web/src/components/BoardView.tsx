import {
  For,
  Show,
  createMemo,
  createSignal,
  type Component,
} from 'solid-js';
import type {
  BoardContent,
  KbCardRow,
  KbColRow,
} from '../lib/types';
import { useEditMode } from '../lib/edit-mode';
import {
  addCard,
  addChecklist,
  addKbCol,
  delCard,
  delKbCol,
  moveCard,
  renameKbCol,
  setKbColColor,
} from '../lib/mutations';
import { showToast } from '../lib/toasts';
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

const BoardView: Component<Props> = (p) => {
  const editMode = useEditMode();
  const [selectedCardId, setSelectedCardId] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  const visibleCols = createMemo<KbColRow[]>(() => p.content?.kbCols ?? []);
  const activeCards = createMemo<KbCardRow[]>(() =>
    (p.content?.kbCards ?? []).filter((c) => !c.archived),
  );

  const cardsByCol = createMemo(() => {
    const map = new Map<string, KbCardRow[]>();
    for (const c of activeCards()) {
      const arr = map.get(c.col_id);
      if (arr) arr.push(c);
      else map.set(c.col_id, [c]);
    }
    return map;
  });

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
    await wrap(() => delCard(card.id), 'Karte geloescht.');
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

  async function onAddChecklist() {
    await wrap(() =>
      addChecklist({ workspaceId: p.workspaceId, boardId: p.boardId }),
    );
  }

  return (
    <Show when={p.content} fallback={<p class="hint">Lade Board…</p>}>
      {(_) => (
        <div class="board">
          {/* Links-Leiste */}
          <Show when={(p.content!.links ?? []).length > 0}>
            <div class="board-links">
              <For each={p.content!.links}>
                {(link) => (
                  <a
                    class="board-link-chip"
                    data-link-type={link.type}
                    href={link.type === 'mail' ? `mailto:${link.url}` : link.url}
                    target={link.type === 'url' ? '_blank' : undefined}
                    rel={link.type === 'url' ? 'noopener noreferrer' : undefined}
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
                )}
              </For>
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
                {(col) => {
                  const list = () => cardsByCol().get(col.id) ?? [];
                  return (
                    <div
                      class="kb-col"
                      style={col.color ? { '--kb-col-color': col.color } : undefined}
                      data-has-color={col.color ? 'yes' : 'no'}
                    >
                      <header class="kb-col-head" classList={{ 'mx-editable': editMode() }}>
                        <Show
                          when={editMode()}
                          fallback={
                            <span class="kb-col-label">
                              {col.label || '(Spalte)'}
                            </span>
                          }
                        >
                          <input
                            class="mx-head-input"
                            type="text"
                            value={col.label}
                            placeholder="(Spalte)"
                            onBlur={(e) =>
                              onRenameCol(col, e.currentTarget.value.trim())
                            }
                            onKeyDown={(e) => {
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
                            onChange={(e) =>
                              onColorCol(col, e.currentTarget.value)
                            }
                          />
                          <Show when={col.color}>
                            <button
                              type="button"
                              class="mx-del-btn"
                              title="Farbe entfernen"
                              aria-label="Farbe entfernen"
                              onClick={() => onColorCol(col, null)}
                            >
                              ○
                            </button>
                          </Show>
                          <button
                            type="button"
                            class="mx-del-btn"
                            title="Spalte loeschen"
                            aria-label="Spalte loeschen"
                            onClick={() => onDelCol(col)}
                            disabled={busy()}
                          >
                            ✕
                          </button>
                        </Show>
                        <Show when={!editMode()}>
                          <span class="kb-col-count">{list().length}</span>
                        </Show>
                      </header>

                      <Show
                        when={list().length > 0}
                        fallback={<p class="kb-col-empty hint">leer</p>}
                      >
                        <ul class="kb-cards">
                          <For each={list()}>
                            {(card) => {
                              const progress = createMemo(() =>
                                checklistProgress(card, p.content!),
                              );
                              const deadline = fmtDate(card.deadline);
                              return (
                                <li
                                  class="kb-card"
                                  classList={{ 'kb-card-done': card.done }}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => setSelectedCardId(card.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setSelectedCardId(card.id);
                                    }
                                  }}
                                >
                                  <div class="kb-card-name">
                                    <Show when={card.done}>
                                      <span class="kb-done-mark" aria-hidden>
                                        ✓
                                      </span>
                                    </Show>
                                    {card.name || '(ohne Titel)'}
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
                                        <span class="kb-deadline">
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
                      <button
                        type="button"
                        class="kb-card-add-btn"
                        onClick={() => onAddCard(col)}
                        disabled={busy()}
                        title="Karte hinzufuegen"
                      >
                        + Karte
                      </button>
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
