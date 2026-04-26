// Zell-Checklisten als eigene Seite. Aufruf ueber /w/:wsId/c/:cellId/checklists —
// der User "taucht" in die Zelle ein (wie bei Sub-Matrix/Sub-Board), statt ein
// Overlay zu bekommen. ESC navigiert zurueck zur Parent-Matrix (wird in
// Workspace.tsx verdrahtet, wo der globale ESC-Handler lebt).

import { useNavigate } from '@solidjs/router';
import { type Component, For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { openDocsPopup } from '../lib/docs-ui';
import { useEditMode } from '../lib/edit-mode';
import { translateDbError } from '../lib/errors';
import { addCellChecklist } from '../lib/mutations';
import { fetchCellChecklists } from '../lib/queries';
import { showToast } from '../lib/toasts';
import type { CellRow, ColRow, RowRow } from '../lib/types';
import { useViewerActive } from '../lib/workspace-role';
import CellDocsSection from './CellDocsSection';
import ChecklistPanel from './ChecklistPanel';

type Props = {
  workspaceId: string;
  cell: CellRow;
  row: RowRow | undefined;
  col: ColRow | undefined;
  // Monotoner Zaehler, der bei jeder Realtime-Mutation auf
  // checklists oder checklist_items hochlaeuft. Wir beobachten ihn
  // in einem createEffect und refetchen; der Zahlenwert selbst wird
  // nie gelesen.
  realtimeVersion: number;
  realtimeDocsVersion: number;
};

const CellChecklistsPage: Component<Props> = (p) => {
  const navigate = useNavigate();
  const editMode = useEditMode();
  const viewerActive = useViewerActive();
  const [busy, setBusy] = createSignal(false);

  const [content, { refetch }] = createResource(
    () => ({ cellId: p.cell.id, workspaceId: p.workspaceId }),
    (key) => fetchCellChecklists(key.cellId, key.workspaceId),
  );

  // Realtime: bei jedem Bump refetchen. Der erste Lauf (Version=0)
  // ueberspringen — die createResource-Initial-Loading deckt das ab,
  // ein zweiter Refetch waere Verschwendung.
  let rtSeen: number | null = null;
  createEffect(() => {
    const v = p.realtimeVersion;
    if (rtSeen === null) {
      rtSeen = v;
      return;
    }
    if (v !== rtSeen) {
      rtSeen = v;
      void refetch();
    }
  });

  async function onAddChecklist() {
    if (busy()) return;
    if (viewerActive()) {
      showToast('Read-only: Neue Checkliste als Viewer nicht moeglich.', 'info');
      return;
    }
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
  const matrixHref = () => `/w/${p.workspaceId}/n/${p.cell.matrix_id}`;

  return (
    <div class="cell-checklists-page">
      <header class="cell-page-head">
        <div class="cell-page-head-text">
          <h3>Checklisten</h3>
          <a
            class="cell-page-sub cell-page-sub-link"
            href={matrixHref()}
            onClick={(e) => {
              e.preventDefault();
              navigate(matrixHref());
            }}
            title="Zur Matrix"
          >
            {breadcrumb()}
          </a>
          <Show when={p.cell.alias}>
            <span class="node-alias">^{p.cell.alias}</span>
          </Show>
        </div>
        <button
          type="button"
          class="btn-subtle cell-page-doc-btn"
          onClick={() =>
            openDocsPopup({
              sourceAlias: p.cell.alias ?? null,
              attachedCellId: p.cell.id,
            })
          }
          title="Neue Doku fuer diese Zelle"
        >
          + In Doku erfassen
        </button>
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
              <Show when={editMode()}> + Checkliste unten.</Show>
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

      <CellDocsSection
        cell={p.cell}
        workspaceId={p.workspaceId}
        realtimeVersion={p.realtimeDocsVersion}
      />
    </div>
  );
};

export default CellChecklistsPage;
