import { useMemo, useState, type ReactNode } from 'react';

import { isOk, type Result } from '@vertex/kernel';
import type {
  AccountId,
  BalanceSheet,
  GeneralLedger,
  IncomeStatement,
  LedgerAccount,
  LedgerPosting,
  LedgerRequest,
  Statement,
  StatementLine,
  StatementRefusal,
  StatementRequest,
  StatementSection,
  TrialBalance,
  TrialBalanceRow,
} from '@vertex/fin/contract';
import {
  Banner,
  Code,
  Combobox,
  DataTable,
  DateInput,
  DateTime,
  PageHeader,
  Panel,
  Select,
  Tabs,
  useTranslator,
  type DataTableColumn,
  type TabDefinition,
} from '@vertex/ui';

import { useCalendar } from '../calendar.js';
import { messageForRefusal } from '../catalogue.js';
import { useCurrencies } from '../currencies.js';
import { useLedger } from '../ledger.js';
import { useLoaded, type Loaded } from '../organisation.js';
import {
  accountOptions,
  BalanceFigure,
  BranchFilter,
  EVERY_BRANCH,
  Figure,
  nameOfAccount,
  useBooksYear,
  useBranchName,
  useLeafAccounts,
  type Span,
} from './books.js';
import { ReadState } from './structure.js';

/**
 * `FIN-07`: the four ways the journal is read — a trial balance, an income
 * statement, a balance sheet and the general ledger detail — for any span of
 * days and in any currency the shop takes.
 *
 * **One request and four statements**, which is the contract's own shape: the
 * span, the branch and the presentation currency are asked once, above the
 * strip, and every tab is that same question answered a different way. Two
 * statements of one request are one statement read twice — the figure the
 * income statement ends on is exactly the balance sheet's `result` — and a
 * screen that let each tab carry its own filter would make that impossible to
 * see.
 *
 * **One statement is read at a time.** `Tabs` mounts only the panel that is
 * showing, so the read belongs to the panel rather than to this screen: none
 * of the four is a cache (`Statements`: a figure kept beside the ledger is a
 * figure free to disagree with it), and computing all four to show one would
 * be four walks of the journal for one page.
 *
 * **Nothing here decides what a figure comes to.** Every balance, every side
 * and every total is `FIN`'s; the translation into another currency is `FX`'s,
 * read once for the page. What this screen owns is the question and the layout
 * of the answer.
 */
export function Statements(): ReactNode {
  const translator = useTranslator();
  const { currencies, functional } = useCurrencies();
  const booksYear = useBooksYear();

  const [span, setSpan] = useState<Span>(booksYear);
  const [branch, setBranch] = useState<string>(EVERY_BRANCH);
  const [into, setInto] = useState<string | null>(null);
  const [board, setBoard] = useState<string>(EVERY_BRANCH);

  // The span the books are open over seeds the filter once, when the calendar
  // answers — see `Journal` for why this is adjusted while rendering.
  const [seeded, setSeeded] = useState(booksYear.from !== null);
  if (!seeded && booksYear.from !== null) {
    setSeeded(true);
    setSpan(booksYear);
  }

  const readable = useMemo(() => currencies.filter((one) => one.enabled), [currencies]);
  const presentation = into === null || into === functional?.code ? null : into;

  const asked = useMemo<Asked | null>(() => {
    if (span.from === null || span.to === null) return null;
    const request: StatementRequest = {
      from: span.from,
      to: span.to,
      ...(branch === EVERY_BRANCH
        ? {}
        : { branch: branch as NonNullable<StatementRequest['branch']> }),
      ...(presentation === null
        ? {}
        : {
            presentation: {
              into: presentation,
              ...(board === EVERY_BRANCH
                ? {}
                : { board: board as NonNullable<StatementRequest['branch']> }),
            },
          }),
    };
    return {
      key: `${span.from}|${span.to}|${branch}|${presentation ?? ''}|${board}`,
      request,
    };
  }, [span, branch, presentation, board]);

  const tabs: readonly TabDefinition[] = [
    {
      id: 'trial-balance',
      label: translator.format('statements.trialBalance'),
      content: <TrialBalanceView asked={asked} />,
    },
    {
      id: 'income-statement',
      label: translator.format('statements.incomeStatement'),
      content: <IncomeStatementView asked={asked} />,
    },
    {
      id: 'balance-sheet',
      label: translator.format('statements.balanceSheet'),
      content: <BalanceSheetView asked={asked} />,
    },
    {
      id: 'general-ledger',
      label: translator.format('statements.generalLedger'),
      content: <GeneralLedgerView asked={asked} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={translator.format('statements.title')}
        description={translator.format('statements.description')}
      />

      <div className="flex flex-wrap items-end gap-[var(--vx-gap-md)]">
        <DateInput
          label={translator.format('statements.from')}
          value={span.from}
          onChange={(from) => {
            setSpan((was) => ({ ...was, from }));
          }}
          {...(booksYear.from === null ? {} : { placeholder: booksYear.from })}
          className="w-[12rem]"
        />
        <DateInput
          label={translator.format('statements.to')}
          value={span.to}
          onChange={(to) => {
            setSpan((was) => ({ ...was, to }));
          }}
          {...(booksYear.to === null ? {} : { placeholder: booksYear.to })}
          className="w-[12rem]"
        />
        <BranchFilter
          label={translator.format('statements.branch')}
          allLabel={translator.format('statements.branch.all')}
          value={branch}
          onChange={setBranch}
          className="w-[14rem] max-w-full"
        />
        <Select
          label={translator.format('statements.presentation')}
          description={translator.format('statements.presentation.description')}
          options={readable.map((one) => ({ id: one.code, label: one.code }))}
          value={into ?? functional?.code ?? null}
          onChange={(key) => {
            setInto(String(key));
          }}
          className="w-[12rem]"
        />
        {/* Whose board translates the figures (`FX-03`). Only where anything is
            being translated: a statement in the currency the books are kept in
            went through no rate, so there is no board for it to have come from. */}
        {presentation === null ? null : (
          <BranchFilter
            label={translator.format('statements.board')}
            allLabel={translator.format('statements.board.default')}
            value={board}
            onChange={setBoard}
            className="w-[14rem] max-w-full"
          />
        )}
      </div>

      <Tabs label={translator.format('statements.tabs')} tabs={tabs} />
    </>
  );
}

/** One request, and the key the read for it is asked under. */
interface Asked {
  readonly key: string;
  readonly request: StatementRequest;
}

/**
 * What every statement says about itself: what it covers, what unit its
 * figures are in, and how they got there.
 *
 * Printed above the figures because a statement is printed, filed and read
 * again months later, and a page whose range lives only in the screen that
 * asked for it is a page nobody can check. The rate is stated whenever
 * anything was translated — **one** rate for the whole page, which is what
 * carries "debits equal credits" across the conversion.
 */
function StatementFrame({ statement }: { readonly statement: Statement }): ReactNode {
  const translator = useTranslator();
  const nameOfBranch = useBranchName();
  const { scope, currency, rate } = statement;

  return (
    <div className="border-line flex flex-wrap items-baseline gap-x-[var(--vx-gap-lg)] gap-y-[var(--vx-gap-xs)] border-b pb-[var(--vx-pad-md)]">
      <span className="text-body text-fg flex items-baseline gap-[var(--vx-gap-xs)]">
        <DateTime value={scope.from} />
        <span className="text-fg-muted">—</span>
        <DateTime value={scope.to} />
      </span>
      <span className="text-body text-fg-secondary">
        {scope.branch === null
          ? translator.format('statements.scope.allBranches')
          : nameOfBranch(scope.branch)}
      </span>
      <span className="text-body text-fg-secondary flex items-baseline gap-[var(--vx-gap-xs)]">
        {translator.format('statements.scope.currency')}
        <Code>{currency}</Code>
      </span>
      {rate === null ? null : (
        <span className="text-footnote text-fg-muted flex items-baseline gap-[var(--vx-gap-xs)]">
          {translator.format('statements.scope.rate', {
            currency: rate.currency,
            functional: rate.functional,
          })}
          <Code>{rate.rate}</Code>
          <DateTime value={rate.day} />
        </span>
      )}
    </div>
  );
}

/**
 * A statement, once it has answered — or the reason it could not.
 *
 * A refusal is rendered **in place of** the figures rather than beside them:
 * what a statement refuses is the request it was given (a span that ends
 * before it begins, a branch the tenant does not have, no rate today at the
 * board asked for), and a page of figures under a sentence saying the request
 * was rejected would be a page of figures from some other request.
 */
function Read<T>({
  loaded,
  children,
}: {
  readonly loaded: Loaded<Result<T, StatementRefusal>>;
  readonly children: (value: T) => ReactNode;
}): ReactNode {
  const translator = useTranslator();
  const answer = loaded.value;
  if (answer === null) return <ReadState loaded={loaded} />;
  if (!isOk(answer)) {
    return <Banner tone="danger">{messageForRefusal(translator, answer.error)}</Banner>;
  }
  return children(answer.value);
}

/**
 * The span has to be a span before anything can be asked about it — and while
 * the calendar that seeds it is still on its way, the page is loading rather
 * than waiting on a person.
 */
function NotYet(): ReactNode {
  const translator = useTranslator();
  const { isLoading } = useCalendar();
  return (
    <p className="text-body text-fg-muted">
      {translator.format(isLoading ? 'data.loading' : 'statements.needSpan')}
    </p>
  );
}

/**
 * `FIN-07`'s trial balance: every account with something to say over the span,
 * flat and in code order, and the proof that the books balance.
 *
 * Its whole point is the totals, which is why they are printed under the
 * table rather than folded into it: the debits equal the credits in each of
 * the three columns, and a reader checking a ledger against this is checking
 * exactly that.
 */
function TrialBalanceView({ asked }: { readonly asked: Asked | null }): ReactNode {
  const translator = useTranslator();
  const { statements } = useLedger();
  const loaded = useLoaded(asked === null ? null : `trial|${asked.key}`, () =>
    statements.trialBalance(request(asked)),
  );

  if (asked === null) return <NotYet />;

  const columns: readonly DataTableColumn<TrialBalanceRow>[] = [
    {
      id: 'account',
      header: translator.format('statements.column.account'),
      isRowHeader: true,
      render: (row) => <AccountCell account={row.account} />,
    },
    {
      id: 'opening',
      header: translator.format('statements.column.opening'),
      align: 'end',
      width: 220,
      render: (row) => <BalanceFigure balance={row.opening} />,
    },
    {
      id: 'debits',
      header: translator.format('entry.side.debit'),
      align: 'end',
      width: 200,
      render: (row) => <Figure amount={row.debits} />,
    },
    {
      id: 'credits',
      header: translator.format('entry.side.credit'),
      align: 'end',
      width: 200,
      render: (row) => <Figure amount={row.credits} />,
    },
    {
      id: 'closing',
      header: translator.format('statements.column.closing'),
      align: 'end',
      width: 220,
      render: (row) => <BalanceFigure balance={row.closing} />,
    },
  ];

  return (
    <Read<TrialBalance> loaded={loaded}>
      {(statement) => (
        <Panel>
          <StatementFrame statement={statement} />
          <DataTable<TrialBalanceRow>
            label={translator.format('statements.trialBalance')}
            columns={columns}
            rows={statement.rows}
            rowKey={(row) => row.account.id}
            emptyMessage={translator.format('statements.empty')}
          />
          <dl className="flex flex-col gap-[var(--vx-gap-sm)]">
            {(
              [
                ['opening', statement.totals.opening],
                ['movements', statement.totals.movements],
                ['closing', statement.totals.closing],
              ] as const
            ).map(([name, totals]) => (
              <div
                key={name}
                className="flex flex-wrap items-baseline gap-x-[var(--vx-gap-lg)] gap-y-[var(--vx-gap-xs)]"
              >
                <dt className="text-footnote text-fg-muted w-[8rem]">
                  {translator.format(`statements.totals.${name}`)}
                </dt>
                <dd className="text-body text-fg flex flex-wrap gap-[var(--vx-gap-lg)]">
                  <span className="flex items-baseline gap-[var(--vx-gap-xs)]">
                    {translator.format('entry.side.debit')}
                    <Figure amount={totals.debits} />
                  </span>
                  <span className="flex items-baseline gap-[var(--vx-gap-xs)]">
                    {translator.format('entry.side.credit')}
                    <Figure amount={totals.credits} />
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}
    </Read>
  );
}

/**
 * `FIN-07`'s income statement: what the shop earned and spent **within** the
 * span, and what it made.
 *
 * The result reads as a credit when the shop made money, which is the side
 * income sits on — rather than as a sign nobody could check against the books.
 */
function IncomeStatementView({ asked }: { readonly asked: Asked | null }): ReactNode {
  const translator = useTranslator();
  const { statements } = useLedger();
  const loaded = useLoaded(asked === null ? null : `income|${asked.key}`, () =>
    statements.incomeStatement(request(asked)),
  );

  if (asked === null) return <NotYet />;

  return (
    <Read<IncomeStatement> loaded={loaded}>
      {(statement) => (
        <Panel>
          <StatementFrame statement={statement} />
          <SectionView
            title={translator.format('account.kind.income')}
            section={statement.income}
          />
          <SectionView
            title={translator.format('account.kind.expense')}
            section={statement.expenses}
          />
          <Line
            label={translator.format('statements.result')}
            balance={statement.result}
            emphasis
          />
        </Panel>
      )}
    </Read>
  );
}

/**
 * `FIN-07`'s balance sheet: where the shop stands on the last day of the span,
 * and what it stands on.
 *
 * **There is no year-end closing entry**, here or anywhere: what the shop has
 * made is split at the span's first day into what it had made before
 * (`broughtForward`) and what it made within it (`result`) — and the second is
 * exactly the figure the income statement of the same request ends on. Both
 * are printed with the equity accounts, because that is what they are: they
 * fund the assets, exactly as capital does.
 */
function BalanceSheetView({ asked }: { readonly asked: Asked | null }): ReactNode {
  const translator = useTranslator();
  const { statements } = useLedger();
  const loaded = useLoaded(asked === null ? null : `balance|${asked.key}`, () =>
    statements.balanceSheet(request(asked)),
  );

  if (asked === null) return <NotYet />;

  return (
    <Read<BalanceSheet> loaded={loaded}>
      {(statement) => (
        <Panel>
          <StatementFrame statement={statement} />
          <SectionView title={translator.format('account.kind.asset')} section={statement.assets} />
          <SectionView
            title={translator.format('account.kind.liability')}
            section={statement.liabilities}
          />
          <SectionView
            title={translator.format('account.kind.equity')}
            section={statement.equity}
          />
          <Line
            label={translator.format('statements.broughtForward')}
            balance={statement.broughtForward}
          />
          <Line label={translator.format('statements.result')} balance={statement.result} />
          <div className="border-line flex flex-col gap-[var(--vx-gap-sm)] border-t pt-[var(--vx-pad-md)]">
            <Line
              label={translator.format('statements.totals.assets')}
              balance={statement.totals.assets}
              emphasis
            />
            <Line
              label={translator.format('statements.totals.liabilitiesAndEquity')}
              balance={statement.totals.liabilitiesAndEquity}
              emphasis
            />
          </div>
        </Panel>
      )}
    </Read>
  );
}

/**
 * `FIN-07`'s general ledger: every posting of an account in the order the
 * journal keeps them, and what each made of the account.
 *
 * `running` is what a ledger is read for — not that a figure was posted, but
 * where the account stood afterwards — so it is the last column and every
 * other column leads to it.
 *
 * The account filter narrows to one account. Omitted, the statement details
 * every account that has a balance at the end of the span or moved within it,
 * which is what "general ledger" means — and, on a shop with three hundred
 * accounts, a page nobody reads in one sitting. Withdrawn accounts are on the
 * list: this reads the books rather than writing into them, and an account
 * taken out of use keeps every line ever posted to it.
 */
function GeneralLedgerView({ asked }: { readonly asked: Asked | null }): ReactNode {
  const translator = useTranslator();
  const { statements } = useLedger();
  const accounts = useLeafAccounts('all');
  const [only, setOnly] = useState<string | null>(null);

  const options = useMemo(() => accountOptions(translator, accounts), [translator, accounts]);

  const loaded = useLoaded(asked === null ? null : `ledger|${asked.key}|${only ?? ''}`, () => {
    const ledgerRequest: LedgerRequest = {
      ...request(asked),
      // The brand is a compile-time claim: this came off an `Account` record
      // when the chooser was built, and `FIN` refuses one it does not have.
      ...(only === null ? {} : { accounts: [only as AccountId] }),
    };
    return statements.generalLedger(ledgerRequest);
  });

  if (asked === null) return <NotYet />;

  return (
    <>
      <Combobox
        label={translator.format('statements.account')}
        description={translator.format('statements.account.description')}
        options={options}
        emptyMessage={translator.format('statements.account.none')}
        placeholder={translator.format('statements.account.all')}
        value={only}
        onChange={setOnly}
        className="w-[26rem] max-w-full"
      />
      <Read<GeneralLedger> loaded={loaded}>
        {(statement) => (
          <Panel>
            <StatementFrame statement={statement} />
            {statement.accounts.length === 0 ? (
              <p className="text-body text-fg-muted">{translator.format('statements.empty')}</p>
            ) : (
              statement.accounts.map((account) => (
                <LedgerAccountView key={account.account.id} account={account} />
              ))
            )}
          </Panel>
        )}
      </Read>
    </>
  );
}

function LedgerAccountView({ account }: { readonly account: LedgerAccount }): ReactNode {
  const translator = useTranslator();

  const columns: readonly DataTableColumn<LedgerPosting>[] = [
    {
      id: 'number',
      header: translator.format('statements.column.entry'),
      isRowHeader: true,
      width: 170,
      render: (posting) => <Code>{posting.number}</Code>,
    },
    {
      id: 'day',
      header: translator.format('statements.column.day'),
      width: 130,
      render: (posting) => <DateTime value={posting.day} />,
    },
    {
      id: 'memo',
      header: translator.format('statements.column.description'),
      render: (posting) => (
        <span className="truncate">{posting.memo ?? posting.description ?? ''}</span>
      ),
    },
    {
      id: 'debit',
      header: translator.format('entry.side.debit'),
      align: 'end',
      width: 180,
      render: (posting) => (posting.side === 'debit' ? <Figure amount={posting.amount} /> : null),
    },
    {
      id: 'credit',
      header: translator.format('entry.side.credit'),
      align: 'end',
      width: 180,
      render: (posting) => (posting.side === 'credit' ? <Figure amount={posting.amount} /> : null),
    },
    {
      id: 'running',
      header: translator.format('statements.column.running'),
      align: 'end',
      width: 220,
      render: (posting) => <BalanceFigure balance={posting.running} />,
    },
  ];

  return (
    <section className="flex flex-col gap-[var(--vx-gap-sm)]">
      <h3 className="text-body font-body-semibold text-fg">
        <AccountCell account={account.account} />
      </h3>
      <Line label={translator.format('statements.opening')} balance={account.opening} />
      <DataTable<LedgerPosting>
        label={translator.format('statements.postings')}
        columns={columns}
        rows={account.postings}
        rowKey={(posting) => `${posting.entry}:${String(posting.ordinal)}`}
        emptyMessage={translator.format('statements.postings.none')}
      />
      <Line label={translator.format('statements.closing')} balance={account.closing} emphasis />
    </section>
  );
}

/**
 * One kind of account, with its accounts and what they come to.
 *
 * A **nested list** and not a grid: a statement's sections are the chart's own
 * groups, a group's figure is itself and everything under it, and the indent
 * is what says which. `aria-level` comes free from the nesting, so somebody
 * listening hears the depth a sighted reader sees.
 */
function SectionView({
  title,
  section,
}: {
  readonly title: string;
  readonly section: StatementSection;
}): ReactNode {
  return (
    <section className="flex flex-col gap-[var(--vx-gap-xs)]">
      <h3 className="text-body font-body-semibold text-fg">{title}</h3>
      {section.lines.length === 0 ? null : (
        <ul className="flex flex-col gap-[var(--vx-gap-xs)]">
          {section.lines.map((line) => (
            <LineItem key={line.account.id} line={line} depth={0} />
          ))}
        </ul>
      )}
      <Line label={title} balance={section.total} emphasis />
    </section>
  );
}

function LineItem({
  line,
  depth,
}: {
  readonly line: StatementLine;
  readonly depth: number;
}): ReactNode {
  const translator = useTranslator();
  return (
    <li>
      <div
        className="flex flex-wrap items-baseline justify-between gap-[var(--vx-gap-md)]"
        // The indent runs with the text: `ps` is the start edge, which is the
        // right on this interface and the left on a Latin one (§9).
        style={{ paddingInlineStart: `calc(var(--vx-pad-lg) * ${String(depth)})` }}
      >
        <span className="text-body text-fg flex min-w-0 items-baseline gap-[var(--vx-gap-sm)]">
          <Code className="text-fg-secondary shrink-0">{line.account.code}</Code>
          <span className="truncate">{nameOfAccount(translator, line.account)}</span>
        </span>
        <BalanceFigure balance={line.total} />
      </div>
      {line.children.length === 0 ? null : (
        <ul className="flex flex-col gap-[var(--vx-gap-xs)]">
          {line.children.map((child) => (
            <LineItem key={child.account.id} line={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** A named figure on its own line: a section's total, a result, an opening. */
function Line({
  label,
  balance,
  emphasis = false,
}: {
  readonly label: string;
  readonly balance: StatementSection['total'];
  readonly emphasis?: boolean;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-[var(--vx-gap-md)]">
      <span
        className={
          emphasis ? 'text-body font-body-semibold text-fg' : 'text-body text-fg-secondary'
        }
      >
        {label}
      </span>
      <BalanceFigure balance={balance} />
    </div>
  );
}

/** An account as a statement names it: its code, then its own name. */
function AccountCell({ account }: { readonly account: StatementLine['account'] }): ReactNode {
  const translator = useTranslator();
  return (
    <span className="inline-flex min-w-0 items-baseline gap-[var(--vx-gap-sm)]">
      <Code className="text-fg-secondary shrink-0">{account.code}</Code>
      <span className="truncate">{nameOfAccount(translator, account)}</span>
    </span>
  );
}

/**
 * The request a read is for.
 *
 * `useLoaded` starts a read only when its key changes and runs the closure of
 * the render that set it, so the request is always the one the key was built
 * from — but the closure is typed as though the span might still be missing,
 * and it cannot be: the key is null until it is not.
 */
function request(asked: Asked | null): StatementRequest {
  if (asked === null) throw new Error('A statement was read before its span was chosen.');
  return asked.request;
}
