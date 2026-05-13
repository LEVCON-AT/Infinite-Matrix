// §13.3 V1 — Atom-Marker-Bar (Star + Eye).
//
// Pro Atom-Card: ⭐ (Workspace-shared, Counter) + 👁️ (User-privat).
// Konzept §13.3 (Migration 074 atom_markers).
//
// V1-Scope:
//   - Click-Toggle pro Icon (filled wenn aktiv, outline sonst).
//   - Star-Counter rechts neben dem Star-Icon (nur wenn > 0).
//   - 1.5s-Throttle pro Atom + Kind gegen Click-Spam.
//   - Eye ist user-privat — kein Counter, nur Self-Indicator.
//
// V2-Polish (2026-05-13):
//   - Hover-Tooltip „Wer hat gestartet" auf dem Star-Button. Caller
//     liefert wsMembers (workspaceMembers-Resource); fehlend → Tooltip
//     entfaellt, native title-Fallback bleibt.
//
// V2-deferred:
//   - Filter-Builder-Conditions has_marker(kind=star, by_user=me, count>=N).
//   - Vorlagen-Toggle markers.workspace_star / markers.private_eye
//     (heute immer sichtbar; Toggle abschaltbar nur wenn Vorlage es deaktiviert).
//
// Render-Position: rechts in der Card-Toolbar (Konzept §13.3 UI). Caller
// sorgt fuer Container-Layout via Parent-CSS (.card-marker-row etc.).

import { type Component, For, Show, createMemo, createSignal } from 'solid-js';
import {
  type SetMarkerInput,
  selfEyeMarker,
  selfStarMarker,
  setAtomMarker,
  starCountForAtom,
  starMarkersForAtom,
  unsetAtomMarker,
} from '../lib/atom-markers';
import type { WorkspaceMember } from '../lib/members';
import { memberDisplayLabel } from '../lib/members';
import { avatarColorFor } from '../lib/presence';
import { showToast } from '../lib/toasts';
import type { AtomMarkerKind, AtomMarkerRow } from '../lib/types';
import Icon from './Icon';

type Props = {
  workspaceId: string;
  userId: string;
  // Polymorpher Atom-Ref. atomType muss zu atom_markers.atom_type passen
  // (CHECK auf 6 Werte: task/link/doc/checklist/info_field/imported_event).
  atomType: AtomMarkerRow['atom_type'];
  atomId: string;
  // Workspace-skopierte Marker-Liste (kommt von Workspace.tsx Resource).
  // Self-Marker + Counter werden client-seitig daraus berechnet.
  markers: ReadonlyArray<AtomMarkerRow>;
  // §13.3 V2-Polish (2026-05-13) — Workspace-Member-Lookup fuer den
  // Hover-Tooltip „Wer hat gestartet". Wenn undefined: Tooltip entfaellt,
  // Star-Icon zeigt nur den nativen title-Fallback.
  wsMembers?: ReadonlyArray<WorkspaceMember>;
  // Optional: pro-Vorlage-Toggle. Wenn 'workspace_star=false' im Widget-
  // Toggles, ist der Star-Knopf hidden (Konzept §13.3 Widget-Toggle).
  // V1 immer angezeigt; Caller kann disabled per Show-Wrapper aussen.
};

// Throttle-Cache pro (atomId, kind). 1.5s gegen Doppel-Click + UI-Spam.
const recentToggle = new Map<string, number>();
const TOGGLE_THROTTLE_MS = 1500;

function throttleKey(atomId: string, kind: AtomMarkerKind): string {
  return `${atomId}:${kind}`;
}

function isThrottled(atomId: string, kind: AtomMarkerKind): boolean {
  const k = throttleKey(atomId, kind);
  const last = recentToggle.get(k);
  if (last === undefined) return false;
  return Date.now() - last < TOGGLE_THROTTLE_MS;
}

function markToggle(atomId: string, kind: AtomMarkerKind): void {
  recentToggle.set(throttleKey(atomId, kind), Date.now());
}

const AtomMarkerBar: Component<Props> = (p) => {
  const starCount = createMemo(() => starCountForAtom(p.markers, p.atomType, p.atomId));
  const ownStar = createMemo(() => selfStarMarker(p.markers, p.userId, p.atomType, p.atomId));
  const ownEye = createMemo(() => selfEyeMarker(p.markers, p.userId, p.atomType, p.atomId));
  const [tooltipOpen, setTooltipOpen] = createSignal(false);

  // §13.3 V2-Polish — Star-Marker-Entries pro Atom mit aufgeloestem
  // WorkspaceMember (Initial + Label + Avatar-Color). Nicht-aufgeloeste
  // User_ids (geloeschter Account, Stale-Cache) fallen auf User-id-
  // Stump + Default-Color.
  const starUsers = createMemo<
    Array<{
      userId: string;
      label: string;
      initial: string;
      colorVar: string;
      isSelf: boolean;
    }>
  >(() => {
    const rows = starMarkersForAtom(p.markers, p.atomType, p.atomId);
    if (rows.length === 0) return [];
    const memberById = new Map<string, WorkspaceMember>();
    for (const m of p.wsMembers ?? []) memberById.set(m.user_id, m);
    return rows.map((row) => {
      const member = memberById.get(row.user_id);
      const label = member ? memberDisplayLabel(member) : row.user_id.slice(0, 8);
      const initial = (label.slice(0, 1) || '?').toUpperCase();
      const colorVar = member?.email ? avatarColorFor(member.email) : '--text3';
      return {
        userId: row.user_id,
        label: row.user_id === p.userId ? `${label} (Du)` : label,
        initial,
        colorVar,
        isSelf: row.user_id === p.userId,
      };
    });
  });

  const tooltipEnabled = createMemo(() => (p.wsMembers ?? []).length > 0 && starCount() > 0);

  async function toggle(kind: AtomMarkerKind): Promise<void> {
    if (isThrottled(p.atomId, kind)) return;
    markToggle(p.atomId, kind);
    try {
      const own = kind === 'star' ? ownStar() : ownEye();
      if (own) {
        await unsetAtomMarker(own.id);
      } else {
        const input: SetMarkerInput = {
          workspaceId: p.workspaceId,
          userId: p.userId,
          kind,
          atomType: p.atomType,
          atomId: p.atomId,
        };
        await setAtomMarker(input);
      }
    } catch (err) {
      console.error('AtomMarkerBar.toggle:', err);
      showToast('Marker konnte nicht gesetzt werden.', 'error');
    }
  }

  return (
    <span class="atom-marker-bar" aria-label="Markierungen" data-atom-type={p.atomType}>
      <span class="atom-marker-star-wrap">
        <button
          type="button"
          class="atom-marker-btn atom-marker-btn-star"
          classList={{ 'atom-marker-btn-active': !!ownStar() }}
          title={ownStar() ? 'Star entfernen' : 'Star setzen'}
          aria-label={ownStar() ? 'Star entfernen' : 'Star setzen'}
          aria-pressed={!!ownStar()}
          onClick={(e) => {
            e.stopPropagation();
            void toggle('star');
          }}
          onMouseEnter={() => {
            if (tooltipEnabled()) setTooltipOpen(true);
          }}
          onMouseLeave={() => setTooltipOpen(false)}
          onFocus={() => {
            if (tooltipEnabled()) setTooltipOpen(true);
          }}
          onBlur={() => setTooltipOpen(false)}
        >
          <Icon name="sparkles" size={14} />
          <Show when={starCount() > 0}>
            <span class="atom-marker-count">{starCount()}</span>
          </Show>
        </button>
        <Show when={tooltipOpen() && tooltipEnabled()}>
          <span class="atom-marker-tooltip" role="tooltip">
            <span class="atom-marker-tooltip-title">Gestartet von</span>
            <ul class="atom-marker-tooltip-list">
              <For each={starUsers()}>
                {(u) => (
                  <li class="atom-marker-tooltip-row" classList={{ 'is-self': u.isSelf }}>
                    <span
                      class="atom-marker-tooltip-avatar"
                      style={{ '--avatar-color': `var(${u.colorVar})` }}
                      aria-hidden="true"
                    >
                      {u.initial}
                    </span>
                    <span class="atom-marker-tooltip-label">{u.label}</span>
                  </li>
                )}
              </For>
            </ul>
          </span>
        </Show>
      </span>
      <button
        type="button"
        class="atom-marker-btn atom-marker-btn-eye"
        classList={{ 'atom-marker-btn-active': !!ownEye() }}
        title={ownEye() ? 'Beobachten beenden' : 'Beobachten'}
        aria-label={ownEye() ? 'Beobachten beenden' : 'Beobachten'}
        aria-pressed={!!ownEye()}
        onClick={(e) => {
          e.stopPropagation();
          void toggle('eye');
        }}
      >
        <Icon name={ownEye() ? 'eye' : 'eye-slash'} size={14} />
      </button>
    </span>
  );
};

export default AtomMarkerBar;
