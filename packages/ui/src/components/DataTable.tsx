import { clsx } from 'clsx';
import type { ReactNode } from 'react';
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

export interface DataTableProps<T extends { id: Key }> extends Omit<
  TableProps,
  'className' | 'children'
> {
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
export function DataTable<T extends { id: Key }>({
  label,
  columns,
  rows,
  emptyMessage,
  isVirtualised = false,
  className,
  ...props
}: DataTableProps<T>): ReactNode {
  const density = useDensity();
  const rowHeight = SIZE_TOKENS['h-row']?.[density === 'touch' ? 'touch' : 'compact'] ?? 28;

  const table = (
    <Table
      {...props}
      aria-label={label}
      // The grid is the single tab stop, so it is a focusable control and must
      // show focus like any other (§7.3, §11.1).
      className={clsx('w-full border-separate border-spacing-0', focusRing)}
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
              'text-footnote font-body-medium text-fg-secondary',
              column.align === 'end' ? 'text-end' : 'text-start',
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
            id={row.id}
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
      <ResizableTableContainer className="max-h-full w-full overflow-auto">
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
 */
export function actionsColumnWidth(count: number, density: Density = 'comfortable'): number {
  const control = SIZE_TOKENS['h-control']?.[density] ?? 32;
  const gap = SIZE_TOKENS['gap-md']?.[density] ?? 16;
  const padding = SIZE_TOKENS['pad-md']?.compact ?? 8;
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
