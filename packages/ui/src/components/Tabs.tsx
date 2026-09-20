import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
  Tab as AriaTab,
  Tabs as AriaTabs,
  TabList,
  TabPanel,
  type TabsProps as AriaTabsProps,
} from 'react-aria-components';

import { focusRing } from './styles.js';

export interface TabDefinition {
  readonly id: string;
  readonly label: string;
  /**
   * What the tab shows. Only the selected panel is mounted, so what is written
   * here for the other tabs is an element that is built and never rendered —
   * cheap, and the reason a caller may compute its panels in one pass.
   */
  readonly content: ReactNode;
}

export interface TabsProps extends Omit<AriaTabsProps, 'className' | 'children' | 'orientation'> {
  /**
   * What the set of tabs is, for somebody listening rather than looking: "the
   * fiscal years", not "tabs". A tab list with no name is a list of words with
   * nothing saying what they choose between.
   */
  readonly label: string;
  readonly tabs: readonly TabDefinition[];
  readonly className?: string;
}

/**
 * One of several views of the same subject, chosen by its name.
 *
 * **Horizontal only, and that is a decision rather than an omission.** A
 * vertical tab strip and a navigation rail are the same control drawn twice,
 * and this product already has the rail (`SideNav`); offering both would let
 * two screens answer "where am I" in two different shapes.
 *
 * The tabs are **data rather than composed children**, as `Select`'s options
 * and `DataTable`'s columns are: a screen states what the tabs are and this
 * builds the structure, so the list and the panels cannot fall out of step —
 * a `TabList` whose keys disagree with its panels renders an empty page and
 * says nothing about why.
 *
 * A tab is not disabled one at a time: `disabledKeys` on the strip is React
 * Aria's own way to say it and it reaches here untouched, so there is no
 * second spelling of the same fact for the two to disagree over (§10).
 *
 * Arrow keys move between tabs and are **mirrored for RTL** by React Aria from
 * the locale in `I18nProvider` (§11.1), which is the whole reason this is built
 * on React Aria rather than on a pair of `button`s and a `useState`.
 */
export function Tabs({ label, tabs, className, ...props }: TabsProps): ReactNode {
  return (
    <AriaTabs
      {...props}
      className={clsx('flex w-full min-w-0 flex-col gap-[var(--vx-gap-md)]', className)}
    >
      {/* `overflow-x-auto` rather than wrapping: a strip that wraps to a second
          line moves every tab under it when one is added, and a person who has
          learned where a year sits loses it. Scrolling keeps the order and the
          places, and the keyboard reaches what the pointer would have to scroll
          to — React Aria scrolls the focused tab into view. */}
      <TabList
        aria-label={label}
        items={tabs}
        className="border-line flex min-w-0 shrink-0 items-stretch gap-[var(--vx-gap-xs)] overflow-x-auto border-b"
      >
        {(tab: TabDefinition) => (
          <AriaTab
            id={tab.id}
            className={clsx(
              'relative -mb-px shrink-0 cursor-pointer rounded-t px-[var(--vx-pad-lg)]',
              'flex h-[var(--vx-h-control)] items-center whitespace-nowrap',
              'text-body font-body-medium text-fg-secondary outline-none',
              'transition-colors duration-[var(--vx-dur-snap)] ease-out',
              'data-[hovered]:bg-fill-ghost-hover data-[hovered]:text-fg',
              // The selected tab is marked by ink **and** by a rule under it.
              // Colour alone would be the only cue for a reader who cannot
              // separate the two greys, and §4.6 does not allow that to be the
              // only difference between "this page" and "not this page".
              'data-[selected]:text-fg data-[selected]:font-body-semibold',
              'data-[selected]:border-b-2 data-[selected]:border-b-line-accent',
              'data-[disabled]:text-fg-disabled data-[disabled]:cursor-not-allowed',
              focusRing,
            )}
          >
            {tab.label}
          </AriaTab>
        )}
      </TabList>

      {tabs.map((tab) => (
        // The panel is a tab stop of its own, which is React Aria's doing and
        // is right: everything inside it may be a grid with a roving index, and
        // a keyboard needs somewhere to land between the strip and the content.
        <TabPanel
          key={tab.id}
          id={tab.id}
          className={clsx('flex min-w-0 flex-col gap-[var(--vx-gap-md)]', focusRing)}
        >
          {tab.content}
        </TabPanel>
      ))}
    </AriaTabs>
  );
}
