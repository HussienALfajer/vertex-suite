import { clsx } from 'clsx';
import type { ReactNode } from 'react';

/** The five meanings of §4.3, plus the quiet neutral that carries no meaning at all. */
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning' | 'info';

export interface BadgeProps {
  readonly tone?: BadgeTone;
  readonly children: ReactNode;
  readonly className?: string;
}

const toneClasses: Readonly<Record<BadgeTone, string>> = {
  neutral: 'bg-fill-secondary text-fg-secondary',
  accent: 'bg-tint-accent text-on-tint-accent',
  success: 'bg-tint-success text-on-tint-success',
  danger: 'bg-tint-danger text-on-tint-danger',
  warning: 'bg-tint-warning text-on-tint-warning',
  info: 'bg-tint-info text-on-tint-info',
};

/**
 * A small piece of status.
 *
 * Pill-shaped, and §7.1 reserves that shape for exactly this: badges and status
 * chips. A pill-shaped *button* reads as a chip and gets ignored, which is why
 * the radius is not a free choice.
 *
 * Every tone pairs a `bg-*` with its own `on-bg-*`, so a badge is readable by
 * construction rather than by whoever picked the colours being careful.
 */
export function Badge({ tone = 'neutral', children, className }: BadgeProps): ReactNode {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-pill whitespace-nowrap',
        'px-[var(--vx-pad-sm)] py-[2px] text-caption font-medium',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
