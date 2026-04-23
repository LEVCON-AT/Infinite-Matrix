// Command-Palette: Shift+P oeffnet sie. Anders als die AliasQuicknav,
// die reine Navigation macht, fuehrt die Palette Mutations aus
// (neue Karte, Clone, ...). Siehe lib/commands.ts fuer Parser +
// Dispatcher.
//
// Input akzeptiert Leerzeichen und Minus — sonst funktioniert z.B.
// "n alias" oder "n karte -m board" nicht. Filter nur auf offen-
// sichtlich gefaehrliche Zeichen.

import { createSignal, onCleanup, onMount, Show, type Component } from 'solid-js';
import type { NodeRow } from '../lib/types';
import { parseCommand, executeCommand, reportOutcome } from '../lib/commands';
import { flashError } from '../lib/flash';

type Props = {
  workspaceId: string;
  currentNode: NodeRow | undefined;
  onClose: () => void;
};

const CommandPalette: Component<Props> = (p) => {
  const [query, setQuery] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let inputRef: HTMLInputElement | undefined;

  let prevFocus: HTMLElement | null = null;
  onMount(() => {
    prevFocus = document.activeElement as HTMLElement | null;
    setTimeout(() => inputRef?.focus(), 0);
  });
  onCleanup(() => {
    prevFocus?.focus?.();
  });

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  function fail(msg: string) {
    setError(msg);
    flashError(inputRef);
    setBusy(false);
  }

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (busy()) return;
    const raw = query().trim();
    if (!raw) {
      fail('Command eingeben. Z.B. "n alias" oder "copy board1 board2".');
      return;
    }
    const cmd = parseCommand(raw);
    if (!cmd) {
      fail('Command nicht erkannt.');
      return;
    }

    setBusy(true);
    setError(null);
    const outcome = await executeCommand(cmd, {
      workspaceId: p.workspaceId,
      currentNode: p.currentNode,
    });
    setBusy(false);

    reportOutcome(outcome);
    if (outcome.ok) {
      p.onClose();
    } else {
      setError(outcome.message);
      flashError(inputRef);
    }
  }

  return (
    <div
      class="overlay-scrim command-palette-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        class="overlay-card command-palette-card"
        role="dialog"
        aria-label="Command-Palette"
      >
        <form class="command-palette-form" onSubmit={onSubmit}>
          <span class="command-palette-prefix" aria-hidden="true">
            ^
          </span>
          <input
            ref={inputRef}
            class="command-palette-input"
            type="text"
            value={query()}
            placeholder={'z.B. "n alias" oder "copy quelle ziel"'}
            autocomplete="off"
            spellcheck={false}
            disabled={busy()}
            onInput={(e) => {
              // Nur potenziell gefaehrliche Zeichen stripen. Leerzeichen
              // und Minus bleiben — Commands brauchen sie.
              const raw = e.currentTarget.value;
              const cleaned = raw.replace(/[<>"'`;]/g, '');
              if (cleaned !== raw) {
                e.currentTarget.value = cleaned;
              }
              setQuery(cleaned);
              if (error()) setError(null);
            }}
          />
        </form>
        <Show when={error()}>
          <p class="command-palette-error" role="alert">
            {error()}
          </p>
        </Show>
        <p class="command-palette-hint">
          <strong>n</strong> alias · <strong>copy</strong> src [dst] · Enter = ausfuehren · Esc = schliessen
        </p>
      </div>
    </div>
  );
};

export default CommandPalette;
