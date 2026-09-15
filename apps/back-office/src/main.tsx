import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { developmentSystem } from './dev-system.js';
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
 */
const system = developmentSystem({
  people: [
    { handle: 'owner', password: 'till-morning-1' },
    { handle: 'ahmad', password: 'till-morning-1', active: false },
  ],
});

createRoot(container).render(
  <StrictMode>
    <App system={system} />
  </StrictMode>,
);
