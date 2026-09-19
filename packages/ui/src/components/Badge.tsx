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
  // Not `fill-secondary`: in the light theme that resolves to `surface-2`,
  // the same white as the table row a badge sits in, and the pill vanishes
  // (`semantic.ts`'s own `badge-neutral`, the switch track's fix reused).
  neutral: 'bg-badge-neutral text-fg-secondary',
  accent: 'bg-tint-accent text-on-tint-accent',
  success: 'bg-tint-success text-on-tint-success',
  danger: 'bg-tint-danger text-on-tint-danger',
  warning: 'bg-tint-warning text-on-tint-warning',
  info: 'bg-tint-info text-on-tint-info',
};

/**
 * A small piece of status.
 *
 * `rounded`, the same nearly-square control radius as everything else, not
 * the pill §7.1 used to reserve for exactly this. What tells a badge from a
 * button is not its corner — it is that a button fills with a flat surface
 * colour and this fills with a *tint*, at caption size, inline rather than in
 * the control row.
 *
 * Every tone pairs a `bg-*` with its own `on-bg-*`, so a badge is readable by
 * construction rather than by whoever picked the colours being careful.
 */
export function Badge({ tone = 'neutral', children, className }: BadgeProps): ReactNode {
  return (
    <span
      className={clsx(
        'rounded inline-flex items-center whitespace-nowrap',
        'px-[var(--vx-pad-sm)] py-[2px] text-caption font-medium',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
