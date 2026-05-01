// Atom-Routing-Helper (Phase 4 T.AC.B Polish).
//
// Click auf ein Calendar-Event muss je nach atom_type woanders hin:
//   - task      → /task/:atomId
//   - link      → URL im neuen Tab oeffnen (sanitized)
//   - checklist → zur Parent-Cell (/c/:cellId/checklists) oder zum
//                 Board-View (/n/:boardId)
//   - doc       → /w/:wsId?doc=<atomId> (oeffnet das Docs-Popup wie
//                 ueblich)
//
// fuer checklist machen wir einen kurzen supabase-Lookup (cell_id|
// board_id), weil die Parent-Info nicht im Event liegt. Ein-Round-
// Trip beim Click ist akzeptabel.

import type { CalendarEvent } from './calendar';
import { supabase } from './supabase';
import { showToast } from './toasts';
import { sanitizeUrl } from './url';

type Navigate = (to: string, opts?: { replace?: boolean }) => void;

export async function navigateToAtomEvent(
  workspaceId: string,
  event: CalendarEvent,
  navigate: Navigate,
): Promise<void> {
  switch (event.atomType) {
    case 'task': {
      navigate(`/w/${workspaceId}/task/${event.atomId}`);
      return;
    }
    case 'link': {
      const url = sanitizeUrl(event.url ?? null);
      if (!url) {
        showToast('Link ohne (sichere) URL.', 'info');
        return;
      }
      // mailto-Links bleiben in selben Tab — sonst oeffnet Browser
      // einen leeren Tab; URL-Links target=_blank.
      const isMail = url.startsWith('mailto:');
      if (isMail) {
        window.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    case 'checklist': {
      const { data, error } = await supabase
        .from('checklists')
        .select('cell_id, board_id')
        .eq('id', event.atomId)
        .maybeSingle();
      if (error) {
        console.error('navigateToAtomEvent (checklist):', error);
        showToast('Liste nicht ladbar.', 'error');
        return;
      }
      if (!data) {
        showToast('Liste geloescht.', 'info');
        return;
      }
      if (data.cell_id) {
        navigate(`/w/${workspaceId}/c/${data.cell_id}/checklists`);
        return;
      }
      if (data.board_id) {
        navigate(`/w/${workspaceId}/n/${data.board_id}`);
        return;
      }
      showToast('Liste hat keinen Container.', 'info');
      return;
    }
    case 'doc': {
      navigate(`/w/${workspaceId}?doc=${event.atomId}`);
      return;
    }
  }
}
