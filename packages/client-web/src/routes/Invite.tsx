// /invite/:token — Phase 1 (P1.A.3).
//
// Token aus URL ziehen, redeem_invite-RPC aufrufen, bei Erfolg in den
// neu betretenen Workspace navigieren.
//
// Login-Flow: ohne Session zeigen wir eine Inline-Magic-Link-Form, die
// den Mail-Link mit emailRedirectTo=/app/invite/<token> ausstellt — der
// Klick im Postfach landet damit direkt wieder hier, mit aktiver
// Session, und der Redeem laeuft automatisch durch.
//
// Fallback fuer "User landet auf /login statt hier": wir merken den
// Token in sessionStorage; App.tsx fischt ihn nach Login wieder raus.

import { useNavigate, useParams } from '@solidjs/router';
import { Show, createResource, createSignal, onMount } from 'solid-js';
import Icon from '../components/Icon';
import { signInWithMagicLink, signOut, useSession } from '../lib/auth';
import { translateDbError } from '../lib/errors';
import { redeemInvite, translateInviteError } from '../lib/invites';
import { showToast } from '../lib/toasts';

export const PENDING_INVITE_KEY = 'matrix:pending-invite-token';

const Invite = () => {
  const params = useParams<{ token: string }>();
  const navigate = useNavigate();
  const session = useSession();

  const [email, setEmail] = createSignal('');
  const [magicStatus, setMagicStatus] = createSignal<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [magicError, setMagicError] = createSignal<string | null>(null);

  // Token in sessionStorage zwischenparken — falls der User aus dem
  // Mail-Link zwar logged-in zurueckkommt, aber irgendwann auf /login
  // umgeleitet wurde, kann App.tsx den Token wiederfinden.
  onMount(() => {
    if (params.token && !session()) {
      try {
        sessionStorage.setItem(PENDING_INVITE_KEY, params.token);
      } catch {
        // sessionStorage gesperrt (Privacy-Mode) — User muss den Mail-
        // Link halt erneut aus dem Postfach klicken. Nicht fatal.
      }
    }
  });

  const [result] = createResource(
    () => (session() && params.token ? params.token : null),
    async (token) => {
      try {
        const res = await redeemInvite(token);
        try {
          sessionStorage.removeItem(PENDING_INVITE_KEY);
        } catch {
          // ignore
        }
        showToast(`Workspace betreten als ${res.role}.`, 'success');
        window.setTimeout(() => {
          navigate(`/w/${res.workspace_id}`, { replace: true });
        }, 600);
        return { kind: 'ok' as const, role: res.role, workspaceId: res.workspace_id };
      } catch (err) {
        const msg = translateInviteError(
          err,
          translateDbError(err, 'Einladung konnte nicht eingeloest werden.'),
        );
        showToast(msg, 'error');
        return { kind: 'err' as const, message: msg };
      }
    },
  );

  const sendMagicLink = async (e: Event) => {
    e.preventDefault();
    const v = email().trim();
    if (!v) return;
    setMagicStatus('sending');
    setMagicError(null);
    try {
      // emailRedirectTo so setzen, dass der Mail-Link wieder hier landet.
      // Token aus dem URL-Param uebernehmen; encodeURIComponent ist nicht
      // noetig (urlsafe-base64 enthaelt nur a-zA-Z0-9_-).
      await signInWithMagicLink(v, `invite/${params.token}`);
      setMagicStatus('sent');
    } catch (err) {
      setMagicStatus('error');
      setMagicError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    }
  };

  return (
    <section class="invite-page">
      <div class="invite-card">
        <Show
          when={!session()}
          fallback={
            <Show
              when={result()}
              fallback={
                <div class="invite-state">
                  <Icon name="arrow-path" size={20} />
                  <h1>Einladung wird eingeloest…</h1>
                  <p class="hint">Einen Moment, bitte.</p>
                </div>
              }
            >
              {(r) => (
                <Show
                  when={r().kind === 'ok'}
                  fallback={
                    <div class="invite-state invite-state-err">
                      <Icon name="x-circle" size={24} />
                      <h1>Einladung ungueltig</h1>
                      <p class="hint">{r().kind === 'err' ? r().message : 'Unbekannter Fehler.'}</p>
                      <div class="invite-action-row">
                        <button
                          type="button"
                          class="btn-c"
                          onClick={() => {
                            void (async () => {
                              try {
                                await signOut();
                              } catch {
                                // Logout darf nicht blocken — auch ohne sauberen
                                // signOut den Token zwischenparken + zur Login-
                                // Page schicken.
                              }
                              try {
                                sessionStorage.setItem('matrix:pending-invite-token', params.token);
                              } catch {
                                // ignore
                              }
                              navigate('/login', { replace: true });
                            })();
                          }}
                        >
                          <Icon name="arrow-uturn-left" size={14} />
                          <span>Mit anderer E-Mail anmelden</span>
                        </button>
                        <button
                          type="button"
                          class="btn-subtle"
                          onClick={() => navigate('/', { replace: true })}
                        >
                          Zur Workspace-Auswahl
                        </button>
                      </div>
                    </div>
                  }
                >
                  <div class="invite-state invite-state-ok">
                    <Icon name="check-circle" size={24} />
                    <h1>Einladung angenommen</h1>
                    <p class="hint">Du wirst gleich in den Workspace weitergeleitet.</p>
                  </div>
                </Show>
              )}
            </Show>
          }
        >
          <Show
            when={magicStatus() === 'sent'}
            fallback={
              <div class="invite-state">
                <Icon name="envelope" size={20} />
                <h1>Einladung annehmen</h1>
                <p class="hint">
                  Trag deine E-Mail ein. Wir schicken dir einen Magic-Link, der dich direkt nach dem
                  Klick im Postfach in den Workspace bringt.
                </p>
                <form class="invite-magic-form" onSubmit={(e) => void sendMagicLink(e)}>
                  <label class="invite-form-field invite-form-field-grow">
                    <span class="invite-form-label">E-Mail</span>
                    <input
                      type="email"
                      class="invite-form-input"
                      value={email()}
                      onInput={(e) => setEmail(e.currentTarget.value)}
                      placeholder="name@beispiel.at"
                      autocomplete="email"
                      required
                      disabled={magicStatus() === 'sending'}
                    />
                  </label>
                  <button
                    type="submit"
                    class="btn-c"
                    disabled={magicStatus() === 'sending' || !email().trim()}
                  >
                    {magicStatus() === 'sending' ? 'Sende Link…' : 'Magic-Link senden'}
                  </button>
                  <Show when={magicStatus() === 'error' && magicError()}>
                    <p class="error">{magicError()}</p>
                  </Show>
                </form>
              </div>
            }
          >
            <div class="invite-state invite-state-ok">
              <Icon name="envelope" size={24} />
              <h1>Mail gesendet</h1>
              <p class="hint">
                Postfach checken, Link klicken, fertig — du landest danach direkt im neuen
                Workspace.
              </p>
            </div>
          </Show>
        </Show>
      </div>
    </section>
  );
};

export default Invite;
