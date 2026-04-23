import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type Component,
} from 'solid-js';
import { A, useNavigate } from '@solidjs/router';
import type { TreeEntry } from '../lib/types';
import { useTreeExpand } from '../lib/tree-expand';
import { deleteNode, renameNode } from '../lib/mutations';
import { cellTarget } from '../lib/alias-dispatch';
import { showToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';
import ContextMenu, { type CtxMenuState } from './ContextMenu';

type Props = {
  workspaceId: string;
  tree: TreeEntry[];
  currentNodeId: string | undefined;
};

// Icon-Lookup nach Entry-Kind / Node-Type. Portiert die Feature-Farben
// aus dem HTML-Vorbild: matrix=blau, board=teal, cell=amber/grau.
function iconFor(entry: TreeEntry): string {
  if (entry.kind === 'node') {
    return entry.node.type === 'matrix' ? '▦' : '▤';
  }
  // Cells: Punkt, Subsection-Indikator
  return '·';
}

function dotColorFor(entry: TreeEntry): string {
  if (entry.kind === 'node') {
    return entry.node.type === 'matrix' ? 'var(--blue)' : 'var(--teal)';
  }
  return 'var(--amber)';
}

function labelOf(entry: TreeEntry): string {
  if (entry.kind === 'node') return entry.node.label || '(ohne Label)';
  return `${entry.rowLabel} / ${entry.colLabel}`;
}

function aliasOf(entry: TreeEntry): string | null {
  if (entry.kind === 'node') return entry.node.alias;
  return entry.cell.alias;
}

function hrefOf(workspaceId: string, entry: TreeEntry): string {
  if (entry.kind === 'node') return `/w/${workspaceId}/n/${entry.id}`;
  return cellTarget(workspaceId, {
    cellId: entry.cell.id,
    matrixId: entry.cell.matrix_id,
    features: entry.cell.features ?? [],
    childMatrixId: entry.cell.child_matrix_id,
    boardId: entry.cell.board_id,
  });
}

// Filtert den Tree so, dass alle Entries drin bleiben, deren Label oder
// Alias das Query matcht — plus deren Ancestors (damit der Pfad sichtbar
// bleibt). Subtrees unterhalb eines Match werden vollstaendig mitgeliefert.
function filterTree(tree: TreeEntry[], q: string): TreeEntry[] {
  if (!q) return tree;
  const query = q.toLowerCase();
  const walk = (items: TreeEntry[]): TreeEntry[] => {
    const out: TreeEntry[] = [];
    for (const it of items) {
      const label = labelOf(it).toLowerCase();
      const alias = (aliasOf(it) || '').toLowerCase();
      const selfMatch = label.includes(query) || alias.includes(query);
      const childMatches = walk(it.children);
      if (selfMatch) {
        out.push(it);
      } else if (childMatches.length > 0) {
        out.push({ ...it, children: childMatches } as TreeEntry);
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

const TreeItem: Component<{
  workspaceId: string;
  entry: TreeEntry;
  currentNodeId: string | undefined;
  depth: number;
  expand: ReturnType<typeof useTreeExpand>;
  query: string;
  openMenu: (entry: TreeEntry, rowEl: HTMLElement, x: number, y: number) => void;
}> = (p) => {
  const hasChildren = () => p.entry.children.length > 0;
  // Bei aktivem Filter ignorieren wir den persistierten Expand-State:
  // der User will den Pfad zu den Treffern sofort sehen.
  const expanded = () => (p.query ? true : p.expand.isExpanded(p.entry.id));

  let rowRef: HTMLDivElement | undefined;

  const dotStyle = { background: dotColorFor(p.entry) };

  return (
    <li>
      <div
        ref={rowRef}
        class="tree-row"
        data-entry-kind={p.entry.kind}
        data-node-type={p.entry.kind === 'node' ? p.entry.node.type : undefined}
        style={{ 'padding-left': `${p.depth * 12 + 4}px` }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (rowRef) p.openMenu(p.entry, rowRef, e.clientX, e.clientY);
        }}
      >
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
              p.expand.toggle(p.entry.id);
            }}
            title={expanded() ? 'Einklappen' : 'Ausklappen'}
            aria-label={expanded() ? 'Einklappen' : 'Ausklappen'}
            aria-expanded={expanded()}
          >
            ▸
          </button>
        </Show>
        <A
          href={hrefOf(p.workspaceId, p.entry)}
          class="tree-link"
          classList={{
            active:
              p.entry.kind === 'node' && p.entry.id === p.currentNodeId,
          }}
          onKeyDown={(e) => {
            if (e.key === '+' || e.key === 'F10' || e.key === 'ContextMenu') {
              e.preventDefault();
              if (rowRef) {
                const r = rowRef.getBoundingClientRect();
                p.openMenu(p.entry, rowRef, r.right - 16, r.bottom);
              }
            }
          }}
        >
          <span class="tree-dot" aria-hidden="true" style={dotStyle} />
          <span class="tree-ico" aria-hidden="true">
            {iconFor(p.entry)}
          </span>
          <span class="tree-label">
            <For each={highlightLabel(labelOf(p.entry), p.query)}>
              {(part) =>
                typeof part === 'string' ? (
                  <>{part}</>
                ) : (
                  <mark class="tree-match">{part.m}</mark>
                )
              }
            </For>
          </span>
          <Show when={aliasOf(p.entry)}>
            <span class="tree-alias">^{aliasOf(p.entry)}</span>
          </Show>
        </A>
      </div>
      <Show when={hasChildren() && expanded()}>
        <ul>
          <For each={p.entry.children}>
            {(child) => (
              <TreeItem
                workspaceId={p.workspaceId}
                entry={child}
                currentNodeId={p.currentNodeId}
                depth={p.depth + 1}
                expand={p.expand}
                query={p.query}
                openMenu={p.openMenu}
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
  const navigate = useNavigate();
  const [query, setQuery] = createSignal('');
  const [ctxMenu, setCtxMenu] = createSignal<CtxMenuState | null>(null);
  let inputRef: HTMLInputElement | undefined;

  // Einmalig seeden, sobald der Tree Daten hat. Bei neuen Workspaces
  // heisst das: Root-Ebene offen, Rest zu.
  createEffect(() => {
    const roots = props.tree;
    if (roots.length === 0) return;
    expand.seedIfFresh(roots.map((r) => r.id));
  });

  const filtered = createMemo(() => filterTree(props.tree, query().trim()));

  function openMenu(entry: TreeEntry, rowEl: HTMLElement, x: number, y: number) {
    const items: CtxMenuState['items'] = [];

    if (entry.kind === 'node') {
      items.push({
        label: 'Oeffnen',
        icon: '→',
        onClick: () => navigate(hrefOf(props.workspaceId, entry)),
      });
      items.push({
        label: 'Umbenennen',
        icon: '✎',
        onClick: () => {
          const next = window.prompt(
            `Neuer Name fuer "${entry.node.label}":`,
            entry.node.label,
          );
          if (next === null) return;
          const trimmed = next.trim();
          if (!trimmed || trimmed === entry.node.label) return;
          void (async () => {
            try {
              await renameNode(entry.id, trimmed);
              showToast(`Umbenannt in "${trimmed}".`, 'success');
            } catch (err) {
              showToast(translateDbError(err), 'error');
            }
          })();
        },
      });
      items.push({ label: '', onClick: () => {}, divider: true });
      items.push({
        label: 'Loeschen',
        icon: '✕',
        danger: true,
        onClick: () => {
          if (
            !window.confirm(
              `"${entry.node.label}" loeschen? Alle darunter liegenden Nodes, Zellen und Karten verschwinden mit.`,
            )
          ) {
            return;
          }
          void (async () => {
            try {
              await deleteNode(entry.id);
              showToast(`"${entry.node.label}" geloescht.`, 'success');
            } catch (err) {
              showToast(translateDbError(err), 'error');
            }
          })();
        },
      });
    } else {
      // Cell-Entry. Delete + Feature-Anlage sind groesser (Undo-Pattern),
      // deshalb haengen wir hier nur Navigation + ein paar Hinweise dran.
      // Volle Cell-Operationen kommen in einem spaeteren Sub-Sprint.
      items.push({
        label: 'Zelle oeffnen',
        icon: '→',
        onClick: () => navigate(hrefOf(props.workspaceId, entry)),
      });
      if (entry.cell.alias) {
        items.push({
          label: `Alias: ^${entry.cell.alias}`,
          icon: '^',
          disabled: true,
          onClick: () => {},
        });
      }
    }

    const badge = entry.kind === 'node'
      ? entry.node.type === 'matrix'
        ? '▦'
        : '▤'
      : '·';

    setCtxMenu({
      x,
      y,
      sourceEl: rowEl,
      headerBadge: badge,
      headerLabel: labelOf(entry),
      items,
    });
  }

  return (
    <div class="node-tree">
      <div class="node-tree-head">
        <span class="node-tree-label">Struktur</span>
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
            {(entry) => (
              <TreeItem
                workspaceId={props.workspaceId}
                entry={entry}
                currentNodeId={props.currentNodeId}
                depth={0}
                expand={expand}
                query={query().trim()}
                openMenu={openMenu}
              />
            )}
          </For>
        </ul>
      </Show>
      <ContextMenu state={ctxMenu()} onClose={() => setCtxMenu(null)} />
    </div>
  );
};

export default NodeTree;
