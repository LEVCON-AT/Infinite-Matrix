// AiProviderList — Phase 2 Welle A.0.
//
// Liste der eigenen AI-Provider mit Add-/Edit-/Delete-/Default-Buttons.
// Lebt in routes/settings/AccountAi. Reload nach jeder Mutation via
// refetch-Callback (Resource-Pattern wie MembersList).

import { type Component, For, Show, createSignal } from 'solid-js';
import { PROVIDER_LABELS, deleteAiProvider, setAiProviderDefault } from '../lib/ai-providers';
import { showConfirm } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { showToast } from '../lib/toasts';
import type { AiProvider } from '../lib/types';
import AiProviderEditModal from './AiProviderEditModal';
import Icon from './Icon';
import { ModalTransition } from './ModalTransition';

export type AiProviderListProps = {
  providers: AiProvider[];
  onChange: () => void;
};

const AiProviderList: Component<AiProviderListProps> = (p) => {
  const [editing, setEditing] = createSignal<AiProvider | null>(null);
  const [adding, setAdding] = createSignal(false);
  const [busyId, setBusyId] = createSignal<string | null>(null);

  const handleSetDefault = async (provider: AiProvider) => {
    if (provider.is_default || busyId()) return;
    setBusyId(provider.id);
    try {
      await setAiProviderDefault(provider.id);
      showToast(`'${provider.label}' ist jetzt Standard.`, 'success');
      p.onChange();
    } catch (err) {
      console.error('setAiProviderDefault:', err);
      showToast(translateDbError(err, 'Standard konnte nicht gesetzt werden.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (provider: AiProvider) => {
    const ok = await showConfirm({
      title: 'Provider entfernen?',
      message: `'${provider.label}' wird entfernt. Wenn dies dein Standard-Provider war, kannst du danach einen anderen auswaehlen.`,
      variant: 'danger',
      confirmLabel: 'Entfernen',
      cancelLabel: 'Abbrechen',
    });
    if (!ok || busyId()) return;
    setBusyId(provider.id);
    try {
      await deleteAiProvider(provider.id);
      showToast(`'${provider.label}' entfernt.`, 'success');
      p.onChange();
    } catch (err) {
      console.error('deleteAiProvider:', err);
      showToast(translateDbError(err, 'Provider konnte nicht entfernt werden.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div class="ai-provider-list">
        <Show
          when={p.providers.length > 0}
          fallback={
            <p class="ai-provider-empty hint">
              Noch kein Provider hinterlegt. Klick auf "Provider hinzufuegen", um einen API-Key zu
              verbinden.
            </p>
          }
        >
          <ul class="ai-provider-rows">
            <For each={p.providers}>
              {(provider) => (
                <li class="ai-provider-row">
                  <div class="ai-provider-row-main">
                    <span class={`ai-provider-kind-chip ai-provider-kind-${provider.kind}`}>
                      {PROVIDER_LABELS[provider.kind]}
                    </span>
                    <div class="ai-provider-row-text">
                      <span class="ai-provider-row-label">
                        {provider.label}
                        <Show when={provider.is_default}>
                          <span class="ai-provider-default-chip" aria-label="Standard">
                            <Icon name="check" size={12} />
                            <span>Standard</span>
                          </span>
                        </Show>
                      </span>
                      <Show when={provider.model_name}>
                        {(m) => <span class="ai-provider-row-model">{m()}</span>}
                      </Show>
                    </div>
                  </div>
                  <div class="ai-provider-row-actions">
                    <Show when={!provider.is_default}>
                      <button
                        type="button"
                        class="btn-subtle btn-small"
                        title="Als Standard verwenden"
                        disabled={busyId() === provider.id}
                        onClick={() => void handleSetDefault(provider)}
                      >
                        Standard
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="btn-subtle btn-small"
                      title="Bearbeiten"
                      aria-label={`'${provider.label}' bearbeiten`}
                      disabled={busyId() === provider.id}
                      onClick={() => setEditing(provider)}
                    >
                      <Icon name="pencil" size={14} />
                    </button>
                    <button
                      type="button"
                      class="btn-subtle btn-small btn-danger-subtle"
                      title="Entfernen"
                      aria-label={`'${provider.label}' entfernen`}
                      disabled={busyId() === provider.id}
                      onClick={() => void handleDelete(provider)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <button type="button" class="btn-c ai-provider-add-btn" onClick={() => setAdding(true)}>
          <Icon name="plus" size={14} />
          <span>Provider hinzufuegen</span>
        </button>
      </div>
      <ModalTransition when={Boolean(editing())}>
        <Show when={editing()}>
          {(provider) => (
            <AiProviderEditModal
              provider={provider()}
              hasOtherProviders={p.providers.length > 1}
              onClose={() => setEditing(null)}
              onSaved={p.onChange}
            />
          )}
        </Show>
      </ModalTransition>
      <ModalTransition when={adding()}>
        <AiProviderEditModal
          provider={null}
          hasOtherProviders={p.providers.length > 0}
          onClose={() => setAdding(false)}
          onSaved={p.onChange}
        />
      </ModalTransition>
    </>
  );
};

export default AiProviderList;
