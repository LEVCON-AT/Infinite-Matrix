// Command-Palette: `^` oeffnet sie (Shift+P/Ctrl+K wurden entfernt —
// einheitlicher Entry-Point). Die Palette vereinigt die frueher separate
// AliasQuicknav: ein Token ohne Verb = Navigation (Alias-Jump), sonst
// Command-Parser (siehe lib/commands.ts).
//
// Input akzeptiert Leerzeichen und Minus — sonst funktioniert z.B.
// "n alias" oder "n karte -m board" nicht. Filter nur auf offen-
// sichtlich gefaehrliche Zeichen.
//
// Drei Modi:
//   input    — Normaler Command-Eingabe-Modus (Default).
//   help     — ^help oder leere Eingabe zeigt Command-Uebersicht.
//   col-pick — Sekundaer-Prompt fuer move-card ohne explizite Spalte:
//              zeigt die Ziel-Board-Spalten als Select, User bestaetigt.

import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type Component,
} from 'solid-js';
import { useNavigate } from '@solidjs/router';
import type { NodeRow } from '../lib/types';
import {
  COMMAND_VERBS,
  executeCommand,
  parseCommand,
  reportOutcome,
  type CommandUiHooks,
} from '../lib/commands';
import { resolveAlias } from '../lib/alias-resolve';
import { dispatchAliasResult } from '../lib/alias-dispatch';
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
  const navigate = useNavigate();
  const [query, setQuery] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [colPick, setColPick] = createSignal<ColPickState | null>(null);
  let inputRef: HTMLInputElement | undefined;
  let colSelectRef: HTMLSelectElement | undefined;

  // Help-Modus: leere Eingabe ODER exakt "help"/"k" zeigen die Command-
  // Uebersicht als Inline-Dropdown unter dem Input. Kein extra Modal —
  // der User sieht die Verben waehrend er tippt, und sobald er was
  // eingibt was kein Help-Token ist, verschwindet die Uebersicht.
  const showHelpList = createMemo(() => {
    const q = query().trim().toLowerCase();
    return q === '' || q === 'help' || q === 'k';
  });

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
    onNavigateAlias: async (alias) => {
      // Gemergt aus AliasQuicknav (vorher separate Komponente). Alias
      // aufloesen + ueber dispatchAliasResult navigieren. Fehlerfall
      // liefert Msg zurueck, damit die Palette den Input-Flash triggert.
      try {
        const outcome = await resolveAlias(alias, p.workspaceId);
        if (!outcome.ok) return { ok: false, msg: outcome.msg };
        dispatchAliasResult(outcome.result, {
          workspaceId: p.workspaceId,
          navigate,
          onError: (msg) => showToast(msg, 'error'),
        });
        return { ok: true };
      } catch (err) {
        return { ok: false, msg: translateDbError(err) };
      }
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
              placeholder={'kuerzel springen · "n alias" · "ren alias Titel" · "help"'}
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
          {/* Help-Dropdown: bei leerer Eingabe ODER "help"/"k" das volle
              Command-Vokabular als Liste anzeigen. Gleichzeitig hint-
              artig: User sieht was moeglich ist, ohne extra Modal zu
              oeffnen. Bei jeder anderen Eingabe wird es ausgeblendet. */}
          <Show when={showHelpList()}>
            <ul class="command-palette-help" role="list" aria-label="Verfuegbare Commands">
              <For each={COMMAND_VERBS}>
                {(entry) => (
                  <li class="command-palette-help-row">
                    <code class="command-palette-help-syntax">{entry.syntax}</code>
                    <span class="command-palette-help-desc">{entry.description}</span>
                  </li>
                )}
              </For>
            </ul>
          </Show>
          <Show when={!showHelpList()}>
            <p class="command-palette-hint">
              Enter = ausfuehren · Esc = schliessen · "help" = Uebersicht
            </p>
          </Show>
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
