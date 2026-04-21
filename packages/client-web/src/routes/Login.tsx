import { createSignal, Show, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { signInWithMagicLink, useSession } from '../lib/auth';

const Login: Component = () => {
  const navigate = useNavigate();
  const session = useSession();
  const [email, setEmail] = createSignal('');
  const [status, setStatus] = createSignal<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = createSignal<string | null>(null);

  // Falls bereits eingeloggt: direkt weiter.
  if (session()) {
    navigate('/', { replace: true });
  }

  async function onSubmit(e: Event) {
    e.preventDefault();
    const value = email().trim();
    if (!value) return;
    setStatus('sending');
    setError(null);
    try {
      await signInWithMagicLink(value);
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    }
  }

  return (
    <section class="login">
      <h1>Anmeldung</h1>

      <Show when={status() !== 'sent'}>
        <form onSubmit={onSubmit}>
          <label>
            E-Mail
            <input
              type="email"
              required
              autocomplete="email"
              autofocus
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              disabled={status() === 'sending'}
            />
          </label>

          <button type="submit" disabled={status() === 'sending'}>
            {status() === 'sending' ? 'Sende Link…' : 'Magic-Link senden'}
          </button>

          <Show when={error()}>
            <p class="error">{error()}</p>
          </Show>
        </form>
      </Show>

      <Show when={status() === 'sent'}>
        <p class="ok">
          Link gesendet an <strong>{email()}</strong>. Postfach checken, Link klicken, fertig.
        </p>
      </Show>
    </section>
  );
};

export default Login;
