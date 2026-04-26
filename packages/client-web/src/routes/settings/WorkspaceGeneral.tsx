// Settings → Workspace → Allgemein. Phase 1 (P1.A) Skeleton, P1.A.4-Polish.
//
// Zeigt Workspace-Stammdaten + Owner + Mitglieder-Zaehler. Edit-Pfad
// (Name, Default-Role, Slug fuer /w/<slug>) kommt in P1.B/C oder spaeter,
// gemeinsam mit dem Lifecycle-Modul (Workspace loeschen, Eigentum
// uebertragen).

import { useParams } from '@solidjs/router';
import { Show, createResource } from 'solid-js';
import { useSession } from '../../lib/auth';
import { fetchMembers } from '../../lib/members';
import { fetchMyWorkspaces } from '../../lib/queries';

const WorkspaceGeneral = () => {
  const params = useParams<{ workspaceId: string }>();
  const session = useSession();
  const [workspaces] = createResource(
    () => session()?.user?.id ?? null,
    () => fetchMyWorkspaces(),
  );
  const current = () => workspaces()?.find((w) => w.id === params.workspaceId);

  const [members] = createResource(
    () => params.workspaceId,
    async (wsId) => {
      try {
        return await fetchMembers(wsId);
      } catch {
        return [];
      }
    },
  );

  const ownerEmail = () => {
    // Wenn aus get_workspace_owners-RPC bekannt: nutzen.
    const fromRpc = current()?.owner_email;
    if (fromRpc) return fromRpc;
    // Fallback: aus Members-Liste den Owner finden.
    return members()?.find((m) => m.role === 'owner')?.email ?? null;
  };

  const memberCount = () =>
    members()?.filter((m) => !('deactivated_at' in m && m.deactivated_at)).length ?? 0;

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
            <dt>Owner</dt>
            <dd>
              <Show when={ownerEmail()} fallback={<span class="hint">unbekannt</span>}>
                <code class="settings-readback">{ownerEmail()}</code>
              </Show>
            </dd>
            <dt>Mitglieder</dt>
            <dd>
              <code class="settings-readback">{memberCount()}</code>
            </dd>
            <dt>Deine Rolle</dt>
            <dd>
              <span class={`settings-role-chip role-${ws().role}`}>{ws().role}</span>
            </dd>
            <dt>Workspace-ID</dt>
            <dd>
              <code class="settings-readback settings-readback-mono">{ws().id}</code>
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
