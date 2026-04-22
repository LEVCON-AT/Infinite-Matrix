import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
import type { CellFeature, CellRow, ColRow, MatrixContent, RowRow } from '../lib/types';
import { useEditMode } from '../lib/edit-mode';
import { findFeatureByHotkey } from '../lib/features';
import { addCol, addRow, delCol, delRow, renameCol, renameRow } from '../lib/mutations';
import { rememberFocus, useLastFocus } from '../lib/navigation-focus';
import { showToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';
import CellOverlay from './CellOverlay';

const FEATURE_ORDER: CellFeature[] = ['matrix', 'board', 'info', 'checklists'];

const FEATURE_ICON: Record<CellFeature, string> = {
  matrix: '▦',
  board: '▤',
  info: 'i',
  checklists: '✓',
};

const FEATURE_LABEL: Record<CellFeature, string> = {
  matrix: 'Sub-Matrix',
  board: 'Board',
  info: 'Info',
  checklists: 'Checklisten',
};

type Props = {
  workspaceId: string;
  matrixId: string;
  content: MatrixContent | undefined;
  onChanged?: () => void;
};

type OverlayTarget = { row: RowRow; col: ColRow; cell: CellRow | undefined };

const MatrixView: Component<Props> = (p) => {
  const navigate = useNavigate();
  const editMode = useEditMode();

  const [busy, setBusy] = createSignal(false);
  const [overlayTarget, setOverlayTarget] = createSignal<OverlayTarget | null>(null);
  // Guard: Initial-Focus (0,0) nur einmal pro Matrix-Besuch. Verhindert,
  // dass jede Content-Mutation den Fokus auf (0,0) zurueckreisst.
  const [initialFocusedFor, setInitialFocusedFor] = createSignal<string | null>(
    null,
  );

  const cellMap = createMemo(() => {
    const m = new Map<string, CellRow>();
    for (const c of p.content?.cells ?? []) m.set(`${c.row_id}::${c.col_id}`, c);
    return m;
  });

  // Race-Schutz: Beim Matrix-Wechsel via Sidebar wird p.matrixId sofort
  // vom Router auf das neue Ziel gesetzt, aber createResource
  // (matrixContent) haelt waehrend des Refetches den alten Wert. In diesem
  // Zwischenzustand haette MatrixView rows/cols der ALTEN Matrix unter
  // NEUER matrixId — onFocus wuerde die focusMap der Ziel-Matrix mit
  // fremden Row-/Col-IDs vergiften, und der Restore nach Sidebar-Nav
  // landet ewig auf (0,0). Also: Content-Matrix-Fingerprint vergleichen
  // und stale Content ignorieren.
  const contentMatches = createMemo(() => {
    const c = p.content;
    if (!c) return false;
    const ref = c.rows[0]?.matrix_id ?? c.cols[0]?.matrix_id;
    // Leere Matrix (keine Rows + Cols) — nichts zu vergleichen, passt.
    if (!ref) return true;
    return ref === p.matrixId;
  });

  // Fokus-Koordinate der Zelle fuer Back-Navigation merken, BEVOR navigiert
  // wird. Wird auch bei jedem onFocus der Zelle gerufen (Pfeiltasten/Tab/
  // Maus) — so ueberlebt die Position einen Matrix-Wechsel via Sidebar
  // und Rueckkehr landet auf derselben Zelle.
  function rememberCellFocus(rowId: string, colId: string) {
    rememberFocus(p.matrixId, rowId, colId);
  }

  function onChipClick(
    e: MouseEvent,
    cell: CellRow | undefined,
    featKey: string,
    row: RowRow,
    col: ColRow,
  ) {
    // stopPropagation IMMER — damit der Zell-Hintergrund-Handler nicht
    // zusaetzlich feuert (der macht im Edit-Mode das Overlay).
    e.stopPropagation();
    if (!cell) return;
    if (featKey === 'matrix' && cell.child_matrix_id) {
      rememberCellFocus(row.id, col.id);
      navigate(`/w/${p.workspaceId}/n/${cell.child_matrix_id}`);
      return;
    }
    if (featKey === 'board' && cell.board_id) {
      rememberCellFocus(row.id, col.id);
      navigate(`/w/${p.workspaceId}/n/${cell.board_id}`);
      return;
    }
    // Flag-Features: Info-/Checklist-Panel pro Zelle sind noch nicht
    // gebaut. Hinweis ueber Toast. Echtes Panel kommt:
    //   - Checkliste:  0e.1.d.x (Cell-Checklist-Panel, reuses ChecklistPanel)
    //   - Info:        0e.1.f  (Info-Field Content-Editor)
    if (featKey === 'checklists') {
      showToast('Cell-Checkliste: Panel kommt in 0e.1.d.x.', 'info');
      return;
    }
    if (featKey === 'info') {
      showToast('Info-Feld: Editor kommt in 0e.1.f.', 'info');
      return;
    }
  }

  async function wrap<T>(fn: () => Promise<T>, successMsg?: string) {
    if (busy()) return;
    setBusy(true);
    try {
      await fn();
      if (successMsg) showToast(successMsg, 'success');
      p.onChanged?.();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onAddRow() {
    await wrap(() => addRow({ workspaceId: p.workspaceId, matrixId: p.matrixId }));
  }

  async function onAddCol() {
    await wrap(() => addCol({ workspaceId: p.workspaceId, matrixId: p.matrixId }));
  }

  async function onRenameRow(row: RowRow, newLabel: string) {
    if (newLabel === row.label) return;
    await wrap(() => renameRow(row.id, newLabel));
  }

  async function onRenameCol(col: ColRow, newLabel: string) {
    if (newLabel === col.label) return;
    await wrap(() => renameCol(col.id, newLabel));
  }

  async function onDelRow(row: RowRow) {
    const used = (p.content?.cells ?? []).some((c) => c.row_id === row.id);
    if (used) {
      if (!window.confirm(`Zeile "${row.label || '(leer)'}" loeschen? Enthaelt Zellen mit Inhalt.`)) {
        return;
      }
    }
    await wrap(() => delRow(row.id), 'Zeile geloescht.');
  }

  async function onDelCol(col: ColRow) {
    const used = (p.content?.cells ?? []).some((c) => c.col_id === col.id);
    if (used) {
      if (!window.confirm(`Spalte "${col.label || '(leer)'}" loeschen? Enthaelt Zellen mit Inhalt.`)) {
        return;
      }
    }
    await wrap(() => delCol(col.id), 'Spalte geloescht.');
  }

  function onCellEdit(row: RowRow, col: ColRow, cell: CellRow | undefined) {
    // KEIN rememberCellFocus hier — sonst triggert der Focus-Restore-
    // Effect parallel zum Overlay-onMount und klaut den Alias-Autofocus
    // (Race). Den Focus-Rueckweg erledigt der Overlay selbst via
    // onCleanup (fokussiert die data-row-id/data-col-id-Zelle).
    setOverlayTarget({ row, col, cell });
  }

  // ─── Keyboard auf fokussierter Zelle ─────────────────────────
  // 1/2       : Sub-Matrix / Sub-Board oeffnen (structural Hotkey)
  // Arrows    : Focus auf Nachbar-Zelle verschieben (clamp am Rand)
  // Greift nur wenn Fokus auf einer .mx-cell und ohne Modifier.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const ae = document.activeElement as HTMLElement | null;
      if (!ae || !ae.classList.contains('mx-cell')) return;

      const rowId = ae.getAttribute('data-row-id');
      const colId = ae.getAttribute('data-col-id');
      if (!rowId || !colId) return;

      // Pfeiltasten — Nachbar-Zelle fokussieren.
      if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight'
      ) {
        const rows = p.content?.rows ?? [];
        const cols = p.content?.cols ?? [];
        const ri = rows.findIndex((r) => r.id === rowId);
        const ci = cols.findIndex((c) => c.id === colId);
        if (ri < 0 || ci < 0) return;

        let nr = ri;
        let nc = ci;
        if (e.key === 'ArrowUp') nr = Math.max(0, ri - 1);
        else if (e.key === 'ArrowDown') nr = Math.min(rows.length - 1, ri + 1);
        else if (e.key === 'ArrowLeft') nc = Math.max(0, ci - 1);
        else if (e.key === 'ArrowRight') nc = Math.min(cols.length - 1, ci + 1);
        if (nr === ri && nc === ci) return;

        e.preventDefault();
        const nrow = rows[nr];
        const ncol = cols[nc];
        if (!nrow || !ncol) return;
        const el = document.querySelector(
          `.mx-cell[data-row-id="${nrow.id}"][data-col-id="${ncol.id}"]`,
        ) as HTMLElement | null;
        el?.focus({ preventScroll: false });
        return;
      }

      // 1/2 — Sub-Feature direkt oeffnen.
      const def = findFeatureByHotkey(e.key);
      if (!def || def.kind !== 'structural') return;

      const cell = cellMap().get(`${rowId}::${colId}`);
      if (!cell) return;
      const targetNode =
        def.key === 'matrix' ? cell.child_matrix_id : cell.board_id;
      if (!targetNode) return;

      e.preventDefault();
      rememberCellFocus(rowId, colId);
      navigate(`/w/${p.workspaceId}/n/${targetNode}`);
    };
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  // ─── Focus: Initial + Restore nach Navigation ─────────────────
  // Zwei Faelle gemeinsam behandelt:
  //   a) Neu geladene Matrix ohne vorherigen Besuch → Fokus auf (0,0),
  //      damit Pfeiltasten-Nav sofort funktioniert.
  //   b) Rueckkehr via Sidebar ODER ESC-Back aus Sub-Node → letzte
  //      Zelle derselben Matrix aus focusMap wiederherstellen.
  // queueMicrotask stellt sicher, dass das DOM gerendert ist.
  createEffect(() => {
    const content = p.content;
    if (!content) return;
    // Stale content (alte Matrix unter neuer matrixId) — Restore darf
    // nicht auf fremden rows/cols laufen, sonst faelscht der folgende
    // onFocus die focusMap des neuen Ziels.
    if (!contentMatches()) return;
    const currentMid = p.matrixId;
    const rows = content.rows;
    const cols = content.cols;
    if (rows.length === 0 || cols.length === 0) return;

    const saved = useLastFocus(currentMid);
    const hasRestore = !!saved;
    if (!hasRestore && initialFocusedFor() === currentMid) return;

    queueMicrotask(() => {
      // Schutz: wenn ein Overlay offen ist oder gerade ein Input/Textarea
      // fokussiert ist (z.B. Alias im CellOverlay), nicht in die Zelle
      // zurueckspringen.
      const ae = document.activeElement as HTMLElement | null;
      if (
        ae &&
        (ae.tagName === 'INPUT' ||
          ae.tagName === 'TEXTAREA' ||
          ae.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('.overlay-scrim')) return;

      // Gespeicherte Zelle kann durch Row/Col-Delete verschwunden sein —
      // Fallback: (0,0).
      let rowId = rows[0].id;
      let colId = cols[0].id;
      if (saved) {
        const rowStill = rows.some((r) => r.id === saved.rowId);
        const colStill = cols.some((c) => c.id === saved.colId);
        if (rowStill && colStill) {
          rowId = saved.rowId;
          colId = saved.colId;
        }
      }
      const el = document.querySelector(
        `.mx-cell[data-row-id="${rowId}"][data-col-id="${colId}"]`,
      ) as HTMLElement | null;
      if (el && document.activeElement !== el) {
        el.focus({ preventScroll: true });
      }
      if (!hasRestore) {
        setInitialFocusedFor(currentMid);
      }
    });
  });

  return (
    <div class="matrix-wrap">
      <Show when={overlayTarget()}>
        <CellOverlay
          workspaceId={p.workspaceId}
          matrixId={p.matrixId}
          row={overlayTarget()!.row}
          col={overlayTarget()!.col}
          cell={overlayTarget()!.cell}
          onClose={() => setOverlayTarget(null)}
          onChanged={() => p.onChanged?.()}
        />
      </Show>

      <Show
        when={
          contentMatches() &&
          (p.content?.rows.length ?? 0) > 0 &&
          (p.content?.cols.length ?? 0) > 0
        }
        fallback={
          <div class="matrix-empty">
            <Show
              when={p.content && contentMatches()}
              fallback={<p class="hint">Lade Matrix…</p>}
            >
              <p class="hint">
                Leere Matrix.
                <Show when={editMode()}>
                  {' '}Zeile und Spalte anlegen, um zu starten.
                </Show>
              </p>
              <Show when={editMode()}>
                <div class="mx-toolbar">
                  <button type="button" onClick={onAddRow} disabled={busy()}>
                    + Zeile
                  </button>
                  <button type="button" onClick={onAddCol} disabled={busy()}>
                    + Spalte
                  </button>
                </div>
              </Show>
            </Show>
          </div>
        }
      >
        {(_) => {
          const rows = () => p.content!.rows;
          const cols = () => p.content!.cols;

          // Eine Extra-Spalte rechts fuer "+ Spalte"-Button im Edit-Mode.
          const gridStyle = () => {
            const colCount = cols().length;
            const extra = editMode() ? ' minmax(60px, auto)' : '';
            return `grid-template-columns: minmax(140px, max-content) repeat(${colCount}, minmax(160px, 1fr))${extra};`;
          };

          return (
            <div class="matrix-grid" style={gridStyle()}>
              {/* Header-Ecke */}
              <div class="mx-corner" />

              <For each={cols()}>
                {(col) => (
                  <div class="mx-col-head" classList={{ 'mx-editable': editMode() }}>
                    <Show
                      when={editMode()}
                      fallback={<span class="mx-col-label">{col.label || '(Spalte)'}</span>}
                    >
                      <input
                        class="mx-head-input"
                        type="text"
                        value={col.label}
                        placeholder="(Spalte)"
                        onBlur={(e) => onRenameCol(col, e.currentTarget.value.trim())}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                      />
                      <button
                        type="button"
                        class="mx-del-btn"
                        title="Spalte loeschen"
                        aria-label="Spalte loeschen"
                        onClick={() => onDelCol(col)}
                        disabled={busy()}
                      >
                        ✕
                      </button>
                    </Show>
                  </div>
                )}
              </For>

              {/* Ecke rechts oben: "+ Spalte" */}
              <Show when={editMode()}>
                <div class="mx-add-col-cell">
                  <button
                    type="button"
                    class="mx-add-btn"
                    onClick={onAddCol}
                    disabled={busy()}
                    title="Spalte hinzufuegen"
                  >
                    +
                  </button>
                </div>
              </Show>

              {/* Zeilen */}
              <For each={rows()}>
                {(row) => (
                  <>
                    <div class="mx-row-head" classList={{ 'mx-editable': editMode() }}>
                      <Show
                        when={editMode()}
                        fallback={
                          <span class="mx-row-label">{row.label || '(Zeile)'}</span>
                        }
                      >
                        <input
                          class="mx-head-input"
                          type="text"
                          value={row.label}
                          placeholder="(Zeile)"
                          onBlur={(e) => onRenameRow(row, e.currentTarget.value.trim())}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              (e.currentTarget as HTMLInputElement).blur();
                            }
                          }}
                        />
                        <button
                          type="button"
                          class="mx-del-btn"
                          title="Zeile loeschen"
                          aria-label="Zeile loeschen"
                          onClick={() => onDelRow(row)}
                          disabled={busy()}
                        >
                          ✕
                        </button>
                      </Show>
                    </div>
                    <For each={cols()}>
                      {(col) => {
                        const cell = () => cellMap().get(`${row.id}::${col.id}`);
                        const features = () =>
                          (cell()?.features ?? []).filter((f): f is CellFeature =>
                            (FEATURE_ORDER as string[]).includes(f),
                          );
                        // Klare Trennung:
                        //   - Hintergrund-Click:
                        //       View  → nichts
                        //       Edit  → Overlay (Konfiguration)
                        //   - Chip-Click:
                        //       Matrix/Board → navigiere zum Sub-Node
                        //       Info/Checklisten → Panel (WIP, siehe onChipClick)
                        // tabIndex=0 immer, damit der User per Tab/Arrow durch
                        // die Matrix navigieren kann (auch im View-Mode).
                        return (
                          <div
                            class="mx-cell"
                            classList={{
                              'mx-cell-empty': !cell(),
                              'mx-cell-clickable': editMode(),
                              'mx-cell-editable': editMode(),
                            }}
                            role={editMode() ? 'button' : 'gridcell'}
                            tabIndex={0}
                            data-row-id={row.id}
                            data-col-id={col.id}
                            onFocus={() => {
                              // Jeder Cell-Focus (Pfeiltasten, Tab, Maus)
                              // aktualisiert lastFocusCell. So kann der
                              // User die Matrix via Sidebar verlassen und
                              // beim Zurueckkommen auf derselben Zelle
                              // landen. Ohne das greift nur der Chip-Click-
                              // oder 1/2-Hotkey-Setter.
                              rememberCellFocus(row.id, col.id);
                            }}
                            onClick={() => {
                              if (editMode()) onCellEdit(row, col, cell());
                            }}
                            onKeyDown={(e) => {
                              if (!editMode()) return;
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onCellEdit(row, col, cell());
                              }
                            }}
                          >
                            <Show when={cell()?.alias}>
                              <span class="mx-cell-alias">^{cell()!.alias}</span>
                            </Show>
                            <Show when={features().length > 0}>
                              <div class="mx-cell-feats">
                                <For each={features()}>
                                  {(f) => {
                                    const navTarget =
                                      f === 'matrix'
                                        ? cell()?.child_matrix_id
                                        : f === 'board'
                                          ? cell()?.board_id
                                          : null;
                                    const chipClickable = () => !!navTarget;
                                    return (
                                      <span
                                        class="mx-feat-chip"
                                        classList={{
                                          'mx-feat-chip-link': chipClickable(),
                                        }}
                                        data-feat={f}
                                        title={
                                          navTarget
                                            ? `${FEATURE_LABEL[f]} oeffnen`
                                            : FEATURE_LABEL[f]
                                        }
                                        onClick={(e) =>
                                          onChipClick(e, cell(), f, row, col)
                                        }
                                      >
                                        {FEATURE_ICON[f]}
                                      </span>
                                    );
                                  }}
                                </For>
                              </div>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                    <Show when={editMode()}>
                      <div class="mx-row-tail" />
                    </Show>
                  </>
                )}
              </For>

              {/* Ecke unten links: "+ Zeile" */}
              <Show when={editMode()}>
                <div class="mx-add-row-cell">
                  <button
                    type="button"
                    class="mx-add-btn"
                    onClick={onAddRow}
                    disabled={busy()}
                    title="Zeile hinzufuegen"
                  >
                    +
                  </button>
                </div>
                <For each={cols()}>{() => <div class="mx-add-row-filler" />}</For>
                <div class="mx-add-row-filler" />
              </Show>
            </div>
          );
        }}
      </Show>
    </div>
  );
};

export default MatrixView;
