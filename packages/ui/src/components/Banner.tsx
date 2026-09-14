import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/** The four meanings §4.3 allows a notice to carry. */
export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

export interface BannerProps {
  readonly tone?: BannerTone;
  readonly title?: string;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  readonly className?: string;
}

const toneClasses: Readonly<Record<BannerTone, string>> = {
  info: 'bg-tint-info text-on-tint-info border-line-info',
  success: 'bg-tint-success text-on-tint-success border-line-success',
  warning: 'bg-tint-warning text-on-tint-warning border-line-warning',
  danger: 'bg-tint-danger text-on-tint-danger border-line-danger',
};

/**
 * A notice that stays until the situation changes.
 *
 * `danger` and `warning` announce themselves to assistive technology, the other
 * two do not: a stock level that fell below its minimum should interrupt, and a
 * confirmation that a batch imported should not.
 *
 * Colour is never the only channel. Each tone carries an icon of its own shape,
 * because a cashier may be colour-blind and the system will never know (§4.7).
 */
export function Banner({
  tone = 'info',
  title,
  children,
  actions,
  className,
}: BannerProps): ReactNode {
  const interrupts = tone === 'danger' || tone === 'warning';

  return (
    <div
      role={interrupts ? 'alert' : 'status'}
      className={clsx(
        'rounded-card flex items-start gap-[var(--vx-gap-sm)] border',
        'px-[var(--vx-pad-lg)] py-[var(--vx-pad-md)]',
        toneClasses[tone],
        className,
      )}
    >
      <BannerIcon tone={tone} />
      <div className="flex flex-1 flex-col gap-[var(--vx-gap-xs)]">
        {title === undefined ? null : <p className="text-body font-body-semibold">{title}</p>}
        <div className="text-body">{children}</div>
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 items-center gap-[var(--vx-gap-xs)]">{actions}</div>
      )}
    </div>
  );
}

function BannerIcon({ tone }: { tone: BannerTone }): ReactNode {
  const shared = 'size-[var(--vx-icon)] mt-[2px] shrink-0 fill-none stroke-current';
  // Distinct shapes, not distinct colours: a triangle warns, a circle informs,
  // a tick confirms, an octagon stops — read without any colour at all.
  switch (tone) {
    case 'danger':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className={shared} strokeWidth="1.5">
          <path d="M7 2.5h6l4.5 4.5v6L13 17.5H7L2.5 13V7z" strokeLinejoin="round" />
          <path d="M10 6v5M10 13.5v.5" strokeLinecap="round" />
        </svg>
      );
    case 'warning':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className={shared} strokeWidth="1.5">
          <path d="M10 2.5l8 14H2z" strokeLinejoin="round" />
          <path d="M10 8v4M10 14.5v.5" strokeLinecap="round" />
        </svg>
      );
    case 'success':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className={shared} strokeWidth="1.5">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M6.5 10.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'info':
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true" className={shared} strokeWidth="1.5">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 9v5M10 6v.5" strokeLinecap="round" />
        </svg>
      );
  }
}
