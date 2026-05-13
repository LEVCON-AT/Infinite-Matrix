// Settings → Konto → Profil. Phase 1 (P1.A) Skeleton + Welle F.5/F.6 + D.1 + D.3.
//
// Welle F.5 — Email-Verification-Status-Badge: `email_confirmed_at`
// aus dem auth.user-Objekt entscheidet zwischen „verifiziert" und
// „bestaetigung ausstehend".
// Welle F.6 — Resend-Verification-Mail-Button: sichtbar wenn
// email_confirmed_at fehlt. supabase.auth.resend({type:'signup',email}).
// Welle D.1 — Display-Name + Email-Aenderung: beide Inline-Edit-Pattern
// analog F.1 Workspace-Rename. Email-Change triggert Supabase-Verify-
// Mail auf die neue Adresse — bis zur Bestaetigung bleibt die alte
// Email aktiv (Supabase-Default, schuetzt vor Tippfehler-Lock).
// Welle D.3 — Bio + Timezone + Language aus user_profiles (Migration
// 085, Lazy-Upsert). V1 nur Storage + UI; Wiring in Date-Formatter
// (Recur-TZ-Aware-Refactor) folgt in D.3-V2.

import { Show, createResource, createSignal } from 'solid-js';
import Icon from '../../components/Icon';
import { changeEmail, setDisplayName } from '../../lib/account';
import { useSession } from '../../lib/auth';
import { translateDbError } from '../../lib/errors';
import { deleteAvatar, uploadAvatar } from '../../lib/storage';
import { supabase } from '../../lib/supabase';
import { showToast } from '../../lib/toasts';
import { fetchMyUserProfile, setUserProfile } from '../../lib/user-profile';

const AccountProfile = () => {
  const session = useSession();
  const user = () => session()?.user ?? null;
  const displayName = () => {
    const meta = user()?.user_metadata as Record<string, unknown> | undefined;
    const name = meta?.display_name;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  };
  const emailVerified = () => Boolean(user()?.email_confirmed_at);

  const [resending, setResending] = createSignal(false);
  async function onResendVerification() {
    if (resending()) return;
    const email = user()?.email;
    if (!email) return;
    setResending(true);
    try {
      // F.6 — Resend-Verification. type='signup' deckt den Pending-State
      // ab; bei email-change-Flows ist type='email_change' der Pfad.
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      if (error) throw error;
      showToast('Bestaetigungsmail erneut versendet — Postfach pruefen.', 'success');
    } catch (err) {
      console.error('resendVerification:', err);
      showToast(translateDbError(err, 'Versand fehlgeschlagen.'), 'error');
    } finally {
      setResending(false);
    }
  }

  // ─── D.1 Display-Name Edit ─────────────────────────────────────
  const [nameEditing, setNameEditing] = createSignal(false);
  const [nameDraft, setNameDraft] = createSignal('');
  const [nameSaving, setNameSaving] = createSignal(false);
  function startEditName() {
    setNameDraft(displayName() ?? '');
    setNameEditing(true);
  }
  function cancelEditName() {
    setNameEditing(false);
    setNameDraft('');
  }
  async function saveEditName() {
    if (nameSaving()) return;
    const next = nameDraft().trim();
    if (next === (displayName() ?? '')) {
      cancelEditName();
      return;
    }
    setNameSaving(true);
    try {
      await setDisplayName(next);
      showToast(next ? 'Anzeigename gespeichert.' : 'Anzeigename entfernt.', 'success');
      setNameEditing(false);
    } catch (err) {
      console.error('setDisplayName:', err);
      showToast(translateDbError(err, 'Speichern fehlgeschlagen.'), 'error');
    } finally {
      setNameSaving(false);
    }
  }

  // ─── D.3 User-Profile (Bio + Timezone + Language) ──────────────
  const [profile, { refetch: refetchProfile }] = createResource(
    () => user()?.id ?? null,
    async (uid) => {
      if (!uid) return null;
      try {
        return await fetchMyUserProfile(uid);
      } catch (err) {
        console.error('fetchMyUserProfile:', err);
        return null;
      }
    },
  );
  const bio = () => profile()?.bio ?? null;
  const timezone = () => profile()?.timezone ?? null;
  const language = () => profile()?.language ?? null;
  const avatarUrl = () => profile()?.avatar_url ?? null;

  // D.2 Avatar Upload/Delete.
  const [avatarUploading, setAvatarUploading] = createSignal(false);
  let avatarFileInput: HTMLInputElement | undefined;
  async function onAvatarFile(file: File | null) {
    if (!file) return;
    const uid = user()?.id;
    if (!uid) return;
    setAvatarUploading(true);
    try {
      const { publicUrl } = await uploadAvatar(uid, file);
      await setUserProfile(uid, { avatar_url: publicUrl });
      await refetchProfile();
      showToast('Avatar gespeichert.', 'success');
    } catch (err) {
      console.error('uploadAvatar:', err);
      showToast(translateDbError(err, 'Avatar-Upload fehlgeschlagen.'), 'error');
    } finally {
      setAvatarUploading(false);
      if (avatarFileInput) avatarFileInput.value = '';
    }
  }
  async function onAvatarDelete() {
    const uid = user()?.id;
    if (!uid) return;
    setAvatarUploading(true);
    try {
      await deleteAvatar(uid, avatarUrl());
      await setUserProfile(uid, { avatar_url: null });
      await refetchProfile();
      showToast('Avatar entfernt.', 'success');
    } catch (err) {
      console.error('deleteAvatar:', err);
      showToast(translateDbError(err, 'Avatar konnte nicht entfernt werden.'), 'error');
    } finally {
      setAvatarUploading(false);
    }
  }

  // Bio inline-edit.
  const [bioEditing, setBioEditing] = createSignal(false);
  const [bioDraft, setBioDraft] = createSignal('');
  const [bioSaving, setBioSaving] = createSignal(false);
  function startEditBio() {
    setBioDraft(bio() ?? '');
    setBioEditing(true);
  }
  function cancelEditBio() {
    setBioEditing(false);
    setBioDraft('');
  }
  async function saveEditBio() {
    if (bioSaving()) return;
    const uid = user()?.id;
    if (!uid) return;
    const next = bioDraft().trim();
    if (next === (bio() ?? '')) {
      cancelEditBio();
      return;
    }
    setBioSaving(true);
    try {
      await setUserProfile(uid, { bio: next || null });
      await refetchProfile();
      showToast(next ? 'Bio gespeichert.' : 'Bio entfernt.', 'success');
      setBioEditing(false);
    } catch (err) {
      console.error('setUserProfile bio:', err);
      showToast(translateDbError(err, 'Speichern fehlgeschlagen.'), 'error');
    } finally {
      setBioSaving(false);
    }
  }

  // Timezone inline-edit.
  const [tzEditing, setTzEditing] = createSignal(false);
  const [tzDraft, setTzDraft] = createSignal('');
  const [tzSaving, setTzSaving] = createSignal(false);
  function startEditTz() {
    setTzDraft(timezone() ?? '');
    setTzEditing(true);
  }
  function cancelEditTz() {
    setTzEditing(false);
    setTzDraft('');
  }
  async function saveEditTz() {
    if (tzSaving()) return;
    const uid = user()?.id;
    if (!uid) return;
    const next = tzDraft().trim();
    if (next === (timezone() ?? '')) {
      cancelEditTz();
      return;
    }
    setTzSaving(true);
    try {
      await setUserProfile(uid, { timezone: next || null });
      await refetchProfile();
      showToast(next ? 'Zeitzone gespeichert.' : 'Zeitzone entfernt.', 'success');
      setTzEditing(false);
    } catch (err) {
      console.error('setUserProfile timezone:', err);
      showToast(translateDbError(err, 'Speichern fehlgeschlagen.'), 'error');
    } finally {
      setTzSaving(false);
    }
  }

  // Language inline-edit.
  const [langEditing, setLangEditing] = createSignal(false);
  const [langDraft, setLangDraft] = createSignal('');
  const [langSaving, setLangSaving] = createSignal(false);
  function startEditLang() {
    setLangDraft(language() ?? '');
    setLangEditing(true);
  }
  function cancelEditLang() {
    setLangEditing(false);
    setLangDraft('');
  }
  async function saveEditLang() {
    if (langSaving()) return;
    const uid = user()?.id;
    if (!uid) return;
    const next = langDraft().trim();
    if (next === (language() ?? '')) {
      cancelEditLang();
      return;
    }
    setLangSaving(true);
    try {
      await setUserProfile(uid, { language: next || null });
      await refetchProfile();
      showToast(next ? 'Sprache gespeichert.' : 'Sprache entfernt.', 'success');
      setLangEditing(false);
    } catch (err) {
      console.error('setUserProfile language:', err);
      showToast(translateDbError(err, 'Speichern fehlgeschlagen.'), 'error');
    } finally {
      setLangSaving(false);
    }
  }

  // ─── D.1 Email-Change ──────────────────────────────────────────
  const [emailEditing, setEmailEditing] = createSignal(false);
  const [emailDraft, setEmailDraft] = createSignal('');
  const [emailSaving, setEmailSaving] = createSignal(false);
  function startEditEmail() {
    setEmailDraft(user()?.email ?? '');
    setEmailEditing(true);
  }
  function cancelEditEmail() {
    setEmailEditing(false);
    setEmailDraft('');
  }
  async function saveEditEmail() {
    if (emailSaving()) return;
    const next = emailDraft().trim().toLowerCase();
    const cur = (user()?.email ?? '').toLowerCase();
    if (next === cur) {
      cancelEditEmail();
      return;
    }
    setEmailSaving(true);
    try {
      await changeEmail(next);
      showToast(
        'Bestaetigungs-Mail an neue Adresse versendet. Bis zur Bestaetigung bleibt die alte aktiv.',
        'success',
      );
      setEmailEditing(false);
    } catch (err) {
      console.error('changeEmail:', err);
      showToast(translateDbError(err, 'Aenderung fehlgeschlagen.'), 'error');
    } finally {
      setEmailSaving(false);
    }
  }

  return (
    <article class="settings-pane">
      <header class="settings-pane-head">
        <h2>Profil</h2>
        <p class="hint">
          Anzeigename und E-Mail. Email-Aenderung loest eine Bestaetigungs-Mail an die neue Adresse
          aus — bis du sie bestaetigst, bleibt die alte Email aktiv.
        </p>
      </header>
      <Show when={user()} fallback={<p class="settings-empty">Nicht eingeloggt.</p>}>
        {(u) => (
          <dl class="settings-form-grid">
            <dt>Avatar</dt>
            <dd>
              <div class="account-avatar-row">
                <Show
                  when={avatarUrl()}
                  fallback={
                    <div class="account-avatar-placeholder" aria-hidden="true">
                      <Icon name="user" size={28} />
                    </div>
                  }
                >
                  <img
                    src={avatarUrl() ?? ''}
                    alt="Avatar"
                    class="account-avatar-img"
                    width={64}
                    height={64}
                  />
                </Show>
                <div class="account-avatar-actions">
                  <input
                    ref={(el) => {
                      avatarFileInput = el;
                    }}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    class="account-avatar-input"
                    onChange={(e) => {
                      const f = e.currentTarget.files?.[0] ?? null;
                      void onAvatarFile(f);
                    }}
                    disabled={avatarUploading()}
                  />
                  <Show when={avatarUrl()}>
                    <button
                      type="button"
                      class="btn-subtle"
                      onClick={onAvatarDelete}
                      disabled={avatarUploading()}
                    >
                      Entfernen
                    </button>
                  </Show>
                  <span class="hint">JPG / PNG / WebP / GIF, max. 2 MB.</span>
                </div>
              </div>
            </dd>
            <dt>E-Mail</dt>
            <dd>
              <Show
                when={emailEditing()}
                fallback={
                  <span class="account-email-row">
                    <code class="settings-readback">{u().email ?? '—'}</code>
                    <Show
                      when={emailVerified()}
                      fallback={
                        <span
                          class="account-email-badge account-email-badge-pending"
                          title="E-Mail noch nicht bestaetigt"
                        >
                          Bestaetigung ausstehend
                        </span>
                      }
                    >
                      <span
                        class="account-email-badge account-email-badge-verified"
                        title="E-Mail bestaetigt"
                      >
                        Verifiziert
                      </span>
                    </Show>
                    <button
                      type="button"
                      class="btn-subtle settings-name-edit-btn"
                      onClick={startEditEmail}
                      title="E-Mail aendern"
                    >
                      <Icon name="pencil" size={14} />
                      <span>Aendern</span>
                    </button>
                    <Show when={!emailVerified() && u().email}>
                      <button
                        type="button"
                        class="btn-subtle"
                        onClick={onResendVerification}
                        disabled={resending()}
                        title="Bestaetigungs-Mail erneut senden"
                      >
                        {resending() ? 'Sende…' : 'Mail erneut senden'}
                      </button>
                    </Show>
                  </span>
                }
              >
                <form
                  class="settings-name-edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEditEmail();
                  }}
                >
                  <input
                    type="email"
                    class="settings-name-input"
                    value={emailDraft()}
                    onInput={(e) => setEmailDraft(e.currentTarget.value)}
                    maxLength={254}
                    autofocus
                    disabled={emailSaving()}
                    placeholder="neue@beispiel.com"
                  />
                  <button
                    type="submit"
                    class="btn btn-p"
                    disabled={emailSaving() || !emailDraft().trim()}
                  >
                    Bestaetigungs-Mail senden
                  </button>
                  <button
                    type="button"
                    class="btn-subtle"
                    onClick={cancelEditEmail}
                    disabled={emailSaving()}
                  >
                    Abbrechen
                  </button>
                </form>
              </Show>
            </dd>
            <dt>Anzeigename</dt>
            <dd>
              <Show
                when={nameEditing()}
                fallback={
                  <span class="settings-name-row">
                    <Show
                      when={displayName()}
                      fallback={<span class="hint">noch nicht gesetzt</span>}
                    >
                      <code class="settings-readback">{displayName()}</code>
                    </Show>
                    <button
                      type="button"
                      class="btn-subtle settings-name-edit-btn"
                      onClick={startEditName}
                      title="Anzeigename bearbeiten"
                    >
                      <Icon name="pencil" size={14} />
                      <span>{displayName() ? 'Bearbeiten' : 'Hinzufuegen'}</span>
                    </button>
                  </span>
                }
              >
                <form
                  class="settings-name-edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEditName();
                  }}
                >
                  <input
                    type="text"
                    class="settings-name-input"
                    value={nameDraft()}
                    onInput={(e) => setNameDraft(e.currentTarget.value)}
                    maxLength={80}
                    autofocus
                    disabled={nameSaving()}
                    placeholder="Wie sollst du erscheinen?"
                  />
                  <button type="submit" class="btn btn-p" disabled={nameSaving()}>
                    Speichern
                  </button>
                  <button
                    type="button"
                    class="btn-subtle"
                    onClick={cancelEditName}
                    disabled={nameSaving()}
                  >
                    Abbrechen
                  </button>
                </form>
              </Show>
            </dd>
            <dt>Bio</dt>
            <dd>
              <Show
                when={bioEditing()}
                fallback={
                  <span class="settings-name-row">
                    <Show when={bio()} fallback={<span class="hint">noch nicht gesetzt</span>}>
                      <span class="settings-readback settings-description-readback">{bio()}</span>
                    </Show>
                    <button
                      type="button"
                      class="btn-subtle settings-name-edit-btn"
                      onClick={startEditBio}
                      title="Bio bearbeiten"
                    >
                      <Icon name="pencil" size={14} />
                      <span>{bio() ? 'Bearbeiten' : 'Hinzufuegen'}</span>
                    </button>
                  </span>
                }
              >
                <form
                  class="settings-name-edit-form settings-desc-edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEditBio();
                  }}
                >
                  <textarea
                    class="settings-desc-input"
                    value={bioDraft()}
                    onInput={(e) => setBioDraft(e.currentTarget.value)}
                    maxLength={500}
                    rows={3}
                    autofocus
                    disabled={bioSaving()}
                    placeholder="Wer du bist, was du machst…"
                  />
                  <div class="settings-desc-edit-actions">
                    <span class="settings-desc-counter">{bioDraft().length}/500</span>
                    <button type="submit" class="btn btn-p" disabled={bioSaving()}>
                      Speichern
                    </button>
                    <button
                      type="button"
                      class="btn-subtle"
                      onClick={cancelEditBio}
                      disabled={bioSaving()}
                    >
                      Abbrechen
                    </button>
                  </div>
                </form>
              </Show>
            </dd>
            <dt>Zeitzone</dt>
            <dd>
              <Show
                when={tzEditing()}
                fallback={
                  <span class="settings-name-row">
                    <Show
                      when={timezone()}
                      fallback={<span class="hint">Browser-Default (noch nicht gesetzt)</span>}
                    >
                      <code class="settings-readback">{timezone()}</code>
                    </Show>
                    <button
                      type="button"
                      class="btn-subtle settings-name-edit-btn"
                      onClick={startEditTz}
                      title="Zeitzone bearbeiten"
                    >
                      <Icon name="pencil" size={14} />
                      <span>{timezone() ? 'Bearbeiten' : 'Hinzufuegen'}</span>
                    </button>
                  </span>
                }
              >
                <form
                  class="settings-name-edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEditTz();
                  }}
                >
                  <input
                    type="text"
                    class="settings-name-input"
                    value={tzDraft()}
                    onInput={(e) => setTzDraft(e.currentTarget.value)}
                    maxLength={64}
                    autofocus
                    disabled={tzSaving()}
                    placeholder="z.B. Europe/Vienna, America/New_York"
                  />
                  <button type="submit" class="btn btn-p" disabled={tzSaving()}>
                    Speichern
                  </button>
                  <button
                    type="button"
                    class="btn-subtle"
                    onClick={cancelEditTz}
                    disabled={tzSaving()}
                  >
                    Abbrechen
                  </button>
                </form>
              </Show>
            </dd>
            <dt>Sprache</dt>
            <dd>
              <Show
                when={langEditing()}
                fallback={
                  <span class="settings-name-row">
                    <Show when={language()} fallback={<span class="hint">Default (Deutsch)</span>}>
                      <code class="settings-readback">{language()}</code>
                    </Show>
                    <button
                      type="button"
                      class="btn-subtle settings-name-edit-btn"
                      onClick={startEditLang}
                      title="Sprache bearbeiten"
                    >
                      <Icon name="pencil" size={14} />
                      <span>{language() ? 'Bearbeiten' : 'Hinzufuegen'}</span>
                    </button>
                  </span>
                }
              >
                <form
                  class="settings-name-edit-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void saveEditLang();
                  }}
                >
                  <input
                    type="text"
                    class="settings-name-input"
                    value={langDraft()}
                    onInput={(e) => setLangDraft(e.currentTarget.value)}
                    maxLength={12}
                    autofocus
                    disabled={langSaving()}
                    placeholder="de, en, de-DE"
                  />
                  <button type="submit" class="btn btn-p" disabled={langSaving()}>
                    Speichern
                  </button>
                  <button
                    type="button"
                    class="btn-subtle"
                    onClick={cancelEditLang}
                    disabled={langSaving()}
                  >
                    Abbrechen
                  </button>
                </form>
              </Show>
            </dd>
            <dt>User-ID</dt>
            <dd>
              <code class="settings-readback settings-readback-mono">{u().id}</code>
            </dd>
          </dl>
        )}
      </Show>
    </article>
  );
};

export default AccountProfile;
