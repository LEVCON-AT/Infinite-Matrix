// Login-Page — B.1.A SSO + B.1.B Email+Password + Magic-Link.
//
// 3 Wege parallel:
//   - Google / Microsoft per OAuth (1-Klick).
//   - Email + Passwort (klassisch).
//   - Magic-Link (passwordlos).
// Tab-Switcher unterscheidet Password vs. Magic-Link; SSO-Buttons
// stehen darueber als Primary-Path.
//
// Style: animations.md §2.4 Page-Enter + §2.1 Hover-Lift fuer SSO-
// Buttons (.lift Helper-Klasse aus Q.3.A).

import { A, useNavigate, useSearchParams } from '@solidjs/router';
import { type Component, Show, createResource, createSignal, onCleanup } from 'solid-js';
import {
  requestPasswordReset,
  signInWithGitHub,
  signInWithGoogle,
  signInWithLinkedIn,
  signInWithMagicLink,
  signInWithMicrosoft,
  signInWithPassword,
  signUpWithPassword,
  useSession,
} from '../lib/auth';
import { translateDbError } from '../lib/errors';
import { supabase } from '../lib/supabase';

type Mode = 'magic-link' | 'password';
type PasswordSubMode = 'sign-in' | 'sign-up' | 'reset';

const Login: Component = () => {
  const navigate = useNavigate();
  const session = useSession();
  const [searchParams] = useSearchParams<{ next?: string }>();

  // Auto-Gate: SSO-Buttons nur sichtbar wenn der Plattform-Admin sie
  // in System-Config aktiviert hat. RPC ist anon-callable und liefert
  // nur enabled-Booleans, keine Secrets.
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

  const [mode, setMode] = createSignal<Mode>('password');
  const [pwSub, setPwSub] = createSignal<PasswordSubMode>('sign-in');
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [info, setInfo] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  // B.1.E Magic-Link-Polish: 30s-Cooldown nach Versand. Verhindert
  // Mail-Spam wenn der User dreimal hektisch klickt — UX-Hinweis +
  // disable-State.
  const [magicLinkCooldown, setMagicLinkCooldown] = createSignal(0);
  let cooldownTimer: ReturnType<typeof setInterval> | null = null;
  function startCooldown(seconds: number) {
    setMagicLinkCooldown(seconds);
    if (cooldownTimer) clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      setMagicLinkCooldown((s) => {
        if (s <= 1) {
          if (cooldownTimer) {
            clearInterval(cooldownTimer);
            cooldownTimer = null;
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }
  onCleanup(() => {
    if (cooldownTimer) clearInterval(cooldownTimer);
  });

  if (session()) {
    navigate(searchParams.next ?? '/', { replace: true });
  }

  function reset() {
    setError(null);
    setInfo(null);
  }

  async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<void> {
    reset();
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(translateDbError(err, `${label} fehlgeschlagen.`));
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    await withBusy('Google-Login', () => signInWithGoogle(searchParams.next));
  }
  async function onMicrosoft() {
    await withBusy('Microsoft-Login', () => signInWithMicrosoft(searchParams.next));
  }
  async function onGitHub() {
    await withBusy('GitHub-Login', () => signInWithGitHub(searchParams.next));
  }
  async function onLinkedIn() {
    await withBusy('LinkedIn-Login', () => signInWithLinkedIn(searchParams.next));
  }
  async function onMagicLink(e: Event) {
    e.preventDefault();
    if (!email().trim()) return;
    if (magicLinkCooldown() > 0) return;
    await withBusy('Magic-Link-Versand', async () => {
      await signInWithMagicLink(email().trim(), searchParams.next);
      setInfo(`Link gesendet an ${email().trim()}. Postfach (auch Spam) checken.`);
      startCooldown(30);
    });
  }
  async function onPasswordSubmit(e: Event) {
    e.preventDefault();
    const em = email().trim();
    const pw = password();
    if (!em) return;
    const sub = pwSub();
    if (sub === 'sign-in') {
      await withBusy('Anmeldung', () => signInWithPassword(em, pw));
    } else if (sub === 'sign-up') {
      await withBusy('Registrierung', async () => {
        await signUpWithPassword(em, pw, searchParams.next);
        setInfo(`Bestaetigungsmail an ${em} gesendet.`);
      });
    } else {
      await withBusy('Passwort-Reset', async () => {
        await requestPasswordReset(em);
        setInfo(`Reset-Link gesendet an ${em}.`);
      });
    }
  }

  return (
    <main class="login-page" ref={(el) => el?.classList.add('login-page-enter')}>
      <section class="login-card">
        <header class="login-head">
          <h1>Anmelden</h1>
          <p class="login-sub">
            Waehle eine Methode oder <A href="/signup">erstelle ein Konto</A>.
          </p>
        </header>

        <Show when={anySsoEnabled()}>
          <div class="login-sso">
            <Show when={googleEnabled()}>
              <button
                type="button"
                class="login-sso-btn lift"
                onClick={onGoogle}
                disabled={busy()}
                aria-label="Mit Google anmelden"
              >
                <span class="login-sso-icon" aria-hidden="true">
                  {/* Google G — Multi-Color, daher inline hier (Manifest-Ausnahme: brand-mark). */}
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 18 18"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <title>Google</title>
                    <path
                      fill="#4285F4"
                      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.72v2.26h2.9c1.7-1.56 2.69-3.86 2.69-6.62z"
                    />
                    <path
                      fill="#34A853"
                      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.34 0-4.32-1.58-5.03-3.71H.97v2.32A8.99 8.99 0 0 0 9 18z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M3.97 10.71A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.71V4.97H.97A8.99 8.99 0 0 0 0 9c0 1.45.35 2.83.97 4.03l3-2.32z"
                    />
                    <path
                      fill="#EA4335"
                      d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.95 8.95 0 0 0 9 0 8.99 8.99 0 0 0 .97 4.97l3 2.32C4.68 5.16 6.66 3.58 9 3.58z"
                    />
                  </svg>
                </span>
                Mit Google anmelden
              </button>
            </Show>
            <Show when={microsoftEnabled()}>
              <button
                type="button"
                class="login-sso-btn lift"
                onClick={onMicrosoft}
                disabled={busy()}
                aria-label="Mit Microsoft anmelden"
              >
                <span class="login-sso-icon" aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 18 18"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <title>Microsoft</title>
                    <path fill="#F25022" d="M0 0h8.5v8.5H0z" />
                    <path fill="#7FBA00" d="M9.5 0H18v8.5H9.5z" />
                    <path fill="#00A4EF" d="M0 9.5h8.5V18H0z" />
                    <path fill="#FFB900" d="M9.5 9.5H18V18H9.5z" />
                  </svg>
                </span>
                Mit Microsoft anmelden
              </button>
            </Show>
            <Show when={githubEnabled()}>
              <button
                type="button"
                class="login-sso-btn lift"
                onClick={onGitHub}
                disabled={busy()}
                aria-label="Mit GitHub anmelden"
              >
                <span class="login-sso-icon" aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <title>GitHub</title>
                    <path
                      fill="currentColor"
                      d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                    />
                  </svg>
                </span>
                Mit GitHub anmelden
              </button>
            </Show>
            <Show when={linkedinEnabled()}>
              <button
                type="button"
                class="login-sso-btn lift"
                onClick={onLinkedIn}
                disabled={busy()}
                aria-label="Mit LinkedIn anmelden"
              >
                <span class="login-sso-icon" aria-hidden="true">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <title>LinkedIn</title>
                    <path
                      fill="#0A66C2"
                      d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
                    />
                  </svg>
                </span>
                Mit LinkedIn anmelden
              </button>
            </Show>
          </div>
        </Show>

        <Show when={anySsoEnabled()}>
          <div class="login-divider" aria-hidden="true">
            <span>oder per Email</span>
          </div>
        </Show>

        <div class="login-tabs" role="tablist" aria-label="Email-Methode">
          <button
            type="button"
            role="tab"
            class="login-tab"
            classList={{ 'login-tab-active': mode() === 'password' }}
            aria-selected={mode() === 'password'}
            onClick={() => {
              setMode('password');
              reset();
            }}
          >
            Passwort
          </button>
          <button
            type="button"
            role="tab"
            class="login-tab"
            classList={{ 'login-tab-active': mode() === 'magic-link' }}
            aria-selected={mode() === 'magic-link'}
            onClick={() => {
              setMode('magic-link');
              reset();
            }}
          >
            Magic-Link
          </button>
        </div>

        <Show when={mode() === 'password'}>
          <form class="login-form" onSubmit={onPasswordSubmit}>
            <label class="login-field">
              <span>E-Mail</span>
              <input
                type="email"
                required
                autocomplete="email"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                disabled={busy()}
                class="input"
              />
            </label>
            <Show when={pwSub() !== 'reset'}>
              <label class="login-field">
                <span>Passwort</span>
                <input
                  type="password"
                  required
                  autocomplete={pwSub() === 'sign-in' ? 'current-password' : 'new-password'}
                  minLength={8}
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  disabled={busy()}
                  class="input"
                />
              </label>
            </Show>
            <button type="submit" class="btn btn-primary lift" disabled={busy()}>
              {pwSub() === 'sign-in' && 'Anmelden'}
              {pwSub() === 'sign-up' && 'Registrieren'}
              {pwSub() === 'reset' && 'Reset-Link senden'}
            </button>
            <div class="login-pw-actions">
              <button type="button" class="btn-link" onClick={() => setPwSub('sign-up')}>
                Noch kein Account?
              </button>
              <button type="button" class="btn-link" onClick={() => setPwSub('reset')}>
                Passwort vergessen?
              </button>
              <Show when={pwSub() !== 'sign-in'}>
                <button type="button" class="btn-link" onClick={() => setPwSub('sign-in')}>
                  Zurueck zu Anmelden
                </button>
              </Show>
            </div>
          </form>
        </Show>

        <Show when={mode() === 'magic-link'}>
          <form class="login-form" onSubmit={onMagicLink}>
            <label class="login-field">
              <span>E-Mail</span>
              <input
                type="email"
                required
                autocomplete="email"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                disabled={busy()}
                class="input"
              />
            </label>
            <button
              type="submit"
              class="btn btn-primary lift"
              disabled={busy() || magicLinkCooldown() > 0}
            >
              <Show when={magicLinkCooldown() > 0} fallback="Magic-Link senden">
                Erneut in {magicLinkCooldown()}s
              </Show>
            </button>
            <p class="hint">Du bekommst einen einmaligen Anmelde-Link per Mail.</p>
          </form>
        </Show>

        <Show when={info()}>
          {/* biome-ignore lint/a11y/useSemanticElements: <p role="status"> bewusst — wir wollen einen Block-Container mit Live-Region. <output> waere ein Inline-Element + setzt onChange-Semantik die wir nicht brauchen. */}
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

export default Login;
