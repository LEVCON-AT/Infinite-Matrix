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
  CardRecur,
  CardRecurType,
  InlineChecklistItem,
  KbCardRow,
} from '../lib/types';
import {
  addCardInlineItem,
  addChecklistItem,
  delCard,
  delCardInlineItem,
  delChecklistItem,
  renameCard,
  renameCardInlineItem,
  renameChecklistItem,
  setCardAlias,
  setCardArchived,
  setCardColor,
  setCardDeadline,
  setCardDoneOccurrences,
  setCardNote,
  setCardPriority,
  setCardRecur,
  setCardTags,
  setCardWho,
  toggleCardDone,
  toggleCardInlineItem,
  toggleChecklistItemDone,
} from '../lib/mutations';
import {
  isCardDone,
  isRecurCard,
  todayIso,
  toggleOccurrence,
} from '../lib/recur';
import { showToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';
import { flashError } from '../lib/flash';
import { validateAlias } from '../lib/alias';
import { openDocsPopup } from '../lib/docs-ui';
import { bindAliasAutocomplete } from '../lib/use-alias-autocomplete';

type Props = {
  card: KbCardRow;
  content: BoardContent;
  onClose: () => void;
  onChanged?: () => void;
};

type OverlayItem = {
  id: string;
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

  function rejectAlias(msg: string) {
    showToast(msg, 'error');
    flashError(aliasInputRef);
    // Nach Shake-Animation Fokus zurueck + Text markieren, damit das
    // naechste Tippen direkt ueberschreibt. Eingabe NICHT revertieren —
    // User soll korrigieren koennen. (Pattern aus CellOverlay.)
    window.setTimeout(() => {
      aliasInputRef?.focus();
      aliasInputRef?.select();
    }, 420);
  }

  async function onAlias(newAlias: string) {
    if (busy()) return;
    const current = p.card.alias ?? null;
    setBusy(true);
    try {
      const res = await validateAlias(newAlias, p.card.workspace_id, {
        type: 'card',
        id: p.card.id,
      });
      if (!res.ok) {
        rejectAlias(res.msg);
        return;
      }
      const next = res.canonical;
      if (next === current) return;
      await setCardAlias(p.card.id, next);
      p.onChanged?.();
    } catch (err) {
      // Falls die DB doch noch 23505 wirft (Race), selben Pfad gehen.
      rejectAlias(translateDbError(err));
    } finally {
      setBusy(false);
    }
  }

  async function onNote(newNote: string) {
    if (newNote === p.card.note) return;
    await wrap(() => setCardNote(p.card.id, newNote));
  }

  async function onToggleDone(done: boolean) {
    const current = isCardDone(p.card);
    if (done === current) return;
    if (isRecurCard(p.card)) {
      const next = toggleOccurrence(p.card.done_occurrences, todayIso(), done);
      await wrap(() => setCardDoneOccurrences(p.card.id, next));
    } else {
      await wrap(() => toggleCardDone(p.card.id, done));
    }
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

  async function onColor(val: string | null) {
    const next = val && val !== '' ? val : null;
    if ((next ?? null) === (p.card.color ?? null)) return;
    await wrap(() => setCardColor(p.card.id, next));
  }

  // Comma/Whitespace-separierte Eingabe → normalisiertes Array.
  // Duplikate raus (case-insensitive), leere Strings raus. Reihenfolge
  // wird erhalten (erste Nennung gewinnt). "#" / "@" am Anfang werden
  // gestrippt, weil das Chip-Rendering sie selbst setzt — sonst
  // tauchen ## / @@ auf.
  function parseTagList(raw: string): string[] {
    const parts = raw
      .split(/[,\s]+/)
      .map((t) => t.replace(/^[#@]+/, '').trim())
      .filter((t) => t.length > 0);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of parts) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }

  function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  async function onTags(raw: string) {
    const next = parseTagList(raw);
    const cur = p.card.tags ?? [];
    if (arraysEqual(next, cur)) return;
    await wrap(() => setCardTags(p.card.id, next));
  }

  async function onWho(raw: string) {
    const next = parseTagList(raw);
    const cur = p.card.who ?? [];
    if (arraysEqual(next, cur)) return;
    await wrap(() => setCardWho(p.card.id, next));
  }

  // Deadline-Warnung: dasselbe Regelwerk wie auf den Board-Karten.
  // Rendert einen kleinen farbigen Hinweis neben dem Date-Input.
  function deadlineWarning(): { state: 'overdue' | 'today' | 'soon'; label: string } | null {
    const iso = p.card.deadline;
    if (!iso) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(iso);
    d.setHours(0, 0, 0, 0);
    const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
    if (days < 0) return { state: 'overdue', label: `ueberfaellig (${-days}d)` };
    if (days === 0) return { state: 'today', label: 'heute faellig' };
    if (days <= 3) return { state: 'soon', label: `in ${days}d` };
    return null;
  }

  // Recur: Dropdown + Intervall + Startdatum. Zusammen ein Objekt,
  // weil die DB-Spalte ein JSONB ist und Teilupdates sonst per
  // mutateCardRecur gehen muessten. Fuer V1 reicht setCardRecur(obj).
  function recurVal(): CardRecur {
    const r = p.card.recur as CardRecur | null | undefined;
    return {
      type: (r?.type ?? 'none') as CardRecurType,
      every: typeof r?.every === 'number' ? r.every : 1,
      startDate: typeof r?.startDate === 'string' ? r.startDate : '',
    };
  }

  async function onRecurType(val: string) {
    const next: CardRecur | null = val === 'none' ? null : (() => {
      const cur = recurVal();
      return {
        type: val as CardRecurType,
        every: cur.every ?? 1,
        startDate:
          cur.startDate ||
          new Date().toISOString().slice(0, 10),
      };
    })();
    await wrap(() => setCardRecur(p.card.id, next));
  }

  async function onRecurEvery(val: string) {
    const n = Number(val);
    if (!Number.isFinite(n) || n < 1) return;
    const cur = recurVal();
    if (cur.type === 'none') return;
    if (cur.every === n) return;
    await wrap(() =>
      setCardRecur(p.card.id, { ...cur, every: n }),
    );
  }

  async function onRecurStart(val: string) {
    const cur = recurVal();
    if (cur.type === 'none') return;
    const next = val || '';
    if (cur.startDate === next) return;
    await wrap(() =>
      setCardRecur(p.card.id, { ...cur, startDate: next }),
    );
  }

  function recurLabel(): string {
    const r = recurVal();
    if (r.type === 'none') return '';
    const n = r.every ?? 1;
    const phrase =
      n === 1
        ? {
            daily: 'taeglich',
            weekly: 'woechentlich',
            monthly: 'monatlich',
            yearly: 'jaehrlich',
          }[r.type as Exclude<CardRecurType, 'none'>]
        : `alle ${n} ${
            {
              daily: 'Tage',
              weekly: 'Wochen',
              monthly: 'Monate',
              yearly: 'Jahre',
            }[r.type as Exclude<CardRecurType, 'none'>]
          }`;
    const start = r.startDate
      ? ` ab ${new Date(r.startDate).toLocaleDateString('de-DE')}`
      : '';
    return `${phrase}${start}`;
  }

  async function onToggleArchive() {
    const next = !p.card.archived;
    await wrap(
      () => setCardArchived(p.card.id, next),
      next ? 'Karte archiviert.' : 'Karte wieder aktiv.',
    );
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
  //
  // `id` brauchen wir in beiden Pfaden stabil, damit toggle/rename/del
  // das richtige Item treffen. Bei checklist_items liefert die DB es
  // direkt; bei inline geben Legacy-Items evtl. keine id, in dem Fall
  // fallen wir auf den Array-Index zurueck (`i-<idx>`). Der naechste
  // Schreibzugriff (ensureItemId in mutations.ts) haengt dann eine
  // UUID dran.
  const items = createMemo<OverlayItem[]>(() => {
    const c = p.card;
    if (c.checklist_ref) {
      return p.content.checklistItems
        .filter((it) => it.checklist_id === c.checklist_ref)
        .sort((a, b) => a.position - b.position)
        .map((it) => ({
          id: it.id,
          text: it.text,
          done: it.done,
          level: it.level,
        }));
    }
    const inline = c.checklist;
    if (Array.isArray(inline)) {
      return inline.map((i: InlineChecklistItem, idx) => ({
        id: i.id ?? `i-${idx}`,
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

  // Mutations-Dispatch: Ref-Mode → checklist_items-Tabelle, sonst
  // Inline-JSONB auf der Karte. Fuer den Caller ist das transparent.
  async function onToggleItem(item: OverlayItem, done: boolean) {
    if (done === item.done) return;
    await wrap(async () => {
      if (p.card.checklist_ref) {
        await toggleChecklistItemDone(item.id, done);
      } else {
        await toggleCardInlineItem(p.card.id, item.id, done);
      }
    });
  }

  async function onRenameItem(item: OverlayItem, text: string) {
    if (text === item.text) return;
    await wrap(async () => {
      if (p.card.checklist_ref) {
        await renameChecklistItem(item.id, text);
      } else {
        await renameCardInlineItem(p.card.id, item.id, text);
      }
    });
  }

  async function onDelItem(item: OverlayItem) {
    await wrap(async () => {
      if (p.card.checklist_ref) {
        await delChecklistItem(item.id);
      } else {
        await delCardInlineItem(p.card.id, item.id);
      }
    });
  }

  async function onAddItem() {
    await wrap(async () => {
      if (p.card.checklist_ref) {
        await addChecklistItem({
          workspaceId: p.card.workspace_id,
          checklistId: p.card.checklist_ref,
        });
      } else {
        await addCardInlineItem({ cardId: p.card.id });
      }
    });
  }

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
            <Show when={isCardDone(p.card)}>
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
              <Show when={!isCardDone(p.card) && deadlineWarning()}>
                <span
                  class="overlay-deadline-warning"
                  data-deadline-state={deadlineWarning()!.state}
                >
                  {deadlineWarning()!.label}
                </span>
              </Show>
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

            <label class="overlay-field overlay-field-color">
              <span class="overlay-field-label">Farbe</span>
              <div class="overlay-color-row">
                <input
                  type="color"
                  class="overlay-color-input"
                  value={p.card.color ?? '#888888'}
                  title="Karten-Farbe"
                  onChange={(e) => onColor(e.currentTarget.value)}
                />
                <button
                  type="button"
                  class="overlay-color-clear"
                  title="Farbe entfernen"
                  aria-label="Farbe entfernen"
                  onClick={() => onColor(null)}
                  disabled={!p.card.color}
                >
                  ○
                </button>
              </div>
            </label>

            <label class="overlay-field overlay-field-done">
              <input
                type="checkbox"
                checked={isCardDone(p.card)}
                onChange={(e) => onToggleDone(e.currentTarget.checked)}
              />
              <span>
                {isRecurCard(p.card) ? 'Heute erledigt' : 'Erledigt'}
              </span>
            </label>
          </section>

          <Show when={recurVal().type !== 'none'}>
            <div class="overlay-meta">
              <span class="kb-recur" title={recurLabel()}>
                ↻ {recurLabel()}
              </span>
            </div>
          </Show>

          <section class="overlay-section overlay-tag-grid">
            <label class="overlay-field">
              <span class="overlay-field-label">Tags</span>
              <input
                type="text"
                class="overlay-input"
                value={(p.card.tags ?? []).join(', ')}
                placeholder="design, review, legal"
                onBlur={(e) => onTags(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
              <Show when={(p.card.tags ?? []).length > 0}>
                <div class="overlay-chip-row">
                  <For each={p.card.tags ?? []}>
                    {(t) => <span class="kb-tag">#{t}</span>}
                  </For>
                </div>
              </Show>
            </label>
            <label class="overlay-field">
              <span class="overlay-field-label">Zustaendig</span>
              <input
                type="text"
                class="overlay-input"
                value={(p.card.who ?? []).join(', ')}
                placeholder="anna, tom"
                onBlur={(e) => onWho(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
              />
              <Show when={(p.card.who ?? []).length > 0}>
                <div class="overlay-chip-row">
                  <For each={p.card.who ?? []}>
                    {(w) => <span class="kb-who">@{w}</span>}
                  </For>
                </div>
              </Show>
            </label>
          </section>

          <section class="overlay-section overlay-recur-grid">
            <label class="overlay-field">
              <span class="overlay-field-label">Wiederholung</span>
              <select
                class="overlay-input"
                value={recurVal().type}
                onChange={(e) => onRecurType(e.currentTarget.value)}
              >
                <option value="none">keine</option>
                <option value="daily">taeglich</option>
                <option value="weekly">woechentlich</option>
                <option value="monthly">monatlich</option>
                <option value="yearly">jaehrlich</option>
              </select>
            </label>
            <Show when={recurVal().type !== 'none'}>
              <label class="overlay-field">
                <span class="overlay-field-label">Intervall</span>
                <input
                  type="number"
                  class="overlay-input"
                  min="1"
                  max="365"
                  value={recurVal().every ?? 1}
                  onBlur={(e) => onRecurEvery(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                />
              </label>
              <label class="overlay-field">
                <span class="overlay-field-label">Start</span>
                <input
                  type="date"
                  class="overlay-input"
                  value={recurVal().startDate ?? ''}
                  onChange={(e) => onRecurStart(e.currentTarget.value)}
                />
              </label>
            </Show>
          </section>

          <section class="overlay-section">
            <h4>Notiz</h4>
            <textarea
              class="overlay-textarea"
              value={p.card.note}
              placeholder="(keine Notiz)"
              rows="4"
              ref={(el) => bindAliasAutocomplete(el, p.card.workspace_id)}
              onBlur={(e) => onNote(e.currentTarget.value)}
            />
          </section>

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
            <Show
              when={items().length > 0}
              fallback={<p class="hint">Noch keine Punkte.</p>}
            >
              <ul class="cl-items overlay-cl">
                <For each={items()}>
                  {(it) => (
                    <li
                      class="cl-it"
                      classList={{ 'cl-it-done': it.done }}
                      style={{ '--cl-level': it.level }}
                    >
                      <input
                        type="checkbox"
                        class="cl-checkbox-input"
                        checked={it.done}
                        aria-label="Erledigt"
                        onChange={(e) =>
                          onToggleItem(it, e.currentTarget.checked)
                        }
                      />
                      <input
                        class="cl-text-input"
                        type="text"
                        value={it.text}
                        placeholder="(Punkt)"
                        onBlur={(e) => onRenameItem(it, e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                      />
                      <button
                        type="button"
                        class="cl-it-del"
                        title="Punkt loeschen"
                        aria-label="Punkt loeschen"
                        onClick={() => onDelItem(it)}
                        disabled={busy()}
                      >
                        ✕
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
            <button
              type="button"
              class="cl-add-item-btn"
              onClick={onAddItem}
              disabled={busy()}
            >
              + Punkt
            </button>
          </section>

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
              class="btn-subtle"
              onClick={() => {
                openDocsPopup({
                  sourceAlias: p.card.alias ?? null,
                });
                p.onClose();
              }}
              title="Neue Doku mit dieser Karte als Quelle anlegen"
            >
              In Doku erfassen
            </button>
            <button
              type="button"
              class="btn-subtle"
              onClick={onToggleArchive}
              disabled={busy()}
              title={
                p.card.archived
                  ? 'Karte wieder sichtbar machen'
                  : 'Karte archivieren (versteckt auf dem Board)'
              }
            >
              {p.card.archived ? 'Aus Archiv holen' : 'Archivieren'}
            </button>
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
