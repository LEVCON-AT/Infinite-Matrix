// Welle D.9 — NodeDocsButton.
//
// Header-Button mit Doku-Count + Popover-Liste fuer Matrix-/Board-Nodes.
// Click ohne Pins -> openDokuForContext({kind:'node', ...}) legt eine
// neue Doku am Node an. Click mit Pins -> Popover mit Liste der
// gepinnten Dokus; Eintrag-Click oeffnet bestehende Doc im DocsPopup.
//
// Render-Quelle: atom_pins gefiltert auf parent_kind='node' AND
// parent_id=nodeId AND atom_type='doc', plus Doc-Rows fuer Title-
// Anzeige. Beide stammen aus den Workspace-Resources (props).
//
// Outside-Click + ESC schliessen den Popover (Pattern aus
// NotificationBell.tsx).

import { type Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { openDokuForContext } from '../lib/docs-open';
import { openDocsPopup } from '../lib/docs-ui';
import type { AtomPin, DocRow } from '../lib/types';
import Icon from './Icon';

export type NodeDocsButtonProps = {
  nodeId: string;
  nodeKind: 'matrix' | 'board';
  nodeAlias: string | null;
  atomPins: AtomPin[];
  docs: DocRow[];
};

const NodeDocsButton: Component<NodeDocsButtonProps> = (p) => {
  const [open, setOpen] = createSignal(false);
  let btnEl: HTMLButtonElement | undefined;
  let popEl: HTMLDivElement | undefined;

  const pinnedDocs = createMemo<DocRow[]>(() => {
    const docPinIds = new Set(
      p.atomPins
        .filter(
          (pin) =>
            pin.atom_type === 'doc' &&
            pin.parent_kind === 'node' &&
            pin.parent_id === p.nodeId,
        )
        .map((pin) => pin.atom_id),
    );
    if (docPinIds.size === 0) return [];
    return p.docs
      .filter((d) => docPinIds.has(d.id))
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
  });

  const count = () => pinnedDocs().length;

  function onMainClick(e: MouseEvent): void {
    e.stopPropagation();
    if (count() === 0) {
      // Keine bestehende Doku — direkt neue anlegen.
      openDokuForContext({
        kind: 'node',
        nodeId: p.nodeId,
        nodeKind: p.nodeKind,
        nodeAlias: p.nodeAlias,
      });
      return;
    }
    setOpen((v) => !v);
  }

  function onItemClick(doc: DocRow): void {
    setOpen(false);
    openDocsPopup({ initialDocId: doc.id });
  }

  function onCreateNew(): void {
    setOpen(false);
    openDokuForContext({
      kind: 'node',
      nodeId: p.nodeId,
      nodeKind: p.nodeKind,
      nodeAlias: p.nodeAlias,
    });
  }

  onMount(() => {
    const onClick = (e: MouseEvent) => {
      if (!open()) return;
      const target = e.target as Node;
      if (popEl?.contains(target) || btnEl?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open()) {
        e.preventDefault();
        setOpen(false);
        btnEl?.focus();
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    });
  });

  return (
    <div class="node-docs-btn-wrap">
      <button
        ref={btnEl}
        type="button"
        class="node-docs-btn"
        classList={{ 'node-docs-btn-empty': count() === 0 }}
        onClick={onMainClick}
        title={
          count() === 0
            ? 'Doku zu diesem Bereich anlegen (d)'
            : `${count()} Doku${count() === 1 ? '' : 's'} an diesem Bereich`
        }
        aria-haspopup={count() > 0 ? 'menu' : undefined}
        aria-expanded={count() > 0 ? open() : undefined}
      >
        <Icon name="document-text" size={14} />
        <Show when={count() > 0} fallback={<span class="node-docs-btn-plus">+</span>}>
          <span class="node-docs-btn-count">{count()}</span>
        </Show>
      </button>
      <Show when={open() && count() > 0}>
        <div ref={popEl} class="node-docs-pop" role="menu">
          <div class="node-docs-pop-head">
            <span>Dokus an diesem Bereich</span>
          </div>
          <ul class="node-docs-pop-list">
            <For each={pinnedDocs()}>
              {(d) => (
                <li>
                  <button
                    type="button"
                    class="node-docs-pop-item"
                    onClick={() => onItemClick(d)}
                  >
                    <Icon name="document-text" size={14} />
                    <span class="node-docs-pop-item-title">{d.title || '(ohne Titel)'}</span>
                    <Show when={d.alias}>
                      <span class="node-docs-pop-item-alias">^{d.alias}</span>
                    </Show>
                  </button>
                </li>
              )}
            </For>
          </ul>
          <button type="button" class="node-docs-pop-add" onClick={onCreateNew}>
            <Icon name="plus" size={14} />
            <span>Neue Doku am Bereich</span>
          </button>
        </div>
      </Show>
    </div>
  );
};

export default NodeDocsButton;
