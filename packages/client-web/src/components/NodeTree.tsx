import { A, useNavigate } from '@solidjs/router';
import { type Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cellTarget } from '../lib/alias-dispatch';
import type { ParsedPasteItem } from '../lib/checklist-paste-parse';
import { decryptPayload, isEncrypted } from '../lib/crypto';
import { showChoice, showPrompt } from '../lib/dialog';
import { openDocsPopup } from '../lib/docs-ui';
import { bindDragSource } from '../lib/drag-context';
import { useEditMode } from '../lib/edit-mode';
import { translateDbError } from '../lib/errors';
import {
  type WorkspaceExport,
  downloadSubtreeExport,
  exportCellSubtree,
  exportFeatureChecklists,
  exportFeatureInfo,
  exportSubtree,
  summarizeExport,
} from '../lib/export';
import { type ContextMaps, resolveNodeLabel } from '../lib/label-template';
import type { WorkspaceMember } from '../lib/members';
import {
  addCellChecklist,
  addCellInfoField,
  addCellLink,
  bulkAddChecklistItems,
  deleteNode,
  moveCardToBoard,
  renameNode,
  restoreNode,
  updateCell,
} from '../lib/mutations';
import type { PresenceUser } from '../lib/presence';
import { presenceMatchesEntry } from '../lib/presence-filter';
import { endProgress, startProgress } from '../lib/progress';
import { fetchBoardCardDropTarget } from '../lib/queries';
import { useVis } from '../lib/settings';
import { useSidebarChips } from '../lib/sidebar-chips';
import {
  ImportError,
  type ImportMode,
  type ImportTarget,
  checkTypeCompatibility,
  executeFeatureChecklistsImport,
  executeFeatureInfoImport,
  executeSubtreeImportIntoBoard,
  executeSubtreeImportIntoCell,
  executeSubtreeImportIntoMatrix,
  parseImportPayload,
} from '../lib/subtree-import';
import { showToast, showUndoToast } from '../lib/toasts';
import { useTreeExpand } from '../lib/tree-expand';
import type { CellFeature, CellRow, TreeEntry } from '../lib/types';
import { sanitizeUrl } from '../lib/url';
import { runResetScope } from '../lib/workspace-reset';
import { useViewerActive } from '../lib/workspace-role';
import ChecklistPastePopup from './ChecklistPastePopup';
import ContextMenu, { type CtxMenuState } from './ContextMenu';
import Icon, { type IconName } from './Icon';
import TreeAvatar from './TreeAvatar';
import TreeAvatarStack from './TreeAvatarStack';

// Verschluesselter Export ueber Passphrase-Prompt. Wird vom Kontext-
// menue der Node/Cell/Feature-Rows aufgerufen. Plain-Variante laeuft
// weiter ueber den existierenden 'Exportieren'-Eintrag — IMX ist die
// Zusatz-Option fuer Backups, die der User unverschluesselt nicht
// aus der Hand geben will.
async function runEncryptedExport(args: {
  getData: () => Promise<WorkspaceExport>;
  filenameLabel: string;
  promptTitle?: string;
}): Promise<void> {
  const pw = await showPrompt({
    title: args.promptTitle ?? 'Verschluesselt exportieren',
    message:
      'Passphrase fuer .imx-Datei. Ohne diese Passphrase ist der Export nicht mehr lesbar — sicher aufbewahren.',
    placeholder: 'Passphrase…',
    confirmLabel: 'Exportieren',
    inputType: 'password',
  });
  if (pw === null) return;
  if (!pw.trim()) {
    showToast('Passphrase darf nicht leer sein.', 'error');
    return;
  }
  try {
    const data = await args.getData();
    await downloadSubtreeExport(data, args.filenameLabel, { passphrase: pw });
    showToast(`Verschluesselt exportiert — ${summarizeExport(data)}`, 'success');
  } catch (err) {
    console.error('downloadEncryptedSubtree:', err);
    showToast(translateDbError(err), 'error');
  }
}

type Props = {
  workspaceId: string;
  tree: TreeEntry[];
  currentNodeId: string | undefined;
  // Feature-Segment bei /c/:cellId/:feature-Routen. Nur gesetzt, wenn
  // der User gerade auf einer Cell-Page mit konkretem Feature steht —
  // damit markieren wir die passende Feature-Row als aktiv.
  currentFeature?: 'info' | 'checklists' | 'docs';
  // Trigger fuer Parent-Refetch nach Mutationen aus dem Sidebar-
  // Kontextmenue (neue Felder, Checklisten, Feature-Flags). Parent
  // weiss, welche Queries invalidiert werden muessen.
  onChanged?: () => void;
  // NT.1: Presence-Accessor aus Workspace.tsx-Hoist. Pro Tree-Row
  // matchen wir die User auf den Knoten/Cell/Feature und rendern einen
  // Mini-Avatar-Stack rechts neben dem Alias-Chip.
  presence?: () => PresenceUser[];
  selfUserId?: string;
  // NT.3: Workspace-Members fuer den Creator-Avatar (Lookup von
  // node.created_by-uuid -> Member-Record).
  members?: () => WorkspaceMember[];
  // Phase 3 O.8: Resolver-Maps fuer Name-Templates. Wenn gesetzt,
  // rendert labelOf() Templates (`{row.object}` / `{column.object}`)
  // live aus parent_cell-Kette. Default-Fallback: legacy node.label.
  resolverMaps?: () => ContextMaps;
};

// Icon-Lookup nach Entry-Kind / Node-Type. Feature-Rows gibt es nur
// fuer info/checklists — matrix/board-Sub-Strukturen haengen als Node-
// Entry direkt unter der Cell, keine Zwischen-Row.
function iconNameFor(entry: TreeEntry): IconName {
  if (entry.kind === 'node') {
    return entry.node.type === 'matrix' ? 'squares-2x2' : 'view-columns';
  }
  if (entry.kind === 'feature') {
    return entry.feature === 'info' ? 'information-circle' : 'check-circle';
  }
  if (entry.kind === 'link') {
    return entry.linkType === 'mail' ? 'envelope' : 'arrow-top-right-on-square';
  }
  if (entry.kind === 'doc') return 'document-text';
  // Cells: kleiner ausgefuellter Punkt
  return 'dot-filled';
}

function dotColorFor(entry: TreeEntry): string {
  if (entry.kind === 'node') {
    return entry.node.type === 'matrix' ? 'var(--blue)' : 'var(--teal)';
  }
  if (entry.kind === 'feature') {
    return entry.feature === 'info' ? 'var(--amber)' : 'var(--purple)';
  }
  if (entry.kind === 'link') {
    return entry.linkType === 'mail' ? 'var(--amber)' : 'var(--text3)';
  }
  if (entry.kind === 'doc') return 'var(--amber)';
  return 'var(--amber)';
}

// Dot-Typ-Schluessel fuer die SVG-Verbindungslinien. Entspricht den
// .ln-<type>/.dot-<type>-CSS-Klassen in der tree-connections-Schicht.
function dotTypeFor(
  entry: TreeEntry,
): 'matrix' | 'board' | 'cell' | 'info' | 'checklists' | 'link' | 'mail' | 'doc' {
  if (entry.kind === 'node') {
    return entry.node.type === 'matrix' ? 'matrix' : 'board';
  }
  if (entry.kind === 'feature') {
    return entry.feature;
  }
  if (entry.kind === 'link') {
    return entry.linkType === 'mail' ? 'mail' : 'link';
  }
  if (entry.kind === 'doc') return 'doc';
  return 'cell';
}

// Label fuer Feature-Rows. Deutsch + kurz — tree-label-text kann sie bei
// Bedarf truncaten.
const FEATURE_LABEL: Record<'info' | 'checklists', string> = {
  info: 'Info',
  checklists: 'Checklisten',
};

function labelOf(entry: TreeEntry, maps: ContextMaps | null): string {
  if (entry.kind === 'node') {
    // Phase 3 O.8: Template-Resolver wenn Maps verfuegbar; Fallback
    // legacy `node.label` falls Resolver-Maps nicht verkabelt sind
    // (z.B. Component-Verwendung ohne resolverMaps-Prop).
    if (maps) return resolveNodeLabel(entry.node, maps) || '(ohne Label)';
    return entry.node.label || '(ohne Label)';
  }
  if (entry.kind === 'feature') return FEATURE_LABEL[entry.feature];
  if (entry.kind === 'link') return entry.label;
  if (entry.kind === 'doc') return entry.title;
  return `${entry.rowLabel} / ${entry.colLabel}`;
}

function aliasOf(entry: TreeEntry): string | null {
  if (entry.kind === 'node') return entry.node.alias;
  if (entry.kind === 'feature') return null;
  if (entry.kind === 'link') return entry.alias;
  if (entry.kind === 'doc') return entry.alias;
  return entry.cell.alias;
}

function hrefOf(workspaceId: string, entry: TreeEntry): string {
  if (entry.kind === 'node') return `/w/${workspaceId}/n/${entry.id}`;
  if (entry.kind === 'feature') {
    return `/w/${workspaceId}/c/${entry.cellId}/${entry.feature}`;
  }
  if (entry.kind === 'link') {
    // External-Link oeffnet target=_blank; fuer mail mailto-URL.
    // Render-Pfad-Sanitization: ein `javascript:`-Wert, der ueber Bridge
    // oder Import (vor dem A1.4-Fix) in `links.url` landet, darf hier
    // nicht zum klickbaren XSS-Vehikel werden — `sanitizeUrl` liefert
    // null fuer non-allowlisted Schemes, dann lassen wir den href leer.
    const safe = sanitizeUrl(entry.url) ?? '';
    return entry.linkType === 'mail' ? `mailto:${safe}` : safe;
  }
  if (entry.kind === 'doc') {
    // Docs haben keine eigene Route im client-web — wir triggern das
    // Docs-Popup ueber ?doc=<id>-Param, das Workspace.tsx auswertet.
    return `/w/${workspaceId}?doc=${entry.docId}`;
  }
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
  maps: ContextMaps | null,
): TreeEntry[] {
  if (!q && chips.size === 0) return tree;
  const query = q.toLowerCase();

  function entryKindKey(e: TreeEntry): FilterChip {
    if (e.kind === 'cell') return 'cell';
    if (e.kind === 'feature' || e.kind === 'link' || e.kind === 'doc') {
      // Feature/Link/Doc-Rows sind keine eigene Chip-Kategorie in der
      // Filter-Leiste (die SB.2-Chips sind eine andere Dimension). In
      // den Matrix/Board/Cell-Filter-Chips mappen wir sie auf 'cell',
      // weil sie an Cells haengen.
      return 'cell';
    }
    return e.node.type === 'matrix' ? 'matrix' : 'board';
  }

  const walk = (items: TreeEntry[]): TreeEntry[] => {
    const out: TreeEntry[] = [];
    for (const it of items) {
      const label = labelOf(it, maps).toLowerCase();
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
  currentFeature?: 'info' | 'checklists' | 'docs';
  depth: number;
  parentId?: string;
  expand: ReturnType<typeof useTreeExpand>;
  query: string;
  activePath: Set<string>;
  openMenu: (entry: TreeEntry, rowEl: HTMLElement, x: number, y: number) => void;
  onPasteChecklist: (cellId: string) => void;
  dragOverBoardId: () => string | null;
  onCardDragOver: (boardId: string, e: DragEvent) => void;
  onCardDragLeave: (boardId: string) => void;
  onCardDrop: (boardId: string, e: DragEvent) => void;
  presence?: () => PresenceUser[];
  selfUserId?: string;
  members?: () => WorkspaceMember[];
  // Phase 3 O.8: Resolver-Maps (s. Component-Props oben). Wird durch
  // den Tree gereicht damit jede TreeItem Templates aufloesen kann.
  resolverMaps?: () => ContextMaps;
}> = (p) => {
  // Presence-User die gerade in genau dieser Row sind. Selbst raus —
  // den eigenen Avatar im Tree zu sehen waere visueller Lärm, der
  // grosse PresenceStack im Header zeigt einen schon.
  const presenceForRow = createMemo<PresenceUser[]>(() => {
    const all = p.presence?.() ?? [];
    if (all.length === 0) return [];
    return all.filter((u) => u.userId !== p.selfUserId && presenceMatchesEntry(u, p.entry));
  });

  // Creator-Avatar nur fuer kind:'node' (Matrix/Board-Knoten haben
  // created_by). Cells/Features/Links/Docs haben kein Erstellungs-User-
  // Tracking — wuerde mit der gleichen Strenge mehr Markup als Nutzen
  // geben.
  const creator = createMemo<WorkspaceMember | null>(() => {
    if (p.entry.kind !== 'node') return null;
    const uid = p.entry.node.created_by;
    if (!uid) return null;
    const list = p.members?.() ?? [];
    return list.find((m) => m.user_id === uid) ?? null;
  });
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
  const isBoard = () => p.entry.kind === 'node' && p.entry.node.type === 'board';
  const isLink = () => p.entry.kind === 'link';

  // T.AC.B: Link-Rows als Drag-Source. atom='link' → Drop-Targets im
  // Calendar legen eine atom_manifestation (atom_type='link') an.
  const linkDrag = bindDragSource({
    build: () =>
      p.entry.kind === 'link'
        ? {
            atom: 'link',
            atomId: p.entry.id,
            label: p.entry.label,
          }
        : null,
  });

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
          /* 16px pro Depth-Level. Base-Offset 4px damit das Chevron
             nicht ganz am Rand klebt. */
          'padding-left': `${p.depth * 16 + 4}px`,
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
            <Icon name="chevron-right" size={14} />
          </button>
        </Show>
        <Dynamic
          component={p.entry.kind === 'link' || p.entry.kind === 'doc' ? 'a' : A}
          href={p.entry.kind === 'doc' ? '#' : hrefOf(p.workspaceId, p.entry)}
          target={p.entry.kind === 'link' && p.entry.linkType === 'url' ? '_blank' : undefined}
          rel={
            p.entry.kind === 'link' && p.entry.linkType === 'url'
              ? 'noopener noreferrer'
              : undefined
          }
          draggable={isLink() ? true : undefined}
          onDragStart={isLink() ? linkDrag.onDragStart : undefined}
          onDragEnd={isLink() ? linkDrag.onDragEnd : undefined}
          onClick={
            p.entry.kind === 'doc'
              ? (e: MouseEvent) => {
                  e.preventDefault();
                  openDocsPopup({
                    initialDocId: (p.entry as Extract<TreeEntry, { kind: 'doc' }>).docId,
                  });
                }
              : undefined
          }
          class="tree-link"
          classList={{
            // Active auf Node- UND Cell-Routen: currentNodeId kommt
            // entweder aus /n/:nodeId oder aus /c/:cellId. Beide matchen
            // auf entry.id (Nodes: node.id, Cells: cell.id).
            // Feature-Rows sind aktiv, wenn die Cell-Route die passende
            // Section (info/checklists/docs) zeigt UND cellId matcht.
            // Fuer docs/info faellt currentFeature=undefined auf die
            // Cell-Row zurueck (old Behaviour).
            active:
              p.entry.kind === 'feature'
                ? p.entry.cellId === p.currentNodeId &&
                  (p.currentFeature as string | undefined) === p.entry.feature
                : p.entry.id === p.currentNodeId &&
                  // Wenn eine Feature-Row bereits die aktive Darstellung
                  // beansprucht, soll die Cell-Row darueber NICHT doppelt
                  // als active markiert werden.
                  !p.currentFeature,
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
              return;
            }
            // Ctrl+V auf einer checklists-Feature-Row → Paste-Flow fuer
            // neue Checkliste. Nur einfangen, wenn das Event auf dem
            // Link selbst ist (kein Input-Fokus, das ist die einzige
            // A-Tag-Variante im Tree).
            if (
              (e.ctrlKey || e.metaKey) &&
              !e.shiftKey &&
              !e.altKey &&
              (e.key === 'v' || e.key === 'V') &&
              p.entry.kind === 'feature' &&
              p.entry.feature === 'checklists'
            ) {
              e.preventDefault();
              p.onPasteChecklist(p.entry.cellId);
            }
          }}
        >
          <span class="tree-dot" aria-hidden="true" style={dotStyle} />
          <span class="tree-ico" aria-hidden="true">
            <Icon name={iconNameFor(p.entry)} size={14} />
          </span>
          <span class="tree-label">
            <For each={highlightLabel(labelOf(p.entry, p.resolverMaps?.() ?? null), p.query)}>
              {(part) =>
                typeof part === 'string' ? <>{part}</> : <mark class="tree-match">{part.m}</mark>
              }
            </For>
          </span>
          <Show when={aliasOf(p.entry)}>
            <span class="tree-alias">^{aliasOf(p.entry)}</span>
          </Show>
        </Dynamic>
        <Show when={p.entry.kind === 'node'}>
          <TreeAvatar member={creator()} workspaceId={p.workspaceId} />
        </Show>
        <TreeAvatarStack users={presenceForRow()} />
      </div>
      <Show when={hasChildren() && expanded()}>
        <ul>
          <For each={p.entry.children}>
            {(child) => (
              <TreeItem
                workspaceId={p.workspaceId}
                entry={child}
                currentNodeId={p.currentNodeId}
                currentFeature={p.currentFeature}
                depth={p.depth + 1}
                parentId={p.entry.id}
                expand={p.expand}
                query={p.query}
                activePath={p.activePath}
                openMenu={p.openMenu}
                onPasteChecklist={p.onPasteChecklist}
                dragOverBoardId={p.dragOverBoardId}
                onCardDragOver={p.onCardDragOver}
                onCardDragLeave={p.onCardDragLeave}
                onCardDrop={p.onCardDrop}
                presence={p.presence}
                selfUserId={p.selfUserId}
                members={p.members}
                resolverMaps={p.resolverMaps}
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
  const deepChips = useSidebarChips(props.workspaceId);
  const navigate = useNavigate();
  const viewerActive = useViewerActive();
  const [query, setQuery] = createSignal('');
  const [chips, setChips] = createSignal<Set<FilterChip>>(new Set());
  const [ctxMenu, setCtxMenu] = createSignal<CtxMenuState | null>(null);
  const [dragOverBoardId, setDragOverBoardId] = createSignal<string | null>(null);
  // Paste-Dialog-State: wenn gesetzt, wird ChecklistPastePopup fuer das
  // Anlegen einer neuen Checkliste geoeffnet. Ausgeloest durch Ctrl+V
  // auf einer Checklists-Feature-Row.
  const [pasteTarget, setPasteTarget] = createSignal<{ cellId: string; text: string } | null>(null);
  // Settings-Gates fuer Kontextmenue-Eintraege. useVis reagiert auf
  // Edit-Mode + vis-Key — so greifen die Menu-Items automatisch, wenn
  // der User per Settings-Modal toggelt.
  const canAddInfoField = useVis('addInfoField');
  // Export/Import/Loeschen ignorieren vis-Settings und haengen nur am
  // editMode — Ausnahme-Regel aus der Kontextmenue-Spec.
  const editMode = useEditMode();

  // Zentraler Mutation-Wrapper: Toast bei Erfolg/Fehler, onChanged-
  // Propagation, optionales success-Label. Kapselt die 4-Zeilen-try-
  // catch-Idiom, die in jedem Menu-Onclick auftauchen wuerde.
  async function runMenuMutation<T>(fn: () => Promise<T>, successMsg?: string): Promise<void> {
    try {
      await fn();
      if (successMsg) showToast(successMsg, 'success');
      props.onChanged?.();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    }
  }

  // Feature-Flag auf der Cell anheben, falls nicht schon gesetzt.
  // Wird vom + Feld / + Checkliste / + Link-Flow benutzt, damit der
  // User nicht vorher separat das Feature einschalten muss.
  async function ensureCellFeature(cell: CellRow, feature: CellFeature): Promise<void> {
    const current = (cell.features ?? []) as CellFeature[];
    if (current.includes(feature)) return;
    await updateCell(cell.id, { features: [...current, feature] });
  }

  // File-Picker fuer Import. Ein verstecktes input-Element, das wir
  // je Menu-Klick neu triggern — so kann der User dieselbe Datei
  // mehrfach waehlen (value='' nach jedem Trigger reset). Der
  // Import-Target-Context wird via Ref gehalten.
  let importInputRef: HTMLInputElement | undefined;
  let pendingImportTarget: ImportTarget | null = null;

  function triggerImport(target: ImportTarget): void {
    if (!importInputRef) return;
    pendingImportTarget = target;
    // Reset value, damit change-Event auch bei gleicher Datei feuert.
    importInputRef.value = '';
    importInputRef.click();
  }

  async function onImportFileChosen(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    const target = pendingImportTarget;
    pendingImportTarget = null;
    if (!file || !target) return;
    try {
      let text = await file.text();
      // IMX-Detection: Datei beginnt mit IMATRIX_ENC: → Passphrase-
      // Prompt + decryptPayload bevor wir an parseImportPayload geben.
      // Der User darf den Prompt abbrechen — dann silent-return.
      if (isEncrypted(text)) {
        const pw = await showPrompt({
          title: 'Verschluesselter Import',
          message:
            'Diese Datei ist verschluesselt (.imx). Bitte Passphrase eingeben, mit der sie exportiert wurde.',
          placeholder: 'Passphrase…',
          confirmLabel: 'Entschluesseln',
          inputType: 'password',
        });
        if (pw === null) {
          input.value = '';
          return;
        }
        try {
          text = await decryptPayload(text, pw);
        } catch (err) {
          showToast(translateDbError(err), 'error');
          input.value = '';
          return;
        }
      }
      const payload = parseImportPayload(text);
      const mismatch = checkTypeCompatibility(payload, target);
      if (mismatch) {
        showToast(mismatch, 'error');
        return;
      }
      const summary = summarizeExport(payload);
      // Einheitliche 3-Weg-Wahl fuer alle Import-Targets. Die Message
      // passt sich an den Target-Typ an.
      const messagePrefix = `Dieser Export enthaelt: ${summary}.`;
      const messageSuffix =
        target.kind === 'matrix'
          ? '\n\nSoll er an die bestehenden Zeilen/Spalten angehaengt werden, oder die Matrix ersetzen? Beim Ersetzen kannst du optional vorher einen Sicherungs-Export speichern.'
          : target.kind === 'board'
            ? '\n\nSoll er an die bestehenden Karten/Spalten/Checklisten/Links angehaengt werden, oder das Board ersetzen? Beim Ersetzen kannst du optional vorher einen Sicherungs-Export speichern.'
            : '\n\nSoll er an die bestehenden Daten angehaengt werden, oder bestehende Daten ersetzen? Beim Ersetzen kannst du optional vorher einen Sicherungs-Export speichern.';
      const modeChoice = await showChoice({
        title: 'Wie einfuegen?',
        message: messagePrefix + messageSuffix,
        choices: [
          {
            id: 'add',
            label: 'Hinzufuegen',
            variant: 'primary',
          },
          {
            id: 'export-overwrite',
            label: 'Sichern + Ersetzen',
            variant: 'default',
          },
          {
            id: 'overwrite',
            label: 'Ersetzen',
            variant: 'danger',
          },
        ],
      });
      if (!modeChoice) return;
      const mode = modeChoice as ImportMode;

      // Progress-Overlay: Scrim + Card zeigen waehrend des Imports.
      // Phase-Updates kommen aus den Executor-Funktionen selbst.
      startProgress('Import laeuft…');
      try {
        if (target.kind === 'matrix') {
          await runMenuMutation(
            () =>
              executeSubtreeImportIntoMatrix({
                payload,
                workspaceId: props.workspaceId,
                targetMatrixId: target.matrixNodeId,
                mode,
              }).then(() => undefined),
            `Matrix-Import: ${summary}`,
          );
        } else if (target.kind === 'board') {
          await runMenuMutation(
            () =>
              executeSubtreeImportIntoBoard({
                payload,
                workspaceId: props.workspaceId,
                targetBoardId: target.boardNodeId,
                mode,
              }).then(() => undefined),
            `Board-Import: ${summary}`,
          );
        } else if (target.kind === 'cell') {
          if (payload.payloadType === 'feature-info') {
            await runMenuMutation(
              () =>
                executeFeatureInfoImport({
                  payload,
                  workspaceId: props.workspaceId,
                  targetCellId: target.cellId,
                  mode,
                }).then(() => undefined),
              `Info-Import: ${summary}`,
            );
          } else if (payload.payloadType === 'feature-checklists') {
            await runMenuMutation(
              () =>
                executeFeatureChecklistsImport({
                  payload,
                  workspaceId: props.workspaceId,
                  targetCellId: target.cellId,
                  mode,
                }).then(() => undefined),
              `Checklisten-Import: ${summary}`,
            );
          } else {
            await runMenuMutation(
              () =>
                executeSubtreeImportIntoCell({
                  payload,
                  workspaceId: props.workspaceId,
                  targetCellId: target.cellId,
                  mode,
                }).then(() => undefined),
              `Subtree-Import: ${summary}`,
            );
          }
        } else if (target.kind === 'feature-info') {
          await runMenuMutation(
            () =>
              executeFeatureInfoImport({
                payload,
                workspaceId: props.workspaceId,
                targetCellId: target.cellId,
                mode,
              }).then(() => undefined),
            `Info-Import: ${summary}`,
          );
        } else if (target.kind === 'feature-checklists') {
          await runMenuMutation(
            () =>
              executeFeatureChecklistsImport({
                payload,
                workspaceId: props.workspaceId,
                targetCellId: target.cellId,
                mode,
              }).then(() => undefined),
            `Checklisten-Import: ${summary}`,
          );
        }
      } finally {
        endProgress();
      }
    } catch (err) {
      endProgress();
      if (err instanceof ImportError) {
        showToast(err.message, 'error');
      } else {
        showToast(translateDbError(err), 'error');
      }
    }
  }

  // Delete-Flow mit Export-vor-Loeschen als Single-Choice-Dialog:
  // 3 Optionen nebeneinander (Export+Loeschen, Nur Loeschen, Abbruch).
  // Kein Doppelprompt mehr — die Daten sind in einem Schritt weg oder
  // gesichert. Die Buttons tragen die Semantik, nicht die Reihenfolge.
  async function deleteWithExportPrompt(args: {
    label: string;
    exportFn: () => Promise<void>;
    deleteFn: () => Promise<void>;
    successMsg: string;
    // AU-B1 K10 (B1-B-003): optionaler Undo-Restore-Pfad. Wenn gesetzt,
    // wird `showUndoToast` statt `showToast` mit success-Pfad gerufen.
    // Caller liefert die Snapshot-basierte Restore-Closure (typischer-
    // weise `() => restoreNode(snap)`). Cascade-Inhalte werden durch
    // die DB-Loeschung nicht wiederhergestellt — caller-message muss
    // das klar kommunizieren.
    undoFn?: () => Promise<void>;
    undoCascadeHint?: string;
  }): Promise<void> {
    const choice = await showChoice({
      title: 'Loeschen',
      message: `"${args.label}" loeschen? Das laesst sich nicht rueckgaengig machen.\n\nWillst du vorher einen Export speichern, damit du die Daten spaeter wieder einspielen koenntest?`,
      choices: [
        {
          id: 'export-delete',
          label: 'Export speichern + Loeschen',
          variant: 'danger',
        },
        { id: 'delete', label: 'Nur Loeschen', variant: 'danger' },
        { id: 'cancel', label: 'Abbrechen', variant: 'default' },
      ],
    });
    if (!choice || choice === 'cancel') return;
    if (choice === 'export-delete') {
      try {
        await args.exportFn();
      } catch (err) {
        console.error('deleteWithExportPrompt.exportFn:', err);
        showToast(translateDbError(err), 'error');
        return; // Export fehlgeschlagen → kein Loeschen, Daten sind sicher
      }
    }
    try {
      await args.deleteFn();
      props.onChanged?.();
      if (args.undoFn) {
        const undoLabel = args.undoCascadeHint
          ? `${args.successMsg} ${args.undoCascadeHint}`
          : args.successMsg;
        showUndoToast(undoLabel, () => {
          void (async () => {
            try {
              await args.undoFn?.();
              showToast('Wiederhergestellt.', 'success');
              props.onChanged?.();
            } catch (err) {
              console.error('deleteWithExportPrompt.undoFn:', err);
              showToast(translateDbError(err), 'error');
            }
          })();
        });
      } else {
        showToast(args.successMsg, 'success');
      }
    } catch (err) {
      console.error('deleteWithExportPrompt.deleteFn:', err);
      showToast(translateDbError(err), 'error');
    }
  }

  // Clipboard-gesteuerter Paste-Flow fuer neue Checkliste.
  // Liest navigator.clipboard (User-Gesture vorausgesetzt), oeffnet
  // PastePopup mit Preview; onCommit legt Checkliste an und haengt die
  // geparsten Items per bulkAdd dran.
  async function triggerPasteForCell(cellId: string): Promise<void> {
    // Clipboard-API braucht User-Gesture. Ctrl+V-Tastendruck oder
    // Menu-Klick zaehlen als Gesture — in sicheren Kontexten (HTTPS /
    // localhost) klappt das ohne Prompt.
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        showToast('Zwischenablage ist leer.', 'info');
        return;
      }
      setPasteTarget({ cellId, text });
    } catch {
      showToast(
        'Zwischenablage kann nicht gelesen werden. Klick ins Fenster und versuch es erneut.',
        'error',
      );
    }
  }

  async function commitPastedChecklist(cellId: string, parsed: ParsedPasteItem[]): Promise<void> {
    if (parsed.length === 0) {
      setPasteTarget(null);
      return;
    }
    await runMenuMutation(
      async () => {
        const label = parsed[0]?.text?.slice(0, 60) || 'Aus Zwischenablage';
        const cl = await addCellChecklist({
          workspaceId: props.workspaceId,
          cellId,
          label,
        });
        await bulkAddChecklistItems({
          workspaceId: props.workspaceId,
          checklistId: cl.id,
          items: parsed.map((it) => ({ text: it.text, level: it.level })),
        });
      },
      `Checkliste mit ${parsed.length} ${parsed.length === 1 ? 'Punkt' : 'Punkten'} angelegt.`,
    );
    setPasteTarget(null);
  }
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
    const rows = Array.from(scrollRef.querySelectorAll<HTMLElement>('.tree-row'));

    type Meta = {
      cx: number;
      cy: number;
      depth: number;
      dotType: string;
      el: HTMLElement;
    };
    const meta = new Map<string, Meta>();
    const byParent = new Map<string, string[]>();
    // cx pro Depth LINEAR berechnen — muss exakt mit dem Tree-Row-
    // Layout synchron sein:
    //   row.padding-left = depth * 16 + 4
    //   chevron-col:      16px (absolute x: padding-left .. padding-left+16)
    //   tree-dot-inline:  nach chevron (cx ≈ padding-left + 16 + 4 = depth*16 + 24)
    // INDENT=16 damit die vertikale Rail-Linie auf dem Parent-Dot-Center
    // sitzt UND der Split-Curve endet auf dem Child-Dot-Center.
    const INDENT = 16;
    const ORIGIN_X = 24;
    for (const el of rows) {
      const id = el.dataset.treeId;
      if (!id) continue;
      const parent = el.dataset.treeParent || '';
      const depth = Number.parseInt(el.dataset.treeDepth || '0', 10);
      const dotType = el.dataset.dotType || 'matrix';
      const r = el.getBoundingClientRect();
      const cx = depth * INDENT + ORIGIN_X;
      const cy = r.top + r.height / 2 - rootRect.top;
      meta.set(id, { cx, cy, depth, dotType, el });
      if (parent) {
        const list = byParent.get(parent) ?? [];
        if (list.length === 0) byParent.set(parent, list);
        list.push(id);
      }
    }

    function lastDescendantCy(nodeId: string): number {
      const kids = byParent.get(nodeId);
      if (!kids || kids.length === 0) {
        const m = meta.get(nodeId);
        return m ? m.cy : Number.NEGATIVE_INFINITY;
      }
      let maxY = Number.NEGATIVE_INFINITY;
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
      e.dataTransfer.getData('text/matrix-card-id') || e.dataTransfer.getData('text/plain');
    if (!cardId) return;
    if (viewerActive()) {
      showToast('Read-only: Karten verschieben ist als Viewer nicht moeglich.', 'info');
      return;
    }

    try {
      // AU-B1 K2 (B1-D-001): Ziel-Spalte + Top-Position via gewrappter
      // Helper laden — ersetzt zwei direkte supabase.from()-Reads, gibt
      // IDB-Cache-Fallback im Offline-Fall.
      const target = await fetchBoardCardDropTarget(boardId, props.workspaceId);
      if (!target) {
        showToast('Ziel-Board hat keine Spalte.', 'error');
        return;
      }

      await moveCardToBoard(cardId, boardId, target.firstColId, target.topPosition);
      showToast('Karte verschoben.', 'success');
    } catch (err) {
      console.error('onCardDrop:', err);
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
    filterTree(props.tree, query().trim(), chips(), props.resolverMaps?.() ?? null),
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
      if (editMode()) {
        items.push({
          label: 'Umbenennen',
          icon: '✎',
          onClick: () => {
            void (async () => {
              const next = await showPrompt({
                title: 'Umbenennen',
                message: `Neuer Name fuer "${entry.node.label}":`,
                initialValue: entry.node.label,
                placeholder: 'Name…',
                confirmLabel: 'Umbenennen',
              });
              if (next === null) return;
              const trimmed = next.trim();
              if (!trimmed || trimmed === entry.node.label) return;
              try {
                await renameNode(entry.id, trimmed);
                showToast(`Umbenannt in "${trimmed}".`, 'success');
                props.onChanged?.();
              } catch (err) {
                showToast(translateDbError(err), 'error');
              }
            })();
          },
        });
        items.push({ label: '', onClick: () => {}, divider: true });
        items.push({
          label: 'Exportieren (mit Unterstruktur)',
          icon: '↓',
          onClick: () => {
            void (async () => {
              try {
                const data = await exportSubtree(entry.id, props.workspaceId);
                await downloadSubtreeExport(data, entry.node.label);
                showToast(`Export geladen — ${summarizeExport(data)}`, 'success');
              } catch (err) {
                showToast(translateDbError(err), 'error');
              }
            })();
          },
        });
        items.push({
          label: 'Exportieren (verschluesselt, .imx)',
          icon: '🔒',
          onClick: () => {
            void runEncryptedExport({
              getData: () => exportSubtree(entry.id, props.workspaceId),
              filenameLabel: entry.node.label,
            });
          },
        });
        // Import nur auf Matrix-Nodes (Boards haben keine Rows/Cols zum
        // mergen). Matrix-Matrix-Merge: Rows+Cols+Cells der Quelle
        // werden in die Ziel-Matrix integriert, Modus-Dialog steuert
        // Hinzufuegen / Ersetzen / Sichern+Ersetzen.
        if (entry.node.type === 'matrix') {
          items.push({
            label: 'Importieren',
            icon: '↑',
            onClick: () => {
              triggerImport({ kind: 'matrix', matrixNodeId: entry.id });
            },
          });
        } else if (entry.node.type === 'board') {
          items.push({
            label: 'Importieren',
            icon: '↑',
            onClick: () => {
              triggerImport({ kind: 'board', boardNodeId: entry.id });
            },
          });
        }
        items.push({
          label: 'Leeren',
          icon: '⌫',
          onClick: () => {
            void (async () => {
              try {
                const ran = await runResetScope({
                  workspaceId: props.workspaceId,
                  scope:
                    entry.node.type === 'matrix'
                      ? { kind: 'matrix', matrixNodeId: entry.id }
                      : { kind: 'board', boardNodeId: entry.id },
                  nodeLabel: entry.node.label,
                });
                if (ran) {
                  showToast(
                    `${entry.node.type === 'matrix' ? 'Matrix' : 'Board'} geleert.`,
                    'success',
                  );
                  props.onChanged?.();
                }
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
            // AU-B1 K10 (B1-B-003): Snapshot des Top-Level-Node fuer Undo.
            // Cascade-Inhalte (rows/cols/cells/...) werden DB-seitig
            // mitgeloescht und sind ueber restoreNode allein NICHT
            // wiederherstellbar — daher der explizite Hint im Toast.
            const nodeSnap = entry.node;
            void deleteWithExportPrompt({
              label: entry.node.label,
              exportFn: async () => {
                const data = await exportSubtree(entry.id, props.workspaceId);
                await downloadSubtreeExport(data, entry.node.label);
              },
              deleteFn: () => deleteNode(entry.id),
              successMsg: `"${entry.node.label}" geloescht.`,
              undoFn: () => restoreNode(nodeSnap),
              undoCascadeHint: '(Inhalte muessen via Export wiederhergestellt werden.)',
            });
          },
        });
      }
    } else if (entry.kind === 'cell') {
      // Cell-Entry: Navigation + Quick-Anlage. Die Quick-Add-Entries
      // aktivieren bei Bedarf das passende Feature (info/checklists)
      // implicit, damit der User nicht zweistufig klicken muss.
      const cell = entry.cell;
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
      if (canAddInfoField()) {
        items.push({ label: '', onClick: () => {}, divider: true });
        items.push({
          label: '+ Feld (Info)',
          icon: '+',
          onClick: () => {
            void runMenuMutation(async () => {
              await ensureCellFeature(cell, 'info');
              await addCellInfoField({ cellId: cell.id });
            }, 'Feld angelegt.');
          },
        });
        items.push({
          label: '+ Link (Info)',
          icon: '+',
          onClick: () => {
            void (async () => {
              const url = await showPrompt({
                title: '+ Link',
                message: 'URL oder E-Mail-Adresse:',
                initialValue: 'https://',
                placeholder: 'https://... oder name@firma.de',
                confirmLabel: 'Weiter',
              });
              if (url === null) return;
              const trimmed = url.trim();
              if (!trimmed) return;
              const label =
                (await showPrompt({
                  title: '+ Link',
                  message: 'Anzeigetext (optional, sonst wird die URL gezeigt):',
                  initialValue: '',
                  placeholder: 'z.B. Dokumentation',
                  confirmLabel: 'Anlegen',
                })) ?? '';
              await runMenuMutation(async () => {
                await ensureCellFeature(cell, 'info');
                await addCellLink({
                  cellId: cell.id,
                  label,
                  url: trimmed,
                });
              }, 'Link angelegt.');
            })();
          },
        });
        items.push({
          label: '+ Checkliste',
          icon: '+',
          onClick: () => {
            void runMenuMutation(async () => {
              await ensureCellFeature(cell, 'checklists');
              await addCellChecklist({
                workspaceId: props.workspaceId,
                cellId: cell.id,
              });
            }, 'Checkliste angelegt.');
          },
        });
      }
      if (editMode()) {
        items.push({ label: '', onClick: () => {}, divider: true });
        const labelGuess = `${entry.rowLabel}-${entry.colLabel}`;
        items.push({
          label: 'Exportieren (mit Unterstruktur)',
          icon: '↓',
          onClick: () => {
            void (async () => {
              try {
                const data = await exportCellSubtree(cell.id, props.workspaceId);
                await downloadSubtreeExport(data, labelGuess);
                showToast(`Export geladen — ${summarizeExport(data)}`, 'success');
              } catch (err) {
                showToast(translateDbError(err), 'error');
              }
            })();
          },
        });
        items.push({
          label: 'Exportieren (verschluesselt, .imx)',
          icon: '🔒',
          onClick: () => {
            void runEncryptedExport({
              getData: () => exportCellSubtree(cell.id, props.workspaceId),
              filenameLabel: labelGuess,
            });
          },
        });
        items.push({
          label: 'Importieren',
          icon: '↑',
          onClick: () => {
            triggerImport({ kind: 'cell', cellId: cell.id });
          },
        });
        items.push({
          label: 'Leeren',
          icon: '⌫',
          onClick: () => {
            void (async () => {
              try {
                const ran = await runResetScope({
                  workspaceId: props.workspaceId,
                  scope: { kind: 'cell', cellId: cell.id },
                });
                if (ran) {
                  showToast('Zelle geleert.', 'success');
                  props.onChanged?.();
                }
              } catch (err) {
                showToast(translateDbError(err), 'error');
              }
            })();
          },
        });
      }
    } else if (entry.kind === 'link') {
      items.push({
        label: entry.linkType === 'mail' ? 'Mail oeffnen' : 'Link oeffnen',
        icon: '→',
        onClick: () => {
          const safe = sanitizeUrl(entry.url);
          if (!safe) {
            showToast('Link enthaelt nicht-erlaubtes Schema', 'error');
            return;
          }
          const href = entry.linkType === 'mail' ? `mailto:${safe}` : safe;
          if (entry.linkType === 'mail') window.location.href = href;
          else window.open(href, '_blank', 'noopener,noreferrer');
        },
      });
    } else if (entry.kind === 'doc') {
      items.push({
        label: 'Doku oeffnen',
        icon: '→',
        onClick: () => navigate(hrefOf(props.workspaceId, entry)),
      });
    } else {
      // Feature-Entry (info/checklists). Navigation + Feature-spezifische
      // Quick-Adds. Ctrl+V-Hinweis bei Checklists — der eigentliche
      // Handler sitzt am TreeLink (braucht den DOM-Focus).
      items.push({
        label: 'Oeffnen',
        icon: '→',
        onClick: () => navigate(hrefOf(props.workspaceId, entry)),
      });
      const cellId = entry.cellId;
      if (entry.feature === 'info' && canAddInfoField()) {
        items.push({ label: '', onClick: () => {}, divider: true });
        items.push({
          label: '+ Feld',
          icon: '+',
          onClick: () => {
            void runMenuMutation(() => addCellInfoField({ cellId }), 'Feld angelegt.');
          },
        });
        items.push({
          label: '+ Link',
          icon: '+',
          onClick: () => {
            void (async () => {
              const url = await showPrompt({
                title: '+ Link',
                message: 'URL oder E-Mail-Adresse:',
                initialValue: 'https://',
                placeholder: 'https://... oder name@firma.de',
                confirmLabel: 'Weiter',
              });
              if (url === null) return;
              const trimmed = url.trim();
              if (!trimmed) return;
              const label =
                (await showPrompt({
                  title: '+ Link',
                  message: 'Anzeigetext (optional, sonst wird die URL gezeigt):',
                  initialValue: '',
                  placeholder: 'z.B. Dokumentation',
                  confirmLabel: 'Anlegen',
                })) ?? '';
              await runMenuMutation(
                () =>
                  addCellLink({
                    cellId,
                    label,
                    url: trimmed,
                  }),
                'Link angelegt.',
              );
            })();
          },
        });
      }
      if (entry.feature === 'checklists' && canAddInfoField()) {
        items.push({ label: '', onClick: () => {}, divider: true });
        items.push({
          label: '+ Checkliste',
          icon: '+',
          onClick: () => {
            void runMenuMutation(
              () =>
                addCellChecklist({
                  workspaceId: props.workspaceId,
                  cellId,
                }),
              'Checkliste angelegt.',
            );
          },
        });
        items.push({
          label: 'Aus Zwischenablage (Strg+V)',
          icon: '⌨',
          onClick: () => {
            void triggerPasteForCell(cellId);
          },
        });
      }
      // Feature-level Import/Export. editMode-only, unabhaengig von
      // vis-Settings (Export/Import/Loeschen sind in der Spec als
      // Ausnahme-Kategorie markiert).
      if (editMode()) {
        items.push({ label: '', onClick: () => {}, divider: true });
        items.push({
          label: 'Exportieren',
          icon: '↓',
          onClick: () => {
            void (async () => {
              try {
                const data =
                  entry.feature === 'info'
                    ? await exportFeatureInfo(cellId, props.workspaceId)
                    : await exportFeatureChecklists(cellId, props.workspaceId);
                await downloadSubtreeExport(data, entry.feature);
                showToast(`Export geladen — ${summarizeExport(data)}`, 'success');
              } catch (err) {
                showToast(translateDbError(err), 'error');
              }
            })();
          },
        });
        items.push({
          label: 'Exportieren (verschluesselt, .imx)',
          icon: '🔒',
          onClick: () => {
            void runEncryptedExport({
              getData: () =>
                entry.feature === 'info'
                  ? exportFeatureInfo(cellId, props.workspaceId)
                  : exportFeatureChecklists(cellId, props.workspaceId),
              filenameLabel: entry.feature,
            });
          },
        });
        items.push({
          label: 'Importieren',
          icon: '↑',
          onClick: () => {
            triggerImport(
              entry.feature === 'info'
                ? { kind: 'feature-info', cellId }
                : { kind: 'feature-checklists', cellId },
            );
          },
        });
        items.push({
          label: 'Leeren',
          icon: '⌫',
          onClick: () => {
            void (async () => {
              try {
                const ran = await runResetScope({
                  workspaceId: props.workspaceId,
                  scope:
                    entry.feature === 'info'
                      ? { kind: 'feature-info', cellId }
                      : { kind: 'feature-checklists', cellId },
                });
                if (ran) {
                  showToast(
                    entry.feature === 'info' ? 'Info-Felder geleert.' : 'Checklisten geleert.',
                    'success',
                  );
                  props.onChanged?.();
                }
              } catch (err) {
                showToast(translateDbError(err), 'error');
              }
            })();
          },
        });
      }
    }

    const badge =
      entry.kind === 'node'
        ? entry.node.type === 'matrix'
          ? '▦'
          : '▤'
        : entry.kind === 'feature'
          ? entry.feature === 'info'
            ? 'i'
            : '✓'
          : entry.kind === 'link'
            ? entry.linkType === 'mail'
              ? '✉'
              : '↗'
            : entry.kind === 'doc'
              ? '¶'
              : '·';

    setCtxMenu({
      x,
      y,
      sourceEl: rowEl,
      headerBadge: badge,
      headerLabel: labelOf(entry, props.resolverMaps?.() ?? null),
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
    const links = Array.from(container.querySelectorAll<HTMLElement>('.tree-link'));
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
      const linkDepth = Number.parseInt(
        link.closest<HTMLElement>('.tree-row')?.style.paddingLeft || '0',
        10,
      );
      for (let j = idx - 1; j >= 0; j--) {
        const r = links[j].closest<HTMLElement>('.tree-row');
        if (!r) continue;
        const rd = Number.parseInt(r.style.paddingLeft || '0', 10);
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
      <div
        class="node-tree-chips node-tree-chips-deep"
        role="toolbar"
        aria-label="Extra-Rows (Links, Mails, Dokus)"
      >
        <button
          type="button"
          class="tree-chip"
          classList={{ active: deepChips.isOn('links') }}
          onClick={() => deepChips.toggle('links')}
          title="Board-Links + Cell-Info-Links im Tree anzeigen"
        >
          <Icon name="arrow-top-right-on-square" size={11} />
          <span>Links</span>
        </button>
        <button
          type="button"
          class="tree-chip"
          classList={{ active: deepChips.isOn('mails') }}
          onClick={() => deepChips.toggle('mails')}
          title="Mail-Links im Tree anzeigen"
        >
          <Icon name="envelope" size={11} />
          <span>Mails</span>
        </button>
        <button
          type="button"
          class="tree-chip"
          classList={{ active: deepChips.isOn('docs') }}
          onClick={() => deepChips.toggle('docs')}
          title="Dokus im Tree anzeigen (unter Zellen)"
        >
          <Icon name="document-text" size={11} />
          <span>Docu</span>
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
                  currentFeature={props.currentFeature}
                  depth={0}
                  expand={expand}
                  query={query().trim()}
                  activePath={activePath()}
                  openMenu={openMenu}
                  onPasteChecklist={triggerPasteForCell}
                  dragOverBoardId={dragOverBoardId}
                  onCardDragOver={onCardDragOver}
                  onCardDragLeave={onCardDragLeave}
                  onCardDrop={onCardDrop}
                  presence={props.presence}
                  selfUserId={props.selfUserId}
                  members={props.members}
                  resolverMaps={props.resolverMaps}
                />
              )}
            </For>
          </ul>
        </Show>
      </div>
      <ContextMenu state={ctxMenu()} onClose={() => setCtxMenu(null)} />
      {/* Hidden file-input fuer Subtree/Feature-Import. Wird per
          triggerImport() geclickt — value wird vorher auf '' gesetzt,
          damit auch gleiche Datei wieder den change-Event feuert. */}
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json,.imx"
        class="tree-import-hidden"
        onChange={(e) => void onImportFileChosen(e)}
      />
      <Show when={pasteTarget()}>
        {(target) => (
          <ChecklistPastePopup
            initialText={target().text}
            checklistLabel="Neue Checkliste"
            onClose={() => setPasteTarget(null)}
            onCommit={async (parsed) => {
              await commitPastedChecklist(target().cellId, parsed);
            }}
          />
        )}
      </Show>
    </div>
  );
};

export default NodeTree;
