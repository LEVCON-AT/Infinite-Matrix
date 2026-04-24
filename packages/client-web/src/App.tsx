import { Show, createEffect, type JSX, type ParentComponent } from 'solid-js';
import { useLocation, useNavigate } from '@solidjs/router';
import { bootstrapAuth, useAuthReady, useSession } from './lib/auth';
import { useEditModeHotkey } from './lib/edit-mode';
import { useThemeBootstrap } from './lib/theme';
import Toasts from './components/Toasts';
import DialogHost from './components/DialogHost';

bootstrapAuth();

const App: ParentComponent = (props): JSX.Element => {
  const ready = useAuthReady();
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();

  useEditModeHotkey();
  useThemeBootstrap();

  // Route-Guard: ohne Session -> /login, mit Session auf /login -> /
  createEffect(() => {
    if (!ready()) return;
    const onLogin = location.pathname === '/login';
    if (!session() && !onLogin) {
      navigate('/login', { replace: true });
    } else if (session() && onLogin) {
      navigate('/', { replace: true });
    }
  });

  return (
    <div class="app-shell">
      <Show when={ready()} fallback={<p class="boot">Lade…</p>}>
        {props.children}
      </Show>
      <Toasts />
      <DialogHost />
    </div>
  );
};

export default App;
