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
import { type Component, Show, createMemo, createResource } from 'solid-js';
import WizardShell from '../components/wizard/WizardShell';
import { useUser } from '../lib/auth';
import { fetchMyWorkspaces } from '../lib/queries';
import type { WizardSource } from '../lib/wizard-state';

const Onboarding: Component = () => {
  const user = useUser();
  const [search] = useSearchParams();
  const navigate = useNavigate();

  // ?fresh=1 → Re-Run-Pfad: createWorkspace im Apply-Step (kind:'new').
  // Sonst: Initial-Pfad mit existing default-workspace.
  const isFresh = createMemo(() => search.fresh === '1');

  const [resolved] = createResource<WizardSource | null, { uid: string | null; fresh: boolean }>(
    () => ({ uid: user()?.id ?? null, fresh: isFresh() }),
    async ({ uid, fresh }) => {
      if (!uid) return null;
      if (fresh) {
        return { kind: 'new', pendingName: 'Neuer Workspace' };
      }
      const fromQuery = typeof search.ws === 'string' && search.ws ? search.ws : null;
      if (fromQuery) return { kind: 'initial', workspaceId: fromQuery };
      try {
        const list = await fetchMyWorkspaces();
        if (list.length === 0) {
          navigate('/', { replace: true });
          return null;
        }
        const wsId = list[0]?.id;
        return wsId ? { kind: 'initial', workspaceId: wsId } : null;
      } catch (err) {
        console.error('Onboarding fetchMyWorkspaces:', err);
        navigate('/', { replace: true });
        return null;
      }
    },
  );

  return (
    <Show when={resolved()} fallback={<p class="boot">Lade Onboarding…</p>}>
      {(src) => <WizardShell source={src()} />}
    </Show>
  );
};

export default Onboarding;
