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
import { deleteNode, moveCardToBoard, renameNode } from '../lib/mutations';
import { cellTarget } from '../lib/alias-dispatch';
import { supabase } from '../lib/supabase';
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

// Dot-Typ-Schluessel fuer die SVG-Verbindungslinien. Entspricht den
// .ln-<type>/.dot-<type>-CSS-Klassen in der tree-connections-Schicht.
// matrix=blau, board=teal, cell=amber. Erweiterungsfaehig um feature-
// Ebene (info/checklists/cellbox) wenn die Sidebar-Extension kommt.
function dotTypeFor(entry: TreeEntry): 'matrix' | 'board' | 'cell' {
  if (entry.kind === 'node') {
    return entry.node.type === 'matrix' ? 'matrix' : 'board';
  }
  return 'cell';
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

// Chip-Filter-Kinds: Teilmenge der TreeEntry-Auspraegungen, nach denen
// der User die Sidebar crunchen kann. Ports das Chip-Filter-Konzept aus
// dem HTML-Vorbild (dort: matrices / cards / checklists / infos).
type FilterChip = 'matrix' | 'board' | 'cell';

// Filtert den Tree nach Text + aktiven Chip-Filter. Ein Entry
// qualifiziert, wenn BEIDES zutrifft (Text matcht UND Entry-Kind ist
// im aktiven Set). Ancestors bleiben sichtbar, damit der Pfad sichtbar
// ist; bei einem Self-Match zeigen wir den ganzen Subtree mit.
function filterTree(
  tree: TreeEntry[],
  q: string,
  chips: Set<FilterChip>,
): TreeEntry[] {
  if (!q && chips.size === 0) return tree;
  const query = q.toLowerCase();

  function entryKindKey(e: TreeEntry): FilterChip {
    if (e.kind === 'cell') return 'cell';
    return e.node.type === 'matrix' ? 'matrix' : 'board';
  }

  const walk = (items: TreeEntry[]): TreeEntry[] => {
    const out: TreeEntry[] = [];
    for (const it of items) {
      const label = labelOf(it).toLowerCase();
      const alias = (aliasOf(it) || '').toLowerCase();
      const textMatch = !query || label.includes(query) || alias.includes(query);
      const kindMatch = chips.size === 0 || chips.has(entryKindKey(it));
      const selfMatch = textMatch && kindMatch;

      const childMatches = walk(it.children);
      if (selfMatch) {
        // Self-Match: ganzer Subtree ungefiltert anzeigen, der User
        // will den Kontext unter dem Treffer sehen.
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
  parentId?: string;
  expand: ReturnType<typeof useTreeExpand>;
  query: string;
  activePath: Set<string>;
  openMenu: (entry: TreeEntry, rowEl: HTMLElement, x: number, y: number) => void;
  dragOverBoardId: () => string | null;
  onCardDragOver: (boardId: string, e: DragEvent) => void;
  onCardDragLeave: (boardId: string) => void;
  onCardDrop: (boardId: string, e: DragEvent) => void;
}> = (p) => {
  const hasChildren = () => p.entry.children.length > 0;
  // Expand-Regeln in Reihenfolge (HTML-Parity, siehe sbExpanded-Logik
  // matrix_tool_beta.html Z2654):
  //   1. Filter aktiv → alles offen (Pfad zu Treffern)
  //   2. User-Toggle (persisted) → explizit offen
  //   3. Active-Path → auto-expanded (Pfad zur currentNodeId)
  // Die aktive Node selbst ist nicht im activePath-Set — so kann der
  // User sie explizit einklappen, ohne dass sie sich sofort wieder
  // aufklappt.
  const expanded = () => {
    if (p.query) return true;
    if (p.expand.isExpanded(p.entry.id)) return true;
    if (p.activePath.has(p.entry.id)) return true;
    return false;
  };

  let rowRef: HTMLDivElement | undefined;

  const dotStyle = { background: dotColorFor(p.entry) };
  const isBoard = () =>
    p.entry.kind === 'node' && p.entry.node.type === 'board';

  return (
    <li>
      <div
        ref={rowRef}
        class="tree-row"
        classList={{
          'tree-row-drop': isBoard() && p.dragOverBoardId() === p.entry.id,
        }}
        data-entry-kind={p.entry.kind}
        data-node-type={p.entry.kind === 'node' ? p.entry.node.type : undefined}
        data-tree-id={p.entry.id}
        data-tree-parent={p.parentId ?? ''}
        data-tree-depth={p.depth}
        data-dot-type={dotTypeFor(p.entry)}
        style={{
          'padding-left': `${p.depth * 12 + 4}px`,
          '--tree-depth': p.depth,
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (rowRef) p.openMenu(p.entry, rowRef, e.clientX, e.clientY);
        }}
        onDragOver={(e) => {
          if (isBoard()) p.onCardDragOver(p.entry.id, e);
        }}
        onDragLeave={() => {
          if (isBoard()) p.onCardDragLeave(p.entry.id);
        }}
        onDrop={(e) => {
          if (isBoard()) p.onCardDrop(p.entry.id, e);
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
            // Active auf Node- UND Cell-Routen: currentNodeId kommt
            // entweder aus /n/:nodeId oder aus /c/:cellId. Beide matchen
            // auf entry.id (Nodes: node.id, Cells: cell.id).
            active: p.entry.id === p.currentNodeId,
          }}
          data-tree-entry-id={p.entry.id}
          data-tree-has-children={hasChildren() ? 'yes' : 'no'}
          data-tree-expanded={expanded() ? 'yes' : 'no'}
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
                parentId={p.entry.id}
                expand={p.expand}
                query={p.query}
                activePath={p.activePath}
                openMenu={p.openMenu}
                dragOverBoardId={p.dragOverBoardId}
                onCardDragOver={p.onCardDragOver}
                onCardDragLeave={p.onCardDragLeave}
                onCardDrop={p.onCardDrop}
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
  const [chips, setChips] = createSignal<Set<FilterChip>>(new Set());
  const [ctxMenu, setCtxMenu] = createSignal<CtxMenuState | null>(null);
  const [dragOverBoardId, setDragOverBoardId] = createSignal<string | null>(null);
  let inputRef: HTMLInputElement | undefined;
  let scrollRef: HTMLDivElement | undefined;
  let svgRef: SVGSVGElement | undefined;

  // SVG-Verbindungslinien zeichnen — portiert aus sbDrawConnections
  // (matrix_tool_beta.html ~Z2935). Drei Schichten:
  //   - Own-Rail:    grau, vertikal durch Parent-Dot → bis letztes Descendant
  //   - Sibling-Rail: grau, vertikal bei Child-x zwischen 1. + letztem Kind
  //   - Split-Curve:  farbig (Kind-Typ), Bezier Parent-Dot → erster Kind-Dot
  // Dots oben drauf, farbig per dot-<type>. Die data-tree-*-Attribute
  // an den .tree-row-Nodes liefern id/parent/depth/dotType.
  //
  // Abweichung zum HTML-Vorbild: dort sassen Nodes in einem festen
  // Grid — cx war per `depth*INDENT + DOT_IN_SLOT` berechenbar. Unser
  // SolidJS-Client nutzt flex + padding-left, deshalb messen wir die
  // Position des inline `.tree-dot`-Spans pro Row direkt via
  // getBoundingClientRect. Der inline-Dot wird via CSS unsichtbar
  // gemacht (opacity:0), haelt aber die Layout-Reserve — der SVG-Dot
  // zeichnet sich exakt ueber seinen Platz.
  function drawConnections() {
    if (!scrollRef || !svgRef) return;
    const rootUl = scrollRef.querySelector<HTMLElement>('.tree-root');
    if (!rootUl) {
      svgRef.innerHTML = '';
      return;
    }
    const w = rootUl.clientWidth;
    const h = rootUl.scrollHeight;
    if (w <= 1 || h <= 1) return;
    svgRef.setAttribute('width', String(w));
    svgRef.setAttribute('height', String(h));
    svgRef.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svgRef.style.width = `${w}px`;
    svgRef.style.height = `${h}px`;
    svgRef.style.top = `${rootUl.offsetTop}px`;
    svgRef.style.left = `${rootUl.offsetLeft}px`;

    const rootRect = rootUl.getBoundingClientRect();
    const rows = Array.from(
      scrollRef.querySelectorAll<HTMLElement>('.tree-row'),
    );

    type Meta = {
      cx: number;
      cy: number;
      depth: number;
      dotType: string;
      el: HTMLElement;
    };
    const meta = new Map<string, Meta>();
    const byParent = new Map<string, string[]>();
    // cx pro Depth LINEAR berechnen — nicht aus dem inline-Dot messen.
    // Der inline-Dot sitzt je nach Chevron-Typ und Link-Padding an
    // leicht anderer x-Position, was die Split-Curves optisch
    // asymmetrisch macht (manche Kurven lang, manche gequetscht).
    // Mit festem INDENT=14 sind alle Kurven identisch breit.
    const INDENT = 14;
    const ORIGIN_X = 14;
    rows.forEach((el) => {
      const id = el.dataset.treeId;
      if (!id) return;
      const parent = el.dataset.treeParent || '';
      const depth = parseInt(el.dataset.treeDepth || '0', 10);
      const dotType = el.dataset.dotType || 'matrix';
      const r = el.getBoundingClientRect();
      const cx = depth * INDENT + ORIGIN_X;
      const cy = r.top + r.height / 2 - rootRect.top;
      meta.set(id, { cx, cy, depth, dotType, el });
      if (parent) {
        if (!byParent.has(parent)) byParent.set(parent, []);
        byParent.get(parent)!.push(id);
      }
    });

    function lastDescendantCy(nodeId: string): number {
      const kids = byParent.get(nodeId);
      if (!kids || kids.length === 0) {
        const m = meta.get(nodeId);
        return m ? m.cy : -Infinity;
      }
      let maxY = -Infinity;
      for (const cid of kids) {
        const y = lastDescendantCy(cid);
        if (y > maxY) maxY = y;
      }
      return maxY;
    }

    const activeId = props.currentNodeId;
    let rails = '';
    let splits = '';
    byParent.forEach((kids, parentId) => {
      const pm = meta.get(parentId);
      if (!pm) return;
      const firstMeta = meta.get(kids[0]);
      const lastMeta = meta.get(kids[kids.length - 1]);
      if (!firstMeta || !lastMeta) return;
      const ownLastY = lastDescendantCy(parentId);
      if (ownLastY > pm.cy + 3) {
        rails += `<path class="ln-rail" d="M ${pm.cx} ${pm.cy} L ${pm.cx} ${ownLastY}"/>`;
      }
      const railX = firstMeta.cx;
      if (kids.length > 1 && lastMeta.cy > firstMeta.cy) {
        rails += `<path class="ln-rail" d="M ${railX} ${firstMeta.cy} L ${railX} ${lastMeta.cy}"/>`;
      }
      const py = pm.cy;
      const cyFirst = firstMeta.cy;
      const d = `M ${pm.cx} ${py + 3} C ${pm.cx} ${cyFirst}, ${railX} ${cyFirst - 6}, ${railX} ${cyFirst}`;
      splits += `<path class="ln-split ln-${firstMeta.dotType}" d="${d}"/>`;
    });

    let dots = '';
    meta.forEach((m, id) => {
      const isActive = id === activeId;
      const r = isActive ? 4.2 : 3;
      const activeCls = isActive ? ' dot-active' : '';
      dots += `<circle class="tree-dot-svg dot-${m.dotType}${activeCls}" cx="${m.cx}" cy="${m.cy}" r="${r}"/>`;
    });

    svgRef.innerHTML = rails + splits + dots;
  }

  // Effect weiter unten, nach filtered() registriert (Use-Before-Decl).

  // Card-Drop auf Board-Eintraege in der Sidebar (cross-board move).
  // BoardView setzt den Card-ID auf text/matrix-card-id; wir holen ihn
  // im Drop-Handler, laden die Ziel-Board-Cols, und verschieben die
  // Karte an die erste Spalte ans Ende.
  function onCardDragOver(boardId: string, e: DragEvent) {
    if (!e.dataTransfer) return;
    const types = Array.from(e.dataTransfer.types);
    if (!types.includes('text/matrix-card-id') && !types.includes('text/plain')) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverBoardId() !== boardId) setDragOverBoardId(boardId);
  }
  function onCardDragLeave(boardId: string) {
    if (dragOverBoardId() === boardId) setDragOverBoardId(null);
  }
  async function onCardDrop(boardId: string, e: DragEvent) {
    e.preventDefault();
    setDragOverBoardId(null);
    if (!e.dataTransfer) return;
    const cardId =
      e.dataTransfer.getData('text/matrix-card-id') ||
      e.dataTransfer.getData('text/plain');
    if (!cardId) return;

    try {
      // Ziel-Spalten + hoechste Position in deren ersten Spalte laden.
      const [colsRes] = await Promise.all([
        supabase
          .from('kb_cols')
          .select('id, position')
          .eq('board_id', boardId)
          .eq('workspace_id', props.workspaceId)
          .order('position', { ascending: true })
          .limit(1),
      ]);
      if (colsRes.error) throw colsRes.error;
      const firstCol = (colsRes.data ?? [])[0] as
        | { id: string; position: number }
        | undefined;
      if (!firstCol) {
        showToast('Ziel-Board hat keine Spalte.', 'error');
        return;
      }

      const posRes = await supabase
        .from('kb_cards')
        .select('position')
        .eq('col_id', firstCol.id)
        .eq('workspace_id', props.workspaceId)
        .order('position', { ascending: false })
        .limit(1);
      if (posRes.error) throw posRes.error;
      const topPos =
        posRes.data && posRes.data.length > 0
          ? (posRes.data[0] as { position: number }).position
          : -1;

      await moveCardToBoard(cardId, boardId, firstCol.id, topPos + 1);
      showToast('Karte verschoben.', 'success');
    } catch (err) {
      showToast(translateDbError(err), 'error');
    }
  }

  function toggleChip(chip: FilterChip) {
    const cur = chips();
    const next = new Set(cur);
    if (next.has(chip)) next.delete(chip);
    else next.add(chip);
    setChips(next);
  }

  // Einmalig seeden, sobald der Tree Daten hat. Bei neuen Workspaces
  // heisst das: Root-Ebene offen, Rest zu.
  createEffect(() => {
    const roots = props.tree;
    if (roots.length === 0) return;
    expand.seedIfFresh(roots.map((r) => r.id));
  });

  const filtered = createMemo(() =>
    filterTree(props.tree, query().trim(), chips()),
  );

  // Active-Path: Set aller Ancestor-IDs, die zur currentNodeId fuehren.
  // Wird im TreeItem benutzt, um Pfad zur aktiven Node automatisch
  // aufzuklappen (Port aus HTML `activePath`/`sbExpanded` auto-expand,
  // siehe matrix_tool_beta.html Z2621-2654). Die aktive Node selbst
  // ist NICHT im Set — nur ihre Eltern. So bleibt sie collapsed, wenn
  // der User explizit ihren eigenen Chevron einklappt.
  const activePath = createMemo<Set<string>>(() => {
    const target = props.currentNodeId;
    if (!target) return new Set();
    const path = new Set<string>();
    // Rekursiv durch den Tree laufen: wenn wir eine Node finden deren
    // id === target, geben wir true zurueck + der Caller fuegt sich
    // selbst hinzu (NOT target selbst, damit man den Self-Collapse
    // behalten kann). Bei Cells tragen wir Parent-Cell + Matrix ein.
    function walk(entries: TreeEntry[]): boolean {
      for (const e of entries) {
        if (e.id === target) return true;
        if (e.children.length === 0) continue;
        if (walk(e.children)) {
          path.add(e.id);
          return true;
        }
      }
      return false;
    }
    walk(props.tree);
    return path;
  });

  // SVG-Linien neu zeichnen bei jeder State-Aenderung, die Rows zeigt/
  // versteckt/verschiebt. requestAnimationFrame wartet auf DOM-Flush.
  createEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    filtered();
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    props.currentNodeId;
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    expand.state();
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    query();
    requestAnimationFrame(() => drawConnections());
  });

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

  // Keyboard-Nav im Tree. ArrowUp/ArrowDown zwischen sichtbaren Tree-
  // Links; ArrowLeft/ArrowRight expand/collapse; Home/End zum ersten/
  // letzten Link. Enter/Space bleibt dem A-Tag ueberlassen (Browser-
  // Default = navigate). "+" / F10 / ContextMenu-Key fuer das Menu ist
  // per-item Handler.
  function handleTreeKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    const link = target?.closest<HTMLElement>('.tree-link');
    if (!link) return;

    // Alle sichtbaren tree-links in DOM-Reihenfolge sammeln.
    const container = link.closest('.tree-root');
    if (!container) return;
    const links = Array.from(
      container.querySelectorAll<HTMLElement>('.tree-link'),
    );
    const idx = links.indexOf(link);
    if (idx < 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      links[Math.min(links.length - 1, idx + 1)]?.focus();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      links[Math.max(0, idx - 1)]?.focus();
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      links[0]?.focus();
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      links[links.length - 1]?.focus();
      return;
    }
    if (e.key === 'ArrowRight') {
      const entryId = link.dataset.treeEntryId;
      const hasKids = link.dataset.treeHasChildren === 'yes';
      const isOpen = link.dataset.treeExpanded === 'yes';
      if (hasKids && !isOpen && entryId) {
        e.preventDefault();
        expand.toggle(entryId);
        return;
      }
      // Schon offen: Springe zum ersten Kind (naechster Link in DOM-
      // Reihenfolge, sofern vorhanden).
      if (hasKids && isOpen) {
        e.preventDefault();
        links[Math.min(links.length - 1, idx + 1)]?.focus();
      }
      return;
    }
    if (e.key === 'ArrowLeft') {
      const entryId = link.dataset.treeEntryId;
      const hasKids = link.dataset.treeHasChildren === 'yes';
      const isOpen = link.dataset.treeExpanded === 'yes';
      if (hasKids && isOpen && entryId) {
        e.preventDefault();
        expand.toggle(entryId);
        return;
      }
      // Bereits geschlossen / Leaf: Fokus auf den Parent-Link. Den
      // finden wir ueber .closest('li').parentElement ... aber einfacher:
      // der naeheste vorherige Link mit niedrigerer Einrueckung.
      const linkDepth = parseInt(
        link.closest<HTMLElement>('.tree-row')?.style.paddingLeft || '0',
        10,
      );
      for (let j = idx - 1; j >= 0; j--) {
        const r = links[j].closest<HTMLElement>('.tree-row');
        if (!r) continue;
        const rd = parseInt(r.style.paddingLeft || '0', 10);
        if (rd < linkDepth) {
          e.preventDefault();
          links[j].focus();
          return;
        }
      }
    }
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
      <div class="node-tree-chips" role="toolbar" aria-label="Typ-Filter">
        <button
          type="button"
          class="tree-chip"
          classList={{ active: chips().has('matrix') }}
          data-chip="matrix"
          onClick={() => toggleChip('matrix')}
          title="Nur Matrizen zeigen"
        >
          ▦ Matrix
        </button>
        <button
          type="button"
          class="tree-chip"
          classList={{ active: chips().has('board') }}
          data-chip="board"
          onClick={() => toggleChip('board')}
          title="Nur Boards zeigen"
        >
          ▤ Board
        </button>
        <button
          type="button"
          class="tree-chip"
          classList={{ active: chips().has('cell') }}
          data-chip="cell"
          onClick={() => toggleChip('cell')}
          title="Nur Zellen zeigen"
        >
          · Zellen
        </button>
      </div>
      <div class="node-tree-scroll" ref={scrollRef}>
      <svg
        class="tree-connections"
        ref={svgRef}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      />
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
        <ul class="tree-root" onKeyDown={handleTreeKeyDown}>
          <For each={filtered()}>
            {(entry) => (
              <TreeItem
                workspaceId={props.workspaceId}
                entry={entry}
                currentNodeId={props.currentNodeId}
                depth={0}
                expand={expand}
                query={query().trim()}
                activePath={activePath()}
                openMenu={openMenu}
                dragOverBoardId={dragOverBoardId}
                onCardDragOver={onCardDragOver}
                onCardDragLeave={onCardDragLeave}
                onCardDrop={onCardDrop}
              />
            )}
          </For>
        </ul>
      </Show>
      </div>
      <ContextMenu state={ctxMenu()} onClose={() => setCtxMenu(null)} />
    </div>
  );
};

export default NodeTree;
