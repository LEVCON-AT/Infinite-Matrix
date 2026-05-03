// Welle D.9 — AtomDocsSection.
//
// Inline-Sektion "Dokumentation" in Atom-Detail-Modals (Card/Link/
// ImportedEvent). Listet alle an diesen Atom gepinnten Dokus mit
// kurzer Vorschau (max 3 Zeilen). Click auf Eintrag oeffnet das
// DocsPopup ueber dem Modal. Wenn keine Dokus angeheftet:
// einzelner Button "Doku zu diesem Atom anlegen" der direkt das
// DocsPopup mit pinTarget oeffnet.
//
// Daten kommen vom Caller (workspace-resources via Props). Eine
// HTML-Vorschau wird durch Strip-Tags + Truncate auf ~120 Zeichen
// gekuerzt (read-only, kein dompurify-roundtrip noetig).

import { type Component, For, Show } from 'solid-js';
import type { AtomKind } from '../lib/atom-manifestations';
import { openDokuForContext } from '../lib/docs-open';
import { openDocsPopup } from '../lib/docs-ui';
import type { AtomPin, DocRow } from '../lib/types';
import Icon from './Icon';

export type AtomDocsSectionProps = {
  atomType: AtomKind;
  atomId: string;
  atomTitle: string | null;
  atomPins: AtomPin[];
  docs: DocRow[];
};

function plainPreview(html: string, max = 140): string {
  if (!html) return '';
  // Naive Tag-Strip — ausreichend fuer Vorschau-Snippet. Editor-Inhalt
  // ist nach dompurify-Sanitize sauber, also keine Skript-Tags.
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

const AtomDocsSection: Component<AtomDocsSectionProps> = (p) => {
  const docs = () => {
    const docPinIds = new Set(
      p.atomPins
        .filter(
          (pin) =>
            pin.atom_type === 'doc' && pin.parent_kind === 'atom' && pin.parent_id === p.atomId,
        )
        .map((pin) => pin.atom_id),
    );
    return p.docs
      .filter((d) => docPinIds.has(d.id))
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  };

  return (
    <section class="atom-docs-section">
      <header class="atom-docs-section-head">
        <Icon name="document-text" size={14} />
        <span>Dokumentation</span>
        <Show when={docs().length > 0}>
          <span class="atom-docs-section-count">({docs().length})</span>
        </Show>
      </header>
      <Show
        when={docs().length > 0}
        fallback={
          <button
            type="button"
            class="atom-docs-section-empty btn-subtle"
            onClick={() =>
              openDokuForContext({
                kind: 'atom',
                atomType: p.atomType,
                atomId: p.atomId,
                atomTitle: p.atomTitle,
              })
            }
          >
            <Icon name="plus" size={14} />
            <span>Doku zu diesem Atom anlegen</span>
          </button>
        }
      >
        <ul class="atom-docs-section-list">
          <For each={docs()}>
            {(d) => (
              <li>
                <button
                  type="button"
                  class="atom-docs-section-item"
                  onClick={() => openDocsPopup({ initialDocId: d.id })}
                >
                  <div class="atom-docs-section-item-head">
                    <span class="atom-docs-section-item-title">{d.title || '(ohne Titel)'}</span>
                    <Show when={d.alias}>
                      <span class="atom-docs-section-item-alias">^{d.alias}</span>
                    </Show>
                  </div>
                  <Show when={d.content}>
                    <p class="atom-docs-section-item-preview">{plainPreview(d.content)}</p>
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ul>
        <button
          type="button"
          class="atom-docs-section-add btn-subtle"
          onClick={() =>
            openDokuForContext({
              kind: 'atom',
              atomType: p.atomType,
              atomId: p.atomId,
              atomTitle: p.atomTitle,
            })
          }
        >
          <Icon name="plus" size={14} />
          <span>Weitere Doku anlegen</span>
        </button>
      </Show>
    </section>
  );
};

export default AtomDocsSection;
