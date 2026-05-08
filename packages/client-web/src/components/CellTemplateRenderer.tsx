// Welle WV.A.6 — CellTemplateRenderer (Top-Level).
//
// Rendert pro Cell alle aktiven Vorlagen-Instanzen. Eine Cell kann
// mehrere Vorlagen halten (Konzept §9.A.6 Multi-Root) — wir rendern
// sie aufeinanderfolgend, sortiert nach applied_at ASC.
//
// Edit-Mode-Affordances (Zero-Shift, Memory `feedback_zero_shift_edit_mode.md`):
//   - „Vorlage entfernen"-Button als Overlay (nicht im Layout-Flow)
//   - „Update verfuegbar"-Hint bei isLayoutOutdated
//   - Reset-Override-Button auf jedem Widget mit hasOverride
//
// Konsumenten:
//   - Welle B/C: CellRenderer wird durch diesen Component ersetzt
//     wenn die Cell mind. eine cell_template_instance hat.
//   - V1: Component existiert als Foundation, Wiring an MatrixView/
//     CellPage erfolgt in Welle C wenn cell.features → cell_template_instances
//     migriert wird.

import { type Component, For, Show } from 'solid-js';
import { resetWidgetOverride } from '../lib/cell-templates';
import { translateDbError } from '../lib/errors';
import { showToast } from '../lib/toasts';
import { type CellTemplateView, loadCellTemplateInstances } from '../lib/widget-foundation';
import type { WidgetFoundationSources } from '../lib/widget-foundation';
import Icon from './Icon';
import TemplateSectionRenderer from './TemplateSectionRenderer';

export type CellTemplateRendererProps = {
  cellId: string;
  sources: WidgetFoundationSources;
  editMode?: boolean;
  // Optional: Caller kann selbst entscheiden was bei „Vorlage entfernen"
  // passiert (Confirm-Dialog, Undo, etc.). V1 ohne onRemoveInstance →
  // Button nicht angezeigt.
  onRemoveInstance?: (instance: CellTemplateView) => void;
  // Optional: „Update verfuegbar" akzeptieren (Re-Baseline).
  // Caller ruft setInstanceLayoutVersion mit aktueller template.layout_version.
  onAcceptLayoutUpdate?: (instance: CellTemplateView) => void;
};

const CellTemplateRenderer: Component<CellTemplateRendererProps> = (p) => {
  const views = () => loadCellTemplateInstances(p.cellId, p.sources);

  async function handleResetOverride(overrideId: string): Promise<void> {
    try {
      await resetWidgetOverride(overrideId);
      showToast('Vorlage wiederhergestellt', 'success');
    } catch (err) {
      showToast(translateDbError(err), 'error');
    }
  }

  return (
    <div class="cell-template-renderer" data-cell-id={p.cellId}>
      <For each={views()}>
        {(view) => (
          <article
            class="cell-template-instance"
            data-template-id={view.template.id}
            data-instance-id={view.instance.id}
            data-render-position={view.template.render_position}
          >
            <Show when={p.editMode || view.template.render_position === 'auto_under_features'}>
              <header class="cell-template-instance-head">
                <span class="cell-template-instance-name">{view.template.name}</span>
                <Show when={view.isLayoutOutdated && p.editMode}>
                  <button
                    type="button"
                    class="cell-template-update-hint"
                    title="Vorlage hat ein Update — anwenden?"
                    onClick={() => p.onAcceptLayoutUpdate?.(view)}
                  >
                    <Icon name="arrow-path" size={12} />
                    <span>Update</span>
                  </button>
                </Show>
                <Show when={p.editMode && p.onRemoveInstance}>
                  <button
                    type="button"
                    class="cell-template-remove"
                    title="Vorlage entfernen"
                    onClick={() => p.onRemoveInstance?.(view)}
                  >
                    <Icon name="x" size={12} />
                  </button>
                </Show>
              </header>
            </Show>
            <For each={view.sections}>
              {(section) => (
                <TemplateSectionRenderer
                  section={section}
                  editMode={p.editMode}
                  onResetOverride={handleResetOverride}
                />
              )}
            </For>
          </article>
        )}
      </For>
    </div>
  );
};

export default CellTemplateRenderer;
