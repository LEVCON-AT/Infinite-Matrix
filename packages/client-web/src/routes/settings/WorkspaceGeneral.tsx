// Settings → Workspace → Allgemein. Phase 1 (P1.A) Skeleton, P1.A.4-Polish,
// P1.B.4+B.5 Lifecycle-Aktionen.
//
// Zeigt Workspace-Stammdaten + Owner + Mitglieder-Zaehler. Owner-only-
// Bottom-Sektion "Gefahren-Zone" mit Eigentums-Uebertragung und
// Workspace-Loeschen. Beide Aktionen mit Type-To-Confirm-Modals.
//
// Edit-Pfad fuer Name/Slug bleibt offen (eigener Sprint).

import { useNavigate, useParams } from '@solidjs/router';
import { Show, createResource, createSignal } from 'solid-js';
import DeleteWorkspaceModal from '../../components/DeleteWorkspaceModal';
import Icon from '../../components/Icon';
import { ModalTransition } from '../../components/ModalTransition';
import TransferOwnershipModal from '../../components/TransferOwnershipModal';
import { useSession } from '../../lib/auth';
import { downloadIcs, exportWorkspaceCalendarIcs } from '../../lib/calendar-export';
import {
  createCalendarSubscription,
  getCalendarSubscription,
  revokeCalendarSubscription,
} from '../../lib/calendar-subscription';
import { translateDbError } from '../../lib/errors';
import { fetchMembers } from '../../lib/members';
import { fetchMyWorkspaces } from '../../lib/queries';
import { showToast } from '../../lib/toasts';

const WorkspaceGeneral = () => {
  const params = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const session = useSession();
  const [workspaces, { refetch: refetchWorkspaces }] = createResource(
    () => session()?.user?.id ?? null,
    () => fetchMyWorkspaces(),
  );
  const current = () => workspaces()?.find((w) => w.id === params.workspaceId);

  const [members, { refetch: refetchMembers }] = createResource(
    () => params.workspaceId,
    async (wsId) => {
      try {
        return await fetchMembers(wsId);
      } catch (err) {
        console.error('fetchMembers (WorkspaceGeneral):', err);
        return [];
      }
    },
  );

  const ownerEmail = () => {
    // Wenn aus get_workspace_owners-RPC bekannt: nutzen.
    const fromRpc = current()?.owner_email;
    if (fromRpc) return fromRpc;
    // Fallback: aus Members-Liste den Owner finden.
    return members()?.find((m) => m.role === 'owner')?.email ?? null;
  };

  const memberCount = () =>
    members()?.filter((m) => !('deactivated_at' in m && m.deactivated_at)).length ?? 0;

  // ─── Lifecycle-Modals (P1.B.4 + B.5) ───────────────────────────
  const [transferOpen, setTransferOpen] = createSignal(false);
  const [deleteOpen, setDeleteOpen] = createSignal(false);

  // Filter fuer das Transfer-Dropdown: aktive Members ohne mich, ohne
  // den aktuellen Owner (= ich, weil Show when={role === 'owner'}).
  // Kandidaten sind alle uebrigen aktiven Mitglieder unabhaengig
  // ihrer aktuellen Rolle — RPC promotet sie zu owner.
  const transferCandidates = () =>
    (members() ?? []).filter((m) => !m.deactivated_at && m.user_id !== session()?.user?.id);

  return (
    <article class="settings-pane">
      <header class="settings-pane-head">
        <h2>Allgemein</h2>
        <p class="hint">
          Workspace-Stammdaten. Edit fuer Name/Slug kommt in einer kuenftigen Phase.
        </p>
      </header>
      <Show
        when={current()}
        fallback={<p class="settings-empty">Workspace nicht gefunden oder nicht zugaenglich.</p>}
      >
        {(ws) => (
          <>
            <dl class="settings-form-grid">
              <dt>Name</dt>
              <dd>
                <code class="settings-readback">{ws().name}</code>
              </dd>
              <dt>Owner</dt>
              <dd>
                <Show when={ownerEmail()} fallback={<span class="hint">unbekannt</span>}>
                  <code class="settings-readback">{ownerEmail()}</code>
                </Show>
              </dd>
              <dt>Mitglieder</dt>
              <dd>
                <code class="settings-readback">{memberCount()}</code>
              </dd>
              <dt>Deine Rolle</dt>
              <dd>
                <span class={`settings-role-chip role-${ws().role}`}>{ws().role}</span>
              </dd>
              <dt>Workspace-ID</dt>
              <dd>
                <code class="settings-readback settings-readback-mono">{ws().id}</code>
              </dd>
              <dt>Erstellt</dt>
              <dd>
                <code class="settings-readback">{new Date(ws().created_at).toLocaleString()}</code>
              </dd>
            </dl>

            <CalendarExportSection workspaceId={params.workspaceId} workspaceName={ws().name} />

            <Show when={ws().role === 'owner'}>
              <section class="settings-form-section settings-danger-zone">
                <h3 id="danger-zone-head">Gefahren-Zone</h3>
                <p class="hint">
                  Beide Aktionen sind nur fuer den Eigentuemer verfuegbar und brauchen eine
                  zusaetzliche Bestaetigung.
                </p>
                <div class="settings-foot">
                  <button
                    type="button"
                    class="btn-subtle"
                    onClick={() => setTransferOpen(true)}
                    disabled={members.loading}
                  >
                    <Icon name="arrow-top-right-on-square" size={14} />
                    <span>Eigentum uebertragen</span>
                  </button>
                  <button
                    type="button"
                    class="btn-danger-subtle"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Icon name="trash" size={14} />
                    <span>Workspace loeschen</span>
                  </button>
                </div>
              </section>

              <ModalTransition when={transferOpen()}>
                <TransferOwnershipModal
                  workspaceId={params.workspaceId}
                  workspaceName={ws().name}
                  members={transferCandidates()}
                  onClose={() => setTransferOpen(false)}
                  onTransferred={() => {
                    setTransferOpen(false);
                    void refetchWorkspaces();
                    void refetchMembers();
                    navigate(`/w/${params.workspaceId}/settings/workspace/members`);
                  }}
                />
              </ModalTransition>

              <ModalTransition when={deleteOpen()}>
                <DeleteWorkspaceModal
                  workspaceId={params.workspaceId}
                  workspaceName={ws().name}
                  onClose={() => setDeleteOpen(false)}
                  onDeleted={() => {
                    setDeleteOpen(false);
                    showToast(`Workspace „${ws().name}" geloescht.`, 'success');
                    navigate('/');
                  }}
                />
              </ModalTransition>
            </Show>
          </>
        )}
      </Show>
    </article>
  );
};

// Calendar-Export V1: ICS-Download fuer Outlook/Google/Apple Calendar.
// V2 (Subscription-Feed) folgt mit eigenem Node-Service.
function CalendarExportSection(props: { workspaceId: string; workspaceName: string }) {
  const [busy, setBusy] = createSignal(false);

  async function onDownload() {
    setBusy(true);
    try {
      const { filename, content } = await exportWorkspaceCalendarIcs({
        workspaceId: props.workspaceId,
        workspaceName: props.workspaceName,
      });
      downloadIcs(filename, content);
      showToast('Calendar exportiert.', 'success');
    } catch (err) {
      showToast(translateDbError(err, 'Export fehlgeschlagen.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <CalendarSubscriptionPane workspaceId={props.workspaceId} />
      <section class="settings-form-section">
        <h3>Einmal-Export</h3>
        <p class="hint">
          .ics-Datei zum manuellen Import. Fuer Live-Sync nutze stattdessen das Abo oben.
        </p>
        <button
          type="button"
          class="btn btn-subtle"
          onClick={() => void onDownload()}
          disabled={busy()}
        >
          {busy() ? 'Exportiere…' : '.ics herunterladen'}
        </button>
      </section>
    </>
  );
}

// Calendar V2 — Live-Subscription-Feed.
function CalendarSubscriptionPane(props: { workspaceId: string }) {
  const [sub, { refetch }] = createResource(
    () => props.workspaceId,
    async (wsId) => {
      try {
        return await getCalendarSubscription(wsId);
      } catch (err) {
        console.error('getCalendarSubscription:', err);
        return null;
      }
    },
  );
  const [busy, setBusy] = createSignal(false);

  async function onCreate() {
    setBusy(true);
    try {
      await createCalendarSubscription(props.workspaceId);
      void refetch();
      showToast('Calendar-Abo erstellt.', 'success');
    } catch (err) {
      showToast(translateDbError(err, 'Erstellen fehlgeschlagen.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke() {
    setBusy(true);
    try {
      await revokeCalendarSubscription(props.workspaceId);
      void refetch();
      showToast('Calendar-Abo entfernt.', 'success');
    } catch (err) {
      showToast(translateDbError(err, 'Entfernen fehlgeschlagen.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  function copyUrl() {
    const s = sub();
    if (!s) return;
    void navigator.clipboard.writeText(s.url);
    showToast('URL kopiert.', 'success');
  }

  return (
    <section class="settings-form-section">
      <h3>Kalender-Abo (Live-Feed)</h3>
      <p class="hint">
        Outlook / Google / Apple Calendar abonnieren die URL — der Calendar-Client polled periodisch
        und holt aktuelle Events automatisch. Pro Workspace ein Token. Token ist URL- zugaenglich;
        ein anderer mit der URL kann den Feed lesen — bei Verdacht: Abo entfernen + neu erstellen.
      </p>

      <Show
        when={sub()}
        fallback={
          <button
            type="button"
            class="btn btn-primary lift"
            onClick={() => void onCreate()}
            disabled={busy() || sub.loading}
          >
            {busy() ? 'Erstelle…' : 'Abo erstellen'}
          </button>
        }
      >
        {(s) => (
          <div class="calendar-sub-pane">
            <label class="login-field">
              <span>Feed-URL (in Calendar einfuegen)</span>
              <input
                class="input"
                type="text"
                readonly
                value={s().url}
                onClick={(e) => e.currentTarget.select()}
              />
            </label>
            <div class="settings-foot">
              <button type="button" class="btn btn-subtle" onClick={copyUrl}>
                Kopieren
              </button>
              <button
                type="button"
                class="btn btn-subtle"
                onClick={() => void onCreate()}
                disabled={busy()}
              >
                Token rotieren
              </button>
              <button
                type="button"
                class="btn btn-danger"
                onClick={() => void onRevoke()}
                disabled={busy()}
              >
                Abo entfernen
              </button>
            </div>
          </div>
        )}
      </Show>
    </section>
  );
}

export default WorkspaceGeneral;
