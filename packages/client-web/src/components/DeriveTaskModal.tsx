// Welle I.8 — DeriveTaskModal.
//
// Aus einem importierten External-Event eine Task ableiten. User waehlt:
//   - Sync-Mode: Snapshot (one-shot Copy) | Live verbunden (sync-folgt)
//   - Bei recurring: Scope Instanz | komplette Serie
//   - Bei multi-day: V1 nur "Eine Task" mit deadline=start, Hinweis als Note
//   - Optional: Titel-Override + Datum-Override
//
// Submit ruft derive_task_from_event-RPC + navigiert zur Task-Detail-Page.

import { useNavigate } from '@solidjs/router';
import { type Component, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { deriveTaskFromEvent } from '../lib/calendar-inbound';
import { translateDbError } from '../lib/errors';
import { showToast } from '../lib/toasts';
import type { DeriveScope, DeriveSyncMode } from '../lib/types';
import Icon from './Icon';

export type DeriveTaskModalProps = {
  workspaceId: string;
  eventId: string;
  defaults: {
    summary: string;
    startDate: string;
    endDate: string;
    isRange: boolean;
    isRecurring: boolean;
  };
  onClose: () => void;
  onDerived?: (taskId: string) => void;
};

const DeriveTaskModal: Component<DeriveTaskModalProps> = (props) => {
  const navigate = useNavigate();
  const [title, setTitle] = createSignal(props.defaults.summary);
  const [deadline, setDeadline] = createSignal(props.defaults.startDate);
  const [mode, setMode] = createSignal<DeriveSyncMode>('snapshot');
  const [scope, setScope] = createSignal<DeriveScope>('instance');
  const [busy, setBusy] = createSignal(false);

  const canSubmit = createMemo(
    () => !busy() && title().trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(deadline()),
  );

  let dialogEl: HTMLDialogElement | undefined;

  onMount(() => {
    dialogEl?.showModal();
  });

  onCleanup(() => {
    dialogEl?.close();
  });

  async function submit(e: Event): Promise<void> {
    e.preventDefault();
    if (!canSubmit()) return;
    setBusy(true);
    try {
      const result = await deriveTaskFromEvent({
        eventId: props.eventId,
        mode: mode(),
        scope: scope(),
        titleOverride: title().trim() !== props.defaults.summary ? title().trim() : undefined,
        deadlineOverride: deadline() !== props.defaults.startDate ? deadline() : undefined,
      });
      showToast('Task aus Termin erstellt.', 'success');
      props.onDerived?.(result.task_id);
      props.onClose();
      navigate(`/w/${props.workspaceId}/task/${result.task_id}`);
    } catch (err) {
      showToast(translateDbError(err, 'Ableitung fehlgeschlagen.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogEl}
      class="overlay-modal"
      aria-labelledby="derive-task-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy()) props.onClose();
      }}
    >
      <button
        type="button"
        class="overlay-modal-backdrop-closer"
        onClick={() => {
          if (!busy()) props.onClose();
        }}
        aria-label="Schliessen"
        tabIndex={-1}
      />
      <div class="overlay-card">
        <header class="overlay-head">
          <h3 id="derive-task-title">Task aus Termin ableiten</h3>
          <button
            type="button"
            class="overlay-close"
            onClick={() => !busy() && props.onClose()}
            aria-label="Schliessen"
            disabled={busy()}
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <form onSubmit={submit}>
          <div class="overlay-body">
            <label class="login-field">
              <span>Titel</span>
              <input
                class="input"
                type="text"
                value={title()}
                onInput={(e) => setTitle(e.currentTarget.value)}
                maxlength={200}
                required
              />
            </label>
            <label class="login-field">
              <span>Deadline</span>
              <input
                class="input"
                type="date"
                value={deadline()}
                onInput={(e) => setDeadline(e.currentTarget.value)}
                required
              />
            </label>

            <fieldset class="derive-mode-group">
              <legend>Sync-Mode</legend>
              <label class="derive-mode-option">
                <input
                  type="radio"
                  name="mode"
                  checked={mode() === 'snapshot'}
                  onChange={() => setMode('snapshot')}
                />
                <span>
                  <strong>Snapshot</strong> — Kopie, danach unabhaengig
                </span>
                <small class="hint">
                  Aenderungen am externen Termin beruehren die Task NICHT mehr.
                </small>
              </label>
              <label class="derive-mode-option">
                <input
                  type="radio"
                  name="mode"
                  checked={mode() === 'live'}
                  onChange={() => setMode('live')}
                />
                <span>
                  <strong>Live verbunden</strong> — Sync folgt
                </span>
                <small class="hint">
                  Wenn der externe Termin verschoben wird, verschiebt sich auch die Task. Eigene
                  Aenderungen am Task-Inhalt bleiben erhalten.
                </small>
              </label>
            </fieldset>

            <Show when={props.defaults.isRecurring}>
              <fieldset class="derive-mode-group">
                <legend>Serien-Scope</legend>
                <label class="derive-mode-option">
                  <input
                    type="radio"
                    name="scope"
                    checked={scope() === 'instance'}
                    onChange={() => setScope('instance')}
                  />
                  <span>
                    <strong>Nur diese Instanz</strong>
                  </span>
                  <small class="hint">
                    Eine einzelne Task fuer den gewaehlten Termin — ohne Wiederholung.
                  </small>
                </label>
                <label class="derive-mode-option">
                  <input
                    type="radio"
                    name="scope"
                    checked={scope() === 'series'}
                    onChange={() => setScope('series')}
                  />
                  <span>
                    <strong>Komplette Serie</strong>
                  </span>
                  <small class="hint">Recurring-Task, die an jedem Serien-Termin erscheint.</small>
                </label>
              </fieldset>
            </Show>

            <Show when={props.defaults.isRange}>
              <p class="hint">
                Mehrtaegiger Termin ({props.defaults.startDate} → {props.defaults.endDate}). Die
                Task wird auf den Start-Tag gesetzt; das Ende erscheint als Hinweis in der
                Beschreibung.
              </p>
            </Show>
          </div>

          <footer class="overlay-foot">
            <button
              type="button"
              class="btn btn-subtle"
              onClick={() => !busy() && props.onClose()}
              disabled={busy()}
            >
              Abbrechen
            </button>
            <button type="submit" class="btn btn-primary lift" disabled={!canSubmit()}>
              {busy() ? 'Erstelle…' : 'Task erstellen'}
            </button>
          </footer>
        </form>
      </div>
    </dialog>
  );
};

export default DeriveTaskModal;
