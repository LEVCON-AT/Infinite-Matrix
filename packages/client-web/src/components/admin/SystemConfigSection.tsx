// System-Config-Editor (Welle B B.0.C).
//
// Generischer Key-Value-Editor ueber list/get/set/deleteSystemConfig.
// Keys sind dotted (auth.providers.google, smtp.host, ...). Values sind
// jsonb — wir editieren als JSON-Textarea mit Live-Parse-Validation.
//
// Pre-defined Slot-UI fuer SSO-Provider kommt mit B.1 — V1 reicht der
// generische Editor um Configs anzulegen + zu pflegen.
//
// Sicherheit: jeder Save geht durch das set_system_config-RPC, das
// is_platform_admin() prueft. Fehlende Berechtigung → roter Toast.

import { type Component, For, Show, createResource, createSignal } from 'solid-js';
import {
  type SystemConfigEntry,
  deleteSystemConfig,
  listSystemConfig,
  setSystemConfig,
} from '../../lib/admin';
import { showConfirm } from '../../lib/dialog';
import { translateDbError } from '../../lib/errors';
import { showToast, showUndoToast } from '../../lib/toasts';
import Icon from '../Icon';

const SystemConfigSection: Component = () => {
  const [entries, { refetch }] = createResource(async () => {
    try {
      return await listSystemConfig();
    } catch (err) {
      console.error('listSystemConfig:', err);
      showToast(translateDbError(err, 'Konfiguration nicht ladbar.'), 'error');
      return [] as SystemConfigEntry[];
    }
  });

  const [adding, setAdding] = createSignal(false);

  return (
    <section class="admin-section">
      <header class="admin-section-head">
        <h3>System-Config</h3>
        <button
          type="button"
          class="btn-subtle"
          onClick={() => setAdding(true)}
          disabled={adding()}
        >
          <Icon name="plus" size={14} />
          <span>Neuer Eintrag</span>
        </button>
      </header>

      <Show when={adding()}>
        <ConfigEntryForm
          mode="create"
          onSaved={() => {
            setAdding(false);
            void refetch();
          }}
          onCancel={() => setAdding(false)}
        />
      </Show>

      <Show when={!entries.loading} fallback={<p class="admin-loading">Lade Konfiguration…</p>}>
        <Show
          when={(entries() ?? []).length > 0}
          fallback={
            <Show when={!adding()}>
              <p class="hint admin-section-empty">Noch keine Konfiguration. Erster Eintrag oben.</p>
            </Show>
          }
        >
          <ul class="admin-config-list">
            <For each={entries() ?? []}>
              {(e) => (
                <li class="admin-config-item">
                  <ConfigEntryForm
                    mode="edit"
                    entry={e}
                    onSaved={() => void refetch()}
                    onDeleted={() => void refetch()}
                  />
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </section>
  );
};

type FormProps =
  | {
      mode: 'create';
      onSaved: () => void;
      onCancel: () => void;
      entry?: undefined;
      onDeleted?: undefined;
    }
  | {
      mode: 'edit';
      entry: SystemConfigEntry;
      onSaved: () => void;
      onDeleted: () => void;
      onCancel?: undefined;
    };

const ConfigEntryForm: Component<FormProps> = (p) => {
  const initialKey = p.mode === 'edit' ? p.entry.key : '';
  const initialValue = p.mode === 'edit' ? JSON.stringify(p.entry.value, null, 2) : '{\n  \n}';
  const initialDesc = p.mode === 'edit' ? (p.entry.description ?? '') : '';

  const [key, setKey] = createSignal(initialKey);
  const [valueRaw, setValueRaw] = createSignal(initialValue);
  const [desc, setDesc] = createSignal(initialDesc);
  const [busy, setBusy] = createSignal(false);

  function parseValue(): { ok: true; value: Record<string, unknown> } | { ok: false; msg: string } {
    try {
      const v = JSON.parse(valueRaw());
      if (v == null || typeof v !== 'object' || Array.isArray(v)) {
        return { ok: false, msg: 'JSON muss ein Objekt sein.' };
      }
      return { ok: true, value: v as Record<string, unknown> };
    } catch (err) {
      return { ok: false, msg: `JSON ungueltig: ${(err as Error).message}` };
    }
  }

  async function onSave(e: Event) {
    e.preventDefault();
    if (busy()) return;
    const k = key().trim();
    if (!k) {
      showToast('Key darf nicht leer sein.', 'error');
      return;
    }
    const parsed = parseValue();
    if (!parsed.ok) {
      showToast(parsed.msg, 'error');
      return;
    }
    setBusy(true);
    try {
      await setSystemConfig(k, parsed.value, desc().trim() || undefined);
      showToast('Gespeichert.', 'success');
      p.onSaved();
    } catch (err) {
      console.error('setSystemConfig:', err);
      showToast(translateDbError(err, 'Speichern fehlgeschlagen.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (p.mode !== 'edit') return;
    if (busy()) return;
    const ok = await showConfirm({
      title: 'Eintrag loeschen?',
      message: `"${p.entry.key}" wirklich entfernen?`,
      variant: 'danger',
      confirmLabel: 'Loeschen',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const snap = { ...p.entry };
      await deleteSystemConfig(p.entry.key);
      showUndoToast('Eintrag entfernt', async () => {
        try {
          await setSystemConfig(snap.key, snap.value, snap.description ?? undefined);
        } catch (undoErr) {
          console.error('setSystemConfig (undo):', undoErr);
        }
      });
      p.onDeleted();
    } catch (err) {
      console.error('deleteSystemConfig:', err);
      showToast(translateDbError(err, 'Loeschen fehlgeschlagen.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="admin-config-form" onSubmit={onSave}>
      <label class="admin-config-row">
        <span>Key</span>
        <input
          type="text"
          value={key()}
          onInput={(e) => setKey(e.currentTarget.value)}
          placeholder="z.B. auth.providers.google"
          readOnly={p.mode === 'edit'}
          disabled={busy()}
          required
        />
      </label>
      <label class="admin-config-row">
        <span>Description</span>
        <input
          type="text"
          value={desc()}
          onInput={(e) => setDesc(e.currentTarget.value)}
          placeholder="(optional) Hinweis fuer kuenftige Admins"
          disabled={busy()}
        />
      </label>
      <label class="admin-config-row admin-config-row-value">
        <span>Value (JSON)</span>
        <textarea
          value={valueRaw()}
          onInput={(e) => setValueRaw(e.currentTarget.value)}
          rows="6"
          spellcheck={false}
          disabled={busy()}
        />
      </label>
      <Show when={p.mode === 'edit' && p.entry?.updated_at}>
        <p class="admin-config-meta">Zuletzt aktualisiert: {p.entry?.updated_at}</p>
      </Show>
      <footer class="admin-config-actions">
        <Show when={p.mode === 'edit'}>
          <button
            type="button"
            class="btn-subtle admin-config-del"
            onClick={() => void onDelete()}
            disabled={busy()}
          >
            <Icon name="trash" size={14} />
            <span>Loeschen</span>
          </button>
        </Show>
        <Show when={p.mode === 'create'}>
          <button type="button" class="btn-subtle" onClick={p.onCancel} disabled={busy()}>
            Abbrechen
          </button>
        </Show>
        <button type="submit" class="btn-primary" disabled={busy()}>
          {busy() ? 'Speichere…' : 'Speichern'}
        </button>
      </footer>
    </form>
  );
};

export default SystemConfigSection;
