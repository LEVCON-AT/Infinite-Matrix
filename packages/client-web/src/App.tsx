import { useLocation, useNavigate } from '@solidjs/router';
import { type JSX, type ParentComponent, Show, createEffect } from 'solid-js';
import AiHelpDrawer, { AiHelpDrawerToggle } from './components/AiHelpDrawer';
import AiProviderHint from './components/AiProviderHint';
import CellSuggestModal from './components/CellSuggestModal';
import DialogHost from './components/DialogHost';
import MfaGateDialog from './components/MfaGateDialog';
import ProgressOverlay from './components/ProgressOverlay';
import StepUpDialog from './components/StepUpDialog';
import Toasts from './components/Toasts';
import WelcomeModal from './components/WelcomeModal';
import { useIsPlatformAdmin } from './lib/admin';
import { useDrawerHotkey } from './lib/ai-help-state';
import { bootstrapAuth, useAccountInvalid, useAuthReady, useSession } from './lib/auth';
import { checkMfaGate } from './lib/auth-mfa-gate';
import { resetUserDateContext, setUserDateContext } from './lib/dates';
import { installPointerDragAdapter } from './lib/drag-context';
import { useEditModeHotkey } from './lib/edit-mode';
import { checkAndMaybeRedirectToOnboarding, resetOnboardingGate } from './lib/onboarding-gate';
import { useUserPrefsSync } from './lib/settings';
import { useThemeBootstrap } from './lib/theme';
import { showToast } from './lib/toasts';
import { useViewportClasses } from './lib/use-mobile';
import { fetchMyUserProfile } from './lib/user-profile';
import { useWorkingHoursSync } from './lib/working-hours';
import { PENDING_INVITE_KEY } from './routes/Invite';

bootstrapAuth();
installPointerDragAdapter();

// Routen, die der globale Auth-Guard nicht zwingend redirecten soll.
// /invite/:token bleibt aufrufbar — die Page selbst handhabt den
// Login-Redirect mit Token-Memorierung in sessionStorage.
function isPublicRoute(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/reset-password' ||
    pathname.startsWith('/invite/')
  );
}

const App: ParentComponent = (props): JSX.Element => {
  const ready = useAuthReady();
  const session = useSession();
  const accountInvalid = useAccountInvalid();
  const location = useLocation();
  const navigate = useNavigate();

  useEditModeHotkey();
  useThemeBootstrap();
  useViewportClasses();
  useUserPrefsSync();
  useWorkingHoursSync();
  useDrawerHotkey();
  // Welle B B.0.G: Plattform-Admin-Status warm halten. Erst-Bootstrap
  // beim ersten Aufruf, danach refresh auf Auth-Change. Sync getter
  // (isPlatformAdminCached) wird von alias-resolve genutzt — der Cache
  // muss VOR erstem ^-Tippen warm sein.
  useIsPlatformAdmin();

  // Account-Health-Toast: wenn die JWT-Session lokal noch existiert, der
  // serverseitige User aber weg ist (geloeschter Account), hat lib/auth
  // bereits local-only signOut + accountInvalid=true gesetzt. Wir zeigen
  // einen Toast genau einmal pro Boot, damit der User versteht warum er
  // ploetzlich auf der Login-Page landet.
  let accountInvalidToastShown = false;
  createEffect(() => {
    if (accountInvalid() && !accountInvalidToastShown) {
      accountInvalidToastShown = true;
      showToast(
        'Dein Account wurde entfernt. Bitte mit einer gueltigen Adresse neu anmelden.',
        'error',
        { ms: 10000 },
      );
    }
  });

  // MFA-Gate: nach erfolgreichem Login (AAL1) pruefen ob User TOTP-
  // Faktor hat. Wenn ja → Dialog erzwingt Code-Eingabe → AAL2.
  // Idempotent: bei wiederholtem Auth-Change wird der Check nur einmal
  // gleichzeitig ausgefuehrt.
  createEffect(() => {
    const s = session();
    if (!s) return;
    void checkMfaGate();
  });

  // D.3-V2 — User-Profile-Boot fuer Date-Format-Context. Beim Login
  // laden wir bio/timezone/language aus user_profiles und seeden
  // lib/dates.ts. Beim Logout reset auf Defaults. Failure ist non-
  // fatal: dates.ts bleibt auf de-DE + Browser-TZ.
  createEffect(() => {
    const s = session();
    const uid = s?.user?.id ?? null;
    if (!uid) {
      resetUserDateContext();
      return;
    }
    void (async () => {
      try {
        const profile = await fetchMyUserProfile(uid);
        setUserDateContext({
          language: profile?.language ?? null,
          timezone: profile?.timezone ?? null,
        });
      } catch (err) {
        console.error('userDateContext-bootstrap:', err);
      }
    })();
  });

  // Route-Guard: ohne Session -> /login (ausser auf public-Routen),
  // mit Session auf /login -> Pending-Invite-Redeem oder /.
  createEffect(() => {
    if (!ready()) return;
    const path = location.pathname;
    const onLogin = path === '/login';
    if (!session() && !isPublicRoute(path)) {
      resetOnboardingGate();
      navigate('/login', { replace: true });
      return;
    }
    if (session() && onLogin) {
      // Falls /invite/:token zwischengeparkt wurde, den nach Login
      // wieder anspringen. Ein Re-Klick auf den Mail-Link waere sonst
      // noetig.
      let pending: string | null = null;
      try {
        pending = sessionStorage.getItem(PENDING_INVITE_KEY);
      } catch {
        pending = null;
      }
      if (pending) {
        navigate(`/invite/${encodeURIComponent(pending)}`, { replace: true });
      } else {
        navigate('/', { replace: true });
      }
      return;
    }

    // Onboarding-Gate (A.4b): brand-neue User mit leerem Default-
    // Workspace landen auf /onboarding. Existing User mit Inhalt
    // werden nur gebackfilled (onboarding_done=true gesetzt). Pruefung
    // laeuft einmal pro Session via Modul-lokal-Cache in
    // onboarding-gate.ts.
    if (
      session() &&
      !path.startsWith('/onboarding') &&
      !path.startsWith('/admin') &&
      !isPublicRoute(path) &&
      !path.startsWith('/invite/')
    ) {
      const userId = session()?.user.id;
      if (userId) {
        void checkAndMaybeRedirectToOnboarding(userId, navigate);
      }
    }
  });

  return (
    <div class="app-shell">
      <Show when={ready()} fallback={<p class="boot">Lade…</p>}>
        {props.children}
      </Show>
      <AiProviderHint />
      <Show when={session()}>
        <AiHelpDrawerToggle />
        <AiHelpDrawer />
      </Show>
      <Toasts />
      <DialogHost />
      <ProgressOverlay />
      <StepUpDialog />
      <MfaGateDialog />
      <Show when={session()}>
        <WelcomeModal />
        <CellSuggestModal />
      </Show>
    </div>
  );
};

export default App;
