// Popup, um eine Standalone-Checkliste in eine Karte zu verwandeln.
// Die neue Karte haelt einen `checklist_ref` auf die Checkliste — die
// Checkliste bleibt dabei unveraendert und ist jetzt zusaetzlich vom
// Board aus sichtbar. Mehrfach-Transform (mehrere Karten zeigen auf
// dieselbe Checkliste) ist erlaubt.

import { useNavigate } from '@solidjs/router';
import {
  type Component,
  For,
  Show,
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { installFocusRestore } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { createCardFromChecklist } from '../lib/mutations';
import { fetchBoardContent, fetchNodesForWorkspace } from '../lib/queries';
import { showToast } from '../lib/toasts';
import type { NodeRow } from '../lib/types';
import Icon from './Icon';

type Props = {
  workspaceId: string;
  checklistId: string;
  checklistLabel: string;
  onClose: () => void;
  onCreated?: () => void;
};

const ChecklistToCardPopup: Component<Props> = (p) => {
  const navigate = useNavigate();
  const [boardId, setBoardId] = createSignal<string>('');
  const [colId, setColId] = createSignal<string>('');
  const [name, setName] = createSignal(p.checklistLabel || '');
  const [busy, setBusy] = createSignal(false);

  // Alle Boards im Workspace laden.
  const [nodes] = createResource(
    () => p.workspaceId,
    (wid) => fetchNodesForWorkspace(wid),
  );
  const boards = (): NodeRow[] => (nodes() ?? []).filter((n) => n.type === 'board');

  // Cols des gewaehlten Boards — reaktiv nachladen.
  const [boardContent] = createResource(
    () => (boardId() ? { bid: boardId(), wid: p.workspaceId } : null),
    (args) => fetchBoardContent(args.bid, args.wid),
  );
  const cols = () => boardContent()?.kbCols ?? [];

  // Bei Board-Wechsel: erste Spalte als Default auswaehlen.
  createEffect(() => {
    const c = cols();
    if (c.length > 0 && !c.find((col) => col.id === colId())) {
      setColId(c[0].id);
    } else if (c.length === 0) {
      setColId('');
    }
  });

  onMount(() => {
    onCleanup(installFocusRestore());
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  async function submit() {
    if (busy()) return;
    const bid = boardId();
    const cid = colId();
    const nm = name().trim();
    if (!bid) {
      showToast('Bitte Ziel-Board waehlen.', 'error');
      return;
    }
    if (!cid) {
      showToast('Ziel-Board hat keine Spalten.', 'error');
      return;
    }
    if (!nm) {
      showToast('Karten-Name darf nicht leer sein.', 'error');
      return;
    }
    setBusy(true);
    try {
      const card = await createCardFromChecklist({
        workspaceId: p.workspaceId,
        checklistId: p.checklistId,
        name: nm,
        targetBoardId: bid,
        targetColId: cid,
      });
      showToast('Karte angelegt.', 'success');
      p.onCreated?.();
      p.onClose();
      // Auf die neue Karte navigieren — User sieht das Ergebnis direkt.
      navigate(`/w/${p.workspaceId}/n/${card.board_id}?card=${card.id}`);
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop-Klick — Tastatur via ESC-Capture im onMount.
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        class="overlay-card cl2c-card"
        // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> bewusst statt <dialog> — showModal() haette aufwendige Migration aller Modals zur Folge.
        role="dialog"
        aria-modal="true"
      >
        <header class="overlay-head">
          <h3>Checkliste in Karte umwandeln</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div class="cl2c-body">
          <p class="cl2c-hint">
            Die Checkliste bleibt bestehen. Die neue Karte traegt eine Referenz (checklist_ref) —
            Aenderungen an der Checkliste sind in allen Karten sichtbar.
          </p>
          <label class="cl2c-field">
            <span class="cl2c-field-label">Karten-Name</span>
            <input
              type="text"
              class="cl2c-input"
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="Name der neuen Karte"
            />
          </label>
          <label class="cl2c-field">
            <span class="cl2c-field-label">Ziel-Board</span>
            <select
              class="cl2c-select"
              value={boardId()}
              onChange={(e) => setBoardId(e.currentTarget.value)}
            >
              <option value="">(bitte waehlen)</option>
              <For each={boards()}>
                {(b) => (
                  <option value={b.id}>
                    {b.label || '(ohne Label)'}
                    {b.alias ? ` · ^${b.alias}` : ''}
                  </option>
                )}
              </For>
            </select>
          </label>
          <Show when={boardId()}>
            <label class="cl2c-field">
              <span class="cl2c-field-label">Spalte</span>
              <select
                class="cl2c-select"
                value={colId()}
                onChange={(e) => setColId(e.currentTarget.value)}
              >
                <For each={cols()}>
                  {(c) => <option value={c.id}>{c.label || '(ohne Label)'}</option>}
                </For>
                <Show when={cols().length === 0}>
                  <option value="" disabled>
                    (keine Spalten)
                  </option>
                </Show>
              </select>
            </label>
          </Show>
        </div>
        <footer class="overlay-foot cl2c-foot">
          <button type="button" class="btn-subtle" onClick={p.onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            class="btn btn-p"
            onClick={submit}
            disabled={busy() || !boardId() || !colId() || !name().trim()}
          >
            Erstellen
          </button>
        </footer>
      </div>
    </div>
  );
};

export default ChecklistToCardPopup;
