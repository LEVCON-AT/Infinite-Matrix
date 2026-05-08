// Welle WV.A.7 — FilterBuilderModal.
//
// UI fuer SavedFilterBody-Erzeugung/-Edit. Konsumiert
// lib/atom-filter-attrs.ts (WV.Y) fuer Field-Liste pro AtomKind und
// lib/saved-filters.ts (WV.A.4) fuer Persistenz.
//
// Konzept-Verankerung: §16.2 (R-WV-11 globaler Reuse) + §15.1-A
// saved_filters-Tabelle.
//
// V1 Scope:
//   - Conditions flach (kein Group-Nesting) — AND/OR auf Top-Level.
//   - Pro Condition: Field-Picker + Operator-Picker + Value-Input.
//   - Save speichert via addSavedFilter/updateSavedFilter.
//   - Workspace-shared vs. User-privat-Toggle (owner_user_id).
//
// V2 (Welle B/C):
//   - Group-Nesting (verschachtelte AND/OR-Gruppen).
//   - Live-Preview: Anzeige der Treffer-Anzahl.
//   - Filter-Cloning aus existing Saved-Filter.

import {
  type Component,
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import {
  type AtomFilterAttribute,
  type FilterOperator,
  type SavedFilterBody,
  type SavedFilterCondition,
  attrsFor,
} from '../lib/atom-filter-attrs';
import type { AtomKind } from '../lib/atom-manifestations';
import { currentUserIdSync } from '../lib/auth';
import { translateDbError } from '../lib/errors';
import { addSavedFilter, updateSavedFilter } from '../lib/saved-filters';
import { showToast } from '../lib/toasts';
import type { SavedFilterRow } from '../lib/types';
import Icon from './Icon';

export type FilterBuilderModalProps = {
  workspaceId: string;
  // Optional initialer Filter (Edit-Mode). Bei null = Create-Mode.
  existing?: SavedFilterRow | null;
  // Optional vorgegebener AtomKind (z.B. wenn FilterBox in BoardView
  // nur task-Filter erlaubt). Bei null kann User waehlen.
  atomKindLock?: AtomKind | null;
  onClose: () => void;
  onSaved?: (row: SavedFilterRow) => void;
};

const FilterBuilderModal: Component<FilterBuilderModalProps> = (p) => {
  let dialogEl: HTMLDialogElement | undefined;

  const initialBody: SavedFilterBody = (p.existing?.body as SavedFilterBody | undefined) ?? {
    v: 1,
    atomKind: p.atomKindLock ?? 'task',
    logic: 'and',
    conditions: [],
  };

  const [name, setName] = createSignal(p.existing?.name ?? '');
  const [atomKind, setAtomKind] = createSignal<AtomKind>(initialBody.atomKind);
  const [logic, setLogic] = createSignal<'and' | 'or'>(initialBody.logic);
  const [conditions, setConditions] = createSignal<SavedFilterCondition[]>(
    initialBody.conditions.slice(),
  );
  const [isPrivate, setIsPrivate] = createSignal<boolean>(p.existing?.owner_user_id !== null);
  const [submitting, setSubmitting] = createSignal(false);

  const availableAttrs = createMemo<ReadonlyArray<AtomFilterAttribute>>(() => attrsFor(atomKind()));

  function addCondition(): void {
    const first = availableAttrs()[0];
    if (!first) return;
    setConditions([
      ...conditions(),
      {
        field: first.key,
        operator: first.operators[0] ?? 'eq',
        value: defaultValueFor(first),
      },
    ]);
  }

  function removeCondition(idx: number): void {
    setConditions(conditions().filter((_, i) => i !== idx));
  }

  function patchCondition(idx: number, patch: Partial<SavedFilterCondition>): void {
    const next = conditions().slice();
    const cur = next[idx];
    if (!cur) return;
    next[idx] = { ...cur, ...patch };
    setConditions(next);
  }

  function isValid(): boolean {
    if (!name().trim()) return false;
    if (conditions().length === 0) return false;
    for (const c of conditions()) {
      if (c.operator === 'is-empty' || c.operator === 'is-not-empty') continue;
      if (c.value === null || c.value === undefined) return false;
      if (typeof c.value === 'string' && !c.value.trim()) return false;
      if (Array.isArray(c.value) && c.value.length === 0) return false;
    }
    return true;
  }

  async function handleSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (submitting()) return;
    if (!isValid()) return;
    setSubmitting(true);
    try {
      const body: SavedFilterBody = {
        v: 1,
        atomKind: atomKind(),
        logic: logic(),
        conditions: conditions(),
      };
      if (p.existing) {
        const updated = await updateSavedFilter(p.existing.id, { name: name(), body });
        showToast('Filter gespeichert', 'success');
        p.onSaved?.(updated);
      } else {
        const userOnly = isPrivate();
        const ownerUserId = userOnly ? currentUserIdSync() : null;
        if (userOnly && !ownerUserId) {
          throw new Error('Kein angemeldeter User — Filter kann nicht privat gespeichert werden.');
        }
        const row = await addSavedFilter({
          workspaceId: p.workspaceId,
          ownerUserId,
          name: name(),
          body,
        });
        showToast('Filter gespeichert', 'success');
        p.onSaved?.(row);
      }
      p.onClose();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  }

  onMount(() => {
    dialogEl?.showModal();
    const firstInput = dialogEl?.querySelector<HTMLElement>('input, select');
    firstInput?.focus();
  });

  onCleanup(() => {
    dialogEl?.close();
  });

  return (
    <dialog
      ref={dialogEl}
      class="overlay-modal filter-builder-modal"
      aria-labelledby="filter-builder-title"
      onCancel={(e) => {
        e.preventDefault();
        p.onClose();
      }}
    >
      <button
        type="button"
        class="overlay-modal-backdrop-closer"
        onClick={p.onClose}
        aria-label="Schliessen"
        tabIndex={-1}
      />
      <div class="overlay-card">
        <header class="overlay-head">
          <h3 id="filter-builder-title">{p.existing ? 'Filter bearbeiten' : 'Filter erstellen'}</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>

        <form class="filter-builder-form" onSubmit={handleSubmit}>
          <div class="filter-builder-row">
            <label class="filter-builder-field" for="filter-builder-name">
              Name
            </label>
            <input
              id="filter-builder-name"
              type="text"
              class="filter-builder-input"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="z.B. Offene Aufgaben mit Frist"
              required
            />
          </div>

          <div class="filter-builder-row">
            <label class="filter-builder-field" for="filter-builder-atomkind">
              Atom-Typ
            </label>
            <select
              id="filter-builder-atomkind"
              class="filter-builder-input"
              value={atomKind()}
              disabled={p.atomKindLock != null || !!p.existing}
              onChange={(e) => {
                setAtomKind(e.currentTarget.value as AtomKind);
                // Bei AtomKind-Wechsel: Conditions auf neue Field-Liste
                // zurueckschneiden. Nur Conditions behalten, deren field
                // im neuen attrsFor() existiert.
                const nextAttrs = attrsFor(e.currentTarget.value as AtomKind);
                const validKeys = new Set(nextAttrs.map((a) => a.key));
                setConditions(conditions().filter((c) => validKeys.has(c.field)));
              }}
            >
              <option value="task">Tasks</option>
              <option value="link">Links</option>
              <option value="doc">Dokus</option>
              <option value="checklist">Checklisten</option>
              <option value="imported_event">Termine</option>
            </select>
          </div>

          <div class="filter-builder-conditions">
            <header class="filter-builder-conditions-head">
              <span>Bedingungen</span>
              <select
                class="filter-builder-logic"
                value={logic()}
                onChange={(e) => setLogic(e.currentTarget.value as 'and' | 'or')}
              >
                <option value="and">Alle erfuellt (UND)</option>
                <option value="or">Mindestens eine (ODER)</option>
              </select>
            </header>

            <For each={conditions()}>
              {(condition, idx) => (
                <ConditionRow
                  condition={condition}
                  attrs={availableAttrs()}
                  onPatch={(patch) => patchCondition(idx(), patch)}
                  onRemove={() => removeCondition(idx())}
                />
              )}
            </For>

            <button type="button" class="filter-builder-add" onClick={addCondition}>
              <Icon name="plus" size={12} />
              <span>Bedingung hinzufuegen</span>
            </button>
          </div>

          <Show when={!p.existing}>
            <label class="filter-builder-checkbox-row">
              <input
                type="checkbox"
                checked={isPrivate()}
                onChange={(e) => setIsPrivate(e.currentTarget.checked)}
              />
              <span>Nur fuer mich (privat)</span>
            </label>
          </Show>

          <footer class="filter-builder-actions">
            <button type="button" class="btn-secondary" onClick={p.onClose}>
              Abbrechen
            </button>
            <button type="submit" class="btn-primary" disabled={submitting() || !isValid()}>
              Speichern
            </button>
          </footer>
        </form>
      </div>
    </dialog>
  );
};

const ConditionRow: Component<{
  condition: SavedFilterCondition;
  attrs: ReadonlyArray<AtomFilterAttribute>;
  onPatch: (p: Partial<SavedFilterCondition>) => void;
  onRemove: () => void;
}> = (p) => {
  const currentAttr = createMemo<AtomFilterAttribute | undefined>(() =>
    p.attrs.find((a) => a.key === p.condition.field),
  );

  return (
    <div class="filter-builder-condition">
      <select
        class="filter-builder-input filter-builder-input-field"
        value={p.condition.field}
        onChange={(e) => {
          const nextField = e.currentTarget.value;
          const attr = p.attrs.find((a) => a.key === nextField);
          if (!attr) return;
          p.onPatch({
            field: nextField,
            operator: attr.operators[0] ?? 'eq',
            value: defaultValueFor(attr),
          });
        }}
      >
        <For each={p.attrs}>{(a) => <option value={a.key}>{a.label}</option>}</For>
      </select>

      <select
        class="filter-builder-input filter-builder-input-operator"
        value={p.condition.operator}
        onChange={(e) => p.onPatch({ operator: e.currentTarget.value as FilterOperator })}
      >
        <For each={currentAttr()?.operators ?? []}>
          {(op) => <option value={op}>{operatorLabel(op)}</option>}
        </For>
      </select>

      <Show when={p.condition.operator !== 'is-empty' && p.condition.operator !== 'is-not-empty'}>
        <ConditionValueInput
          condition={p.condition}
          attr={currentAttr()}
          onValueChange={(value) => p.onPatch({ value })}
        />
      </Show>

      <button
        type="button"
        class="filter-builder-condition-remove"
        title="Bedingung entfernen"
        onClick={p.onRemove}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
};

const ConditionValueInput: Component<{
  condition: SavedFilterCondition;
  attr?: AtomFilterAttribute;
  onValueChange: (v: SavedFilterCondition['value']) => void;
}> = (p) => {
  return (
    <Switch>
      <Match when={p.attr?.fieldType === 'enum'}>
        <select
          class="filter-builder-input filter-builder-input-value"
          value={String(p.condition.value ?? '')}
          onChange={(e) => p.onValueChange(e.currentTarget.value)}
        >
          <For each={p.attr?.enumValues ?? []}>
            {(o) => <option value={o.value}>{o.label}</option>}
          </For>
        </select>
      </Match>
      <Match when={p.attr?.fieldType === 'boolean'}>
        <select
          class="filter-builder-input filter-builder-input-value"
          value={String(p.condition.value ?? 'true')}
          onChange={(e) => p.onValueChange(e.currentTarget.value === 'true')}
        >
          <option value="true">Ja</option>
          <option value="false">Nein</option>
        </select>
      </Match>
      <Match when={p.attr?.fieldType === 'date'}>
        <input
          type="date"
          class="filter-builder-input filter-builder-input-value"
          value={String(p.condition.value ?? '')}
          onInput={(e) => p.onValueChange(e.currentTarget.value)}
        />
      </Match>
      <Match when={p.attr?.fieldType === 'datetime'}>
        <input
          type="datetime-local"
          class="filter-builder-input filter-builder-input-value"
          value={String(p.condition.value ?? '')}
          onInput={(e) => p.onValueChange(e.currentTarget.value)}
        />
      </Match>
      <Match when={p.attr?.fieldType === 'number'}>
        <input
          type="number"
          class="filter-builder-input filter-builder-input-value"
          value={typeof p.condition.value === 'number' ? p.condition.value : ''}
          onInput={(e) =>
            p.onValueChange(e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))
          }
        />
      </Match>
      <Match when={p.attr?.fieldType === 'multi-tag' || p.attr?.fieldType === 'multi-string'}>
        <input
          type="text"
          class="filter-builder-input filter-builder-input-value"
          placeholder="Komma-getrennt"
          value={Array.isArray(p.condition.value) ? p.condition.value.join(', ') : ''}
          onInput={(e) =>
            p.onValueChange(
              e.currentTarget.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      </Match>
      <Match when={true}>
        <input
          type="text"
          class="filter-builder-input filter-builder-input-value"
          value={String(p.condition.value ?? '')}
          onInput={(e) => p.onValueChange(e.currentTarget.value)}
        />
      </Match>
    </Switch>
  );
};

function operatorLabel(op: FilterOperator): string {
  if (op === 'contains') return 'enthaelt';
  if (op === 'starts-with') return 'beginnt mit';
  if (op === 'eq') return 'ist gleich';
  if (op === 'neq') return 'ist nicht';
  if (op === 'lt') return 'ist kleiner';
  if (op === 'lte') return 'ist <=';
  if (op === 'gt') return 'ist groesser';
  if (op === 'gte') return 'ist >=';
  if (op === 'between') return 'liegt zwischen';
  if (op === 'before') return 'vor';
  if (op === 'after') return 'nach';
  if (op === 'in') return 'eines von';
  if (op === 'not-in') return 'keines von';
  if (op === 'has-any') return 'hat eines';
  if (op === 'has-all') return 'hat alle';
  if (op === 'has-none') return 'hat keines';
  if (op === 'is-empty') return 'ist leer';
  return 'ist gesetzt';
}

function defaultValueFor(attr: AtomFilterAttribute): SavedFilterCondition['value'] {
  if (attr.fieldType === 'enum') return attr.enumValues?.[0]?.value ?? '';
  if (attr.fieldType === 'boolean') return true;
  if (attr.fieldType === 'multi-tag' || attr.fieldType === 'multi-string') return [];
  if (attr.fieldType === 'number') return 0;
  return '';
}

export default FilterBuilderModal;
