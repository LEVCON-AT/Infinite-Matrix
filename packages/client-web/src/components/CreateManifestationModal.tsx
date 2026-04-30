// Create-Manifestation-Modal (Phase 4 T.1.G.2.A).
//
// Kommt hoch wenn ein Atom (heute: Task) auf einen Drop-Target gezogen
// wird. V1 nur Calendar-Manifestation. T.AC erweitert auf andere
// Atom-Typen, T.1.G.2.B/C auf andere Manifestation-Kinds.
//
// Felder bei kind='calendar':
//   - Datum (Pflicht — vorbelegt vom Drop-Tag)
//   - End-Datum (optional, Range)
//   - Uhrzeit (optional, HH:MM)
//   - Dauer in Minuten (optional)
//   - Wiederholung (V1 placeholder — task.recur bleibt fuehrend)
//
// Cancel: kein addManifestation. Submit: addManifestation + showUndoToast.

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { installFocusRestore, installFocusTrap } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { addManifestation, removeManifestation } from '../lib/tasks';
import { showToast, showUndoToast } from '../lib/toasts';
import Icon from './Icon';

export type ManifestationDraft = {
  kind: 'calendar';
  startDate: string; // 'YYYY-MM-DD'
  endDate?: string;
  time?: string;
  durationMin?: number;
};

type Props = {
  workspaceId: string;
  taskId: string;
  taskLabel: string;
  defaultDate: string;
  onClose: () => void;
  onCreated?: () => void;
};

const CreateManifestationModal: Component<Props> = (p) => {
  const [startDate, setStartDate] = createSignal(p.defaultDate);
  const [endDate, setEndDate] = createSignal('');
  const [time, setTime] = createSignal('');
  const [duration, setDuration] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  let cardRef: HTMLDivElement | undefined;

  onMount(() => {
    onCleanup(installFocusRestore());
    if (cardRef) onCleanup(installFocusTrap(cardRef));
    document.body.dataset.modalOpen = '1';
    onCleanup(() => {
      delete document.body.dataset.modalOpen;
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy()) return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
    queueMicrotask(() => {
      const el = cardRef?.querySelector<HTMLInputElement>('input[type="date"]');
      el?.focus();
      el?.select?.();
    });
  });

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (busy()) return;
    setBusy(true);
    try {
      const sd = startDate().trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sd)) {
        showToast('Datum ungueltig.', 'error');
        return;
      }
      const display_meta: Record<string, unknown> = { start_date: sd };
      const ed = endDate().trim();
      if (ed && /^\d{4}-\d{2}-\d{2}$/.test(ed) && ed >= sd) {
        display_meta.end_date = ed;
      }
      const t = time().trim();
      if (t && /^\d{2}:\d{2}$/.test(t)) display_meta.time = t;
      const dur = Number.parseInt(duration().trim(), 10);
      if (Number.isFinite(dur) && dur > 0) display_meta.duration_min = dur;

      const created = await addManifestation(p.workspaceId, {
        task_id: p.taskId,
        kind: 'calendar',
        display_meta,
      });
      showUndoToast('Termin angelegt', async () => {
        try {
          await removeManifestation(created.id);
        } catch (undoErr) {
          console.error('removeManifestation (undo):', undoErr);
        }
      });
      p.onCreated?.();
      p.onClose();
    } catch (err) {
      console.error('addManifestation:', err);
      showToast(translateDbError(err, 'Termin konnte nicht angelegt werden.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop-Click schliesst Modal — Tastatur-Pendant ist ESC im keydown-Handler oben (capture).
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy()) p.onClose();
      }}
    >
      <div
        ref={cardRef}
        class="overlay-card create-manif-card"
        // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> Pattern wie restliche Modals.
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-manif-title"
      >
        <header class="overlay-head">
          <h3 id="create-manif-title">Termin anlegen</h3>
          <button
            type="button"
            class="overlay-close"
            onClick={p.onClose}
            aria-label="Schliessen"
            disabled={busy()}
          >
            <Icon name="x" size={18} />
          </button>
        </header>
        <form onSubmit={onSubmit}>
          <div class="overlay-body create-manif-body">
            <p class="hint">
              Aufgabe: <strong>{p.taskLabel || '(ohne Label)'}</strong>
            </p>
            <label class="create-manif-row">
              <span>Datum</span>
              <input
                type="date"
                value={startDate()}
                onInput={(e) => setStartDate(e.currentTarget.value)}
                required
                disabled={busy()}
              />
            </label>
            <label class="create-manif-row">
              <span>End-Datum (optional)</span>
              <input
                type="date"
                value={endDate()}
                onInput={(e) => setEndDate(e.currentTarget.value)}
                min={startDate()}
                disabled={busy()}
              />
            </label>
            <label class="create-manif-row">
              <span>Uhrzeit (optional)</span>
              <input
                type="time"
                value={time()}
                onInput={(e) => setTime(e.currentTarget.value)}
                disabled={busy()}
              />
            </label>
            <label class="create-manif-row">
              <span>Dauer (Minuten, optional)</span>
              <input
                type="number"
                min="0"
                step="15"
                value={duration()}
                onInput={(e) => setDuration(e.currentTarget.value)}
                disabled={busy()}
              />
            </label>
            <Show when={endDate() && endDate() < startDate()}>
              <p class="hint create-manif-warn">End-Datum liegt vor dem Start-Datum.</p>
            </Show>
          </div>
          <footer class="overlay-foot">
            <span class="create-manif-tip">
              <kbd>Esc</kbd> abbrechen · <kbd>Strg</kbd>+<kbd>↩</kbd> speichern
            </span>
            <div class="create-manif-actions">
              <button type="button" class="btn-subtle" onClick={p.onClose} disabled={busy()}>
                Abbrechen
              </button>
              <button type="submit" class="btn-primary" disabled={busy()}>
                {busy() ? 'Speichere…' : 'Anlegen'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
};

export default CreateManifestationModal;
