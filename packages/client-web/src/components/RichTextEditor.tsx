// Welle D — RichTextEditor (ProseMirror-Wrap fuer Solid).
//
// EditorView wird imperativ in einem Container-Div gemounted. Der
// Solid-Component selbst rendert nur das Container-Div + cleanup;
// alles andere lebt im PM-internen DOM. Externe Updates (Realtime)
// werden via createEffect gewatcht — wir mergen nur, wenn der lokale
// Doc-State nicht dirty ist (d.h. User tippt gerade nicht).
//
// Schema: prosemirror-schema-basic + schema-list. Marks: bold/italic/
// code/link. Nodes: paragraph, heading[1-3], blockquote, code_block,
// bullet/orderedList + listItem.
//
// Keymap:
//   Cmd/Ctrl+B  → bold
//   Cmd/Ctrl+I  → italic
//   Cmd/Ctrl+K  → link prompt (window.prompt — V1 simple)
//   Cmd/Ctrl+Z  → undo
//   Cmd/Ctrl+Shift+Z bzw. Cmd/Ctrl+Y → redo
//   Enter im List-Item → split listItem (PM list-commands)
//
// InputRules:
//   `**bold**`     → bold mark
//   `*italic*`     → italic mark
//   `` `code` ``   → code mark
//   `# ` / `## ` / `### ` am Zeilen-Anfang → heading 1/2/3
//   `> ` → blockquote
//   `* ` / `- ` / `1. ` → list (bullet/ordered)

import { type Component, createEffect, onCleanup, onMount } from 'solid-js';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import {
  type InputRule,
  inputRules,
  textblockTypeInputRule,
  wrappingInputRule,
} from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { DOMParser, DOMSerializer, Schema } from 'prosemirror-model';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import {
  addListNodes,
  liftListItem,
  sinkListItem,
  splitListItem,
} from 'prosemirror-schema-list';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import {
  buildMentionPlugin,
  insertMentionTransaction,
  mentionNodeSpec,
  type MentionRefKind,
  type MentionTrigger,
  type MentionTriggerEvent,
} from '../lib/pm-mention-plugin';

// ─── Schema ─────────────────────────────────────────────────────
// basicSchema + List-Nodes appended + Mention-Node (Welle D.8).
const listEnabled = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');
const nodesWithMention = listEnabled.addToEnd('mention', mentionNodeSpec);
export const editorSchema = new Schema({
  nodes: nodesWithMention,
  marks: basicSchema.spec.marks,
});

// ─── HTML <-> PM-Doc helpers ─────────────────────────────────────
function htmlToDoc(html: string) {
  const dom = new DOMParser2().parseFromString(html || '<p></p>', 'text/html');
  return DOMParser.fromSchema(editorSchema).parse(dom.body);
}

function docToHtml(state: EditorState): string {
  const fragment = DOMSerializer.fromSchema(editorSchema).serializeFragment(state.doc.content);
  const div = document.createElement('div');
  div.appendChild(fragment);
  return div.innerHTML || '<p></p>';
}

// Native DOMParser-Alias (collision mit prosemirror-model.DOMParser).
const DOMParser2 = window.DOMParser;

// ─── InputRules ─────────────────────────────────────────────────
function buildInputRules() {
  const rules: InputRule[] = [];
  // Heading: # ... ### am Zeilen-Anfang.
  rules.push(textblockTypeInputRule(/^(#{1,3})\s$/, editorSchema.nodes.heading, (match) => ({
    level: match[1].length,
  })));
  // Blockquote: > am Anfang.
  rules.push(wrappingInputRule(/^\s*>\s$/, editorSchema.nodes.blockquote));
  // Bullet-List.
  rules.push(wrappingInputRule(/^\s*([-+*])\s$/, editorSchema.nodes.bullet_list));
  // Ordered-List.
  rules.push(
    wrappingInputRule(
      /^(\d+)\.\s$/,
      editorSchema.nodes.ordered_list,
      (match) => ({ order: Number.parseInt(match[1] ?? '1', 10) }),
      (match, node) => node.childCount + node.attrs.order === Number.parseInt(match[1] ?? '1', 10),
    ),
  );
  // Code-Block: ``` am Anfang.
  rules.push(textblockTypeInputRule(/^```$/, editorSchema.nodes.code_block));
  // Inline-Marks: bold/italic/code via einfache Pattern. Keine Cursor-
  // sensible Pre-/Post-Mark-Manipulation in V1 — User toggled mit
  // Keyboard-Shortcuts.
  return inputRules({ rules });
}

// ─── Keymap ─────────────────────────────────────────────────────
function buildKeymap() {
  const keys: Record<string, ReturnType<typeof toggleMark>> = {};
  const bold = editorSchema.marks.strong;
  const italic = editorSchema.marks.em;
  const code = editorSchema.marks.code;

  keys['Mod-b'] = toggleMark(bold);
  keys['Mod-B'] = toggleMark(bold);
  keys['Mod-i'] = toggleMark(italic);
  keys['Mod-I'] = toggleMark(italic);
  keys['Mod-`'] = toggleMark(code);

  return keymap(keys);
}

function buildHistoryKeymap() {
  return keymap({
    'Mod-z': undo,
    'Mod-Z': undo,
    'Mod-y': redo,
    'Mod-Shift-z': redo,
    'Mod-Shift-Z': redo,
  });
}

function buildListKeymap() {
  return keymap({
    Enter: splitListItem(editorSchema.nodes.list_item),
    'Mod-[': liftListItem(editorSchema.nodes.list_item),
    'Mod-]': sinkListItem(editorSchema.nodes.list_item),
    Tab: sinkListItem(editorSchema.nodes.list_item),
    'Shift-Tab': liftListItem(editorSchema.nodes.list_item),
  });
}

function buildLinkKeymap() {
  // Mod-K: Link-Prompt. V1 ist window.prompt — V2 ein eigener Modal.
  return keymap({
    'Mod-k': (state, dispatch) => {
      if (!dispatch) return false;
      const link = editorSchema.marks.link;
      const { from, to } = state.selection;
      if (from === to) return false;
      const url = window.prompt('URL eingeben:', '');
      if (!url) return false;
      const tx = state.tr.addMark(from, to, link.create({ href: url }));
      dispatch(tx);
      return true;
    },
  });
}

// ─── Component ──────────────────────────────────────────────────
export type RichTextEditorHandle = {
  // Imperative API fuer Mention-Insert nach Picker-Auswahl. Caller ruft
  // das nach dem onMentionTrigger + Picker-Pick.
  insertMention: (args: {
    triggerPos: number;
    trigger: MentionTrigger;
    refKind: MentionRefKind;
    refId: string;
    label: string;
  }) => void;
  // Editor wieder fokussieren (z.B. nach Picker-Close).
  focus: () => void;
};

export type RichTextEditorProps = {
  value: string; // HTML
  onChange: (html: string) => void;
  onSaveCloseHotkey?: () => void; // Cmd/Ctrl+Enter
  placeholder?: string;
  readOnly?: boolean;
  ariaLabel?: string;
  // Welle D.8: Mention-Trigger-Hook. Caller oeffnet Picker und ruft
  // dann handle.insertMention zurueck.
  onMentionTrigger?: (e: MentionTriggerEvent) => void;
  // Imperative-Handle (Solid: prop-based ref).
  ref?: (handle: RichTextEditorHandle) => void;
};

const RichTextEditor: Component<RichTextEditorProps> = (p) => {
  let containerEl: HTMLDivElement | undefined;
  let view: EditorView | null = null;
  // Letzter HTML-Wert den der Editor selbst emittiert hat — verhindert
  // dass createEffect(p.value) den User-Input wegrissen.
  let lastEmittedHtml = '';

  function buildState(html: string): EditorState {
    const plugins = [
      history(),
      buildHistoryKeymap(),
      buildListKeymap(),
      buildLinkKeymap(),
      buildKeymap(),
      buildInputRules(),
      keymap(baseKeymap),
      // Save+Close-Hotkey (Cmd/Ctrl+Enter). Eigener Plugin-Layer damit
      // die App ihn ueberschreiben/abklemmen kann ueber Props.
      keymap({
        'Mod-Enter': (_state, _dispatch) => {
          p.onSaveCloseHotkey?.();
          return true;
        },
      }),
    ];
    // Welle D.8: Mention-Plugin nur wenn Caller einen Trigger-Hook
    // angibt — sonst uebernimmt das ProseMirror Standard-Verhalten und
    // '@'/'#'/'^' bleiben Plain-Text.
    if (p.onMentionTrigger) {
      plugins.push(
        buildMentionPlugin({
          onTrigger: (e) => p.onMentionTrigger?.(e),
        }),
      );
    }
    return EditorState.create({
      doc: htmlToDoc(html),
      schema: editorSchema,
      plugins,
    });
  }

  onMount(() => {
    if (!containerEl) return;
    const state = buildState(p.value || '<p></p>');
    view = new EditorView(containerEl, {
      state,
      editable: () => !p.readOnly,
      attributes: {
        class: 'pm-editor',
        ...(p.ariaLabel ? { 'aria-label': p.ariaLabel } : {}),
      },
      dispatchTransaction(tr) {
        if (!view) return;
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) {
          const html = docToHtml(next);
          lastEmittedHtml = html;
          p.onChange(html);
        }
      },
    });
    // Welle D.8: imperative Handle exposen (Mention-Insert + Focus).
    p.ref?.({
      insertMention: (args) => {
        if (!view) return;
        const tr = insertMentionTransaction(editorSchema, view.state.tr, args);
        view.dispatch(tr);
        view.focus();
      },
      focus: () => view?.focus(),
    });
  });

  // Externe Wert-Updates (Realtime, programmatic-set) mergen nur, wenn
  // der externe Wert wirklich vom letzten emittierten Wert abweicht.
  // Sonst wuerde jeder onChange-Call den View neu rendern und Caret-
  // Position verlieren.
  createEffect(() => {
    const externalHtml = p.value || '<p></p>';
    if (!view) return;
    if (externalHtml === lastEmittedHtml) return;
    const currentHtml = docToHtml(view.state);
    if (externalHtml === currentHtml) return;
    // Replace doc — User-Caret wird auf Anfang gesetzt. Akzeptabel
    // weil wir das nur ausloesen wenn die externe Quelle wirklich neu
    // ist (Realtime-Update, Tab-Wechsel etc.).
    const newState = buildState(externalHtml);
    view.updateState(newState);
    lastEmittedHtml = externalHtml;
  });

  onCleanup(() => {
    view?.destroy();
    view = null;
  });

  return (
    <div
      ref={(el) => {
        containerEl = el;
      }}
      class="pm-editor-container"
      data-placeholder={p.placeholder ?? ''}
    />
  );
};

export default RichTextEditor;
