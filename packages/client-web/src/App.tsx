import { Show, createEffect, type JSX, type ParentComponent } from 'solid-js';
import { useLocation, useNavigate } from '@solidjs/router';
import { bootstrapAuth, useAuthReady, useSession } from './lib/auth';

bootstrapAuth();

const App: ParentComponent = (props): JSX.Element => {
  const ready = useAuthReady();
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();

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
    </div>
  );
};

export default App;
