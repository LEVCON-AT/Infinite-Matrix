import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import App from './App';
import Login from './routes/Login';
import Workspace from './routes/Workspace';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

render(
  () => (
    <Router root={App}>
      <Route path="/" component={Workspace} />
      <Route path="/login" component={Login} />
      <Route path="/w/:workspaceId" component={Workspace} />
      <Route path="/w/:workspaceId/n/:nodeId" component={Workspace} />
      <Route path="/w/:workspaceId/c/:cellId/checklists" component={Workspace} />
      <Route path="/w/:workspaceId/c/:cellId/info" component={Workspace} />
    </Router>
  ),
  root,
);
