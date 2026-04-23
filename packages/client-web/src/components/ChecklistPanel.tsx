// Rendert eine einzelne Checkliste inkl. Items.
// Analog zur HTML-Vorlage (renderChecklists): NUR Toggle ist View-Mode-
// erlaubt. Add / Rename / Del / Level / Reorder sind Edit-gated —
// Aenderungen an Items sind struktur-aehnlich, nicht blosse Zustands-
// Flips.

import { For, Show, createSignal, type Component } from 'solid-js';
import type { ChecklistItemRow, ChecklistRow } from '../lib/types';
import { useEditMode } from '../lib/edit-mode';
import {
  addChecklistItem,
  delChecklist,
  delChecklistItem,
  renameChecklist,
  renameChecklistItem,
  restoreChecklistItem,
  restoreChecklistWithItems,
  setChecklistAlias,
  setChecklistItemLevel,
  toggleChecklistItemDone,
} from '../lib/mutations';
import { showToast, showUndoToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';
import { flashError } from '../lib/flash';
import { validateAlias } from '../lib/alias';
import { bindAliasAutocomplete } from '../lib/use-alias-autocomplete';
import AliasText from './AliasText';

type Props = {
  checklist: ChecklistRow;
  items: ChecklistItemRow[]; // bereits nach position sortiert
  workspaceId: string;
  onChanged: () => void;
};

const ChecklistPanel: Component<Props> = (p) => {
  const editMode = useEditMode();
  const [busy, setBusy] = createSignal(false);
  let aliasInputRef: HTMLInputElement | undefined;

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

  async function onRename(val: string) {
    const trimmed = val.trim();
    if (trimmed === p.checklist.label) return;
    await wrap(() => renameChecklist(p.checklist.id, trimmed));
  }

  async function onAliasBlur(val: string) {
    if (busy()) return;
    const current = p.checklist.alias ?? null;
    setBusy(true);
    try {
      const res = await validateAlias(val, p.workspaceId, {
        type: 'checklist',
        id: p.checklist.id,
      });
      if (!res.ok) {
        showToast(res.msg, 'error');
        flashError(aliasInputRef);
        if (aliasInputRef) aliasInputRef.value = current ?? '';
        return;
      }
      const next = res.canonical;
      if (next === current) return;
      await setChecklistAlias(p.checklist.id, next);
      p.onChanged();
    } catch (err) {
      showToast(translateDbError(err), 'error');
      flashError(aliasInputRef);
      if (aliasInputRef) aliasInputRef.value = current ?? '';
    } finally {
      setBusy(false);
    }
  }

  async function onDel() {
    const count = p.items.length;
    if (count > 0) {
      if (
        !window.confirm(
          `Checkliste "${p.checklist.label || '(Liste)'}" loeschen? Enthaelt ${count} Punkt(e).`,
        )
      ) {
        return;
      }
    }
    const clSnap = { ...p.checklist };
    const itemSnaps = p.items.map((i) => ({ ...i }));
    await wrap(() => delChecklist(p.checklist.id));
    showUndoToast(
      `Checkliste "${clSnap.label || '(Liste)'}" geloescht.`,
      () => {
        void (async () => {
          try {
            await restoreChecklistWithItems(clSnap, itemSnaps);
            showToast('Checkliste wiederhergestellt.', 'success');
            p.onChanged();
          } catch (err) {
            showToast(translateDbError(err), 'error');
          }
        })();
      },
    );
  }

  async function onAddItem() {
    await wrap(() =>
      addChecklistItem({
        workspaceId: p.workspaceId,
        checklistId: p.checklist.id,
      }),
    );
  }

  async function onToggleItem(item: ChecklistItemRow, done: boolean) {
    if (done === item.done) return;
    await wrap(() => toggleChecklistItemDone(item.id, done));
  }

  async function onRenameItem(item: ChecklistItemRow, text: string) {
    if (text === item.text) return;
    await wrap(() => renameChecklistItem(item.id, text));
  }

  async function onDelItem(item: ChecklistItemRow) {
    const snap = { ...item };
    await wrap(() => delChecklistItem(item.id));
    showUndoToast(`Punkt geloescht.`, () => {
      void (async () => {
        try {
          await restoreChecklistItem(snap);
          p.onChanged();
        } catch (err) {
          showToast(translateDbError(err), 'error');
        }
      })();
    });
  }

  async function onLevelItem(item: ChecklistItemRow, dir: 1 | -1) {
    const next = Math.max(0, Math.min(2, item.level + dir)) as 0 | 1 | 2;
    if (next === item.level) return;
    await wrap(() => setChecklistItemLevel(item.id, next));
  }

  const done = () => p.items.filter((i) => i.done).length;

  return (
    <li class="cl-item" attr:data-edit={editMode() ? 'true' : 'false'}>
      <header class="cl-head" classList={{ 'mx-editable': editMode() }}>
        <input
          class="mx-head-input cl-head-input"
          type="text"
          value={p.checklist.label}
          placeholder="(Liste)"
          readOnly={!editMode()}
          tabIndex={editMode() ? 0 : -1}
          onBlur={(e) => {
            if (!editMode()) return;
            onRename(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (!editMode()) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
        <input
          ref={aliasInputRef}
          class="cl-alias-input"
          type="text"
          value={p.checklist.alias ?? ''}
          placeholder="^alias"
          readOnly={!editMode()}
          tabIndex={editMode() ? 0 : -1}
          onBlur={(e) => {
            if (!editMode()) return;
            onAliasBlur(e.currentTarget.value);
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
          class="mx-del-btn"
          title="Checkliste loeschen"
          aria-label="Checkliste loeschen"
          tabIndex={editMode() ? 0 : -1}
          onClick={onDel}
          disabled={busy() || !editMode()}
        >
          ✕
        </button>
        <span class="cl-progress">
          {done()}/{p.items.length}
        </span>
        <Show when={p.checklist.recur}>
          <span class="cl-recur" title="wiederkehrend">
            ↻
          </span>
        </Show>
      </header>

      <ul class="cl-items">
        <For each={p.items}>
          {(it) => (
            <li
              class="cl-it"
              classList={{ 'cl-it-done': it.done }}
              style={{ '--cl-level': it.level }}
            >
              <input
                type="checkbox"
                class="cl-checkbox-input"
                checked={it.done}
                aria-label="Erledigt"
                onChange={(e) => onToggleItem(it, e.currentTarget.checked)}
              />
              {/* Edit-Mode: klassischer Input mit Alias-Autocomplete.
                  View-Mode: Span mit AliasText → `^alias`-Chips sind
                  klickbar (dispatch) und kontext-menu-faehig. */}
              <Show
                when={editMode()}
                fallback={
                  <span class="cl-text-view">
                    <Show
                      when={it.text}
                      fallback={<span class="cl-text-placeholder">(Punkt)</span>}
                    >
                      <AliasText text={it.text} workspaceId={p.workspaceId} />
                    </Show>
                  </span>
                }
              >
                <input
                  class="cl-text-input"
                  type="text"
                  value={it.text}
                  placeholder="(Punkt)"
                  tabIndex={0}
                  ref={(el) => bindAliasAutocomplete(el, p.workspaceId)}
                  onBlur={(e) => onRenameItem(it, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      (e.currentTarget as HTMLInputElement).blur();
                    } else if (e.altKey && e.key === 'ArrowRight') {
                      e.preventDefault();
                      void onLevelItem(it, 1);
                    } else if (e.altKey && e.key === 'ArrowLeft') {
                      e.preventDefault();
                      void onLevelItem(it, -1);
                    }
                  }}
                />
              </Show>
              <button
                type="button"
                class="cl-it-del"
                title="Punkt loeschen"
                aria-label="Punkt loeschen"
                tabIndex={editMode() ? 0 : -1}
                onClick={() => onDelItem(it)}
                disabled={busy() || !editMode()}
              >
                ✕
              </button>
            </li>
          )}
        </For>
      </ul>

      <Show when={editMode()}>
        <button
          type="button"
          class="cl-add-item-btn"
          onClick={onAddItem}
          disabled={busy()}
        >
          + Punkt
        </button>
      </Show>
    </li>
  );
};

export default ChecklistPanel;
