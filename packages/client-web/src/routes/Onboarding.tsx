// /onboarding — Route fuer den Initial-Onboarding-Pfad (A.4b).
//
// Liest workspaceId aus Query-Param ?ws=<uuid>. Wenn nicht gesetzt:
// fallt zurueck auf "ersten Workspace des Users" via fetchMyWorkspaces.
// Wenn gar keiner: redirect zu /login (Account-State broken).
//
// Re-Run-Pfad (Wizard fuer "Neuer Workspace") laeuft NICHT ueber diese
// Route — der oeffnet den WizardShell direkt als Modal in Workspace.tsx
// (kommt mit A.4d).

import { useNavigate, useSearchParams } from '@solidjs/router';
import { type Component, Show, createResource } from 'solid-js';
import WizardShell from '../components/wizard/WizardShell';
import { useUser } from '../lib/auth';
import { fetchMyWorkspaces } from '../lib/queries';

const Onboarding: Component = () => {
  const user = useUser();
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const [resolved] = createResource<string | null, string | null>(
    () => user()?.id ?? null,
    async (uid) => {
      if (!uid) return null;
      const fromQuery = typeof search.ws === 'string' ? search.ws : null;
      if (fromQuery) return fromQuery;
      try {
        const list = await fetchMyWorkspaces();
        if (list.length === 0) {
          // Kein Workspace + Onboarding aufgerufen → Redirect home,
          // App.tsx-Gate handhabt den Rest.
          navigate('/', { replace: true });
          return null;
        }
        return list[0]?.id ?? null;
      } catch (err) {
        console.error('Onboarding fetchMyWorkspaces:', err);
        navigate('/', { replace: true });
        return null;
      }
    },
  );

  return (
    <Show when={resolved()} fallback={<p class="boot">Lade Onboarding…</p>}>
      {(wsId) => <WizardShell source={{ kind: 'initial', workspaceId: wsId() }} />}
    </Show>
  );
};

export default Onboarding;
