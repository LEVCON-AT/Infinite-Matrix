import { Show, type Component } from 'solid-js';
import { signOut, useUser } from '../lib/auth';

const Workspace: Component = () => {
  const user = useUser();

  async function onLogout() {
    await signOut();
  }

  return (
    <section class="workspace">
      <header class="ws-header">
        <h1>Workspace</h1>
        <Show when={user()}>
          <div class="ws-user">
            <span class="ws-email">{user()?.email}</span>
            <button type="button" onClick={onLogout}>
              Abmelden
            </button>
          </div>
        </Show>
      </header>
      <p>Tree + Matrix + Board folgen ab 0d.3.</p>
    </section>
  );
};

export default Workspace;
