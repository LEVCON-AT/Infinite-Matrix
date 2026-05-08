// Welle WV.A.6 — CellTemplateRenderer (Top-Level).
// Welle WV.C.6 — Reset-to-Template + Layout-Update-Hint Default-Aktionen.
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
// Default-Aktionen (Welle WV.C.6):
//   - handleResetOverride: snapshot vor delete + showUndoToast
//     (Restore via upsertWidgetOverride mit dem Snapshot).
//   - handleAcceptLayoutUpdate: ruft setInstanceLayoutVersion mit
//     der aktuellen template.layout_version + showUndoToast.
//   - handleRemoveInstance (wenn `onRemoveInstance` nicht ueberschrieben):
//     ruft removeTemplateFromCell + showUndoToast mit applyTemplateToCell-
//     Restore-Snapshot.
//
// Konsumenten:
//   - Welle B/C: CellRenderer wird durch diesen Component ersetzt
//     wenn die Cell mind. eine cell_template_instance hat.
//   - V1: Component existiert als Foundation, Wiring an MatrixView/
//     CellPage erfolgt in Welle C wenn cell.features → cell_template_instances
//     migriert wird.

import { type Component, For, Show, createSignal } from 'solid-js';
import {
  applyTemplateToCell,
  removeTemplateFromCell,
  resetWidgetOverride,
  setInstanceLayoutVersion,
  upsertWidgetOverride,
} from '../lib/cell-templates';
import { translateDbError } from '../lib/errors';
import { showToast, showUndoToast } from '../lib/toasts';
import { type CellTemplateView, loadCellTemplateInstances } from '../lib/widget-foundation';
import type { WidgetFoundationSources } from '../lib/widget-foundation';
import ChannelPickerModal from './ChannelPickerModal';
import Icon from './Icon';
import TemplateSectionRenderer from './TemplateSectionRenderer';

export type CellTemplateRendererProps = {
  cellId: string;
  workspaceId: string;
  sources: WidgetFoundationSources;
  editMode?: boolean;
  // Optional: Caller kann selbst entscheiden was bei „Vorlage entfernen"
  // passiert (Confirm-Dialog, Undo, etc.). V1 ohne onRemoveInstance →
  // Button nicht angezeigt.
  onRemoveInstance?: (instance: CellTemplateView) => void;
  // Optional: „Update verfuegbar" akzeptieren (Re-Baseline).
  // Caller ruft setInstanceLayoutVersion mit aktueller template.layout_version.
  onAcceptLayoutUpdate?: (instance: CellTemplateView) => void;
  // Welle WV.D.3.g — Caller refetcht widget_external_channels nach
  // einem Channel-Pick (in `sources.widgetChannels` werden die neuen
  // Werte sichtbar).
  onChannelChanged?: () => void;
};

const CellTemplateRenderer: Component<CellTemplateRendererProps> = (p) => {
  const views = () => loadCellTemplateInstances(p.cellId, p.sources);
  const [pickingWidgetId, setPickingWidgetId] = createSignal<string | null>(null);
  const pickingChannel = () => {
    const wid = pickingWidgetId();
    if (!wid) return null;
    const list = p.sources.widgetChannels ?? [];
    return list.find((c) => c.widget_id === wid) ?? null;
  };

  // Reset-Override: Snapshot vor Delete fuer Undo. Override-Daten + IDs
  // landen im Closure damit der Undo-Handler restoren kann.
  async function handleResetOverride(overrideId: string): Promise<void> {
    const snap = p.sources.overrides.find((o) => o.id === overrideId);
    if (!snap) return;
    try {
      await resetWidgetOverride(overrideId);
      showUndoToast('Vorlage-Standard wiederhergestellt', () => {
        void upsertWidgetOverride({
          workspaceId: snap.workspace_id,
          instanceId: snap.instance_id,
          widgetId: snap.widget_id,
          overrideData: snap.override_data,
        }).catch((err) => {
          console.error('undo resetWidgetOverride:', err);
          showToast(translateDbError(err, 'Undo fehlgeschlagen.'), 'error');
        });
      });
    } catch (err) {
      console.error('resetWidgetOverride:', err);
      showToast(translateDbError(err), 'error');
    }
  }

  // Default: Layout-Update akzeptieren — re-baselined die Instance-
  // Version auf die aktuelle Template-Version. Caller kann via
  // p.onAcceptLayoutUpdate ueberschreiben (z.B. mit Diff-Preview).
  async function handleAcceptLayoutUpdate(view: CellTemplateView): Promise<void> {
    if (p.onAcceptLayoutUpdate) {
      p.onAcceptLayoutUpdate(view);
      return;
    }
    const previousVersion = view.instance.layout_version;
    try {
      await setInstanceLayoutVersion(view.instance.id, view.template.layout_version);
      showUndoToast(`Layout v${view.template.layout_version} uebernommen`, () => {
        void setInstanceLayoutVersion(view.instance.id, previousVersion).catch((err) => {
          console.error('undo layoutVersion:', err);
          showToast(translateDbError(err, 'Undo fehlgeschlagen.'), 'error');
        });
      });
    } catch (err) {
      console.error('setInstanceLayoutVersion:', err);
      showToast(translateDbError(err, 'Update konnte nicht angewendet werden.'), 'error');
    }
  }

  // Default: Vorlage von der Cell entfernen + Undo-Restore via
  // applyTemplateToCell. Caller kann via p.onRemoveInstance
  // ueberschreiben (z.B. um eigene Confirm-Step einzuschieben).
  async function handleRemoveInstance(view: CellTemplateView): Promise<void> {
    if (p.onRemoveInstance) {
      p.onRemoveInstance(view);
      return;
    }
    const snap = view.instance;
    try {
      await removeTemplateFromCell(snap.id);
      showUndoToast(`Vorlage „${view.template.name}" entfernt`, () => {
        void applyTemplateToCell({
          workspaceId: snap.workspace_id,
          cellId: snap.cell_id,
          templateId: snap.template_id,
          layoutVersion: snap.layout_version,
          appliedBy: snap.applied_by,
        }).catch((err) => {
          console.error('undo removeTemplate:', err);
          showToast(translateDbError(err, 'Undo fehlgeschlagen.'), 'error');
        });
      });
    } catch (err) {
      console.error('removeTemplateFromCell:', err);
      showToast(translateDbError(err, 'Vorlage konnte nicht entfernt werden.'), 'error');
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
                    title={`Vorlage v${view.template.layout_version} verfuegbar — anwenden?`}
                    onClick={() => void handleAcceptLayoutUpdate(view)}
                  >
                    <Icon name="arrow-path" size={12} />
                    <span>Update</span>
                  </button>
                </Show>
                <Show when={p.editMode}>
                  <button
                    type="button"
                    class="cell-template-remove"
                    title="Vorlage entfernen"
                    onClick={() => void handleRemoveInstance(view)}
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
                  onPickChannel={(widgetId) => setPickingWidgetId(widgetId)}
                />
              )}
            </For>
          </article>
        )}
      </For>
      <Show when={pickingWidgetId()}>
        {(wid) => (
          <ChannelPickerModal
            widgetId={wid()}
            workspaceId={p.workspaceId}
            existing={pickingChannel()}
            settingsWorkspaceId={p.workspaceId}
            onClose={() => setPickingWidgetId(null)}
            onSaved={() => {
              setPickingWidgetId(null);
              p.onChannelChanged?.();
            }}
          />
        )}
      </Show>
    </div>
  );
};

export default CellTemplateRenderer;
