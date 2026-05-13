// InviteForm — Phase 1 (P1.A).
//
// Inline-Form auf der Settings-Members-Page: Email (optional), Rolle
// (editor|viewer). Submit triggert create_invite-RPC; bei Erfolg wird
// onCreated mit Klartext-Token + Link aufgerufen — der Caller zeigt
// dann InviteSuccessModal.

import { type Component, createSignal } from 'solid-js';
import { translateDbError } from '../lib/errors';
import {
  type CreateInviteResult,
  type InviteRole,
  buildInviteLink,
  createInvite,
  sendInviteMail,
  translateInviteError,
} from '../lib/invites';
import { showToast } from '../lib/toasts';
import Icon from './Icon';

export type InviteFormProps = {
  workspaceId: string;
  // Welle F.4 — Default-Rolle aus dem Workspace. Caller threadet aus
  // current()?.default_invite_role; Default 'editor' wenn der Caller
  // den Wert nicht kennt (Backwards-Compat fuer alte Cache-Treffer).
  defaultRole?: InviteRole;
  // Caller bekommt Result + fertigen Mail-Link + invitedEmail (kann null sein
  // wenn nur Link erstellt) + ob Mail-Send erfolgreich war (true = SMTP-Pfad
  // lief, false = nur Klartext-Link verfuegbar). InviteSuccessModal zeigt
  // damit eine "Mail gesendet"- oder "manuell senden"-Variante.
  onCreated: (
    result: CreateInviteResult & {
      link: string;
      invitedEmail: string | null;
      mailSent: boolean;
    },
  ) => void;
};

const InviteForm: Component<InviteFormProps> = (p) => {
  const [email, setEmail] = createSignal('');
  const [role, setRole] = createSignal<InviteRole>(p.defaultRole ?? 'editor');
  const [busy, setBusy] = createSignal(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy()) return;
    setBusy(true);
    try {
      const trimmedEmail = email().trim();
      const result = await createInvite(p.workspaceId, role(), trimmedEmail || null);
      const link = buildInviteLink(result.token);

      // Wenn Email gesetzt: parallel Magic-Link-Mail senden. Failure
      // ist non-fatal — Modal zeigt dann den manuellen Pfad.
      let mailSent = false;
      if (trimmedEmail) {
        try {
          await sendInviteMail(result.token, trimmedEmail);
          mailSent = true;
          showToast(`Einladungs-Mail an ${trimmedEmail} gesendet.`, 'success');
        } catch (mailErr) {
          // Mail-Send ist Bonus — nicht blockend. Modal zeigt mailto-Fallback.
          showToast(
            translateDbError(
              mailErr,
              'Mail-Versand fehlgeschlagen — Link bitte manuell aus dem Modal kopieren.',
            ),
            'info',
          );
        }
      }

      p.onCreated({
        ...result,
        link,
        invitedEmail: trimmedEmail || null,
        mailSent,
      });
      setEmail('');
    } catch (err) {
      showToast(
        translateInviteError(err, translateDbError(err, 'Einladung konnte nicht erstellt werden.')),
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="invite-form" onSubmit={(e) => void submit(e)}>
      <div class="invite-form-row">
        <label class="invite-form-field invite-form-field-grow">
          <span class="invite-form-label">E-Mail (optional)</span>
          <input
            type="email"
            class="invite-form-input"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            placeholder="name@beispiel.at"
            autocomplete="email"
            disabled={busy()}
          />
        </label>
        <label class="invite-form-field">
          <span class="invite-form-label">Rolle</span>
          <select
            class="invite-form-input invite-form-role"
            value={role()}
            onChange={(e) => setRole(e.currentTarget.value as InviteRole)}
            disabled={busy()}
          >
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        </label>
        <button type="submit" class="btn-c invite-form-submit" disabled={busy()}>
          <Icon name="envelope" size={14} />
          <span>{busy() ? 'Lege an…' : 'Einladung erstellen'}</span>
        </button>
      </div>
      <p class="hint invite-form-hint">
        Editor darf editieren, Viewer nur lesen. Owner/Admin koennen nur direkt vergeben werden,
        nicht per Einladung.
      </p>
    </form>
  );
};

export default InviteForm;
