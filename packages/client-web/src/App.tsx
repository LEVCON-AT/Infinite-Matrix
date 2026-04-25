import { useLocation, useNavigate } from '@solidjs/router';
import { type JSX, type ParentComponent, Show, createEffect } from 'solid-js';
import DialogHost from './components/DialogHost';
import ProgressOverlay from './components/ProgressOverlay';
import Toasts from './components/Toasts';
import { bootstrapAuth, useAuthReady, useSession } from './lib/auth';
import { useEditModeHotkey } from './lib/edit-mode';
import { useThemeBootstrap } from './lib/theme';
import { PENDING_INVITE_KEY } from './routes/Invite';

bootstrapAuth();

// Routen, die der globale Auth-Guard nicht zwingend redirecten soll.
// /invite/:token bleibt aufrufbar — die Page selbst handhabt den
// Login-Redirect mit Token-Memorierung in sessionStorage.
function isPublicRoute(pathname: string): boolean {
  return pathname === '/login' || pathname.startsWith('/invite/');
}

const App: ParentComponent = (props): JSX.Element => {
  const ready = useAuthReady();
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();

  useEditModeHotkey();
  useThemeBootstrap();

  // Route-Guard: ohne Session -> /login (ausser auf public-Routen),
  // mit Session auf /login -> Pending-Invite-Redeem oder /.
  createEffect(() => {
    if (!ready()) return;
    const path = location.pathname;
    const onLogin = path === '/login';
    if (!session() && !isPublicRoute(path)) {
      navigate('/login', { replace: true });
      return;
    }
    if (session() && onLogin) {
      // Falls /invite/:token zwischengeparkt wurde, den nach Login
      // wieder anspringen. Ein Re-Klick auf den Mail-Link waere sonst
      // noetig.
      let pending: string | null = null;
      try {
        pending = sessionStorage.getItem(PENDING_INVITE_KEY);
      } catch {
        pending = null;
      }
      if (pending) {
        navigate(`/invite/${encodeURIComponent(pending)}`, { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    }
  });

  return (
    <div class="app-shell">
      <Show when={ready()} fallback={<p class="boot">Lade…</p>}>
        {props.children}
      </Show>
      <Toasts />
      <DialogHost />
      <ProgressOverlay />
    </div>
  );
};

export default App;
