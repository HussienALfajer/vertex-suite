import { useState, type ReactNode } from 'react';

import { ThemeSwitch, ToastRegion, VertexProvider, type TwoToneTheme } from '@vertex/ui';

import { CalendarProvider } from './calendar.js';
import { createTranslator } from './catalogue.js';
import { ChartProvider } from './chart.js';
import { CurrenciesProvider } from './currencies.js';
import { LedgerProvider } from './ledger.js';
import { OrganisationProvider } from './organisation.js';
import { RatesProvider } from './rates.js';
import { navigate } from './routing.js';
import { useSession, SessionProvider } from './session.js';
import { SignIn } from './SignIn.js';
import { Shell } from './Shell.js';
import type { SystemOfRecord } from './system.js';
import { UsersProvider } from './users.js';

const translator = createTranslator();

export interface AppProps {
  readonly system: SystemOfRecord;
}

/**
 * The application root.
 *
 * `VertexProvider` is the whole of the shell's wiring: it derives direction
 * from the locale rather than carrying a flag beside it (`SYS-01`, §9), stamps
 * the three switching axes of §3.2 onto the document, supplies the translator
 * every string resolves through, and — from this unit on — is told what routing
 * means here, so that a link inside the design system moves between screens
 * instead of reloading the document and taking the session with it.
 *
 * `comfortable` is the density and it is the default: §6.1 gives forms the
 * comfortable one because an entry error costs far more than a scroll, and the
 * back office is worked with a pointer all day. The register is `touch` and the
 * grids raise themselves to `compact`; neither is this app's decision to make
 * at the root.
 */
export function App({ system }: AppProps): ReactNode {
  // A concrete choice, not `'system'`: §3.2's third state — the absence of
  // `data-theme`, following the device — is no longer offered here. A shop's
  // shared till does not turn dark at dusk the way a screen its owner also
  // uses at home does, and this app now decides light or dark once at load
  // rather than leaving the choice to change itself between visits.
  const [theme, setTheme] = useState<TwoToneTheme>('light');

  return (
    <VertexProvider translator={translator} locale="ar" theme={theme} navigate={navigate}>
      <ToastRegion>
        <SessionProvider system={system}>
          <Screen system={system} themeSwitch={<ThemeSwitch theme={theme} onChange={setTheme} />} />
        </SessionProvider>
      </ToastRegion>
    </VertexProvider>
  );
}

/**
 * Signed in or not, which is the routing decision that comes before routing.
 *
 * Every screen behind it reads the shop's own structure, so the provider that
 * holds it sits here rather than at the root: mounting it before anybody has
 * signed in would be a read sent to the store node on behalf of nobody, and it
 * would have to be thrown away and asked again the moment somebody did.
 *
 * The theme control is handed down as an element rather than reached for
 * through a context, because the two screens put it in different places — the
 * frame has a banner to hang it in and the sign-in screen has a corner — and
 * two callers is not yet a reason to invent a context for one value.
 */
function Screen({
  system,
  themeSwitch,
}: {
  readonly system: SystemOfRecord;
  readonly themeSwitch: ReactNode;
}): ReactNode {
  const { session } = useSession();
  return session === null ? (
    <SignIn themeSwitch={themeSwitch} />
  ) : (
    <OrganisationProvider system={system}>
      <UsersProvider system={system}>
        <CurrenciesProvider system={system}>
          <RatesProvider system={system}>
            <ChartProvider system={system}>
              <CalendarProvider system={system}>
                <LedgerProvider system={system}>
                  <Shell themeSwitch={themeSwitch} system={system} />
                </LedgerProvider>
              </CalendarProvider>
            </ChartProvider>
          </RatesProvider>
        </CurrenciesProvider>
      </UsersProvider>
    </OrganisationProvider>
  );
}
