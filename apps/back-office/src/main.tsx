import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('No #root element.');
}

/**
 * The stand-in, wired here and only here.
 *
 * One place names it, so that the day `U07` brings the store node there is one
 * line to change and no screen to touch — which is the whole reason the app
 * talks to a port rather than to whatever is behind it.
 *
 * **In development and nowhere else.** It was imported unconditionally, so every
 * `vite build` shipped it: an owner whose password is written two lines below,
 * and an authority that permits everything. Imported behind `import.meta.env.DEV`,
 * which the build replaces with `false`, it is not in a production bundle at all
 * — and until the store node exists a production build has nothing to talk to,
 * so it says that instead of pretending.
 */
if (!import.meta.env.DEV) {
  throw new Error(
    'The back office has no system of record outside development until U07 brings the store ' +
      'node. The development stand-in is not shipped: its owner password is public.',
  );
}
const { developmentSystem } = await import('./dev-system.js');
const system = developmentSystem({
  people: [
    { handle: 'owner', password: 'till-morning-1' },
    { handle: 'ahmad', password: 'till-morning-1', active: false },
  ],
  // `pnpm demo` opens the shop already set up; `pnpm dev`, and the journeys
  // that run against it, open it empty — the state `SYS-09` is proven from.
  demo: import.meta.env.MODE === 'demo',
});

createRoot(container).render(
  <StrictMode>
    <App system={system} />
  </StrictMode>,
);
