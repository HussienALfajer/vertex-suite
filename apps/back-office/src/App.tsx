import { useState, type ReactNode } from 'react';

import { VertexProvider, type ThemeChoice } from '@vertex/ui';

import { createTranslator } from './catalogue.js';
import { useSession, SessionProvider } from './session.js';
import { SignIn } from './SignIn.js';
import { Shell } from './Shell.js';
import type { SystemOfRecord } from './system.js';
import { ThemeSwitch } from '@vertex/ui';

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
  // `system` is the default and means the absence of `data-theme` (§3.2): the
  // device decides, which on a machine that already turns dark at dusk is the
  // answer somebody has given once and should not have to give again.
  const [theme, setTheme] = useState<ThemeChoice>('system');

  return (
    <VertexProvider translator={translator} locale="ar" theme={theme}>
      <SessionProvider system={system}>
        <Screen themeSwitch={<ThemeSwitch theme={theme} onChange={setTheme} />} />
      </SessionProvider>
    </VertexProvider>
  );
}

/**
 * Signed in or not, which is the only routing decision this app can make yet.
 *
 * A router arrives with the second destination, for the reason `Shell` gives
 * about the navigation it does not have.
 *
 * The theme control is handed down as an element rather than reached for
 * through a context, because the two screens put it in different places — the
 * shell has a header to hang it in and the sign-in screen has a corner — and
 * two callers is not yet a reason to invent a context for one value.
 */
function Screen({ themeSwitch }: { themeSwitch: ReactNode }): ReactNode {
  const { session } = useSession();
  return session === null ? (
    <SignIn themeSwitch={themeSwitch} />
  ) : (
    <Shell themeSwitch={themeSwitch} />
  );
}
