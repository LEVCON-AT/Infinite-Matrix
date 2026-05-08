// Welle WV.C — BulkWizardManager (Workspace-Top-Level-Mount).
//
// Wird einmal in Workspace.tsx gemountet. Liest das globale
// openRequest-Signal aus lib/bulk-wizard-state, laedt die noetigen
// Workspace-weiten Daten (templates / cell-instances / hotkey-slots /
// aliases / cells / rows / cols), bestimmt die selektierten Cells
// aus dem cell-selection Store und rendert BulkWizardModal.
//
// Vorteile vs. direkter Mount in Workspace.tsx:
// - Kapselt Daten-Loading (lazy, nur wenn Wizard geoeffnet wird).
// - Trennt Bulk-Logic von Workspace-Mountstruktur.
// - DangerousDeleteModal-Trigger (Alt+1-9 / Alt+Entf) lebt hier
//   als naechster Manager-Mode.

import { type Component, Show, createMemo, createResource } from 'solid-js';
import { bulkClearCells, bulkRemoveTemplateFromCells } from '../../lib/bulk-delete-template';
import {
  closeBulkWizard,
  closeDangerousDelete,
  deleteRequest,
  openRequest,
} from '../../lib/bulk-wizard-state';
import { clearSelection, selectedCellIds } from '../../lib/cell-selection';
import { fetchCellTemplateInstancesForWorkspace } from '../../lib/cell-templates';
import {
  fetchUserHotkeySlots,
  fetchWorkspaceHotkeySlots,
  resolveSlotTemplateId,
} from '../../lib/hotkey-slots';
import { fetchFeatureTemplatesForWorkspace } from '../../lib/templates';
import { showToast, showUndoToast } from '../../lib/toasts';
import type { CellRow, ColRow, RowRow } from '../../lib/types';
import BulkWizardModal from './BulkWizardModal';
import DangerousDeleteModal from './DangerousDeleteModal';

export type BulkWizardManagerProps = {
  workspaceId: string;
  userId: string | null;
  // Workspace-weite Cells/Rows/Cols (von Workspace.tsx-Resources gehalten).
  cells: ReadonlyArray<CellRow>;
  rows: ReadonlyArray<RowRow>;
  cols: ReadonlyArray<ColRow>;
  // Caller refetcht Cell-Resources nach Apply (Realtime ist eventually,
  // aber manchmal schneller per Polling).
  onApplied?: () => void;
};

const BulkWizardManager: Component<BulkWizardManagerProps> = (p) => {
  // Lazy-Load der Workspace-weiten Templates + Instances + Overrides
  // — Resource erst bei Open-Request aktiv.
  const isOpen = () => openRequest() !== null;

  const isDangerous = () => deleteRequest() !== null;
  const needsData = () => isOpen() || isDangerous();

  const [templates] = createResource(
    () => (needsData() ? p.workspaceId : null),
    async (wsId) => (wsId ? await fetchFeatureTemplatesForWorkspace(wsId) : []),
  );
  const [instances] = createResource(
    () => (needsData() ? p.workspaceId : null),
    async (wsId) => (wsId ? await fetchCellTemplateInstancesForWorkspace(wsId) : []),
  );
  const [workspaceSlots] = createResource(
    () => (isDangerous() ? p.workspaceId : null),
    async (wsId) => (wsId ? await fetchWorkspaceHotkeySlots(wsId) : []),
  );
  const [userSlots] = createResource(
    () => (isDangerous() ? p.workspaceId : null),
    async (wsId) => (wsId ? await fetchUserHotkeySlots(wsId) : []),
  );

  // Selected cells: aus dem globalen Store + Workspace-weiten Cells filtern.
  const selectedCells = createMemo<CellRow[]>(() => {
    const ids = new Set(selectedCellIds());
    return p.cells.filter((c) => ids.has(c.id));
  });

  // Existing aliases im Workspace fuer Konflikt-Suffix-Resolver.
  const existingAliases = createMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    for (const c of p.cells) {
      if (c.alias) set.add(c.alias);
    }
    return set;
  });

  return (
    <>
      <Show when={openRequest() && templates() && instances() && selectedCells().length > 0}>
        <BulkWizardModal
          workspaceId={p.workspaceId}
          appliedBy={p.userId}
          selectedCells={selectedCells()}
          rows={p.rows}
          cols={p.cols}
          templates={templates() ?? []}
          existingInstances={instances() ?? []}
          existingAliases={existingAliases()}
          preselectedTemplateId={openRequest()?.preselectedTemplateId ?? null}
          onApplied={() => {
            p.onApplied?.();
            closeBulkWizard();
          }}
          onClose={closeBulkWizard}
        />
      </Show>

      <Show when={selectedCells().length > 0 ? deleteRequest() : null}>
        {(req) => {
          const r = req();
          const items = selectedCells().map((cell) => {
            const row = p.rows.find((x) => x.id === cell.row_id);
            const col = p.cols.find((x) => x.id === cell.col_id);
            return {
              id: cell.id,
              label: `${row?.label ?? '?'}/${col?.label ?? '?'}`,
              preview: cell.alias ? `^${cell.alias}` : undefined,
            };
          });

          // remove-template: Slot N → Template-ID resolven + Konflikt-
          // Check (Cells, die diese Vorlage gar nicht haben, bleiben
          // unberuehrt — affectedCells im Result zaehlt nur tatsaechlich
          // entfernte Instances).
          const slotTemplateId = (): string | null => {
            if (r.kind !== 'remove-template') return null;
            return resolveSlotTemplateId(
              r.slot,
              workspaceSlots() ?? [],
              userSlots() ?? [],
              p.workspaceId,
              p.userId ?? '',
            );
          };

          const summary =
            r.kind === 'remove-template'
              ? `Vorlage von ${selectedCells().length} Cells entfernen (Slot ${r.slot}).`
              : `${selectedCells().length} Cells komplett leeren — alle Vorlagen + Cell-Inhalte werden geloescht.`;
          const title = r.kind === 'remove-template' ? 'Vorlage entfernen' : 'Cells leeren';

          async function handleConfirm(_input: { exportFirst: boolean }): Promise<void> {
            // _input.exportFirst V1 ohne Action — Konzept §8.2.3 sieht
            // einen JSON-Snapshot-Download vor. Der haengt am
            // workspace-export-Pfad und wird in spaeterem Sub-Sprint
            // verdrahtet (mit selectiver Cell-Subtree-Variante).
            try {
              if (r.kind === 'remove-template') {
                const tplId = slotTemplateId();
                if (!tplId) {
                  showToast(`Slot ${r.slot} ist frei — keine Vorlage zu entfernen.`, 'info');
                  closeDangerousDelete();
                  return;
                }
                const result = await bulkRemoveTemplateFromCells({
                  workspaceId: p.workspaceId,
                  templateId: tplId,
                  cellIds: selectedCells().map((c) => c.id),
                  instances: instances() ?? [],
                });
                if (result.affectedCells === 0 && result.failed.length === 0) {
                  showToast('Keine der Cells hatte diese Vorlage.', 'info');
                } else {
                  showUndoToast(
                    `Vorlage von ${result.affectedCells} Cells entfernt`,
                    () => void result.undo(),
                  );
                }
                if (result.failed.length > 0) {
                  console.warn('bulkRemoveTemplate failed:', result.failed);
                  showToast(
                    `${result.failed.length} Cells konnten nicht aktualisiert werden — Detail in Console.`,
                    'error',
                  );
                }
              } else {
                const result = await bulkClearCells({
                  workspaceId: p.workspaceId,
                  cells: selectedCells(),
                  instances: instances() ?? [],
                });
                showUndoToast(`${result.affectedCells} Cells geleert`, () => void result.undo());
                if (result.failed.length > 0) {
                  console.warn('bulkClearCells failed:', result.failed);
                  showToast(
                    `${result.failed.length} Cells konnten nicht geleert werden — Detail in Console.`,
                    'error',
                  );
                }
              }
              clearSelection();
              p.onApplied?.();
            } catch (err) {
              console.error('bulkDelete:', err);
              showToast('Bulk-Loeschen fehlgeschlagen.', 'error');
            } finally {
              closeDangerousDelete();
            }
          }

          return (
            <DangerousDeleteModal
              title={title}
              summary={summary}
              items={items}
              fundusEnabled={false}
              onConfirm={handleConfirm}
              onClose={closeDangerousDelete}
            />
          );
        }}
      </Show>
    </>
  );
};

export default BulkWizardManager;
