import { Route, Router } from '@solidjs/router';
import { render } from 'solid-js/web';
import App from './App';
import Login from './routes/Login';
import Workspace from './routes/Workspace';
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
      <Route path="/w/:workspaceId" component={Workspace} />
      <Route path="/w/:workspaceId/n/:nodeId" component={Workspace} />
      <Route path="/w/:workspaceId/c/:cellId/checklists" component={Workspace} />
      <Route path="/w/:workspaceId/c/:cellId/info" component={Workspace} />
      <Route path="/w/:workspaceId/c/:cellId/docs" component={Workspace} />
    </Router>
  ),
  root,
);
