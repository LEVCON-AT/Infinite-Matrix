// MembersList — Phase 1 (P1.A) + Member-Aktionen (P1.A.4).
//
// Tabellenartige Liste aller Workspace-Mitglieder + offene Einladungen
// in einer einheitlichen Ansicht ("unified members view"). Pending-
// Eintraege haben einen abgegrauten Avatar-Placeholder + Sub-Label
// "Einladung offen".
//
// Aktionen pro Zeile:
//   - Member-Aktionen: Deaktivieren / Reaktivieren (admin+) und
//     Entfernen (owner only). Per Inline-Buttons im Aktionen-Slot.
//   - Pending-Aktionen: Widerrufen.
//   - Self: keine Aktionen (man kann sich nicht selbst rauswerfen).

import { type Component, For, Show, createSignal } from 'solid-js';
import { formatRelativeDeLong } from '../lib/dates';
import { showChoice } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import {
  type WorkspaceInviteRow,
  inviteStatus,
  revokeInvite,
  translateInviteError,
} from '../lib/invites';
import {
  type WorkspaceMember,
  changeMemberRole,
  deactivateMember,
  memberDisplayLabel,
  reactivateMember,
  removeMember,
  translateMemberError,
} from '../lib/members';
import { showToast } from '../lib/toasts';
import type { WorkspaceRole } from '../lib/types';
import Icon from './Icon';

export type MembersListProps = {
  workspaceId: string;
  members: WorkspaceMember[];
  invites: WorkspaceInviteRow[];
  myRole: WorkspaceRole | undefined;
  myUserId: string | undefined;
  // Caller invalidiert die Listen nach Mutationen.
  onChanged: () => void;
};

const MembersList: Component<MembersListProps> = (p) => {
  const canManage = () => p.myRole === 'owner' || p.myRole === 'admin';
  const canRemove = () => p.myRole === 'owner';
  const isSelf = (userId: string) => p.myUserId === userId;

  // pro user_id ein Pending-Flag, damit das <select> waehrend des RPC
  // disabled bleibt + nicht gleich nochmal getriggert werden kann.
  const [pendingRole, setPendingRole] = createSignal<Set<string>>(new Set());
  const isPending = (uid: string) => pendingRole().has(uid);
  const markPending = (uid: string, on: boolean) => {
    setPendingRole((prev) => {
      const next = new Set(prev);
      if (on) next.add(uid);
      else next.delete(uid);
      return next;
    });
  };

  // Welche Rollen-Optionen darf der Caller fuer dieses Target setzen?
  // Backend setzt die Regeln zwingend — dies ist nur die UI-Vorschau,
  // damit der User nicht in offene RPC-Errors laeuft.
  //
  //   owner  : alle 4 Rollen.
  //   admin  : nur editor|viewer, nur fuer editor|viewer-Targets.
  //   sonst  : keine (Dropdown wird gar nicht gerendert).
  const allowedRoles = (target: WorkspaceMember): WorkspaceRole[] => {
    if (p.myRole === 'owner') return ['owner', 'admin', 'editor', 'viewer'];
    if (p.myRole === 'admin') {
      if (target.role === 'owner' || target.role === 'admin') return [];
      return ['editor', 'viewer'];
    }
    return [];
  };

  // Dropdown nur anzeigen wenn:
  //  - canManage(), nicht self, target nicht deaktiviert
  //  - allowedRoles liefert mind. 2 Werte (sonst kein Wechsel moeglich)
  const canChangeRole = (m: WorkspaceMember) =>
    canManage() && !isSelf(m.user_id) && m.deactivated_at == null && allowedRoles(m).length >= 2;

  const handleRoleChange = async (m: WorkspaceMember, newRole: WorkspaceRole) => {
    if (newRole === m.role) return;
    markPending(m.user_id, true);
    try {
      const res = await changeMemberRole(p.workspaceId, m.user_id, newRole);
      if (res.changed) {
        showToast(`Rolle: ${memberDisplayLabel(m)} -> ${newRole}.`, 'success');
      } else {
        showToast('Rolle unveraendert.', 'info');
      }
      p.onChanged();
    } catch (err) {
      console.error('handleRoleChange:', err);
      showToast(
        translateMemberError(err, translateDbError(err, 'Rollen-Aenderung fehlgeschlagen.')),
        'error',
      );
      // Re-Fetch im onChanged-Caller setzt das Select zurueck;
      // hier reichts den Pending-Flag zu loesen.
    } finally {
      markPending(m.user_id, false);
    }
  };

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
      } else {
        showToast(`Einladung war bereits ${res.previous_state}.`, 'info');
      }
      p.onChanged();
    } catch (err) {
      console.error('handleRevoke:', err);
      showToast(
        translateInviteError(err, translateDbError(err, 'Widerruf fehlgeschlagen.')),
        'error',
      );
    }
  };

  const handleDeactivate = async (m: WorkspaceMember) => {
    const ok = await showChoice({
      title: 'Mitglied deaktivieren',
      message: `${memberDisplayLabel(m)} deaktivieren? Der Zugriff auf den Workspace wird sofort entzogen, der Eintrag bleibt fuer eventuelle Reaktivierung erhalten.`,
      choices: [
        { id: 'deactivate', label: 'Deaktivieren', variant: 'danger' },
        { id: 'cancel', label: 'Abbrechen', variant: 'default' },
      ],
    });
    if (ok !== 'deactivate') return;
    try {
      const res = await deactivateMember(p.workspaceId, m.user_id);
      if (res.changed) {
        showToast(`${memberDisplayLabel(m)} deaktiviert.`, 'success');
      } else {
        showToast('Mitglied war bereits deaktiviert.', 'info');
      }
      p.onChanged();
    } catch (err) {
      console.error('handleDeactivate:', err);
      showToast(
        translateMemberError(err, translateDbError(err, 'Deaktivierung fehlgeschlagen.')),
        'error',
      );
    }
  };

  const handleReactivate = async (m: WorkspaceMember) => {
    try {
      const res = await reactivateMember(p.workspaceId, m.user_id);
      if (res.changed) {
        showToast(`${memberDisplayLabel(m)} reaktiviert.`, 'success');
      } else {
        showToast('Mitglied war bereits aktiv.', 'info');
      }
      p.onChanged();
    } catch (err) {
      console.error('handleReactivate:', err);
      showToast(
        translateMemberError(err, translateDbError(err, 'Reaktivierung fehlgeschlagen.')),
        'error',
      );
    }
  };

  const handleRemove = async (m: WorkspaceMember) => {
    const ok = await showChoice({
      title: 'Mitglied entfernen',
      message: `${memberDisplayLabel(m)} dauerhaft aus dem Workspace entfernen? Der Eintrag wird geloescht. Bei Bedarf muss eine neue Einladung verschickt werden.`,
      choices: [
        { id: 'remove', label: 'Endgueltig entfernen', variant: 'danger' },
        { id: 'cancel', label: 'Abbrechen', variant: 'default' },
      ],
    });
    if (ok !== 'remove') return;
    try {
      await removeMember(p.workspaceId, m.user_id);
      showToast(`${memberDisplayLabel(m)} entfernt.`, 'success');
      p.onChanged();
    } catch (err) {
      console.error('handleRemove:', err);
      showToast(
        translateMemberError(err, translateDbError(err, 'Entfernen fehlgeschlagen.')),
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
            <tr
              id={`user-${m.user_id}`}
              class="members-row"
              classList={{ 'members-row-deactivated': m.deactivated_at != null }}
            >
              <td class="members-cell-name">
                <div class="members-avatar" aria-hidden="true">
                  {memberDisplayLabel(m).slice(0, 1).toUpperCase()}
                </div>
                <div class="members-name-stack">
                  <span class="members-name">
                    {memberDisplayLabel(m)}
                    <Show when={isSelf(m.user_id)}>
                      <span class="members-self-badge">du</span>
                    </Show>
                  </span>
                  <Show when={m.email && m.email !== memberDisplayLabel(m)}>
                    <span class="members-sub">{m.email}</span>
                  </Show>
                </div>
              </td>
              <td>
                <Show
                  when={canChangeRole(m)}
                  fallback={<span class={`settings-role-chip role-${m.role}`}>{m.role}</span>}
                >
                  <select
                    class={`members-role-select role-${m.role}`}
                    value={m.role}
                    disabled={isPending(m.user_id)}
                    aria-label={`Rolle von ${memberDisplayLabel(m)} aendern`}
                    onChange={(e) => {
                      const next = e.currentTarget.value as WorkspaceRole;
                      // Optimistic UI uebernimmt der onChanged-Refetch;
                      // hier setzen wir das Dropdown nur zurueck wenn der
                      // RPC fehlschlaegt — Browser zeigt waehrenddessen
                      // schon die neue Auswahl, was OK ist.
                      void handleRoleChange(m, next);
                    }}
                  >
                    <For each={allowedRoles(m)}>{(r) => <option value={r}>{r}</option>}</For>
                  </select>
                </Show>
                <Show when={m.deactivated_at != null}>
                  <span class="members-deactivated-badge" title="Membership deaktiviert">
                    <Icon name="no-symbol" size={12} />
                    <span>deaktiviert</span>
                  </span>
                </Show>
              </td>
              <td class="members-meta">{formatRelativeDeLong(m.joined_at)}</td>
              <td class="members-row-actions">
                <Show when={canManage() && !isSelf(m.user_id)}>
                  <Show
                    when={m.deactivated_at != null}
                    fallback={
                      <button
                        type="button"
                        class="btn-subtle btn-danger-subtle"
                        onClick={() => void handleDeactivate(m)}
                        title="Mitglied deaktivieren"
                      >
                        <Icon name="no-symbol" size={14} />
                        <span>Deaktivieren</span>
                      </button>
                    }
                  >
                    <button
                      type="button"
                      class="btn-subtle"
                      onClick={() => void handleReactivate(m)}
                      title="Mitglied reaktivieren"
                    >
                      <Icon name="check" size={14} />
                      <span>Reaktivieren</span>
                    </button>
                  </Show>
                </Show>
                <Show when={canRemove() && !isSelf(m.user_id)}>
                  <button
                    type="button"
                    class="btn-subtle btn-danger-subtle"
                    onClick={() => void handleRemove(m)}
                    title="Mitglied dauerhaft entfernen"
                  >
                    <Icon name="trash" size={14} />
                    <span>Entfernen</span>
                  </button>
                </Show>
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
                      Einladung offen, erstellt {formatRelativeDeLong(inv.created_at)}
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
                  <Show when={canManage()}>
                    <button
                      type="button"
                      class="btn-subtle btn-danger-subtle"
                      onClick={() =>
                        void handleRevoke(
                          inv.id,
                          inv.invited_email ?? `Invite ${inv.id.slice(0, 8)}`,
                        )
                      }
                      title="Einladung widerrufen"
                    >
                      <Icon name="no-symbol" size={14} />
                      <span>Widerrufen</span>
                    </button>
                  </Show>
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
