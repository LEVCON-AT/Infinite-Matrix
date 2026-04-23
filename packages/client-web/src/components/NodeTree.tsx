import { For, Show, createEffect, createMemo, createSignal, type Component } from 'solid-js';
import { A } from '@solidjs/router';
import type { TreeNode } from '../lib/types';
import { useTreeExpand } from '../lib/tree-expand';

type Props = {
  workspaceId: string;
  tree: TreeNode[];
  currentNodeId: string | undefined;
};

const typeIcon: Record<'matrix' | 'board', string> = {
  matrix: '▦',
  board: '▤',
};

// Filtert den Tree so, dass alle Nodes drin bleiben, deren Label oder
// Alias das Query matcht — plus deren Ancestors (damit der Pfad sichtbar
// bleibt). Subtrees unterhalb eines Match werden vollstaendig
// mitgeliefert, damit der User sehen kann was darunter haengt.
function filterTree(tree: TreeNode[], q: string): TreeNode[] {
  if (!q) return tree;
  const query = q.toLowerCase();
  const walk = (items: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const it of items) {
      const label = (it.node.label || '').toLowerCase();
      const alias = (it.node.alias || '').toLowerCase();
      const selfMatch = label.includes(query) || alias.includes(query);
      const childMatches = walk(it.children);
      if (selfMatch) {
        // Self match: ganzen Subtree zeigen (nicht nur gefilterten) —
        // User erwartet den ganzen Kontext unter dem Treffer.
        out.push(it);
      } else if (childMatches.length > 0) {
        out.push({ ...it, children: childMatches });
      }
    }
    return out;
  };
  return walk(tree);
}

// Highlightet den Match im Label. Teilt den String vor/match/nach,
// der Mittel-Teil bekommt eine Klasse.
function highlightLabel(label: string, q: string): (string | { m: string })[] {
  if (!q) return [label];
  const lower = label.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) return [label];
  return [
    label.slice(0, idx),
    { m: label.slice(idx, idx + q.length) },
    label.slice(idx + q.length),
  ];
}

const NodeTreeItem: Component<{
  workspaceId: string;
  item: TreeNode;
  currentNodeId: string | undefined;
  depth: number;
  expand: ReturnType<typeof useTreeExpand>;
  query: string;
}> = (p) => {
  const hasChildren = () => p.item.children.length > 0;
  // Bei aktivem Filter ignorieren wir den persistierten Expand-State:
  // der User will den Pfad zu den Treffern sofort sehen.
  const expanded = () =>
    p.query ? true : p.expand.isExpanded(p.item.node.id);

  return (
    <li>
      <div
        class="tree-row"
        style={{ 'padding-left': `${p.depth * 12 + 4}px` }}
      >
        {/* Chevron-Slot immer im DOM (fixe Breite), damit Rows ohne
            Kinder buendig mit denen mit Kindern ausgerichtet sind. */}
        <Show
          when={hasChildren()}
          fallback={<span class="tree-chevron tree-chevron-empty" aria-hidden="true" />}
        >
          <button
            type="button"
            class="tree-chevron"
            classList={{ 'tree-chevron-open': expanded() }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              p.expand.toggle(p.item.node.id);
            }}
            title={expanded() ? 'Einklappen' : 'Ausklappen'}
            aria-label={expanded() ? 'Einklappen' : 'Ausklappen'}
            aria-expanded={expanded()}
          >
            ▸
          </button>
        </Show>
        <A
          href={`/w/${p.workspaceId}/n/${p.item.node.id}`}
          class="tree-link"
          classList={{ active: p.item.node.id === p.currentNodeId }}
        >
          <span class="tree-ico" aria-hidden="true">
            {typeIcon[p.item.node.type]}
          </span>
          <span class="tree-label">
            <For each={highlightLabel(p.item.node.label || '(ohne Label)', p.query)}>
              {(part) =>
                typeof part === 'string' ? (
                  <>{part}</>
                ) : (
                  <mark class="tree-match">{part.m}</mark>
                )
              }
            </For>
          </span>
          <Show when={p.item.node.alias}>
            <span class="tree-alias">^{p.item.node.alias}</span>
          </Show>
        </A>
      </div>
      <Show when={hasChildren() && expanded()}>
        <ul>
          <For each={p.item.children}>
            {(child) => (
              <NodeTreeItem
                workspaceId={p.workspaceId}
                item={child}
                currentNodeId={p.currentNodeId}
                depth={p.depth + 1}
                expand={p.expand}
                query={p.query}
              />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
};

const NodeTree: Component<Props> = (props) => {
  const expand = useTreeExpand(props.workspaceId);
  const [query, setQuery] = createSignal('');
  let inputRef: HTMLInputElement | undefined;

  // Einmalig seeden, sobald der Tree Daten hat. Bei neuen Workspaces
  // heisst das: Root-Ebene offen, Rest zu — der bekannte Default.
  // Bei existierenden Workspaces (localStorage-Eintrag schon da)
  // greift das no-op.
  createEffect(() => {
    const roots = props.tree;
    if (roots.length === 0) return;
    expand.seedIfFresh(roots.map((r) => r.node.id));
  });

  const filtered = createMemo(() => filterTree(props.tree, query().trim()));

  return (
    <div class="node-tree">
      <div class="node-tree-head">
        <span class="node-tree-label">Matrix &amp; Boards</span>
        <input
          ref={inputRef}
          class="node-tree-filter"
          type="text"
          placeholder="Filter…"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && query()) {
              e.preventDefault();
              e.stopPropagation();
              setQuery('');
            }
          }}
        />
      </div>
      <Show
        when={filtered().length > 0}
        fallback={
          <div class="tree-empty">
            <Show when={query()} fallback={<>Keine Elemente.</>}>
              Keine Treffer.
            </Show>
          </div>
        }
      >
        <ul class="tree-root">
          <For each={filtered()}>
            {(item) => (
              <NodeTreeItem
                workspaceId={props.workspaceId}
                item={item}
                currentNodeId={props.currentNodeId}
                depth={0}
                expand={expand}
                query={query().trim()}
              />
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
};

export default NodeTree;
