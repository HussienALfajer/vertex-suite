import { clsx } from 'clsx';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  Cell,
  Column,
  ResizableTableContainer,
  Row,
  Table,
  TableBody,
  TableHeader,
  TableLayout,
  Virtualizer,
  type ColumnProps,
  type Key,
  type TableProps,
} from 'react-aria-components';

import { DensityScope } from '../providers/DensityScope.js';
import { useDensity } from '../providers/context.js';
import { SIZE_TOKENS, type Density } from '../tokens/scale.js';
import { IconButton } from './Button.js';
import { EmptyState } from './EmptyState.js';
import { focusRing } from './styles.js';

/**
 * Which edges of a scrollable region currently hide content, in physical
 * (not logical) directions.
 *
 * `box-shadow` has no logical-direction form — unlike padding or a border, an
 * inset shadow's offset is always along the physical axis — so "start" and
 * "end" are resolved here, once, against the element's own computed
 * direction, rather than asking every caller to know that a table opened
 * RTL wants its overflow cue on the physical right.
 *
 * Horizontal RTL scroll position is where this earns its keep: modern
 * engines agree `scrollLeft` runs `0` (flush with the physical right, where
 * RTL content starts) down to `-(scrollWidth - clientWidth)` (flush with the
 * physical left), rather than mirroring the LTR `0…max` range, so the two
 * directions need their own arithmetic and cannot share one inequality.
 */
function scrollEdges(element: HTMLElement): {
  top: boolean;
  bottom: boolean;
  left: boolean;
  right: boolean;
} {
  const epsilon = 1;
  const { scrollTop, scrollHeight, clientHeight, scrollLeft, scrollWidth, clientWidth } = element;
  const maxTop = scrollHeight - clientHeight;
  const maxLeft = scrollWidth - clientWidth;
  const isRtl = getComputedStyle(element).direction === 'rtl';

  return {
    top: scrollTop > epsilon,
    bottom: scrollTop < maxTop - epsilon,
    left: isRtl ? scrollLeft > -maxLeft + epsilon : scrollLeft > epsilon,
    right: isRtl ? scrollLeft < -epsilon : scrollLeft < maxLeft - epsilon,
  };
}

/**
 * Applied straight to the DOM rather than through `useState`: a scroll event
 * fires far more often than this component should re-render, and every frame
 * already has the answer sitting in the same element's own scroll metrics.
 */
function applyScrollEdges(element: HTMLElement): void {
  const edges = scrollEdges(element);
  element.toggleAttribute('data-scroll-shadow-top', edges.top);
  element.toggleAttribute('data-scroll-shadow-bottom', edges.bottom);
  element.toggleAttribute('data-scroll-shadow-left', edges.left);
  element.toggleAttribute('data-scroll-shadow-right', edges.right);
}

export interface DataTableColumn<T> {
  readonly id: string;
  readonly header: string;
  /** Right-aligned figures read as a column; left-aligned ones do not. */
  readonly align?: 'start' | 'end';
  /** React Aria's own column size: a number, a percentage, or a fraction. */
  readonly width?: ColumnProps['width'];
  readonly isRowHeader?: boolean;
  readonly render: (row: T) => ReactNode;
}

export interface DataTableProps<T> extends Omit<TableProps, 'className' | 'children'> {
  readonly label: string;
  readonly columns: readonly DataTableColumn<T>[];
  readonly rows: readonly T[];
  readonly emptyMessage: string;
  /**
   * Virtualise the body. Off by default: below a few hundred rows it costs more
   * than it saves, and above thirty thousand nothing else works.
   */
  readonly isVirtualised?: boolean;
  readonly className?: string;
  /**
   * What identifies a row, when it is not the row's own `id`.
   *
   * Optional for the row shape every platform-issued record already has —
   * `Id<'branch'>`, `Id<'role'>`, and the rest name their record — and the
   * type says so: only a row with no `id` field requires this. `FX`'s
   * currency is the one record in this product with no issued identifier at
   * all (`FX-01`: the code **is** the identity, and every amount ever
   * recorded names it), so its screen supplies `rowKey={(currency) => currency.code}`
   * instead of inventing a synthetic `id` nothing else in the module needs.
   */
  readonly rowKey?: T extends { id: Key } ? ((row: T) => Key) | undefined : (row: T) => Key;
}

/**
 * The grid.
 *
 * Two things make it usable rather than merely present:
 *
 * **It is `compact` inside.** Rows per screen is a real productivity number for
 * a stock keeper working through three hundred lines (§6.1), so the table
 * raises density on its own subtree rather than waiting to be told — except on
 * a touch surface, where `DensityScope` refuses to lower it (§6.1, §6.3).
 *
 * **It has one tab stop, not thirty thousand.** React Aria's table uses a
 * roving `tabindex`: `Tab` enters and leaves the grid, arrows move inside it. A
 * table with a tab stop per row is not keyboard-operable, it is a trap (§11.1).
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  emptyMessage,
  isVirtualised = false,
  className,
  rowKey,
  ...props
}: DataTableProps<T>): ReactNode {
  const density = useDensity();
  const rowHeight = SIZE_TOKENS['h-row']?.[density === 'touch' ? 'touch' : 'compact'] ?? 32;
  // The cast is what `rowKey`'s conditional type promises the caller already
  // proved: a `T` with no `id` cannot reach here without supplying one.
  const keyOf = rowKey ?? ((row: T) => (row as { id: Key }).id);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Re-measured on scroll, and whenever either the container or what it
  // scrolls changes size — a row added below the fold, or a column widened
  // past the viewport, changes the answer without the container itself
  // resizing, which is why the table is observed as well. Subscribed once:
  // every screen builds its `columns` inline, so keying this on them would
  // tear the listeners down and put them back on every render.
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return undefined;

    const update = (): void => {
      applyScrollEdges(element);
    };
    update();
    element.addEventListener('scroll', update, { passive: true });

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    // The table, or the virtualiser's sized stand-in for it.
    const content = element.firstElementChild;
    if (content !== null) observer?.observe(content);

    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, []);

  const table = (
    <Table
      {...props}
      aria-label={label}
      // The grid is the single tab stop, so it is a focusable control and must
      // show focus like any other (§7.3, §11.1).
      //
      // `min-w-full` alongside `w-full`, and the two are not the same
      // promise: React Aria measures every `Column`'s own `width` and writes
      // the sum straight onto this element as an inline `width: <n>px` (or
      // `min-content`), which wins over the `w-full` class the moment a
      // screen states every column's width explicitly rather than leaving
      // some to flex — `Numbering.tsx` is the one screen that does, per its
      // own reasoning for why. Short of the panel's own width, that inline
      // style shrank the table to its content and left the remainder of the
      // panel bare: no row line, no cell, a dead strip nothing in this
      // component drew. `min-width` is a different property from `width` and
      // is never touched by that inline style, so it holds the floor the
      // class alone could not.
      className={clsx('w-full min-w-full border-separate border-spacing-0', focusRing)}
    >
      <TableHeader>
        {columns.map((column) => (
          <Column
            key={column.id}
            id={column.id}
            {...(column.isRowHeader === true ? { isRowHeader: true } : {})}
            {...(column.width === undefined ? {} : { width: column.width })}
            className={clsx(
              // `surface-1`, not the `surface-2` the panel is already on: a
              // header that shares its container's fill is a row of grey words
              // with a rule under it, and the rule ends up doing the whole job
              // of separating the labels from the data. One surface step does
              // it without a heavier border, and the step runs the right way in
              // both themes — §3.2 has `surface-1` recede on a dark ground and
              // sit just under white on a light one.
              'bg-surface-1 border-line sticky top-0 z-10 border-b',
              'px-[var(--vx-pad-md)] py-[var(--vx-pad-sm)]',
              'text-footnote font-medium text-fg-secondary',
              column.align === 'end' ? 'text-end' : 'text-start',
              // The header's own separation from the body, cast downward
              // rather than inset, onto the content scrolling underneath
              // it — the container's own top edge is this same header,
              // opaque and sticky, so an inset shadow drawn there would
              // never be seen (see `ResizableTableContainer`, below). Keyed
              // off `data-scroll-shadow-top`, which the container carries
              // exactly when the body has scrolled past its own start.
              'shadow-[0_6px_10px_-5px_transparent]',
              'group-data-[scroll-shadow-top]/scroll:shadow-[0_6px_10px_-5px_var(--vx-border-strong)]',
              'transition-shadow duration-[var(--vx-dur-base)] ease-[var(--vx-ease-out)]',
              focusRing,
            )}
          >
            {column.header}
          </Column>
        ))}
      </TableHeader>

      <TableBody items={rows} renderEmptyState={() => <EmptyState message={emptyMessage} />}>
        {(row: T) => (
          <Row
            id={keyOf(row)}
            className={clsx(
              // §11.3: the row is not itself an action — only the controls
              // inside it are — so it keeps the arrow. A hand over
              // everything teaches the user that the hand means nothing.
              'group cursor-default outline-none',
              'data-[hovered]:bg-fill-ghost-hover',
              'data-[selected]:bg-tint-accent',
              focusRing,
            )}
          >
            {columns.map((column) => (
              <Cell
                key={column.id}
                className={clsx(
                  'border-line h-[var(--vx-h-row)] border-b px-[var(--vx-pad-md)]',
                  'text-body text-fg align-middle outline-none',
                  column.align === 'end' ? 'text-end' : 'text-start',
                )}
              >
                {column.render(row)}
              </Cell>
            ))}
          </Row>
        )}
      </TableBody>
    </Table>
  );

  return (
    <DensityScope value="compact" className={clsx('w-full', className)}>
      <ResizableTableContainer
        ref={scrollRef}
        className={clsx(
          'group/scroll max-h-full w-full overflow-auto',
          // Three shadow layers, one per edge that can plausibly hide
          // content behind this container's own background — held as their
          // own custom properties so more than one can be lit at once,
          // since a table overflowing in both directions needs two or three
          // live at the same time and a single `shadow-*` utility replaces
          // the whole `box-shadow` rather than adding to it. Each starts as
          // a transparent, zero-size layer instead of being absent, because
          // `box-shadow` only accepts `none` for the whole property, never
          // for one layer of it.
          //
          // **The top edge is not one of the three.** This container's own
          // top is where the header sits, `sticky` and opaque — an inset
          // shadow drawn there would sit permanently behind it and never be
          // seen. What plays that role instead is the header's own shadow
          // (`Column`, above), cast the opposite way: outward, onto the
          // content scrolling underneath it.
          '[--vx-scroll-shadow-bottom:inset_0_0_0_0_transparent]',
          '[--vx-scroll-shadow-left:inset_0_0_0_0_transparent]',
          '[--vx-scroll-shadow-right:inset_0_0_0_0_transparent]',
          'shadow-[var(--vx-scroll-shadow-bottom),var(--vx-scroll-shadow-left),var(--vx-scroll-shadow-right)]',
          'transition-[box-shadow] duration-[var(--vx-dur-base)] ease-[var(--vx-ease-out)]',
          // `border-line-strong`, not a one-off colour: an edge that still
          // has content beyond it is exactly what that token already means
          // everywhere else in the table (§7.2), just soft instead of a
          // hard rule.
          'data-[scroll-shadow-bottom]:[--vx-scroll-shadow-bottom:inset_0_-12px_10px_-7px_var(--vx-border-strong)]',
          'data-[scroll-shadow-left]:[--vx-scroll-shadow-left:inset_12px_0_10px_-7px_var(--vx-border-strong)]',
          'data-[scroll-shadow-right]:[--vx-scroll-shadow-right:inset_-12px_0_10px_-7px_var(--vx-border-strong)]',
        )}
      >
        {isVirtualised ? (
          <Virtualizer layout={TableLayout} layoutOptions={{ rowHeight, headingHeight: rowHeight }}>
            {table}
          </Virtualizer>
        ) : (
          table
        )}
      </ResizableTableContainer>
    </DensityScope>
  );
}

/**
 * The width an actions column needs in order to hold `count` row actions.
 *
 * Every number in it belongs to the design system rather than to a screen:
 * `TableRowActions` renders its controls at `comfortable` — a square of
 * `h-control` — spaces them by `gap-md`, and sits in a cell carrying `pad-md`
 * at the table's own `compact`. A screen that wrote the total itself would be
 * holding a copy of three tokens, and would silently start clipping the last
 * action the day any of them moved.
 *
 * React Aria will not size a column below 75px, so the `1%` that used to stand
 * for "shrink to fit" under an automatic table layout is, under the fixed one
 * it actually uses, a column too narrow to hold what is in it.
 *
 * The cell's padding is the table's density — `compact`, except on a touch
 * surface, which the table may not lower (§6.3). It was always `compact`, so
 * on the register a three-action column came out 16px short and the last
 * action was clipped.
 */
export function actionsColumnWidth(count: number, density: Density = 'comfortable'): number {
  const control = SIZE_TOKENS['h-control']?.[density] ?? 32;
  const gap = SIZE_TOKENS['gap-md']?.[density] ?? 16;
  const padding = SIZE_TOKENS['pad-md']?.[density === 'touch' ? 'touch' : 'compact'] ?? 8;
  return count * control + Math.max(count - 1, 0) * gap + padding * 2;
}

export interface TableRowActionsProps {
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * The actions at the end of a row.
 *
 * They are **always present**, not revealed on hover: a control that only
 * exists for a pointer does not exist at all on a register, and §11 makes a
 * pointer-only control a defect rather than a style.
 */
export function TableRowActions({ children, className }: TableRowActionsProps): ReactNode {
  return (
    // **The one part of a row that is not data, and the only part that is not
    // `compact`.** The table raises density for rows-per-screen, which is a
    // reading decision — but these are controls, and at `compact` they came out
    // 24px square with the hover fill drawn tight around a 16px glyph, so a row
    // action looked like a different kind of control from every other icon
    // button in the product. `comfortable` here makes it exactly the same
    // control as the one in the frame beside it: same box, same fill, same
    // corner. `DensityScope` still refuses to lower below `touch` on a
    // register, so this cannot undercut §6.3's floor.
    <DensityScope
      value="comfortable"
      className={clsx('flex items-center justify-end gap-[var(--vx-gap-md)]', className)}
    >
      {children}
    </DensityScope>
  );
}

export { IconButton as TableRowAction };
