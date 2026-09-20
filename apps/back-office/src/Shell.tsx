import { useState, type ReactNode } from 'react';

import { Button, Page, SideNav, useTranslator, VertexLogo, type NavItem } from '@vertex/ui';

import { ChangePasswordDialog } from './ChangePasswordDialog.js';
import { useOrganisation } from './organisation.js';
import { hrefOf, useRoute, type RouteName } from './routing.js';
import { BusinessProfile } from './screens/BusinessProfile.js';
import { Chart } from './screens/Chart.js';
import { FiscalCalendar } from './screens/FiscalCalendar.js';
import { Branches } from './screens/Branches.js';
import { Companies } from './screens/Companies.js';
import { Currencies } from './screens/Currencies.js';
import { Locations } from './screens/Locations.js';
import { Numbering } from './screens/Numbering.js';
import { Rates } from './screens/Rates.js';
import { Registers } from './screens/Registers.js';
import { ProfileIcon, RateIcon, ScopeIcon } from './screens/structure.js';
import { Roles } from './screens/Roles.js';
import { Users } from './screens/Users.js';
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
  const [isChangingPassword, setIsChangingPassword] = useState(false);

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
    {
      id: 'registers',
      label: translator.format('nav.registers'),
      href: hrefOf('registers'),
      icon: <RegisterIcon />,
    },
    {
      id: 'numbering',
      label: translator.format('nav.numbering'),
      href: hrefOf('numbering'),
      icon: <NumberingIcon />,
    },
    {
      id: 'users',
      label: translator.format('nav.users'),
      href: hrefOf('users'),
      icon: <UsersIcon />,
    },
    {
      id: 'roles',
      label: translator.format('nav.roles'),
      href: hrefOf('roles'),
      icon: <ScopeIcon />,
    },
    {
      id: 'currencies',
      label: translator.format('nav.currencies'),
      href: hrefOf('currencies'),
      icon: <CurrencyIcon />,
      group: translator.format('nav.group.fx'),
    },
    {
      id: 'rates',
      label: translator.format('nav.rates'),
      href: hrefOf('rates'),
      icon: <RateIcon />,
      group: translator.format('nav.group.fx'),
    },
    {
      id: 'chart',
      label: translator.format('nav.chart'),
      href: hrefOf('chart'),
      icon: <ChartIcon />,
      group: translator.format('nav.group.fin'),
    },
    {
      id: 'fiscal-calendar',
      label: translator.format('nav.fiscalCalendar'),
      href: hrefOf('fiscal-calendar'),
      icon: <FiscalCalendarIcon />,
      group: translator.format('nav.group.fin'),
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
            <Button
              onPress={() => {
                setIsChangingPassword(true);
              }}
            >
              {translator.format('shell.account.action')}
            </Button>
            <Button onPress={() => void signOut()}>{translator.format('shell.signOut')}</Button>
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
      <ChangePasswordDialog isOpen={isChangingPassword} onOpenChange={setIsChangingPassword} />
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
    case 'registers':
      return <Registers />;
    case 'numbering':
      return <Numbering />;
    case 'users':
      return <Users />;
    case 'roles':
      return <Roles />;
    case 'currencies':
      return <Currencies />;
    case 'rates':
      return <Rates />;
    case 'chart':
      return <Chart />;
    case 'fiscal-calendar':
      return <FiscalCalendar />;
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

/** A drawer with a screen above it: the till, and the machine standing at it. */
function RegisterIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={icon} strokeWidth="1.5">
      <rect x="5" y="2.5" width="10" height="6" rx="1" />
      <path d="M2.5 11.5h15v5a1 1 0 01-1 1h-13a1 1 0 01-1-1z" strokeLinejoin="round" />
      <path d="M2.5 11.5L5 8.5h10l2.5 3M8 14.5h4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A ticket with a run of marks on it: one number after another. */
function NumberingIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={icon} strokeWidth="1.5">
      <rect x="2.5" y="5" width="15" height="10" rx="1.5" />
      <path d="M6 8v4M9 8v4M12 8v4M15 8v4" strokeLinecap="round" />
    </svg>
  );
}

/** A coin with a mark on its face: value in a currency, not the amount itself. */
function CurrencyIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={icon} strokeWidth="1.5">
      <circle cx="10" cy="10" r="7.5" />
      <path
        d="M10 6v8M12.2 8.1a2.2 2.2 0 00-2.2-1.1c-1.3 0-2.3.7-2.3 1.7s1 1.4 2.3 1.6c1.3.2 2.3.6 2.3 1.6s-1 1.7-2.3 1.7a2.2 2.2 0 01-2.2-1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A tree of accounts: the shape the books are kept in, not a list of them. */
function ChartIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={icon} strokeWidth="1.5">
      <path d="M4 3.5v11a1.5 1.5 0 001.5 1.5H8" strokeLinecap="round" />
      <path d="M4 9.5h4" strokeLinecap="round" />
      <path d="M9.5 8h7M9.5 14.5h7M9.5 2.5h7" strokeLinecap="round" />
    </svg>
  );
}

/** A page of the year divided into months, with one of them ruled off. */
function FiscalCalendarIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={icon} strokeWidth="1.5">
      <rect x="2.5" y="4" width="15" height="13" rx="1.5" />
      <path d="M2.5 8h15M7 2.5v3M13 2.5v3" strokeLinecap="round" />
      <path d="M10 8v9M2.5 12.5h7" strokeLinecap="round" />
    </svg>
  );
}

/** Two people: who works here, not any one of them. */
function UsersIcon(): ReactNode {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={icon} strokeWidth="1.5">
      <circle cx="7.5" cy="6.5" r="2.5" />
      <path d="M2.5 17v-1a5 5 0 015-5h0a5 5 0 015 5v1" strokeLinejoin="round" />
      <path
        d="M13 6.75a2.5 2.5 0 010 4.9M15.5 17v-1a4.98 4.98 0 00-2.5-4.33"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
