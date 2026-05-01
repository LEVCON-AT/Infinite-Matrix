// Settings → Workspace → Webhooks (Welle C.2).
//
// CRUD-UI fuer workspace_webhooks. Nur Admins/Owner sehen die Sektion
// (RLS gibt sonst leere Liste). Beim Anlegen wird das signing_secret
// einmalig als hex angezeigt — copy-paste ins externe System (n8n /
// Slack-App / Custom). Nach dem Schliessen des Modals ist es nie mehr
// einsehbar, nur ueber Re-Create.

import { useParams } from '@solidjs/router';
import { type Component, For, Show, createResource, createSignal } from 'solid-js';
import { formatDateTimeDE } from '../../lib/dates';
import { showConfirm } from '../../lib/dialog';
import { translateDbError } from '../../lib/errors';
import { showToast } from '../../lib/toasts';
import {
  EVENT_KINDS,
  EVENT_KIND_LABELS,
  type Webhook,
  type WorkspaceEventKind,
  createWebhook,
  deleteWebhook,
  listWebhooks,
  updateWebhook,
} from '../../lib/webhooks';

type EditDraft = {
  id: string | null;
  name: string;
  targetUrl: string;
  eventTypes: WorkspaceEventKind[];
  enabled: boolean;
};

const WorkspaceWebhooks: Component = () => {
  const params = useParams<{ workspaceId: string }>();

  const [items, { refetch }] = createResource(
    () => params.workspaceId,
    async (wsId) => {
      try {
        return await listWebhooks(wsId);
      } catch (err) {
        console.error('listWebhooks:', err);
        showToast(translateDbError(err, 'Webhooks nicht ladbar.'), 'error');
        return [] as Webhook[];
      }
    },
  );

  const [draft, setDraft] = createSignal<EditDraft | null>(null);
  const [secretHex, setSecretHex] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);

  function startCreate() {
    setDraft({ id: null, name: '', targetUrl: 'https://', eventTypes: [], enabled: true });
    setSecretHex(null);
  }

  function startEdit(w: Webhook) {
    setDraft({
      id: w.id,
      name: w.name,
      targetUrl: w.target_url,
      eventTypes: [...w.event_types],
      enabled: w.enabled,
    });
    setSecretHex(null);
  }

  function cancel() {
    setDraft(null);
    setSecretHex(null);
  }

  function toggleEvent(kind: WorkspaceEventKind) {
    const d = draft();
    if (!d) return;
    const has = d.eventTypes.includes(kind);
    setDraft({
      ...d,
      eventTypes: has ? d.eventTypes.filter((k) => k !== kind) : [...d.eventTypes, kind],
    });
  }

  async function save(e: Event) {
    e.preventDefault();
    const d = draft();
    if (!d) return;
    if (!d.name.trim() || !/^https?:\/\//.test(d.targetUrl)) {
      showToast('Name und gueltige URL noetig.', 'error');
      return;
    }
    setBusy(true);
    try {
      if (d.id == null) {
        const res = await createWebhook({
          workspaceId: params.workspaceId,
          name: d.name.trim(),
          targetUrl: d.targetUrl.trim(),
          eventTypes: d.eventTypes,
        });
        setSecretHex(res.signing_secret_hex);
        // Draft im Edit-Mode lassen damit User Secret kopieren kann.
        setDraft({ ...d, id: res.id });
        showToast('Webhook angelegt. Bitte Signing-Secret kopieren.', 'success');
      } else {
        await updateWebhook({
          id: d.id,
          name: d.name.trim(),
          targetUrl: d.targetUrl.trim(),
          eventTypes: d.eventTypes,
          enabled: d.enabled,
        });
        showToast('Webhook aktualisiert.', 'success');
        cancel();
      }
      void refetch();
    } catch (err) {
      showToast(translateDbError(err, 'Speichern fehlgeschlagen.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(w: Webhook) {
    const ok = await showConfirm({
      title: 'Webhook entfernen?',
      message: `"${w.name}" deaktivieren und loeschen? Aktion ist nicht widerrufbar.`,
      confirmLabel: 'Loeschen',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteWebhook(w.id);
      showToast('Webhook entfernt.', 'success');
      void refetch();
    } catch (err) {
      showToast(translateDbError(err, 'Loeschen fehlgeschlagen.'), 'error');
    }
  }

  return (
    <article class="settings-pane">
      <header class="settings-pane-head">
        <h2>Webhooks</h2>
        <p class="hint">
          Outbound-Events an externe Systeme (n8n, Slack, Teams, eigener Endpoint). Pro Webhook
          Event-Typen abonnieren, Empfangs-URL setzen, einmaliges Signing-Secret kopieren.
        </p>
      </header>

      <section class="settings-form-section">
        <Show when={!draft()}>
          <button type="button" class="btn btn-primary lift" onClick={startCreate}>
            + Webhook anlegen
          </button>
        </Show>

        <Show when={items.loading}>
          <p class="hint">Lade…</p>
        </Show>

        <Show when={!items.loading && (items() ?? []).length > 0}>
          <ul class="webhook-list">
            <For each={items()}>
              {(w) => (
                <li class="webhook-row">
                  <div class="webhook-meta">
                    <strong>{w.name}</strong>
                    <span class="hint">{w.target_url}</span>
                    <span class="hint">
                      {w.event_types.length} Event-Typen · {w.enabled ? 'aktiv' : 'deaktiviert'} ·{' '}
                      <Show when={w.last_attempt_at} fallback={<span>noch kein Versuch</span>}>
                        zuletzt {formatDateTimeDE(w.last_attempt_at)} ({w.last_status_code ?? '—'})
                      </Show>
                    </span>
                  </div>
                  <div class="webhook-actions">
                    <button type="button" class="btn-subtle" onClick={() => startEdit(w)}>
                      Bearbeiten
                    </button>
                    <button type="button" class="btn-subtle" onClick={() => void remove(w)}>
                      Loeschen
                    </button>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <Show when={draft()}>
          {(d) => (
            <form class="webhook-form" onSubmit={save}>
              <h3>{d().id ? 'Webhook bearbeiten' : 'Neuer Webhook'}</h3>
              <label class="login-field">
                <span>Name</span>
                <input
                  class="input"
                  required
                  value={d().name}
                  onInput={(e) => setDraft({ ...d(), name: e.currentTarget.value })}
                  disabled={busy()}
                />
              </label>
              <label class="login-field">
                <span>Empfangs-URL (https)</span>
                <input
                  class="input"
                  type="url"
                  required
                  pattern="https?://.*"
                  value={d().targetUrl}
                  onInput={(e) => setDraft({ ...d(), targetUrl: e.currentTarget.value })}
                  disabled={busy()}
                />
              </label>
              <fieldset class="webhook-events">
                <legend>Event-Typen</legend>
                <div class="webhook-events-grid">
                  <For each={EVENT_KINDS}>
                    {(kind) => (
                      <label class="webhook-event-chip">
                        <input
                          type="checkbox"
                          checked={d().eventTypes.includes(kind)}
                          onChange={() => toggleEvent(kind)}
                          disabled={busy()}
                        />
                        <span>{EVENT_KIND_LABELS[kind]}</span>
                      </label>
                    )}
                  </For>
                </div>
              </fieldset>
              <Show when={d().id}>
                <label class="webhook-enabled">
                  <input
                    type="checkbox"
                    checked={d().enabled}
                    onChange={(e) => setDraft({ ...d(), enabled: e.currentTarget.checked })}
                    disabled={busy()}
                  />
                  <span>Aktiv (Events werden zugestellt)</span>
                </label>
              </Show>

              <Show when={secretHex()}>
                {(hex) => (
                  <div class="webhook-secret-banner">
                    <strong>Signing-Secret (einmalig)</strong>
                    <code>{hex()}</code>
                    <p class="hint">
                      Kopiere jetzt — nach dem Schliessen ist es nicht mehr lesbar. HMAC-SHA256-Key
                      fuer den `X-Webhook-Signature`-Header beim Dispatch.
                    </p>
                    <button
                      type="button"
                      class="btn-subtle"
                      onClick={() => {
                        void navigator.clipboard.writeText(hex());
                        showToast('Secret kopiert.', 'success');
                      }}
                    >
                      Kopieren
                    </button>
                  </div>
                )}
              </Show>

              <div class="webhook-form-actions">
                <button type="submit" class="btn btn-primary lift" disabled={busy()}>
                  {d().id && !secretHex() ? 'Speichern' : 'Anlegen'}
                </button>
                <button type="button" class="btn-subtle" onClick={cancel} disabled={busy()}>
                  {secretHex() ? 'Schliessen' : 'Abbrechen'}
                </button>
              </div>
            </form>
          )}
        </Show>
      </section>
    </article>
  );
};

export default WorkspaceWebhooks;
