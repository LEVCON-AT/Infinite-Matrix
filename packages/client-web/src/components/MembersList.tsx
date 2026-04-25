// MembersList — Phase 1 (P1.A).
//
// Tabellenartige Liste aller Workspace-Mitglieder + offene Einladungen
// in einer einheitlichen Ansicht ("unified members view"). Pending-
// Eintraege haben einen abgegrauten Avatar-Placeholder + Sub-Label
// "Einladung offen".
//
// Aktionen pro Zeile (P1.B):
//   - Member-Aktionen-Kebab (Rolle aendern, entfernen) — disabled in P1.A.
//   - Pending-Aktionen: Widerrufen, Link kopieren — Widerrufen ist live.

import { type Component, For, Show } from 'solid-js';
import { showChoice } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import {
  type WorkspaceInviteRow,
  inviteStatus,
  revokeInvite,
  translateInviteError,
} from '../lib/invites';
import { type WorkspaceMember, memberDisplayLabel } from '../lib/members';
import { showToast } from '../lib/toasts';
import Icon from './Icon';

export type MembersListProps = {
  members: WorkspaceMember[];
  invites: WorkspaceInviteRow[];
  // Caller invalidiert die Listen nach erfolgreichem Revoke.
  onInviteChanged: () => void;
};

const formatRelative = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) return 'heute';
  if (days === 1) return 'vor 1 Tag';
  if (days < 30) return `vor ${days} Tagen`;
  const months = Math.floor(days / 30);
  if (months === 1) return 'vor 1 Monat';
  if (months < 12) return `vor ${months} Monaten`;
  const years = Math.floor(months / 12);
  return years === 1 ? 'vor 1 Jahr' : `vor ${years} Jahren`;
};

const MembersList: Component<MembersListProps> = (p) => {
  const handleRevoke = async (inviteId: string, label: string) => {
    const ok = await showChoice({
      title: 'Einladung widerrufen',
      message: `Einladung an "${label}" widerrufen? Der Link wird sofort ungueltig.`,
      choices: [
        { id: 'revoke', label: 'Widerrufen', variant: 'danger' },
        { id: 'cancel', label: 'Abbrechen', variant: 'default' },
      ],
    });
    if (ok !== 'revoke') return;
    try {
      const res = await revokeInvite(inviteId);
      if (res.changed) {
        showToast('Einladung widerrufen.', 'success');
        p.onInviteChanged();
      } else {
        showToast(`Einladung war bereits ${res.previous_state}.`, 'info');
        p.onInviteChanged();
      }
    } catch (err) {
      showToast(
        translateInviteError(err, translateDbError(err, 'Widerruf fehlgeschlagen.')),
        'error',
      );
    }
  };

  // Nur OFFENE Invites in der Liste — accepted/revoked/expired blenden
  // wir aus, die wandern in den Audit-Log.
  const openInvites = () => p.invites.filter((i) => inviteStatus(i) === 'open');

  return (
    <table class="members-table" aria-label="Mitglieder und offene Einladungen">
      <thead>
        <tr class="members-row members-row-head">
          <th scope="col">Mitglied</th>
          <th scope="col">Rolle</th>
          <th scope="col">Beigetreten</th>
          <th scope="col" class="members-row-actions">
            Aktionen
          </th>
        </tr>
      </thead>
      <tbody>
        <For
          each={p.members}
          fallback={
            <tr>
              <td colSpan={4} class="members-empty">
                Noch keine Mitglieder geladen.
              </td>
            </tr>
          }
        >
          {(m) => (
            <tr class="members-row">
              <td class="members-cell-name">
                <div class="members-avatar" aria-hidden="true">
                  {memberDisplayLabel(m).slice(0, 1).toUpperCase()}
                </div>
                <div class="members-name-stack">
                  <span class="members-name">{memberDisplayLabel(m)}</span>
                  <Show when={m.email && m.email !== memberDisplayLabel(m)}>
                    <span class="members-sub">{m.email}</span>
                  </Show>
                </div>
              </td>
              <td>
                <span class={`settings-role-chip role-${m.role}`}>{m.role}</span>
                <Show when={m.role === 'owner'}>
                  <span class="members-locked-badge" title="Owner-Rolle ist gesperrt">
                    <Icon name="lock-closed" size={12} />
                    <span>locked</span>
                  </span>
                </Show>
              </td>
              <td class="members-meta">{formatRelative(m.joined_at)}</td>
              <td class="members-row-actions">
                <button
                  type="button"
                  class="btn-subtle"
                  disabled
                  title="Rollen-Aenderung kommt in P1.B"
                >
                  <Icon name="ellipsis-horizontal" size={14} />
                </button>
              </td>
            </tr>
          )}
        </For>
      </tbody>
      <Show when={openInvites().length > 0}>
        <tbody class="members-tbody-pending">
          <tr class="members-row members-row-section">
            <th scope="colgroup" colSpan={4} class="members-section-h">
              Offene Einladungen
              <span class="members-section-count">({openInvites().length})</span>
            </th>
          </tr>
          <For each={openInvites()}>
            {(inv) => (
              <tr class="members-row members-row-pending">
                <td class="members-cell-name">
                  <div class="members-avatar members-avatar-pending" aria-hidden="true">
                    ??
                  </div>
                  <div class="members-name-stack">
                    <span class="members-name">{inv.invited_email ?? 'Unbenannte Einladung'}</span>
                    <span class="members-sub">
                      Einladung offen, erstellt {formatRelative(inv.created_at)}
                    </span>
                  </div>
                </td>
                <td>
                  <span class={`settings-role-chip role-${inv.role}`}>{inv.role}</span>
                </td>
                <td class="members-meta">
                  Laeuft ab am {new Date(inv.expires_at).toLocaleDateString()}
                </td>
                <td class="members-row-actions">
                  <button
                    type="button"
                    class="btn-subtle btn-danger-subtle"
                    onClick={() =>
                      void handleRevoke(inv.id, inv.invited_email ?? `Invite ${inv.id.slice(0, 8)}`)
                    }
                    title="Einladung widerrufen"
                  >
                    <Icon name="no-symbol" size={14} />
                    <span>Widerrufen</span>
                  </button>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </Show>
    </table>
  );
};

export default MembersList;
