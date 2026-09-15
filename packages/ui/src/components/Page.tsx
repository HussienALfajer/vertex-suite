import { clsx } from 'clsx';
import type { ReactNode } from 'react';

import { useTranslator } from '../providers/context.js';

export interface PageProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * The page ground.
 *
 * It owns the skip link, because §11 requires every screen to begin with one
 * and a rule every screen has to remember is a rule some screen will not.
 */
export function Page({ children, className }: PageProps): ReactNode {
  const translator = useTranslator();
  return (
    <div className={clsx('bg-surface-1 text-fg min-h-full font-sans', className)}>
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
      <main id="main" className="flex flex-col gap-[var(--vx-gap-lg)] p-[var(--vx-pad-xl)]">
        {children}
      </main>
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
