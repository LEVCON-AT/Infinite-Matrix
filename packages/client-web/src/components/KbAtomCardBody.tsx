// WV.WV.6 — KbAtomCardBody (Card<AtomType>-Polymorphie-Dispatcher).
//
// Pre-Welle-A-Foundation. Rendert den inneren Body einer Kanban-
// Karte abhaengig vom atom_type. Caller (BoardView ab Welle A)
// wrappt das in eigenes `<li class="kb-card">` mit den Drag-/
// Drop-/Selection-Handlern — dieser Component ist nur fuer den
// Inhalt zustaendig.
//
// Tasks haben weiterhin ihre tiefe Inline-Render-Branch in
// BoardView (Phase-4-Layer mit Checkbox/Recur/Inline-Checklisten).
// Hier nur die nicht-task-Variants, plus ein bewusst leerer
// task-Branch (sodass die Polymorphie-Signatur uniform bleibt
// und ein Caller-Fallback-Pfad existiert).
//
// Konzept-Verankerung:
//   - §9.10b „Card<AtomType>-Polymorphie".
//   - §9.10 Card<doc>: Title + Mini-Excerpt + Doc-Icon + Pin-Count-Badge.
//   - §9.6c Card<link>: Label + URL-Domain + Provider-Icon (V1 simpel).
//   - §9.13 imported_event-Anbindung (V1 read-only).
//
// CSS-Foundation: nutzt existing `.kb-card-name`/`.kb-card-meta`-
// Klassen aus styles.css (Tasks-Kanban). Neu sind nur kleine
// Element-Klassen `.kb-card-doc-excerpt`, `.kb-card-link-domain`,
// `.kb-card-event-time`. Tokens aus :root, kein Inline-Style.

import { type Component, Match, Show, Switch } from 'solid-js';
import type {
  KbCardModel,
  KbChecklistCardModel,
  KbDocCardModel,
  KbImportedEventCardModel,
  KbLinkCardModel,
} from '../lib/kb-card-model';
import Icon from './Icon';

export type KbAtomCardBodyProps = {
  model: KbCardModel;
};

const KbAtomCardBody: Component<KbAtomCardBodyProps> = (p) => {
  return (
    <Switch>
      <Match when={p.model.kind === 'doc' && (p.model as KbDocCardModel)}>
        {(m) => <DocBody model={m()} />}
      </Match>
      <Match when={p.model.kind === 'link' && (p.model as KbLinkCardModel)}>
        {(m) => <LinkBody model={m()} />}
      </Match>
      <Match when={p.model.kind === 'checklist' && (p.model as KbChecklistCardModel)}>
        {(m) => <ChecklistBody model={m()} />}
      </Match>
      <Match when={p.model.kind === 'imported_event' && (p.model as KbImportedEventCardModel)}>
        {(m) => <ImportedEventBody model={m()} />}
      </Match>
      {/* Task-Branch ist intentionally leer — Caller hat eigene
          tiefere Render-Logik (Phase-4 task-projection). Wenn ein
          Caller diesen Component fuer ein task-Model rendert,
          fallen wir auf einen minimalen Title-Body zurueck. */}
    </Switch>
  );
};

const DocBody: Component<{ model: KbDocCardModel }> = (p) => {
  return (
    <>
      <div class="kb-card-name">
        <span class="kb-card-atom-icon" aria-hidden="true">
          <Icon name="document-text" size={14} />
        </span>
        <span class="kb-card-title-text">{p.model.title || '(unbenannt)'}</span>
        <Show when={p.model.alias}>
          <span class="kb-card-alias">^{p.model.alias}</span>
        </Show>
      </div>
      <Show when={p.model.excerpt}>
        <p class="kb-card-doc-excerpt">{p.model.excerpt}</p>
      </Show>
      <Show when={p.model.pinCount > 0}>
        <div class="kb-card-meta">
          <span class="kb-card-pin-badge" title={`${p.model.pinCount}× verlinkt`}>
            <Icon name="link" size={12} /> {p.model.pinCount}
          </span>
        </div>
      </Show>
    </>
  );
};

const LinkBody: Component<{ model: KbLinkCardModel }> = (p) => {
  const domain = () => {
    try {
      if (p.model.linkType === 'mail') return p.model.url.replace(/^mailto:/, '');
      const u = new URL(p.model.url);
      return u.hostname.replace(/^www\./, '');
    } catch {
      return p.model.url;
    }
  };
  return (
    <>
      <div class="kb-card-name">
        <span class="kb-card-atom-icon" aria-hidden="true">
          <Icon name={p.model.linkType === 'mail' ? 'envelope' : 'link'} size={14} />
        </span>
        <span class="kb-card-title-text">{p.model.label || domain()}</span>
        <Show when={p.model.alias}>
          <span class="kb-card-alias">^{p.model.alias}</span>
        </Show>
      </div>
      <Show when={p.model.label && domain() !== p.model.label}>
        <p class="kb-card-link-domain">{domain()}</p>
      </Show>
    </>
  );
};

const ChecklistBody: Component<{ model: KbChecklistCardModel }> = (p) => {
  return (
    <>
      <div class="kb-card-name">
        <span class="kb-card-atom-icon" aria-hidden="true">
          <Icon name="list-bullet" size={14} />
        </span>
        <span class="kb-card-title-text">{p.model.label || '(ohne Titel)'}</span>
        <Show when={p.model.alias}>
          <span class="kb-card-alias">^{p.model.alias}</span>
        </Show>
      </div>
      <Show when={p.model.totalCount > 0}>
        <div class="kb-card-meta">
          <span class="kb-card-progress">
            {p.model.doneCount}/{p.model.totalCount}
          </span>
        </div>
      </Show>
    </>
  );
};

const ImportedEventBody: Component<{ model: KbImportedEventCardModel }> = (p) => {
  const timeLabel = () => {
    const dt = new Date(p.model.startAt);
    if (Number.isNaN(dt.getTime())) return p.model.startAt;
    if (p.model.allDay) {
      return dt.toLocaleDateString('de-DE');
    }
    return `${dt.toLocaleDateString('de-DE')} ${dt.toLocaleTimeString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  };
  return (
    <>
      <div class="kb-card-name">
        <span class="kb-card-atom-icon" aria-hidden="true">
          <Icon name="calendar" size={14} />
        </span>
        <span class="kb-card-title-text">{p.model.summary || '(ohne Titel)'}</span>
      </div>
      <div class="kb-card-meta">
        <span class="kb-card-event-time">{timeLabel()}</span>
        <Show when={p.model.sourceProvider}>
          <span class="kb-card-event-provider">{p.model.sourceProvider}</span>
        </Show>
      </div>
    </>
  );
};

export default KbAtomCardBody;
