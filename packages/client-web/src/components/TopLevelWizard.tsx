// Phase 3 O.8.N.2 — TopLevelWizard: einheitlicher Anlage-Pfad fuer
// Workspace-Root-Knoten (Matrix oder Board). Vorher rief der Empty-
// State `createRootMatrixWithDefaults`/`createRootBoardWithDefaults`
// direkt ohne UI auf — jetzt holen wir Alias + Name kontrolliert ab.
//
// Anders als der NewCellWizard:
//  - Single-Step (kein Cycle, kein Multi-Feature-Picker).
//  - Top-Level hat KEIN parent_cell → dynamische `{row.object}` /
//    `{column.object}`-Templates ergeben semantisch nichts. Wir
//    speichern label_template = label (Plain).
//  - Default-Name = "Matrix" / "Board" voll-markiert (sofort
//    ueberschreibbar, exakt wie Pos 1 im NewCellWizard).
//
// Mutation:
//  - createRootMatrixWithDefaults / createRootBoardWithDefaults
//    nehmen optional `alias` + `labelTemplate` (seit O.8.N.2). Defaults
//    + Seeds (2x2 / 3 kb_cols) bleiben unveraendert.

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { validateAlias } from '../lib/alias';
import { installFocusRestore, installFocusTrap } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { createRootBoardWithDefaults, createRootMatrixWithDefaults } from '../lib/mutations';
import { showToast } from '../lib/toasts';
import Icon from './Icon';

type Props = {
  workspaceId: string;
  type: 'matrix' | 'board';
  onClose: () => void;
  onCreated?: (nodeId: string) => void;
};

const TopLevelWizard: Component<Props> = (p) => {
  const defaultLabel = () => (p.type === 'matrix' ? 'Matrix' : 'Board');
  const titleText = () => (p.type === 'matrix' ? 'Neue Matrix anlegen' : 'Neues Board anlegen');
  const successMsg = () =>
    p.type === 'matrix'
      ? 'Matrix angelegt — du kannst direkt loslegen.'
      : 'Board angelegt — drei Spalten warten auf Karten.';
  const errorFallback = () =>
    p.type === 'matrix'
      ? 'Matrix konnte nicht angelegt werden.'
      : 'Board konnte nicht angelegt werden.';

  const [aliasDraft, setAliasDraft] = createSignal('');
  const [labelDraft, setLabelDraft] = createSignal(defaultLabel());
  const [busy, setBusy] = createSignal(false);

  let cardRef: HTMLDivElement | undefined;
  let aliasInputRef: HTMLInputElement | undefined;
  let nameInputRef: HTMLInputElement | undefined;

  onMount(() => {
    onCleanup(installFocusRestore());
    if (cardRef) onCleanup(installFocusTrap(cardRef));
    // Beim Oeffnen Fokus auf Name-Input + voll markieren — sofortiges
    // Ueberschreiben analog Pos 1 im NewCellWizard.
    queueMicrotask(() => {
      if (nameInputRef) {
        nameInputRef.focus();
        nameInputRef.select();
      }
    });
    document.addEventListener('keydown', onGlobalKey, true);
    onCleanup(() => document.removeEventListener('keydown', onGlobalKey, true));
  });

  function onGlobalKey(e: KeyboardEvent) {
    if (busy()) return;
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      e.preventDefault();
      p.onClose();
      return;
    }
    if (e.key === 'Enter') {
      // Enter ueberall im Wizard: anlegen.
      e.preventDefault();
      e.stopImmediatePropagation();
      void doCommit();
    }
  }

  async function doCommit() {
    if (busy()) return;
    setBusy(true);
    try {
      const aliasNext = aliasDraft().trim();
      let canonicalAlias: string | null = null;
      if (aliasNext) {
        const res = await validateAlias(aliasNext, p.workspaceId, {
          type: 'node',
          id: '__new__',
        });
        if (!res.ok) {
          showToast(res.msg, 'error');
          setBusy(false);
          return;
        }
        canonicalAlias = res.canonical;
      }
      const labelNext = labelDraft().trim() || defaultLabel();

      const node =
        p.type === 'matrix'
          ? await createRootMatrixWithDefaults({
              workspaceId: p.workspaceId,
              label: labelNext,
              labelTemplate: labelNext,
              alias: canonicalAlias,
            })
          : await createRootBoardWithDefaults({
              workspaceId: p.workspaceId,
              label: labelNext,
              labelTemplate: labelNext,
              alias: canonicalAlias,
            });
      showToast(successMsg(), 'success');
      p.onCreated?.(node.id);
      p.onClose();
    } catch (err) {
      console.error('TopLevelWizard.doCommit:', err);
      showToast(translateDbError(err, errorFallback()), 'error');
      setBusy(false);
    }
  }

  return (
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy()) p.onClose();
      }}
      // Empty onKeyDown haelt biome's a11y/useKeyWithClickEvents zufrieden
      // — Tastatur laeuft ueber den globalen Capture-Handler.
      onKeyDown={() => {}}
    >
      <div
        ref={cardRef}
        class="overlay-card top-level-wizard"
        // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> Pattern wie restliche Modals.
        role="dialog"
        aria-modal="true"
        aria-labelledby="top-level-wizard-title"
      >
        <header class="overlay-head top-level-wizard-head">
          <h3 id="top-level-wizard-title">{titleText()}</h3>
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
        <div class="top-level-wizard-body">
          <label class="top-level-wizard-row">
            <span class="top-level-wizard-label">Alias</span>
            <input
              ref={aliasInputRef}
              type="text"
              class="top-level-wizard-input"
              value={aliasDraft()}
              onInput={(e) => setAliasDraft(e.currentTarget.value)}
              placeholder="^optional"
              disabled={busy()}
            />
          </label>
          <label class="top-level-wizard-row">
            <span class="top-level-wizard-label">Name</span>
            <input
              ref={nameInputRef}
              type="text"
              class="top-level-wizard-input"
              value={labelDraft()}
              onInput={(e) => setLabelDraft(e.currentTarget.value)}
              disabled={busy()}
            />
          </label>
          <p class="top-level-wizard-hint">
            <Show
              when={p.type === 'matrix'}
              fallback={<>3 Spalten ToDo / In Arbeit / Erledigt werden automatisch angelegt.</>}
            >
              2 Zeilen + 2 Spalten als Starter — du kannst sofort tippen.
            </Show>
          </p>
        </div>
        <footer class="overlay-foot top-level-wizard-foot">
          <span class="top-level-wizard-tip">
            <kbd>↩</kbd> anlegen · <kbd>Esc</kbd>
          </span>
          <button type="button" class="btn-subtle" onClick={p.onClose} disabled={busy()}>
            Abbrechen
          </button>
          <button type="button" class="btn btn-p" onClick={() => void doCommit()} disabled={busy()}>
            Anlegen
          </button>
        </footer>
      </div>
    </div>
  );
};

export default TopLevelWizard;
