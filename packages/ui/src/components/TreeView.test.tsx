import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Translator } from '@vertex/i18n';

import { VertexProvider } from '../providers/VertexProvider.js';
import { IconButton } from './Button.js';
import { TreeView, type TreeNode, type TreeViewProps } from './TreeView.js';

afterEach(cleanup);

const translator = new Translator({
  locale: 'ar',
  catalogue: {
    'tree.expand': 'فتح',
    'tree.collapse': 'طيّ',
  },
});

interface Account {
  readonly id: string;
  readonly name: string;
}

const node = (id: string, name: string, children: TreeNode<Account>[] = []): TreeNode<Account> => ({
  value: { id, name },
  children,
});

/** Assets over cash over one till, and a second root beside them with nothing under it. */
const CHART: readonly TreeNode<Account>[] = [
  node('1000', 'الأصول', [node('1100', 'النقد والبنوك', [node('1101', 'صندوق الليرة')])]),
  node('2000', 'الخصوم'),
];

function wrap(children: ReactNode): void {
  render(
    <VertexProvider translator={translator} locale="ar" root={null}>
      {children}
    </VertexProvider>,
  );
}

function chart(extra: Partial<TreeViewProps<Account>> = {}): ReactNode {
  return (
    <TreeView<Account>
      label="شجرة الحسابات"
      nodes={CHART}
      nodeKey={(account) => account.id}
      textValue={(account) => account.name}
      render={(account) => <span>{account.name}</span>}
      emptyMessage="لا حسابات"
      {...extra}
    />
  );
}

const rowNamed = (name: RegExp): HTMLElement => screen.getByRole('row', { name });

describe('<TreeView>', () => {
  it('says how deep every row is, so a reader who cannot see the indent is told', () => {
    // The indent is a picture of the hierarchy; `aria-level` is the statement
    // of it. A tree that draws one without saying the other is a tree only one
    // kind of reader can follow.
    wrap(chart({ defaultExpandedKeys: ['1000', '1100'] }));

    expect(rowNamed(/الأصول/).getAttribute('aria-level')).toBe('1');
    expect(rowNamed(/النقد والبنوك/).getAttribute('aria-level')).toBe('2');
    expect(rowNamed(/صندوق الليرة/).getAttribute('aria-level')).toBe('3');
  });

  it('draws the indent from the level it announces, so the two cannot disagree', () => {
    // The picture and the statement of the hierarchy are one value. A depth
    // the component counted itself would be free to drift from `aria-level`
    // the moment a subtree is filtered — which is exactly what the chart of
    // accounts does whenever somebody searches it.
    wrap(chart({ defaultExpandedKeys: ['1000', '1100'] }));

    // Read off the element that carries it rather than off the row: the indent
    // is padding on the leader in front of the text, so that a row's hover and
    // focus ring still run the whole width of the tree. Compared as the lengths
    // they are and never as numbers — what is claimed is that each level is
    // stepped from the one above, and the size of the step is the component's.
    const indentOf = (name: RegExp): string => {
      const leader = rowNamed(name).querySelector('[style*="padding-inline-start"]');
      if (leader === null) throw new Error('The row carries no indent.');
      return (leader as HTMLElement).style.getPropertyValue('padding-inline-start');
    };

    const [first, second, third] = [/الأصول/, /النقد والبنوك/, /صندوق الليرة/].map(indentOf);
    expect(first).toBe('0rem');
    expect(second).not.toBe(first);
    expect(third).not.toBe(second);
  });

  it('leaves what is collapsed out of the page entirely, not merely hidden', () => {
    wrap(chart());

    expect(rowNamed(/الأصول/)).toBeDefined();
    // Hidden-but-present would put every account of a shop's chart into the
    // type-ahead and the measurements of a tree that is showing two rows.
    expect(screen.queryByRole('row', { name: /النقد والبنوك/ })).toBeNull();
  });

  it('is one tab stop, with the arrows moving inside it — §11.1', async () => {
    const user = userEvent.setup();
    wrap(chart({ defaultExpandedKeys: ['1000'] }));

    await user.tab();
    expect(document.activeElement?.getAttribute('aria-level')).toBe('1');

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain('النقد والبنوك');
  });

  it('opens and closes a branch from the keyboard, mirrored for an RTL reader', async () => {
    // `→` collapses and `←` expands where the document runs right to left,
    // which is React Aria reading the locale rather than this component
    // carrying a flag beside it (§9).
    const user = userEvent.setup();
    wrap(chart({ defaultExpandedKeys: ['1000'] }));

    await user.tab();
    expect(rowNamed(/النقد والبنوك/)).toBeDefined();

    await user.keyboard('{ArrowRight}');
    expect(screen.queryByRole('row', { name: /النقد والبنوك/ })).toBeNull();

    await user.keyboard('{ArrowLeft}');
    expect(rowNamed(/النقد والبنوك/)).toBeDefined();
  });

  it('names the disclosure control by what pressing it would do, and by which row', async () => {
    // React Aria points the button at its own row as well as at the word this
    // catalogue gives, so a page of them is not thirty controls all called
    // "فتح" — the name is the act and the account it acts on.
    const user = userEvent.setup();
    wrap(chart());

    await user.click(screen.getByRole('button', { name: 'فتح الأصول' }));

    expect(rowNamed(/النقد والبنوك/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'طيّ الأصول' })).toBeDefined();
  });

  it('gives a row with nothing under it no disclosure control at all', () => {
    wrap(chart());

    // Two roots, and only one of them has anything under it.
    expect(screen.queryByRole('button', { name: /الأصول/ })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /الخصوم/ })).toBeNull();
  });

  it('carries a row’s own actions, reachable without a pointer', async () => {
    // §11.1: a control a pointer can reach and a keyboard cannot is a defect.
    // In a grid the row is the tab stop and the arrow that runs **with** the
    // text — `←` where the document is RTL — steps into what the row carries.
    const user = userEvent.setup();
    wrap(
      chart({
        defaultExpandedKeys: ['1000'],
        actions: (account) => (
          <IconButton aria-label={`سحب ${account.name}`}>
            <svg viewBox="0 0 20 20" aria-hidden="true" />
          </IconButton>
        ),
      }),
    );

    await user.tab();
    expect(document.activeElement?.getAttribute('aria-level')).toBe('1');

    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('سحب الأصول');
  });

  it('says what it would have shown when there is nothing to show', () => {
    wrap(chart({ nodes: [] }));

    expect(screen.getByText('لا حسابات')).toBeDefined();
  });
});
