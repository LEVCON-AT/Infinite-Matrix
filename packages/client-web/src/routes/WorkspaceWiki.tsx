// Welle E.1 — Wiki/Doku-Route (V1 Schema + Reader-Shell).
//
// V1 zeigt eine flache Liste aller Workspace-Wiki-Seiten plus einen
// Inline-Reader (Markdown-Render via existing RichTextEditor-Helper
// `renderMarkdown`). Tree-View, Volltext-Suche und Editor folgen in
// E.2 — diese Datei legt das UI-Geruest, mehr nicht.
//
// Plattform-Pages werden hier NICHT gezeigt — die kriegen ihre eigene
// Route /help/... in E.3.

import { useNavigate, useParams } from '@solidjs/router';
import { type Component, For, Show, createMemo, createResource, createSignal } from 'solid-js';
import Icon from '../components/Icon';
import { pageEnter } from '../lib/animations';
import { formatRelativeDeShort } from '../lib/dates';
import { showConfirm } from '../lib/dialog';
import { translateDbError } from '../lib/errors';
import { installEscReturn } from '../lib/keyboard-nav';
import { showToast } from '../lib/toasts';
import {
  type WikiPageRow,
  createWikiPage,
  deleteWikiPage,
  fetchWorkspaceWikiPages,
  slugify,
  updateWikiPage,
} from '../lib/wiki';

type RouteParams = { workspaceId: string };

const WorkspaceWiki: Component = () => {
  const params = useParams<RouteParams>();
  const navigate = useNavigate();

  const [pages, { refetch }] = createResource(
    () => params.workspaceId,
    async (wid: string) => (wid ? await fetchWorkspaceWikiPages(wid) : []),
  );

  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal(false);
  const [draftTitle, setDraftTitle] = createSignal('');
  const [draftSlug, setDraftSlug] = createSignal('');
  const [draftContent, setDraftContent] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  const selected = createMemo<WikiPageRow | null>(() => {
    const id = selectedId();
    if (!id) return null;
    return (pages() ?? []).find((p) => p.id === id) ?? null;
  });

  function back() {
    navigate(`/w/${params.workspaceId}`);
  }

  installEscReturn(back);

  function startCreate() {
    setCreating(true);
    setSelectedId(null);
    setDraftTitle('');
    setDraftSlug('');
    setDraftContent('');
    setEditing(true);
  }

  function startEdit() {
    const cur = selected();
    if (!cur) return;
    setCreating(false);
    setDraftTitle(cur.title);
    setDraftSlug(cur.slug);
    setDraftContent(cur.content_md);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setCreating(false);
    setDraftTitle('');
    setDraftSlug('');
    setDraftContent('');
  }

  async function saveDraft() {
    const title = draftTitle().trim();
    if (!title) {
      showToast('Titel darf nicht leer sein.', 'error');
      return;
    }
    const slug = draftSlug().trim() || slugify(title);
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) {
      showToast('Slug-Format ungueltig (a-z, 0-9, Bindestrich).', 'error');
      return;
    }
    setBusy(true);
    try {
      if (creating()) {
        const created = await createWikiPage({
          workspace_id: params.workspaceId,
          parent_id: null,
          title,
          slug,
          content_md: draftContent(),
          position: (pages() ?? []).length,
        });
        await refetch();
        setSelectedId(created.id);
      } else {
        const cur = selected();
        if (!cur) return;
        await updateWikiPage(cur.id, {
          title,
          slug,
          content_md: draftContent(),
        });
        await refetch();
      }
      setEditing(false);
      setCreating(false);
      showToast('Gespeichert.', 'success');
    } catch (err) {
      const code = (err as { code?: string }).code;
      const msg =
        code === '23505'
          ? 'Diese Slug existiert bereits in dieser Ebene.'
          : code === '23514'
            ? 'Format ungueltig (Slug oder Inhalt).'
            : translateDbError(err, 'Speichern fehlgeschlagen.');
      showToast(msg, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    const cur = selected();
    if (!cur) return;
    const ok = await showConfirm({
      title: 'Wiki-Seite loeschen?',
      message: `„${cur.title}" und alle Unterseiten werden entfernt. Diese Aktion ist nicht rueckgaengig machbar.`,
      confirmLabel: 'Loeschen',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteWikiPage(cur.id);
      await refetch();
      setSelectedId(null);
      showToast('Seite geloescht.', 'success');
    } catch (err) {
      showToast(translateDbError(err, 'Loeschen fehlgeschlagen.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      class="wiki-page"
      ref={(el) => {
        pageEnter(el);
      }}
    >
      <header class="agenda-head">
        <button
          type="button"
          class="obj-detail-back click-pulse"
          onClick={back}
          aria-label="Zurueck"
        >
          <Icon name="arrow-left" size={18} />
        </button>
        <h1 class="agenda-title">Wiki</h1>
        <button type="button" class="btn btn-primary lift" onClick={startCreate} disabled={busy()}>
          <Icon name="plus" size={14} /> Neue Seite
        </button>
      </header>

      <div class="wiki-body">
        <aside class="wiki-sidebar">
          <h3>Seiten ({(pages() ?? []).length})</h3>
          <Show when={!pages.loading} fallback={<p class="hint">Lade…</p>}>
            <Show
              when={(pages() ?? []).length > 0}
              fallback={
                <p class="hint">Noch keine Wiki-Seiten. Lege die erste Seite oben rechts an.</p>
              }
            >
              <ul class="wiki-page-list">
                <For each={pages() ?? []}>
                  {(p) => (
                    <li>
                      <button
                        type="button"
                        class="wiki-page-link"
                        classList={{ 'is-active': selectedId() === p.id }}
                        onClick={() => {
                          setSelectedId(p.id);
                          setEditing(false);
                        }}
                      >
                        <span class="wiki-page-title">{p.title}</span>
                        <span class="hint">{formatRelativeDeShort(p.updated_at)}</span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </aside>

        <main class="wiki-main">
          <Show when={editing()}>
            <section class="wiki-editor">
              <h2>{creating() ? 'Neue Wiki-Seite' : 'Seite bearbeiten'}</h2>
              <label class="login-field">
                <span>Titel</span>
                <input
                  class="input"
                  type="text"
                  value={draftTitle()}
                  onInput={(e) => {
                    const v = e.currentTarget.value;
                    setDraftTitle(v);
                    if (creating() && !draftSlug()) setDraftSlug(slugify(v));
                  }}
                  maxLength={200}
                  disabled={busy()}
                />
              </label>
              <label class="login-field">
                <span>Slug (URL-Pfad)</span>
                <input
                  class="input"
                  type="text"
                  value={draftSlug()}
                  onInput={(e) => setDraftSlug(e.currentTarget.value.toLowerCase())}
                  maxLength={80}
                  placeholder="z-b-getting-started"
                  disabled={busy()}
                />
              </label>
              <label class="login-field">
                <span>Inhalt (Markdown)</span>
                <textarea
                  class="input wiki-content-input"
                  value={draftContent()}
                  onInput={(e) => setDraftContent(e.currentTarget.value)}
                  rows={18}
                  disabled={busy()}
                />
              </label>
              <div class="settings-foot">
                <button
                  type="button"
                  class="btn btn-primary lift"
                  onClick={() => void saveDraft()}
                  disabled={busy() || !draftTitle().trim()}
                >
                  Speichern
                </button>
                <button type="button" class="btn-c" onClick={cancelEdit} disabled={busy()}>
                  Abbrechen
                </button>
              </div>
            </section>
          </Show>

          <Show when={!editing() && selected()}>
            {(page) => (
              <article class="wiki-reader">
                <header class="wiki-reader-head">
                  <h2>{page().title}</h2>
                  <div class="settings-foot">
                    <button type="button" class="btn-subtle" onClick={startEdit} disabled={busy()}>
                      <Icon name="pencil" size={14} /> Bearbeiten
                    </button>
                    <button
                      type="button"
                      class="btn-subtle"
                      onClick={() => void removeSelected()}
                      disabled={busy()}
                    >
                      <Icon name="x" size={14} /> Loeschen
                    </button>
                  </div>
                </header>
                <Show
                  when={page().content_md.trim()}
                  fallback={<p class="hint">Diese Seite ist leer.</p>}
                >
                  {/* V1: Plain-Text-Render mit white-space:pre-wrap.
                      Eigentliches Markdown→HTML+Sanitize folgt in E.2.
                      Bis dahin sehen User ihren Roh-Markdown — kein
                      XSS-Risk, da kein innerHTML. */}
                  <pre class="wiki-content wiki-content-raw">{page().content_md}</pre>
                </Show>
                <footer class="wiki-reader-foot">
                  <span class="hint">
                    Zuletzt aktualisiert {formatRelativeDeShort(page().updated_at)}
                  </span>
                </footer>
              </article>
            )}
          </Show>

          <Show when={!editing() && !selected() && (pages() ?? []).length > 0}>
            <p class="hint wiki-empty-hint">Waehle links eine Seite oder lege eine neue an.</p>
          </Show>
        </main>
      </div>

      <footer class="kb-hint-bar">
        <span>
          <kbd>Esc</kbd> zurueck zur Matrix
        </span>
      </footer>
    </div>
  );
};

export default WorkspaceWiki;
