import { For, Show, type Component } from 'solid-js';
import { A } from '@solidjs/router';
import type { TreeNode } from '../lib/types';

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
}> = (p) => {
  return (
    <li>
      <A
        href={`/w/${p.workspaceId}/n/${p.item.node.id}`}
        class="tree-link"
        classList={{ active: p.item.node.id === p.currentNodeId }}
        style={{ 'padding-left': `${p.depth * 12 + 8}px` }}
      >
        <span class="tree-ico" aria-hidden="true">
          {typeIcon[p.item.node.type]}
        </span>
        <span class="tree-label">{p.item.node.label || '(ohne Label)'}</span>
        <Show when={p.item.node.alias}>
          <span class="tree-alias">^{p.item.node.alias}</span>
        </Show>
      </A>
      <Show when={p.item.children.length > 0}>
        <ul>
          <For each={p.item.children}>
            {(child) => (
              <NodeTreeItem
                workspaceId={p.workspaceId}
                item={child}
                currentNodeId={p.currentNodeId}
                depth={p.depth + 1}
              />
            )}
          </For>
        </ul>
      </Show>
    </li>
  );
};

const NodeTree: Component<Props> = (props) => {
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
              />
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
};

export default NodeTree;
