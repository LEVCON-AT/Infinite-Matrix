// Welle I.8 — ImportedEventDetailModal.
//
// Read-only Snapshot eines importierten External-Events plus Aktions-
// Section: "→ Task ableiten" (oeffnet DeriveTaskModal), "→ Manifestation
// hinzufuegen" (oeffnet existing Create-Manifestation-Modal mit
// atomType='imported_event'), "Original oeffnen" (sourceUrl-Link),
// "Aus Matrix entfernen" (loescht atom_manifestation aus Calendar —
// external_event bleibt aktiv beim naechsten Sync).

import { type Component, Show, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import { fetchExternalEventById } from '../lib/calendar-inbound';
import { installFocusRestore, installFocusTrap } from '../lib/dialog';
import { closeImportedEventModal, type ImportedEventModalSnapshot } from '../lib/imported-event-modal-state';
import { showToast } from '../lib/toasts';
import type { AtomPin, DocRow } from '../lib/types';
import AtomDocsSection from './AtomDocsSection';
import DeriveTaskModal from './DeriveTaskModal';
import Icon from './Icon';

const PROVIDER_LABEL: Record<string, string> = {
  ics_subscribe: 'iCal-Abo',
  google: 'Google Calendar',
  microsoft: 'Outlook',
  upload: 'Datei-Import',
};

export type ImportedEventDetailModalProps = {
  workspaceId: string;
  eventId: string;
  snapshot: ImportedEventModalSnapshot;
  // Welle D.9: optional fuer AtomDocsSection.
  wsAtomPins?: AtomPin[];
  wsDocs?: DocRow[];
};

const ImportedEventDetailModal: Component<ImportedEventDetailModalProps> = (props) => {
  const [deriveOpen, setDeriveOpen] = createSignal(false);

  // Best-effort full event-fetch fuer description/location etc. Bei Offline
  // fallback auf Snapshot.
  const [full] = createResource(
    () => props.eventId,
    (id) => fetchExternalEventById(id),
  );

  let containerEl: HTMLDivElement | undefined;

  onMount(() => {
    const restoreFocus = installFocusRestore();
    onCleanup(restoreFocus);
    if (containerEl) {
      const releaseTrap = installFocusTrap(containerEl);
      onCleanup(releaseTrap);
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deriveOpen()) return; // ESC im Sub-Modal landet dort.
      e.stopImmediatePropagation();
      closeImportedEventModal();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  function close(): void {
    closeImportedEventModal();
  }

  function openOriginal(): void {
    const url = props.snapshot.url ?? full()?.url ?? null;
    if (!url) {
      showToast('Kein Original-Link hinterlegt.', 'info');
      return;
    }
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'mailto:') {
        showToast('Link-Protokoll nicht erlaubt.', 'info');
        return;
      }
      if (u.protocol === 'mailto:') {
        window.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      showToast('Link ist ungueltig.', 'info');
    }
  }

  return (
    <>
      <div
        class="overlay-scrim"
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div
          ref={(el) => {
            containerEl = el;
          }}
          class="overlay-card imported-event-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="imported-event-title"
          style={
            props.snapshot.sourceColor
              ? { '--imp-source-color': props.snapshot.sourceColor }
              : undefined
          }
        >
          <header class="overlay-head imported-event-head">
            <div class="imported-event-title-wrap">
              <span class="imported-event-source-dot" aria-hidden="true" />
              <h3 id="imported-event-title">{props.snapshot.summary}</h3>
            </div>
            <button
              type="button"
              class="overlay-close"
              onClick={close}
              aria-label="Schliessen"
            >
              <Icon name="x" size={18} />
            </button>
          </header>

          <div class="overlay-body">
            <dl class="imported-event-meta">
              <dt>Quelle</dt>
              <dd>
                {props.snapshot.sourceProvider
                  ? PROVIDER_LABEL[props.snapshot.sourceProvider] ?? props.snapshot.sourceProvider
                  : '—'}
              </dd>
              <dt>Datum</dt>
              <dd>
                {props.snapshot.startDate}
                <Show when={props.snapshot.isRange}> → {props.snapshot.endDate}</Show>
                <Show when={props.snapshot.time}> · {props.snapshot.time}</Show>
                <Show when={props.snapshot.isRecurring}>
                  <span class="imported-event-recur-badge">wiederholt</span>
                </Show>
              </dd>
              <Show when={full()?.location}>
                <dt>Ort</dt>
                <dd>{full()?.location}</dd>
              </Show>
              <Show when={full()?.description}>
                <dt>Beschreibung</dt>
                <dd class="imported-event-description">{full()?.description}</dd>
              </Show>
            </dl>

            <p class="hint">
              Importierte Termine sind read-only. Du kannst aus ihnen eine Task ableiten oder sie
              in andere Sichten (Kanban, Checkliste) duplizieren — der Original-Termin bleibt
              extern verwaltet.
            </p>

            {/* Welle D.9: Doku-Sektion am importierten Event. Pin-Owner
                ist das external_event-Atom (atom_type='imported_event'). */}
            <Show when={props.wsAtomPins && props.wsDocs}>
              <AtomDocsSection
                atomType="imported_event"
                atomId={props.eventId}
                atomTitle={props.snapshot.summary ?? null}
                atomPins={props.wsAtomPins ?? []}
                docs={props.wsDocs ?? []}
              />
            </Show>
          </div>

          <footer class="overlay-foot imported-event-foot">
            <button type="button" class="btn btn-subtle" onClick={close}>
              Schliessen
            </button>
            <Show when={props.snapshot.url || full()?.url}>
              <button type="button" class="btn btn-subtle" onClick={openOriginal}>
                <Icon name="arrow-top-right-on-square" size={14} />
                <span>Original</span>
              </button>
            </Show>
            <button
              type="button"
              class="btn btn-primary lift"
              onClick={() => setDeriveOpen(true)}
            >
              <Icon name="sparkles" size={14} />
              <span>Task ableiten</span>
            </button>
          </footer>
        </div>
      </div>

      <Show when={deriveOpen()}>
        <DeriveTaskModal
          workspaceId={props.workspaceId}
          eventId={props.eventId}
          defaults={{
            summary: props.snapshot.summary,
            startDate: props.snapshot.startDate,
            endDate: props.snapshot.endDate,
            isRange: props.snapshot.isRange,
            isRecurring: props.snapshot.isRecurring,
          }}
          onClose={() => setDeriveOpen(false)}
          onDerived={() => close()}
        />
      </Show>
    </>
  );
};

export default ImportedEventDetailModal;
