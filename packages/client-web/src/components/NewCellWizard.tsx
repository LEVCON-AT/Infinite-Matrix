// Phase 3 O.8 — Cell-Anlage/Edit-Wizard.
//
// Einziger Pfad fuer Cell-Konfiguration. Ersetzt komplett das alte
// CellOverlay (geloescht in O.8.M.4). Behandelt sowohl leere Cells
// (Anlage) als auch befuellte Cells (Edit-Modus mit Add/Remove).
// Zwei-Phasen-Stepper:
//
//   Step 1 (pick) : Alias-Input + Feature-Multi-Select (Hotkey 1/2/3/4/d).
//                   Im Edit-Modus: existing Features pre-checked,
//                   originalKeys-Snapshot bleibt fuer Delta-Berechnung.
//   Step 2..N (name): pro NEU hinzugefuegtem nameable Feature ein
//                     animiertes Sub-Panel mit Strg+Up/Down-Cycle
//                     durch 5 Template-Positionen.
//   Final : commit, Modal schliessen, Cell-Chips bloop-animieren ein.
//
// Top-Level (kein parent_cell): Cycle-Positionen 2-5 ausgeblendet —
// `{row.object}`/`{column.object}`-Templates ergeben dort nichts. Cell-
// Anlage hat aber immer einen parent_cell-Kontext (Wizard-Aufruf =
// Cell-im-Matrix), also werden Pos 2-5 hier praktisch immer aktiv.
//
// Cycle-Positionen (siehe Plan):
//   1: <Type-Name>           — statisch (Default, voll-markiert)
//   2: {row.object} / {column.object}  — dynamisch (Object-Rename folgt)
//   3: {column.object} / {row.object}  — dynamisch
//   4: <resolved Pos 2>      — statischer Snapshot
//   5: <resolved Pos 3>      — statischer Snapshot
//
// Mutations-Dispatch nach FeatureKind:
//   'structural' (Matrix/Board): createChildMatrix/createChildBoard
//   'flag' nameable (Checkliste): addCellChecklist
//   'flag' non-nameable (Info)  : updateCell({features: [...,'info']})
//   'doc'                       : createDoc({attached_cell_id, ...})
//
// Edit-Mode-Specials (O.8.M.2/3):
//   - Removals (deselected pre-checked feature): bei structural mit
//     Inhalt → showConfirm; deleteNode + null-FK.
//   - „Zelle leeren"-Button im Step-1-Footer: alle Sub-Nodes weg +
//     delCellRow.
//   - Existing Features behalten ihren Namen — User aendert via
//     NodeTree-Sidebar (mit O.8.L atomic rename).

import { type Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { validateAlias } from '../lib/alias';
import { installFocusRestore, installFocusTrap, showConfirm } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { CELL_FEATURES, type FeatureDef, findFeatureByHotkey } from '../lib/features';
import { type ContextMaps, buildContext, resolveLabel } from '../lib/label-template';
import {
  addCellChecklist,
  createChildBoard,
  createChildMatrix,
  createDoc,
  delCellRow,
  deleteNode,
  insertCell,
  updateCell,
} from '../lib/mutations';
import { isNodeEmpty } from '../lib/queries';
import { showToast } from '../lib/toasts';
import type { CellRow, ColRow, RowRow } from '../lib/types';
import Icon from './Icon';

// Phase 3 O.8.M.2: Initial-State eines Edit-Wizards aus existing
// Cell ableiten — welche Features sind aktuell „aktiv"?
function deriveInitialSelected(cell: CellRow | undefined): string[] {
  if (!cell) return [];
  const out: string[] = [];
  if (cell.child_matrix_id) out.push('matrix');
  if (cell.board_id) out.push('board');
  for (const f of cell.features ?? []) {
    // Wir mappen nur 1:1 cells.features-Werte in unsere Feature-Keys.
    // 'doc' ist hier nicht enthalten — Doku haengt ueber
    // docs.attached_cell_id, kein cells.features-Eintrag (V1 keine
    // Doku-Toggle-Off via Wizard, Docs leben weiter via Suche).
    if (f === 'info' || f === 'checklists') out.push(f);
  }
  return out;
}

type Props = {
  workspaceId: string;
  matrixId: string;
  row: RowRow;
  col: ColRow;
  cell: CellRow | undefined; // undefined wenn die Cell noch keinen Insert hat
  resolverMaps?: () => ContextMaps;
  onClose: () => void;
  onCreated?: (createdKeys: string[]) => void;
};

type Step = { kind: 'pick' } | { kind: 'name'; idx: number } | { kind: 'commit' };

type CyclePosition = 1 | 2 | 3 | 4 | 5;

// Step-1-Liste: Doku als regulaere Zeile (Phase 3 O.8).
function pickableFeatures(): FeatureDef[] {
  // Reihenfolge: 1=Matrix, 2=Board, 3=Info, 4=Checkliste, d=Doku.
  // Genau die Reihenfolge der CELL_FEATURES (Hotkey-sortiert).
  return CELL_FEATURES;
}

const NewCellWizard: Component<Props> = (p) => {
  // Phase 3 O.8.M.2: Initial-State aus existing Cell. originalKeys
  // bleibt als Snapshot fuer Delta-Berechnung beim Commit.
  const originalKeys = deriveInitialSelected(p.cell);
  const isEditMode = originalKeys.length > 0;

  const [step, setStep] = createSignal<Step>({ kind: 'pick' });
  const [aliasDraft, setAliasDraft] = createSignal(p.cell?.alias ?? '');
  const [busy, setBusy] = createSignal(false);
  // Reihenfolge stable — Sub-Steps laufen in Auswahl-Reihenfolge.
  // Im Edit-Mode mit existing Features als pre-checked starten.
  const [selectedKeys, setSelectedKeys] = createSignal<string[]>([...originalKeys]);
  // Pro nameable Feature: Cycle-Position + aktueller Label-Draft.
  const [cyclePos, setCyclePos] = createSignal<Map<string, CyclePosition>>(new Map());
  const [labelDraft, setLabelDraft] = createSignal<Map<string, string>>(new Map());
  // Bloop-Indikator fuer den Caller (welche Features sollen einbloopen).
  let cardRef: HTMLDivElement | undefined;
  let aliasInputRef: HTMLInputElement | undefined;
  let nameInputRef: HTMLInputElement | undefined;
  // Phase 3 O.8.M.5: Pro Sub-Step nur einmal initial-fokussieren +
  // selektieren. Verhindert dass Re-Renders (z.B. bei busy-Toggle) die
  // User-Selection ueberschreiben.
  const nameInputInitialized = new Set<string>();

  // ─── Resolver-Context fuer Live-Vorschau ────────────────────
  const resolveCtx = createMemo(() => {
    const maps = p.resolverMaps?.();
    if (!maps) return null;
    return buildContext(p.cell?.id ?? null, maps);
  });
  // Bei Cell-Anlage existiert die Cell-Row noch nicht — wir bauen
  // den Context aus den Props (row.label/col.label + Object-Refs).
  const fallbackCtx = createMemo(() => {
    const maps = p.resolverMaps?.();
    if (!maps) {
      return {
        rowObjectLabel: null,
        rowFallbackLabel: p.row.label ?? '',
        colObjectLabel: null,
        colFallbackLabel: p.col.label ?? '',
      };
    }
    const rowObj = p.row.object_id ? maps.objectsById.get(p.row.object_id) : null;
    const colObj = p.col.object_id ? maps.objectsById.get(p.col.object_id) : null;
    return {
      rowObjectLabel: rowObj?.label ?? null,
      rowFallbackLabel: p.row.label ?? '',
      colObjectLabel: colObj?.label ?? null,
      colFallbackLabel: p.col.label ?? '',
    };
  });
  const ctx = () => resolveCtx() ?? fallbackCtx();

  // ─── Cycle-Templates pro Feature-Type ───────────────────────
  function templateAt(pos: CyclePosition, def: FeatureDef): string {
    if (pos === 1) return def.label;
    if (pos === 2) return '{row.object} / {column.object}';
    if (pos === 3) return '{column.object} / {row.object}';
    if (pos === 4) return resolveLabel('{row.object} / {column.object}', ctx(), def.label);
    return resolveLabel('{column.object} / {row.object}', ctx(), def.label);
  }

  function modusHint(pos: CyclePosition): string {
    if (pos === 1) return 'statisch (User-Eingabe)';
    if (pos === 2 || pos === 3) return 'dynamisch (Object-Rename schlaegt durch)';
    return 'statisch (Snapshot)';
  }

  // Live-Preview fuer Pos 2/3 (dynamisch resolven), sonst Plain.
  function previewLabel(template: string): string {
    return resolveLabel(template, ctx(), template);
  }

  // ─── Selektion ──────────────────────────────────────────────
  function toggleFeature(key: string) {
    setSelectedKeys((arr) => {
      if (arr.includes(key)) return arr.filter((k) => k !== key);
      return [...arr, key];
    });
  }

  // Liste der nameable selected (Reihenfolge wie selectedKeys).
  // Im Edit-Mode: nur NEU hinzugefuegte Features bekommen einen Cycle-
  // Step (existing Features behalten ihren Namen — User aendert sie
  // via Sidebar-Rename mit explicit Plain-Override-Semantik).
  const nameableSelected = createMemo(() => {
    const original = new Set(originalKeys);
    return selectedKeys()
      .filter((k) => !original.has(k))
      .map((k) => CELL_FEATURES.find((f) => f.key === k))
      .filter((d): d is FeatureDef => !!d && d.nameable);
  });

  // ─── Step-Übergänge ─────────────────────────────────────────
  function startNameSteps() {
    const list = nameableSelected();
    if (list.length === 0) {
      void doCommit();
      return;
    }
    // Default-Position 1, Default-Label = Type-Name (Pos 1 Template).
    const cycles = new Map<string, CyclePosition>();
    const drafts = new Map<string, string>();
    for (const def of list) {
      cycles.set(def.key, 1);
      drafts.set(def.key, def.label);
    }
    setCyclePos(cycles);
    setLabelDraft(drafts);
    setStep({ kind: 'name', idx: 0 });
  }

  function advanceNameStep() {
    const cur = step();
    if (cur.kind !== 'name') return;
    const next = cur.idx + 1;
    if (next >= nameableSelected().length) {
      void doCommit();
      return;
    }
    setStep({ kind: 'name', idx: next });
  }

  function backNameStep() {
    const cur = step();
    if (cur.kind !== 'name') return;
    if (cur.idx === 0) {
      setStep({ kind: 'pick' });
      return;
    }
    setStep({ kind: 'name', idx: cur.idx - 1 });
  }

  // ─── Cycle-Up/Down ──────────────────────────────────────────
  function cycle(dir: 1 | -1) {
    const cur = step();
    if (cur.kind !== 'name') return;
    const def = nameableSelected()[cur.idx];
    if (!def) return;
    // Top-Level (kein parent_cell): nur Pos 1 verfuegbar.
    const isTopLevel = !p.cell?.id && !p.matrixId;
    if (isTopLevel) return;
    const cyclesM = new Map(cyclePos());
    const draftsM = new Map(labelDraft());
    const cur2 = (cyclesM.get(def.key) ?? 1) as CyclePosition;
    let nextPos = (((cur2 - 1 + dir + 5) % 5) + 1) as CyclePosition;
    if (nextPos < 1) nextPos = 1;
    if (nextPos > 5) nextPos = 5;
    cyclesM.set(def.key, nextPos);
    draftsM.set(def.key, templateAt(nextPos, def));
    setCyclePos(cyclesM);
    setLabelDraft(draftsM);
    // Cursor-Position: Pos 1 voll-markiert, Pos 2-5 an Anfang.
    queueMicrotask(() => {
      const inp = nameInputRef;
      if (!inp) return;
      inp.focus();
      if (nextPos === 1) inp.select();
      else inp.setSelectionRange(0, 0);
    });
  }

  // ─── Commit ─────────────────────────────────────────────────
  // Commit fuer leere Cells UND existing Cells:
  //  - removed = originalKeys \ selectedKeys → delete-confirm bei
  //    structural mit Inhalten, dann deleteNode + null-FK.
  //  - added   = selectedKeys \ originalKeys → createChildMatrix/Board/
  //    addCellChecklist/createDoc mit Cycle-Template; Info als Flag.
  //  - Alias: wenn geaendert → validate + setzen.
  //  - No-Op: keine Aenderungen → einfach close, kein DB-Write.
  async function doCommit() {
    if (busy()) return;
    setBusy(true);
    setStep({ kind: 'commit' });
    try {
      const aliasNext = aliasDraft().trim();
      const sel = selectedKeys();
      const original = new Set(originalKeys);
      const newSet = new Set(sel);
      const removed = originalKeys.filter((k) => !newSet.has(k));
      const added = sel.filter((k) => !original.has(k));
      const aliasChanged = aliasNext !== (p.cell?.alias ?? '');

      // 1. Alias validieren wenn neu/geaendert.
      let canonicalAlias: string | null = p.cell?.alias ?? null;
      if (aliasChanged && aliasNext) {
        const res = await validateAlias(aliasNext, p.workspaceId, {
          type: 'cell',
          id: p.cell?.id ?? '__new__',
        });
        if (!res.ok) {
          showToast(res.msg, 'error');
          setBusy(false);
          setStep({ kind: 'pick' });
          return;
        }
        canonicalAlias = res.canonical;
      } else if (aliasChanged && !aliasNext) {
        canonicalAlias = null;
      }

      // 2. Removals confirmieren (structural mit Inhalt → showConfirm).
      //    Bei Cancel: ganzen Commit abbrechen. Sonst alle in einem Rutsch.
      for (const key of removed) {
        const def = CELL_FEATURES.find((f) => f.key === key);
        if (!def) continue;
        if (def.kind === 'structural') {
          const nodeId = key === 'matrix' ? p.cell?.child_matrix_id : p.cell?.board_id;
          if (!nodeId) continue;
          const empty = await isNodeEmpty(nodeId, def.key as 'matrix' | 'board');
          if (!empty) {
            const ok = await showConfirm({
              title: `Sub-${def.label} loeschen?`,
              message: `Sub-${def.label} und alle Inhalte loeschen? Das kann nicht rueckgaengig gemacht werden.`,
              variant: 'danger',
              confirmLabel: 'Loeschen',
            });
            if (!ok) {
              setBusy(false);
              setStep({ kind: 'pick' });
              return;
            }
          }
        }
      }

      // 3. Cell sicherstellen — bei neuer Cell INSERT mit minimalen Feldern,
      //    bei existing nur fuer FK-/Feature-Updates am Ende.
      let cellRow: CellRow;
      if (p.cell) {
        cellRow = p.cell;
      } else {
        cellRow = await insertCell({
          workspaceId: p.workspaceId,
          matrixId: p.matrixId,
          rowId: p.row.id,
          colId: p.col.id,
          patch: {
            alias: canonicalAlias,
            features: [],
            child_matrix_id: null,
            board_id: null,
          },
        });
      }

      // 4. Removals durchfuehren (Sub-Nodes loeschen, FKs nullen).
      let childMatrixId: string | null = cellRow.child_matrix_id;
      let boardId: string | null = cellRow.board_id;
      let workingFeatures: string[] = [...(cellRow.features ?? [])];
      for (const key of removed) {
        const def = CELL_FEATURES.find((f) => f.key === key);
        if (!def) continue;
        if (def.kind === 'structural') {
          const nodeId = key === 'matrix' ? childMatrixId : boardId;
          if (nodeId) {
            await deleteNode(nodeId);
          }
          if (key === 'matrix') childMatrixId = null;
          if (key === 'board') boardId = null;
          workingFeatures = workingFeatures.filter((f) => f !== key);
        } else if (def.kind === 'flag') {
          workingFeatures = workingFeatures.filter((f) => f !== key);
        }
        // 'doc': V1 entfernt nichts — Docs leben weiter ueber attached_cell_id.
      }

      // 5. Additions durchfuehren (createChildMatrix/Board/Checklist/Doc).
      const drafts = labelDraft();
      const checklistFlagAdded = added.includes('checklists');
      for (const key of added) {
        const def = CELL_FEATURES.find((f) => f.key === key);
        if (!def) continue;
        const labelTemplate = drafts.get(key) ?? def.label;
        const snapshot = previewLabel(labelTemplate) || def.label;

        if (def.kind === 'structural' && def.key === 'matrix') {
          const node = await createChildMatrix({
            workspaceId: p.workspaceId,
            parentCellId: cellRow.id,
            label: snapshot,
            labelTemplate,
          });
          childMatrixId = node.id;
          if (!workingFeatures.includes('matrix')) workingFeatures.push('matrix');
        } else if (def.kind === 'structural' && def.key === 'board') {
          const node = await createChildBoard({
            workspaceId: p.workspaceId,
            parentCellId: cellRow.id,
            label: snapshot,
            labelTemplate,
          });
          boardId = node.id;
          if (!workingFeatures.includes('board')) workingFeatures.push('board');
        } else if (def.key === 'info') {
          if (!workingFeatures.includes('info')) workingFeatures.push('info');
        } else if (def.key === 'checklists') {
          await addCellChecklist({
            workspaceId: p.workspaceId,
            cellId: cellRow.id,
            label: snapshot,
            labelTemplate,
          });
          if (!workingFeatures.includes('checklists')) workingFeatures.push('checklists');
        } else if (def.kind === 'doc') {
          await createDoc({
            workspaceId: p.workspaceId,
            attached_cell_id: cellRow.id,
            title: snapshot,
            titleTemplate: labelTemplate,
          });
        }
      }
      void checklistFlagAdded; // marker fuer biome — lokal genutzt indirekt

      // 6. Cell-Update wenn sich was geaendert hat.
      const finalFeatures = Array.from(new Set(workingFeatures));
      const cellChanged =
        finalFeatures.length !== (cellRow.features ?? []).length ||
        finalFeatures.some((f) => !(cellRow.features ?? []).includes(f)) ||
        childMatrixId !== cellRow.child_matrix_id ||
        boardId !== cellRow.board_id ||
        canonicalAlias !== cellRow.alias;
      if (cellChanged) {
        await updateCell(cellRow.id, {
          alias: canonicalAlias,
          features: finalFeatures,
          child_matrix_id: childMatrixId,
          board_id: boardId,
        });
      }

      p.onCreated?.(sel);
      p.onClose();
    } catch (err) {
      console.error('NewCellWizard.doCommit:', err);
      showToast(translateDbError(err), 'error');
      setBusy(false);
      setStep({ kind: 'pick' });
    }
  }

  // ─── Zelle leeren (Phase 3 O.8.M.3) ──────────────────────────
  // Loescht alle Sub-Nodes + Cell-Row. Confirm nur wenn echte Sub-
  // Struktur (Matrix/Board) mitgeloescht wird; Alias/Features sind
  // leicht rekonstruierbar.
  async function doClearCell() {
    if (busy()) return;
    const c = p.cell;
    if (!c) {
      p.onClose();
      return;
    }
    const hasSubNodes = !!c.child_matrix_id || !!c.board_id;
    if (hasSubNodes) {
      const matrixEmpty = c.child_matrix_id ? await isNodeEmpty(c.child_matrix_id, 'matrix') : true;
      const boardEmpty = c.board_id ? await isNodeEmpty(c.board_id, 'board') : true;
      if (!matrixEmpty || !boardEmpty) {
        const ok = await showConfirm({
          title: 'Zelle leeren?',
          message: 'Zelle leeren? Sub-Strukturen werden mit geloescht.',
          variant: 'danger',
          confirmLabel: 'Leeren',
        });
        if (!ok) return;
      }
    }
    setBusy(true);
    try {
      if (c.child_matrix_id) await deleteNode(c.child_matrix_id);
      if (c.board_id) await deleteNode(c.board_id);
      await delCellRow(c.id);
      p.onCreated?.([]);
      p.onClose();
    } catch (err) {
      console.error('NewCellWizard.doClearCell:', err);
      showToast(translateDbError(err), 'error');
      setBusy(false);
    }
  }

  // ─── Hotkey-Handler im Pick-Step ────────────────────────────
  function onPickKeyDown(e: KeyboardEvent) {
    if (busy()) return;
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      e.preventDefault();
      p.onClose();
      return;
    }
    if (e.key === 'Enter') {
      // In Alias-Input: Enter springt zu Step 2 (Hotkey-Phase). Wenn schon
      // Auswahl getroffen, geht's zum Naming. Wenn keine Auswahl: Wizard-
      // Schliessen mit nur-Alias-Save.
      const t = e.target as HTMLElement | null;
      const inAlias = !!t && t === aliasInputRef;
      if (inAlias) {
        e.preventDefault();
        // Aus dem Input rausspringen — Fokus bleibt im Wizard.
        aliasInputRef?.blur();
      }
      // Strg+Enter ueberspringt direkt: alle Selected mit Pos 1.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        startNameSteps();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      startNameSteps();
      return;
    }
    // Hotkeys: 1/2/3/4/d. Greifen NICHT wenn:
    //  - Modifier gedrueckt sind (Ctrl+1 etc. → Browser/andere Handler)
    //  - Fokus im Alias-Input liegt (User tippt einen Alias mit `d` oder
    //    Ziffern → das wuerde sonst die Feature-Toggle ausloesen statt
    //    den Buchstaben einzutragen — Bug-Report 2026-04-29).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    const inAlias = !!t && t === aliasInputRef;
    if (inAlias) return;
    const def = findFeatureByHotkey(e.key);
    if (def) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggleFeature(def.key);
    }
  }

  // ─── Keyboard im Name-Step ──────────────────────────────────
  function onNameKeyDown(e: KeyboardEvent) {
    if (busy()) return;
    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      e.preventDefault();
      p.onClose();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowUp' || e.key === 'Up')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cycle(-1);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowDown' || e.key === 'Down')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cycle(1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      advanceNameStep();
      return;
    }
  }

  // ─── Mount: Focus + Trap + ESC-Handler ──────────────────────
  onMount(() => {
    onCleanup(installFocusRestore());
    if (cardRef) onCleanup(installFocusTrap(cardRef));
    queueMicrotask(() => aliasInputRef?.focus());
    document.addEventListener('keydown', dispatchKey, true);
    onCleanup(() => document.removeEventListener('keydown', dispatchKey, true));
  });

  function dispatchKey(e: KeyboardEvent) {
    if (busy()) return;
    const cur = step();
    if (cur.kind === 'pick') return onPickKeyDown(e);
    if (cur.kind === 'name') return onNameKeyDown(e);
  }

  // Aktuelle Sub-Step-Defs.
  const currentNameDef = createMemo<FeatureDef | null>(() => {
    const cur = step();
    if (cur.kind !== 'name') return null;
    return nameableSelected()[cur.idx] ?? null;
  });

  const currentDraft = () => {
    const def = currentNameDef();
    if (!def) return '';
    return labelDraft().get(def.key) ?? def.label;
  };

  const currentPos = (): CyclePosition => {
    const def = currentNameDef();
    if (!def) return 1;
    return cyclePos().get(def.key) ?? 1;
  };

  function setCurrentDraft(value: string) {
    const def = currentNameDef();
    if (!def) return;
    const draftsM = new Map(labelDraft());
    draftsM.set(def.key, value);
    setLabelDraft(draftsM);
    // Wenn User editiert, wechselt der Modus auf "frei eingegeben" — wir
    // halten die Position aber bei (Cycle waehlt Vorlage; Edits bleiben
    // bis zum naechsten Cycle-Wechsel).
  }

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy()) p.onClose();
      }}
      // Empty onKeyDown haelt biome's a11y/useKeyWithClickEvents zufrieden
      // — der eigentliche Tastatur-Pfad ist der globale ESC-Handler aus
      // onMount (dispatchKey), nicht ein lokaler Scrim-Listener.
      onKeyDown={() => {}}
    >
      <div
        ref={cardRef}
        class="overlay-card new-cell-wizard"
        // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> Pattern wie restliche Modals.
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-cell-wizard-title"
      >
        <header class="overlay-head new-cell-wizard-head">
          <span class="new-cell-wizard-crumb">
            {p.row.label || '(Zeile)'} × {p.col.label || '(Spalte)'}
          </span>
          <h3 id="new-cell-wizard-title">
            <Show
              when={step().kind === 'pick'}
              fallback={isEditMode ? 'Neues Feature benennen' : 'Feature benennen'}
            >
              {isEditMode ? 'Zelle bearbeiten' : 'Zelle konfigurieren'}
            </Show>
          </h3>
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

        {/* ─── Step 1: Pick ─────────────────────────────── */}
        <Show when={step().kind === 'pick'}>
          <div class="new-cell-wizard-body">
            <label class="new-cell-wizard-alias-row">
              <span class="new-cell-wizard-alias-label">Alias</span>
              <input
                ref={aliasInputRef}
                type="text"
                class="new-cell-wizard-alias-input"
                value={aliasDraft()}
                onInput={(e) => setAliasDraft(e.currentTarget.value)}
                placeholder="^optional"
                disabled={busy()}
              />
            </label>
            <p class="new-cell-wizard-hint">
              <Show
                when={isEditMode}
                fallback={
                  <>
                    Features auswaehlen — Hotkey oder Klick. Mehrfach-Auswahl moeglich. Namen folgen
                    im naechsten Schritt — fuer jedes Feature einzeln.
                  </>
                }
              >
                Aktive Features sind angekreuzt. Toggle entfernt oder ergaenzt — neue Features
                bekommen im naechsten Schritt einen Namen, existierende behalten ihren (Rename via
                Sidebar).
              </Show>
            </p>
            <div class="new-cell-wizard-features" aria-label="Zellen-Features">
              <For each={pickableFeatures()}>
                {(def) => {
                  const checked = () => selectedKeys().includes(def.key);
                  return (
                    <button
                      type="button"
                      class="new-cell-wizard-feat"
                      data-feat={def.key}
                      classList={{ active: checked() }}
                      aria-pressed={checked()}
                      onClick={() => toggleFeature(def.key)}
                      disabled={busy()}
                    >
                      <span class="new-cell-wizard-feat-hotkey">{def.hotkey}</span>
                      <span class="new-cell-wizard-feat-ico">
                        <Icon name={def.iconName} size={16} />
                      </span>
                      <span class="new-cell-wizard-feat-label">{def.label}</span>
                      <Show when={checked()}>
                        <span class="new-cell-wizard-feat-check" aria-hidden="true">
                          <Icon name="check" size={12} />
                        </span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>
          <footer class="overlay-foot new-cell-wizard-foot">
            <span class="new-cell-wizard-tip">
              <kbd>↩</kbd> weiter · <kbd>Strg</kbd>+<kbd>↩</kbd> ohne Naming · <kbd>Esc</kbd>
            </span>
            <Show when={isEditMode}>
              <button
                type="button"
                class="btn-subtle new-cell-wizard-clear-btn"
                onClick={() => void doClearCell()}
                disabled={busy()}
                title="Alle Features + Sub-Strukturen entfernen, Cell-Row loeschen"
              >
                Zelle leeren
              </button>
            </Show>
            <button type="button" class="btn-subtle" onClick={p.onClose} disabled={busy()}>
              Abbrechen
            </button>
            <button
              type="button"
              class="btn btn-p"
              onClick={() => startNameSteps()}
              disabled={busy()}
            >
              {isEditMode ? 'Anwenden' : 'Weiter'}
            </button>
          </footer>
        </Show>

        {/* ─── Step 2..N: Naming ────────────────────────── */}
        <Show when={step().kind === 'name' && currentNameDef()}>
          {(_) => {
            const def = currentNameDef();
            if (!def) return null;
            const total = nameableSelected().length;
            const stepIdx = (step() as { kind: 'name'; idx: number }).idx;
            const isTopLevel = !p.matrixId;
            return (
              <div class="new-cell-wizard-body new-cell-wizard-name-body">
                <p class="new-cell-wizard-step-counter">
                  Schritt {stepIdx + 1}/{total}: {def.label} benennen
                </p>
                <input
                  // ref + queueMicrotask: Pos 1 voll-markieren beim Mount
                  // (sofort ueberschreibbar); bei Cycle-Wechseln spaeter
                  // uebernimmt cycle() das Setzen.
                  ref={(el: HTMLInputElement) => {
                    nameInputRef = el;
                    // Phase 3 O.8.M.5: nur beim ersten Mount fuer
                    // diesen Sub-Step fokussieren + selektieren.
                    // Spaeter werden Selection-Aenderungen explizit
                    // aus cycle() gesetzt (Cycle-Wechsel). User-
                    // Eingabe waehrend des Tippens darf nicht durch
                    // erneuten select() ueberschrieben werden.
                    if (nameInputInitialized.has(def.key)) return;
                    nameInputInitialized.add(def.key);
                    queueMicrotask(() => {
                      el.focus();
                      const pos = cyclePos().get(def.key) ?? 1;
                      if (pos === 1) el.select();
                      else el.setSelectionRange(0, 0);
                    });
                  }}
                  type="text"
                  class="new-cell-wizard-name-input"
                  value={currentDraft()}
                  onInput={(e) => setCurrentDraft(e.currentTarget.value)}
                  disabled={busy()}
                />
                <Show when={!isTopLevel}>
                  <div class="new-cell-wizard-cycle">
                    <span class="new-cell-wizard-cycle-label">Vorlage</span>
                    <For each={[1, 2, 3, 4, 5] as CyclePosition[]}>
                      {(pos) => (
                        <span
                          class="new-cell-wizard-cycle-dot"
                          classList={{ active: currentPos() === pos }}
                          aria-label={`Position ${pos}`}
                        />
                      )}
                    </For>
                    <span class="new-cell-wizard-cycle-modus">{modusHint(currentPos())}</span>
                  </div>
                </Show>
                <p class="new-cell-wizard-preview">
                  Vorschau: <strong>{previewLabel(currentDraft())}</strong>
                </p>
              </div>
            );
          }}
        </Show>
        <Show when={step().kind === 'name'}>
          <footer class="overlay-foot new-cell-wizard-foot">
            <span class="new-cell-wizard-tip">
              <Show
                when={!!p.matrixId}
                fallback={
                  <>
                    <kbd>↩</kbd> weiter · <kbd>Esc</kbd>
                  </>
                }
              >
                <kbd>Strg</kbd>+<kbd>↑↓</kbd> Vorlage · <kbd>↩</kbd> weiter · <kbd>Esc</kbd>
              </Show>
            </span>
            <button
              type="button"
              class="btn-subtle"
              onClick={() => backNameStep()}
              disabled={busy()}
            >
              Zurueck
            </button>
            <button
              type="button"
              class="btn btn-p"
              onClick={() => advanceNameStep()}
              disabled={busy()}
            >
              <Show
                when={
                  step().kind === 'name' &&
                  (step() as { kind: 'name'; idx: number }).idx === nameableSelected().length - 1
                }
                fallback="Weiter"
              >
                Anlegen
              </Show>
            </button>
          </footer>
        </Show>

        {/* ─── Step Final: Commit-Indicator ─────────────── */}
        <Show when={step().kind === 'commit'}>
          <div class="new-cell-wizard-body new-cell-wizard-commit-body">
            <span class="new-cell-wizard-spinner" aria-hidden="true" />
            <p class="hint">Lege an…</p>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default NewCellWizard;
