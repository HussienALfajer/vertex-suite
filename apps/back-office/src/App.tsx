import type { ReactNode } from 'react';

import { VertexProvider } from '@vertex/ui';

import { createTranslator } from './catalogue.js';
import { useSession, SessionProvider } from './session.js';
import { SignIn } from './SignIn.js';
import { Shell } from './Shell.js';
import type { SystemOfRecord } from './system.js';

const translator = createTranslator();

export interface AppProps {
  readonly system: SystemOfRecord;
}

/**
 * The application root.
 *
 * `VertexProvider` is the whole of the shell's wiring: it derives direction
 * from the locale rather than carrying a flag beside it (`SYS-01`, §9), stamps
 * the three switching axes of §3.2 onto the document, and supplies the
 * translator every string resolves through.
 *
 * `comfortable` is the density and it is the default: §6.1 gives forms the
 * comfortable one because an entry error costs far more than a scroll, and the
 * back office is worked with a pointer all day. The register is `touch` and the
 * grids raise themselves to `compact`; neither is this app's decision to make
 * at the root.
 */
export function App({ system }: AppProps): ReactNode {
  return (
    <VertexProvider translator={translator} locale="ar">
      <SessionProvider system={system}>
        <Screen />
      </SessionProvider>
    </VertexProvider>
  );
}

/**
 * Signed in or not, which is the only routing decision this app can make yet.
 *
 * A router arrives with the second destination, for the reason `Shell` gives
 * about the navigation it does not have.
 */
function Screen(): ReactNode {
  const { session } = useSession();
  return session === null ? <SignIn /> : <Shell />;
}
