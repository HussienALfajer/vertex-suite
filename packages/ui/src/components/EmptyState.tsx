import { clsx } from 'clsx';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  readonly message: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly className?: string;
}

/**
 * What a region says when it holds nothing.
 *
 * It says something rather than nothing, because an empty grid with no
 * explanation is indistinguishable from a grid that failed to load — and the
 * two call for opposite reactions from whoever is looking at it.
 */
export function EmptyState({
  message,
  description,
  action,
  className,
}: EmptyStateProps): ReactNode {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center text-center',
        'gap-[var(--vx-gap-sm)] p-[var(--vx-pad-xl)]',
        className,
      )}
    >
      <p className="text-body text-fg-secondary">{message}</p>
      {description === undefined ? null : (
        <p className="text-footnote text-fg-muted max-w-[46ch]">{description}</p>
      )}
      {action === undefined ? null : <div className="mt-[var(--vx-gap-xs)]">{action}</div>}
    </div>
  );
}
