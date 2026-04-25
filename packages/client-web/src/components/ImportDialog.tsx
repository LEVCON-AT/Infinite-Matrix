import { type Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { decryptPayload, isEncrypted } from '../lib/crypto';
import { installFocusRestore } from '../lib/dialog';
import { ImportParseError, buildImportPlan, parsePayload } from '../lib/import';
import { ImportExecError, executeImport } from '../lib/import-exec';
import type { ImportPlan, ImportStats } from '../lib/import-types';
import { planStats } from '../lib/import-types';
import Icon from './Icon';

type Props = {
  workspaceId: string;
  onClose: () => void;
  onImported: (rootNodeId: string) => void;
};

type Phase = 'select' | 'password' | 'preview' | 'running' | 'done' | 'error';

const ImportDialog: Component<Props> = (p) => {
  const [phase, setPhase] = createSignal<Phase>('select');
  const [errorMsg, setErrorMsg] = createSignal<string>('');
  const [jsonText, setJsonText] = createSignal<string>('');
  const [plan, setPlan] = createSignal<ImportPlan | null>(null);
  const [stats, setStats] = createSignal<ImportStats | null>(null);
  const [progressStep, setProgressStep] = createSignal<string>('');
  const [progressCur, setProgressCur] = createSignal(0);
  const [progressTotal, setProgressTotal] = createSignal(0);
  const [encryptedText, setEncryptedText] = createSignal<string>('');
  const [password, setPassword] = createSignal<string>('');
  const [decrypting, setDecrypting] = createSignal(false);

  onMount(() => {
    onCleanup(installFocusRestore());
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase() !== 'running') {
        e.stopImmediatePropagation();
        p.onClose();
      }
    };
    document.addEventListener('keydown', h, true);
    onCleanup(() => document.removeEventListener('keydown', h, true));
  });

  async function onFileChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const text = (await file.text()).trim();
    handleInput(text);
  }

  function handleInput(text: string) {
    if (isEncrypted(text)) {
      setEncryptedText(text);
      setPassword('');
      setErrorMsg('');
      setPhase('password');
      return;
    }
    setJsonText(text);
    doParse(text);
  }

  async function doDecrypt() {
    const pw = password();
    if (!pw) return;
    setDecrypting(true);
    setErrorMsg('');
    try {
      const plain = await decryptPayload(encryptedText(), pw);
      setJsonText(plain);
      setPassword('');
      setEncryptedText('');
      doParse(plain);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setDecrypting(false);
    }
  }

  function doParse(text: string) {
    setErrorMsg('');
    try {
      const payload = parsePayload(text);
      const built = buildImportPlan(payload);
      setPlan(built);
      setStats(planStats(built));
      setPhase('preview');
    } catch (err) {
      const msg =
        err instanceof ImportParseError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setErrorMsg(msg);
      setPhase('error');
    }
  }

  async function doRun() {
    const built = plan();
    if (!built) return;
    setPhase('running');
    setErrorMsg('');
    try {
      await executeImport(built, p.workspaceId, (ev) => {
        setProgressStep(ev.step);
        setProgressCur(ev.current);
        setProgressTotal(ev.total);
      });
      setPhase('done');
      // kleine Pause, damit User die 100%-Anzeige sieht, dann navigieren.
      setTimeout(() => p.onImported(built.rootNodeId), 400);
    } catch (err) {
      const msg =
        err instanceof ImportExecError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      setErrorMsg(msg);
      setPhase('error');
    }
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Backdrop-Klick — Tastatur via ESC-Capture im onMount.
    <div
      class="overlay-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase() !== 'running') p.onClose();
      }}
    >
      <div
        class="overlay-card import-card"
        // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> bewusst statt <dialog> — showModal() haette aufwendige Migration aller Modals zur Folge.
        role="dialog"
        aria-modal="true"
      >
        <header class="overlay-head">
          <h2>Import localStorage-JSON</h2>
          <button
            type="button"
            class="overlay-close"
            onClick={p.onClose}
            disabled={phase() === 'running'}
            aria-label="Schliessen"
          >
            <Icon name="x" size={18} />
          </button>
        </header>

        <div class="overlay-body">
          <Show when={phase() === 'select'}>
            <p class="hint">
              Datei aus dem Alt-Client (<code>matrix_tool_beta.html</code>
              Export) auswaehlen, oder JSON direkt einfuegen. Daten werden in den aktuellen
              Workspace importiert (Append).
            </p>
            <div class="import-actions">
              <label class="import-file-label">
                Datei (.json / .imx)
                <input type="file" accept="application/json,.json,.imx" onChange={onFileChange} />
              </label>
              <span class="import-or">oder</span>
              <button
                type="button"
                onClick={() => {
                  const t = jsonText().trim();
                  if (!t) return;
                  handleInput(t);
                }}
              >
                Eingefuegten Text parsen
              </button>
            </div>
            <textarea
              class="import-textarea"
              placeholder="JSON oder IMATRIX_ENC:... hier einfuegen..."
              rows={8}
              value={jsonText()}
              onInput={(e) => setJsonText(e.currentTarget.value)}
            />
          </Show>

          <Show when={phase() === 'password'}>
            <p class="hint">
              Verschluesselte Datei (<code>.imx</code>). Passwort aus dem Alt-Client eingeben.
            </p>
            <form
              class="import-password-form"
              onSubmit={(e) => {
                e.preventDefault();
                doDecrypt();
              }}
            >
              <label class="import-file-label">
                Passwort
                <input
                  type="password"
                  autofocus
                  autocomplete="current-password"
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  disabled={decrypting()}
                />
              </label>
              <Show when={errorMsg()}>
                <p class="error">{errorMsg()}</p>
              </Show>
              <div class="import-actions-bottom">
                <button
                  type="button"
                  class="btn-secondary"
                  onClick={() => {
                    setEncryptedText('');
                    setPassword('');
                    setErrorMsg('');
                    setPhase('select');
                  }}
                  disabled={decrypting()}
                >
                  Zurueck
                </button>
                <button type="submit" disabled={decrypting() || !password()}>
                  {decrypting() ? 'Entschluessle...' : 'Entschluesseln'}
                </button>
              </div>
            </form>
          </Show>

          <Show when={phase() === 'preview' && stats()}>
            {(s) => (
              <>
                <p class="hint">
                  Import-Plan erstellt. Folgende Daten werden in den aktuellen Workspace eingefuegt:
                </p>
                <ul class="import-stats">
                  <For
                    each={
                      [
                        ['Nodes', s().nodes],
                        ['Rows', s().rows],
                        ['Cols', s().cols],
                        ['Cells', s().cells],
                        ['Kanban-Spalten', s().kbCols],
                        ['Karten', s().kbCards],
                        ['Checklisten', s().checklists],
                        ['Checklist-Items', s().checklistItems],
                        ['Links', s().links],
                      ] as [string, number][]
                    }
                  >
                    {([label, n]) => (
                      <li>
                        <span class="import-stat-label">{label}</span>
                        <span class="import-stat-n">{n}</span>
                      </li>
                    )}
                  </For>
                </ul>
                <p class="hint">
                  Hinweis: bestehende Aliases im Workspace kollidieren ggf. — dann bricht der Import
                  mit Fehler ab.
                </p>
                <div class="import-actions-bottom">
                  <button type="button" class="btn-secondary" onClick={() => setPhase('select')}>
                    Zurueck
                  </button>
                  <button type="button" onClick={doRun}>
                    Import starten
                  </button>
                </div>
              </>
            )}
          </Show>

          <Show when={phase() === 'running'}>
            <p class="hint">Import laeuft... bitte Dialog nicht schliessen.</p>
            <div class="import-progress">
              <div class="import-progress-label">
                <span>{progressStep() || 'Start...'}</span>
                <span>
                  {progressCur()} / {progressTotal()}
                </span>
              </div>
              <div class="import-progress-bar">
                <div
                  class="import-progress-fill"
                  style={{
                    width:
                      progressTotal() === 0
                        ? '0%'
                        : `${Math.min(100, (progressCur() / progressTotal()) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </Show>

          <Show when={phase() === 'done'}>
            <p class="ok">
              <strong>Import erfolgreich.</strong> Navigation startet...
            </p>
          </Show>

          <Show when={phase() === 'error'}>
            <p class="error">
              <strong>Fehler:</strong> {errorMsg()}
            </p>
            <div class="import-actions-bottom">
              <button
                type="button"
                class="btn-secondary"
                onClick={() => {
                  setErrorMsg('');
                  setPhase(plan() ? 'preview' : 'select');
                }}
              >
                Zurueck
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};

export default ImportDialog;
