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

import { useNavigate, useSearchParams } from '@solidjs/router';
import { type Component, Show, createSignal } from 'solid-js';
import {
  requestPasswordReset,
  signInWithGoogle,
  signInWithMagicLink,
  signInWithMicrosoft,
  signInWithPassword,
  signUpWithPassword,
  useSession,
} from '../lib/auth';
import { translateDbError } from '../lib/errors';

type Mode = 'magic-link' | 'password';
type PasswordSubMode = 'sign-in' | 'sign-up' | 'reset';

const Login: Component = () => {
  const navigate = useNavigate();
  const session = useSession();
  const [searchParams] = useSearchParams<{ next?: string }>();

  const [mode, setMode] = createSignal<Mode>('password');
  const [pwSub, setPwSub] = createSignal<PasswordSubMode>('sign-in');
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [info, setInfo] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);

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
  async function onMagicLink(e: Event) {
    e.preventDefault();
    if (!email().trim()) return;
    await withBusy('Magic-Link-Versand', async () => {
      await signInWithMagicLink(email().trim(), searchParams.next);
      setInfo(`Link gesendet an ${email().trim()}. Postfach checken.`);
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
          <p class="login-sub">Waehle eine Methode</p>
        </header>

        <div class="login-sso">
          <button
            type="button"
            class="login-sso-btn lift"
            onClick={onGoogle}
            disabled={busy()}
            aria-label="Mit Google anmelden"
          >
            <span class="login-sso-icon" aria-hidden="true">
              {/* Google G — Multi-Color, daher inline hier (Manifest-Ausnahme: brand-mark). */}
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
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
          <button
            type="button"
            class="login-sso-btn lift"
            onClick={onMicrosoft}
            disabled={busy()}
            aria-label="Mit Microsoft anmelden"
          >
            <span class="login-sso-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <title>Microsoft</title>
                <path fill="#F25022" d="M0 0h8.5v8.5H0z" />
                <path fill="#7FBA00" d="M9.5 0H18v8.5H9.5z" />
                <path fill="#00A4EF" d="M0 9.5h8.5V18H0z" />
                <path fill="#FFB900" d="M9.5 9.5H18V18H9.5z" />
              </svg>
            </span>
            Mit Microsoft anmelden
          </button>
        </div>

        <div class="login-divider" aria-hidden="true">
          <span>oder per Email</span>
        </div>

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
            <button type="submit" class="btn btn-primary lift" disabled={busy()}>
              Magic-Link senden
            </button>
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
