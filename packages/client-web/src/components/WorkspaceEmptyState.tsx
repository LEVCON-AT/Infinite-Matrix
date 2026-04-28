// Empty-State im Workspace-Content (Phase 3 hilfreich-Polish).
//
// Bisheriges UX: "Waehle links eine Matrix oder ein Board." als
// einzelne hint-Zeile — ohne Hinweis was der User tun soll wenn die
// Sidebar leer ist. Jetzt: warmer Header + CTA-Buttons fuer den
// schnellen "+ Matrix" / "+ Board"-Anlage-Pfad.
//
// Anlage-Helpers:
//   - createRootMatrixWithDefaults: 2 Zeilen + 2 Spalten als Starter
//   - createRootBoardWithDefaults: 3 kb_cols (ToDo/In Arbeit/Erledigt)
// Beides best-effort — bei Seed-Fehler bleibt zumindest der Knoten,
// User kann manuell ergaenzen.

import { type Component, Show, createSignal } from 'solid-js';
import { translateDbError } from '../lib/errors';
import { createRootBoardWithDefaults, createRootMatrixWithDefaults } from '../lib/mutations';
import { showToast } from '../lib/toasts';
import Icon from './Icon';

type Props = {
  workspaceId: string;
  canCreate: boolean;
  onCreated: (nodeId: string) => void;
};

const WorkspaceEmptyState: Component<Props> = (p) => {
  const [busy, setBusy] = createSignal<'matrix' | 'board' | null>(null);

  async function onCreateMatrix() {
    if (busy() || !p.workspaceId) return;
    setBusy('matrix');
    try {
      const node = await createRootMatrixWithDefaults({ workspaceId: p.workspaceId });
      showToast('Matrix angelegt — du kannst direkt loslegen.', 'success');
      p.onCreated(node.id);
    } catch (err) {
      console.error('createRootMatrixWithDefaults:', err);
      showToast(translateDbError(err, 'Matrix konnte nicht angelegt werden.'), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function onCreateBoard() {
    if (busy() || !p.workspaceId) return;
    setBusy('board');
    try {
      const node = await createRootBoardWithDefaults({ workspaceId: p.workspaceId });
      showToast('Board angelegt — drei Spalten warten auf Karten.', 'success');
      p.onCreated(node.id);
    } catch (err) {
      console.error('createRootBoardWithDefaults:', err);
      showToast(translateDbError(err, 'Board konnte nicht angelegt werden.'), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section class="ws-empty-state" aria-label="Workspace leer">
      <div class="ws-empty-icon" aria-hidden="true">
        <Icon name="sparkles" size={36} />
      </div>
      <h2 class="ws-empty-title">Leg los — bau dir deine Struktur.</h2>
      <p class="ws-empty-hint">
        Waehle links eine Matrix oder ein Board, oder leg direkt eine an. Du kannst spaeter beliebig
        verschachteln, umbenennen und durch Eingabe Objekte erstellen.
      </p>
      <Show
        when={p.canCreate}
        fallback={
          <p class="ws-empty-readonly">
            Du hast in diesem Workspace nur Lesezugriff — frag den Owner ob du Editor werden kannst.
          </p>
        }
      >
        <div class="ws-empty-actions">
          <button
            type="button"
            class="ws-empty-cta ws-empty-cta-matrix"
            onClick={onCreateMatrix}
            disabled={busy() !== null}
          >
            <Icon name="squares-2x2" size={18} />
            <span class="ws-empty-cta-title">+ Matrix anlegen</span>
            <span class="ws-empty-cta-sub">2x2 Starter, du kannst direkt tippen</span>
          </button>
          <button
            type="button"
            class="ws-empty-cta ws-empty-cta-board"
            onClick={onCreateBoard}
            disabled={busy() !== null}
          >
            <Icon name="view-columns" size={18} />
            <span class="ws-empty-cta-title">+ Board anlegen</span>
            <span class="ws-empty-cta-sub">3 Spalten ToDo / In Arbeit / Erledigt</span>
          </button>
        </div>
      </Show>
    </section>
  );
};

export default WorkspaceEmptyState;
