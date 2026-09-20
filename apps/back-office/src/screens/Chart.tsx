import { useMemo, useState, type ReactNode } from 'react';

import type { Result } from '@vertex/kernel';
import {
  ACCOUNT_KINDS,
  type Account,
  type AccountKind,
  type AccountNode,
  type ChartRefusal,
} from '@vertex/fin/contract';
import {
  Badge,
  Banner,
  Button,
  Code,
  ConfirmationDialog,
  Dialog,
  PageHeader,
  Panel,
  Select,
  Switch,
  TableRowAction,
  TextInput,
  TreeView,
  useAttempt,
  useToast,
  useTranslator,
  type SelectOption,
  type TreeNode,
} from '@vertex/ui';

import { useChart } from '../chart.js';
import { useDeliveryMessage } from '../organisation.js';
import type { ChartOfRecord } from '../system.js';
import { flatten, nameOfAccount } from './books.js';
import { MoveIcon, RenameIcon, RestoreIcon, StatusBadge, WithdrawIcon } from './structure.js';

/** What a person has opened or closed, and the search they did it under. */
interface Expansion {
  readonly forQuery: string;
  readonly keys: ReadonlySet<string>;
}

/**
 * `FIN-01`: the shop's chart of accounts, editable as a tree.
 *
 * It is a tree and not an indented table, because that is what the feature
 * says and because the difference is operational: a shop's chart runs to
 * hundreds of accounts, a group is collapsed to get past it, and `aria-level`
 * says the depth to somebody who cannot see the indent. `TreeView` arrived in
 * this pull request for exactly this screen (`design-system.md` §15).
 *
 * The chart is **seeded with the shop** (`SYS-03`), so unlike `Branches` there
 * is no first-run emptiness to explain: an accountant who opens this finds the
 * retail chart already here and edits it.
 *
 * **What cannot be done here is as deliberate as what can.** There is no
 * delete — an account is withdrawn from use, because every line ever posted
 * names it — and no way to change a code, because every statement ever printed
 * carries it. Both are `ChartAdministration`'s own; this screen offers neither
 * rather than offering a control the domain always refuses.
 */
export function Chart(): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { tree, isLoading, unreachable, reload, run } = useChart();
  const messageFor = useDeliveryMessage();

  const [query, setQuery] = useState('');
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);
  const [opened, setOpened] = useState<Expansion | null>(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<Account | null>(null);
  const [moving, setMoving] = useState<Account | null>(null);
  const [withdrawing, setWithdrawing] = useState<Account | null>(null);
  const [restoring, setRestoring] = useState<Account | null>(null);

  const shown = useMemo(
    () => prune(tree, (account) => keeps(translator, account, query, includeWithdrawn)),
    [tree, translator, query, includeWithdrawn],
  );

  /**
   * Which groups are open.
   *
   * Two rules in one value. With nothing searched for, the roots — the five
   * kinds, so a chart opens showing what it is made of rather than five closed
   * words. With something searched for, every group holding a hit as well,
   * because a match nobody can see is a search that answered nothing.
   *
   * And then whatever the person has opened or closed **for this search**,
   * which is why what is remembered carries the query it was chosen under. A
   * set remembered across a change of query would put the person's last
   * collapse back on a different tree, and — the way this once read — a
   * forced re-expansion of every group holding a hit would reopen, on the very
   * next render, whatever they had just closed. A new query is a new tree, so
   * it starts from what the tree itself says.
   *
   * Derived rather than pushed into state by an effect: the roots arrive with
   * the read, and an effect that seeded them would run a render after the chart
   * was already on screen closed.
   */
  const expandedKeys = useMemo<ReadonlySet<string>>(() => {
    if (opened !== null && opened.forQuery === query) return opened.keys;
    const roots = shown.map((node) => node.value.id);
    return new Set(query.trim() === '' ? roots : [...roots, ...groupsIn(shown)]);
  }, [opened, shown, query]);

  async function command(
    work: (of: ChartOfRecord) => Promise<Result<Account, ChartRefusal>>,
    said: (name: string) => string,
    subject: Account,
  ): Promise<void> {
    const delivery = await run(work);
    const message = messageFor(delivery);
    toast.show(
      message ?? said(nameOfAccount(translator, subject)),
      message === null ? { tone: 'success' } : { tone: 'danger' },
    );
  }

  return (
    <>
      <PageHeader
        title={translator.format('chart.title')}
        description={translator.format('chart.description')}
        actions={
          <Button
            tone="primary"
            onPress={() => {
              setAdding(true);
            }}
          >
            {translator.format('chart.add')}
          </Button>
        }
      />

      {unreachable ? (
        <Banner
          tone="warning"
          title={translator.format('data.unreachable')}
          actions={<Button onPress={reload}>{translator.format('action.retry')}</Button>}
        >
          {translator.format('data.unreachable.explanation')}
        </Banner>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-[var(--vx-gap-md)]">
        <TextInput
          label={translator.format('chart.search')}
          value={query}
          onChange={setQuery}
          className="w-[22rem] max-w-full"
        />
        <Switch isSelected={includeWithdrawn} onChange={setIncludeWithdrawn}>
          {translator.format('listing.includeWithdrawn')}
        </Switch>
      </div>

      <Panel flush>
        <TreeView<Account>
          label={translator.format('chart.tree')}
          nodes={shown}
          nodeKey={(account) => account.id}
          textValue={(account) => `${account.code} ${nameOfAccount(translator, account)}`}
          expandedKeys={expandedKeys}
          onExpandedChange={(keys) => {
            setOpened({
              forQuery: query,
              keys: new Set([...keys].filter((key) => typeof key === 'string')),
            });
          }}
          emptyMessage={translator.format(
            isLoading ? 'data.loading' : query.trim() === '' ? 'chart.empty' : 'listing.noMatch',
          )}
          render={(account) => <AccountRow account={account} />}
          actions={(account) => (
            <>
              <TableRowAction
                aria-label={translator.format('chart.rename.action')}
                onPress={() => {
                  setRenaming(account);
                }}
              >
                <RenameIcon />
              </TableRowAction>
              <TableRowAction
                aria-label={translator.format('chart.move.action')}
                onPress={() => {
                  setMoving(account);
                }}
              >
                <MoveIcon />
              </TableRowAction>
              {/* A reserved account is offered neither control: `FIN-01` says it
                  cannot be taken out of use, the badge on the row says so, and a
                  button beside that badge that always ends in a refusal is the
                  screen contradicting itself. */}
              {account.reserved !== null ? null : account.active ? (
                <TableRowAction
                  aria-label={translator.format('chart.withdraw.action')}
                  onPress={() => {
                    setWithdrawing(account);
                  }}
                >
                  <WithdrawIcon />
                </TableRowAction>
              ) : (
                <TableRowAction
                  aria-label={translator.format('chart.restore.action')}
                  onPress={() => {
                    setRestoring(account);
                  }}
                >
                  <RestoreIcon />
                </TableRowAction>
              )}
            </>
          )}
        />
      </Panel>

      <AccountDialog
        isOpen={adding}
        onOpenChange={setAdding}
        onSubmit={async (fields) => {
          const delivery = await run((of) => of.add(fields));
          const message = messageFor(delivery);
          if (message === null) {
            toast.show(translator.format('chart.added', { name: fields.name }), {
              tone: 'success',
            });
          }
          return message;
        }}
      />

      <RenameDialog
        subject={renaming}
        onClose={() => {
          setRenaming(null);
        }}
        onSubmit={async (name) => {
          if (renaming === null) return null;
          const delivery = await run((of) => of.rename(renaming.id, name));
          const message = messageFor(delivery);
          if (message === null) {
            toast.show(translator.format('chart.renamed', { name }), { tone: 'success' });
          }
          return message;
        }}
      />

      <MoveDialog
        subject={moving}
        onClose={() => {
          setMoving(null);
        }}
        onSubmit={async (parent) => {
          if (moving === null) return null;
          const delivery = await run((of) => of.move(moving.id, parent));
          const message = messageFor(delivery);
          if (message === null) {
            toast.show(
              translator.format('chart.moved', { name: nameOfAccount(translator, moving) }),
              { tone: 'success' },
            );
          }
          return message;
        }}
      />

      <ConfirmationDialog
        title={translator.format('chart.withdraw.title')}
        message={translator.format('chart.withdraw.message', {
          name: withdrawing === null ? '' : nameOfAccount(translator, withdrawing),
        })}
        confirmLabel={translator.format('chart.withdraw.action')}
        tone="danger"
        isOpen={withdrawing !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setWithdrawing(null);
        }}
        onConfirm={() => {
          if (withdrawing === null) return;
          const taken = withdrawing;
          void command(
            (of) => of.withdraw(taken.id),
            (name) => translator.format('chart.withdrawn', { name }),
            taken,
          );
        }}
      />

      <ConfirmationDialog
        title={translator.format('chart.restore.title')}
        message={translator.format('chart.restore.message', {
          name: restoring === null ? '' : nameOfAccount(translator, restoring),
        })}
        confirmLabel={translator.format('chart.restore.action')}
        isOpen={restoring !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRestoring(null);
        }}
        onConfirm={() => {
          if (restoring === null) return;
          const taken = restoring;
          void command(
            (of) => of.restore(taken.id),
            (name) => translator.format('chart.restored', { name }),
            taken,
          );
        }}
      />
    </>
  );
}

/**
 * One row: the code, the name, and what is true of the account.
 *
 * The code is a `Code` and therefore an `ltr` island (§9) — it is machine text
 * that a statement prints and an accountant reads back — and a cash account
 * carries its currency beside it, since `FIN-01` keeps one per currency and
 * they all share the one seeded name.
 */
function AccountRow({ account }: { readonly account: Account }): ReactNode {
  const translator = useTranslator();
  return (
    <>
      <Code className="text-fg-secondary shrink-0">{account.code}</Code>
      <span className="truncate">{nameOfAccount(translator, account)}</span>
      {account.currency === null ? null : (
        <Code className="text-fg-muted shrink-0">{account.currency}</Code>
      )}
      {account.reserved === null ? null : (
        <Badge tone="info">
          {translator.format('chart.reserved', {
            purpose: translator.format(`account.reserved.${account.reserved}`),
          })}
        </Badge>
      )}
      {account.active ? null : <StatusBadge isActive={false} />}
    </>
  );
}

/** Whether a row survives the search field and the withdrawn switch. */
function keeps(
  translator: ReturnType<typeof useTranslator>,
  account: Account,
  query: string,
  includeWithdrawn: boolean,
): boolean {
  if (!includeWithdrawn && !account.active) return false;
  // Folded the way `matchesQuery` folds a name: Arabic is written with
  // combining marks that two keyboards encode differently.
  const fold = (value: string): string => value.normalize('NFC').trim().toLowerCase();
  const wanted = fold(query);
  if (wanted === '') return true;
  return (
    fold(account.code).includes(wanted) || fold(nameOfAccount(translator, account)).includes(wanted)
  );
}

/**
 * The tree with everything the filter rejects taken out — **except an ancestor
 * of something it kept**.
 *
 * A group that does not itself match is still the only way to reach a child
 * that does, so it stays and is opened. Dropping it would be a search that
 * answers "nothing" while the account is sitting one level down, and a
 * withdrawn group whose children are in use is exactly the shape `FIN` allows
 * on the way out of service.
 */
function prune(
  nodes: readonly AccountNode[],
  keep: (account: Account) => boolean,
): readonly TreeNode<Account>[] {
  const survivors: TreeNode<Account>[] = [];
  for (const node of nodes) {
    const children = prune(node.children, keep);
    if (children.length === 0 && !keep(node.account)) continue;
    survivors.push({ value: node.account, children });
  }
  return survivors;
}

/** Every node that has something under it, which is what a search opens. */
function groupsIn(nodes: readonly TreeNode<Account>[]): readonly string[] {
  return nodes.flatMap((node) =>
    node.children.length === 0 ? [] : [node.value.id, ...groupsIn(node.children)],
  );
}

/** One account, by the identifier a chooser handed back. */
function accountIn(nodes: readonly AccountNode[], id: string): Account | null {
  return flatten(nodes).find((account) => account.id === id) ?? null;
}

function kindOptions(translator: ReturnType<typeof useTranslator>): readonly SelectOption[] {
  return ACCOUNT_KINDS.map((kind) => ({
    id: kind,
    label: translator.format(`account.kind.${kind}`),
  }));
}

interface NewAccountFields {
  readonly code: string;
  readonly name: string;
  readonly kind: AccountKind;
  readonly parent: Account['id'] | null;
}

interface AccountDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onSubmit: (fields: NewAccountFields) => Promise<string | null>;
}

/**
 * Adding an account.
 *
 * The kind is asked even when a parent is chosen, rather than inherited from
 * it, because that is what `NewAccount` states and why: a definition with no
 * kind would be filed under whatever the parent happened to be, and this is
 * the one field about an account that can never be corrected afterwards.
 */
function AccountDialog({ isOpen, onOpenChange, onSubmit }: AccountDialogProps): ReactNode {
  const translator = useTranslator();
  const { tree } = useChart();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('asset');
  const [parent, setParent] = useState(ROOT);
  const [missing, setMissing] = useState({ code: false, name: false });

  const {
    isWorking,
    refused,
    formRef,
    reportInvalid,
    attempt: attemptWith,
  } = useAttempt(isOpen, () => {
    setCode('');
    setName('');
    setKind('asset');
    setParent(ROOT);
    setMissing({ code: false, name: false });
  });

  const parents = useMemo(
    () => parentOptions(translator, tree, kind, null),
    [translator, tree, kind],
  );

  async function attempt(): Promise<void> {
    if (isWorking) return;

    const blank = { code: code.trim() === '', name: name.trim() === '' };
    setMissing(blank);
    if (blank.code || blank.name) {
      reportInvalid();
      return;
    }

    await attemptWith(async () => {
      const message = await onSubmit({
        code: code.trim(),
        name: name.trim(),
        kind,
        parent: parent === ROOT ? null : (accountIn(tree, parent)?.id ?? null),
      });
      if (message === null) onOpenChange(false);
      return message;
    });
  }

  return (
    <Dialog
      title={translator.format('chart.new.title')}
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      footer={
        <>
          <Button
            tone="secondary"
            onPress={() => {
              onOpenChange(false);
            }}
          >
            {translator.format('action.cancel')}
          </Button>
          <Button tone="primary" isDisabled={isWorking} onPress={() => void attempt()}>
            {translator.format('chart.new.submit')}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void attempt();
        }}
        className="flex flex-col gap-[var(--vx-gap-md)]"
      >
        {refused === null ? null : <Banner tone="danger">{refused}</Banner>}
        <TextInput
          label={translator.format('chart.new.code')}
          description={translator.format('chart.new.code.description')}
          value={code}
          onChange={(next) => {
            setCode(next);
            setMissing((was) => ({ ...was, code: false }));
          }}
          isMachineText
          autoFocus
          isRequired
          {...(missing.code ? { errorMessage: translator.format('chart.new.code.required') } : {})}
        />
        <TextInput
          label={translator.format('chart.new.name')}
          value={name}
          onChange={(next) => {
            setName(next);
            setMissing((was) => ({ ...was, name: false }));
          }}
          isRequired
          {...(missing.name ? { errorMessage: translator.format('chart.new.name.required') } : {})}
        />
        <Select
          label={translator.format('chart.new.kind')}
          description={translator.format('chart.new.kind.description')}
          options={kindOptions(translator)}
          value={kind}
          onChange={(key) => {
            const next = String(key);
            const chosen = ACCOUNT_KINDS.find((one) => one === next);
            if (chosen === undefined) return;
            setKind(chosen);
            // A parent of the old kind is no parent for the new one, and
            // `FIN` would refuse it — so it goes rather than waiting to be
            // refused in a sentence about a field nobody can see any more.
            setParent(ROOT);
          }}
        />
        <Select
          label={translator.format('chart.new.parent')}
          description={translator.format('chart.new.parent.description')}
          options={parents}
          value={parent}
          onChange={(key) => {
            setParent(String(key));
          }}
        />
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}

interface RenameDialogProps {
  readonly subject: Account | null;
  readonly onClose: () => void;
  readonly onSubmit: (name: string) => Promise<string | null>;
}

/**
 * Renaming, which is the only part of an account a person edits in place.
 *
 * The code is shown rather than offered, the way `Numbering.tsx` shows a
 * series' scope: it is the account's identity in every statement ever printed
 * and `ChartAdministration` has no command to change it.
 */
function RenameDialog({ subject, onClose, onSubmit }: RenameDialogProps): ReactNode {
  const translator = useTranslator();
  const [name, setName] = useState('');
  const [isMissing, setIsMissing] = useState(false);

  const {
    isWorking,
    refused,
    formRef,
    reportInvalid,
    attempt: attemptWith,
  } = useAttempt(subject, () => {
    setName(subject === null ? '' : nameOfAccount(translator, subject));
    setIsMissing(false);
  });

  async function attempt(): Promise<void> {
    if (isWorking || subject === null) return;
    if (name.trim() === '') {
      setIsMissing(true);
      reportInvalid();
      return;
    }
    await attemptWith(async () => {
      const message = await onSubmit(name.trim());
      if (message === null) onClose();
      return message;
    });
  }

  return (
    <Dialog
      title={translator.format('chart.rename.title')}
      isOpen={subject !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      footer={
        <>
          <Button tone="secondary" onPress={onClose}>
            {translator.format('action.cancel')}
          </Button>
          <Button tone="primary" isDisabled={isWorking} onPress={() => void attempt()}>
            {translator.format('chart.rename.submit')}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void attempt();
        }}
        className="flex flex-col gap-[var(--vx-gap-md)]"
      >
        {refused === null ? null : <Banner tone="danger">{refused}</Banner>}
        <p className="text-body text-fg-secondary">
          <Code>{subject?.code ?? ''}</Code>
        </p>
        <TextInput
          label={translator.format('chart.new.name')}
          value={name}
          onChange={(next) => {
            setName(next);
            setIsMissing(false);
          }}
          autoFocus
          isRequired
          {...(isMissing ? { errorMessage: translator.format('chart.new.name.required') } : {})}
        />
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}

/** Stands for "no parent — a root of its kind". No identifier can collide with it. */
const ROOT = '*';

/**
 * The accounts one may go under: of the same kind, in use, not reserved, and
 * neither the account itself nor anything under it.
 *
 * Every one of those is a rule `FIN` enforces (`parentFor`, `moveAccount`), and
 * offering a destination it would refuse is offering somebody a choice that
 * ends in a sentence. The module still judges what arrives — a chart can change
 * between the list being built and the command being sent.
 */
function parentOptions(
  translator: ReturnType<typeof useTranslator>,
  tree: readonly AccountNode[],
  kind: AccountKind,
  moving: Account | null,
): readonly SelectOption[] {
  const forbidden = moving === null ? new Set<string>() : new Set(descendantsOf(tree, moving.id));
  const eligible = flatten(tree)
    .filter(
      (account) =>
        account.kind === kind &&
        account.active &&
        account.reserved === null &&
        !forbidden.has(account.id),
    )
    .map((account) => ({
      id: account.id,
      label: `${account.code} — ${nameOfAccount(translator, account)}`,
    }));
  return [{ id: ROOT, label: translator.format('chart.new.parent.root') }, ...eligible];
}

/** An account and everything under it: where it may never be moved (`fin.account-cycle`). */
function descendantsOf(nodes: readonly AccountNode[], id: string): readonly string[] {
  for (const node of nodes) {
    if (node.account.id === id) {
      const under = (subtree: readonly AccountNode[]): string[] =>
        subtree.flatMap((one) => [one.account.id, ...under(one.children)]);
      return [id, ...under(node.children)];
    }
    const found = descendantsOf(node.children, id);
    if (found.length > 0) return found;
  }
  return [];
}

interface MoveDialogProps {
  readonly subject: Account | null;
  readonly onClose: () => void;
  readonly onSubmit: (parent: Account['id'] | null) => Promise<string | null>;
}

/**
 * Moving an account, with everything under it, under another parent of its own
 * kind — or out to the roots.
 *
 * A dialog with a chooser rather than a drag. A drag is a pointer-only
 * interaction, and §11.1 makes a control a keyboard cannot reach a defect
 * rather than a style; a chart of three hundred accounts is also a long way to
 * drag one.
 */
function MoveDialog({ subject, onClose, onSubmit }: MoveDialogProps): ReactNode {
  const translator = useTranslator();
  const { tree } = useChart();
  const [parent, setParent] = useState(ROOT);

  const options = useMemo(
    () => (subject === null ? [] : parentOptions(translator, tree, subject.kind, subject)),
    [translator, tree, subject],
  );

  const {
    isWorking,
    refused,
    formRef,
    attempt: attemptWith,
  } = useAttempt(subject, () => {
    // Where it already is, but only while that is somewhere it could be put
    // again. An account can sit under a parent this list does not offer — a
    // group withdrawn from use keeps the children that were withdrawn with it
    // — and a chooser whose value is none of its options shows nothing at all,
    // which reads as a dialog that failed to load rather than as a move
    // waiting for a destination.
    const where = subject?.parent ?? ROOT;
    setParent(options.some((option) => option.id === where) ? where : ROOT);
  });

  async function attempt(): Promise<void> {
    if (isWorking || subject === null) return;
    await attemptWith(async () => {
      const message = await onSubmit(
        parent === ROOT ? null : (accountIn(tree, parent)?.id ?? null),
      );
      if (message === null) onClose();
      return message;
    });
  }

  return (
    <Dialog
      title={translator.format('chart.move.title')}
      isOpen={subject !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
      footer={
        <>
          <Button tone="secondary" onPress={onClose}>
            {translator.format('action.cancel')}
          </Button>
          <Button tone="primary" isDisabled={isWorking} onPress={() => void attempt()}>
            {translator.format('chart.move.submit')}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          void attempt();
        }}
        className="flex flex-col gap-[var(--vx-gap-md)]"
      >
        {refused === null ? null : <Banner tone="danger">{refused}</Banner>}
        <p className="text-body text-fg-secondary">
          <Code>{subject?.code ?? ''}</Code>{' '}
          {subject === null ? '' : nameOfAccount(translator, subject)}
        </p>
        <Select
          label={translator.format('chart.new.parent')}
          description={translator.format('chart.move.description')}
          options={options}
          value={parent}
          onChange={(key) => {
            setParent(String(key));
          }}
          autoFocus
        />
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
