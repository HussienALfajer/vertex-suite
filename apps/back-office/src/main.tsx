import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { remoteSystem } from './remote-system.js';
import './styles.css';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('No #root element.');
}

/** Fixture and demo modes are explicit; normal builds talk to the store node. */
const configuredTenant: unknown = import.meta.env['VITE_VERTEX_TENANT'];
const configuredUrl: unknown = import.meta.env['VITE_VERTEX_API_URL'];
const tenant = typeof configuredTenant === 'string' ? configuredTenant : '';
const apiUrl = typeof configuredUrl === 'string' ? configuredUrl : '/api';
const system =
  import.meta.env.MODE === 'fixture' || import.meta.env.MODE === 'demo'
    ? (await import('./dev-system.js')).developmentSystem({
        people: [
          { handle: 'owner', password: 'till-morning-1' },
          { handle: 'ahmad', password: 'till-morning-1', active: false },
        ],
        demo: import.meta.env.MODE === 'demo',
      })
    : remoteSystem({
        tenant,
        baseUrl: apiUrl,
      });

if (import.meta.env.MODE !== 'fixture' && import.meta.env.MODE !== 'demo' && !tenant) {
  throw new Error('VITE_VERTEX_TENANT is required for the back office.');
}

createRoot(container).render(
  <StrictMode>
    <App system={system} />
  </StrictMode>,
);
