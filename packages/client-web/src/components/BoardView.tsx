import { For, Show, createMemo, createSignal, type Component } from 'solid-js';
import type {
  BoardContent,
  KbCardRow,
  KbColRow,
} from '../lib/types';
import CardOverlay from './CardOverlay';

type Props = {
  workspaceId: string;
  boardId: string;
  content: BoardContent | undefined;
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
  // ISO date-only (YYYY-MM-DD); keep locale-agnostic but readable.
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

const BoardView: Component<Props> = (p) => {
  const [selectedCardId, setSelectedCardId] = createSignal<string | null>(null);

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

  return (
    <Show
      when={p.content}
      fallback={<p class="hint">Lade Board…</p>}
    >
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
                  Board ohne Spalten — Kanban-Konfiguration kommt ab 0e.
                </p>
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
                      <header class="kb-col-head">
                        <span class="kb-col-label">
                          {col.label || '(Spalte)'}
                        </span>
                        <span class="kb-col-count">{list().length}</span>
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
                                </li>
                              );
                            }}
                          </For>
                        </ul>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>

          {/* Standalone-Checklisten */}
          <Show when={(p.content!.checklists ?? []).length > 0}>
            <section class="board-checklists">
              <h3 class="board-section-title">Checklisten</h3>
              <ul class="cl-list">
                <For each={p.content!.checklists}>
                  {(cl) => {
                    const items = () =>
                      p.content!.checklistItems.filter(
                        (it) => it.checklist_id === cl.id,
                      );
                    const done = () => items().filter((i) => i.done).length;
                    return (
                      <li class="cl-item">
                        <header class="cl-head">
                          <span class="cl-label">{cl.label || '(Liste)'}</span>
                          <Show when={cl.alias}>
                            <span class="cl-alias">^{cl.alias}</span>
                          </Show>
                          <span class="cl-progress">
                            {done()}/{items().length}
                          </span>
                          <Show when={cl.recur}>
                            <span class="cl-recur" title="wiederkehrend">
                              ↻
                            </span>
                          </Show>
                        </header>
                        <Show
                          when={items().length > 0}
                          fallback={<p class="hint cl-empty">leer</p>}
                        >
                          <ul class="cl-items">
                            <For each={items()}>
                              {(it) => (
                                <li
                                  class="cl-it"
                                  classList={{ 'cl-it-done': it.done }}
                                  style={{ '--cl-level': it.level }}
                                >
                                  <span class="cl-checkbox" aria-hidden>
                                    {it.done ? '☑' : '☐'}
                                  </span>
                                  <span class="cl-text">{it.text}</span>
                                </li>
                              )}
                            </For>
                          </ul>
                        </Show>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </section>
          </Show>

          <Show when={selectedCard()}>
            <CardOverlay
              card={selectedCard()!}
              content={p.content!}
              onClose={() => setSelectedCardId(null)}
            />
          </Show>
        </div>
      )}
    </Show>
  );
};

export default BoardView;
