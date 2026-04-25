// InviteSuccessModal — Phase 1 (P1.A).
//
// Zeigt den frisch erzeugten Klartext-Token + Mail-Link mit Kopier-
// Button. Der Token wird DB-seitig nur gehasht persistiert, also kann
// dieser Modal-Aufruf der EINZIGE Moment sein, in dem der Admin den
// Klartext zu sehen bekommt — entsprechend prominent.

import { type Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { installFocusRestore } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { showToast } from '../lib/toasts';
import Icon from './Icon';

export type InviteSuccessProps = {
  link: string;
  expiresAt: string;
  onClose: () => void;
};

const InviteSuccessModal: Component<InviteSuccessProps> = (p) => {
  const [copied, setCopied] = createSignal(false);
  let linkInput: HTMLInputElement | undefined;

  onMount(() => {
    onCleanup(installFocusRestore());
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
    // Auto-Select des Links — User kann sofort Cmd/Ctrl+C druecken,
    // ohne den Maus-Klick auf den Kopier-Button machen zu muessen.
    linkInput?.focus();
    linkInput?.select();
  });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(p.link);
      setCopied(true);
      showToast('Link kopiert.', 'success');
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Fallback: Selektion + Hinweis. clipboard.writeText kann in
      // unsicherem Kontext (http://) oder ohne user-gesture scheitern.
      linkInput?.focus();
      linkInput?.select();
      showToast(
        translateDbError(err, 'Kopieren fehlgeschlagen — bitte manuell auswaehlen.'),
        'error',
      );
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop-Klick — Tastatur via ESC im onMount.
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        class="overlay-card invite-success-card"
        // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> bewusst statt <dialog>.
        role="dialog"
        aria-modal="true"
        aria-label="Einladung erstellt"
      >
        <header class="overlay-head">
          <h3>Einladung erstellt</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>
        <div class="overlay-body invite-success-body">
          <p class="hint">
            Schick diesen Link an die einzuladende Person. Er ist{' '}
            <strong>einmalig verwendbar</strong> und laeuft am{' '}
            <strong>{new Date(p.expiresAt).toLocaleDateString()}</strong> ab.
          </p>
          <p class="hint warn-hint">
            <Icon name="information-circle" size={14} />
            <span>
              Der Link wird hier <em>einmalig</em> angezeigt. Aus Sicherheitsgruenden ist er nach
              dem Schliessen nicht mehr abrufbar — nur der Status der Einladung. Bei Verlust:
              widerrufen + neu einladen.
            </span>
          </p>
          <div class="invite-link-row">
            <input
              ref={(el) => {
                linkInput = el;
              }}
              type="text"
              class="invite-link-input"
              value={p.link}
              readonly
              spellcheck={false}
              aria-label="Einladungs-Link"
              onClick={(e) => e.currentTarget.select()}
            />
            <button type="button" class="btn-c" onClick={() => void copyLink()}>
              <Show when={copied()} fallback={<Icon name="clipboard-document" size={14} />}>
                <Icon name="check" size={14} />
              </Show>
              <span>{copied() ? 'Kopiert' : 'Kopieren'}</span>
            </button>
          </div>
        </div>
        <footer class="overlay-foot">
          <button type="button" class="btn-c" onClick={p.onClose}>
            Fertig
          </button>
        </footer>
      </div>
    </div>
  );
};

export default InviteSuccessModal;
