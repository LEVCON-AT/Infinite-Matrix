import { For, Show, createMemo, onCleanup, onMount, type Component } from 'solid-js';
import type {
  BoardContent,
  InlineChecklistItem,
  KbCardRow,
} from '../lib/types';

type Props = {
  card: KbCardRow;
  content: BoardContent;
  onClose: () => void;
};

type OverlayItem = {
  text: string;
  done: boolean;
  level: 0 | 1 | 2;
};

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

const CardOverlay: Component<Props> = (p) => {
  // ESC schliesst; wir haengen den Handler in Capture, damit er
  // ueber globalen Back-Handlern greift (CLAUDE.md-Konvention).
  onMount(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        p.onClose();
      }
    };
    document.addEventListener('keydown', h, true);
    onCleanup(() => document.removeEventListener('keydown', h, true));
  });

  // Quelle der Checklist-Items: ref → checklist_items, sonst inline.
  const items = createMemo<OverlayItem[]>(() => {
    const c = p.card;
    if (c.checklist_ref) {
      return p.content.checklistItems
        .filter((it) => it.checklist_id === c.checklist_ref)
        .sort((a, b) => a.position - b.position)
        .map((it) => ({ text: it.text, done: it.done, level: it.level }));
    }
    const inline = c.checklist;
    if (Array.isArray(inline)) {
      return inline.map((i: InlineChecklistItem) => ({
        text: i.text,
        done: !!i.done,
        level: (i.level ?? 0) as 0 | 1 | 2,
      }));
    }
    return [];
  });

  const refChecklistLabel = createMemo(() => {
    if (!p.card.checklist_ref) return null;
    const cl = p.content.checklists.find((c) => c.id === p.card.checklist_ref);
    return cl ? cl.label || '(Liste)' : null;
  });

  return (
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div class="overlay-card" role="dialog" aria-modal="true">
        <header class="overlay-head">
          <div class="overlay-title">
            <Show when={p.card.done}>
              <span class="kb-done-mark" aria-hidden>
                ✓
              </span>
            </Show>
            <h2>{p.card.name || '(ohne Titel)'}</h2>
            <Show when={p.card.alias}>
              <span class="kb-card-alias">^{p.card.alias}</span>
            </Show>
          </div>
          <button
            type="button"
            class="overlay-close"
            onClick={p.onClose}
            aria-label="Schliessen"
          >
            ✕
          </button>
        </header>

        <div class="overlay-body">
          <Show
            when={
              (p.card.tags?.length ?? 0) > 0 ||
              (p.card.who?.length ?? 0) > 0 ||
              p.card.deadline ||
              p.card.priority != null ||
              p.card.recur != null
            }
          >
            <div class="overlay-meta">
              <For each={p.card.tags ?? []}>
                {(t) => <span class="kb-tag">#{t}</span>}
              </For>
              <For each={p.card.who ?? []}>
                {(w) => <span class="kb-who">@{w}</span>}
              </For>
              <Show when={p.card.deadline}>
                <span class="kb-deadline">⏱ {fmtDate(p.card.deadline)}</span>
              </Show>
              <Show when={p.card.priority != null}>
                <span class="kb-prio">P{p.card.priority}</span>
              </Show>
              <Show when={p.card.recur}>
                <span class="kb-recur" title="wiederkehrend">
                  ↻
                </span>
              </Show>
            </div>
          </Show>

          <Show when={p.card.note}>
            <section class="overlay-section">
              <h4>Notiz</h4>
              <p class="overlay-note">{p.card.note}</p>
            </section>
          </Show>

          <Show when={items().length > 0}>
            <section class="overlay-section">
              <h4>
                Checkliste
                <Show when={refChecklistLabel()}>
                  <span class="hint">
                    {' '}
                    — Referenz auf „{refChecklistLabel()}"
                  </span>
                </Show>
              </h4>
              <ul class="cl-items overlay-cl">
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
            </section>
          </Show>

          <Show when={p.card.source_label || p.card.source_cl_id}>
            <p class="hint overlay-source">
              <Show
                when={p.card.source_cl_id}
                fallback={<>ehemals Checkliste „{p.card.source_label}"</>}
              >
                stammt aus Checkliste-ID{' '}
                <code>{p.card.source_cl_id}</code>
              </Show>
            </p>
          </Show>
        </div>
      </div>
    </div>
  );
};

export default CardOverlay;
