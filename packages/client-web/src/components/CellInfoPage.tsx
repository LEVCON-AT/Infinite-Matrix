// Zell-Info-Felder als eigene Seite. Aufruf ueber /w/:wsId/c/:cellId/info.
// Analog zu CellChecklistsPage — der User taucht in die Zelle ein, ESC
// bringt ihn zur Parent-Matrix zurueck (globaler Handler in Workspace.tsx).
//
// Info-Felder leben in cell.data.infoFields[] (JSONB). Mutation-Pattern:
// read cell.data -> mutate Array -> write zurueck. Da alle Felder in einer
// Zelle auf demselben JSONB-Key sitzen, werden parallele Mutationen auf
// demselben Feld serialisiert (onChanged triggert Refetch).
//
// Edit-Gating (Vorbild HTML renderInfoTab):
//   - Label + Value: immer Input/Textarea, readOnly togglet
//   - ▲▼-Reorder + ✕-Delete: immer im DOM, opacity/pointer-events im
//     View-Mode deaktiviert (zero layout shift)
//   - "+ Feld": nur sichtbar im Edit-Mode

import { For, Show, createSignal, type Component } from 'solid-js';
import type { CellRow, ColRow, InfoField, RowRow } from '../lib/types';
import { useEditMode } from '../lib/edit-mode';
import {
  addCellInfoField,
  delCellInfoField,
  moveCellInfoField,
  renameCellInfoField,
  setCellInfoFieldValue,
} from '../lib/mutations';
import { showToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';

type Props = {
  workspaceId: string;
  cell: CellRow;
  row: RowRow | undefined;
  col: ColRow | undefined;
  onChanged: () => void;
};

function readInfoFieldsFromCell(cell: CellRow): InfoField[] {
  const raw = (cell.data as { infoFields?: unknown })?.infoFields;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (f): f is InfoField =>
      !!f &&
      typeof f === 'object' &&
      typeof (f as InfoField).id === 'string' &&
      typeof (f as InfoField).label === 'string' &&
      typeof (f as InfoField).value === 'string',
  );
}

const CellInfoPage: Component<Props> = (p) => {
  const editMode = useEditMode();
  const [busy, setBusy] = createSignal(false);

  const fields = () => readInfoFieldsFromCell(p.cell);

  async function wrap<T>(fn: () => Promise<T>, successMsg?: string) {
    if (busy()) return;
    setBusy(true);
    try {
      await fn();
      if (successMsg) showToast(successMsg, 'success');
      p.onChanged();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onAddField() {
    await wrap(() => addCellInfoField({ cellId: p.cell.id }));
  }

  async function onRenameField(f: InfoField, label: string) {
    if (label === f.label) return;
    await wrap(() => renameCellInfoField(p.cell.id, f.id, label));
  }

  async function onSetValue(f: InfoField, value: string) {
    if (value === f.value) return;
    await wrap(() => setCellInfoFieldValue(p.cell.id, f.id, value));
  }

  async function onMoveField(f: InfoField, dir: -1 | 1) {
    await wrap(() => moveCellInfoField(p.cell.id, f.id, dir));
  }

  async function onDelField(f: InfoField) {
    const hasValue = f.value.trim().length > 0;
    if (hasValue) {
      if (
        !window.confirm(
          `Feld "${f.label || '(ohne Label)'}" loeschen? Enthaelt Text.`,
        )
      ) {
        return;
      }
    }
    await wrap(() => delCellInfoField(p.cell.id, f.id), 'Feld geloescht.');
  }

  const breadcrumb = () => {
    const r = p.row?.label || '(Zeile)';
    const c = p.col?.label || '(Spalte)';
    return `${r} × ${c}`;
  };

  return (
    <div class="cell-info-page">
      <header class="cell-page-head">
        <div class="cell-page-head-text">
          <h3>Info-Felder</h3>
          <span class="cell-page-sub">{breadcrumb()}</span>
          <Show when={p.cell.alias}>
            <span class="node-alias">^{p.cell.alias}</span>
          </Show>
        </div>
      </header>

      <Show
        when={fields().length > 0}
        fallback={
          <p class="hint">
            Keine Info-Felder.
            <Show when={editMode()}>{' '}+ Feld unten.</Show>
          </p>
        }
      >
        <div class="info-list">
          <For each={fields()}>
            {(f) => (
              <div class="info-field" attr:data-edit={editMode() ? 'true' : 'false'}>
                <div class="info-field-hd" classList={{ 'mx-editable': editMode() }}>
                  <div class="info-arrow-stack">
                    <button
                      type="button"
                      class="info-arrow"
                      title="Nach oben"
                      aria-label="Feld nach oben verschieben"
                      tabIndex={editMode() ? 0 : -1}
                      onClick={() => onMoveField(f, -1)}
                      disabled={busy() || !editMode()}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      class="info-arrow"
                      title="Nach unten"
                      aria-label="Feld nach unten verschieben"
                      tabIndex={editMode() ? 0 : -1}
                      onClick={() => onMoveField(f, 1)}
                      disabled={busy() || !editMode()}
                    >
                      ▼
                    </button>
                  </div>
                  <input
                    class="mx-head-input info-label-input"
                    type="text"
                    value={f.label}
                    placeholder="(Feldname)"
                    readOnly={!editMode()}
                    tabIndex={editMode() ? 0 : -1}
                    onBlur={(e) => {
                      if (!editMode()) return;
                      onRenameField(f, e.currentTarget.value.trim());
                    }}
                    onKeyDown={(e) => {
                      if (!editMode()) return;
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        (e.currentTarget as HTMLInputElement).blur();
                      }
                    }}
                  />
                  <button
                    type="button"
                    class="mx-del-btn info-del"
                    title="Feld loeschen"
                    aria-label="Feld loeschen"
                    tabIndex={editMode() ? 0 : -1}
                    onClick={() => onDelField(f)}
                    disabled={busy() || !editMode()}
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  class="info-val"
                  value={f.value}
                  placeholder={editMode() ? '(Wert eingeben)' : '(leer)'}
                  readOnly={!editMode()}
                  tabIndex={editMode() ? 0 : -1}
                  rows={3}
                  onBlur={(e) => {
                    if (!editMode()) return;
                    onSetValue(f, e.currentTarget.value);
                  }}
                />
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={editMode()}>
        <button
          type="button"
          class="btn-subtle info-add-btn"
          onClick={onAddField}
          disabled={busy()}
        >
          + Feld
        </button>
      </Show>
    </div>
  );
};

export default CellInfoPage;
