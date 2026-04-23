// Notizfeld pro Matrix/Board. Lebt in nodes.data.description (JSONB,
// keine Schema-Migration). Im View-Mode nur sichtbar wenn Content;
// im Edit-Mode immer Textarea mit Auto-Grow (field-sizing:content).
// View-Mode rendert Markdown-Light (bold/italic/code/http-Auto-Link).
//
// Realtime: nodes.data mutiert -> postgres_changes.nodes feuert ->
// Workspace refetcht nodes -> currentNode().data.description ist frisch.

import { Show, createEffect, createSignal, type Component } from 'solid-js';
import type { NodeRow } from '../lib/types';
import { useEditMode } from '../lib/edit-mode';
import { setNodeDescription } from '../lib/mutations';
import { showToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';
import MarkdownLightView from './MarkdownLightView';
import { bindAliasAutocomplete } from '../lib/use-alias-autocomplete';

type Props = {
  node: NodeRow;
  onChanged?: () => void;
};

function readDescription(node: NodeRow): string {
  const data = node.data as Record<string, unknown> | null;
  const d = data?.description;
  return typeof d === 'string' ? d : '';
}

const NodeDescription: Component<Props> = (p) => {
  const editMode = useEditMode();
  // Lokaler Draft-State: wir schreiben nur bei Blur, nicht bei jedem
  // Keystroke. Bei Realtime-Update (andere Tab bearbeitet) springt
  // readDescription() weiter — der Effect unten zieht den Draft nach,
  // wenn der User gerade nicht fokussiert ist.
  const [draft, setDraft] = createSignal(readDescription(p.node));
  const [busy, setBusy] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;

  // Server-Seite-Change ins Draft mergen, wenn kein Fokus. Mit Fokus
  // gewinnt der User — sonst laufen wir in typische "mein Text ist
  // weg"-Bugs beim Realtime-Refetch.
  createEffect(() => {
    const remote = readDescription(p.node);
    const hasFocus = document.activeElement === textareaRef;
    if (hasFocus) return;
    if (draft() !== remote) setDraft(remote);
  });

  async function onBlur() {
    const next = draft();
    const current = readDescription(p.node);
    if (next === current) return;
    if (busy()) return;
    setBusy(true);
    try {
      await setNodeDescription(p.node.id, next);
      p.onChanged?.();
    } catch (err) {
      showToast(translateDbError(err), 'error');
      // Bei Fehler: Draft nicht rollbacken, User soll's nochmal
      // versuchen koennen ohne dass sein Text weg ist.
    } finally {
      setBusy(false);
    }
  }

  const hasContent = () => draft().trim().length > 0;

  return (
    <Show when={editMode() || hasContent()}>
      <div class="node-desc" classList={{ 'node-desc-edit': editMode() }}>
        <Show
          when={editMode()}
          fallback={
            <div class="node-desc-view">
              <MarkdownLightView text={draft()} />
            </div>
          }
        >
          <textarea
            ref={(el) => {
              textareaRef = el;
              bindAliasAutocomplete(el, p.node.workspace_id);
            }}
            class="node-desc-input"
            placeholder="Beschreibung (Markdown: **bold**, *italic*, `code`, http-Links)…"
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onBlur={onBlur}
            disabled={busy()}
          />
        </Show>
      </div>
    </Show>
  );
};

export default NodeDescription;
