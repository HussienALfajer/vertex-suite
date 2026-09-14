import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { Breadcrumb, Breadcrumbs, Link } from 'react-aria-components';

import { focusRing } from './styles.js';

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon?: ReactNode;
  /** A count worth seeing from the navigation — pending syncs, open exceptions. */
  readonly badge?: string;
}

export interface SideNavProps {
  readonly label: string;
  readonly items: readonly NavItem[];
  readonly currentId?: string;
  readonly className?: string;
}

/**
 * The primary navigation.
 *
 * The current item is marked with `aria-current`, not only with a colour — a
 * screen reader has to be able to answer "where am I" too, and §4.7's rule that
 * colour is never the only channel is not limited to charts.
 */
export function SideNav({ label, items, currentId, className }: SideNavProps): ReactNode {
  return (
    <nav
      aria-label={label}
      className={clsx(
        'bg-surface-2 border-line flex flex-col gap-[var(--vx-gap-xs)] border-e',
        'p-[var(--vx-pad-md)]',
        className,
      )}
    >
      {items.map((item) => {
        const isCurrent = item.id === currentId;
        return (
          <Link
            key={item.id}
            href={item.href}
            {...(isCurrent ? { 'aria-current': 'page' as const } : {})}
            className={clsx(
              'flex items-center gap-[var(--vx-gap-sm)] rounded',
              'h-[var(--vx-h-control)] px-[var(--vx-pad-md)]',
              'text-body no-underline outline-none',
              '[&_svg]:size-[var(--vx-icon)] [&_svg]:shrink-0',
              isCurrent
                ? 'bg-fill-ghost-hover text-fg font-body-medium'
                : 'text-fg-secondary hover:bg-fill-ghost-hover hover:text-fg',
              focusRing,
            )}
          >
            {item.icon}
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge === undefined ? null : (
              <span className="text-caption text-fg-muted tabular-nums">{item.badge}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export interface BreadcrumbItem {
  readonly id: string;
  readonly label: string;
  readonly href?: string;
}

export interface BreadcrumbTrailProps {
  readonly label: string;
  readonly items: readonly BreadcrumbItem[];
  readonly className?: string;
}

/**
 * Where this screen sits.
 *
 * The separator is a slash rather than a chevron because a chevron points, and
 * a pointing glyph has to be mirrored in a right-to-left document while a slash
 * does not — one less thing that can be wrong in the direction §9 treats as the
 * default rather than a mode.
 */
export function BreadcrumbTrail({ label, items, className }: BreadcrumbTrailProps): ReactNode {
  return (
    <Breadcrumbs
      aria-label={label}
      className={clsx('flex items-center gap-[var(--vx-gap-xs)]', className)}
    >
      {items.map((item, index) => (
        <Breadcrumb key={item.id} className="flex items-center gap-[var(--vx-gap-xs)]">
          {item.href === undefined || index === items.length - 1 ? (
            <span
              className="text-footnote text-fg"
              {...(index === items.length - 1 ? { 'aria-current': 'page' as const } : {})}
            >
              {item.label}
            </span>
          ) : (
            <Link
              href={item.href}
              className={clsx(
                'text-footnote text-fg-secondary hover:text-fg rounded underline-offset-2',
                'outline-none hover:underline',
                focusRing,
              )}
            >
              {item.label}
            </Link>
          )}
          {index === items.length - 1 ? null : (
            <span aria-hidden="true" className="text-fg-muted text-footnote">
              /
            </span>
          )}
        </Breadcrumb>
      ))}
    </Breadcrumbs>
  );
}
