import { For, Show, type Component } from 'solid-js';
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

const NodeTreeItem: Component<{
  workspaceId: string;
  item: TreeNode;
  currentNodeId: string | undefined;
  depth: number;
  expand: ReturnType<typeof useTreeExpand>;
}> = (p) => {
  const hasChildren = () => p.item.children.length > 0;
  const expanded = () => p.expand.isExpanded(p.item.node.id, p.depth);

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
          <span class="tree-label">{p.item.node.label || '(ohne Label)'}</span>
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
  return (
    <div class="node-tree">
      <div class="node-tree-label">Matrix &amp; Boards</div>
      <Show
        when={props.tree.length > 0}
        fallback={<div class="tree-empty">Keine Elemente.</div>}
      >
        <ul class="tree-root">
          <For each={props.tree}>
            {(item) => (
              <NodeTreeItem
                workspaceId={props.workspaceId}
                item={item}
                currentNodeId={props.currentNodeId}
                depth={0}
                expand={expand}
              />
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
};

export default NodeTree;
