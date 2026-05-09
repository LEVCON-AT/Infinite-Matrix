import { Route, Router } from '@solidjs/router';
import { render } from 'solid-js/web';
import App from './App';
import Admin from './routes/Admin';
import Agenda from './routes/Agenda';
import AliasRedirect from './routes/AliasRedirect';
import Calendar from './routes/Calendar';
import Invite from './routes/Invite';
import Login from './routes/Login';
import OAuthCallback from './routes/OAuthCallback';
import ObjectDetail from './routes/ObjectDetail';
import ObjectsList from './routes/ObjectsList';
import Onboarding from './routes/Onboarding';
import ResetPassword from './routes/ResetPassword';
import Settings from './routes/Settings';
import Signup from './routes/Signup';
import TaskDetail from './routes/TaskDetail';
import TemplateDesigner from './routes/TemplateDesigner';
import Templates from './routes/Templates';
import Workspace from './routes/Workspace';
import AccountAi from './routes/settings/AccountAi';
import AccountCalendars from './routes/settings/AccountCalendars';
import AccountChannels from './routes/settings/AccountChannels';
import AccountProfile from './routes/settings/AccountProfile';
import AccountSecurity from './routes/settings/AccountSecurity';
import AccountVisibility from './routes/settings/AccountVisibility';
import AccountWorkingHours from './routes/settings/AccountWorkingHours';
import WorkspaceAuditLog from './routes/settings/WorkspaceAuditLog';
import WorkspaceGeneral from './routes/settings/WorkspaceGeneral';
import WorkspaceMembers from './routes/settings/WorkspaceMembers';
import WorkspaceWebhooks from './routes/settings/WorkspaceWebhooks';
import './styles.css';
import { registerServiceWorker } from './lib/pwa';

// Service-Worker fuer PWA-Install + Offline-Cache registrieren. Laeuft
// nur im Prod-Build (Dev-Server bleibt SW-frei, siehe vite.config).
registerServiceWorker();

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

// Router-base muss zum vite-base passen (siehe vite.config). Lokal-
// dev: '/' (Default). Sub-Pfad-Deploy (z.B. staging.matrix.levcon.at/
// app/): '/app'. Ohne base navigiert der Router zu absoluten Pfaden
// wie '/w/<id>' und ein Reload landet auf der nginx-Default-Site,
// nicht im SPA-Fallback.
const ROUTER_BASE = (() => {
  const b = (import.meta.env.VITE_BASE_PATH as string | undefined) ?? '/';
  // Solid-Router base erwartet "/segment" ohne trailing slash; '/' ist
  // erlaubt + heisst kein Prefix.
  return b.replace(/\/$/, '') || '/';
})();

render(
  () => (
    <Router root={App} base={ROUTER_BASE}>
      <Route path="/" component={Workspace} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/invite/:token" component={Invite} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/oauth/callback" component={OAuthCallback} />
      <Route path="/admin" component={Admin} />
      <Route path="/r/:workspaceId/:alias" component={AliasRedirect} />
      <Route path="/w/:workspaceId" component={Workspace} />
      <Route path="/w/:workspaceId/n/:nodeId" component={Workspace} />
      <Route path="/w/:workspaceId/c/:cellId/checklists" component={Workspace} />
      <Route path="/w/:workspaceId/c/:cellId/info" component={Workspace} />
      <Route path="/w/:workspaceId/c/:cellId/docs" component={Workspace} />
      <Route path="/w/:workspaceId/c/:cellId/summary" component={Workspace} />
      <Route path="/w/:workspaceId/c/:cellId/templates" component={Workspace} />
      <Route path="/w/:workspaceId/o/:objectId" component={ObjectDetail} />
      <Route path="/w/:workspaceId/objects" component={ObjectsList} />
      <Route path="/w/:workspaceId/agenda" component={Agenda} />
      <Route path="/w/:workspaceId/calendar" component={Calendar} />
      <Route path="/w/:workspaceId/task/:taskId" component={TaskDetail} />
      <Route path="/w/:workspaceId/templates" component={Templates} />
      <Route path="/w/:workspaceId/templates/edit/:templateId" component={TemplateDesigner} />
      <Route path="/w/:workspaceId/settings" component={Settings}>
        <Route path="/" component={AccountProfile} />
        <Route path="/account/profile" component={AccountProfile} />
        <Route path="/account/security" component={AccountSecurity} />
        <Route path="/account/visibility" component={AccountVisibility} />
        <Route path="/account/ai" component={AccountAi} />
        <Route path="/account/calendars" component={AccountCalendars} />
        <Route path="/account/channels" component={AccountChannels} />
        <Route path="/account/working-hours" component={AccountWorkingHours} />
        <Route path="/workspace/general" component={WorkspaceGeneral} />
        <Route path="/workspace/members" component={WorkspaceMembers} />
        <Route path="/workspace/webhooks" component={WorkspaceWebhooks} />
        <Route path="/workspace/audit" component={WorkspaceAuditLog} />
      </Route>
    </Router>
  ),
  root,
);
