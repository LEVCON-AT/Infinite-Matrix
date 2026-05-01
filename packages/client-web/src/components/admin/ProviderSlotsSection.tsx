// Provider-Slots — strukturierte Konfig-Maske statt generischem JSON.
//
// Memory feedback_admin_dashboard_config_gate: externe Provider-Configs
// gehoeren in eine strukturierte Maske, kein Out-of-Band-ENV-Setup.
// Features bleiben ausgegraut/ausgeblendet bis Konfig 100% korrekt +
// verifiziert.
//
// Slots V1:
//   - auth.providers.google     (OAuth: client_id, client_secret)
//   - auth.providers.microsoft  (OAuth: client_id, client_secret, tenant_id)
//   - smtp.config               (SMTP: host, port, user, pass, from)
//
// Schema im system_config: jeder Slot ist ein eigener Key mit jsonb-
// Value: { ...fields, enabled: bool, verified_at: timestamptz | null }.
// Aktivieren ist nur moeglich wenn alle Pflichtfelder gefuellt sind.
// Verified-Flag ist V1 manuell vom Admin gesetzt (Test-Call kommt
// als Folge-Sprint).

import { type Component, For, Show, createMemo, createResource, createSignal } from 'solid-js';
import { type SystemConfigEntry, listSystemConfig, setSystemConfig } from '../../lib/admin';
import { translateDbError } from '../../lib/errors';
import { showToast } from '../../lib/toasts';

type FieldDef = {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number';
  required: boolean;
  hint?: string;
  placeholder?: string;
};

type VerifyKind = 'oauth-discovery' | 'smtp-noop' | null;

type SlotDef = {
  key: string;
  label: string;
  description: string;
  docsUrl?: string;
  fields: FieldDef[];
  verify: VerifyKind;
};

const SLOTS: SlotDef[] = [
  {
    key: 'auth.providers.google',
    label: 'Google OAuth',
    description:
      'Sign-in via Google. Client-Setup: console.cloud.google.com → APIs & Services → Credentials.',
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-google',
    fields: [
      {
        key: 'client_id',
        label: 'Client-ID',
        type: 'text',
        required: true,
        placeholder: 'xxx.apps.googleusercontent.com',
      },
      { key: 'client_secret', label: 'Client-Secret', type: 'password', required: true },
    ],
    verify: 'oauth-discovery',
  },
  {
    key: 'auth.providers.microsoft',
    label: 'Microsoft Entra (Azure AD)',
    description:
      'Sign-in via Microsoft. Client-Setup: portal.azure.com → Entra ID → App registrations.',
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-azure',
    fields: [
      { key: 'client_id', label: 'Application (Client) ID', type: 'text', required: true },
      { key: 'client_secret', label: 'Client-Secret', type: 'password', required: true },
      {
        key: 'tenant_id',
        label: 'Tenant-ID',
        type: 'text',
        required: true,
        hint: 'common fuer Multi-Tenant',
      },
    ],
    verify: 'oauth-discovery',
  },
  {
    key: 'auth.providers.github',
    label: 'GitHub OAuth',
    description: 'Sign-in via GitHub. Client-Setup: github.com/settings/developers → OAuth Apps.',
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-github',
    fields: [
      { key: 'client_id', label: 'Client-ID', type: 'text', required: true },
      { key: 'client_secret', label: 'Client-Secret', type: 'password', required: true },
    ],
    verify: 'oauth-discovery',
  },
  {
    key: 'auth.providers.linkedin',
    label: 'LinkedIn OAuth (OIDC)',
    description:
      'Sign-in via LinkedIn. Client-Setup: linkedin.com/developers → Apps. OIDC-Scope notwendig.',
    docsUrl: 'https://supabase.com/docs/guides/auth/social-login/auth-linkedin',
    fields: [
      { key: 'client_id', label: 'Client-ID', type: 'text', required: true },
      { key: 'client_secret', label: 'Client-Secret', type: 'password', required: true },
    ],
    verify: 'oauth-discovery',
  },
  {
    key: 'smtp.config',
    label: 'SMTP-Server',
    description:
      'Outbound-Mail (Magic-Link, Invites, Password-Reset). Empfehlung: dedizierter Provider (SendGrid, Mailgun, ...).',
    fields: [
      {
        key: 'host',
        label: 'Host',
        type: 'text',
        required: true,
        placeholder: 'smtp.sendgrid.net',
      },
      { key: 'port', label: 'Port', type: 'number', required: true, placeholder: '587' },
      { key: 'user', label: 'User', type: 'text', required: true },
      { key: 'pass', label: 'Passwort', type: 'password', required: true },
      {
        key: 'from',
        label: 'From-Adresse',
        type: 'text',
        required: true,
        placeholder: 'no-reply@levcon.at',
      },
    ],
    verify: 'smtp-noop',
  },
];

// OIDC-Discovery-Endpoints zum Verify (HEAD/GET-Reachability + jwks-Lookup).
const OIDC_DISCOVERY: Record<string, string> = {
  'auth.providers.google': 'https://accounts.google.com/.well-known/openid-configuration',
  'auth.providers.microsoft':
    'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
  'auth.providers.github': 'https://api.github.com',
  'auth.providers.linkedin': 'https://www.linkedin.com/oauth/.well-known/openid-configuration',
};

const ProviderSlotsSection: Component = () => {
  const [entries, { refetch }] = createResource(async () => {
    try {
      return await listSystemConfig();
    } catch (err) {
      console.error('listSystemConfig:', err);
      showToast(translateDbError(err, 'Konfiguration nicht ladbar.'), 'error');
      return [] as SystemConfigEntry[];
    }
  });

  const byKey = createMemo(() => {
    const map = new Map<string, SystemConfigEntry>();
    for (const e of entries() ?? []) map.set(e.key, e);
    return map;
  });

  return (
    <section class="admin-section">
      <header class="admin-section-head">
        <h3>Provider-Slots</h3>
        <button type="button" class="btn-subtle" onClick={() => void refetch()}>
          ↻ Neu laden
        </button>
      </header>
      <p class="hint">
        Strukturierte Konfig fuer SSO-Provider und SMTP. Aktivierung ist nur moeglich wenn alle
        Pflichtfelder gefuellt sind. Generischer JSON-Editor unten fuer Custom-Keys.
      </p>

      <Show when={!entries.loading} fallback={<p class="admin-loading">Lade…</p>}>
        <div class="provider-slot-grid">
          <For each={SLOTS}>
            {(slot) => (
              <ProviderSlotCard
                slot={slot}
                entry={byKey().get(slot.key) ?? null}
                onSaved={() => void refetch()}
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  );
};

const ProviderSlotCard: Component<{
  slot: SlotDef;
  entry: SystemConfigEntry | null;
  onSaved: () => void;
}> = (p) => {
  const initialValue = createMemo(() => (p.entry?.value as Record<string, unknown>) ?? {});

  const [draft, setDraft] = createSignal<Record<string, string>>(
    Object.fromEntries(
      p.slot.fields.map((f) => {
        const v = initialValue()[f.key];
        return [f.key, v == null ? '' : String(v)];
      }),
    ),
  );
  const [enabled, setEnabled] = createSignal<boolean>(Boolean(initialValue().enabled));
  const [busy, setBusy] = createSignal(false);
  const [verifying, setVerifying] = createSignal(false);
  const [verifyResult, setVerifyResult] = createSignal<{ ok: boolean; msg: string } | null>(null);

  async function doVerify() {
    if (p.slot.verify == null) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      if (p.slot.verify === 'oauth-discovery') {
        const url = OIDC_DISCOVERY[p.slot.key];
        if (!url) throw new Error('Discovery-URL unbekannt');
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // OIDC-Doc: muss issuer-Feld haben (oder bei GitHub status 200)
        if (url.endsWith('.well-known/openid-configuration')) {
          const j = await res.json();
          if (!j.issuer) throw new Error('Antwort enthielt kein issuer-Feld');
        }
        setVerifyResult({ ok: true, msg: 'Discovery-Endpoint erreichbar' });
      } else if (p.slot.verify === 'smtp-noop') {
        // SMTP kann der Browser nicht direkt testen (Port 587 + SMTP-Protocol).
        // Pseudo-Verify: hostname-DNS-Resolve via fetch zu einer Status-URL,
        // V1: User-Hint dass echter Test im Mail-Send-Flow passiert.
        const host = String(draft().host || '');
        if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error('Host-Format ungueltig');
        setVerifyResult({
          ok: true,
          msg: 'Host-Format ok. Echter Send-Test passiert beim ersten Magic-Link.',
        });
      }
    } catch (err) {
      setVerifyResult({ ok: false, msg: (err as Error).message ?? 'Verify fehlgeschlagen' });
    } finally {
      setVerifying(false);
    }
  }

  const allRequiredFilled = createMemo(() => {
    const d = draft();
    return p.slot.fields.every((f) => !f.required || (d[f.key] && d[f.key].trim().length > 0));
  });

  async function save() {
    if (enabled() && !allRequiredFilled()) {
      showToast('Aktivierung setzt alle Pflichtfelder voraus.', 'error');
      return;
    }
    setBusy(true);
    try {
      const value: Record<string, unknown> = { ...draft() };
      // port als Number speichern, nicht als String.
      for (const f of p.slot.fields) {
        if (f.type === 'number' && value[f.key] !== '') {
          const n = Number(value[f.key]);
          if (!Number.isNaN(n)) value[f.key] = n;
        }
      }
      value.enabled = enabled();
      await setSystemConfig(p.slot.key, value, p.slot.label);
      showToast(`${p.slot.label} gespeichert.`, 'success');
      p.onSaved();
    } catch (err) {
      showToast(translateDbError(err, 'Speichern fehlgeschlagen.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article class="provider-slot-card lift">
      <header class="provider-slot-head">
        <h4>{p.slot.label}</h4>
        <span
          class="provider-slot-status"
          classList={{
            'provider-slot-status-active': enabled() && allRequiredFilled(),
            'provider-slot-status-incomplete': enabled() && !allRequiredFilled(),
            'provider-slot-status-inactive': !enabled(),
          }}
        >
          {enabled() ? (allRequiredFilled() ? 'aktiv' : 'konfig unvollstaendig') : 'inaktiv'}
        </span>
      </header>
      <p class="hint">{p.slot.description}</p>

      <div class="provider-slot-fields">
        <For each={p.slot.fields}>
          {(f) => (
            <label class="login-field">
              <span>
                {f.label}
                {f.required && <span aria-hidden="true"> *</span>}
              </span>
              <input
                class="input"
                type={f.type === 'number' ? 'number' : f.type}
                placeholder={f.placeholder}
                value={draft()[f.key] ?? ''}
                onInput={(e) => setDraft({ ...draft(), [f.key]: e.currentTarget.value })}
                disabled={busy()}
                autocomplete="off"
              />
              <Show when={f.hint}>
                <span class="hint">{f.hint}</span>
              </Show>
            </label>
          )}
        </For>
      </div>

      <label class="provider-slot-enable">
        <input
          type="checkbox"
          checked={enabled()}
          onChange={(e) => setEnabled(e.currentTarget.checked)}
          disabled={!allRequiredFilled() || busy()}
        />
        <span>Aktivieren</span>
        <Show when={!allRequiredFilled()}>
          <span class="hint">(Pflichtfelder fehlen)</span>
        </Show>
      </label>

      <Show when={verifyResult()}>
        {(r) => (
          <p
            class="provider-slot-verify"
            classList={{
              'provider-slot-verify-ok': r().ok,
              'provider-slot-verify-fail': !r().ok,
            }}
            // biome-ignore lint/a11y/useSemanticElements: <p role="status"> bewusst — Block-Container fuer Live-Region.
            role="status"
          >
            {r().ok ? '✓' : '✗'} {r().msg}
          </p>
        )}
      </Show>

      <div class="provider-slot-actions">
        <Show when={p.slot.docsUrl}>
          {(href) => (
            <a class="btn-link" href={href()} target="_blank" rel="noopener noreferrer">
              Anleitung
            </a>
          )}
        </Show>
        <Show when={p.slot.verify}>
          <button
            type="button"
            class="btn btn-subtle"
            onClick={() => void doVerify()}
            disabled={busy() || verifying() || !allRequiredFilled()}
          >
            {verifying() ? 'Pruefe…' : 'Verbindung pruefen'}
          </button>
        </Show>
        <button
          type="button"
          class="btn btn-primary lift"
          onClick={() => void save()}
          disabled={busy()}
        >
          Speichern
        </button>
      </div>
    </article>
  );
};

export default ProviderSlotsSection;
