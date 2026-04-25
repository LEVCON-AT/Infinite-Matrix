// Konfigurations-Modal fuer die Checklist-Close-Action. Vier Typen
// (none/toast/jump/webhook/mail) + typspezifische Felder. Gespeichert
// wird als jsonb in checklists.action via setChecklistAction.

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { type ChecklistAction, parseChecklistAction } from '../lib/checklist-action';
import { installFocusRestore } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { setChecklistAction } from '../lib/mutations';
import { showToast } from '../lib/toasts';
import { bindAliasAutocomplete } from '../lib/use-alias-autocomplete';
import Icon from './Icon';

type Props = {
  workspaceId: string;
  checklistId: string;
  currentAction: unknown;
  onClose: () => void;
  onSaved?: () => void;
};

const ChecklistActionModal: Component<Props> = (p) => {
  const initial = parseChecklistAction(p.currentAction);
  const [type, setType] = createSignal<ChecklistAction['type']>(initial.type);
  const [message, setMessage] = createSignal(
    initial.type === 'toast' || initial.type === 'webhook' ? (initial.message ?? '') : '',
  );
  const [target, setTarget] = createSignal(initial.type === 'jump' ? initial.target : '');
  const [url, setUrl] = createSignal(initial.type === 'webhook' ? initial.url : '');
  const [to, setTo] = createSignal(initial.type === 'mail' ? initial.to : '');
  const [subject, setSubject] = createSignal(
    initial.type === 'mail' ? (initial.subject ?? '') : '',
  );
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    onCleanup(installFocusRestore());
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  function buildAction(): ChecklistAction {
    switch (type()) {
      case 'none':
        return { type: 'none' };
      case 'toast':
        return { type: 'toast', message: message().trim() };
      case 'jump':
        return { type: 'jump', target: target().trim() };
      case 'webhook':
        return {
          type: 'webhook',
          url: url().trim(),
          message: message().trim(),
        };
      case 'mail':
        return {
          type: 'mail',
          to: to().trim(),
          subject: subject().trim(),
        };
    }
  }

  async function save() {
    if (busy()) return;
    const action = buildAction();
    // Minimale Validierung pro Typ.
    if (action.type === 'jump' && !action.target) {
      showToast('Bitte Alias fuer Jump angeben.', 'error');
      return;
    }
    if (action.type === 'webhook' && !action.url) {
      showToast('Bitte Webhook-URL angeben.', 'error');
      return;
    }
    if (action.type === 'mail' && !action.to) {
      showToast('Bitte Mail-Adresse angeben.', 'error');
      return;
    }
    setBusy(true);
    try {
      await setChecklistAction(
        p.checklistId,
        action.type === 'none' ? null : (action as unknown as Record<string, unknown>),
      );
      showToast('Close-Aktion gespeichert.', 'success');
      p.onSaved?.();
      p.onClose();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Ctrl/Cmd+Enter committet — konsistent zu ChecklistPastePopup.
  function onFormKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void save();
    }
  }

  return (
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
      onKeyDown={onFormKey}
    >
      <div
        class="overlay-card cl-action-card"
        // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> bewusst statt <dialog> — showModal() haette aufwendige Migration aller Modals zur Folge.
        role="dialog"
        aria-modal="true"
      >
        <header class="overlay-head">
          <h3>Close-Aktion</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div class="cl-action-body">
          <p class="cl-action-hint">
            Was passieren soll, nachdem die Checkliste abgeschlossen wurde.
          </p>
          <label class="cl2c-field">
            <span class="cl2c-field-label">Typ</span>
            <select
              class="cl2c-select"
              value={type()}
              onChange={(e) => setType(e.currentTarget.value as ChecklistAction['type'])}
            >
              <option value="none">keine</option>
              <option value="toast">Toast</option>
              <option value="jump">Jump (Alias)</option>
              <option value="webhook">Webhook (POST)</option>
              <option value="mail">Mail (mailto)</option>
            </select>
          </label>

          <Show when={type() === 'toast'}>
            <label class="cl2c-field">
              <span class="cl2c-field-label">Nachricht (optional)</span>
              <input
                type="text"
                class="cl2c-input"
                value={message()}
                onInput={(e) => setMessage(e.currentTarget.value)}
                placeholder="Standard: „Checkliste ... abgeschlossen."
              />
            </label>
          </Show>

          <Show when={type() === 'jump'}>
            <label class="cl2c-field">
              <span class="cl2c-field-label">Ziel-Alias</span>
              <input
                type="text"
                class="cl2c-input"
                value={target()}
                onInput={(e) => setTarget(e.currentTarget.value)}
                placeholder="^alias"
                ref={(el) => {
                  const cleanup = bindAliasAutocomplete(el, p.workspaceId);
                  onCleanup(cleanup);
                }}
              />
            </label>
          </Show>

          <Show when={type() === 'webhook'}>
            <label class="cl2c-field">
              <span class="cl2c-field-label">Webhook-URL (https)</span>
              <input
                type="url"
                class="cl2c-input"
                value={url()}
                onInput={(e) => setUrl(e.currentTarget.value)}
                placeholder="https://example.com/hook"
              />
            </label>
            <label class="cl2c-field">
              <span class="cl2c-field-label">Payload-Message (optional)</span>
              <input
                type="text"
                class="cl2c-input"
                value={message()}
                onInput={(e) => setMessage(e.currentTarget.value)}
              />
            </label>
            <p class="cl-action-hint">
              Achtung: Webhooks laufen best-effort aus dem Browser; CORS kann den Request
              blockieren.
            </p>
          </Show>

          <Show when={type() === 'mail'}>
            <label class="cl2c-field">
              <span class="cl2c-field-label">Empfaenger</span>
              <input
                type="email"
                class="cl2c-input"
                value={to()}
                onInput={(e) => setTo(e.currentTarget.value)}
                placeholder="name@example.com"
              />
            </label>
            <label class="cl2c-field">
              <span class="cl2c-field-label">Betreff (optional)</span>
              <input
                type="text"
                class="cl2c-input"
                value={subject()}
                onInput={(e) => setSubject(e.currentTarget.value)}
              />
            </label>
          </Show>
        </div>
        <footer class="overlay-foot cl2c-foot">
          <button type="button" class="btn-subtle" onClick={p.onClose}>
            Abbrechen
          </button>
          <button type="button" class="btn btn-p" onClick={save} disabled={busy()}>
            Speichern (Strg+Enter)
          </button>
        </footer>
      </div>
    </div>
  );
};

export default ChecklistActionModal;
