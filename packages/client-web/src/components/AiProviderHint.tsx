// AiProviderHint — Phase 2 Welle A.0.
//
// Persistent-Hint: solange der eingeloggte User keinen Default-AI-
// Provider hinterlegt hat, blendet sich ein dezenter Banner unten ein
// mit Hinweis + "Einrichten"-Button. Nach Save (oder Auswahl eines
// Defaults) verschwindet er automatisch.
//
// Sanft aber deutlich: dismissible NUR per Session (sessionStorage),
// kommt nach Reload zurueck. Permanent verbergen ist nicht vorgesehen
// — wer KI-Hilfe nicht will, kann nicht "wegklicken-und-vergessen",
// sondern muesste den Workspace ohne KI nutzen. Bewusste Reibung.

import { useNavigate, useParams } from '@solidjs/router';
import { type Component, Show, createSignal } from 'solid-js';
import { useHasDefaultProvider } from '../lib/ai-providers';
import { useUser } from '../lib/auth';
import Icon from './Icon';

const SESSION_DISMISS_KEY = 'ai-provider-hint-dismissed';

const AiProviderHint: Component = () => {
  const user = useUser();
  const hasDefault = useHasDefaultProvider();
  const params = useParams<{ workspaceId?: string }>();
  const navigate = useNavigate();

  const [dismissed, setDismissed] = createSignal(
    typeof sessionStorage !== 'undefined' && sessionStorage.getItem(SESSION_DISMISS_KEY) === '1',
  );

  const visible = () => {
    if (!user()) return false;
    if (hasDefault()) return false;
    if (dismissed()) return false;
    return true;
  };

  const onDismiss = () => {
    try {
      sessionStorage.setItem(SESSION_DISMISS_KEY, '1');
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  const onConfigure = () => {
    // Wenn wir gerade in einem Workspace sind, route auf den AI-Tab
    // dort. Sonst: erste Workspace-URL muesste der Layout-Wrapper
    // mitliefern — fallback auf /login waere falsch. Wir lesen die
    // workspaceId aus params; wenn keine vorhanden (z.B. /login),
    // bleibt der Hint dort eh nicht stehen (visible-Check oben).
    const wsId = params.workspaceId;
    if (wsId) {
      navigate(`/w/${wsId}/settings/account/ai`);
    }
  };

  return (
    <Show when={visible()}>
      <output class="ai-provider-hint" aria-live="polite">
        <Icon name="sparkles" size={14} />
        <span class="ai-provider-hint-text">
          Matrix laeuft mit voller Power, wenn du einen AI-Provider verbindest.
        </span>
        <button type="button" class="btn-c btn-small" onClick={onConfigure}>
          Einrichten
        </button>
        <button
          type="button"
          class="ai-provider-hint-close"
          onClick={onDismiss}
          aria-label="Hinweis vorruebergehend ausblenden"
        >
          <Icon name="x" size={14} />
        </button>
      </output>
    </Show>
  );
};

export default AiProviderHint;
