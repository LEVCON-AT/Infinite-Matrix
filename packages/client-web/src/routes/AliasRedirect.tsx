// §14.1 V1 — Alias-Resolve-Route /r/:workspaceId/:alias.
//
// SPA-Route fuer Extern-Drop-URLs (lib/drag-context.ts buildExternalDragUrl).
// Zieht Alias + WorkspaceId aus den URL-Params, ruft resolveAlias + dispatch-
// AliasResult, navigiert auf das Ziel. Auth-Guard in App.tsx schickt nicht-
// eingeloggte User auf /login (V1-Compromise — next-Param + Slug-URL kommen
// V2 mit Public-Token-Sharing in §14.2).
//
// Member-only-Pflicht (Konzept §14.1) wird durch RLS in resolveAlias-Queries
// erzwungen: Non-Member sehen die Alias-Targets schlicht nicht — Resolve
// kommt mit „nicht gefunden" zurueck (kein Hint auf Existenz).
//
// Render-Pfad:
//   1. „Auflöse…"-Stub waehrend resolveAlias laeuft (createResource).
//   2. Erfolg: dispatchAliasResult navigiert auf die Cell/Karte/Doc/Link-
//      Route. Komponente unmountet sich danach selbst.
//   3. Fehler: showToast + navigate auf Workspace-Root.

import { useNavigate, useParams } from '@solidjs/router';
import { Show, createEffect, createResource } from 'solid-js';
import Icon from '../components/Icon';
import { dispatchAliasResult } from '../lib/alias-dispatch';
import { resolveAlias } from '../lib/alias-resolve';
import { showToast } from '../lib/toasts';

const AliasRedirect = () => {
  const params = useParams<{ workspaceId: string; alias: string }>();
  const navigate = useNavigate();

  const [outcome] = createResource(
    () => (params.workspaceId && params.alias ? params : null),
    async (p) => {
      if (!p) return null;
      return resolveAlias(p.alias, p.workspaceId);
    },
  );

  // Erfolg/Fehler-Branch: Solid-Effect feuert sobald die Resource fertig ist.
  // Bei Erfolg dispatchen wir + lassen Navigate die Route wechseln (Component
  // unmountet sich). Bei Fehler Toast + Workspace-Root.
  createEffect(() => {
    const o = outcome();
    if (!o) return;
    if (o.ok) {
      dispatchAliasResult(o.result, {
        workspaceId: params.workspaceId,
        navigate,
        onError: (msg) => {
          showToast(msg, 'error');
          navigate(`/w/${params.workspaceId}`, { replace: true });
        },
      });
      return;
    }
    showToast(o.msg, 'error');
    navigate(`/w/${params.workspaceId}`, { replace: true });
  });

  return (
    <output class="alias-redirect-shell" aria-live="polite">
      <Show
        when={!outcome.loading}
        fallback={
          <div class="alias-redirect-card">
            <Icon name="link" size={20} />
            <span>Loese ^{params.alias} auf …</span>
          </div>
        }
      >
        <div class="alias-redirect-card">
          <Icon name="check-circle" size={20} />
          <span>Weiterleitung …</span>
        </div>
      </Show>
    </output>
  );
};

export default AliasRedirect;
