// Overlay-Modal fuer die Checklisten einer Matrix-Zelle.
// Oeffnet sich beim Klick auf den "checklists"-Chip in der Zelle.
//
// Daten-Layer: eigene createResource auf fetchCellChecklists — das
// Matrix-Level-Refetch kennt die Cell-Checklisten-Tabelle nicht, also
// ist der Refetch lokal.

import {
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  onMount,
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
  cell: CellRow; // garantiert vorhanden (Chip-Klick setzt cell voraus)
  row: RowRow;
  col: ColRow;
  onClose: () => void;
};

const CellChecklistsOverlay: Component<Props> = (p) => {
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

  const capturedRowId = p.row.id;
  const capturedColId = p.col.id;

  // ESC schliesst. Capture + stopImmediatePropagation, damit der
  // Workspace-ESC-Handler (Parent-Navigation) das Event nicht wegschluckt.
  function onGlobalKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      e.preventDefault();
      p.onClose();
    }
  }

  onMount(() => {
    document.addEventListener('keydown', onGlobalKeyDown, true);
  });

  // Fokus zurueck auf die DOM-Zelle bei Unmount — analog zu CellOverlay.
  onCleanup(() => {
    document.removeEventListener('keydown', onGlobalKeyDown, true);
    const el = document.querySelector(
      `.mx-cell[data-row-id="${capturedRowId}"][data-col-id="${capturedColId}"]`,
    ) as HTMLElement | null;
    el?.focus({ preventScroll: true });
  });

  const breadcrumb = () =>
    `${p.row.label || '(Zeile)'} × ${p.col.label || '(Spalte)'}`;

  // Nach jeder Mutation an den Checklists ein eigenes Refetch ausloesen.
  // Signal passiert von innen via onChanged -> refetch().
  const checklists = () => content()?.checklists ?? [];
  const items = () => content()?.checklistItems ?? [];

  // Fokus beim Oeffnen auf den ersten sinnvollen Action-Punkt: erstes
  // Item, oder der "+ Checkliste"-Button im Edit-Mode, oder der Close-
  // Button als Fallback. Nur einmal nach Content-Load.
  let scrimRef: HTMLDivElement | undefined;
  const [initialFocused, setInitialFocused] = createSignal(false);
  createEffect(() => {
    const c = content();
    if (!c || initialFocused() || !scrimRef) return;
    queueMicrotask(() => {
      const focusTarget =
        (scrimRef!.querySelector('.cl-text-input') as HTMLElement | null) ??
        (scrimRef!.querySelector('.cl-add-btn') as HTMLElement | null) ??
        (scrimRef!.querySelector('.overlay-close') as HTMLElement | null);
      focusTarget?.focus({ preventScroll: true });
      setInitialFocused(true);
    });
  });

  return (
    <div
      ref={scrimRef}
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        class="overlay-card cell-checklists-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Zell-Checklisten"
      >
        <header class="overlay-head">
          <div class="overlay-head-text">
            <h2>Checklisten</h2>
            <span class="overlay-sub">{breadcrumb()}</span>
          </div>
          <button
            type="button"
            class="overlay-close"
            onClick={p.onClose}
            aria-label="Schliessen"
          >
            ✕
          </button>
        </header>

        <div class="overlay-body">
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
      </div>
    </div>
  );
};

export default CellChecklistsOverlay;
