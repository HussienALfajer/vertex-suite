import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import {
  Button as AriaButton,
  Collection,
  Tree,
  TreeItem,
  TreeItemContent,
  type Key,
  type TreeProps,
} from 'react-aria-components';

import { DensityScope } from '../providers/DensityScope.js';
import { useTranslator } from '../providers/context.js';
import { EmptyState } from './EmptyState.js';
import { focusRing } from './styles.js';

/**
 * One node and everything under it.
 *
 * The shape is the caller's own record wrapped rather than extended, so that a
 * domain record with no room for a `children` field — and none of them have
 * one, because a tree is an arrangement of records and not a field on one —
 * reaches here without being copied into a second vocabulary.
 */
export interface TreeNode<T> {
  readonly value: T;
  readonly children: readonly TreeNode<T>[];
}

/**
 * What of React Aria's own tree reaches a caller.
 *
 * A list of what is offered rather than of what is withheld, which is the
 * shorter and the more honest of the two: React Aria's tree also carries
 * selection, drag and drop, and a render function of its own, and none of them
 * is drawn here — a prop that type-checks and then does nothing on screen is
 * worse than one that is absent. Each arrives with the screen that needs it
 * (§10), with the markup that makes it visible.
 */
type Expansion<T> = Pick<
  TreeProps<TreeNode<T>>,
  'expandedKeys' | 'defaultExpandedKeys' | 'onExpandedChange' | 'disabledKeys'
>;

export interface TreeViewProps<T> extends Expansion<T> {
  /** What the tree is, for somebody listening rather than looking. */
  readonly label: string;
  readonly nodes: readonly TreeNode<T>[];
  /** What identifies a node. Whatever a caller expands or collapses is named by this. */
  readonly nodeKey: (value: T) => Key;
  /**
   * The node in one string, for the type-ahead React Aria gives every
   * collection and for whoever is listening rather than looking. Required,
   * because what `render` draws is markup and a screen reader needs the words.
   */
  readonly textValue: (value: T) => string;
  /** What the row shows. */
  readonly render: (value: T) => ReactNode;
  /** What may be done to the row, drawn at its end. */
  readonly actions?: (value: T) => ReactNode;
  readonly emptyMessage: string;
  readonly className?: string;
}

/**
 * How far one level indents.
 *
 * Measured rather than chosen: at 1.25rem a chart of accounts three deep read
 * as a flat list of codes with a ragged edge, because the step was smaller than
 * the width of the code sitting in front of every name.
 */
const INDENT_REM = 1.75;

/**
 * A hierarchy, read and operated as one.
 *
 * **It has one tab stop, not one per account.** React Aria's tree uses a
 * roving `tabindex`: `Tab` enters and leaves, arrows move inside, and `←`/`→`
 * collapse and expand — mirrored for RTL from the locale, which is the whole
 * reason this is built on React Aria rather than on nested lists (§11.1).
 *
 * **Indentation is drawn from the level React Aria reports**, not from a depth
 * the caller counts. The two can disagree the moment a subtree is filtered, and
 * the one that is right is the one the accessibility tree is already announcing
 * — `aria-level` and the padding then say the same thing.
 *
 * **`compact` inside, like `DataTable`.** A chart of accounts is a list
 * somebody reads in full, and rows per screen is what makes that possible
 * (§6.1) — except on a touch surface, where `DensityScope` refuses to lower it
 * (§6.3).
 *
 * There is no selection, and no drag. A tree that a screen only reads and
 * operates row by row needs neither, and an API built for a screen that has not
 * asked for it is an API discovered to be wrong at the second one (§10).
 */
export function TreeView<T>({
  label,
  nodes,
  nodeKey,
  textValue,
  render,
  actions,
  emptyMessage,
  className,
  ...props
}: TreeViewProps<T>): ReactNode {
  const translator = useTranslator();

  const row = (node: TreeNode<T>): ReactNode => (
    <TreeItem
      id={nodeKey(node.value)}
      textValue={textValue(node.value)}
      className={clsx(
        // §11.3: the row is not itself an action — only the controls in it
        // are — so it keeps the arrow cursor.
        'group border-line flex cursor-default items-center gap-[var(--vx-gap-sm)] border-b',
        'min-h-[var(--vx-h-row)] pe-[var(--vx-pad-md)] outline-none',
        'text-body text-fg',
        'data-[hovered]:bg-fill-ghost-hover',
        focusRing,
      )}
    >
      <TreeItemContent>
        {({ hasChildItems, isExpanded, level }) => (
          <>
            {/* The indent is padding on a fixed-width leader rather than on the
                row, so that the row's hover and focus ring still run the whole
                width of the tree — an indented row whose highlight starts at
                its own text reads as a different row each level down. */}
            <div
              className="flex shrink-0 items-center justify-center"
              style={{
                paddingInlineStart: `${String((level - 1) * INDENT_REM)}rem`,
              }}
            >
              {hasChildItems ? (
                <AriaButton
                  slot="chevron"
                  aria-label={translator.format(isExpanded ? 'tree.collapse' : 'tree.expand')}
                  className={clsx(
                    'flex size-[var(--vx-h-control)] shrink-0 cursor-pointer items-center justify-center',
                    'text-fg-secondary rounded outline-none',
                    'data-[hovered]:bg-fill-ghost-hover data-[hovered]:text-fg',
                    focusRing,
                  )}
                >
                  <ChevronIcon isExpanded={isExpanded} />
                </AriaButton>
              ) : (
                // A leaf keeps the chevron's room. Without it every leaf's text
                // starts one control-width nearer the edge than its siblings
                // with children, and the level stops reading as a level.
                <span aria-hidden="true" className="size-[var(--vx-h-control)] shrink-0" />
              )}
            </div>

            <div className="flex min-w-0 grow items-center gap-[var(--vx-gap-sm)] py-[var(--vx-pad-xs)]">
              {render(node.value)}
            </div>

            {actions === undefined ? null : (
              // The actions are `comfortable` inside a `compact` tree, for the
              // reason `TableRowActions` gives: the density is raised for rows
              // per screen, which is a reading decision, and these are
              // controls.
              <DensityScope
                value="comfortable"
                className="flex shrink-0 items-center justify-end gap-[var(--vx-gap-md)]"
              >
                {actions(node.value)}
              </DensityScope>
            )}
          </>
        )}
      </TreeItemContent>

      {/* Always rendered, empty or not: it is what tells React Aria whether
          this node has children, which is what decides the chevron and what
          `←`/`→` do on the row. */}
      <Collection items={node.children}>{row}</Collection>
    </TreeItem>
  );

  return (
    <DensityScope value="compact" className={clsx('w-full', className)}>
      <Tree
        {...props}
        aria-label={label}
        items={nodes}
        renderEmptyState={() => <EmptyState message={emptyMessage} />}
        className={clsx('w-full outline-none', focusRing)}
      >
        {row}
      </Tree>
    </DensityScope>
  );
}

/** The disclosure mark, rotated by what it discloses rather than swapped for a second glyph. */
function ChevronIcon({ isExpanded }: { readonly isExpanded: boolean }): ReactNode {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={clsx(
        'size-[var(--vx-icon)] fill-none stroke-current',
        'transition-transform duration-[var(--vx-dur-snap)] ease-out',
        // Collapsed points along the reading direction and expanded points
        // down, in both directions: the glyph is drawn pointing down and is
        // turned a quarter, the way the text itself runs. `rtl:` is the one
        // place a physical rotation is correct, because a rotation has no
        // logical form at all.
        isExpanded ? 'rotate-0' : 'rotate-90 rtl:-rotate-90',
      )}
      strokeWidth="1.5"
    >
      <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
