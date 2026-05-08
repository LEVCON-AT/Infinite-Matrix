// Welle WV.C.5 — DangerousDeleteModal (Konzept §8.2.3).
//
// Gemeinsame Confirm-Komponente fuer Alt+1-9 (Vorlage destruktiv
// entfernen) und Alt+Entf (Cells komplett leeren). Reuse-Faelle:
// Bulk-Apply-Loesch-Strategien, zukuenftige Workspace-Bulk-Loeschungen.
//
// Pflicht-Elemente (Konzept §8.2.3):
// - Anzahl der betroffenen Cells.
// - Collapsible-Liste (Default eingeklappt — bei 8x8=64 Zeilen sonst
//   unbedienbar). Pro Eintrag: Cell-Coord + Inhalt-Vorschau.
// - Export-Checkbox „Vor Loeschung exportieren" — Default an
//   (Doppelter-Boden, User-Direktive 2026-05-07).
// - Fundus-Knopf „In Fundus verschieben" — V1 ausgegraut, aktiv mit
//   Welle WV.Z. Bis dahin Hard-Delete + Export.
// - pushUndo + showUndoToast Pflicht — Caller-Verantwortung im
//   onConfirm-Handler.

import { type Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import Icon from '../Icon';

export type DangerousDeleteItem = {
  // Stable Key fuer For-Render.
  id: string;
  // Sichtbares Label, z.B. „jan/kunde".
  label: string;
  // Optional Inhalts-Vorschau (Vorlage-Name + Atom-Counts).
  preview?: string;
};

export type DangerousDeleteModalProps = {
  title: string;
  // z.B. „Vorlage „Info Vertrag" wird von 12 Cells entfernt."
  summary: string;
  // Destruktive Items mit Konflikt-Hinweisen.
  items: ReadonlyArray<DangerousDeleteItem>;
  // Callback bei Bestaetigung. exportFirst = true wenn User die
  // Doppelboden-Checkbox aktiv gelassen hat.
  onConfirm: (input: { exportFirst: boolean }) => void | Promise<void>;
  onClose: () => void;
  // V1: Fundus noch nicht implementiert. Caller setzt false.
  fundusEnabled?: boolean;
  // Optionaler Hinweis-Text unten (z.B. „pushUndo aktiv 10s").
  hint?: string;
};

const DangerousDeleteModal: Component<DangerousDeleteModalProps> = (p) => {
  let dialogEl: HTMLDialogElement | undefined;

  const [exportFirst, setExportFirst] = createSignal(true);
  const [listOpen, setListOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    dialogEl?.showModal();
  });
  onCleanup(() => {
    dialogEl?.close();
  });

  async function handleConfirm(): Promise<void> {
    if (busy()) return;
    setBusy(true);
    try {
      await p.onConfirm({ exportFirst: exportFirst() });
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={(el) => {
        dialogEl = el;
      }}
      class="overlay-modal"
      aria-labelledby="dangerous-delete-modal-title"
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
      <div class="overlay-card dangerous-delete-card">
        <header class="overlay-head">
          <h3 id="dangerous-delete-modal-title">{p.title}</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>

        <div class="dangerous-delete-body">
          <p class="dangerous-delete-summary">{p.summary}</p>

          <Show when={p.items.length > 0}>
            <div class="dangerous-delete-list">
              <button
                type="button"
                class="dangerous-delete-list-toggle"
                onClick={() => setListOpen(!listOpen())}
                aria-expanded={listOpen()}
              >
                <Icon name={listOpen() ? 'chevron-down' : 'chevron-right'} size={12} />
                <span>{p.items.length} Eintraege</span>
              </button>
              <Show when={listOpen()}>
                <ul class="dangerous-delete-items">
                  <For each={p.items}>
                    {(item) => (
                      <li>
                        <strong>{item.label}</strong>
                        <Show when={item.preview}>
                          <span class="dangerous-delete-preview">{item.preview}</span>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          </Show>

          <label class="dangerous-delete-export">
            <input
              type="checkbox"
              checked={exportFirst()}
              onChange={(e) => setExportFirst(e.currentTarget.checked)}
            />
            <span>
              <strong>Vor Loeschung exportieren</strong>
              <span class="dangerous-delete-export-hint">
                JSON-Snapshot wird heruntergeladen — Doppelboden falls irrtuemlich bestaetigt.
              </span>
            </span>
          </label>

          <Show when={p.hint}>
            <p class="dangerous-delete-hint">{p.hint}</p>
          </Show>

          <footer class="dangerous-delete-actions">
            <button type="button" class="btn-secondary" onClick={p.onClose}>
              Abbrechen
            </button>
            <button
              type="button"
              class="btn-subtle"
              disabled={!p.fundusEnabled || busy()}
              title={p.fundusEnabled ? 'In Fundus verschieben' : 'Fundus noch nicht verfuegbar'}
            >
              In Fundus verschieben
            </button>
            <button
              type="button"
              class="btn-danger"
              onClick={() => void handleConfirm()}
              disabled={busy()}
            >
              {busy() ? 'Loescht…' : 'Loeschen'}
            </button>
          </footer>
        </div>
      </div>
    </dialog>
  );
};

export default DangerousDeleteModal;
