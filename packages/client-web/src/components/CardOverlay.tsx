import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import type {
  BoardContent,
  InlineChecklistItem,
  KbCardRow,
} from '../lib/types';
import {
  delCard,
  renameCard,
  setCardAlias,
  setCardDeadline,
  setCardNote,
  setCardPriority,
  toggleCardDone,
} from '../lib/mutations';
import { showToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';
import { flashError } from '../lib/flash';

type Props = {
  card: KbCardRow;
  content: BoardContent;
  onClose: () => void;
  onChanged?: () => void;
};

type OverlayItem = {
  text: string;
  done: boolean;
  level: 0 | 1 | 2;
};

// Karten sind keine strukturellen Daten — Namens-, Note-, Deadline-,
// Priority- und Done-Aenderungen sind immer moeglich, unabhaengig vom
// globalen Edit-Mode. Der Edit-Mode gated nur strukturelle Board-Ops
// (Spalten-CRUD, Card Add/Delete/Move in der BoardView).
const CardOverlay: Component<Props> = (p) => {
  const [busy, setBusy] = createSignal(false);
  let aliasInputRef: HTMLInputElement | undefined;

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

  async function onRename(newName: string) {
    const trimmed = newName.trim();
    if (trimmed === p.card.name) return;
    await wrap(() => renameCard(p.card.id, trimmed));
  }

  async function onAlias(newAlias: string) {
    const t = newAlias.trim();
    const next = t === '' ? null : t;
    if (next === (p.card.alias ?? null)) return;
    if (busy()) return;
    setBusy(true);
    try {
      await setCardAlias(p.card.id, next);
      p.onChanged?.();
    } catch (err) {
      const msg = translateDbError(err);
      showToast(msg, 'error');
      flashError(aliasInputRef);
      // Wert zuruecksetzen, damit der DB-Stand sichtbar bleibt.
      if (aliasInputRef) aliasInputRef.value = p.card.alias ?? '';
    } finally {
      setBusy(false);
    }
  }

  async function onNote(newNote: string) {
    if (newNote === p.card.note) return;
    await wrap(() => setCardNote(p.card.id, newNote));
  }

  async function onToggleDone(done: boolean) {
    if (done === p.card.done) return;
    await wrap(() => toggleCardDone(p.card.id, done));
  }

  async function onDeadline(val: string) {
    const next = val === '' ? null : val;
    if (next === (p.card.deadline ?? null)) return;
    await wrap(() => setCardDeadline(p.card.id, next));
  }

  async function onPriority(val: string) {
    const next = val === '' ? null : Number(val);
    if (next !== null && !Number.isFinite(next)) return;
    if (next === (p.card.priority ?? null)) return;
    await wrap(() => setCardPriority(p.card.id, next));
  }

  async function onDelete() {
    if (!window.confirm(`Karte "${p.card.name || '(ohne Titel)'}" loeschen?`)) {
      return;
    }
    setBusy(true);
    try {
      await delCard(p.card.id);
      showToast('Karte geloescht.', 'success');
      p.onChanged?.();
      p.onClose();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

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
            <input
              class="overlay-title-input"
              type="text"
              value={p.card.name}
              placeholder="(ohne Titel)"
              onBlur={(e) => onRename(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
            />
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
          <section class="overlay-section overlay-edit-grid">
            <label class="overlay-field">
              <span class="overlay-field-label">Alias</span>
              <input
                ref={aliasInputRef}
                type="text"
                class="overlay-input"
                value={p.card.alias ?? ''}
                placeholder="(kein Alias)"
                onBlur={(e) => onAlias(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
            </label>

            <label class="overlay-field">
              <span class="overlay-field-label">Deadline</span>
              <input
                type="date"
                class="overlay-input"
                value={p.card.deadline ?? ''}
                onChange={(e) => onDeadline(e.currentTarget.value)}
              />
            </label>

            <label class="overlay-field">
              <span class="overlay-field-label">Prioritaet</span>
              <input
                type="number"
                class="overlay-input"
                value={p.card.priority ?? ''}
                placeholder="(keine)"
                min="0"
                max="9"
                onBlur={(e) => onPriority(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
            </label>

            <label class="overlay-field overlay-field-done">
              <input
                type="checkbox"
                checked={p.card.done}
                onChange={(e) => onToggleDone(e.currentTarget.checked)}
              />
              <span>Erledigt</span>
            </label>
          </section>

          <Show
            when={
              (p.card.tags?.length ?? 0) > 0 ||
              (p.card.who?.length ?? 0) > 0 ||
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
              <Show when={p.card.recur}>
                <span class="kb-recur" title="wiederkehrend">
                  ↻
                </span>
              </Show>
            </div>
          </Show>

          <section class="overlay-section">
            <h4>Notiz</h4>
            <textarea
              class="overlay-textarea"
              value={p.card.note}
              placeholder="(keine Notiz)"
              rows="4"
              onBlur={(e) => onNote(e.currentTarget.value)}
            />
          </section>

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

          <footer class="overlay-edit-footer">
            <button
              type="button"
              class="btn-danger"
              onClick={onDelete}
              disabled={busy()}
            >
              Karte loeschen
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default CardOverlay;
