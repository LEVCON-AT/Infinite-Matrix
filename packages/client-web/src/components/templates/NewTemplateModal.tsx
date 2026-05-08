// Welle WV.C.1 — „Neue Vorlage" Modal.
//
// Konzept §7.1 — Neue Vorlage anlegen mit Felder Name + Symbol +
// Beschreibung + Hotkey-Slot + Sichtbarkeit (Workspace / privat).
// V1 ohne „Aus existing Cell-Feature"-Pfad — der lebt als Pfad B
// (§7.2, Sub-Sprint C.2 Save-as-Template Edit-Mode-Action).

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import Icon from '../Icon';

export type NewTemplateInput = {
  name: string;
  symbol: string | null;
  description: string | null;
  visibility: 'workspace' | 'user';
  hotkeySlot: number | null;
};

export type NewTemplateModalProps = {
  canChooseVisibility: boolean;
  onSubmit: (input: NewTemplateInput) => void | Promise<void>;
  onClose: () => void;
};

const NewTemplateModal: Component<NewTemplateModalProps> = (p) => {
  let dialogEl: HTMLDialogElement | undefined;

  const [name, setName] = createSignal('');
  const [symbol, setSymbol] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [visibility, setVisibility] = createSignal<'workspace' | 'user'>(
    p.canChooseVisibility ? 'workspace' : 'user',
  );
  const [hotkeySlot, setHotkeySlot] = createSignal<string>('');
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    dialogEl?.showModal();
    dialogEl?.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
  });
  onCleanup(() => {
    dialogEl?.close();
  });

  const isValid = () => name().trim().length > 0;

  async function handleSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (busy() || !isValid()) return;
    setBusy(true);
    try {
      const slotRaw = hotkeySlot().trim();
      const slot = slotRaw ? Number(slotRaw) : Number.NaN;
      await p.onSubmit({
        name: name().trim(),
        symbol: symbol().trim() || null,
        description: description().trim() || null,
        visibility: visibility(),
        hotkeySlot: Number.isInteger(slot) && slot >= 1 && slot <= 9 ? slot : null,
      });
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
      aria-labelledby="new-template-modal-title"
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
          <h3 id="new-template-modal-title">Neue Vorlage</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>

        <form class="adapter-dialog-form" onSubmit={handleSubmit}>
          <div class="adapter-dialog-field">
            <label class="adapter-dialog-field-label" for="new-template-name">
              Name<span class="adapter-dialog-field-required">*</span>
            </label>
            <input
              id="new-template-name"
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
            <label class="adapter-dialog-field-label" for="new-template-symbol">
              Symbol
            </label>
            <input
              id="new-template-symbol"
              type="text"
              class="adapter-dialog-input"
              value={symbol()}
              placeholder="Heroicon-Name (z.B. document-text, view-columns)"
              onInput={(e) => setSymbol(e.currentTarget.value)}
            />
            <span class="adapter-dialog-field-hint">
              Bekannte Heroicons: view-columns, list-bullet, information-circle, sparkles,
              document-text, calendar, link, tag, eye, envelope.
            </span>
          </div>

          <div class="adapter-dialog-field">
            <label class="adapter-dialog-field-label" for="new-template-desc">
              Beschreibung
            </label>
            <textarea
              id="new-template-desc"
              class="adapter-dialog-input adapter-dialog-textarea"
              value={description()}
              onInput={(e) => setDescription(e.currentTarget.value)}
              rows={2}
            />
          </div>

          <div class="adapter-dialog-field">
            <label class="adapter-dialog-field-label" for="new-template-slot">
              Hotkey-Slot (1-9)
            </label>
            <input
              id="new-template-slot"
              type="number"
              min={1}
              max={9}
              class="adapter-dialog-input"
              value={hotkeySlot()}
              placeholder="leer lassen wenn kein Slot"
              onInput={(e) => setHotkeySlot(e.currentTarget.value)}
            />
            <span class="adapter-dialog-field-hint">
              Optional. Konflikt-Check beim Setzen — bestehende Belegung bleibt im Picker
              editierbar.
            </span>
          </div>

          <Show when={p.canChooseVisibility}>
            <div class="adapter-dialog-field">
              <span class="adapter-dialog-field-label">Sichtbarkeit</span>
              <div class="new-template-visibility-row">
                <label class="new-template-visibility-option">
                  <input
                    type="radio"
                    name="visibility"
                    value="workspace"
                    checked={visibility() === 'workspace'}
                    onChange={() => setVisibility('workspace')}
                  />
                  <span>Workspace (alle Mitglieder)</span>
                </label>
                <label class="new-template-visibility-option">
                  <input
                    type="radio"
                    name="visibility"
                    value="user"
                    checked={visibility() === 'user'}
                    onChange={() => setVisibility('user')}
                  />
                  <span>Nur ich</span>
                </label>
              </div>
            </div>
          </Show>

          <footer class="adapter-dialog-actions">
            <button type="button" class="btn-secondary" onClick={p.onClose}>
              Abbrechen
            </button>
            <button type="submit" class="btn-primary" disabled={busy() || !isValid()}>
              Anlegen
            </button>
          </footer>
        </form>
      </div>
    </dialog>
  );
};

export default NewTemplateModal;
