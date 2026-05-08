// Welle WV.C.4 — Bulk-Wizard-Flow (Konzept §8.2.2).
//
// 3-Step-Wizard:
//   Step 1: Vorlage waehlen (uebersprungen wenn 1-9 direkt).
//   Step 1a: BulkConflictPicker fuer Cells mit Vorlage-Konflikt.
//   Step 2: BulkScalarInput fuer Auto-Alias-Vergabe.
//   Step 3: Confirm + Submit.
//
// Caller liefert vollstaendige selectedCells + templates + existingInstances.
// Wizard managed Internal-State (Step, ausgewaehlte Vorlage, Skip-Set,
// Alias-Pattern, Per-Row-Override).

import {
  type Component,
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import {
  type BulkApplyTemplateResult,
  buildAutoAlias,
  bulkApplyTemplate,
  resolveAliasConflicts,
} from '../../lib/bulk-apply-template';
import { removeTemplateFromCell } from '../../lib/cell-templates';
import { translateDbError } from '../../lib/errors';
import { showToast, showUndoToast } from '../../lib/toasts';
import type {
  CellRow,
  CellTemplateInstanceRow,
  ColRow,
  FeatureTemplateRow,
  RowRow,
} from '../../lib/types';
import Icon from '../Icon';
import BulkConflictPicker, { type BulkConflictItem } from './BulkConflictPicker';
import BulkScalarInput, { type BulkScalarRow } from './BulkScalarInput';

export type BulkWizardModalProps = {
  workspaceId: string;
  appliedBy: string | null;
  // Selected cells inkl. Coords + existing alias.
  selectedCells: ReadonlyArray<CellRow>;
  // Lookup-Maps fuer Row/Col-Labels (fuer Auto-Alias).
  rows: ReadonlyArray<RowRow>;
  cols: ReadonlyArray<ColRow>;
  // Alle sichtbaren Vorlagen (Plattform + Workspace + Privat).
  templates: ReadonlyArray<FeatureTemplateRow>;
  // Bestehende Cell-Template-Instances zum Konflikt-Check.
  existingInstances: ReadonlyArray<CellTemplateInstanceRow>;
  // Existing aliases im Workspace fuer Konflikt-Suffix.
  existingAliases: ReadonlySet<string>;
  // Wenn 1-9 direkt: vorausgewaehlte Vorlage → Step 1 wird uebersprungen.
  preselectedTemplateId?: string | null;
  // Caller refetcht nach Submit.
  onApplied: (result: BulkApplyTemplateResult) => void;
  onClose: () => void;
};

type Step = 'pick-template' | 'resolve-conflicts' | 'pick-aliases' | 'confirm';

const BulkWizardModal: Component<BulkWizardModalProps> = (p) => {
  let dialogEl: HTMLDialogElement | undefined;

  // Step-State.
  const [step, setStep] = createSignal<Step>(
    p.preselectedTemplateId ? 'resolve-conflicts' : 'pick-template',
  );
  const [templateId, setTemplateId] = createSignal<string | null>(p.preselectedTemplateId ?? null);
  const [skipIds, setSkipIds] = createSignal<ReadonlySet<string>>(new Set());
  const [aliasPattern, setAliasPattern] = createSignal('{vorlage}-{row}-{col}');
  const [perRowAliases, setPerRowAliases] = createSignal<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    dialogEl?.showModal();
  });
  onCleanup(() => {
    dialogEl?.close();
  });

  // ─── Derived Models ─────────────────────────────────────────

  const selectedTemplate = createMemo(() => p.templates.find((t) => t.id === templateId()) ?? null);

  const rowLabel = (rowId: string) => p.rows.find((r) => r.id === rowId)?.label ?? '';
  const colLabel = (colId: string) => p.cols.find((c) => c.id === colId)?.label ?? '';

  // Pre-Initialisierung Skip-Set bei Conflict-Step:
  // Default markiert (= ueberspringen) fuer alle Cells, die bereits
  // diese Vorlage haben (Konzept §8.2.2 Step 1a).
  const conflictItems = createMemo<BulkConflictItem[]>(() => {
    const tplId = templateId();
    if (!tplId) return [];
    return p.selectedCells
      .map<BulkConflictItem | null>((cell) => {
        const inst = p.existingInstances.find(
          (i) => i.cell_id === cell.id && i.template_id === tplId,
        );
        if (!inst) return null;
        // V1: nur „other-template"/„re-sync" — overrides + locked
        // brauchen separate Lookup-Maps (V2-Erweiterung).
        const tpl = selectedTemplate();
        const layoutDelta = tpl ? tpl.layout_version > inst.layout_version : false;
        return {
          id: cell.id,
          label: `${rowLabel(cell.row_id)}/${colLabel(cell.col_id)}`,
          detail: layoutDelta
            ? `re-sync v${inst.layout_version}→v${tpl?.layout_version}`
            : 'bereits angewandt',
          kind: layoutDelta ? 're-sync' : 'duplicate',
        };
      })
      .filter((x): x is BulkConflictItem => x !== null);
  });

  // Wenn keine Konflikte: Conflict-Step automatisch ueberspringen.
  createEffect(() => {
    if (step() === 'resolve-conflicts' && conflictItems().length === 0) {
      setStep('pick-aliases');
    }
  });

  // Beim Wechsel auf Conflict-Step: Skip-Set initialisieren mit allen
  // konflikthaften IDs (Default markiert = ueberspringen).
  function initSkipSet(): void {
    setSkipIds(new Set(conflictItems().map((c) => c.id)));
  }

  // Cells, die effektiv angewandt werden (Selection minus Skip).
  const cellsToApply = createMemo<ReadonlyArray<CellRow>>(() => {
    const skips = skipIds();
    return p.selectedCells.filter((c) => !skips.has(c.id));
  });

  // BulkScalarInput-Zeilen mit Alias-Vorschlag.
  const aliasRows = createMemo<BulkScalarRow[]>(() => {
    const tpl = selectedTemplate();
    const tmpl = aliasPattern();
    const overrides = perRowAliases();
    return cellsToApply().map((cell) => {
      const proposed = buildAutoAlias(tmpl, {
        templateName: tpl?.name ?? 'vorlage',
        rowLabel: rowLabel(cell.row_id),
        colLabel: colLabel(cell.col_id),
      });
      const value = overrides.get(cell.id) ?? proposed;
      return {
        id: cell.id,
        label: `${rowLabel(cell.row_id)}/${colLabel(cell.col_id)}`,
        value,
      };
    });
  });

  // Resolved-Aliases mit Konflikt-Suffix (gegen bestehende Aliases).
  const resolvedAliases = createMemo<ReadonlyMap<string, string>>(() => {
    const candidates = aliasRows().map((r) => ({ cellId: r.id, proposed: r.value }));
    return resolveAliasConflicts(candidates, p.existingAliases);
  });

  // ─── Step-Wechsel Handlers ─────────────────────────────────

  function goToConflict(): void {
    initSkipSet();
    setStep('resolve-conflicts');
    // Wenn keine Konflikte: direkt Step 2.
    if (conflictItems().length === 0) {
      setStep('pick-aliases');
    }
  }

  function handleTemplatePick(id: string): void {
    setTemplateId(id);
    goToConflict();
  }

  // ─── Submit ─────────────────────────────────────────────────

  async function handleSubmit(): Promise<void> {
    const tpl = selectedTemplate();
    if (!tpl || busy()) return;
    setBusy(true);
    try {
      const aliases = resolvedAliases();
      const cells = cellsToApply().map((cell) => ({
        cellId: cell.id,
        alias: aliases.get(cell.id) ?? null,
      }));
      const result = await bulkApplyTemplate({
        workspaceId: p.workspaceId,
        templateId: tpl.id,
        layoutVersion: tpl.layout_version,
        appliedBy: p.appliedBy,
        cells,
      });

      if (result.applied.length > 0) {
        showUndoToast(`Vorlage „${tpl.name}" auf ${result.applied.length} Cells angewendet`, () => {
          // Undo: alle frischen Instanzen entfernen.
          for (const a of result.applied) {
            void removeTemplateFromCell(a.instance.id).catch((err) => {
              console.error('undo bulkApply:', err);
            });
          }
          showToast('Bulk-Apply rueckgaengig gemacht.', 'info');
        });
      }
      if (result.failed.length > 0) {
        showToast(
          `${result.failed.length} Cells konnten nicht aktualisiert werden — Detail in Console.`,
          'error',
        );
        console.warn('bulkApplyTemplate failed cells:', result.failed);
      }
      p.onApplied(result);
    } catch (err) {
      console.error('bulkApplyTemplate:', err);
      showToast(translateDbError(err, 'Bulk-Apply fehlgeschlagen.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  // ─── Render ─────────────────────────────────────────────────

  return (
    <dialog
      ref={(el) => {
        dialogEl = el;
      }}
      class="overlay-modal"
      aria-labelledby="bulk-wizard-title"
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
      <div class="overlay-card bulk-wizard-card">
        <header class="overlay-head">
          <h3 id="bulk-wizard-title">
            <Switch>
              <Match when={step() === 'pick-template'}>Vorlage waehlen</Match>
              <Match when={step() === 'resolve-conflicts'}>Konflikte aufloesen</Match>
              <Match when={step() === 'pick-aliases'}>Aliase vergeben</Match>
              <Match when={step() === 'confirm'}>Bestaetigen</Match>
            </Switch>
            <span class="bulk-wizard-step-pill">
              {stepIndex(step())}/{totalSteps()}
            </span>
          </h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div class="bulk-wizard-body">
          <Switch>
            <Match when={step() === 'pick-template'}>
              <p class="bulk-wizard-hint">
                {p.selectedCells.length} Cells selektiert. Welche Vorlage anwenden?
              </p>
              <ul class="bulk-wizard-template-list">
                <For each={p.templates}>
                  {(t) => (
                    <li>
                      <button
                        type="button"
                        class="bulk-wizard-template-item"
                        classList={{ active: templateId() === t.id }}
                        onClick={() => handleTemplatePick(t.id)}
                      >
                        <span class="bulk-wizard-template-symbol">
                          <Icon name="document-text" size={16} />
                        </span>
                        <span class="bulk-wizard-template-name">{t.name}</span>
                        <Show when={t.hotkey_slot}>
                          {(slot) => <span class="bulk-wizard-template-slot">{slot()}</span>}
                        </Show>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Match>

            <Match when={step() === 'resolve-conflicts'}>
              <BulkConflictPicker
                summary={`Vorlage „${selectedTemplate()?.name ?? ''}" wird auf ${cellsToApply().length} von ${p.selectedCells.length} Cells angewendet.`}
                items={conflictItems()}
                skipIds={skipIds()}
                onToggleItem={(id) => {
                  setSkipIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  });
                }}
                onToggleAll={(allSkip) => {
                  setSkipIds(
                    allSkip ? new Set(conflictItems().map((c) => c.id)) : new Set<string>(),
                  );
                }}
              />
            </Match>

            <Match when={step() === 'pick-aliases'}>
              <p class="bulk-wizard-hint">
                Auto-Alias-Pattern. Tokens: <code>{'{vorlage}'}</code>, <code>{'{row}'}</code>,{' '}
                <code>{'{col}'}</code>.
              </p>
              <BulkScalarInput
                patternLabel="Alias-Pattern"
                patternValue={aliasPattern()}
                patternPlaceholder="{vorlage}-{row}-{col}"
                onPatternInput={(v) => setAliasPattern(v)}
                onApplyPattern={() => setPerRowAliases(new Map())}
                rows={aliasRows()}
                onRowInput={(id, value) => {
                  setPerRowAliases((prev) => {
                    const next = new Map(prev);
                    next.set(id, value);
                    return next;
                  });
                }}
              />
            </Match>

            <Match when={step() === 'confirm'}>
              <p class="bulk-wizard-hint">
                <strong>{cellsToApply().length} Cells</strong> erhalten die Vorlage{' '}
                <strong>„{selectedTemplate()?.name}"</strong>.
              </p>
              <ul class="bulk-wizard-confirm-list">
                <For each={cellsToApply()}>
                  {(cell) => {
                    const finalAlias = resolvedAliases().get(cell.id) ?? '';
                    return (
                      <li>
                        <span class="bulk-wizard-confirm-coord">
                          {rowLabel(cell.row_id)}/{colLabel(cell.col_id)}
                        </span>
                        <Show when={finalAlias}>
                          <span class="bulk-wizard-confirm-alias">^{finalAlias}</span>
                        </Show>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Match>
          </Switch>
        </div>

        <footer class="bulk-wizard-actions">
          <button type="button" class="btn-secondary" onClick={p.onClose}>
            Abbrechen
          </button>
          <Show when={step() !== 'pick-template'}>
            <button
              type="button"
              class="btn-subtle"
              onClick={() => {
                if (step() === 'resolve-conflicts') setStep('pick-template');
                else if (step() === 'pick-aliases') {
                  if (conflictItems().length > 0) setStep('resolve-conflicts');
                  else setStep('pick-template');
                } else if (step() === 'confirm') setStep('pick-aliases');
              }}
            >
              Zurueck
            </button>
          </Show>
          <Switch>
            <Match when={step() === 'resolve-conflicts'}>
              <button
                type="button"
                class="btn-primary"
                disabled={cellsToApply().length === 0}
                onClick={() => setStep('pick-aliases')}
              >
                Weiter
              </button>
            </Match>
            <Match when={step() === 'pick-aliases'}>
              <button type="button" class="btn-primary" onClick={() => setStep('confirm')}>
                Weiter
              </button>
            </Match>
            <Match when={step() === 'confirm'}>
              <button
                type="button"
                class="btn-primary"
                disabled={busy() || cellsToApply().length === 0}
                onClick={() => void handleSubmit()}
              >
                {busy() ? 'Wendet an…' : `Auf ${cellsToApply().length} Cells anwenden`}
              </button>
            </Match>
          </Switch>
        </footer>
      </div>
    </dialog>
  );
};

function stepIndex(s: Step): number {
  if (s === 'pick-template') return 1;
  if (s === 'resolve-conflicts') return 2;
  if (s === 'pick-aliases') return 3;
  return 4;
}
function totalSteps(): number {
  return 4;
}

export default BulkWizardModal;
