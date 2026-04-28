// Bulk-Entry-Modal (Phase 3 Welle O.3).
//
// Listenweise N Zeilen / Spalten / Kb-Spalten in einem Rutsch
// anlegen — pro Item ein Auto-Object (siehe addRowWithObject etc).
// Pro Zeile eine dezente Checkbox links: angehakte Items sind die
// Mitglieder einer optionalen Gruppe, die beim Submit angelegt werden
// kann.
//
// Workflow:
//   1. User tippt im Header ("+ Zeile") und drueckt Shift+Enter
//      ODER klickt "Mehrere…" im +-Menu.
//   2. Modal oeffnet, erste Zeile prefilled mit dem bereits Getippten.
//   3. Pro Zeile: Checkbox (default an) + Input. Shift+Enter im
//      letzten Input fuegt eine neue Zeile dazu.
//   4. Footer: [Gruppen-Name] + [✓ Als Gruppe speichern] + [Anlegen].
//   5. Submit: pro gefuellter Zeile addRow/Col/KbCol-WithObject. Wenn
//      "Als Gruppe speichern" + Name + ≥1 angehaktes Item:
//      createGroup + addGroupMembers. Sonst best-effort
//      createSoftGroup (Vorschlag-Speicher fuer naechste Aktion).
//
// Pattern: ChecklistActionModal (Focus-Restore + ESC-Capture) +
// overlay-scrim/overlay-card-Klassen.

import { type Component, Index, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { installFocusRestore, installFocusTrap } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import {
  type ObjectRow,
  addColWithObject,
  addGroupMembers,
  addKbColWithObject,
  addRowWithObject,
  createGroup,
  createSoftGroup,
} from '../lib/objects';
import { showToast } from '../lib/toasts';
import Icon from './Icon';

export type BulkAddMode = 'matrix-rows' | 'matrix-cols' | 'board-cols';

type Props = {
  workspaceId: string;
  mode: BulkAddMode;
  // matrixId fuer matrix-rows/matrix-cols, boardId fuer board-cols.
  parentId: string;
  // Optional: source-node-id fuer Soft-Gruppen-Tracking. Fuer matrix-*
  // ist parentId selbst die nodeId; fuer board-cols ebenfalls. Wenn
  // gesetzt, wird die Soft-Gruppe daran gehaengt.
  sourceNodeId?: string | null;
  // Was der User schon im Header-Input getippt hat — wird als erste
  // Zeile vorausgefuellt.
  initialFirstLabel?: string;
  onClose: () => void;
  onCreated?: (count: number) => void;
};

type Item = { label: string; checked: boolean };

const MIN_ROWS = 5;
const MAX_ROWS = 50;

function modeTitle(mode: BulkAddMode): string {
  switch (mode) {
    case 'matrix-rows':
      return 'Mehrere Zeilen anlegen';
    case 'matrix-cols':
      return 'Mehrere Spalten anlegen';
    case 'board-cols':
      return 'Mehrere Board-Spalten anlegen';
  }
}

function modePlaceholder(mode: BulkAddMode, idx: number): string {
  const base =
    mode === 'matrix-rows' ? 'Zeile' : mode === 'matrix-cols' ? 'Spalte' : 'Board-Spalte';
  return `${base} ${idx + 1}`;
}

const BulkAddModal: Component<Props> = (p) => {
  const initial: Item[] = [];
  initial.push({ label: p.initialFirstLabel?.trim() ?? '', checked: true });
  while (initial.length < MIN_ROWS) initial.push({ label: '', checked: true });

  const [items, setItems] = createSignal<Item[]>(initial);
  const [groupName, setGroupName] = createSignal('');
  const [saveAsGroup, setSaveAsGroup] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  let cardRef: HTMLDivElement | undefined;

  onMount(() => {
    onCleanup(installFocusRestore());
    if (cardRef) onCleanup(installFocusTrap(cardRef));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy()) return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));

    // Fokus auf erstes leeres Input (oder erstes Input wenn alles leer).
    queueMicrotask(() => {
      const firstEmpty = items().findIndex((it) => !it.label);
      const focusIdx = firstEmpty === -1 ? 0 : firstEmpty;
      const el = cardRef?.querySelector<HTMLInputElement>(`[data-bulk-input="${focusIdx}"]`);
      el?.focus();
      // Wenn prefilled erste Zeile: voll markieren damit User direkt
      // ueberschreiben kann.
      if (focusIdx === 0 && items()[0].label) el?.select();
    });
  });

  function setItem(idx: number, patch: Partial<Item>) {
    setItems((arr) => arr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function addRow() {
    setItems((arr) => {
      if (arr.length >= MAX_ROWS) return arr;
      return [...arr, { label: '', checked: true }];
    });
    queueMicrotask(() => {
      const len = items().length;
      const el = cardRef?.querySelector<HTMLInputElement>(`[data-bulk-input="${len - 1}"]`);
      el?.focus();
    });
  }

  function removeRow(idx: number) {
    setItems((arr) => {
      if (arr.length <= 1) return arr;
      return arr.filter((_, i) => i !== idx);
    });
  }

  function onInputKey(e: KeyboardEvent, idx: number) {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      addRow();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void submit();
      return;
    }
    // Plain Enter springt zur naechsten Zeile (oder fuegt Zeile dazu).
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const len = items().length;
      if (idx === len - 1) {
        addRow();
      } else {
        const el = cardRef?.querySelector<HTMLInputElement>(`[data-bulk-input="${idx + 1}"]`);
        el?.focus();
      }
    }
  }

  async function createOne(label: string): Promise<ObjectRow> {
    if (p.mode === 'matrix-rows') {
      const { object } = await addRowWithObject({
        workspaceId: p.workspaceId,
        matrixId: p.parentId,
        label,
      });
      return object;
    }
    if (p.mode === 'matrix-cols') {
      const { object } = await addColWithObject({
        workspaceId: p.workspaceId,
        matrixId: p.parentId,
        label,
      });
      return object;
    }
    const { object } = await addKbColWithObject({
      workspaceId: p.workspaceId,
      boardId: p.parentId,
      label,
    });
    return object;
  }

  async function submit() {
    if (busy()) return;
    const all = items();
    const filled = all
      .map((it, idx) => ({ ...it, idx }))
      .filter((it) => it.label.trim().length > 0);

    if (filled.length === 0) {
      showToast('Bitte mindestens einen Eintrag tippen.', 'error');
      return;
    }

    if (saveAsGroup() && !groupName().trim()) {
      showToast('Bitte Gruppen-Name angeben oder „Als Gruppe speichern" abwaehlen.', 'error');
      return;
    }

    setBusy(true);
    const created: { idx: number; object: ObjectRow }[] = [];
    try {
      // Sequenziell anlegen — Position-Race bei parallelem Insert.
      for (const it of filled) {
        const object = await createOne(it.label.trim());
        created.push({ idx: it.idx, object });
      }
    } catch (err) {
      console.error('BulkAddModal submit:', err);
      const partial = created.length;
      const total = filled.length;
      const baseMsg = translateDbError(err, 'Anlegen fehlgeschlagen.');
      const msg =
        partial > 0 ? `${baseMsg} (${partial}/${total} angelegt — Rest abgebrochen)` : baseMsg;
      showToast(msg, 'error');
      setBusy(false);
      // Bei Teilerfolg trotzdem die UI synchronisieren.
      if (partial > 0) p.onCreated?.(partial);
      return;
    }

    // Object-Ids der ANGEHAKTEN Items. Reihenfolge folgt Original-Index.
    const checkedObjectIds = created
      .filter(({ idx }) => all[idx].checked)
      .map(({ object }) => object.id);

    // Pfad A: explizit "Als Gruppe speichern".
    if (saveAsGroup() && groupName().trim() && checkedObjectIds.length > 0) {
      try {
        const group = await createGroup({
          workspaceId: p.workspaceId,
          name: groupName().trim(),
        });
        await addGroupMembers(group.id, checkedObjectIds);
        showToast(
          `${created.length} angelegt — Gruppe "${group.name}" mit ${checkedObjectIds.length} Mitgliedern.`,
          'success',
        );
      } catch (err) {
        console.error('BulkAddModal createGroup:', err);
        // Items sind angelegt, nur Group-Pfad fehlgeschlagen — User soll
        // wissen dass Items live sind und Group nicht.
        showToast(
          `${created.length} angelegt — Gruppe konnte nicht gespeichert werden: ${translateDbError(err)}`,
          'error',
        );
      }
    } else if (checkedObjectIds.length > 1) {
      // Pfad B: Soft-Gruppe als Vorschlag-Speicher (best-effort, silent).
      try {
        await createSoftGroup({
          workspaceId: p.workspaceId,
          name: groupName().trim() || 'Letzte Bulk-Anlage',
          sourceNodeId: p.sourceNodeId ?? null,
          objectIds: checkedObjectIds,
        });
      } catch (err) {
        console.warn('BulkAddModal createSoftGroup (best-effort):', err);
      }
      showToast(`${created.length} angelegt.`, 'success');
    } else {
      showToast(`${created.length} angelegt.`, 'success');
    }

    p.onCreated?.(created.length);
    p.onClose();
  }

  const submitLabel = () => {
    const filled = items().filter((it) => it.label.trim().length > 0).length;
    return filled === 0 ? 'Anlegen' : `${filled} anlegen (Strg+Enter)`;
  };

  // Strg/Cmd+Enter committet — konsistent zu ChecklistActionModal.
  function onScrimKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy()) p.onClose();
      }}
      onKeyDown={onScrimKey}
    >
      <div
        ref={cardRef}
        class="overlay-card bulk-add-card"
        // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> Pattern wie restliche Modals (kein <dialog>).
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-add-title"
      >
        <header class="overlay-head">
          <h3 id="bulk-add-title">{modeTitle(p.mode)}</h3>
          <button
            type="button"
            class="overlay-close"
            onClick={p.onClose}
            aria-label="Schliessen"
            disabled={busy()}
          >
            <Icon name="x" size={18} />
          </button>
        </header>
        <div class="bulk-add-body">
          <p class="bulk-add-hint">
            Pro Zeile ein Eintrag. Shift+Enter haengt eine Zeile an. Angehakte Eintraege koennen
            unten als Gruppe gespeichert werden.
          </p>
          <div class="bulk-item-list">
            <Index each={items()}>
              {(item, idx) => (
                <div class="bulk-item-row">
                  <input
                    type="checkbox"
                    class="bulk-item-checkbox"
                    checked={item().checked}
                    onChange={(e) => setItem(idx, { checked: e.currentTarget.checked })}
                    disabled={busy()}
                    aria-label={`In Gruppe aufnehmen — Eintrag ${idx + 1}`}
                  />
                  <input
                    type="text"
                    class="bulk-item-input"
                    data-bulk-input={idx}
                    value={item().label}
                    placeholder={modePlaceholder(p.mode, idx)}
                    onInput={(e) => setItem(idx, { label: e.currentTarget.value })}
                    onKeyDown={(e) => onInputKey(e, idx)}
                    disabled={busy()}
                  />
                  <button
                    type="button"
                    class="bulk-item-remove"
                    onClick={() => removeRow(idx)}
                    disabled={busy() || items().length <= 1}
                    aria-label={`Eintrag ${idx + 1} entfernen`}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
              )}
            </Index>
          </div>
          <button
            type="button"
            class="bulk-add-row-btn"
            onClick={addRow}
            disabled={busy() || items().length >= MAX_ROWS}
          >
            + Zeile dazu
          </button>

          <div class="bulk-group-foot">
            <label class="bulk-group-toggle">
              <input
                type="checkbox"
                checked={saveAsGroup()}
                onChange={(e) => setSaveAsGroup(e.currentTarget.checked)}
                disabled={busy()}
              />
              <span>Als Gruppe speichern</span>
            </label>
            <Show when={saveAsGroup()}>
              <input
                type="text"
                class="bulk-group-name"
                value={groupName()}
                onInput={(e) => setGroupName(e.currentTarget.value)}
                placeholder='Gruppen-Name (z.B. „Kunden")'
                disabled={busy()}
              />
            </Show>
          </div>
        </div>
        <footer class="overlay-foot bulk-add-foot">
          <button type="button" class="btn-subtle" onClick={p.onClose} disabled={busy()}>
            Abbrechen
          </button>
          <button type="button" class="btn btn-p" onClick={submit} disabled={busy()}>
            {submitLabel()}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default BulkAddModal;
