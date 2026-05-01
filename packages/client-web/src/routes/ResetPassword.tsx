// ResetPassword-Page (B.1.D).
//
// Landing-Page nach Klick auf den Reset-Link aus der E-Mail. Supabase
// liefert eine PASSWORD_RECOVERY-Session (eingeloggt mit eingeschraenkter
// Berechtigung). User setzt neues Passwort, danach Redirect zum Login
// oder direkt zum Workspace.
//
// Sicherheits-Hinweise:
//   - Session ist erst nach updateUser({password}) voll-priviligiert.
//   - Bei abgelaufenem/gefaelschtem Token kommt onAuthStateChange NICHT
//     mit PASSWORD_RECOVERY → wir zeigen Fehler-Banner.

import { useNavigate } from '@solidjs/router';
import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { updatePassword } from '../lib/auth';
import { translateDbError } from '../lib/errors';
import { supabase } from '../lib/supabase';

const ResetPassword: Component = () => {
  const navigate = useNavigate();

  const [recoveryReady, setRecoveryReady] = createSignal<'pending' | 'ok' | 'invalid'>('pending');
  const [pw1, setPw1] = createSignal('');
  const [pw2, setPw2] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    // Supabase-JS detected den Hash-Token in der URL automatisch und
    // feuert PASSWORD_RECOVERY beim Mount. Plus: bestaetigte Session
    // ist im aktuellen Speicher — wir koennen das auch via getSession
    // pruefen.
    const sub = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryReady('ok');
    });
    // Falls Page direkt geoeffnet wird (kein Hash) und Session fehlt:
    // nach 800ms als invalid markieren.
    const timer = setTimeout(() => {
      void (async () => {
        const { data } = await supabase.auth.getSession();
        if (recoveryReady() === 'pending') {
          // Wenn keine Session UND kein PASSWORD_RECOVERY → invalid.
          setRecoveryReady(data.session ? 'ok' : 'invalid');
        }
      })();
    }, 800);
    onCleanup(() => {
      sub.data.subscription.unsubscribe();
      clearTimeout(timer);
    });
  });

  async function onSubmit(e: Event) {
    e.preventDefault();
    setError(null);
    if (pw1().length < 8) {
      setError('Passwort muss mindestens 8 Zeichen haben.');
      return;
    }
    if (pw1() !== pw2()) {
      setError('Passwoerter stimmen nicht ueberein.');
      return;
    }
    setBusy(true);
    try {
      await updatePassword(pw1());
      // Nach Erfolg ist Session voll-privilegiert → direkt rein.
      navigate('/', { replace: true });
    } catch (err) {
      setError(translateDbError(err, 'Passwort-Aenderung fehlgeschlagen.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="login-page" ref={(el) => el?.classList.add('login-page-enter')}>
      <section class="login-card">
        <header class="login-head">
          <h1>Neues Passwort</h1>
          <p class="login-sub">Setze ein neues Passwort fuer dein Konto.</p>
        </header>

        <Show when={recoveryReady() === 'pending'}>
          <p class="hint">Pruefe Reset-Link…</p>
        </Show>

        <Show when={recoveryReady() === 'invalid'}>
          {/* biome-ignore lint/a11y/useSemanticElements: <p role="alert"> bewusst. */}
          <p class="login-error" role="alert">
            Reset-Link ist ungueltig oder abgelaufen. Bitte fordere einen neuen Link an.
          </p>
          <button type="button" class="btn btn-subtle" onClick={() => navigate('/login')}>
            Zur Login-Seite
          </button>
        </Show>

        <Show when={recoveryReady() === 'ok'}>
          <form class="login-form" onSubmit={onSubmit}>
            <label class="login-field">
              <span>Neues Passwort</span>
              <input
                class="input"
                type="password"
                required
                autocomplete="new-password"
                minLength={8}
                value={pw1()}
                onInput={(e) => setPw1(e.currentTarget.value)}
                disabled={busy()}
                autofocus
              />
            </label>
            <label class="login-field">
              <span>Passwort bestaetigen</span>
              <input
                class="input"
                type="password"
                required
                autocomplete="new-password"
                minLength={8}
                value={pw2()}
                onInput={(e) => setPw2(e.currentTarget.value)}
                disabled={busy()}
              />
            </label>
            <button type="submit" class="btn btn-primary lift" disabled={busy()}>
              Passwort speichern
            </button>
            <Show when={error()}>
              {/* biome-ignore lint/a11y/useSemanticElements: <p role="alert"> bewusst. */}
              <p class="login-error" role="alert">
                {error()}
              </p>
            </Show>
          </form>
        </Show>
      </section>
    </main>
  );
};

export default ResetPassword;
