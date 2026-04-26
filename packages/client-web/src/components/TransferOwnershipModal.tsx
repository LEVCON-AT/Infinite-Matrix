// TransferOwnershipModal — Phase 1 (P1.B.4).
//
// Eigentums-Uebertragung an einen aktiven Member. Owner-only-Aktion,
// pruefen tut die RPC selbst (transfer_workspace_ownership in Migration
// 015). Frontend-Gating in WorkspaceGeneral via role==='owner'.
//
// Confirm-Pattern: Member-Dropdown + Email-Type-Confirm. Submit-Button
// disabled bis selected !== null && confirmInput case-insensitive
// matched die Email des selected Members. Damit ist ein versehentliches
// "ich klicke einfach drauf"-Risiko praktisch ausgeschlossen.
//
// Toast-Strategie (Memory feedback_user_facing_toasts): catch ruft
// console.error('transferWorkspaceOwnership:', err) + showToast mit
// translateLifecycleError. Endkundentauglich, kein Tech-Jargon.

import { type Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { installFocusRestore, installFocusTrap } from '../lib/dialog';
import type { WorkspaceMember } from '../lib/members';
import { showToast } from '../lib/toasts';
import { transferWorkspaceOwnership, translateLifecycleError } from '../lib/workspaces';
import Icon from './Icon';

export type TransferOwnershipModalProps = {
  workspaceId: string;
  workspaceName: string;
  // Bereits gefiltert auf aktive Non-Self-Members. Owner-Self ist auch
  // nicht drin (waere ja Sinn-frei — sich selbst zu uebertragen).
  members: WorkspaceMember[];
  onClose: () => void;
  onTransferred: () => void;
};

const TransferOwnershipModal: Component<TransferOwnershipModalProps> = (p) => {
  const [selectedId, setSelectedId] = createSignal<string>('');
  const [confirmInput, setConfirmInput] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  let containerEl: HTMLDivElement | undefined;

  const selectedMember = createMemo(() => p.members.find((m) => m.user_id === selectedId()));

  const canSubmit = () => {
    if (submitting()) return false;
    const m = selectedMember();
    if (!m || !m.email) return false;
    return confirmInput().trim().toLowerCase() === m.email.toLowerCase();
  };

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
    const target = selectedMember();
    if (!target) return;
    setSubmitting(true);
    try {
      await transferWorkspaceOwnership(p.workspaceId, target.user_id);
      showToast(`Eigentum an ${target.email ?? 'neuen Eigentuemer'} uebertragen.`, 'success');
      p.onTransferred();
    } catch (err) {
      console.error('transferWorkspaceOwnership:', err);
      showToast(translateLifecycleError(err, 'Uebertragung fehlgeschlagen.'), 'error');
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
        aria-label="Eigentum uebertragen"
      >
        <header class="overlay-head">
          <h3>Eigentum uebertragen</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>
        <form onSubmit={submit}>
          <div class="overlay-body">
            <p class="hint">
              Du uebergibst die Eigentuemerschaft des Workspaces{' '}
              <strong>„{p.workspaceName}"</strong>. Du bleibst als Admin im Workspace — verlierst
              aber das Recht, ihn zu loeschen oder weiter zu uebertragen.
            </p>

            <Show
              when={p.members.length > 0}
              fallback={
                <p class="hint warn-hint">
                  <Icon name="information-circle" size={14} />
                  <span>
                    Es gibt keine anderen aktiven Mitglieder, an die du uebertragen koenntest. Lade
                    zuerst jemanden ein, oder reaktiviere ein deaktiviertes Mitglied.
                  </span>
                </p>
              }
            >
              <label class="lifecycle-field">
                <span class="lifecycle-field-label">Neuer Eigentuemer</span>
                <select
                  class="settings-select"
                  value={selectedId()}
                  onChange={(e) => {
                    setSelectedId(e.currentTarget.value);
                    setConfirmInput('');
                  }}
                  required
                >
                  <option value="" disabled>
                    — Mitglied auswaehlen —
                  </option>
                  <For each={p.members}>
                    {(m) => (
                      <option value={m.user_id}>
                        {m.email ?? m.user_id.slice(0, 8)} ({m.role})
                      </option>
                    )}
                  </For>
                </select>
              </label>

              <Show when={selectedMember()}>
                {(m) => (
                  <label class="lifecycle-field">
                    <span class="lifecycle-field-label">
                      Tippe zum Bestaetigen die E-Mail von <code>{m().email ?? '?'}</code>:
                    </span>
                    <input
                      type="email"
                      class="settings-input"
                      value={confirmInput()}
                      onInput={(e) => setConfirmInput(e.currentTarget.value)}
                      placeholder={m().email ?? ''}
                      autocomplete="off"
                      spellcheck={false}
                    />
                  </label>
                )}
              </Show>
            </Show>
          </div>
          <footer class="overlay-foot">
            <button type="button" class="btn-subtle" onClick={p.onClose}>
              Abbrechen
            </button>
            <button type="submit" class="btn-c" disabled={!canSubmit()}>
              <Icon name="arrow-top-right-on-square" size={14} />
              <span>{submitting() ? 'Uebertrage…' : 'Eigentum uebertragen'}</span>
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};

export default TransferOwnershipModal;
