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
import Icon from './Icon';

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
  let cardRef: HTMLDivElement | undefined;

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

  const rowMembers = createMemo(() => {
    const id = rowGroupId();
    if (!id) return [];
    return membersByGroup().get(id) ?? [];
  });

  const colMembers = createMemo(() => {
    const id = colGroupId();
    if (!id) return [];
    return membersByGroup().get(id) ?? [];
  });

  // Beim Group-Wechsel: alle Members default angehakt.
  function pickRowGroup(id: string) {
    setRowGroupId(id);
    const members = membersByGroup().get(id) ?? [];
    setRowSelection(new Set(members.map((m) => m.id)));
  }

  function pickColGroup(id: string) {
    setColGroupId(id);
    const members = membersByGroup().get(id) ?? [];
    setColSelection(new Set(members.map((m) => m.id)));
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
            Achse ist ein First-Class-Object, nicht nur ein String.
          </p>
          <Show when={(groups() ?? []).length === 0 && !groups.loading}>
            <p class="hint group-matrix-empty">
              Noch keine Gruppen im Workspace. Nutze „Bulk-Anlage" mit Shift+Klick auf „+ Zeile" und
              tippe „Als Gruppe speichern" — dann gibt's hier was zur Auswahl.
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
                      <li class="group-matrix-member-row">
                        <input
                          type="checkbox"
                          class="group-matrix-checkbox"
                          checked={rowSelection().has(m.id)}
                          onChange={() => toggleRow(m.id)}
                          disabled={busy()}
                          aria-label={m.label}
                        />
                        <span class="group-matrix-member-label">{m.label}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
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
                      <li class="group-matrix-member-row">
                        <input
                          type="checkbox"
                          class="group-matrix-checkbox"
                          checked={colSelection().has(m.id)}
                          onChange={() => toggleCol(m.id)}
                          disabled={busy()}
                          aria-label={m.label}
                        />
                        <span class="group-matrix-member-label">{m.label}</span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
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
    </div>
  );
};

export default GroupMatrixGenerator;
