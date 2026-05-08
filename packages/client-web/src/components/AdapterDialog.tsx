// WV.WV.7 — AdapterDialog (Cross-Type-Drop-Adapter, §9.C).
//
// Generischer Mapping-Dialog: wenn ein Atom-Type-A auf ein Widget
// gedroppt wird, das einen anderen Atom-Type-B erwartet, befuellt
// dieser Dialog die Atom-B-Felder mit Default-Mappings aus den
// Atom-A-Feldern. User kann pro Feld editieren, Submit erzeugt das
// Ziel-Atom (Caller-Logik).
//
// Konzept-Verankerung: §9.C.1-§9.C.5 + §9.13.7 (info_field × link
// User-Wunsch 2026-05-07: „bei Link sollte ein/der Dialog oeffnen
// um Anzeigetext oder URL anzupassen?").
//
// Pre-Welle-A-Foundation: konkrete Adapter-Faelle (info_field→Link,
// doc→Kanban, link→Doc-Pin etc.) werden in Welle B/C/D einzeln
// gebaut — diese Komponente liefert die Reuse-Shell.
//
// Patterns wiederverwendet (`code-quality.md` §6.5):
//   - `<dialog class="overlay-modal">` + ESC + Backdrop-Closer
//     (analog AtomPickerModal, WidgetPicker).
//   - Form-Elemente nutzen die existing `.modal-input`/`.btn-*` Klassen.
//
// Typsystem: `AdapterField`-Liste vom Caller. Each Field bringt
// Label, Type (text/url/date/multiline/select), Default und ggf.
// `required` Flag. Submit liefert eine Map<fieldKey, value>.

import {
  type Component,
  For,
  type JSX,
  Match,
  Show,
  Switch,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import Icon from './Icon';

export type AdapterFieldType = 'text' | 'url' | 'date' | 'multiline' | 'select';

export type AdapterFieldOption = {
  value: string;
  label: string;
};

export type AdapterField = {
  // Stable Key fuer Submit-Map. Z.B. 'label' / 'url' / 'startDate'.
  key: string;
  // Sichtbares Feld-Label im Dialog.
  label: string;
  type: AdapterFieldType;
  // Vor-befuellt aus Default-Mapping. Editierbar durch User.
  defaultValue: string;
  // Bei type='select' Pflicht.
  options?: AdapterFieldOption[];
  // Pflichtfeld. Empty-String + required → Submit blockiert.
  required?: boolean;
  // Optionaler Help-Text unter dem Input.
  hint?: string;
  // Optionaler Placeholder.
  placeholder?: string;
};

export type AdapterDialogProps = {
  title: string;
  // Optional: kurze Beschreibung ueber den Feldern (z.B.
  // „Aus Info-Feld 'Vertragsdaten' wird ein Link-Atom").
  description?: string;
  fields: AdapterField[];
  submitLabel?: string;
  cancelLabel?: string;
  // Submit liefert eine flache Key→Value-Map (alle Werte string).
  // Caller validiert Type-spezifisch (z.B. URL-Format) selbst —
  // der Dialog blockiert nur bei `required` + Empty.
  onSubmit: (values: Record<string, string>) => void;
  onClose: () => void;
};

const AdapterDialog: Component<AdapterDialogProps> = (p) => {
  let dialogEl: HTMLDialogElement | undefined;

  // Working-Copy der Feld-Werte. Wird beim Mount aus defaultValue
  // initialisiert; jede Edit-Mutation laeuft via setValues.
  const [values, setValues] = createSignal<Record<string, string>>(
    Object.fromEntries(p.fields.map((f) => [f.key, f.defaultValue])),
  );

  const [submitting, setSubmitting] = createSignal(false);

  function updateField(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  function isValid(): boolean {
    const v = values();
    return p.fields.every((f) => !f.required || (v[f.key] ?? '').trim().length > 0);
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (submitting()) return;
    if (!isValid()) return;
    setSubmitting(true);
    try {
      p.onSubmit(values());
    } finally {
      setSubmitting(false);
    }
  }

  onMount(() => {
    dialogEl?.showModal();
    // Erstes Eingabefeld kriegt initialFocus.
    const firstInput = dialogEl?.querySelector<HTMLElement>('input, textarea, select');
    firstInput?.focus();
  });

  onCleanup(() => {
    dialogEl?.close();
  });

  return (
    <dialog
      ref={dialogEl}
      class="overlay-modal adapter-dialog"
      aria-labelledby="adapter-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        p.onClose();
      }}
    >
      <button
        type="button"
        class="overlay-modal-backdrop-closer"
        onClick={p.onClose}
        aria-label="Schliessen"
        tabIndex={-1}
      />
      <div class="overlay-card">
        <header class="overlay-head">
          <h3 id="adapter-dialog-title">{p.title}</h3>
          <button type="button" class="overlay-close" onClick={p.onClose} aria-label="Schliessen">
            <Icon name="x" size={18} />
          </button>
        </header>

        <form class="adapter-dialog-form" onSubmit={handleSubmit}>
          <Show when={p.description}>
            <p class="adapter-dialog-desc">{p.description}</p>
          </Show>

          <For each={p.fields}>
            {(field) => {
              const fieldId = `adapter-field-${field.key}`;
              return (
                <div class="adapter-dialog-field">
                  <label class="adapter-dialog-field-label" for={fieldId}>
                    {field.label}
                    <Show when={field.required}>
                      <span class="adapter-dialog-field-required" aria-label="Pflichtfeld">
                        *
                      </span>
                    </Show>
                  </label>
                  <FieldInput
                    id={fieldId}
                    field={field}
                    value={values()[field.key] ?? ''}
                    onInput={(v) => updateField(field.key, v)}
                  />
                  <Show when={field.hint}>
                    <span class="adapter-dialog-field-hint">{field.hint}</span>
                  </Show>
                </div>
              );
            }}
          </For>

          <footer class="adapter-dialog-actions">
            <button type="button" class="btn-secondary" onClick={p.onClose}>
              {p.cancelLabel ?? 'Abbrechen'}
            </button>
            <button type="submit" class="btn-primary" disabled={submitting() || !isValid()}>
              {p.submitLabel ?? 'Uebernehmen'}
            </button>
          </footer>
        </form>
      </div>
    </dialog>
  );
};

const FieldInput: Component<{
  id: string;
  field: AdapterField;
  value: string;
  onInput: (v: string) => void;
}> = (p) => {
  const handleInput: JSX.EventHandler<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    Event
  > = (e) => {
    p.onInput(e.currentTarget.value);
  };

  return (
    <Switch>
      <Match when={p.field.type === 'multiline'}>
        <textarea
          id={p.id}
          class="adapter-dialog-input adapter-dialog-textarea"
          value={p.value}
          placeholder={p.field.placeholder}
          onInput={handleInput}
          rows={3}
        />
      </Match>
      <Match when={p.field.type === 'select'}>
        <select id={p.id} class="adapter-dialog-input" value={p.value} onChange={handleInput}>
          <For each={p.field.options ?? []}>
            {(opt) => <option value={opt.value}>{opt.label}</option>}
          </For>
        </select>
      </Match>
      <Match when={p.field.type === 'url'}>
        <input
          id={p.id}
          type="url"
          class="adapter-dialog-input"
          value={p.value}
          placeholder={p.field.placeholder ?? 'https://…'}
          onInput={handleInput}
        />
      </Match>
      <Match when={p.field.type === 'date'}>
        <input
          id={p.id}
          type="date"
          class="adapter-dialog-input"
          value={p.value}
          onInput={handleInput}
        />
      </Match>
      <Match when={p.field.type === 'text'}>
        <input
          id={p.id}
          type="text"
          class="adapter-dialog-input"
          value={p.value}
          placeholder={p.field.placeholder}
          onInput={handleInput}
        />
      </Match>
    </Switch>
  );
};

export default AdapterDialog;
