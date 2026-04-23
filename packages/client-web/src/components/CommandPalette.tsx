// Command-Palette: Shift+P oeffnet sie. Anders als die AliasQuicknav,
// die reine Navigation macht, fuehrt die Palette Mutations aus
// (neue Karte, Clone, Move, Del, Ren, ...). Siehe lib/commands.ts fuer
// Parser + Dispatcher.
//
// Input akzeptiert Leerzeichen und Minus — sonst funktioniert z.B.
// "n alias" oder "n karte -m board" nicht. Filter nur auf offen-
// sichtlich gefaehrliche Zeichen.
//
// Zwei Modi:
//   input    — Normaler Command-Eingabe-Modus (Default).
//   col-pick — Sekundaer-Prompt fuer move-card ohne explizite Spalte:
//              zeigt die Ziel-Board-Spalten als Select, User bestaetigt.

import {
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type Component,
} from 'solid-js';
import type { NodeRow } from '../lib/types';
import {
  executeCommand,
  parseCommand,
  reportOutcome,
  type CommandUiHooks,
} from '../lib/commands';
import { moveCardToBoard } from '../lib/mutations';
import { supabase } from '../lib/supabase';
import { flashError } from '../lib/flash';
import { openDocsPopup } from '../lib/docs-ui';
import { showToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';

type Props = {
  workspaceId: string;
  currentNode: NodeRow | undefined;
  onClose: () => void;
  onShowHelp: () => void;
};

type ColPickState = {
  cardId: string;
  cardLabel: string;
  boardId: string;
  boardLabel: string;
  cols: Array<{ id: string; label: string }>;
  selectedIdx: number;
};

const CommandPalette: Component<Props> = (p) => {
  const [query, setQuery] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [colPick, setColPick] = createSignal<ColPickState | null>(null);
  let inputRef: HTMLInputElement | undefined;
  let colSelectRef: HTMLSelectElement | undefined;

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
      // Im col-pick Modus: ESC bricht nur den Picker ab, nicht die
      // Palette. Erst ein zweites ESC schliesst die Palette.
      if (colPick()) {
        setColPick(null);
        setTimeout(() => inputRef?.focus(), 0);
        return;
      }
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

  const uiHooks: CommandUiHooks = {
    onShowHelp: () => {
      p.onClose();
      // setTimeout, damit die Palette-Close-Transition nicht den Help-
      // Dialog verschluckt (beide registrieren capture-ESC-Handler).
      setTimeout(() => p.onShowHelp(), 0);
    },
    onOpenDocs: () => {
      p.onClose();
      setTimeout(() => openDocsPopup(), 0);
    },
    onColPick: (args) => {
      setColPick({
        ...args,
        selectedIdx: 0,
      });
      // Focus wandert zum Select; setTimeout wegen Mount-Reihenfolge.
      setTimeout(() => colSelectRef?.focus(), 0);
    },
  };

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (busy()) return;
    const raw = query().trim();
    if (!raw) {
      fail('Command eingeben. Z.B. "n alias" oder "ren alias Neuer Titel".');
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
      ui: uiHooks,
    });
    setBusy(false);

    // Wenn eine UI-Aktion getriggert wurde (colPick gesetzt, Help/Docs
    // bereits geschlossen), nicht schliessen.
    if (colPick()) {
      // Palette bleibt offen im col-pick-Modus. Toast-Output unterdruecken,
      // weil der User mitten im Flow ist und die Message "Spalte waehlen"
      // schon im Sub-UI sichtbar ist.
      return;
    }

    reportOutcome(outcome);
    if (outcome.ok) {
      p.onClose();
    } else {
      setError(outcome.message);
      flashError(inputRef);
    }
  }

  async function onColPickConfirm() {
    const state = colPick();
    if (!state) return;
    const col = state.cols[state.selectedIdx];
    if (!col) return;
    setBusy(true);
    try {
      const posRes = await supabase
        .from('kb_cards')
        .select('position')
        .eq('col_id', col.id)
        .eq('workspace_id', p.workspaceId)
        .order('position', { ascending: false })
        .limit(1);
      if (posRes.error) throw posRes.error;
      const topPos =
        posRes.data && posRes.data.length > 0
          ? (posRes.data[0] as { position: number }).position
          : -1;
      await moveCardToBoard(state.cardId, state.boardId, col.id, topPos + 1);
      showToast(
        `Karte "${state.cardLabel}" in "${state.boardLabel}" / "${col.label}" verschoben.`,
        'success',
      );
      p.onClose();
    } catch (err) {
      showToast(translateDbError(err), 'error');
      setColPick(null);
      setBusy(false);
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
        <Show when={!colPick()}>
          <form class="command-palette-form" onSubmit={onSubmit}>
            <span class="command-palette-prefix" aria-hidden="true">
              ^
            </span>
            <input
              ref={inputRef}
              class="command-palette-input"
              type="text"
              value={query()}
              placeholder={'z.B. "n alias", "ren alias Titel", "del alias", "nd"'}
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
            <strong>n</strong>/<strong>copy</strong>/<strong>del</strong>/<strong>ren</strong>/<strong>nd</strong>/<strong>k</strong> · Enter = ausfuehren · Esc = schliessen
          </p>
        </Show>

        <Show when={colPick()}>
          {(state) => (
            <div class="command-palette-colpick">
              <p class="command-palette-colpick-title">
                Karte <strong>{state().cardLabel}</strong> in{' '}
                <strong>{state().boardLabel}</strong> — Spalte waehlen:
              </p>
              <select
                ref={colSelectRef}
                class="command-palette-colpick-select"
                size={Math.min(8, state().cols.length)}
                value={state().selectedIdx}
                onChange={(e) => {
                  const idx = parseInt(e.currentTarget.value, 10);
                  const cur = colPick();
                  if (cur) setColPick({ ...cur, selectedIdx: idx });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void onColPickConfirm();
                  }
                }}
              >
                <For each={state().cols}>
                  {(col, idx) => (
                    <option value={idx()}>{col.label || '(leer)'}</option>
                  )}
                </For>
              </select>
              <div class="command-palette-colpick-actions">
                <button
                  type="button"
                  class="btn-subtle"
                  onClick={() => {
                    setColPick(null);
                    setTimeout(() => inputRef?.focus(), 0);
                  }}
                  disabled={busy()}
                >
                  Zurueck
                </button>
                <button
                  type="button"
                  class="btn-primary"
                  onClick={onColPickConfirm}
                  disabled={busy()}
                >
                  Verschieben
                </button>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  );
};

export default CommandPalette;
