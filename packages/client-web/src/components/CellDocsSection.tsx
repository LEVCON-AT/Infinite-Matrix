// Docs-Sektion auf Cell-Seiten (Info + Checklisten). Zeigt alle Dokus,
// die via attached_cell_id an diese Zelle haengen — Tab-artige Button-
// Leiste, Klick oeffnet Doku-Popup mit dem gewaehlten Doc als aktivem
// Tab.
//
// "+ In Doku erfassen": oeffnet Popup mit neuem Pending-Tab, das
// source_alias = cell.alias (falls vorhanden) und attached_cell_id =
// cell.id vorausgefuellt hat. Beim ersten Blur-Save materialisiert
// der Tab als DB-Row — dann taucht die neue Doku hier in der Liste
// auf (nach realtimeVersion-bump).
//
// Edit-Gate: "+"-Button nur sichtbar im Edit-Mode (wie andere
// Add-Buttons im Zell-Bereich). Die bestehenden Docs bleiben immer
// sichtbar — schnelles Abrufen ist der Punkt dieser Sektion.

import { type Component, For, Show, createEffect, createResource } from 'solid-js';
import { openDocsPopup } from '../lib/docs-ui';
import { useEditMode } from '../lib/edit-mode';
import { fetchDocsForCell } from '../lib/queries';
import type { CellRow, DocRow } from '../lib/types';

type Props = {
  cell: CellRow;
  workspaceId: string;
  // Monoton aus rtDocs() in Workspace — triggert Refetch bei Realtime-
  // Aenderungen der docs-Tabelle, damit der gerade im Popup angelegte
  // Doc hier sofort auftaucht.
  realtimeVersion: number;
};

function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const yy = String(d.getFullYear()).slice(2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd}.${mm}.${yy}`;
}

const CellDocsSection: Component<Props> = (p) => {
  const editMode = useEditMode();

  const [docs, { refetch }] = createResource(
    () => ({ cellId: p.cell.id, wsId: p.workspaceId }),
    async (key) => fetchDocsForCell(key.cellId, key.wsId),
  );

  // Realtime-Bump triggert Refetch (siehe Workspace.subscribeWorkspace
  // docs-bump -> rtDocs -> hier als p.realtimeVersion).
  createEffect(() => {
    void p.realtimeVersion;
    void refetch();
  });

  function onAddDoc() {
    openDocsPopup({
      sourceAlias: p.cell.alias ?? null,
      attachedCellId: p.cell.id,
    });
  }

  function onOpenDoc(row: DocRow) {
    openDocsPopup({ initialDocId: row.id });
  }

  return (
    <Show when={(docs() ?? []).length > 0 || editMode()}>
      <section class="cell-docs-section">
        <div class="cell-docs-head">
          <h3 class="cell-docs-title">Dokumentation</h3>
          <Show when={editMode()}>
            <button
              type="button"
              class="btn-subtle cell-docs-add"
              onClick={onAddDoc}
              title="Neue Doku fuer diese Zelle"
            >
              + In Doku erfassen
            </button>
          </Show>
        </div>
        <Show when={(docs() ?? []).length > 0}>
          <ul class="cell-docs-list">
            <For each={docs() ?? []}>
              {(d) => (
                <li class="cell-docs-item-wrap">
                  <button type="button" class="cell-docs-item" onClick={() => onOpenDoc(d)}>
                    <span class="cell-docs-date hint">{fmtDateShort(d.updated_at)}</span>
                    <span class="cell-docs-item-title">{d.title || '(ohne Titel)'}</span>
                    <Show when={d.alias}>
                      <span class="cell-docs-alias">^{d.alias}</span>
                    </Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </Show>
  );
};

export default CellDocsSection;
