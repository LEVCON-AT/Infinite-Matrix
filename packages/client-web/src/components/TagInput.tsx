// Welle D.7 — TagInput.
//
// Editable Tag-Liste fuer ein Atom. Zeigt existing Tags als loeschbare
// Pills + Inline-Input fuer neue Tags. Vier Eingabe-Modi via Trigger-
// Praefix:
//
//   `#design`        → freetext-Tag (Autocomplete aus workspace_tags)
//   `^kuerzel`       → alias_ref (resolved gegen alias-index)
//   `@`              → atom_ref → AtomPickerModal oeffnet
//   Button "Object"  → object_ref → ObjectPickerModal oeffnet
//
// Read-Pfad: tag-Liste aus Caller (workspace-resolved AtomTagWithTag).
// Write-Pfad: pro Tag-Kind ein eigener RPC aus lib/atom-tags.ts. Nach
// erfolgreichem RPC ruft Caller-Hook refresh() um lokalen Cache zu
// updaten.

import { type Component, For, Show, createMemo, createSignal } from 'solid-js';
import { translateDbError } from '../lib/errors';
import {
  addAtomTagAlias,
  addAtomTagFreetext,
  removeAtomTag,
} from '../lib/atom-tags';
import { showToast } from '../lib/toasts';
import type { AtomTagWithTag } from '../lib/types';
import type { AtomKind } from '../lib/atom-manifestations';
import Icon from './Icon';

export type TagInputProps = {
  workspaceId: string;
  atomType: AtomKind;
  atomId: string;
  tags: AtomTagWithTag[];
  onTagsChange: () => void; // Caller refetch'd nach Tag-Mutation
  onPickAtomRef?: () => void; // V1.5: oeffnet AtomPickerModal
  onPickObjectRef?: () => void; // V1.5: oeffnet ObjectPickerModal
};

function detectTriggerMode(input: string): 'freetext' | 'alias_ref' | 'atom_ref' | null {
  if (input.startsWith('@')) return 'atom_ref';
  if (input.startsWith('^')) return 'alias_ref';
  if (input.startsWith('#')) return 'freetext';
  // Plain-Eingabe ohne Trigger → freetext-Default.
  if (input.trim().length > 0) return 'freetext';
  return null;
}

function stripTrigger(input: string): string {
  return input.replace(/^[#^@]+/, '').trim();
}

const TagInput: Component<TagInputProps> = (p) => {
  const [draft, setDraft] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  const mode = createMemo(() => detectTriggerMode(draft()));

  async function commit() {
    const raw = draft().trim();
    if (!raw) return;
    const detectedMode = detectTriggerMode(raw);
    const value = stripTrigger(raw);
    if (!value) return;
    if (busy()) return;
    setBusy(true);
    try {
      if (detectedMode === 'alias_ref') {
        await addAtomTagAlias({
          workspaceId: p.workspaceId,
          atomType: p.atomType,
          atomId: p.atomId,
          alias: value,
        });
      } else if (detectedMode === 'atom_ref') {
        // @-Trigger ohne Picker → wir oeffnen den Picker (Trigger-Char
        // alleine reicht nicht — der User muss ein konkretes Atom waehlen).
        p.onPickAtomRef?.();
        setDraft('');
        return;
      } else {
        // freetext (Default).
        await addAtomTagFreetext({
          workspaceId: p.workspaceId,
          atomType: p.atomType,
          atomId: p.atomId,
          value,
        });
      }
      setDraft('');
      p.onTagsChange();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(tag: AtomTagWithTag) {
    if (busy()) return;
    setBusy(true);
    try {
      await removeAtomTag(tag.id);
      p.onTagsChange();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  function tagDisplay(t: AtomTagWithTag): string {
    return t.tag_display_label ?? t.tag_value;
  }

  function tagPrefix(kind: AtomTagWithTag['tag_kind']): string {
    switch (kind) {
      case 'freetext':
        return '#';
      case 'alias_ref':
        return '^';
      case 'atom_ref':
        return '@';
      case 'object_ref':
        return '⤴';
    }
  }

  return (
    <div class="tag-input" role="group" aria-label="Tags bearbeiten">
      <For each={p.tags}>
        {(t) => (
          <span class="tag-input-pill" classList={{ [`tag-pill-${t.tag_kind}`]: true }}>
            <span class="tag-input-pill-prefix">{tagPrefix(t.tag_kind)}</span>
            <span class="tag-input-pill-label">{tagDisplay(t)}</span>
            <button
              type="button"
              class="tag-input-pill-remove"
              onClick={() => void onRemove(t)}
              disabled={busy()}
              title="Tag entfernen"
              aria-label={`Tag ${tagDisplay(t)} entfernen`}
            >
              ✕
            </button>
          </span>
        )}
      </For>
      <input
        type="text"
        class="tag-input-field"
        value={draft()}
        placeholder="#tag, ^alias, @atom"
        disabled={busy()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Tab') {
            const val = draft().trim();
            if (!val) return;
            e.preventDefault();
            void commit();
          } else if (e.key === 'Backspace' && draft() === '' && p.tags.length > 0) {
            // Backspace im leeren Input loescht den letzten Tag (Standard-
            // Pattern aus Mention-/Tag-UIs).
            const last = p.tags[p.tags.length - 1];
            if (last) void onRemove(last);
          }
        }}
        aria-label="Tag eingeben"
      />
      <Show when={mode() === 'atom_ref'}>
        <span class="tag-input-hint">Enter: Atom-Picker oeffnen</span>
      </Show>
      <Show when={p.onPickObjectRef}>
        <button
          type="button"
          class="tag-input-pick-object"
          onClick={() => p.onPickObjectRef?.()}
          disabled={busy()}
          title="Cell oder Node verlinken"
        >
          <Icon name="link" size={14} />
          Object
        </button>
      </Show>
    </div>
  );
};

export default TagInput;
