import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface PanelProps {
  readonly title?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  /** Removes the inner padding, for a panel whose whole body is a grid. */
  readonly flush?: boolean;
  readonly className?: string;
}

/**
 * A bounded region of a page.
 *
 * It separates from the page by **surface**, not by a heavy rule: §2 asks for
 * hierarchy carried by whitespace and surface shifts, with borders kept for
 * where they genuinely aid scanning — which is grids and tables, not every box
 * on a screen. A panel that shouts is a panel competing with its own contents.
 */
export function Panel({
  title,
  actions,
  children,
  flush = false,
  className,
}: PanelProps): ReactNode {
  return (
    <section
      className={clsx(
        'bg-surface-2 rounded-card border border-line',
        // A rounded container has to clip what it holds, or the corners are a
        // lie: a flush `DataTable`'s square header background and the browser's
        // own scrollbar track both sit right up against the edge, and without
        // this they paint straight past the curve instead of following it.
        'overflow-hidden',
        'flex flex-col',
        className,
      )}
    >
      {title === undefined && actions === undefined ? null : (
        <header
          className={clsx(
            'flex items-center justify-between gap-[var(--vx-gap-md)]',
            'px-[var(--vx-pad-lg)] py-[var(--vx-pad-md)]',
            'border-b border-line',
          )}
        >
          {typeof title === 'string' ? (
            <h2 className="text-heading font-body-semibold text-fg">{title}</h2>
          ) : (
            title
          )}
          {actions === undefined ? null : (
            <div className="flex items-center gap-[var(--vx-gap-sm)]">{actions}</div>
          )}
        </header>
      )}
      <div className={clsx('flex flex-col', flush ? '' : 'p-[var(--vx-pad-lg)]')}>{children}</div>
    </section>
  );
}
