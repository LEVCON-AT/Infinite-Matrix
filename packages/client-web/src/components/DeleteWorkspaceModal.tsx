// DeleteWorkspaceModal — Phase 1 (P1.B.5).
//
// Hard-Delete des Workspaces. Owner-only-Aktion. Confirm via
// case-sensitive Type-To-Confirm: User muss den Workspace-Namen
// exakt abtippen, sonst bleibt der Submit-Button disabled.
//
// Kein Soft-Delete: DB-RPC ruft DELETE FROM workspaces, FK-CASCADE
// putzt den gesamten abhaengigen Bestand (siehe Migration 015 Header).
//
// Toast-Strategie (Memory feedback_user_facing_toasts): catch ruft
// console.error('deleteWorkspace:', err) + showToast mit
// translateLifecycleError. Endkundentauglich, kein Tech-Jargon.

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { installFocusRestore, installFocusTrap } from '../lib/dialog';
import { showToast } from '../lib/toasts';
import { deleteWorkspace, translateLifecycleError } from '../lib/workspaces';
import Icon from './Icon';

export type DeleteWorkspaceModalProps = {
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
  onDeleted: () => void;
};

const DeleteWorkspaceModal: Component<DeleteWorkspaceModalProps> = (p) => {
  const [confirmInput, setConfirmInput] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  let containerEl: HTMLDivElement | undefined;

  const canSubmit = () => !submitting() && confirmInput() === p.workspaceName;

  onMount(() => {
    const restoreFocus = installFocusRestore();
    onCleanup(restoreFocus);
    if (containerEl) {
      const releaseTrap = installFocusTrap(containerEl);
      onCleanup(releaseTrap);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!canSubmit()) return;
    setSubmitting(true);
    try {
      await deleteWorkspace(p.workspaceId, confirmInput());
      p.onDeleted();
    } catch (err) {
      console.error('deleteWorkspace:', err);
      showToast(translateLifecycleError(err, 'Loeschen fehlgeschlagen.'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop-Klick — Tastatur via ESC im onMount.
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        ref={(el) => {
          containerEl = el;
        }}
        class="overlay-card"
        // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> bewusst statt <dialog>.
        role="dialog"
        aria-modal="true"
        aria-label="Workspace loeschen"
      >
        <header class="overlay-head">
          <h3>Workspace loeschen</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>
        <form onSubmit={submit}>
          <div class="overlay-body">
            <p class="hint warn-hint">
              <Icon name="information-circle" size={14} />
              <span>
                Diese Aktion ist endgueltig. Alle Matrizen, Karten, Anhaenge, Mitgliedschaften und
                der Audit-Log werden mit dem Workspace geloescht und koennen nicht wiederhergestellt
                werden.
              </span>
            </p>
            <label class="lifecycle-field">
              <span class="lifecycle-field-label">
                Tippe zur Bestaetigung den Workspace-Namen <code>{p.workspaceName}</code> exakt ein:
              </span>
              <input
                type="text"
                class="settings-input"
                value={confirmInput()}
                onInput={(e) => setConfirmInput(e.currentTarget.value)}
                placeholder={p.workspaceName}
                autocomplete="off"
                spellcheck={false}
                autofocus
              />
            </label>
            <Show when={confirmInput().length > 0 && confirmInput() !== p.workspaceName}>
              <p class="hint lifecycle-field-error">
                Name stimmt noch nicht — Gross-/Kleinschreibung muss exakt passen.
              </p>
            </Show>
          </div>
          <footer class="overlay-foot">
            <button type="button" class="btn-subtle" onClick={p.onClose}>
              Abbrechen
            </button>
            <button type="submit" class="btn-danger" disabled={!canSubmit()}>
              <Icon name="trash" size={14} />
              <span>{submitting() ? 'Loesche…' : 'Endgueltig loeschen'}</span>
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};

export default DeleteWorkspaceModal;
