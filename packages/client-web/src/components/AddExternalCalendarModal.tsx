// Welle I.6 — Add External Calendar Modal.
//
// Vier Tabs: ICS-URL (Pull-Subscribe), File-Upload (One-Shot), Google
// (V1: Hinweis "kommt bald", V2: OAuth-Redirect), Microsoft (analog).
// V1 funktioniert ICS-URL + Upload vollstaendig. OAuth-Tabs zeigen
// einen "noch nicht aktiv"-Hinweis mit Verweis auf den ICS-URL-Pfad
// als Workaround.

import {
  type Component,
  For,
  Show,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { useSession } from '../lib/auth';
import {
  type ParsedEventInput,
  createExternalCalendar,
  importIcsEvents,
} from '../lib/calendar-inbound';
import { installFocusRestore, installFocusTrap } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { parseIcs } from '../lib/ics-parser';
import { fetchMyWorkspaces } from '../lib/queries';
import { showToast } from '../lib/toasts';
import Icon from './Icon';

type TabKey = 'ics' | 'upload' | 'google' | 'microsoft';

const SYNC_INTERVAL_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 5, label: '5 Min' },
  { value: 10, label: '10 Min' },
  { value: 15, label: '15 Min' },
  { value: 30, label: '30 Min' },
  { value: 60, label: '1 Stunde' },
  { value: 120, label: '2 Stunden' },
  { value: 240, label: '4 Stunden' },
  { value: 480, label: '8 Stunden' },
  { value: 720, label: '12 Stunden' },
  { value: 1440, label: '24 Stunden' },
];

export type AddExternalCalendarModalProps = {
  defaultWorkspaceId: string;
  onClose: () => void;
  onAdded: () => void;
};

const AddExternalCalendarModal: Component<AddExternalCalendarModalProps> = (props) => {
  const session = useSession();
  const [tab, setTab] = createSignal<TabKey>('ics');
  const [busy, setBusy] = createSignal(false);

  const [workspaces] = createResource(
    () => session()?.user?.id ?? null,
    () => fetchMyWorkspaces(),
  );

  // Form-State.
  const [workspaceId, setWorkspaceId] = createSignal(props.defaultWorkspaceId);
  const [label, setLabel] = createSignal('');
  const [color, setColor] = createSignal('#3b82f6');
  const [icsUrl, setIcsUrl] = createSignal('');
  const [interval, setInterval] = createSignal(15);

  // Upload-State.
  const [uploadFile, setUploadFile] = createSignal<File | null>(null);
  const [uploadPreview, setUploadPreview] = createSignal<ParsedEventInput[]>([]);
  const [parseError, setParseError] = createSignal<string | null>(null);

  const canSubmitIcs = createMemo(
    () => !!workspaceId() && label().trim().length > 0 && /^https?:\/\//.test(icsUrl().trim()),
  );
  const canSubmitUpload = createMemo(
    () => !!workspaceId() && label().trim().length > 0 && uploadPreview().length > 0,
  );

  async function handleIcsSubmit(): Promise<void> {
    if (!canSubmitIcs() || busy()) return;
    setBusy(true);
    try {
      await createExternalCalendar({
        workspaceId: workspaceId(),
        kind: 'ics_subscribe',
        label: label().trim(),
        sourceUrl: icsUrl().trim(),
        color: color(),
        syncIntervalMinutes: interval(),
      });
      showToast('Kalender abonniert. Der erste Sync laeuft im Hintergrund.', 'success');
      props.onAdded();
      props.onClose();
    } catch (err) {
      showToast(translateDbError(err, 'Abonnieren fehlgeschlagen.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleFileChange(file: File | null): Promise<void> {
    setUploadFile(file);
    setParseError(null);
    setUploadPreview([]);
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = parseIcs(text);
      if (parsed.length === 0) {
        setParseError('Keine VEVENT-Eintraege in der Datei gefunden.');
        return;
      }
      setUploadPreview(parsed);
    } catch (err) {
      setParseError((err as Error).message ?? 'Datei konnte nicht gelesen werden.');
    }
  }

  async function handleUploadSubmit(): Promise<void> {
    if (!canSubmitUpload() || busy()) return;
    setBusy(true);
    try {
      const result = await importIcsEvents(workspaceId(), label().trim(), uploadPreview(), {
        color: color(),
      });
      showToast(`${result.imported_count} Termine importiert.`, 'success');
      props.onAdded();
      props.onClose();
    } catch (err) {
      showToast(translateDbError(err, 'Import fehlgeschlagen.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  function close(): void {
    if (busy()) return;
    props.onClose();
  }

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
      e.stopImmediatePropagation();
      close();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  return (
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
        class="overlay-card add-cal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-cal-title"
      >
        <header class="overlay-head">
          <h3 id="add-cal-title">Externen Kalender verbinden</h3>
          <button
            type="button"
            class="overlay-close"
            onClick={close}
            aria-label="Schliessen"
            disabled={busy()}
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <nav class="add-cal-tabs" role="tablist">
            <For
              each={[
                { key: 'ics' as TabKey, label: 'ICS-URL', hint: 'Subscribe' },
                { key: 'upload' as TabKey, label: 'Datei hochladen', hint: 'One-Shot' },
                { key: 'google' as TabKey, label: 'Google', hint: 'OAuth' },
                { key: 'microsoft' as TabKey, label: 'Microsoft', hint: 'OAuth' },
              ]}
            >
              {(t) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab() === t.key}
                  class="add-cal-tab"
                  classList={{ active: tab() === t.key }}
                  onClick={() => setTab(t.key)}
                >
                  <span>{t.label}</span>
                  <span class="add-cal-tab-hint">{t.hint}</span>
                </button>
              )}
            </For>
        </nav>

        <div class="overlay-body">
            <Show when={tab() === 'ics' || tab() === 'upload'}>
              <label class="login-field">
                <span>Workspace</span>
                <select
                  class="input"
                  value={workspaceId()}
                  onInput={(e) => setWorkspaceId(e.currentTarget.value)}
                >
                  <For each={workspaces() ?? []}>
                    {(ws) => <option value={ws.id}>{ws.name}</option>}
                  </For>
                </select>
              </label>
              <label class="login-field">
                <span>Label</span>
                <input
                  class="input"
                  type="text"
                  value={label()}
                  onInput={(e) => setLabel(e.currentTarget.value)}
                  placeholder="z.B. Outlook-Privat"
                  maxlength={100}
                />
              </label>
              <label class="login-field">
                <span>Farbe</span>
                <input
                  type="color"
                  class="add-cal-color"
                  value={color()}
                  onInput={(e) => setColor(e.currentTarget.value)}
                />
              </label>
            </Show>

            <Show when={tab() === 'ics'}>
              <label class="login-field">
                <span>ICS-URL</span>
                <input
                  class="input"
                  type="url"
                  value={icsUrl()}
                  onInput={(e) => setIcsUrl(e.currentTarget.value)}
                  placeholder="https://..."
                />
                <small class="hint">
                  In Outlook → „Kalender veroeffentlichen", in Google → „Geheime Adresse im
                  iCal-Format", in Apple → „Oeffentlicher Kalender" Toggle.
                </small>
              </label>
              <label class="login-field">
                <span>Sync-Intervall</span>
                <select
                  class="input"
                  value={interval()}
                  onInput={(e) => setInterval(Number(e.currentTarget.value))}
                >
                  <For each={SYNC_INTERVAL_OPTIONS}>
                    {(o) => <option value={o.value}>{o.label}</option>}
                  </For>
                </select>
              </label>
            </Show>

            <Show when={tab() === 'upload'}>
              <label class="login-field">
                <span>.ics-Datei</span>
                <input
                  class="input"
                  type="file"
                  accept=".ics,text/calendar"
                  onChange={(e) => void handleFileChange(e.currentTarget.files?.[0] ?? null)}
                />
                <Show when={uploadFile()}>
                  {(f) => (
                    <small class="hint">
                      {f().name} · {(f().size / 1024).toFixed(1)} KB
                    </small>
                  )}
                </Show>
                <Show when={parseError()}>
                  <small class="hint hint-danger">{parseError()}</small>
                </Show>
              </label>

              <Show when={uploadPreview().length > 0}>
                <section class="add-cal-preview">
                  <h3>
                    Vorschau ({uploadPreview().length} Eintraege —
                    {uploadPreview().length > 5 ? ' erste 5' : ''})
                  </h3>
                  <ul class="add-cal-preview-list">
                    <For each={uploadPreview().slice(0, 5)}>
                      {(ev) => (
                        <li>
                          <span class="add-cal-preview-summary">{ev.summary}</span>
                          <span class="add-cal-preview-date">
                            {new Date(ev.start_at).toLocaleDateString('de-DE')}
                            <Show when={ev.rrule}> · wiederholt</Show>
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              </Show>
            </Show>

            <Show when={tab() === 'google'}>
              <div class="add-cal-deferred">
                <Icon name="sparkles" size={20} />
                <p>
                  <strong>Google-Calendar-OAuth</strong> kommt mit Welle I.10.
                </p>
                <p class="hint">
                  Workaround: in Google Calendar „Geheime Adresse im iCal-Format" kopieren und in
                  den ICS-URL-Tab einsetzen.
                </p>
              </div>
            </Show>
            <Show when={tab() === 'microsoft'}>
              <div class="add-cal-deferred">
                <Icon name="sparkles" size={20} />
                <p>
                  <strong>Microsoft-365-OAuth</strong> kommt mit Welle I.11.
                </p>
                <p class="hint">
                  Workaround: in Outlook → Calendar veroeffentlichen → ICS-URL kopieren und in den
                  ICS-URL-Tab einsetzen.
                </p>
              </div>
            </Show>
        </div>

        <footer class="overlay-foot">
          <button type="button" class="btn btn-subtle" onClick={close} disabled={busy()}>
            Abbrechen
          </button>
          <Show when={tab() === 'ics'}>
            <button
              type="button"
              class="btn btn-primary lift"
              disabled={!canSubmitIcs() || busy()}
              onClick={() => void handleIcsSubmit()}
            >
              {busy() ? 'Verbinde…' : 'Abonnieren'}
            </button>
          </Show>
          <Show when={tab() === 'upload'}>
            <button
              type="button"
              class="btn btn-primary lift"
              disabled={!canSubmitUpload() || busy()}
              onClick={() => void handleUploadSubmit()}
            >
              {busy() ? 'Importiere…' : `${uploadPreview().length} Termine importieren`}
            </button>
          </Show>
        </footer>
      </div>
    </div>
  );
};

export default AddExternalCalendarModal;
