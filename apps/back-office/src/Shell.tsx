import type { ReactNode } from 'react';

import { Button, EmptyState, Page, PageHeader, useTranslator, VertexLogo } from '@vertex/ui';

import { useSession } from './session.js';

/**
 * The frame the signed-in screens hang in.
 *
 * **There is no navigation here, and its absence is the decision.** §15 has a
 * component arrive with the unit that needs it, and the same argument applies
 * to a frame: a `SideNav` built now would have one destination and no second
 * one to be judged against, which is precisely how an API turns out wrong. It
 * arrives with the second screen, because that is the first moment there is
 * anywhere to go.
 *
 * What the frame does own from the first screen is what every screen after it
 * relies on: the page ground and its skip link (§11), the one page title (§5.2)
 * and the way out.
 */
export function Shell({ themeSwitch }: { readonly themeSwitch: ReactNode }): ReactNode {
  const translator = useTranslator();
  const { session, signOut } = useSession();

  return (
    <Page>
      <PageHeader
        // The mark is decorative here: the title beside it already says the
        // name, and a screen reader announcing it twice is noise.
        icon={<VertexLogo className="h-7 w-auto" />}
        title={translator.format('app.name')}
        description={translator.format('shell.signedInAs', { handle: session?.handle ?? '' })}
        actions={
          <>
            {themeSwitch}
            <Button onPress={signOut}>{translator.format('shell.signOut')}</Button>
          </>
        }
      />
      <EmptyState
        message={translator.format('shell.nothingYet')}
        description={translator.format('shell.nothingYet.explanation')}
      />
    </Page>
  );
}
