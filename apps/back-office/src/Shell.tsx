import type { ReactNode } from 'react';

import { Button, Page, SideNav, useTranslator, VertexLogo, type NavItem } from '@vertex/ui';

import { useOrganisation } from './organisation.js';
import { hrefOf, useRoute, type RouteName } from './routing.js';
import { BusinessProfile } from './screens/BusinessProfile.js';
import { Branches } from './screens/Branches.js';
import { Companies } from './screens/Companies.js';
import { Locations } from './screens/Locations.js';
import { useSession } from './session.js';

/**
 * The frame the signed-in screens hang in.
 *
 * It arrived with the second, third and fourth screens, which is when it could
 * first be judged: §15 has a component arrive with the unit that needs it, and
 * a navigation built against one destination would have been an API discovered
 * to be wrong at the fifth.
 *
 * What it owns is what every screen relies on and none of them should carry: the
 * page ground and its skip link (§11), the way to the other screens, the way
 * out, and the name of the shop this is. The **page title is not here** — §5.2
 * allows one per screen and it is the answer to "where am I", so it belongs to
 * whichever screen is actually on.
 */
export function Shell({ themeSwitch }: { readonly themeSwitch: ReactNode }): ReactNode {
  const translator = useTranslator();
  const { session, signOut } = useSession();
  const { businessName } = useOrganisation();
  const route = useRoute();

  const items: readonly NavItem[] = [
    {
      id: 'companies',
      label: translator.format('nav.companies'),
      href: hrefOf('companies'),
      icon: <CompanyIcon />,
    },
    {
      id: 'business-profile',
      label: translator.format('nav.businessProfile'),
      href: hrefOf('business-profile'),
      icon: <ProfileIcon />,
    },
    {
      id: 'branches',
      label: translator.format('nav.branches'),
      href: hrefOf('branches'),
      icon: <BranchIcon />,
    },
    {
      id: 'locations',
      label: translator.format('nav.locations'),
      href: hrefOf('locations'),
      icon: <LocationIcon />,
    },
  ];

  return (
    <Page
      banner={
        <header className="bg-surface-2 border-line flex items-center justify-between gap-[var(--vx-gap-md)] border-b px-[var(--vx-pad-xl)] py-[var(--vx-pad-md)]">
          <div className="flex min-w-0 items-center gap-[var(--vx-gap-md)]">
            {/* Decorative: the shop's own name stands beside it and says the
                same thing to somebody listening rather than looking. */}
            <VertexLogo className="h-6 w-auto shrink-0" />
            <div className="flex min-w-0 flex-col">
              <span className="text-body font-body-semibold text-fg truncate">
                {businessName ?? translator.format('app.name')}
              </span>
              <span className="text-caption text-fg-muted truncate">
                {translator.format('shell.signedInAs', { handle: session?.handle ?? '' })}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-[var(--vx-gap-sm)]">
            {themeSwitch}
            <Button onPress={signOut}>{translator.format('shell.signOut')}</Button>
          </div>
        </header>
      }
      nav={
        <SideNav
          label={translator.format('shell.nav')}
          items={items}
          currentId={route.name}
          className="w-[14rem] shrink-0 overflow-auto"
        />
      }
    >
      <Screen name={route.name} />
    </Page>
  );
}

/**
 * The one screen that is on.
 *
 * A switch rather than a table of components, because `switch-exhaustiveness-check`
 * then makes a fifth route a compile error here instead of a blank page found
 * later by whoever added it.
 */
function Screen({ name }: { readonly name: RouteName }): ReactNode {
  switch (name) {
    case 'companies':
      return <Companies />;
    case 'business-profile':
      return <BusinessProfile />;
    case 'branches':
      return <Branches />;
    case 'locations':
      return <Locations />;
  }
}

const icon = 'fill-none stroke-current';

/** A building with a door: the legal entity, not the shop. */
function CompanyIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={icon} strokeWidth="1.5">
      <path d="M3.5 17V4a1 1 0 011-1h7a1 1 0 011 1v13" strokeLinejoin="round" />
      <path
        d="M13.5 8h2a1 1 0 011 1v8M2 17h16M6.5 6h3M6.5 9h3M6.5 12h3M8 17v-2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A sheet with lines on it: what a document is printed from. */
function ProfileIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={icon} strokeWidth="1.5">
      <path d="M5 2.5h6.5L16 7v10.5H5z" strokeLinejoin="round" />
      <path d="M11 2.5V7h4.5M7.5 10.5h5M7.5 13.5h3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A shopfront under its awning: the trading site. */
function BranchIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={icon} strokeWidth="1.5">
      <path d="M3 7.5h14l-1-4H4z" strokeLinejoin="round" />
      <path d="M4 7.5V17h12V7.5M8 17v-5h4v5" strokeLinejoin="round" />
    </svg>
  );
}

/** A crate: where goods sit. */
function LocationIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={icon} strokeWidth="1.5">
      <path d="M10 2.5l7 3.5v8l-7 3.5-7-3.5v-8z" strokeLinejoin="round" />
      <path d="M3 6l7 3.5L17 6M10 9.5v8" strokeLinejoin="round" />
    </svg>
  );
}
