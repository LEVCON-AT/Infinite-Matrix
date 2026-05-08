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
import {
  closeBulkWizard,
  closeDangerousDelete,
  deleteRequest,
  openRequest,
} from '../../lib/bulk-wizard-state';
import { selectedCellIds } from '../../lib/cell-selection';
import { fetchCellTemplateInstancesForWorkspace } from '../../lib/cell-templates';
import { fetchFeatureTemplatesForWorkspace } from '../../lib/templates';
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

  const [templates] = createResource(
    () => (isOpen() ? p.workspaceId : null),
    async (wsId) => (wsId ? await fetchFeatureTemplatesForWorkspace(wsId) : []),
  );
  const [instances] = createResource(
    () => (isOpen() ? p.workspaceId : null),
    async (wsId) => (wsId ? await fetchCellTemplateInstancesForWorkspace(wsId) : []),
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
          const summary =
            r.kind === 'remove-template'
              ? `Vorlage von ${selectedCells().length} Cells entfernen (Slot ${r.slot}).`
              : `${selectedCells().length} Cells komplett leeren — alle Vorlagen + Atome inkl. Sub-Strukturen.`;
          const title = r.kind === 'remove-template' ? 'Vorlage entfernen' : 'Cells leeren';
          return (
            <DangerousDeleteModal
              title={title}
              summary={summary}
              items={items}
              fundusEnabled={false}
              onConfirm={async (input) => {
                // V1: Caller-spezifische Loesch-Logik ist deferred —
                // Foundation-Stub zeigt nur Toast, damit der Wizard-
                // Flow im UI komplett demonstriert ist. Production-
                // Logic kommt mit Cell-Vorlage-Snapshot/Bulk-Delete
                // RPC im naechsten Sub-Sprint.
                console.warn('DangerousDelete triggered — V1-Stub (kein Backend-Call)', r, input);
                closeDangerousDelete();
              }}
              onClose={closeDangerousDelete}
            />
          );
        }}
      </Show>
    </>
  );
};

export default BulkWizardManager;
