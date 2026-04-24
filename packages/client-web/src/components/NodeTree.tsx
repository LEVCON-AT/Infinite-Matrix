import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  type Component,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { A, useNavigate } from '@solidjs/router';
import type { CellFeature, CellRow, TreeEntry } from '../lib/types';
import { useTreeExpand } from '../lib/tree-expand';
import {
  addCellChecklist,
  addCellInfoField,
  addCellLink,
  bulkAddChecklistItems,
  deleteNode,
  moveCardToBoard,
  renameNode,
  updateCell,
} from '../lib/mutations';
import type { ParsedPasteItem } from '../lib/checklist-paste-parse';
import { cellTarget } from '../lib/alias-dispatch';
import { supabase } from '../lib/supabase';
import { showToast } from '../lib/toasts';
import { translateDbError } from '../lib/errors';
import { useVis } from '../lib/settings';
import { useEditMode } from '../lib/edit-mode';
import { useSidebarChips } from '../lib/sidebar-chips';
import { openDocsPopup } from '../lib/docs-ui';
import {
  downloadSubtreeExport,
  exportCellSubtree,
  exportFeatureChecklists,
  exportFeatureInfo,
  exportSubtree,
  summarizeExport,
} from '../lib/export';
import {
  checkTypeCompatibility,
  executeFeatureChecklistsImport,
  executeFeatureInfoImport,
  executeSubtreeImportIntoCell,
  executeSubtreeImportIntoMatrix,
  ImportError,
  parseImportPayload,
  type ImportTarget,
} from '../lib/subtree-import';
import ContextMenu, { type CtxMenuState } from './ContextMenu';
import ChecklistPastePopup from './ChecklistPastePopup';
import Icon, { type IconName } from './Icon';

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
):
  | 'matrix'
  | 'board'
  | 'cell'
  | 'info'
  | 'checklists'
  | 'link'
  | 'mail'
  | 'doc' {
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

function labelOf(entry: TreeEntry): string {
  if (entry.kind === 'node') return entry.node.label || '(ohne Label)';
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
    return entry.linkType === 'mail' ? `mailto:${entry.url}` : entry.url;
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
          component={
            p.entry.kind === 'link' || p.entry.kind === 'doc' ? 'a' : A
          }
          href={
            p.entry.kind === 'doc' ? '#' : hrefOf(p.workspaceId, p.entry)
          }
          target={p.entry.kind === 'link' && p.entry.linkType === 'url' ? '_blank' : undefined}
          rel={p.entry.kind === 'link' && p.entry.linkType === 'url' ? 'noopener noreferrer' : undefined}
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
        </Dynamic>
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
  const [query, setQuery] = createSignal('');
  const [chips, setChips] = createSignal<Set<FilterChip>>(new Set());
  const [ctxMenu, setCtxMenu] = createSignal<CtxMenuState | null>(null);
  const [dragOverBoardId, setDragOverBoardId] = createSignal<string | null>(null);
  // Paste-Dialog-State: wenn gesetzt, wird ChecklistPastePopup fuer das
  // Anlegen einer neuen Checkliste geoeffnet. Ausgeloest durch Ctrl+V
  // auf einer Checklists-Feature-Row.
  const [pasteTarget, setPasteTarget] = createSignal<
    { cellId: string; text: string } | null
  >(null);
  // Settings-Gates fuer Kontextmenue-Eintraege. useVis reagiert auf
  // Edit-Mode + vis-Key — so greifen die Menu-Items automatisch, wenn
  // der User per Settings-Modal toggelt.
  const canAddInfoField = useVis('addInfoField');
  const canAddFeature = useVis('addFeature');
  // Export/Import/Loeschen ignorieren vis-Settings und haengen nur am
  // editMode — Ausnahme-Regel aus der Kontextmenue-Spec.
  const editMode = useEditMode();

  // Zentraler Mutation-Wrapper: Toast bei Erfolg/Fehler, onChanged-
  // Propagation, optionales success-Label. Kapselt die 4-Zeilen-try-
  // catch-Idiom, die in jedem Menu-Onclick auftauchen wuerde.
  async function runMenuMutation<T>(
    fn: () => Promise<T>,
    successMsg?: string,
  ): Promise<void> {
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
  async function ensureCellFeature(
    cell: CellRow,
    feature: CellFeature,
  ): Promise<void> {
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
      const text = await file.text();
      const payload = parseImportPayload(text);
      const mismatch = checkTypeCompatibility(payload, target);
      if (mismatch) {
        showToast(mismatch, 'error');
        return;
      }
      const summary = summarizeExport(payload);
      if (
        !window.confirm(
          `Import: ${summary}. Unter dem gewaehlten Ziel einhaengen?`,
        )
      ) {
        return;
      }
      if (target.kind === 'matrix') {
        await runMenuMutation(
          () =>
            executeSubtreeImportIntoMatrix({
              payload,
              workspaceId: props.workspaceId,
              targetMatrixId: target.matrixNodeId,
            }).then(() => undefined),
          `Import: ${summary}`,
        );
      } else if (target.kind === 'cell') {
        if (payload.payloadType === 'feature-info') {
          await runMenuMutation(
            () =>
              executeFeatureInfoImport({
                payload,
                workspaceId: props.workspaceId,
                targetCellId: target.cellId,
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
            }).then(() => undefined),
          `Checklisten-Import: ${summary}`,
        );
      }
    } catch (err) {
      if (err instanceof ImportError) {
        showToast(err.message, 'error');
      } else {
        showToast(translateDbError(err), 'error');
      }
    }
  }

  // Delete-Flow mit Export-vor-Loeschen: zweistufig. Erst 'Vor dem
  // Loeschen exportieren?' (OK / Cancel) — bei OK wird der Export
  // ausgefuehrt; danach zweite Bestaetigung 'Jetzt wirklich loeschen?'.
  // Cancel am ersten Prompt ist NICHT abort; der User kann loeschen
  // ohne Export. Abort geht nur durch Cancel am zweiten Prompt.
  async function deleteWithExportPrompt(args: {
    label: string;
    exportFn: () => Promise<void>;
    deleteFn: () => Promise<void>;
    successMsg: string;
  }): Promise<void> {
    const doExport = window.confirm(
      `Vor dem Loeschen exportieren? "${args.label}"\n\nOK = Export + Loeschen\nAbbrechen = nur Loeschen`,
    );
    if (doExport) {
      try {
        await args.exportFn();
      } catch (err) {
        showToast(translateDbError(err), 'error');
        return; // Export fehlgeschlagen → kein Loeschen
      }
    }
    if (
      !window.confirm(
        `Jetzt wirklich loeschen? "${args.label}"\n\nKann nicht rueckgaengig gemacht werden.`,
      )
    ) {
      return;
    }
    try {
      await args.deleteFn();
      showToast(args.successMsg, 'success');
      props.onChanged?.();
    } catch (err) {
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

  async function commitPastedChecklist(
    cellId: string,
    parsed: ParsedPasteItem[],
  ): Promise<void> {
    if (parsed.length === 0) {
      setPasteTarget(null);
      return;
    }
    await runMenuMutation(async () => {
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
    }, `Checkliste mit ${parsed.length} ${parsed.length === 1 ? 'Punkt' : 'Punkten'} angelegt.`);
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
    // cx pro Depth LINEAR berechnen — muss exakt mit dem Tree-Row-
    // Layout synchron sein:
    //   row.padding-left = depth * 16 + 4
    //   chevron-col:      16px (absolute x: padding-left .. padding-left+16)
    //   tree-dot-inline:  nach chevron (cx ≈ padding-left + 16 + 4 = depth*16 + 24)
    // INDENT=16 damit die vertikale Rail-Linie auf dem Parent-Dot-Center
    // sitzt UND der Split-Curve endet auf dem Child-Dot-Center.
    const INDENT = 16;
    const ORIGIN_X = 24;
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
      if (editMode()) {
        items.push({ label: '', onClick: () => {}, divider: true });
        items.push({
          label: 'Exportieren (mit Unterstruktur)',
          icon: '↓',
          onClick: () => {
            void (async () => {
              try {
                const data = await exportSubtree(entry.id, props.workspaceId);
                downloadSubtreeExport(data, entry.node.label);
                showToast(`Export geladen — ${summarizeExport(data)}`, 'success');
              } catch (err) {
                showToast(translateDbError(err), 'error');
              }
            })();
          },
        });
        // Import nur fuer Matrix-Nodes (Boards sind Blaetter — da
        // macht Subtree-Import keinen Sinn, man wuerde Cards haben
        // wollen, das ist eine andere Operation).
        if (entry.node.type === 'matrix') {
          items.push({
            label: 'Importieren (Subtree)',
            icon: '↑',
            onClick: () => {
              triggerImport({ kind: 'matrix', matrixNodeId: entry.id });
            },
          });
        }
      }
      items.push({ label: '', onClick: () => {}, divider: true });
      items.push({
        label: 'Loeschen',
        icon: '✕',
        danger: true,
        onClick: () => {
          void deleteWithExportPrompt({
            label: entry.node.label,
            exportFn: async () => {
              const data = await exportSubtree(entry.id, props.workspaceId);
              downloadSubtreeExport(data, entry.node.label);
            },
            deleteFn: () => deleteNode(entry.id),
            successMsg: `"${entry.node.label}" geloescht.`,
          });
        },
      });
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
            const url = window.prompt('URL oder E-Mail-Adresse:', 'https://');
            if (!url) return;
            const trimmed = url.trim();
            if (!trimmed) return;
            const label = window.prompt('Anzeigetext (optional):', '') ?? '';
            void runMenuMutation(async () => {
              await ensureCellFeature(cell, 'info');
              await addCellLink({
                cellId: cell.id,
                label,
                url: trimmed,
              });
            }, 'Link angelegt.');
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
                const data = await exportCellSubtree(
                  cell.id,
                  props.workspaceId,
                );
                downloadSubtreeExport(data, labelGuess);
                showToast(
                  `Export geladen — ${summarizeExport(data)}`,
                  'success',
                );
              } catch (err) {
                showToast(translateDbError(err), 'error');
              }
            })();
          },
        });
        items.push({
          label: 'Importieren',
          icon: '↑',
          onClick: () => {
            triggerImport({ kind: 'cell', cellId: cell.id });
          },
        });
      }
    } else if (entry.kind === 'link') {
      items.push({
        label: entry.linkType === 'mail' ? 'Mail oeffnen' : 'Link oeffnen',
        icon: '→',
        onClick: () => {
          const href =
            entry.linkType === 'mail' ? `mailto:${entry.url}` : entry.url;
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
            void runMenuMutation(
              () => addCellInfoField({ cellId }),
              'Feld angelegt.',
            );
          },
        });
        items.push({
          label: '+ Link',
          icon: '+',
          onClick: () => {
            const url = window.prompt('URL oder E-Mail-Adresse:', 'https://');
            if (!url) return;
            const trimmed = url.trim();
            if (!trimmed) return;
            const label = window.prompt('Anzeigetext (optional):', '') ?? '';
            void runMenuMutation(
              () =>
                addCellLink({
                  cellId,
                  label,
                  url: trimmed,
                }),
              'Link angelegt.',
            );
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
                    : await exportFeatureChecklists(
                        cellId,
                        props.workspaceId,
                      );
                downloadSubtreeExport(data, entry.feature);
                showToast(
                  `Export geladen — ${summarizeExport(data)}`,
                  'success',
                );
              } catch (err) {
                showToast(translateDbError(err), 'error');
              }
            })();
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
        accept="application/json,.json"
        class="tree-import-hidden"
        onChange={(e) => void onImportFileChosen(e)}
      />
      <Show when={pasteTarget()}>
        <ChecklistPastePopup
          initialText={pasteTarget()!.text}
          checklistLabel="Neue Checkliste"
          onClose={() => setPasteTarget(null)}
          onCommit={async (parsed) => {
            const t = pasteTarget();
            if (!t) return;
            await commitPastedChecklist(t.cellId, parsed);
          }}
        /></Show>
    </div>
  );
};

export default NodeTree;
