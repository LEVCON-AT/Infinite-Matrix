// Rendert eine einzelne Checkliste inkl. Items.
// Analog zur HTML-Vorlage (renderChecklists): NUR Toggle ist View-Mode-
// erlaubt. Add / Rename / Del / Level / Reorder sind Edit-gated —
// Aenderungen an Items sind struktur-aehnlich, nicht blosse Zustands-
// Flips.

import { useNavigate } from '@solidjs/router';
import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';
import { validateAlias } from '../lib/alias';
import { executeChecklistAction, parseChecklistAction } from '../lib/checklist-action';
import type { ParsedPasteItem } from '../lib/checklist-paste-parse';
import { formatDateTimeDE } from '../lib/dates';
import { showConfirm } from '../lib/dialog';
import { bindDragSource, bindDropTarget } from '../lib/drag-context';
import { useEditMode } from '../lib/edit-mode';
import { translateDbError } from '../lib/errors';
import { flashError } from '../lib/flash';
import { type ContextMaps, resolveChecklistLabel } from '../lib/label-template';
import { dropOnChecklist } from '../lib/manifestation-cross-view';
import type { WorkspaceMember } from '../lib/members';
import {
  addChecklistItem,
  applyChecklistClose,
  bulkAddChecklistItems,
  delChecklist,
  delChecklistItem,
  delChecklistSnapshot,
  renameChecklist,
  renameChecklistItem,
  restoreChecklistItem,
  restoreChecklistSnapshot,
  restoreChecklistWithItems,
  saveChecklistSnapshot,
  setChecklistAlias,
  setChecklistCloseMode,
  setChecklistItemLevel,
  setChecklistRecur,
  toggleChecklistItemDone,
} from '../lib/mutations';
import type { PresenceUser } from '../lib/presence';
import { showToast, showUndoToast } from '../lib/toasts';
import type {
  AtomMarkerRow,
  ChecklistCloseMode,
  ChecklistItemRow,
  ChecklistRow,
  TaskManifestationRow,
} from '../lib/types';
import { bindAliasAutocomplete } from '../lib/use-alias-autocomplete';
import AliasText from './AliasText';
import AtomMarkerBar from './AtomMarkerBar';
import ChecklistActionModal from './ChecklistActionModal';
import ChecklistPastePopup from './ChecklistPastePopup';
import ChecklistToCardPopup from './ChecklistToCardPopup';
import Icon from './Icon';
import { ModalTransition } from './ModalTransition';
import PresenceMini from './PresenceMini';

type Props = {
  checklist: ChecklistRow;
  items: ChecklistItemRow[]; // bereits nach position sortiert
  workspaceId: string;
  onChanged: () => void;
  // P1.D: optional aktivierter Live-Cursor pro Item. Wenn gesetzt,
  // pflegt die Component mouseenter/leave + Avatar-Indikatoren je
  // Item. Bei Aufrufen aus BoardView (Card-interne Checklisten)
  // werden die Props weggelassen — kein Hover-Tracking dort.
  presence?: () => PresenceUser[];
  selfUserId?: string;
  onItemHover?: (itemId: string | undefined) => void;
  // Phase 3 O.8.K: Resolver-Maps fuer Display-Pfade (Toasts, Confirms,
  // History-Snapshot). Edit-Input bleibt auf legacy label.
  resolverMaps?: () => ContextMaps;
  // Phase 4 T.1.G.2.C: Workspace-weite Manifestations fuer Cross-View-
  // Drop-Idempotenz (Move-vs-Add-Detect). Optional — Drop-Target ist
  // dann inactive.
  wsManifestations?: TaskManifestationRow[];
  // §13.3 V2.D: AtomMarkerBar im Checklist-Header (atom_type='checklist').
  // Optional — Caller ohne Workspace-Bundle blendet die Bar aus.
  wsAtomMarkers?: AtomMarkerRow[];
  // §13.3 V2-Polish (2026-05-13) — Member-Lookup fuer Star-Hover-Tooltip.
  wsMembers?: ReadonlyArray<WorkspaceMember>;
};

const ChecklistPanel: Component<Props> = (p) => {
  const editMode = useEditMode();
  const [busy, setBusy] = createSignal(false);

  // Phase 3 O.8.K: resolved Label fuer Display-Pfade (Toasts, Confirms,
  // History-Snapshot, Child-Popup-Header). Faellt auf legacy label
  // wenn keine Resolver-Maps verfuegbar sind.
  const displayLabel = createMemo(() => {
    const maps = p.resolverMaps?.();
    if (!maps) return p.checklist.label;
    return resolveChecklistLabel(p.checklist, maps);
  });

  // P1.D Live-Cursor-Map. Pro Render des Panels einmal aufgebaut — nur
  // Items aus *dieser* Liste werden beruecksichtigt, andere Listen
  // haben ihre eigenen Maps.
  const presenceByItem = createMemo<Map<string, PresenceUser[]>>(() => {
    const map = new Map<string, PresenceUser[]>();
    const all = p.presence?.() ?? [];
    for (const u of all) {
      if (u.userId === p.selfUserId) continue;
      const iid = u.hoverItemId;
      if (!iid) continue;
      const arr = map.get(iid);
      if (arr) arr.push(u);
      else map.set(iid, [u]);
    }
    return map;
  });

  onCleanup(() => {
    p.onItemHover?.(undefined);
  });
  // Paste-Popup-State: enthaelt den rohen Zwischenablage-Text, wenn beim
  // Paste-Event ein multi-line-Text erkannt wurde. null = Popup zu.
  const [pasteText, setPasteText] = createSignal<string | null>(null);
  // History-Sektion faltbar. Per-Snapshot-Expand wird ueber native
  // <details>-Elemente geloest — kein zusaetzlicher Set im Signal.
  const [historyOpen, setHistoryOpen] = createSignal(false);
  // Transform-to-Card-Popup (Checkliste → neue Karte mit checklist_ref).
  const [showToCard, setShowToCard] = createSignal(false);
  // Close-Action-Konfigurations-Modal.
  const [showActionModal, setShowActionModal] = createSignal(false);
  const navigate = useNavigate();
  let aliasInputRef: HTMLInputElement | undefined;

  // T.AC.B: Checklist-Header als Drag-Source. Atom='checklist' →
  // Drop-Targets im Calendar legen eine atom_manifestation (atom_type=
  // 'checklist') an. View-Mode-only: im Edit-Mode klickt man den Input
  // zum Rename, also waere draggable kontraproduktiv.
  const headerDrag = bindDragSource({
    build: () => ({
      atom: 'checklist',
      atomId: p.checklist.id,
      label: displayLabel() || p.checklist.label,
      workspaceId: p.checklist.workspace_id,
    }),
  });

  // Cross-View-Drop (T.1.G.2.C): Task aus Sidebar/Calendar wird zur
  // Checklisten-Position. Idempotent: bestehende Checklist-Manif derselben
  // Task wird gemoved, sonst neu angelegt.
  const [crossViewDragOver, setCrossViewDragOver] = createSignal(false);
  const crossViewDrop = bindDropTarget({
    accepts: (src) => src.atom === 'task',
    onEnter: () => setCrossViewDragOver(true),
    onLeave: () => setCrossViewDragOver(false),
    onDrop: (src) => {
      setCrossViewDragOver(false);
      const tail = p.items.reduce((max, it) => (it.position > max ? it.position : max), -1) + 1;
      const taskExisting = (p.wsManifestations ?? []).filter((m) => m.atom_id === src.atomId);
      void dropOnChecklist({
        workspaceId: p.workspaceId,
        taskId: src.atomId,
        taskLabel: src.label,
        targetChecklistId: p.checklist.id,
        targetPosition: tail,
        existingForTask: taskExisting,
      });
    },
  });

  async function wrap<T>(fn: () => Promise<T>, successMsg?: string) {
    if (busy()) return;
    setBusy(true);
    try {
      await fn();
      if (successMsg) showToast(successMsg, 'success');
      p.onChanged();
    } catch (err) {
      console.error('ChecklistPanel.wrap:', err);
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
      console.error('setChecklistAlias:', err);
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
      const ok = await showConfirm({
        title: 'Checkliste loeschen?',
        message: `Checkliste "${displayLabel() || '(Liste)'}" loeschen? Enthaelt ${count} Punkt(e).`,
        variant: 'danger',
        confirmLabel: 'Loeschen',
      });
      if (!ok) return;
    }
    const clSnap = { ...p.checklist };
    const itemSnaps = p.items.map((i) => ({ ...i }));
    const labelForToast = displayLabel() || clSnap.label;
    await wrap(() => delChecklist(p.checklist.id));
    showUndoToast(`Checkliste "${labelForToast || '(Liste)'}" geloescht.`, () => {
      void (async () => {
        try {
          await restoreChecklistWithItems(clSnap, itemSnaps);
          showToast('Checkliste wiederhergestellt.', 'success');
          p.onChanged();
        } catch (err) {
          console.error('restoreChecklistWithItems:', err);
          showToast(translateDbError(err), 'error');
        }
      })();
    });
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
    showUndoToast('Punkt geloescht.', () => {
      void (async () => {
        try {
          await restoreChecklistItem(snap);
          p.onChanged();
        } catch (err) {
          console.error('restoreChecklistItem:', err);
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

  // Voller Close-Flow: Snapshot der Items ablegen, danach Items gemaess
  // recur-Status behandeln — non-recurring: delete all, recurring:
  // done=false reset. Bei non-recurring mit >0 Items vorher eine
  // Rueckfrage, weil Delete destruktiv ist.
  function isRecurring(): boolean {
    const r = p.checklist.recur;
    return !!(r && typeof r === 'object' && Object.keys(r).length > 0);
  }

  async function performClose(confirmIfDestructive: boolean): Promise<boolean> {
    if (busy()) return false;
    const recur = isRecurring();
    if (!recur && p.items.length > 0 && confirmIfDestructive) {
      const ok = await showConfirm({
        title: 'Checkliste abschliessen?',
        message: `Checkliste "${displayLabel() || '(Liste)'}" abschliessen? Alle ${p.items.length} Punkte werden entfernt — ein Snapshot bleibt in der Historie.`,
        variant: 'warning',
        confirmLabel: 'Abschliessen',
      });
      if (!ok) return false;
    }
    setBusy(true);
    try {
      const snap = p.items.map((it) => ({
        text: it.text,
        done: it.done,
        level: it.level,
      }));
      await saveChecklistSnapshot({
        workspaceId: p.workspaceId,
        checklistId: p.checklist.id,
        items: snap,
      });
      await applyChecklistClose({
        workspaceId: p.workspaceId,
        checklistId: p.checklist.id,
        recurring: recur,
      });
      showToast(recur ? 'Abgeschlossen — Punkte zurueckgesetzt.' : 'Abgeschlossen.', 'success');
      p.onChanged();
      // Konfigurierte Close-Action ausfuehren (Toast/Jump/Webhook/Mail).
      // Fehler in der Action brechen den Close-Erfolg nicht — sie werden
      // im executeChecklistAction via Toast gemeldet.
      void executeChecklistAction(parseChecklistAction(p.checklist.action), {
        workspaceId: p.workspaceId,
        checklistLabel: displayLabel() || '(Liste)',
        navigate,
      });
      return true;
    } catch (err) {
      console.error('performClose:', err);
      showToast(translateDbError(err), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function onSnapshot() {
    void performClose(true);
  }

  async function onDelSnapshot(closedAt: string) {
    if (busy()) return;
    // Pre-Snapshot des betroffenen Eintrags fuer Undo. Der aktuelle
    // history-Array liegt im props-Objekt vor — der Eintrag wird per
    // closedAt gefunden und vollstaendig gemerkt.
    const snap = (p.checklist.history ?? []).find((s) => s.closedAt === closedAt);
    await wrap(() =>
      delChecklistSnapshot({
        workspaceId: p.workspaceId,
        checklistId: p.checklist.id,
        closedAt,
      }),
    );
    if (!snap) return;
    showUndoToast('Snapshot geloescht.', () => {
      void (async () => {
        try {
          await restoreChecklistSnapshot({
            workspaceId: p.workspaceId,
            checklistId: p.checklist.id,
            snapshot: { closedAt: snap.closedAt, items: snap.items },
          });
          showToast('Snapshot wiederhergestellt.', 'success');
          p.onChanged();
        } catch (err) {
          console.error('restoreChecklistSnapshot:', err);
          showToast(translateDbError(err), 'error');
        }
      })();
    });
  }

  async function onCloseModeChange(mode: ChecklistCloseMode) {
    if (mode === p.checklist.close_mode) return;
    await wrap(() => setChecklistCloseMode(p.checklist.id, mode));
  }

  // Recur-Value als Type-String. 'none' = null (einmalige Liste),
  // sonst der jsonb-Type daraus. Default daily wenn der User von
  // 'none' auf recurring wechselt.
  function recurType(): 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' {
    const r = p.checklist.recur;
    if (!r || typeof r !== 'object') return 'none';
    const t = (r as { type?: unknown }).type;
    if (t === 'daily' || t === 'weekly' || t === 'monthly' || t === 'yearly') {
      return t;
    }
    // Objekt ohne klaren Type (legacy) → als 'daily' zeigen, damit der
    // User beim Select sieht was gerade gilt und korrigieren kann.
    return 'daily';
  }
  async function onRecurChange(val: string) {
    const next = val === 'none' ? null : { type: val };
    await wrap(() => setChecklistRecur(p.checklist.id, next as Record<string, unknown> | null));
  }

  // Auto-Close-Detection: feuert bei Zustandsuebergang von "nicht alle done"
  // zu "alle done". Verhalten je nach close_mode:
  //   - 'manual'       — nichts automatisch; User klickt Button.
  //   - 'auto-prompt'  — Toast mit Action-Button "Jetzt abschliessen".
  //   - 'auto-silent'  — direkt performClose (ohne Confirm).
  let prevAllDone = false;
  createEffect(() => {
    const all = p.items.length > 0 && p.items.every((i) => i.done);
    if (all && !prevAllDone) {
      prevAllDone = true;
      const mode = p.checklist.close_mode;
      if (mode === 'auto-silent') {
        void performClose(false);
      } else if (mode === 'auto-prompt') {
        // Generischer Action-Toast mit passendem Button-Label
        // ("Abschliessen" statt generischem "Rueckgaengig").
        showToast(`"${displayLabel() || '(Liste)'}" ist vollstaendig.`, 'info', {
          ms: 10000,
          action: {
            label: 'Abschliessen',
            onClick: () => {
              void performClose(true);
            },
          },
        });
      }
    } else if (!all) {
      prevAllDone = false;
    }
  });

  const done = () => p.items.filter((i) => i.done).length;
  const historyList = () => p.checklist.history ?? [];

  const formatClosedAt = formatDateTimeDE;

  return (
    <li class="cl-item" attr:data-edit={editMode() ? 'true' : 'false'}>
      <header
        class="cl-head"
        classList={{ 'mx-editable': editMode(), 'cl-head-draggable': !editMode() }}
        draggable={!editMode()}
        onDragStart={headerDrag.onDragStart}
        onDragEnd={headerDrag.onDragEnd}
      >
        {/* View-Mode: nur Span (nicht draggable-stoerend). Edit-Mode: Input. */}
        <Show
          when={editMode()}
          fallback={
            <span class="mx-head-input cl-head-input cl-head-static">
              {displayLabel() || '(Liste)'}
            </span>
          }
        >
          <input
            class="mx-head-input cl-head-input"
            type="text"
            value={p.checklist.label}
            placeholder="(Liste)"
            tabIndex={0}
            onBlur={(e) => onRename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
          />
        </Show>
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
        <Show when={editMode()}>
          <select
            class="cl-recur-select"
            value={recurType()}
            onChange={(e) => void onRecurChange(e.currentTarget.value)}
            disabled={busy()}
            title="Wiederkehrend — Items werden beim Abschliessen nur zurueckgesetzt statt geloescht."
            aria-label="Wiederkehr-Intervall"
          >
            <option value="none">einmalig</option>
            <option value="daily">taeglich</option>
            <option value="weekly">woechentlich</option>
            <option value="monthly">monatlich</option>
            <option value="yearly">jaehrlich</option>
          </select>
          <select
            class="cl-close-mode"
            value={p.checklist.close_mode}
            onChange={(e) => void onCloseModeChange(e.currentTarget.value as ChecklistCloseMode)}
            disabled={busy()}
            title="Wann soll diese Checkliste abgeschlossen werden?"
            aria-label="Close-Modus der Checkliste"
          >
            <option value="manual">manuell</option>
            <option value="auto-prompt">fragen bei Vollstaendig</option>
            <option value="auto-silent">auto. bei Vollstaendig</option>
          </select>
          <button
            type="button"
            class="cl-action-btn"
            onClick={() => setShowActionModal(true)}
            disabled={busy()}
            title="Close-Aktion konfigurieren (Toast / Jump / Webhook / Mail)"
            aria-label="Close-Aktion konfigurieren"
          >
            ⚡
          </button>
        </Show>
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
            <Icon name="arrow-path" size={12} />
          </span>
        </Show>
        {/* §13.3 V2.D: Marker-Bar (Star+Eye) fuer das Checklist-Atom.
            Zeigt sich rechts in der cl-head, nur wenn selfUserId
            durchgereicht ist (View-Mode-Kontext mit User-Session). */}
        <Show when={p.selfUserId}>
          {(uid) => (
            <AtomMarkerBar
              workspaceId={p.workspaceId}
              userId={uid()}
              atomType="checklist"
              atomId={p.checklist.id}
              markers={(p.wsAtomMarkers ?? []).filter(
                (m) => m.atom_type === 'checklist' && m.atom_id === p.checklist.id,
              )}
              wsMembers={p.wsMembers}
            />
          )}
        </Show>
      </header>

      <ul
        class="cl-items"
        classList={{ 'cl-items-dragover': crossViewDragOver() }}
        onDragEnter={crossViewDrop.onDragEnter}
        onDragOver={crossViewDrop.onDragOver}
        onDragLeave={crossViewDrop.onDragLeave}
        onDrop={crossViewDrop.onDrop}
      >
        <For each={p.items}>
          {(it) => {
            // Phase 4 T.1.G.2.D-Followup: Items sind Tasks (T.1.B).
            // bindDragSource macht sie zu vollwertigen Drag-Quellen
            // fuer Mini-Calendar/Day-View. sourceManifId = die
            // Checklist-Manifestation, damit Drop-Targets via lookup
            // entscheiden koennen.
            const itemDrag = bindDragSource({
              build: () => {
                const manif = (p.wsManifestations ?? []).find(
                  (m) => m.kind === 'checklist' && m.atom_id === it.id,
                );
                return {
                  atom: 'task',
                  atomId: it.id,
                  label: it.text,
                  sourceManifId: manif?.id,
                  workspaceId: p.checklist.workspace_id,
                };
              },
            });
            return (
              <li
                class="cl-it"
                classList={{ 'cl-it-done': it.done, 'cl-it-draggable': !editMode() }}
                style={{ '--cl-level': it.level }}
                draggable={!editMode()}
                onDragStart={itemDrag.onDragStart}
                onDragEnd={itemDrag.onDragEnd}
                onMouseEnter={() => p.onItemHover?.(it.id)}
                onMouseLeave={() => p.onItemHover?.(undefined)}
              >
                <PresenceMini users={presenceByItem().get(it.id) ?? []} />
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
                    ref={(el) => {
                      const cleanup = bindAliasAutocomplete(el, p.workspaceId);
                      onCleanup(cleanup);
                    }}
                    onPaste={(e) => {
                      // Multi-line-Paste → Popup mit Parser-Vorschau.
                      // Single-line bleibt normaler Paste (kein preventDefault).
                      const txt = e.clipboardData?.getData('text/plain') ?? '';
                      if (/\r?\n/.test(txt)) {
                        e.preventDefault();
                        setPasteText(txt);
                      }
                    }}
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
                {/* §13.3 V2-deferred (M.3 2026-05-13) — AtomMarkerBar
                    pro Item. Item ist ein task-Atom (item.id = task.id).
                    Pattern analog cl-head (atom_type='checklist') in
                    Z.559-571. */}
                <Show when={p.selfUserId}>
                  {(uid) => (
                    <AtomMarkerBar
                      workspaceId={p.workspaceId}
                      userId={uid()}
                      atomType="task"
                      atomId={it.id}
                      markers={(p.wsAtomMarkers ?? []).filter(
                        (m) => m.atom_type === 'task' && m.atom_id === it.id,
                      )}
                      wsMembers={p.wsMembers}
                    />
                  )}
                </Show>
              </li>
            );
          }}
        </For>
      </ul>

      <div class="cl-actions">
        <Show when={editMode()}>
          <button type="button" class="cl-add-item-btn" onClick={onAddItem} disabled={busy()}>
            + Punkt
          </button>
        </Show>
        <Show when={editMode()}>
          <button
            type="button"
            class="btn-subtle cl-to-card-btn"
            onClick={() => setShowToCard(true)}
            disabled={busy()}
            title="Diese Checkliste als Karte auf einem Board anlegen (Referenz)"
          >
            → Karte
          </button>
        </Show>
        <Show when={p.items.length > 0}>
          <button
            type="button"
            class="btn-subtle cl-snapshot-btn"
            onClick={onSnapshot}
            disabled={busy()}
            title="Aktuellen Stand in Historie speichern"
          >
            ↺ Abschliessen
          </button>
        </Show>
      </div>

      <Show when={historyList().length > 0}>
        <section class="cl-history" classList={{ 'cl-history-open': historyOpen() }}>
          <button
            type="button"
            class="cl-history-toggle"
            onClick={() => setHistoryOpen((v) => !v)}
            aria-expanded={historyOpen()}
          >
            <span class="cl-history-chev" classList={{ expanded: historyOpen() }}>
              ▸
            </span>
            Historie ({historyList().length})
          </button>
          <Show when={historyOpen()}>
            <ul class="cl-history-list">
              <For each={historyList()}>
                {(snap) => {
                  const total = snap.items.length;
                  const doneN = snap.items.filter((i) => i.done).length;
                  return (
                    <li class="cl-history-entry">
                      <details class="cl-history-details">
                        <summary class="cl-history-summary">
                          <span class="cl-history-time">{formatClosedAt(snap.closedAt)}</span>
                          <span class="cl-history-count">
                            {doneN}/{total}
                          </span>
                          <Show when={editMode()}>
                            <button
                              type="button"
                              class="cl-history-del"
                              title="Snapshot loeschen"
                              aria-label="Snapshot loeschen"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                void onDelSnapshot(snap.closedAt);
                              }}
                              disabled={busy()}
                            >
                              ✕
                            </button>
                          </Show>
                        </summary>
                        <ul class="cl-history-items">
                          <For each={snap.items}>
                            {(si) => (
                              <li
                                class="cl-history-item"
                                classList={{ done: si.done }}
                                style={{ '--cl-level': si.level }}
                              >
                                <span class="cl-history-check" aria-hidden="true">
                                  {si.done ? '☑' : '☐'}
                                </span>
                                <span class="cl-history-text">{si.text}</span>
                              </li>
                            )}
                          </For>
                        </ul>
                      </details>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </section>
      </Show>

      <ModalTransition when={showToCard()}>
        <ChecklistToCardPopup
          workspaceId={p.workspaceId}
          checklistId={p.checklist.id}
          checklistLabel={displayLabel()}
          onClose={() => setShowToCard(false)}
          onCreated={() => p.onChanged()}
        />
      </ModalTransition>

      <ModalTransition when={showActionModal()}>
        <ChecklistActionModal
          workspaceId={p.workspaceId}
          checklistId={p.checklist.id}
          currentAction={p.checklist.action}
          onClose={() => setShowActionModal(false)}
          onSaved={() => p.onChanged()}
        />
      </ModalTransition>

      <ModalTransition when={pasteText() !== null}>
        <ChecklistPastePopup
          initialText={pasteText() as string}
          checklistLabel={p.checklist.label}
          workspaceId={p.workspaceId}
          onClose={() => setPasteText(null)}
          onCommit={async (parsed: ParsedPasteItem[]) => {
            setPasteText(null);
            await wrap(
              () =>
                bulkAddChecklistItems({
                  workspaceId: p.workspaceId,
                  checklistId: p.checklist.id,
                  items: parsed.map((it) => ({ text: it.text, level: it.level })),
                }),
              `${parsed.length} ${parsed.length === 1 ? 'Punkt' : 'Punkte'} eingefuegt`,
            );
          }}
        />
      </ModalTransition>
    </li>
  );
};

export default ChecklistPanel;
