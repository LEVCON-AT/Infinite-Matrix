// /invite/:token — Phase 1 (P1.A).
//
// Token aus URL ziehen, redeem_invite-RPC aufrufen, bei Erfolg in den
// neu betretenen Workspace navigieren.
//
// Login-Flow: ohne Session bypassen wir hier den globalen Route-Guard
// nicht (App.tsx wuerde das URL-Token wegspuelen). Wir merken uns den
// Token in sessionStorage, schicken den User zu /login, und nach
// erfolgreichem Magic-Link-Login fischt App.tsx den Token wieder
// raus + navigiert hierher zurueck.

import { useNavigate, useParams } from '@solidjs/router';
import { Show, createResource, onMount } from 'solid-js';
import Icon from '../components/Icon';
import { useSession } from '../lib/auth';
import { translateDbError } from '../lib/errors';
import { redeemInvite, translateInviteError } from '../lib/invites';
import { showToast } from '../lib/toasts';

export const PENDING_INVITE_KEY = 'matrix:pending-invite-token';

const Invite = () => {
  const params = useParams<{ token: string }>();
  const navigate = useNavigate();
  const session = useSession();

  // Wenn ohne Session geoeffnet: Token zwischenparken + zu /login.
  // App.tsx greift den Token nach Login wieder auf.
  onMount(() => {
    if (!session() && params.token) {
      try {
        sessionStorage.setItem(PENDING_INVITE_KEY, params.token);
      } catch {
        // sessionStorage gesperrt (Privacy-Mode) — User muss den Link
        // nach Login neu klicken. Nicht fatal.
      }
      navigate('/login', { replace: true });
    }
  });

  const [result] = createResource(
    () => (session() && params.token ? params.token : null),
    async (token) => {
      try {
        const res = await redeemInvite(token);
        // Token aus Storage raeumen falls noch da.
        try {
          sessionStorage.removeItem(PENDING_INVITE_KEY);
        } catch {
          // ignore
        }
        showToast(`Workspace betreten als ${res.role}.`, 'success');
        // Kurzer Delay, damit der Toast sichtbar ist, dann ab in den
        // neuen Workspace.
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
                      <button
                        type="button"
                        class="btn-c"
                        onClick={() => navigate('/', { replace: true })}
                      >
                        Zur Workspace-Auswahl
                      </button>
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
          <div class="invite-state">
            <Icon name="envelope" size={20} />
            <h1>Login erforderlich</h1>
            <p class="hint">
              Um die Einladung anzunehmen, melde dich bitte an. Wir merken uns den Link automatisch
              und nehmen die Einladung nach dem Login an.
            </p>
          </div>
        </Show>
      </div>
    </section>
  );
};

export default Invite;
