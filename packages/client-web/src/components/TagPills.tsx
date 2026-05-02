// Welle D.7 — TagPills (Read-Only-Render fuer Atom-Chips).
//
// Zeigt max 3 Tags als kleine Pills + "+N"-Indicator wenn mehr da
// sind. Click auf "+N" oeffnet Detail-Modal des Atoms (Caller-Hook
// via onShowAll). Click auf Pill kann Tag-Filter triggern (V2).
//
// Style folgt Token-System (--tag-bg, --tag-fg). Pro Tag-Kind ein
// kleines Praefix-Icon: '#' fuer freetext, '^' fuer alias_ref, '@'
// fuer atom_ref, 📎 fuer object_ref.

import { type Component, For, Show } from 'solid-js';
import type { AtomTagWithTag } from '../lib/types';

export type TagPillsProps = {
  tags: AtomTagWithTag[];
  maxVisible?: number;
  onShowAll?: () => void;
  onTagClick?: (tag: AtomTagWithTag) => void;
};

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

function tagDisplay(tag: AtomTagWithTag): string {
  if (tag.tag_kind === 'alias_ref' && tag.tag_display_label) return tag.tag_display_label;
  if (tag.tag_display_label) return tag.tag_display_label;
  return tag.tag_value;
}

const TagPills: Component<TagPillsProps> = (p) => {
  const max = () => p.maxVisible ?? 3;
  const visible = () => p.tags.slice(0, max());
  const overflow = () => Math.max(0, p.tags.length - max());

  return (
    <div class="tag-pills" aria-label="Tags">
      <For each={visible()}>
        {(t) => (
          <button
            type="button"
            class="tag-pill"
            classList={{
              [`tag-pill-${t.tag_kind}`]: true,
            }}
            onClick={(e) => {
              e.stopPropagation();
              p.onTagClick?.(t);
            }}
            title={`${tagPrefix(t.tag_kind)}${tagDisplay(t)}`}
          >
            <span class="tag-pill-prefix">{tagPrefix(t.tag_kind)}</span>
            <span class="tag-pill-label">{tagDisplay(t)}</span>
          </button>
        )}
      </For>
      <Show when={overflow() > 0}>
        <button
          type="button"
          class="tag-pill tag-pill-overflow"
          onClick={(e) => {
            e.stopPropagation();
            p.onShowAll?.();
          }}
          title={`${overflow()} weitere Tags anzeigen`}
        >
          +{overflow()}
        </button>
      </Show>
    </div>
  );
};

export default TagPills;
