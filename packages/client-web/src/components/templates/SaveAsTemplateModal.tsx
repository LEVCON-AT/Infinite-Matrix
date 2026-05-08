// Welle WV.C.2 — Save-as-Template Edit-Mode-Action.
//
// Konzept §7.2 — Pfad B: aus existing Cell-Feature eine Vorlage erzeugen.
// Modal mit Felder Name + Symbol + Beschreibung + Hotkey-Slot + Sichtbarkeit
// + zwei Submit-Buttons:
//   - „Direkt speichern" — Snapshot wird sofort als Vorlage angelegt,
//     Modal schliesst.
//   - „Im Designer weiter editieren" — Vorlage angelegt + Sub-Route
//     Editor (V1-Stub: Toast „Designer in Vorbereitung").
//
// V1-Snapshot-Pfad ueber lib/save-as-template.ts: Legacy-Features
// (info/board/checklist/doc) werden in 1 Section + 1 Widget pro
// Feature kopiert. Atom-Inhalte werden NICHT uebernommen.

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { translateDbError } from '../../lib/errors';
import { saveAsTemplate } from '../../lib/save-as-template';
import { showToast } from '../../lib/toasts';
import type { CellRow, FeatureTemplateRow } from '../../lib/types';
import Icon, { type IconName } from '../Icon';
import IconPicker from '../IconPicker';

export type SaveAsTemplateModalProps = {
  workspaceId: string;
  ownerUserId: string | null;
  cell: CellRow;
  // Default-Name aus cell-data (z.B. cell-alias / row-label).
  defaultName?: string;
  canChooseVisibility: boolean;
  onSaved: (template: FeatureTemplateRow, openInDesigner: boolean) => void;
  onClose: () => void;
};

const SaveAsTemplateModal: Component<SaveAsTemplateModalProps> = (p) => {
  let dialogEl: HTMLDialogElement | undefined;

  const [name, setName] = createSignal(p.defaultName ?? '');
  const [symbol, setSymbol] = createSignal<IconName | null>(null);
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [description, setDescription] = createSignal('');
  const [visibility, setVisibility] = createSignal<'workspace' | 'user'>(
    p.canChooseVisibility ? 'workspace' : 'user',
  );
  const [hotkeySlot, setHotkeySlot] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    dialogEl?.showModal();
    dialogEl?.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
  });
  onCleanup(() => {
    dialogEl?.close();
  });

  const isValid = () => name().trim().length > 0;

  async function doSave(openDesigner: boolean): Promise<void> {
    if (!isValid() || busy()) return;
    setBusy(true);
    try {
      const slotRaw = hotkeySlot().trim();
      const slot = slotRaw ? Number(slotRaw) : Number.NaN;
      const tpl = await saveAsTemplate({
        workspaceId: p.workspaceId,
        ownerUserId: p.ownerUserId,
        cell: p.cell,
        name: name().trim(),
        symbol: symbol(),
        description: description().trim() || null,
        visibility: visibility(),
        hotkeySlot: Number.isInteger(slot) && slot >= 1 && slot <= 9 ? slot : null,
      });
      showToast(`Vorlage „${tpl.name}" angelegt.`, 'success');
      p.onSaved(tpl, openDesigner);
    } catch (err) {
      console.error('saveAsTemplate:', err);
      showToast(translateDbError(err, 'Vorlage konnte nicht gespeichert werden.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={(el) => {
        dialogEl = el;
      }}
      class="overlay-modal"
      aria-labelledby="save-as-template-modal-title"
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
          <h3 id="save-as-template-modal-title">Als Vorlage speichern</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>

        <form
          class="adapter-dialog-form"
          onSubmit={(e) => {
            e.preventDefault();
            void doSave(false);
          }}
        >
          <p class="save-as-template-hint">
            Layout + Widget-Toggles werden aus dieser Cell uebernommen. Atome (Karten, Items, Texte)
            bleiben Cell-spezifisch und werden nicht in die Vorlage kopiert.
          </p>

          <div class="adapter-dialog-field">
            <label class="adapter-dialog-field-label" for="save-template-name">
              Name<span class="adapter-dialog-field-required">*</span>
            </label>
            <input
              id="save-template-name"
              name="name"
              type="text"
              class="adapter-dialog-input"
              value={name()}
              placeholder="z.B. Vertragsdaten"
              onInput={(e) => setName(e.currentTarget.value)}
              required
            />
          </div>

          <div class="adapter-dialog-field">
            <span class="adapter-dialog-field-label">Symbol</span>
            <button
              type="button"
              class="symbol-picker-trigger"
              onClick={() => setPickerOpen(true)}
              aria-label="Symbol waehlen"
            >
              <span class="symbol-picker-trigger-icon">
                <Show when={symbol()} fallback={<Icon name="sparkles" size={16} />}>
                  {(s) => <Icon name={s()} size={18} />}
                </Show>
              </span>
              <Show
                when={symbol()}
                fallback={
                  <span class="symbol-picker-trigger-label symbol-picker-trigger-empty">
                    Auto (aus erstem Cell-Feature) — klicken zum Ueberschreiben
                  </span>
                }
              >
                {(s) => <span class="symbol-picker-trigger-label">{s()}</span>}
              </Show>
            </button>
          </div>

          <div class="adapter-dialog-field">
            <label class="adapter-dialog-field-label" for="save-template-desc">
              Beschreibung
            </label>
            <textarea
              id="save-template-desc"
              class="adapter-dialog-input adapter-dialog-textarea"
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
              rows={2}
            />
          </div>

          <div class="adapter-dialog-field">
            <label class="adapter-dialog-field-label" for="save-template-slot">
              Hotkey-Slot (1-9)
            </label>
            <input
              id="save-template-slot"
              type="number"
              min={1}
              max={9}
              class="adapter-dialog-input"
              value={hotkeySlot()}
              placeholder="leer lassen wenn kein Slot"
              onInput={(e) => setHotkeySlot(e.currentTarget.value)}
            />
          </div>

          <Show when={p.canChooseVisibility}>
            <div class="adapter-dialog-field">
              <span class="adapter-dialog-field-label">Sichtbarkeit</span>
              <div class="new-template-visibility-row">
                <label class="new-template-visibility-option">
                  <input
                    type="radio"
                    name="save-template-visibility"
                    value="workspace"
                    checked={visibility() === 'workspace'}
                    onChange={() => setVisibility('workspace')}
                  />
                  <span>Workspace (alle Mitglieder)</span>
                </label>
                <label class="new-template-visibility-option">
                  <input
                    type="radio"
                    name="save-template-visibility"
                    value="user"
                    checked={visibility() === 'user'}
                    onChange={() => setVisibility('user')}
                  />
                  <span>Nur ich</span>
                </label>
              </div>
            </div>
          </Show>

          <footer class="adapter-dialog-actions save-as-template-actions">
            <button type="button" class="btn-secondary" onClick={p.onClose}>
              Abbrechen
            </button>
            <button
              type="button"
              class="btn-subtle"
              onClick={() => void doSave(true)}
              disabled={busy() || !isValid()}
            >
              Im Designer weiter editieren
            </button>
            <button type="submit" class="btn-primary" disabled={busy() || !isValid()}>
              {busy() ? 'Speichert…' : 'Direkt speichern'}
            </button>
          </footer>
        </form>
      </div>
      <Show when={pickerOpen()}>
        <IconPicker
          value={symbol()}
          onSelect={(icon) => {
            setSymbol(icon);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      </Show>
    </dialog>
  );
};

export default SaveAsTemplateModal;
