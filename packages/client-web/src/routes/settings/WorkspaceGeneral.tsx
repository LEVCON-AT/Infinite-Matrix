// Settings → Workspace → Allgemein. Phase 1 (P1.A) Skeleton.
//
// Aktuell read-only: Workspace-Name + ID. Edit-Pfad (Name, Default-
// Role, Slug fuer /w/<slug>) kommt in P1.B/C oder spaeter, gemeinsam
// mit dem Lifecycle-Modul (Workspace loeschen, Eigentum uebertragen).

import { useParams } from '@solidjs/router';
import { Show, createResource } from 'solid-js';
import { useSession } from '../../lib/auth';
import { fetchMyWorkspaces } from '../../lib/queries';

const WorkspaceGeneral = () => {
  const params = useParams<{ workspaceId: string }>();
  const session = useSession();
  const [workspaces] = createResource(
    () => session()?.user?.id ?? null,
    () => fetchMyWorkspaces(),
  );
  const current = () => workspaces()?.find((w) => w.id === params.workspaceId);

  return (
    <article class="settings-pane">
      <header class="settings-pane-head">
        <h2>Allgemein</h2>
        <p class="hint">
          Workspace-Stammdaten. Edit + Loeschen + Eigentumsuebertragung kommen in einer kuenftigen
          Phase.
        </p>
      </header>
      <Show
        when={current()}
        fallback={<p class="settings-empty">Workspace nicht gefunden oder nicht zugaenglich.</p>}
      >
        {(ws) => (
          <dl class="settings-form-grid">
            <dt>Name</dt>
            <dd>
              <code class="settings-readback">{ws().name}</code>
            </dd>
            <dt>Workspace-ID</dt>
            <dd>
              <code class="settings-readback settings-readback-mono">{ws().id}</code>
            </dd>
            <dt>Deine Rolle</dt>
            <dd>
              <span class={`settings-role-chip role-${ws().role}`}>{ws().role}</span>
            </dd>
            <dt>Erstellt</dt>
            <dd>
              <code class="settings-readback">{new Date(ws().created_at).toLocaleString()}</code>
            </dd>
          </dl>
        )}
      </Show>
    </article>
  );
};

export default WorkspaceGeneral;
