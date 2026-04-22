// Quicknav: ^kuerzel eingeben, Enter navigiert. Shortcut Ctrl+K / Cmd+K.
//
// Vorbild: HTML-Client hat ein dauerhaftes Input-Feld in der Top-Bar. Im
// SaaS-Client waere das Platzverschwendung; Cmd+K-Palette ist die
// moderne Variante und sofort bekannt.
//
// Ziel-Dispatch:
//   node  → /w/:ws/n/:nodeId
//   cell  → rememberFocus + /w/:ws/n/:matrixId  (Focus-Restore greift)
//   card  → /w/:ws/n/:boardId  (V0: Karte wird nicht automatisch
//                              geoeffnet — das braucht CardOverlay-URL-
//                              Wiring, spaeterer Sprint)
//   checklist-board → /w/:ws/n/:boardId
//   checklist-cell  → /w/:ws/c/:cellId/checklists
//   link → window.open(url)

import { createEffect, createSignal, onCleanup, onMount, Show, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { resolveAlias, type AliasResolveResult } from '../lib/alias-resolve';
import { rememberFocus } from '../lib/navigation-focus';
import { sanitizeUrl } from '../lib/url';
import { showToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';

type Props = {
  workspaceId: string;
  onClose: () => void;
};

const AliasQuicknav: Component<Props> = (p) => {
  const navigate = useNavigate();
  const [query, setQuery] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let inputRef: HTMLInputElement | undefined;

  // Focus-Restore: beim Close den vorherigen Fokus zurueckholen.
  let prevFocus: HTMLElement | null = null;
  onMount(() => {
    prevFocus = document.activeElement as HTMLElement | null;
    // setTimeout(0) statt queueMicrotask: Wenn das Modal via ^-Dead-Key
    // auf deutscher Tastatur geoeffnet wurde, haelt der Browser noch
    // einen Composition-State, der den naechsten Vokal zu â/ê/î/… machen
    // wuerde. Ein Macrotask-Break laesst die Dead-Key-Phase durchlaufen,
    // bevor das Input Fokus bekommt — der Akzent landet dann nicht mehr
    // im Input.
    setTimeout(() => inputRef?.focus(), 0);
  });
  onCleanup(() => {
    prevFocus?.focus?.();
  });

  // ESC schliesst (capture phase, damit globale Back-Handler nicht
  // greifen).
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      p.onClose();
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  // Input-Feld leert automatisch den Fehlertext, wenn der User weitertippt.
  createEffect(() => {
    query();
    if (error()) setError(null);
  });

  function dispatch(result: AliasResolveResult) {
    switch (result.kind) {
      case 'node':
        navigate(`/w/${p.workspaceId}/n/${result.nodeId}`);
        return;
      case 'cell':
        rememberFocus(result.matrixId, result.rowId, result.colId);
        navigate(`/w/${p.workspaceId}/n/${result.matrixId}`);
        return;
      case 'card':
        // V0: Board oeffnen — Karte-Overlay-Autoopen kommt in einem
        // spaeteren Sprint (braucht URL-Param fuer cardId).
        navigate(`/w/${p.workspaceId}/n/${result.boardId}`);
        return;
      case 'checklist-board':
        navigate(`/w/${p.workspaceId}/n/${result.boardId}`);
        return;
      case 'checklist-cell':
        navigate(`/w/${p.workspaceId}/c/${result.cellId}/checklists`);
        return;
      case 'link': {
        const safe = sanitizeUrl(result.url);
        if (!safe) {
          showToast('Link-URL ist ungueltig.', 'error');
          return;
        }
        window.open(safe, '_blank', 'noopener,noreferrer');
        return;
      }
    }
  }

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    const q = query().trim();
    if (!q) return;
    if (busy()) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await resolveAlias(q, p.workspaceId);
      if (!outcome.ok) {
        setError(outcome.msg);
        return;
      }
      dispatch(outcome.result);
      p.onClose();
    } catch (err) {
      setError(translateDbError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      class="overlay-scrim alias-quicknav-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) p.onClose();
      }}
    >
      <div
        class="overlay-card alias-quicknav-card"
        role="dialog"
        aria-label="Quicknav: Alias eingeben"
      >
        <form class="alias-quicknav-form" onSubmit={onSubmit}>
          <span class="alias-quicknav-prefix" aria-hidden="true">
            ^
          </span>
          <input
            ref={inputRef}
            class="alias-quicknav-input"
            type="text"
            value={query()}
            placeholder="kuerzel"
            autocomplete="off"
            spellcheck={false}
            disabled={busy()}
            onInput={(e) => {
              // NFD-Normalize + diakritische Marker entfernen (â → a),
              // danach auf [a-z0-9] klemmen. Wenn das Modal via Dead-
              // Key geoeffnet wird und der Browser-Composition-State
              // noch klebt, wandert der Akzent so sofort aus dem Input.
              // Gleichzeitig schneidet das die Fehlermeldung "nur a-z
              // und 0-9" fuer den Normal-Input ab.
              const raw = e.currentTarget.value;
              const cleaned = raw
                .toLowerCase()
                .normalize('NFD')
                .replace(/[̀-ͯ]/g, '')
                .replace(/[^a-z0-9]/g, '');
              if (cleaned !== raw) {
                e.currentTarget.value = cleaned;
              }
              setQuery(cleaned);
            }}
          />
        </form>
        <Show when={error()}>
          <p class="alias-quicknav-error" role="alert">
            {error()}
          </p>
        </Show>
        <p class="alias-quicknav-hint">
          ^ oder Ctrl+K oeffnet. Enter = springen. Esc = schliessen.
        </p>
      </div>
    </div>
  );
};

export default AliasQuicknav;
