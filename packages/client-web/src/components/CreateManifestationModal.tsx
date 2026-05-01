// Create-Manifestation-Modal (Phase 4 T.1.G.2.A + T.AC.D.1 atom-aware).
//
// Kommt hoch wenn ein Atom (Task, Link, Checkliste) auf einen Calendar-
// Tag gezogen wird und keine kind='calendar'-Manifestation existiert.
// Ergebnis: ein Eintrag im Calendar mit Datum/Range/Uhrzeit/Recur.
//
// Felder:
//   - Datum (Pflicht — vorbelegt vom Drop-Tag)
//   - End-Datum (optional, Range; multi-day-Termin)
//   - Uhrzeit (optional, HH:MM) — nur sinnvoll bei single-day
//   - Dauer in Minuten (optional)
//   - Wiederholung (none/daily/weekly/monthly/yearly)
//     + End-Rule wenn recur != none (nie / am Datum / nach N)
//
// Validation: Range UND Recur gleichzeitig blockiert (V1, T.AC.D.1
// ONLY-ONE-Constraint). Range = Multi-Day-Block; Recur = wiederkehrend.
// Beides zusammen ist semantisch unklar (was bedeutet "monatlich von
// 1.-3."?) — kommt mit T.AC.D.4 wenn ueberhaupt.
//
// Persistenz dispatcht nach atomType:
//   - task     → addManifestation (lib/tasks.ts → task_manifestations)
//   - link/checklist → addAtomManifestation (lib/atom-manifestations.ts
//                       → atom_manifestations)

import { type Component, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { addAtomManifestation, removeAtomManifestation } from '../lib/atom-manifestations';
import { installFocusRestore, installFocusTrap } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import type { ManifestationAtomType } from '../lib/manifestation-modal-state';
import { addManifestation, removeManifestation } from '../lib/tasks';
import { showToast, showUndoToast } from '../lib/toasts';
import Icon from './Icon';

type RecurType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
type EndType = 'never' | 'on_date' | 'after_count';

type Props = {
  workspaceId: string;
  atomType: ManifestationAtomType;
  atomId: string;
  atomLabel: string;
  atomUrl?: string;
  defaultDate: string;
  onClose: () => void;
  onCreated?: () => void;
};

const CreateManifestationModal: Component<Props> = (p) => {
  const [startDate, setStartDate] = createSignal(p.defaultDate);
  const [endDate, setEndDate] = createSignal('');
  const [time, setTime] = createSignal('');
  const [duration, setDuration] = createSignal('');
  const [recurType, setRecurType] = createSignal<RecurType>('none');
  const [endType, setEndType] = createSignal<EndType>('never');
  const [endDateRecur, setEndDateRecur] = createSignal('');
  const [endCount, setEndCount] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  let cardRef: HTMLDivElement | undefined;

  const atomLabelFor = createMemo(() => {
    if (p.atomType === 'task') return 'Aufgabe';
    if (p.atomType === 'link') return 'Link';
    return 'Liste';
  });

  // Block: Range UND Recur gleichzeitig.
  const isInvalidCombo = createMemo(() => endDate().trim() !== '' && recurType() !== 'none');

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

  function buildRecurJson(): Record<string, unknown> | null {
    if (recurType() === 'none') return null;
    const r: Record<string, unknown> = { type: recurType() };
    if (endType() === 'on_date') {
      const ed = endDateRecur().trim();
      if (ed && /^\d{4}-\d{2}-\d{2}$/.test(ed)) {
        r.endType = 'date';
        r.endDate = ed;
      } else {
        r.endType = 'never';
      }
    } else if (endType() === 'after_count') {
      const c = Number.parseInt(endCount().trim(), 10);
      if (Number.isFinite(c) && c > 0) {
        r.endType = 'count';
        r.endCount = c;
      } else {
        r.endType = 'never';
      }
    } else {
      r.endType = 'never';
    }
    return r;
  }

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (busy()) return;
    if (isInvalidCombo()) {
      showToast('Mehrtaegig + Wiederholung gleichzeitig wird in V1 nicht unterstuetzt.', 'error');
      return;
    }
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
      const recur = buildRecurJson();
      if (recur) display_meta.recur = recur;
      // Snapshot fuer non-task Atoms (label/url leben sonst nicht im
      // atom_manifestations-Row). Pattern wie dropAtomOnDate.
      if (p.atomType !== 'task') {
        if (p.atomLabel) display_meta.label = p.atomLabel;
        if (p.atomUrl) display_meta.url = p.atomUrl;
      }

      if (p.atomType === 'task') {
        const created = await addManifestation(p.workspaceId, {
          task_id: p.atomId,
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
      } else {
        const created = await addAtomManifestation({
          workspaceId: p.workspaceId,
          atomType: p.atomType,
          atomId: p.atomId,
          kind: 'calendar',
          displayMeta: display_meta,
        });
        showUndoToast('Termin angelegt', async () => {
          try {
            await removeAtomManifestation(created.id);
          } catch (undoErr) {
            console.error('removeAtomManifestation (undo):', undoErr);
          }
        });
      }
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
              {atomLabelFor()}: <strong>{p.atomLabel || '(ohne Label)'}</strong>
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
              <span>End-Datum (optional, mehrtaegig)</span>
              <input
                type="date"
                value={endDate()}
                onInput={(e) => setEndDate(e.currentTarget.value)}
                min={startDate()}
                disabled={busy() || recurType() !== 'none'}
                title={
                  recurType() !== 'none'
                    ? 'Mehrtaegig + Wiederholung gleichzeitig nicht moeglich.'
                    : ''
                }
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
            <label class="create-manif-row">
              <span>Wiederholung</span>
              <select
                value={recurType()}
                onChange={(e) => {
                  setRecurType(e.currentTarget.value as RecurType);
                  if (e.currentTarget.value !== 'none') setEndDate('');
                }}
                disabled={busy() || endDate() !== ''}
                title={
                  endDate() !== '' ? 'Mehrtaegig + Wiederholung gleichzeitig nicht moeglich.' : ''
                }
              >
                <option value="none">einmalig</option>
                <option value="daily">taeglich</option>
                <option value="weekly">woechentlich</option>
                <option value="monthly">monatlich</option>
                <option value="yearly">jaehrlich</option>
              </select>
            </label>
            <Show when={recurType() !== 'none'}>
              <label class="create-manif-row">
                <span>Endet</span>
                <select
                  value={endType()}
                  onChange={(e) => setEndType(e.currentTarget.value as EndType)}
                  disabled={busy()}
                >
                  <option value="never">nie</option>
                  <option value="on_date">am Datum</option>
                  <option value="after_count">nach N Vorkommen</option>
                </select>
              </label>
              <Show when={endType() === 'on_date'}>
                <label class="create-manif-row">
                  <span>End-Datum (Wiederholung)</span>
                  <input
                    type="date"
                    value={endDateRecur()}
                    onInput={(e) => setEndDateRecur(e.currentTarget.value)}
                    min={startDate()}
                    disabled={busy()}
                  />
                </label>
              </Show>
              <Show when={endType() === 'after_count'}>
                <label class="create-manif-row">
                  <span>Anzahl Vorkommen</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={endCount()}
                    onInput={(e) => setEndCount(e.currentTarget.value)}
                    disabled={busy()}
                  />
                </label>
              </Show>
            </Show>
            <Show when={endDate() && endDate() < startDate()}>
              <p class="hint create-manif-warn">End-Datum liegt vor dem Start-Datum.</p>
            </Show>
            <Show when={isInvalidCombo()}>
              <p class="hint create-manif-warn">
                Mehrtaegig + Wiederholung gleichzeitig wird in V1 nicht unterstuetzt.
              </p>
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
              <button type="submit" class="btn-primary" disabled={busy() || isInvalidCombo()}>
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
