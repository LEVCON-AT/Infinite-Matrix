// Inline-Chip fuer `^alias` in gerendertem Text. Click dispatchet den
// Alias (Navigation / Card-Overlay / Doc-Popup), Rechtsklick, F10 und
// `+` oeffnen ein Kontextmenu mit "Oeffnen" und "Kopieren".
//
// Vorbild: `.cl-alias` im Alt-Client (Zeile 5272ff). Dort wird der Chip
// via Regex-Wrapper gerendert und `_clAliasHandleActivate` bzw.
// `_clAliasOpenContextMenu` steuern Click/+.
//
// Offline-Fallback: wenn das Alias beim Resolve nicht gefunden wird
// (z.B. Cache noch nicht gefuellt, Alias inzwischen geloescht), zeigen
// wir den Text trotzdem als Chip, aber im Dispatch gibt es eine
// freundliche Fehlermeldung.

import { useNavigate } from '@solidjs/router';
import type { Component } from 'solid-js';
import { openAliasChipMenu } from '../lib/alias-chip-menu';
import { dispatchAliasResult } from '../lib/alias-dispatch';
import { lookupAlias } from '../lib/alias-index';
import { resolveAlias } from '../lib/alias-resolve';
import { showToast } from '../lib/toasts';

type Props = {
  alias: string;
  workspaceId: string;
};

const AliasChip: Component<Props> = (p) => {
  const navigate = useNavigate();

  async function activate() {
    const out = await resolveAlias(p.alias, p.workspaceId);
    if (!out.ok) {
      showToast(out.msg, 'error');
      return;
    }
    dispatchAliasResult(out.result, {
      workspaceId: p.workspaceId,
      navigate,
      onError: (msg) => showToast(msg, 'error'),
    });
  }

  function openMenu(x: number, y: number, sourceEl: HTMLElement) {
    const entry = lookupAlias(p.workspaceId, p.alias);
    openAliasChipMenu({
      x,
      y,
      headerLabel: entry?.label || '(Alias)',
      headerBadge: `^${p.alias}`,
      sourceEl,
      items: [
        {
          label: 'Oeffnen',
          icon: '↵',
          onClick: () => {
            void activate();
          },
        },
        {
          label: 'Alias kopieren',
          icon: '⎘',
          onClick: () => {
            const txt = `^${p.alias}`;
            if (navigator.clipboard?.writeText) {
              void navigator.clipboard.writeText(txt).then(
                () => showToast(`${txt} kopiert`, 'success'),
                () => showToast('Kopieren fehlgeschlagen', 'error'),
              );
            } else {
              showToast('Clipboard nicht verfuegbar', 'error');
            }
          },
        },
      ],
    });
  }

  return (
    <span
      class="alias-chip"
      // biome-ignore lint/a11y/useSemanticElements: bewusst <span role="button"> — AliasChip wird oft im Inline-Text gerendert (z.B. "Siehe ^foo bar"), <button> wuerde Block-Layout-Quirks verursachen und nested-button-Konflikte mit aeusserem role="button" Note-View.
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        void activate();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(e.clientX, e.clientY, e.currentTarget);
      }}
      onKeyDown={(e) => {
        // stopPropagation: der Chip kann in einem outer <div role="button">
        // mit eigenem Enter/Space-Handler stecken (z.B. CardOverlay-Note-
        // View). Ohne Stop wuerde Enter erst navigate + dann Edit-Toggle
        // triggern — Race-Condition mit Focus-Loss.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          void activate();
          return;
        }
        if (e.key === '+' || e.key === 'F10') {
          e.preventDefault();
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          openMenu(r.left, r.bottom + 2, e.currentTarget as HTMLElement);
        }
      }}
      title="Klick: oeffnen · Rechtsklick/+: Menu"
    >
      ^{p.alias}
    </span>
  );
};

export default AliasChip;
