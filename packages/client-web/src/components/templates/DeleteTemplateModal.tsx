// Welle WV.C.1 — Loesch-Modal mit „N Cells"-Feedback.
//
// Konzept §7.1 — Aktion „Loeschen mit Feedback" (Pflicht). Modal zeigt:
//   - Vorlagen-Name + Anzahl der Cells, die die Vorlage verwenden.
//   - Optionen:
//     a) Cells leeren — Cell-Instanzen verlieren Widgets, bleiben als
//        Blank-Cell zurueck.
//     b) Cells konvertieren zu Blank-Feature — Layout mit Overrides
//        eingefroren, Cell-Instanz wird Blank-Vorlage.
//     c) Abbrechen.
//
// V1: nur (a) Cells leeren + Hard-Delete der Vorlage. (b) wird in
// Welle C.6 nachgereicht (braucht Snapshot-Helper). pushUndo + showUndoToast
// fuer Vorlage-Restore (Sections + Widgets bleiben durch FK-Cascade weg —
// V1-Undo kann nur die Vorlagen-Row wiederherstellen, das Layout muss
// neu aus Snapshot reapplied werden). Snapshot-Restore-Pfad ist
// ein Adjacent-Cleanup-TODO.

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { translateDbError } from '../../lib/errors';
import { deleteFeatureTemplate } from '../../lib/templates';
import { showToast, showUndoToast } from '../../lib/toasts';
import type { FeatureTemplateRow } from '../../lib/types';
import Icon from '../Icon';

export type DeleteTemplateModalProps = {
  template: FeatureTemplateRow;
  workspaceId: string;
  usageCount: number;
  onDeleted: () => void;
  onClose: () => void;
};

const DeleteTemplateModal: Component<DeleteTemplateModalProps> = (p) => {
  let dialogEl: HTMLDialogElement | undefined;
  const [busy, setBusy] = createSignal(false);

  // V1: nur Default „Cells leeren". V1.5: Toggle „convert to blank".
  const [strategy] = createSignal<'empty' | 'convert'>('empty');

  onMount(() => {
    dialogEl?.showModal();
  });
  onCleanup(() => {
    dialogEl?.close();
  });

  const isPlatform = () => p.template.visibility === 'platform';

  async function handleDelete(): Promise<void> {
    if (busy() || isPlatform()) return;
    setBusy(true);
    try {
      // FK-Cascade: cell_template_instances + cell_widget_overrides
      // gehen automatisch mit. V1 kein convert-Pfad.
      await deleteFeatureTemplate(p.template.id);
      // V1-Undo: nur Vorlagen-Row wiederherstellen (Sections/Widgets
      // bleiben weg). Praktischer Restore-Pfad fuer V1.5 — aktuell
      // zeigt Toast einen Hinweis ohne Action.
      showUndoToast(`Vorlage „${p.template.name}" geloescht`, () => {
        showToast(
          'Undo nicht moeglich — Vorlagen-Layout wird in V1.5 als Restore-Snapshot abgelegt.',
          'info',
        );
      });
      p.onDeleted();
    } catch (err) {
      console.error('deleteFeatureTemplate:', err);
      showToast(translateDbError(err, 'Vorlage konnte nicht geloescht werden.'), 'error');
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
      aria-labelledby="delete-template-modal-title"
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
          <h3 id="delete-template-modal-title">Vorlage loeschen</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div class="adapter-dialog-form">
          <Show when={isPlatform()}>
            <p class="delete-template-warning">
              Plattform-Vorlagen koennen nicht geloescht werden.
            </p>
          </Show>
          <Show when={!isPlatform()}>
            <p class="delete-template-summary">
              Vorlage <strong>{p.template.name}</strong> wird verwendet von{' '}
              <strong>{p.usageCount} Cells</strong>.
            </p>

            <Show when={p.usageCount > 0}>
              <div class="delete-template-options">
                <label
                  class="delete-template-option"
                  classList={{ active: strategy() === 'empty' }}
                >
                  <input type="radio" checked readOnly />
                  <div>
                    <strong>Cells leeren</strong>
                    <span>
                      Cell-Instanzen verlieren ihr Widget-Layout und bleiben als leere Cells mit
                      Feature-Slot zurueck.
                    </span>
                  </div>
                </label>
                {/* Convert-Pfad V1.5 — siehe Konzept §7.1 + Sub-Sprint C.6. */}
              </div>
            </Show>

            <p class="delete-template-irrev">
              Loeschen ist <strong>destruktiv</strong>. Cell-Overrides werden via Cascade entfernt.
              Layout-Restore folgt in V1.5.
            </p>
          </Show>

          <footer class="adapter-dialog-actions">
            <button type="button" class="btn-secondary" onClick={p.onClose}>
              Abbrechen
            </button>
            <button
              type="button"
              class="btn-danger"
              disabled={busy() || isPlatform()}
              onClick={() => void handleDelete()}
            >
              {busy() ? 'Loescht…' : 'Loeschen'}
            </button>
          </footer>
        </div>
      </div>
    </dialog>
  );
};

export default DeleteTemplateModal;
