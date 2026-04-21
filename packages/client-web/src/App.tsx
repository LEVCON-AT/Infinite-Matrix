import type { JSX, ParentComponent } from 'solid-js';

const App: ParentComponent = (props): JSX.Element => {
  return <div class="app-shell">{props.children}</div>;
};

export default App;
