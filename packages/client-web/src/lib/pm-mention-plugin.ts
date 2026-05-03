// Welle D.8 — ProseMirror Mention-Plugin.
//
// Trigger-Detection im Doc-Editor: tippt der User '@', '#' oder '^' am
// Wort-Anfang, wird ein Picker-Open-Event ans Caller-Hook gefeuert. Der
// Caller (DocsPopup) oeffnet einen Picker-Modal (AtomPicker/Object-/
// Alias-Autocomplete) und ruft nach Auswahl insertMention zurueck —
// das ersetzt den Trigger-Char durch eine Mention-Node.
//
// Bewusst KEIN Inline-Dropdown im Editor selbst (V2). Modal-basiert ist
// pragmatischer + benutzt die existing Picker-Komponenten ohne Dub.
//
// Mention-Node wird als atomic inline-Node ins Schema gehaengt. HTML-
// Roundtrip stabil ueber span[data-mention]+attribute-Set.

import type { NodeSpec, Node as PMNode, Schema } from 'prosemirror-model';
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';

export type MentionTrigger = '@' | '#' | '^';
export type MentionRefKind = 'atom' | 'object' | 'tag' | 'alias';

export type MentionTriggerEvent = {
  trigger: MentionTrigger;
  // Doc-Position des Trigger-Chars (vor dem '@' steht der Caret nach Eingabe).
  // Nutze diese Position fuer insertMention().
  triggerPos: number;
};

// ─── Schema-Spec fuer Mention-Node ──────────────────────────────
export const mentionNodeSpec: NodeSpec = {
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  attrs: {
    trigger: { default: '@' },
    refKind: { default: 'atom' },
    refId: { default: '' },
    label: { default: '' },
  },
  parseDOM: [
    {
      tag: 'span[data-mention]',
      getAttrs: (dom) => {
        const el = dom as HTMLElement;
        return {
          trigger: el.getAttribute('data-trigger') ?? '@',
          refKind: el.getAttribute('data-ref-kind') ?? 'atom',
          refId: el.getAttribute('data-ref-id') ?? '',
          label: el.getAttribute('data-label') ?? el.textContent?.replace(/^[@#^]/, '') ?? '',
        };
      },
    },
  ],
  toDOM: (node: PMNode) => {
    const { trigger, refKind, refId, label } = node.attrs as {
      trigger: string;
      refKind: string;
      refId: string;
      label: string;
    };
    return [
      'span',
      {
        'data-mention': '',
        'data-trigger': trigger,
        'data-ref-kind': refKind,
        'data-ref-id': refId,
        'data-label': label,
        class: `pm-mention pm-mention-${refKind}`,
      },
      `${trigger}${label}`,
    ];
  },
};

// ─── Plugin ──────────────────────────────────────────────────────
export const mentionPluginKey = new PluginKey<undefined>('mention-trigger');

export function buildMentionPlugin(opts: {
  onTrigger: (e: MentionTriggerEvent) => void;
}): Plugin {
  return new Plugin({
    key: mentionPluginKey,
    appendTransaction(transactions, _oldState, newState) {
      // Nur reagieren wenn ein neuer Text eingefuegt wurde — und der ist
      // genau der Trigger-Char direkt.
      for (const tr of transactions) {
        if (!tr.docChanged) continue;
        // Wir suchen replace-Steps die genau ein Zeichen einfuegen
        // (typische Tipp-Operation).
        const meta = tr.getMeta('mention-internal');
        if (meta) continue; // eigene Mention-Inserts nicht rekursiv triggern
        // for-of statt forEach, weil wir nach dem ersten Treffer
        // abbrechen muessen (Tipp-Operation = ein Step pro Frame).
        for (const step of tr.steps) {
          const json = step.toJSON() as { stepType?: string; from?: number; slice?: unknown };
          if (json.stepType !== 'replace') continue;
          const slice = (json.slice ?? null) as { content?: Array<{ text?: string }> } | null;
          const content = slice?.content;
          if (!content || content.length !== 1) continue;
          const text = content[0]?.text;
          if (!text || text.length !== 1) continue;
          if (text !== '@' && text !== '#' && text !== '^') continue;
          // Wort-Anfang-Check: Zeichen vor dem Trigger muss ein
          // Whitespace, Doc-Anfang oder Block-Anfang sein.
          const fromPos = (json.from ?? 0) + 1; // step.from ist position vor dem insert
          const $pos = newState.doc.resolve(Math.max(0, fromPos - 1));
          const before = $pos.parent.textBetween(
            Math.max(0, $pos.parentOffset - 1),
            $pos.parentOffset,
            ' ',
            ' ',
          );
          if (before && /\S/.test(before)) continue;
          // Wir setzen ein Meta-Flag auf der Transaction damit der
          // Plugin-View den Trigger handhaben kann ohne Loop.
          opts.onTrigger({
            trigger: text as MentionTrigger,
            triggerPos: fromPos - 1, // Position direkt vor dem Trigger-Char
          });
          break;
        }
      }
      return null;
    },
  });
}

// ─── Imperative Insert-API ───────────────────────────────────────
// Aufgerufen vom Caller (DocsPopup) nach Picker-Auswahl: ersetzt den
// Trigger-Char an triggerPos durch eine Mention-Node.
export function insertMentionTransaction(
  schema: Schema,
  tr: Transaction,
  args: {
    triggerPos: number;
    trigger: MentionTrigger;
    refKind: MentionRefKind;
    refId: string;
    label: string;
  },
): Transaction {
  const mentionType = schema.nodes.mention;
  if (!mentionType) {
    throw new Error('Schema enthaelt keinen mention-Node — Spec einbinden vor Build.');
  }
  // Trigger-Char loeschen (1 Zeichen ab triggerPos) + Mention-Node einfuegen.
  const node = mentionType.create({
    trigger: args.trigger,
    refKind: args.refKind,
    refId: args.refId,
    label: args.label,
  });
  return tr
    .replaceRangeWith(args.triggerPos, args.triggerPos + 1, node)
    .setMeta('mention-internal', true);
}
