// Welcome-Modal (A.5 V1). 3-Slide Onboarding fuer eingeladene User
// beim ersten Login. Owner kommen ueber den richtigen Onboarding-
// Wizard (A.4).

import { type Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { useSession } from '../lib/auth';
import { isWelcomeTourDone, markWelcomeTourDone } from '../lib/welcome-tour';

type Slide = {
  title: string;
  body: string;
  hint?: string;
};

const SLIDES: Slide[] = [
  {
    title: 'Linke Seite: dein Workspace-Tree',
    body: 'Matrizen, Boards und ihre Inhalte leben hier. Klicke einen Eintrag zum Oeffnen, ziehe Karten aus der Sidebar in den Calendar oder zwischen Listen.',
    hint: 'Tipp: F fokussiert die Suche im Header.',
  },
  {
    title: 'Zellen tragen 4 Features',
    body: 'Sub-Matrix, Board, Info, Checklisten und Doku. Pro Zelle einzeln aktivierbar. Click in eine leere Zelle oeffnet den Anlage-Wizard, Click auf einen Feature-Chip springt direkt rein.',
  },
  {
    title: 'Command-Palette: ^',
    body: 'Druecke ^ irgendwo in der App. Spring zu einem Eintrag per Alias (^myalias), suche, oder rufe AI-Hilfe ueber ^help. Alles ohne Maus.',
    hint: 'Tipp: ESC schliesst alles.',
  },
];

const WelcomeModal: Component = () => {
  const session = useSession();
  const [shouldShow, setShouldShow] = createSignal(false);
  const [slide, setSlide] = createSignal(0);
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    let cancelled = false;
    void (async () => {
      // Welcome nur fuer eingeloggte User. Onboarding-Gate (A.4)
      // hat seine eigene Logik — wenn der User auf /onboarding ist,
      // wird Welcome NICHT zusaetzlich gezeigt (Trigger ueber location
      // ist hier nicht moeglich, da wir keinen Router-Hook nutzen;
      // der Plattform-Default-Workspace ist via session() gegeben.
      // Welcome triggert nach Onboarding wenn done=false bleibt).
      if (!session()) return;
      const done = await isWelcomeTourDone();
      if (cancelled) return;
      setShouldShow(!done);
    })();
    onCleanup(() => {
      cancelled = true;
    });
  });

  async function close() {
    setBusy(true);
    try {
      await markWelcomeTourDone();
    } finally {
      setBusy(false);
      setShouldShow(false);
    }
  }

  function next() {
    if (slide() < SLIDES.length - 1) setSlide(slide() + 1);
    else void close();
  }

  function prev() {
    if (slide() > 0) setSlide(slide() - 1);
  }

  return (
    <Show when={shouldShow()}>
      <div class="overlay-scrim">
        <div
          class="overlay-card welcome-card"
          // biome-ignore lint/a11y/useSemanticElements: <div role="dialog"> bewusst.
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-title"
        >
          <header class="overlay-head">
            <div class="overlay-head-text">
              <h2 id="welcome-title">{SLIDES[slide()].title}</h2>
              <p class="overlay-sub">
                Schritt {slide() + 1} von {SLIDES.length}
              </p>
            </div>
            <button
              type="button"
              class="overlay-close"
              onClick={() => void close()}
              aria-label="Tour ueberspringen"
              disabled={busy()}
            >
              ✕
            </button>
          </header>
          <div class="overlay-body welcome-body">
            <p>{SLIDES[slide()].body}</p>
            <Show when={SLIDES[slide()].hint}>
              <p class="hint">{SLIDES[slide()].hint}</p>
            </Show>
          </div>
          <footer class="welcome-foot">
            <div class="welcome-dots" aria-hidden="true">
              <For each={SLIDES}>
                {(_, i) => (
                  <span class="welcome-dot" classList={{ 'welcome-dot-active': i() === slide() }} />
                )}
              </For>
            </div>
            <div class="welcome-actions">
              <Show when={slide() > 0}>
                <button type="button" class="btn-subtle" onClick={prev} disabled={busy()}>
                  Zurueck
                </button>
              </Show>
              <button type="button" class="btn btn-primary lift" onClick={next} disabled={busy()}>
                {slide() === SLIDES.length - 1 ? 'Verstanden' : 'Weiter'}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </Show>
  );
};

export default WelcomeModal;
