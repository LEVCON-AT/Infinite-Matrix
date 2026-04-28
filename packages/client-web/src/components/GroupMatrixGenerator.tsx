// Group→Matrix-Generator (Phase 3 Welle O.6).
//
// Konzept-"Wow"-Sprint aus dem Object-Layer-Plan: zwei Object-Listen
// (typisch Group-Members) wandern als Zeilen × Spalten in eine neue
// Matrix. Die Achsen sind dabei First-Class-Identitaeten (object_id-FK
// auf rows/cols), nicht losgeloeste Strings — Umbenennen einer Hunderasse
// in der Matrix wirkt sich auf das Object aus, das man im Object-Detail
// sieht. Cells bleiben object-frei (Pfad-Enden, User-Regel).
//
// Zwei-Spalten-Layout im Modal:
//   - Links:  Quelle Zeilen (Group-Dropdown + Member-Liste mit Checkboxes)
//   - Rechts: Quelle Spalten (analog)
//   - Footer: Matrix-Name-Input + "Anlegen"
//
// Submit:
//   - createMatrixFromGroups(workspaceId, label, rows[], cols[])
//   - navigate zur neuen Matrix
//
// Erste Version arbeitet nur mit existing groups als Source. Tag-/
// Parent-/Manual-Source folgen mit O.6.B (defer).

import { useNavigate } from '@solidjs/router';
import {
  type Component,
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { installFocusRestore, installFocusTrap } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { createMatrixFromGroups } from '../lib/mutations';
import { fetchAllGroupMembers, fetchGroups, fetchObjects } from '../lib/objects';
import { showToast } from '../lib/toasts';
import type { ObjectRow } from '../lib/types';
import {
  closeObjectSuggest,
  commitObjectSuggest,
  navigateObjectSuggest,
  objectSuggestState,
  openObjectSuggest,
} from '../lib/use-object-suggest';
import Icon from './Icon';
import ObjectSuggestion from './ObjectSuggestion';

type Props = {
  workspaceId: string;
  onClose: () => void;
  onCreated?: (nodeId: string) => void;
};

const GroupMatrixGenerator: Component<Props> = (p) => {
  const navigate = useNavigate();

  const [rowGroupId, setRowGroupId] = createSignal('');
  const [colGroupId, setColGroupId] = createSignal('');
  const [rowSelection, setRowSelection] = createSignal<Set<string>>(new Set());
  const [colSelection, setColSelection] = createSignal<Set<string>>(new Set());
  const [matrixName, setMatrixName] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  // Manuelle (nicht-Group) Entries pro Achse — vom User per "+ manuell"
  // Object-Picker hinzugefuegt. Werden in *Members gemerged + de-duped.
  const [manualRows, setManualRows] = createSignal<Array<{ id: string; label: string }>>([]);
  const [manualCols, setManualCols] = createSignal<Array<{ id: string; label: string }>>([]);
  // Picker-State (Singleton ObjectSuggest) — welche Achse picked gerade?
  const [pickerKind, setPickerKind] = createSignal<'row' | 'col' | null>(null);
  let cardRef: HTMLDivElement | undefined;
  let rowAddInputRef: HTMLInputElement | undefined;
  let colAddInputRef: HTMLInputElement | undefined;

  const [groups] = createResource(
    () => p.workspaceId,
    async (ws) => {
      if (!ws) return [];
      try {
        return await fetchGroups(ws);
      } catch (err) {
        console.error('fetchGroups:', err);
        return [];
      }
    },
  );

  const [allMembers] = createResource(
    () => p.workspaceId,
    async (ws) => {
      if (!ws) return [];
      try {
        return await fetchAllGroupMembers(ws);
      } catch (err) {
        console.error('fetchAllGroupMembers:', err);
        return [];
      }
    },
  );

  const [allObjects] = createResource(
    () => p.workspaceId,
    async (ws) => {
      if (!ws) return [];
      try {
        return await fetchObjects(ws);
      } catch (err) {
        console.error('fetchObjects:', err);
        return [];
      }
    },
  );

  const objectMap = createMemo(() => {
    const map = new Map<string, ObjectRow>();
    for (const o of allObjects() ?? []) map.set(o.id, o);
    return map;
  });

  // group_id → array of {id, label} resolved.
  const membersByGroup = createMemo(() => {
    const map = new Map<string, Array<{ id: string; label: string }>>();
    const idx = objectMap();
    for (const m of allMembers() ?? []) {
      const obj = idx.get(m.object_id);
      if (!obj) continue;
      let arr = map.get(m.group_id);
      if (!arr) {
        arr = [];
        map.set(m.group_id, arr);
      }
      arr.push({ id: obj.id, label: obj.label || '(ohne Label)' });
    }
    // Stabile Sortierung pro Gruppe.
    for (const arr of map.values()) {
      arr.sort((a, b) => a.label.localeCompare(b.label));
    }
    return map;
  });

  type MemberRow = { id: string; label: string; manual: boolean };

  function mergeMembers(
    groupList: Array<{ id: string; label: string }>,
    manual: Array<{ id: string; label: string }>,
  ): MemberRow[] {
    const seen = new Set<string>();
    const out: MemberRow[] = [];
    for (const m of groupList) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({ id: m.id, label: m.label, manual: false });
    }
    for (const m of manual) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({ id: m.id, label: m.label, manual: true });
    }
    return out;
  }

  const rowMembers = createMemo<MemberRow[]>(() => {
    const id = rowGroupId();
    const groupList = id ? (membersByGroup().get(id) ?? []) : [];
    return mergeMembers(groupList, manualRows());
  });

  const colMembers = createMemo<MemberRow[]>(() => {
    const id = colGroupId();
    const groupList = id ? (membersByGroup().get(id) ?? []) : [];
    return mergeMembers(groupList, manualCols());
  });

  // Beim Group-Wechsel: alle Members default angehakt + manuelle Eintraege
  // bleiben ausgewaehlt (sie wurden vom User explizit ergaenzt).
  function pickRowGroup(id: string) {
    setRowGroupId(id);
    const members = membersByGroup().get(id) ?? [];
    const sel = new Set(members.map((m) => m.id));
    for (const m of manualRows()) sel.add(m.id);
    setRowSelection(sel);
  }

  function pickColGroup(id: string) {
    setColGroupId(id);
    const members = membersByGroup().get(id) ?? [];
    const sel = new Set(members.map((m) => m.id));
    for (const m of manualCols()) sel.add(m.id);
    setColSelection(sel);
  }

  function toggleRow(id: string) {
    setRowSelection((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCol(id: string) {
    setColSelection((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllRows() {
    setRowSelection(new Set(rowMembers().map((m) => m.id)));
  }

  function clearRows() {
    setRowSelection(new Set<string>());
  }

  function selectAllCols() {
    setColSelection(new Set(colMembers().map((m) => m.id)));
  }

  function clearCols() {
    setColSelection(new Set<string>());
  }

  // ─── Manual-Entry-Picker ────────────────────────────────────
  function addManualEntry(axis: 'row' | 'col', id: string, label: string) {
    const setter = axis === 'row' ? setManualRows : setManualCols;
    const selSetter = axis === 'row' ? setRowSelection : setColSelection;
    setter((arr) => (arr.some((m) => m.id === id) ? arr : [...arr, { id, label }]));
    // Neu hinzugefuegte Entries automatisch anhaken — match the "default
    // alle ausgewaehlt"-Semantik der Group-Picks.
    selSetter((s) => {
      if (s.has(id)) return s;
      const next = new Set(s);
      next.add(id);
      return next;
    });
  }

  function removeManualEntry(axis: 'row' | 'col', id: string) {
    const setter = axis === 'row' ? setManualRows : setManualCols;
    const selSetter = axis === 'row' ? setRowSelection : setColSelection;
    setter((arr) => arr.filter((m) => m.id !== id));
    selSetter((s) => {
      if (!s.has(id)) return s;
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }

  function openManualPicker(axis: 'row' | 'col') {
    const anchor = axis === 'row' ? rowAddInputRef : colAddInputRef;
    if (!anchor) return;
    setPickerKind(axis);
    anchor.value = '';
    anchor.focus();
    openObjectSuggest({
      anchor,
      workspaceId: p.workspaceId,
      query: '',
      currentObjectId: null,
      onPick: (hit) => {
        if (!hit) return;
        addManualEntry(axis, hit.id, hit.label);
        setPickerKind(null);
        if (anchor) anchor.value = '';
        closeObjectSuggest();
      },
    });
  }

  function onPickerInput(axis: 'row' | 'col', e: InputEvent & { currentTarget: HTMLInputElement }) {
    const value = e.currentTarget.value;
    const anchor = axis === 'row' ? rowAddInputRef : colAddInputRef;
    if (!anchor) return;
    openObjectSuggest({
      anchor,
      workspaceId: p.workspaceId,
      query: value,
      currentObjectId: null,
      onPick: (hit) => {
        if (!hit) return;
        addManualEntry(axis, hit.id, hit.label);
        setPickerKind(null);
        anchor.value = '';
        closeObjectSuggest();
      },
    });
  }

  function onPickerKey(
    _axis: 'row' | 'col',
    e: KeyboardEvent & { currentTarget: HTMLInputElement },
  ) {
    if (e.key === 'ArrowDown' && objectSuggestState().open) {
      e.preventDefault();
      navigateObjectSuggest('down');
      return;
    }
    if (e.key === 'ArrowUp' && objectSuggestState().open) {
      e.preventDefault();
      navigateObjectSuggest('up');
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setPickerKind(null);
      e.currentTarget.value = '';
      closeObjectSuggest();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const hit = commitObjectSuggest();
      if (!hit) {
        // Nichts highlighted — Picker schliessen, kein Pick.
        setPickerKind(null);
        e.currentTarget.value = '';
        closeObjectSuggest();
      }
      // Bei hit: onPick uebernimmt das Aufraeumen.
    }
  }

  function onPickerBlur(_axis: 'row' | 'col') {
    // Verzoegert schliessen — Click auf Dropdown-Item soll noch durchgehen.
    setTimeout(() => {
      if (objectSuggestState().open) return; // Dropdown selber kuemmert sich
      setPickerKind(null);
    }, 150);
  }

  // Default Matrix-Name vom Group-Pick: "Group-A × Group-B".
  const defaultName = createMemo(() => {
    const gMap = new Map((groups() ?? []).map((g) => [g.id, g.name]));
    const r = gMap.get(rowGroupId());
    const c = gMap.get(colGroupId());
    if (r && c) return `${r} × ${c}`;
    if (r) return r;
    if (c) return c;
    return '';
  });

  const effectiveName = () => matrixName().trim() || defaultName().trim();

  onMount(() => {
    onCleanup(installFocusRestore());
    if (cardRef) onCleanup(installFocusTrap(cardRef));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy()) return;
      // Wenn der Object-Picker offen ist, schluckt der Input-Handler ESC
      // (siehe onPickerKey). Modal NICHT zumachen.
      if (objectSuggestState().open || pickerKind() !== null) return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  async function submit() {
    if (busy()) return;
    const name = effectiveName();
    if (!name) {
      showToast('Bitte Quellen waehlen oder Matrix-Namen tippen.', 'error');
      return;
    }
    const rowsSel = rowSelection();
    const colsSel = colSelection();
    if (rowsSel.size === 0 && colsSel.size === 0) {
      showToast('Mindestens eine Zeile oder Spalte auswaehlen.', 'error');
      return;
    }

    const rowObjects = rowMembers().filter((m) => rowsSel.has(m.id));
    const colObjects = colMembers().filter((m) => colsSel.has(m.id));

    setBusy(true);
    try {
      const node = await createMatrixFromGroups({
        workspaceId: p.workspaceId,
        label: name,
        rowObjects,
        colObjects,
      });
      showToast(
        `Matrix "${name}" angelegt — ${rowObjects.length} Zeilen × ${colObjects.length} Spalten.`,
        'success',
      );
      p.onCreated?.(node.id);
      p.onClose();
      navigate(`/w/${p.workspaceId}/n/${node.id}`);
    } catch (err) {
      console.error('createMatrixFromGroups:', err);
      showToast(translateDbError(err, 'Matrix konnte nicht angelegt werden.'), 'error');
      setBusy(false);
    }
  }

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
        class="overlay-card group-matrix-card"
        // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> Pattern wie restliche Modals.
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-matrix-title"
      >
        <header class="overlay-head">
          <h3 id="group-matrix-title">Matrix aus Gruppen bauen</h3>
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
        <div class="group-matrix-body">
          <p class="group-matrix-hint">
            Waehle eine Gruppe fuer Zeilen und Spalten. Aus den Mitgliedern wird eine Matrix — jede
            Achse ist ein First-Class-Object, nicht nur ein String. Fehlt etwas? Per „+ Manuelle
            Zeile/Spalte" einzelne Objekte ergaenzen.
          </p>
          <Show when={(groups() ?? []).length === 0 && !groups.loading}>
            <p class="hint group-matrix-empty">
              Noch keine Gruppen im Workspace. Du kannst trotzdem mit „+ Manuelle Zeile/Spalte"
              einzelne Objekte zusammenstellen — oder per „Bulk-Anlage" (Shift+Klick auf „+ Zeile")
              eine Gruppe erzeugen.
            </p>
          </Show>
          <div class="group-matrix-grid">
            <section class="group-matrix-source">
              <label class="group-matrix-source-label" for="gmg-row-select">
                Zeilen
              </label>
              <select
                id="gmg-row-select"
                class="group-matrix-select"
                value={rowGroupId()}
                onChange={(e) => pickRowGroup(e.currentTarget.value)}
                disabled={busy()}
              >
                <option value="">— Gruppe waehlen —</option>
                <For each={groups() ?? []}>{(g) => <option value={g.id}>{g.name}</option>}</For>
              </select>
              <Show when={rowMembers().length > 0}>
                <div class="group-matrix-actions">
                  <button type="button" onClick={selectAllRows} class="link-btn">
                    Alle
                  </button>
                  <span> · </span>
                  <button type="button" onClick={clearRows} class="link-btn">
                    Keine
                  </button>
                  <span class="group-matrix-actions-count">
                    {rowSelection().size} / {rowMembers().length}
                  </span>
                </div>
                <ul class="group-matrix-member-list">
                  <For each={rowMembers()}>
                    {(m) => (
                      <li class="group-matrix-member-row" classList={{ 'is-manual': m.manual }}>
                        <input
                          type="checkbox"
                          class="group-matrix-checkbox"
                          checked={rowSelection().has(m.id)}
                          onChange={() => toggleRow(m.id)}
                          disabled={busy()}
                          aria-label={m.label}
                        />
                        <span class="group-matrix-member-label">{m.label}</span>
                        <Show when={m.manual}>
                          <button
                            type="button"
                            class="group-matrix-member-remove"
                            onClick={() => removeManualEntry('row', m.id)}
                            disabled={busy()}
                            aria-label={`${m.label} entfernen`}
                            title="Manuelle Zeile entfernen"
                          >
                            <Icon name="x" size={11} />
                          </button>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <div class="group-matrix-add-row">
                <Show
                  when={pickerKind() === 'row'}
                  fallback={
                    <button
                      type="button"
                      class="group-matrix-add-btn"
                      onClick={() => openManualPicker('row')}
                      disabled={busy()}
                      title="Einzelnes Objekt als Zeile ergaenzen"
                    >
                      <Icon name="plus" size={12} />
                      <span>Manuelle Zeile</span>
                    </button>
                  }
                >
                  <input
                    ref={rowAddInputRef}
                    type="text"
                    class="group-matrix-add-input"
                    placeholder="Objekt suchen…"
                    onInput={(e) => onPickerInput('row', e)}
                    onKeyDown={(e) => onPickerKey('row', e)}
                    onBlur={() => onPickerBlur('row')}
                    disabled={busy()}
                    aria-label="Objekt fuer manuelle Zeile suchen"
                    autocomplete="off"
                  />
                </Show>
              </div>
            </section>
            <section class="group-matrix-source">
              <label class="group-matrix-source-label" for="gmg-col-select">
                Spalten
              </label>
              <select
                id="gmg-col-select"
                class="group-matrix-select"
                value={colGroupId()}
                onChange={(e) => pickColGroup(e.currentTarget.value)}
                disabled={busy()}
              >
                <option value="">— Gruppe waehlen —</option>
                <For each={groups() ?? []}>{(g) => <option value={g.id}>{g.name}</option>}</For>
              </select>
              <Show when={colMembers().length > 0}>
                <div class="group-matrix-actions">
                  <button type="button" onClick={selectAllCols} class="link-btn">
                    Alle
                  </button>
                  <span> · </span>
                  <button type="button" onClick={clearCols} class="link-btn">
                    Keine
                  </button>
                  <span class="group-matrix-actions-count">
                    {colSelection().size} / {colMembers().length}
                  </span>
                </div>
                <ul class="group-matrix-member-list">
                  <For each={colMembers()}>
                    {(m) => (
                      <li class="group-matrix-member-row" classList={{ 'is-manual': m.manual }}>
                        <input
                          type="checkbox"
                          class="group-matrix-checkbox"
                          checked={colSelection().has(m.id)}
                          onChange={() => toggleCol(m.id)}
                          disabled={busy()}
                          aria-label={m.label}
                        />
                        <span class="group-matrix-member-label">{m.label}</span>
                        <Show when={m.manual}>
                          <button
                            type="button"
                            class="group-matrix-member-remove"
                            onClick={() => removeManualEntry('col', m.id)}
                            disabled={busy()}
                            aria-label={`${m.label} entfernen`}
                            title="Manuelle Spalte entfernen"
                          >
                            <Icon name="x" size={11} />
                          </button>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <div class="group-matrix-add-row">
                <Show
                  when={pickerKind() === 'col'}
                  fallback={
                    <button
                      type="button"
                      class="group-matrix-add-btn"
                      onClick={() => openManualPicker('col')}
                      disabled={busy()}
                      title="Einzelnes Objekt als Spalte ergaenzen"
                    >
                      <Icon name="plus" size={12} />
                      <span>Manuelle Spalte</span>
                    </button>
                  }
                >
                  <input
                    ref={colAddInputRef}
                    type="text"
                    class="group-matrix-add-input"
                    placeholder="Objekt suchen…"
                    onInput={(e) => onPickerInput('col', e)}
                    onKeyDown={(e) => onPickerKey('col', e)}
                    onBlur={() => onPickerBlur('col')}
                    disabled={busy()}
                    aria-label="Objekt fuer manuelle Spalte suchen"
                    autocomplete="off"
                  />
                </Show>
              </div>
            </section>
          </div>
          <label class="group-matrix-name-row">
            <span class="group-matrix-name-label">Matrix-Name</span>
            <input
              type="text"
              class="group-matrix-name-input"
              value={matrixName()}
              onInput={(e) => setMatrixName(e.currentTarget.value)}
              placeholder={defaultName() || 'Neue Matrix'}
              disabled={busy()}
            />
          </label>
        </div>
        <footer class="overlay-foot group-matrix-foot">
          <button type="button" class="btn-subtle" onClick={p.onClose} disabled={busy()}>
            Abbrechen
          </button>
          <button
            type="button"
            class="btn btn-p"
            onClick={submit}
            disabled={busy() || (rowSelection().size === 0 && colSelection().size === 0)}
          >
            {rowSelection().size}×{colSelection().size}-Matrix anlegen
          </button>
        </footer>
      </div>
      <ObjectSuggestion />
    </div>
  );
};

export default GroupMatrixGenerator;
