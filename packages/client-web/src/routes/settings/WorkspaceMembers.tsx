// Settings → Workspace → Mitglieder. Phase 1 (P1.A) Hauptseite.
//
// Zeigt aktive Mitglieder + offene Einladungen in einer einheitlichen
// Liste. Owner/Admin koennen neue Einladungen erstellen + offene
// widerrufen. Rollen-Aenderung + Member-Entfernen kommen P1.B.
//
// Read-Pfad: fetchMembers (RPC list_workspace_members) + fetchInvites
// (PostgREST mit RLS). Mutation-Pfad: createInvite + revokeInvite
// laufen synchron-online ohne Offline-Queue (Memory feedback_saas_
// security_no_offline).

import { useParams } from '@solidjs/router';
import { Show, createResource, createSignal } from 'solid-js';
import InviteForm from '../../components/InviteForm';
import InviteSuccessModal from '../../components/InviteSuccessModal';
import MembersList from '../../components/MembersList';
import { useSession } from '../../lib/auth';
import { translateDbError } from '../../lib/errors';
import { fetchInvites } from '../../lib/invites';
import { fetchMembers } from '../../lib/members';
import { fetchMyWorkspaces } from '../../lib/queries';
import { showToast } from '../../lib/toasts';

const WorkspaceMembers = () => {
  const params = useParams<{ workspaceId: string }>();
  const session = useSession();

  // Workspace-Liste fuer Rolle-Lookup (kann der Caller einladen?).
  const [workspaces] = createResource(
    () => session()?.user?.id ?? null,
    () => fetchMyWorkspaces(),
  );
  const myRole = () => workspaces()?.find((w) => w.id === params.workspaceId)?.role;
  const canInvite = () => myRole() === 'owner' || myRole() === 'admin';

  const [members, { refetch: refetchMembers }] = createResource(
    () => params.workspaceId,
    async (wsId) => {
      try {
        return await fetchMembers(wsId);
      } catch (err) {
        showToast(translateDbError(err, 'Mitglieder konnten nicht geladen werden.'), 'error');
        return [];
      }
    },
  );
  const [invites, { refetch: refetchInvites }] = createResource(
    () => params.workspaceId,
    async (wsId) => {
      // Nur fuer admin/owner sinnvoll — sonst sehen wir sowieso nichts.
      if (!canInvite()) return [];
      try {
        return await fetchInvites(wsId);
      } catch (err) {
        showToast(translateDbError(err, 'Einladungen konnten nicht geladen werden.'), 'error');
        return [];
      }
    },
  );

  type SuccessState = {
    token: string;
    link: string;
    expiresAt: string;
    invitedEmail: string | null;
    mailSent: boolean;
  };
  const [success, setSuccess] = createSignal<SuccessState | null>(null);

  const handleInviteCreated = (result: {
    token: string;
    link: string;
    expires_at: string;
    invitedEmail: string | null;
    mailSent: boolean;
  }) => {
    setSuccess({
      token: result.token,
      link: result.link,
      expiresAt: result.expires_at,
      invitedEmail: result.invitedEmail,
      mailSent: result.mailSent,
    });
    void refetchInvites();
    showToast('Einladung erstellt.', 'success');
  };

  const handleListChanged = () => {
    void refetchMembers();
    void refetchInvites();
  };

  return (
    <article class="settings-pane">
      <header class="settings-pane-head">
        <h2>Mitglieder</h2>
        <p class="hint">
          Wer im Workspace mitarbeitet — und wer noch eingeladen ist. Owner/Admin koennen neue
          Personen einladen und offene Einladungen widerrufen.
        </p>
      </header>

      <Show when={canInvite()}>
        <section class="settings-form-section">
          <h3>Neue Person einladen</h3>
          <InviteForm workspaceId={params.workspaceId} onCreated={handleInviteCreated} />
        </section>
      </Show>

      <section class="settings-form-section">
        <header class="settings-section-head">
          <h3>Aktuelle Mitglieder</h3>
          <button
            type="button"
            class="btn-subtle"
            onClick={() => {
              void refetchMembers();
              void refetchInvites();
            }}
            disabled={members.loading || invites.loading}
            aria-label="Liste neu laden"
          >
            Neu laden
          </button>
        </header>
        <MembersList
          workspaceId={params.workspaceId}
          members={members() ?? []}
          invites={invites() ?? []}
          myRole={myRole()}
          myUserId={session()?.user?.id}
          onChanged={handleListChanged}
        />
      </section>

      <Show when={success()}>
        {(s) => (
          <InviteSuccessModal
            token={s().token}
            link={s().link}
            invitedEmail={s().invitedEmail}
            expiresAt={s().expiresAt}
            mailSent={s().mailSent}
            onClose={() => setSuccess(null)}
          />
        )}
      </Show>
    </article>
  );
};

export default WorkspaceMembers;
