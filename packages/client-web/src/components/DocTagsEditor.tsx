// Welle D.7 — Tag-Editor fuer einen einzelnen Doc-Atom.
//
// Welle D.7c: Wrapper um den generischen AtomTagsEditor. Behaelt seine
// eigene API damit Caller (DocsPopup) nicht alle Picker-Resources
// durchreichen muessen — Doc-Tags brauchen typisch eh nur freetext +
// alias_ref. Wenn DocsPopup spaeter atom_ref/object_ref-Tags fuer Docs
// erlauben soll, kann es einfach AtomTagsEditor direkt nutzen.

import type { Component } from 'solid-js';
import AtomTagsEditor from './AtomTagsEditor';

export type DocTagsEditorProps = {
  workspaceId: string;
  docId: string;
  realtimeVersion: number;
};

const DocTagsEditor: Component<DocTagsEditorProps> = (p) => {
  return (
    <AtomTagsEditor
      workspaceId={p.workspaceId}
      atomType="doc"
      atomId={p.docId}
      realtimeVersion={p.realtimeVersion}
    />
  );
};

export default DocTagsEditor;
