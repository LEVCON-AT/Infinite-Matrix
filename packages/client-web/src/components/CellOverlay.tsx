import { useNavigate } from '@solidjs/router';
import { type Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { validateAlias } from '../lib/alias';
import { showConfirm } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { CELL_FEATURES, type FeatureDef, findFeatureByHotkey } from '../lib/features';
import { flashError } from '../lib/flash';
import {
  createChildBoard,
  createChildMatrix,
  delCellRow,
  deleteNode,
  insertCell,
  updateCell,
} from '../lib/mutations';
import { isNodeEmpty } from '../lib/queries';
import { showToast } from '../lib/toasts';
import type { CellRow, ColRow, RowRow } from '../lib/types';
import { useViewerActive } from '../lib/workspace-role';
import Icon from './Icon';

type Props = {
  workspaceId: string;
  matrixId: string;
  row: RowRow;
  col: ColRow;
  cell: CellRow | undefined; // undefined wenn noch keine Row in DB
  onClose: () => void;
  onChanged: () => void; // triggert Parent-Refetch
};

const CellOverlay: Component<Props> = (p) => {
  const navigate = useNavigate();
  const [current, setCurrent] = createSignal<CellRow | undefined>(p.cell);
  const [aliasDraft, setAliasDraft] = createSignal(p.cell?.alias ?? '');
  const [busy, setBusy] = createSignal<string | null>(null);
  const viewerActive = useViewerActive();
  let aliasInput: HTMLInputElement | undefined;

  // Zellen-Row-Helper: legt Row an falls noch nicht da, sonst UPDATE.
  async function ensureCell(patch: Partial<CellRow>): Promise<CellRow> {
    const cur = current();
    if (cur) {
      const up = await updateCell(cur.id, {
        alias: patch.alias ?? cur.alias,
        features: patch.features ?? cur.features,
        child_matrix_id:
          patch.child_matrix_id !== undefined ? patch.child_matrix_id : cur.child_matrix_id,
        board_id: patch.board_id !== undefined ? patch.board_id : cur.board_id,
      });
      setCurrent(up);
      return up;
    }
    const ins = await insertCell({
      workspaceId: p.workspaceId,
      matrixId: p.matrixId,
      rowId: p.row.id,
      colId: p.col.id,
      patch: {
        alias: patch.alias ?? null,
        features: patch.features ?? [],
        child_matrix_id: patch.child_matrix_id ?? null,
        board_id: patch.board_id ?? null,
      },
    });
    setCurrent(ins);
    return ins;
  }

  function hasActive(key: string): boolean {
    return (current()?.features ?? []).includes(key);
  }

  // Anzahl navigierbarer Strukturen (Matrix + Board) an der Zelle.
  // 0 = nichts zu oeffnen, 1 = eindeutig (Enter + "Oeffnen"-Button),
  // 2 = ambig — User entscheidet per Chip-Klick, Dialog schliesst ohne Nav.
  const navTargetCount = createMemo(() => {
    const c = current();
    if (!c) return 0;
    return (c.child_matrix_id ? 1 : 0) + (c.board_id ? 1 : 0);
  });

  function soleTargetNodeId(): string | null {
    if (navTargetCount() !== 1) return null;
    const c = current();
    if (!c) return null;
    return c.child_matrix_id ?? c.board_id ?? null;
  }

  async function wrap<T>(key: string, fn: () => Promise<T>) {
    if (busy()) return;
    if (viewerActive()) {
      showToast('Read-only: Zellen-Aenderungen sind als Viewer nicht moeglich.', 'info');
      return;
    }
    setBusy(key);
    try {
      await fn();
      p.onChanged();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  // ─── Toggle-Dispatch ─────────────────────────────────────────
  async function toggleFlag(def: FeatureDef) {
    const isOn = hasActive(def.key);
    const cur = current();
    const existing = cur?.features ?? [];
    const next = isOn ? existing.filter((f) => f !== def.key) : [...existing, def.key];
    await ensureCell({ features: next });
  }

  async function toggleStructural(def: FeatureDef) {
    const isOn = hasActive(def.key);
    const cur = current();
    if (isOn) {
      // Off: Sub-Node loeschen. Confirm NUR wenn Sub-Content hat —
      // leerer Sub-Node wird direkt entfernt (kein Datenverlust).
      const nodeId = def.key === 'matrix' ? cur?.child_matrix_id : cur?.board_id;
      if (nodeId) {
        const nodeType = def.key === 'matrix' ? 'matrix' : 'board';
        const empty = await isNodeEmpty(nodeId, nodeType);
        if (!empty) {
          const ok = await showConfirm({
            title: `Sub-${def.label} loeschen?`,
            message: `Sub-${def.label} und alle Inhalte loeschen? Das kann nicht rueckgaengig gemacht werden.`,
            variant: 'danger',
            confirmLabel: 'Loeschen',
          });
          if (!ok) return;
        }
        await deleteNode(nodeId);
      }
      const nextFeatures = (cur?.features ?? []).filter((f) => f !== def.key);
      await ensureCell({
        features: nextFeatures,
        ...(def.key === 'matrix' ? { child_matrix_id: null } : { board_id: null }),
      });
      return;
    }
    // On: Zelle sicherstellen, Node anlegen, Feature rein, FK setzen.
    // Wenn cur null ist, ist cur?.features ebenfalls undefined — also
    // direkt [] starten, das spart die redundante Narrowing-Fehlspur.
    const baseCell = cur ?? (await ensureCell({ features: [] }));
    const newNode =
      def.key === 'matrix'
        ? await createChildMatrix({
            workspaceId: p.workspaceId,
            parentCellId: baseCell.id,
            label: p.row.label && p.col.label ? `${p.row.label} × ${p.col.label}` : undefined,
          })
        : await createChildBoard({
            workspaceId: p.workspaceId,
            parentCellId: baseCell.id,
            label: p.row.label && p.col.label ? `${p.row.label} × ${p.col.label}` : undefined,
          });
    const nextFeatures = [...(baseCell.features ?? []), def.key];
    await ensureCell({
      features: nextFeatures,
      ...(def.key === 'matrix' ? { child_matrix_id: newNode.id } : { board_id: newNode.id }),
    });
  }

  async function onToggle(def: FeatureDef) {
    if (busy()) return;
    // Phase 3 O.8: Doku ist ein neues Feature mit eigener Anlage-/
    // Loesch-Logik (createDoc/deleteDoc). Bis der Wizard (O.8.E/F)
    // CellOverlay komplett ersetzt, blocken wir Doku-Toggle hier —
    // Doku-Anlage laeuft uebergangsweise weiter ueber den existing
    // Workspace-Pfad (D-Hotkey im MatrixView).
    if (def.kind === 'doc') {
      showToast('Doku-Anlage erfolgt im neuen Wizard (kommt mit O.8.E/F).', 'info');
      return;
    }
    await wrap(def.key, async () => {
      if (def.kind === 'flag') await toggleFlag(def);
      else await toggleStructural(def);
    });
  }

  // ─── Alias-Speichern (on blur) ───────────────────────────────
  // Cross-Table-Alias-Check (Zelle vs. Karten/Matrizen/Checklisten/
  // Links/Nodes) laeuft ueber den zentralen validateAlias-Helper.
  async function onAliasBlur() {
    if (busy()) return;
    if (viewerActive()) return;
    const cur = current();
    const currentAlias = cur?.alias ?? null;
    setBusy('alias');
    try {
      // Neue Zelle hat noch keine id — Platzhalter ist harmlos im
      // neq()-Filter, weil dann alle DB-Matches als Konflikt gelten.
      const selfId = cur?.id ?? '__new__';
      const res = await validateAlias(aliasDraft(), p.workspaceId, {
        type: 'cell',
        id: selfId,
      });
      if (!res.ok) {
        showToast(res.msg, 'error');
        flashError(aliasInput);
        window.setTimeout(() => {
          aliasInput?.focus();
          aliasInput?.select();
        }, 420);
        return;
      }
      const next = res.canonical;
      if (next === currentAlias) return;
      await ensureCell({ alias: next });
      p.onChanged();
    } catch (err) {
      showToast(translateDbError(err), 'error');
      flashError(aliasInput);
      window.setTimeout(() => {
        aliasInput?.focus();
        aliasInput?.select();
      }, 420);
    } finally {
      setBusy(null);
    }
  }

  // ─── Navigation ──────────────────────────────────────────────
  // Bei genau einem Ziel navigieren. Bei 0 oder 2 nur schliessen —
  // User entscheidet dann per Chip-Klick in der Zelle selbst.
  function onOpen() {
    const nid = soleTargetNodeId();
    if (!nid) {
      p.onClose();
      return;
    }
    navigate(`/w/${p.workspaceId}/n/${nid}`);
    p.onClose();
  }

  // ─── Zelle komplett leeren ───────────────────────────────────
  // hasAnyContent: sichtbarer "Zelle leeren"-Button — erscheint sobald
  // irgendetwas an der Zelle dranhaengt (Features, Alias oder Sub-Node).
  const hasAnyContent = createMemo(() => {
    const c = current();
    if (!c) return false;
    return (c.features?.length ?? 0) > 0 || !!c.alias || !!c.child_matrix_id || !!c.board_id;
  });

  // hasDestructiveContent: nur Sub-Nodes gelten als destruktiv
  // (Datenverlust). Features + Alias werden ohne Rueckfrage entfernt —
  // leicht rekonstruierbar, kein Schaden bei Fehlklick.
  const hasDestructiveContent = createMemo(() => {
    const c = current();
    if (!c) return false;
    return !!c.child_matrix_id || !!c.board_id;
  });

  async function onClear() {
    const c = current();
    if (!c) {
      p.onClose();
      return;
    }
    if (busy()) return;

    // Confirm nur wenn echte Sub-Struktur mitgeloescht wird.
    if (hasDestructiveContent()) {
      // Wenn die Sub-Nodes leer sind, ueberspringen wir das Confirm.
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

    setBusy('clear');
    try {
      if (c.child_matrix_id) await deleteNode(c.child_matrix_id);
      if (c.board_id) await deleteNode(c.board_id);
      await delCellRow(c.id);
      setCurrent(undefined);
      p.onChanged();
      p.onClose();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  // Props sind in Solid accessor-basiert. Nach Unmount kann der Zugriff
  // auf p.row.id / p.col.id stale werden — hier bei Mount einmalig in
  // Konstanten capturen, damit der onCleanup safe ist.
  const capturedRowId = p.row.id;
  const capturedColId = p.col.id;

  // Alias-Input sofort fokussieren + globaler Keyboard-Handler.
  onMount(() => {
    aliasInput?.focus();
    document.addEventListener('keydown', onGlobalKeyDown, true);
  });

  // Fokus zurueck auf die DOM-Zelle bei Unmount — damit Enter/Pfeil im
  // Read/Edit-Mode sofort weiter funktioniert.
  onCleanup(() => {
    document.removeEventListener('keydown', onGlobalKeyDown, true);
    const el = document.querySelector(
      `.mx-cell[data-row-id="${capturedRowId}"][data-col-id="${capturedColId}"]`,
    ) as HTMLElement | null;
    el?.focus({ preventScroll: true });
  });

  // Globaler Keyboard-Handler auf document (Capture-Phase). Greift auch
  // wenn der Fokus ausserhalb des Overlays landet (z.B. nach Alias-blur
  // auf body). stopImmediatePropagation verhindert, dass der Workspace-
  // ESC-Handler (Parent-Navigation) den Event zu sehen bekommt.
  function onGlobalKeyDown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    const inEditable =
      !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

    if (e.key === 'Escape') {
      e.stopImmediatePropagation();
      e.preventDefault();
      p.onClose();
      return;
    }

    if (e.key === 'Enter') {
      if (inEditable) return; // Input-lokaler Handler macht blur -> save
      e.stopImmediatePropagation();
      e.preventDefault();
      onOpen();
      return;
    }

    // Hotkeys 1-9: greifen auch im Alias-Input. preventDefault verhindert,
    // dass die Ziffer in den Text wandert.
    const def = findFeatureByHotkey(e.key);
    if (def) {
      e.stopImmediatePropagation();
      e.preventDefault();
      void onToggle(def);
    }
  }

  // Breadcrumb-Label oben
  const breadcrumb = () => `${p.row.label || '(Zeile)'} × ${p.col.label || '(Spalte)'}`;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop-Klick — Tastatur via ESC-Capture im onMount.
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        class="overlay-card cell-overlay"
        // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> bewusst statt <dialog> — showModal() haette aufwendige Migration aller Modals zur Folge.
        role="dialog"
        aria-modal="true"
      >
        <header class="overlay-head">
          <div class="overlay-head-text">
            <h2>Zelle bearbeiten</h2>
            <span class="overlay-sub">{breadcrumb()}</span>
          </div>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div class="overlay-body">
          <label class="cell-alias-label">
            Alias (optional)
            <input
              ref={aliasInput}
              type="text"
              value={aliasDraft()}
              placeholder="z.B. ^heute"
              autocomplete="off"
              onInput={(e) => setAliasDraft(e.currentTarget.value)}
              onBlur={onAliasBlur}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  // Enter im Alias = nur save (via blur). Dialog bleibt
                  // offen, damit User anschliessend mit 1-9 Features
                  // auswaehlen und dann selbst mit Enter oeffnen kann.
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
            />
          </label>

          <div
            class="cell-feat-row"
            // biome-ignore lint/a11y/useSemanticElements: bewusst <div role="group"> — <fieldset> wuerde Browser-Default-Border + Margin einfuegen, das stylisch unpassend ist.
            role="group"
            aria-label="Zellen-Features"
          >
            <For each={CELL_FEATURES.filter((f) => f.kind !== 'doc')}>
              {(def) => (
                <button
                  type="button"
                  class="cell-feat-btn"
                  data-feat={def.key}
                  classList={{
                    active: hasActive(def.key),
                    busy: busy() === def.key,
                  }}
                  onClick={() => onToggle(def)}
                  disabled={busy() !== null}
                  title={`${def.label} (Taste ${def.hotkey})`}
                >
                  <span class="cell-feat-hotkey">{def.hotkey}</span>
                  <span class="cell-feat-ico">
                    <Icon name={def.iconName} size={16} />
                  </span>
                  <span class="cell-feat-label">{def.label}</span>
                </button>
              )}
            </For>
          </div>

          <Show when={navTargetCount() === 1}>
            <button type="button" class="cell-open-btn" onClick={onOpen} title="Enter">
              ↗ Oeffnen (Enter)
            </button>
          </Show>

          <div class="cell-overlay-footer">
            <Show when={hasAnyContent()}>
              <button type="button" class="btn-danger" onClick={onClear} disabled={busy() !== null}>
                Zelle leeren
              </button>
            </Show>
            <button type="button" class="btn-secondary" onClick={p.onClose}>
              Schliessen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CellOverlay;
