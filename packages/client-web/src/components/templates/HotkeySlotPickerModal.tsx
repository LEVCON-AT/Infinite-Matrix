// Welle WV.C.1 — Hotkey-Slot-Picker mit Konflikt-Check.
//
// Konzept §7.1 — Aktion „Hotkey-Slot zuweisen". Slot-Picker (1-9).
// Bei Override: Confirm-Modal „Slot N ist belegt mit Vorlage X —
// ueberschreiben?".
//
// Auflosung (Konzept §6.4): user_hotkey_slots schlaegt
// workspace_hotkey_slots. Owner kann Workspace-Slot setzen, jeder
// User kann eigenen User-Override.

import { type Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { showConfirm } from '../../lib/dialog';
import { translateDbError } from '../../lib/errors';
import {
  clearUserHotkeySlot,
  clearWorkspaceHotkeySlot,
  setUserHotkeySlot,
  setWorkspaceHotkeySlot,
} from '../../lib/hotkey-slots';
import { showToast } from '../../lib/toasts';
import type {
  FeatureTemplateRow,
  UserHotkeySlotRow,
  WorkspaceHotkeySlotRow,
} from '../../lib/types';
import Icon from '../Icon';

export type HotkeySlotPickerModalProps = {
  template: FeatureTemplateRow;
  workspaceId: string;
  userId: string | null;
  workspaceSlots: ReadonlyArray<WorkspaceHotkeySlotRow>;
  userSlots: ReadonlyArray<UserHotkeySlotRow>;
  templates: ReadonlyArray<FeatureTemplateRow>;
  canSetWorkspaceSlot: boolean;
  onChanged: () => void;
  onClose: () => void;
};

const HotkeySlotPickerModal: Component<HotkeySlotPickerModalProps> = (p) => {
  let dialogEl: HTMLDialogElement | undefined;

  // Default-Scope: Workspace fuer Owner, sonst User-privat.
  const [scope, setScope] = createSignal<'workspace' | 'user'>(
    p.canSetWorkspaceSlot ? 'workspace' : 'user',
  );
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    dialogEl?.showModal();
  });
  onCleanup(() => {
    dialogEl?.close();
  });

  const slotsRange = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

  function templateAtSlot(slot: number): FeatureTemplateRow | null {
    if (scope() === 'workspace') {
      const ws = p.workspaceSlots.find((r) => r.slot === slot);
      if (!ws) return null;
      return p.templates.find((t) => t.id === ws.template_id) ?? null;
    }
    const user = p.userSlots.find((r) => r.slot === slot && r.user_id === p.userId);
    if (!user) return null;
    return p.templates.find((t) => t.id === user.template_id) ?? null;
  }

  function currentSlotForTemplate(): number | null {
    if (scope() === 'workspace') {
      const ws = p.workspaceSlots.find((r) => r.template_id === p.template.id);
      return ws?.slot ?? null;
    }
    const u = p.userSlots.find((r) => r.template_id === p.template.id && r.user_id === p.userId);
    return u?.slot ?? null;
  }

  async function handleAssign(slot: number): Promise<void> {
    if (busy()) return;
    const occupant = templateAtSlot(slot);
    if (occupant && occupant.id !== p.template.id) {
      const confirmed = await showConfirm({
        title: 'Slot ueberschreiben?',
        message: `Slot ${slot} ist belegt mit „${occupant.name}". Mit „${p.template.name}" ueberschreiben?`,
        variant: 'warning',
        confirmLabel: 'Ueberschreiben',
      });
      if (!confirmed) return;
    }
    setBusy(true);
    try {
      if (scope() === 'workspace') {
        await setWorkspaceHotkeySlot({
          workspaceId: p.workspaceId,
          slot,
          templateId: p.template.id,
          setBy: p.userId,
        });
        showToast(`Workspace-Slot ${slot} → „${p.template.name}".`, 'success');
      } else {
        if (!p.userId) throw new Error('User-ID fehlt — Slot kann nicht gesetzt werden.');
        await setUserHotkeySlot({
          userId: p.userId,
          workspaceId: p.workspaceId,
          slot,
          templateId: p.template.id,
        });
        showToast(`Eigener Slot ${slot} → „${p.template.name}".`, 'success');
      }
      p.onChanged();
      p.onClose();
    } catch (err) {
      console.error('setHotkeySlot:', err);
      showToast(translateDbError(err, 'Slot konnte nicht gesetzt werden.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleClearCurrent(): Promise<void> {
    if (busy()) return;
    setBusy(true);
    try {
      if (scope() === 'workspace') {
        const ws = p.workspaceSlots.find((r) => r.template_id === p.template.id);
        if (!ws) return;
        await clearWorkspaceHotkeySlot(ws.id);
      } else {
        const u = p.userSlots.find(
          (r) => r.template_id === p.template.id && r.user_id === p.userId,
        );
        if (!u) return;
        await clearUserHotkeySlot(u.id);
      }
      showToast('Slot freigegeben.', 'success');
      p.onChanged();
      p.onClose();
    } catch (err) {
      console.error('clearHotkeySlot:', err);
      showToast(translateDbError(err, 'Slot konnte nicht freigegeben werden.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const currentSlot = () => currentSlotForTemplate();

  return (
    <dialog
      ref={(el) => {
        dialogEl = el;
      }}
      class="overlay-modal"
      aria-labelledby="hotkey-slot-modal-title"
      onCancel={(e) => {
        e.preventDefault();
        p.onClose();
      }}
    >
      <button
        type="button"
        class="overlay-modal-backdrop-closer"
        onClick={p.onClose}
        aria-label="Schliessen"
        tabIndex={-1}
      />
      <div class="overlay-card">
        <header class="overlay-head">
          <h3 id="hotkey-slot-modal-title">Hotkey-Slot zuweisen</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div class="adapter-dialog-form">
          <p class="hotkey-slot-summary">
            Vorlage <strong>{p.template.name}</strong>
          </p>

          <Show when={p.canSetWorkspaceSlot}>
            <div class="hotkey-slot-scope">
              <label>
                <input
                  type="radio"
                  name="scope"
                  value="workspace"
                  checked={scope() === 'workspace'}
                  onChange={() => setScope('workspace')}
                />
                <span>Workspace-weit (alle Mitglieder, Owner-Pfad)</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="scope"
                  value="user"
                  checked={scope() === 'user'}
                  onChange={() => setScope('user')}
                />
                <span>Nur fuer mich (User-Override)</span>
              </label>
            </div>
          </Show>

          <div class="hotkey-slot-grid">
            <For each={slotsRange}>
              {(slot) => {
                const occupant = templateAtSlot(slot);
                const isCurrent = currentSlot() === slot;
                return (
                  <button
                    type="button"
                    class="hotkey-slot-cell"
                    classList={{ active: isCurrent, occupied: !!occupant && !isCurrent }}
                    disabled={busy()}
                    onClick={() => void handleAssign(slot)}
                    aria-label={`Slot ${slot}${occupant ? ` (belegt: ${occupant.name})` : ''}`}
                    title={occupant ? occupant.name : `Slot ${slot} (frei)`}
                  >
                    <span class="hotkey-slot-num">{slot}</span>
                    <Show when={occupant} fallback={<span class="hotkey-slot-empty">leer</span>}>
                      {(t) => <span class="hotkey-slot-occupant">{t().name}</span>}
                    </Show>
                  </button>
                );
              }}
            </For>
          </div>

          <Show when={currentSlot()}>
            {(slot) => (
              <p class="hotkey-slot-current-hint">
                Aktuell auf Slot <strong>{slot()}</strong> (
                {scope() === 'workspace' ? 'Workspace' : 'eigen'}).
              </p>
            )}
          </Show>

          <footer class="adapter-dialog-actions">
            <Show when={currentSlot()}>
              <button
                type="button"
                class="btn-danger-subtle"
                disabled={busy()}
                onClick={() => void handleClearCurrent()}
              >
                Slot freigeben
              </button>
            </Show>
            <button type="button" class="btn-secondary" onClick={p.onClose}>
              Schliessen
            </button>
          </footer>
        </div>
      </div>
    </dialog>
  );
};

export default HotkeySlotPickerModal;
