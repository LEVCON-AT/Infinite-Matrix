// Signup-Page (B.1.C). Eigene Route /signup analog zu /login. SSO-
// Buttons + Mail/PW-Signup. Magic-Link kommt nicht hier — Login-Page
// haelt den Magic-Link-Tab.
//
// Auto-Gate: SSO-Buttons identisch zur Login-Page (anon-RPC).

import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { type Component, Show, createResource, createSignal } from 'solid-js';
import {
  signInWithGitHub,
  signInWithGoogle,
  signInWithLinkedIn,
  signInWithMicrosoft,
  signUpWithPassword,
  useSession,
} from '../lib/auth';
import { translateDbError } from '../lib/errors';
import { supabase } from '../lib/supabase';

const Signup: Component = () => {
  const navigate = useNavigate();
  const session = useSession();
  const [searchParams] = useSearchParams<{ next?: string }>();

  type ProviderFlags = {
    google?: boolean;
    microsoft?: boolean;
    github?: boolean;
    linkedin?: boolean;
  };
  const [providers] = createResource(async () => {
    try {
      const { data, error } = await supabase.rpc('get_enabled_auth_providers');
      if (error) throw error;
      return (data as ProviderFlags | null) ?? {};
    } catch {
      return {} as ProviderFlags;
    }
  });
  const googleEnabled = () => providers()?.google === true;
  const microsoftEnabled = () => providers()?.microsoft === true;
  const githubEnabled = () => providers()?.github === true;
  const linkedinEnabled = () => providers()?.linkedin === true;
  const anySsoEnabled = () =>
    googleEnabled() || microsoftEnabled() || githubEnabled() || linkedinEnabled();

  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [info, setInfo] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  if (session()) navigate(searchParams.next ?? '/', { replace: true });

  async function withBusy(label: string, fn: () => Promise<void>) {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(translateDbError(err, `${label} fehlgeschlagen.`));
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: Event) {
    e.preventDefault();
    const em = email().trim();
    const pw = password();
    if (!em || pw.length < 8) {
      setError('E-Mail und mindestens 8-stelliges Passwort eingeben.');
      return;
    }
    await withBusy('Registrierung', async () => {
      await signUpWithPassword(em, pw, searchParams.next);
      setInfo(
        `Bestaetigungsmail an ${em} gesendet. Klicke den Link um deinen Account zu aktivieren.`,
      );
    });
  }

  return (
    <main class="login-page" ref={(el) => el?.classList.add('login-page-enter')}>
      <section class="login-card">
        <header class="login-head">
          <h1>Konto erstellen</h1>
          <p class="login-sub">
            Schon ein Konto? <A href="/login">Anmelden</A>
          </p>
        </header>

        <Show when={anySsoEnabled()}>
          <div class="login-sso">
            <Show when={googleEnabled()}>
              <button
                type="button"
                class="login-sso-btn lift"
                onClick={() =>
                  void withBusy('Google-Signup', () => signInWithGoogle(searchParams.next))
                }
                disabled={busy()}
              >
                Mit Google registrieren
              </button>
            </Show>
            <Show when={microsoftEnabled()}>
              <button
                type="button"
                class="login-sso-btn lift"
                onClick={() =>
                  void withBusy('Microsoft-Signup', () => signInWithMicrosoft(searchParams.next))
                }
                disabled={busy()}
              >
                Mit Microsoft registrieren
              </button>
            </Show>
            <Show when={githubEnabled()}>
              <button
                type="button"
                class="login-sso-btn lift"
                onClick={() =>
                  void withBusy('GitHub-Signup', () => signInWithGitHub(searchParams.next))
                }
                disabled={busy()}
              >
                Mit GitHub registrieren
              </button>
            </Show>
            <Show when={linkedinEnabled()}>
              <button
                type="button"
                class="login-sso-btn lift"
                onClick={() =>
                  void withBusy('LinkedIn-Signup', () => signInWithLinkedIn(searchParams.next))
                }
                disabled={busy()}
              >
                Mit LinkedIn registrieren
              </button>
            </Show>
          </div>
        </Show>

        <Show when={anySsoEnabled()}>
          <div class="login-divider" aria-hidden="true">
            <span>oder per Email</span>
          </div>
        </Show>

        <form class="login-form" onSubmit={onSubmit}>
          <label class="login-field">
            <span>E-Mail</span>
            <input
              class="input"
              type="email"
              required
              autocomplete="email"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              disabled={busy()}
            />
          </label>
          <label class="login-field">
            <span>Passwort (mind. 8 Zeichen)</span>
            <input
              class="input"
              type="password"
              required
              autocomplete="new-password"
              minLength={8}
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              disabled={busy()}
            />
          </label>
          <button type="submit" class="btn btn-primary lift" disabled={busy()}>
            Konto erstellen
          </button>
        </form>

        <Show when={info()}>
          {/* biome-ignore lint/a11y/useSemanticElements: role="status" Block-Container. */}
          <p class="login-info" role="status">
            {info()}
          </p>
        </Show>
        <Show when={error()}>
          <p class="login-error" role="alert">
            {error()}
          </p>
        </Show>
      </section>
    </main>
  );
};

export default Signup;
