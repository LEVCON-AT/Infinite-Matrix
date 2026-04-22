// Zell-Checklisten als eigene Seite. Aufruf ueber /w/:wsId/c/:cellId/checklists —
// der User "taucht" in die Zelle ein (wie bei Sub-Matrix/Sub-Board), statt ein
// Overlay zu bekommen. ESC navigiert zurueck zur Parent-Matrix (wird in
// Workspace.tsx verdrahtet, wo der globale ESC-Handler lebt).

import {
  For,
  Show,
  createResource,
  createSignal,
  type Component,
} from 'solid-js';
import type { CellRow, ColRow, RowRow } from '../lib/types';
import { useEditMode } from '../lib/edit-mode';
import { addCellChecklist } from '../lib/mutations';
import { fetchCellChecklists } from '../lib/queries';
import { showToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';
import ChecklistPanel from './ChecklistPanel';

type Props = {
  workspaceId: string;
  cell: CellRow;
  row: RowRow | undefined;
  col: ColRow | undefined;
};

const CellChecklistsPage: Component<Props> = (p) => {
  const editMode = useEditMode();
  const [busy, setBusy] = createSignal(false);

  const [content, { refetch }] = createResource(
    () => ({ cellId: p.cell.id, workspaceId: p.workspaceId }),
    (key) => fetchCellChecklists(key.cellId, key.workspaceId),
  );

  async function onAddChecklist() {
    if (busy()) return;
    setBusy(true);
    try {
      await addCellChecklist({
        workspaceId: p.workspaceId,
        cellId: p.cell.id,
      });
      await refetch();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  const checklists = () => content()?.checklists ?? [];
  const items = () => content()?.checklistItems ?? [];

  const breadcrumb = () => {
    const r = p.row?.label || '(Zeile)';
    const c = p.col?.label || '(Spalte)';
    return `${r} × ${c}`;
  };

  return (
    <div class="cell-checklists-page">
      <header class="cell-page-head">
        <div class="cell-page-head-text">
          <h3>Checklisten</h3>
          <span class="cell-page-sub">{breadcrumb()}</span>
          <Show when={p.cell.alias}>
            <span class="node-alias">^{p.cell.alias}</span>
          </Show>
        </div>
      </header>

      <Show when={content.loading}>
        <p class="hint">Lade Checklisten…</p>
      </Show>

      <Show when={content.error}>
        <p class="hint">Fehler: {translateDbError(content.error)}</p>
      </Show>

      <Show when={!content.loading && !content.error}>
        <Show
          when={checklists().length > 0}
          fallback={
            <p class="hint">
              Noch keine Checkliste.
              <Show when={editMode()}>{' '}+ Checkliste unten.</Show>
            </p>
          }
        >
          <ul class="cl-list">
            <For each={checklists()}>
              {(cl) => {
                const itemsFor = () =>
                  items()
                    .filter((it) => it.checklist_id === cl.id)
                    .sort((a, b) => a.position - b.position);
                return (
                  <ChecklistPanel
                    checklist={cl}
                    items={itemsFor()}
                    workspaceId={p.workspaceId}
                    onChanged={() => void refetch()}
                  />
                );
              }}
            </For>
          </ul>
        </Show>

        <Show when={editMode()}>
          <button
            type="button"
            class="btn-subtle cl-add-btn"
            onClick={onAddChecklist}
            disabled={busy()}
          >
            + Checkliste
          </button>
        </Show>
      </Show>
    </div>
  );
};

export default CellChecklistsPage;
