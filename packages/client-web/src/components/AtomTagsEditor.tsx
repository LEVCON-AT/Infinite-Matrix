// Welle D.7c — AtomTagsEditor.
//
// Generischer Tag-Editor fuer beliebige Atom-Typen (Task/Link/Doc/
// Checklist/Imported-Event). Eingebunden in CardOverlay,
// ImportedEventDetailModal etc. — der DocsPopup nutzt weiter den
// spezialisierten DocTagsEditor (gleicher Pfad).
//
// Wraps TagInput + AtomPickerModal + ObjectPickerModal. Picker
// onPick-Handler ruft addAtomTagAtomRef bzw. addAtomTagObjectRef.

import { type Component, Show, createEffect, createResource, createSignal } from 'solid-js';
import type { AtomKind } from '../lib/atom-manifestations';
import { addAtomTagAtomRef, addAtomTagObjectRef, fetchAtomTagsForAtom } from '../lib/atom-tags';
import { translateDbError } from '../lib/errors';
import { showToast } from '../lib/toasts';
import type { CellRow, NodeRow } from '../lib/types';
import AtomPickerModal, { type AtomPickerEntry } from './AtomPickerModal';
import ObjectPickerModal from './ObjectPickerModal';
import TagInput from './TagInput';

export type AtomTagsEditorProps = {
  workspaceId: string;
  atomType: AtomKind;
  atomId: string;
  realtimeVersion: number;
  // Picker-Daten (alle workspace-scoped). Optional — wenn fehlt, wird
  // der jeweilige Picker-Trigger ausgeblendet. atomPickerEntries ist
  // eine flache vom Caller aufbereitete Liste (Workspace.tsx-Hook).
  atomPickerEntries?: AtomPickerEntry[];
  cells?: CellRow[];
  nodes?: NodeRow[];
  cellLabelById?: Map<string, string>;
};

const AtomTagsEditor: Component<AtomTagsEditorProps> = (p) => {
  const [tags, { refetch }] = createResource(
    () => ({ wsId: p.workspaceId, atomType: p.atomType, atomId: p.atomId }),
    async (key) =>
      fetchAtomTagsForAtom({
        workspaceId: key.wsId,
        atomType: key.atomType,
        atomId: key.atomId,
      }),
  );

  // Realtime-Bump triggert Refetch.
  createEffect(() => {
    void p.realtimeVersion;
    void refetch();
  });

  const [showAtomPicker, setShowAtomPicker] = createSignal(false);
  const [showObjectPicker, setShowObjectPicker] = createSignal(false);

  async function onPickAtom(targetType: AtomKind, targetId: string, _label: string) {
    setShowAtomPicker(false);
    try {
      await addAtomTagAtomRef({
        workspaceId: p.workspaceId,
        atomType: p.atomType,
        atomId: p.atomId,
        targetAtomType: targetType,
        targetAtomId: targetId,
      });
      void refetch();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    }
  }

  async function onPickObject(kind: 'cell' | 'node', id: string, _label: string) {
    setShowObjectPicker(false);
    try {
      await addAtomTagObjectRef({
        workspaceId: p.workspaceId,
        atomType: p.atomType,
        atomId: p.atomId,
        objectKind: kind,
        objectId: id,
      });
      void refetch();
    } catch (err) {
      showToast(translateDbError(err), 'error');
    }
  }

  const canPickAtom = () => (p.atomPickerEntries?.length ?? 0) > 0;
  const canPickObject = () => !!(p.cells || p.nodes);

  return (
    <>
      <TagInput
        workspaceId={p.workspaceId}
        atomType={p.atomType}
        atomId={p.atomId}
        tags={tags() ?? []}
        onTagsChange={() => void refetch()}
        onPickAtomRef={canPickAtom() ? () => setShowAtomPicker(true) : undefined}
        onPickObjectRef={canPickObject() ? () => setShowObjectPicker(true) : undefined}
      />
      <Show when={showAtomPicker()}>
        <AtomPickerModal
          entries={p.atomPickerEntries ?? []}
          onPick={onPickAtom}
          onClose={() => setShowAtomPicker(false)}
        />
      </Show>
      <Show when={showObjectPicker()}>
        <ObjectPickerModal
          cells={p.cells ?? []}
          nodes={p.nodes ?? []}
          cellLabelById={p.cellLabelById ?? new Map()}
          onPick={onPickObject}
          onClose={() => setShowObjectPicker(false)}
        />
      </Show>
    </>
  );
};

export default AtomTagsEditor;
