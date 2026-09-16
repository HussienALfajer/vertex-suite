import { clsx } from 'clsx';
import type { ReactNode } from 'react';

import { useTranslator } from '../providers/context.js';

export interface PageProps {
  readonly children: ReactNode;
  /**
   * The application's own bar: its mark, who is signed in, the way out.
   *
   * A slot rather than a component, because what stands here is the one part of
   * a screen that knows which application it is — and a `TopBar` published from
   * the design system would be a component whose every prop is an application's
   * private business.
   */
  readonly banner?: ReactNode;
  /** The primary navigation, on the inline start. Usually a `SideNav`. */
  readonly nav?: ReactNode;
  readonly className?: string;
}

/**
 * The page ground.
 *
 * It owns the skip link, because §11 requires every screen to begin with one
 * and a rule every screen has to remember is a rule some screen will not.
 *
 * It owns the **chrome slots** for the same reason. The skip link exists to put
 * the content one keystroke away from a banner and a navigation column that are
 * identical on every screen — so it has to come before both, and an application
 * that assembled its own frame around this component would put its own controls
 * in front of it and quietly make the link pointless. Here the ordering is a
 * property of the page rather than a convention each app keeps.
 */
export function Page({ children, banner, nav, className }: PageProps): ReactNode {
  const translator = useTranslator();
  const hasChrome = banner !== undefined || nav !== undefined;

  const main = (
    <main
      id="main"
      className={clsx(
        'flex flex-col gap-[var(--vx-gap-lg)] p-[var(--vx-pad-xl)]',
        // Inside a frame the page no longer scrolls as one piece: the banner and
        // the navigation stay put and the content moves under them, which is
        // what keeps "where am I" and "where can I go" on screen at row 300.
        //
        // `[&>*]:shrink-0` is what makes that scroll mean anything. A flex item
        // shrinks by default, so a column whose contents are taller than it
        // **compresses them instead of scrolling** — and a section with
        // `overflow-hidden` compresses by having its content cut off. That is
        // how a listing and a map on one screen ended up as a listing and a
        // sliver: nothing was wrong with either, they were simply being made to
        // share a height neither had asked for.
        hasChrome ? 'min-w-0 flex-1 overflow-auto [&>*]:shrink-0' : '',
      )}
    >
      {children}
    </main>
  );

  return (
    <div
      className={clsx(
        'bg-surface-1 text-fg min-h-full font-sans',
        hasChrome ? 'flex h-full flex-col' : '',
        className,
      )}
    >
      <a
        href="#main"
        className={clsx(
          'sr-only focus:not-sr-only focus:absolute focus:z-50',
          'focus:m-[var(--vx-pad-md)] focus:rounded focus:px-[var(--vx-pad-md)] focus:py-[var(--vx-pad-sm)]',
          'focus:bg-fill-primary focus:text-on-primary',
        )}
      >
        {translator.format('a11y.skipToContent')}
      </a>
      {banner}
      {nav === undefined ? (
        main
      ) : (
        <div className="flex min-h-0 flex-1">
          {nav}
          {main}
        </div>
      )}
    </div>
  );
}

export interface PageHeaderProps {
  readonly title: string;
  readonly description?: string;
  /**
   * A mark beside the title. Decorative by construction: whatever it is sits
   * next to a heading that already names the page, so a second announcement of
   * the same thing is noise to somebody listening rather than looking.
   */
  readonly icon?: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

/**
 * The one page title on a screen (§5.2: `page` is used once).
 *
 * Bold is spent here and nowhere else — §5.3 reserves weight 700 for page
 * titles, so that the heaviest thing on screen is always the answer to "where
 * am I".
 */
export function PageHeader({
  title,
  description,
  icon,
  actions,
  className,
}: PageHeaderProps): ReactNode {
  return (
    <header className={clsx('flex items-start justify-between gap-[var(--vx-gap-lg)]', className)}>
      <div className="flex items-start gap-[var(--vx-gap-md)]">
        {icon === undefined ? null : <div className="mt-[2px] shrink-0">{icon}</div>}
        <div className="flex flex-col gap-[var(--vx-gap-xs)]">
          <h1 className="text-page font-body-bold text-fg">{title}</h1>
          {description === undefined ? null : (
            <p className="text-body text-fg-secondary max-w-[70ch]">{description}</p>
          )}
        </div>
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 items-center gap-[var(--vx-gap-sm)]">{actions}</div>
      )}
    </header>
  );
}
