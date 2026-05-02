// Welle D.7 — Tag-Editor fuer einen einzelnen Doc-Atom.
//
// Wrapped TagInput mit dem Fetch- und Refetch-Pfad. Nutzt
// fetchAtomTagsForAtom (lib/atom-tags.ts) fuer den Read.

import { type Component, createEffect, createResource } from 'solid-js';
import { fetchAtomTagsForAtom } from '../lib/atom-tags';
import TagInput from './TagInput';

export type DocTagsEditorProps = {
  workspaceId: string;
  docId: string;
  realtimeVersion: number;
};

const DocTagsEditor: Component<DocTagsEditorProps> = (p) => {
  const [tags, { refetch }] = createResource(
    () => ({ wsId: p.workspaceId, docId: p.docId }),
    async (key) =>
      fetchAtomTagsForAtom({
        workspaceId: key.wsId,
        atomType: 'doc',
        atomId: key.docId,
      }),
  );

  // Realtime-Bump auf workspace_tags / atom_tags triggert Refetch via
  // realtimeVersion-Prop (Workspace.subscribeWorkspace wird in D.10
  // erweitert um die neuen Tabellen).
  createEffect(() => {
    void p.realtimeVersion;
    void refetch();
  });

  return (
    <TagInput
      workspaceId={p.workspaceId}
      atomType="doc"
      atomId={p.docId}
      tags={tags() ?? []}
      onTagsChange={() => void refetch()}
    />
  );
};

export default DocTagsEditor;
