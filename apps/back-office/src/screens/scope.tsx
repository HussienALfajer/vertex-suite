import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Select, useTranslator, type DataTableColumn, type SelectOption } from '@vertex/ui';
import type { Branch, Company } from '@vertex/sys/contract';

import { useOrganisation } from '../organisation.js';
import { hrefOf, redirect, useRoute, type RouteName } from '../routing.js';
import { EVERY_COMPANY, parentWithdrawalNotice } from './structure.js';

/**
 * Which branches a per-branch screen is showing: one, or every branch a
 * company filter leaves.
 *
 * Locations, tills, numbering series and daily rates each belong to one
 * branch, and `SYS` and `FX` answer for them one branch at a time — a chain
 * with forty branches has hundreds of locations, and the store node never
 * answers a tenant-wide read of them. The four screens that show them still
 * offer "all branches", and this is what makes that a choice a screen makes
 * rather than a read a contract lacks: it runs one read per branch it already
 * holds, together, and the screen lays the answers in one table with the
 * branch named on each row. Nobody who stays on one branch pays anything for
 * the option existing, and choosing it costs what opening every branch in
 * turn would have.
 *
 * **"All branches" is where a screen lands.** The company filter beside the
 * branch chooser starts at every company, and a branch chooser that started on
 * one branch picked for somebody would answer the same "which" two different
 * ways in one bar. Naming a branch — from the chooser, or from a row on
 * another screen that sent somebody here — narrows it; choosing a company
 * returns to all of that company's branches rather than picking one of them.
 *
 * The branch is in the address and the company filter is not: the address
 * names what is on screen (`routing.ts`), a branch is a record and "every
 * branch of this company" is a view of several. Replacing the address rather
 * than pushing onto it, so that Back leaves the screen instead of bouncing off
 * the correction.
 */

/** The screens this serves — each shows records that belong to one branch. */
export type ScopedScreen = Extract<RouteName, 'locations' | 'registers' | 'numbering' | 'rates'>;

/**
 * The address-bar subject that names every branch rather than one. No
 * identifier collides with it: a branch's is a UUID.
 */
const ALL_BRANCHES = 'all';

/** What a `useLoaded` subject for "all branches" starts with; the branches it covers follow. */
const ALL_PREFIX = `${ALL_BRANCHES}:`;

export interface BranchScope {
  /** The tenant's branches, narrowed to the company filter — what every option and read here answers against. */
  readonly branches: readonly Branch[];
  /** Of those, the ones a new record may be opened in. */
  readonly openBranches: readonly Branch[];
  /** The one branch chosen; null in the aggregate, and while the organisation is still loading. */
  readonly chosen: Branch | null;
  readonly isAllBranches: boolean;
  /** The company filtered to, or null for every company. */
  readonly company: Company | null;
  readonly companyFilter: string;
  /** Narrows to one company — or to all of them, with `EVERY_COMPANY` — and returns to its every branch. */
  readonly filterCompany: (company: string) => void;
  /**
   * The key the screen's `useLoaded` reads are asked under: the one branch
   * chosen, or every branch shown. Null while there is nothing yet to ask.
   *
   * The aggregate's key **names its branches**, rather than only saying "all".
   * `useLoaded` asks once per key, so a key that stayed the same while the
   * branches behind it changed — the organisation arriving after the address
   * already said "all", a company filtered to, a branch opened — would keep
   * answering from the list the first read saw. `branchesIn` reads them back
   * out, so a read never closes over a list that has since moved on.
   */
  readonly subject: string | null;
  /** A branch's name, for a row that names its branch by identifier. */
  readonly nameOf: (branch: Branch['id']) => string;
  /**
   * Why a record that is itself in use cannot be traded from, or undefined.
   *
   * `SYS` does not cascade a withdrawal (`packages/modules/sys/src/structure.ts`):
   * withdrawing a branch leaves every till and location in it marked in use,
   * and withdrawing a company leaves its branches so. A record is only as
   * usable as the least usable thing above it, so the branch is asked first
   * and then its company.
   */
  readonly withdrawnAbove: (branch: Branch['id'], branchWithdrawn: string) => string | undefined;
}

/** The branches a scope's `subject` covers — the one it names, or each of the aggregate's. */
export function branchesIn(subject: string): readonly Branch['id'][] {
  // The brand is a compile-time claim; these identifiers came off `Branch`
  // records when the subject was built, or out of the address, which a read
  // for a branch that does not exist answers for itself.
  const ids = subject.startsWith(ALL_PREFIX)
    ? subject
        .slice(ALL_PREFIX.length)
        .split(',')
        .filter((one) => one !== '')
    : [subject];
  return ids as Branch['id'][];
}

export function useBranchScope(screen: ScopedScreen): BranchScope {
  const translator = useTranslator();
  const route = useRoute();
  const { companies, branches: everyBranch, isLoading } = useOrganisation();
  const [companyFilter, setCompanyFilter] = useState<string>(EVERY_COMPANY);

  const branches = useMemo(
    () =>
      companyFilter === EVERY_COMPANY
        ? everyBranch
        : everyBranch.filter((one) => one.company === companyFilter),
    [everyBranch, companyFilter],
  );
  const openBranches = useMemo(() => branches.filter((one) => one.active), [branches]);
  const company = useMemo(
    () => companies.find((one) => one.id === companyFilter) ?? null,
    [companies, companyFilter],
  );
  // The whole tenant, not the filtered list: what a row's branch is called,
  // and whether it or its company is withdrawn, does not depend on a filter.
  const branchById = useMemo(
    () => new Map(everyBranch.map((one) => [one.id, one] as const)),
    [everyBranch],
  );
  const companyById = useMemo(
    () => new Map(companies.map((one) => [one.id, one] as const)),
    [companies],
  );

  const isAllBranches = route.subject === ALL_BRANCHES;
  const chosen = useMemo(
    () => (isAllBranches ? null : (branches.find((one) => one.id === route.subject) ?? null)),
    [branches, route.subject, isAllBranches],
  );

  // Arriving with no branch named, or with one outside the company filtered
  // to, lands on every branch.
  useEffect(() => {
    if (isAllBranches || chosen !== null || branches.length === 0) return;
    redirect(hrefOf(screen, ALL_BRANCHES));
  }, [screen, isAllBranches, chosen, branches]);

  const subject = isAllBranches
    ? isLoading && everyBranch.length === 0
      ? null
      : `${ALL_PREFIX}${branches.map((one) => one.id).join(',')}`
    : (chosen?.id ?? null);

  return {
    branches,
    openBranches,
    chosen,
    isAllBranches,
    company,
    companyFilter,
    filterCompany: (next) => {
      setCompanyFilter(next);
      redirect(hrefOf(screen, ALL_BRANCHES));
    },
    subject,
    nameOf: (id) => branchById.get(id)?.name ?? translator.format('data.unknown'),
    withdrawnAbove: (id, branchWithdrawn) => {
      const branch = branchById.get(id);
      return parentWithdrawalNotice(
        [branch, branchWithdrawn],
        [
          branch === undefined ? undefined : companyById.get(branch.company),
          translator.format('branches.status.companyWithdrawn'),
        ],
      );
    },
  };
}

/**
 * A sentence that depends on how many branches it is about: `key` for one,
 * `key.allBranches` for every branch, `key.allBranchesInCompany` for every
 * branch of the company filtered to. "Nothing here" claims something
 * different in each, and a person who narrowed to one company should never be
 * left wondering whether "all" still means the whole shop.
 */
export function scopedMessage(
  translator: ReturnType<typeof useTranslator>,
  scope: BranchScope,
  key: string,
  values: Readonly<Record<string, string>> = {},
): string {
  if (!scope.isAllBranches) return translator.format(key, values);
  return scope.company === null
    ? translator.format(`${key}.allBranches`, values)
    : translator.format(`${key}.allBranchesInCompany`, { ...values, company: scope.company.name });
}

/**
 * The column naming each row's branch — only where rows from several branches
 * share one table. With one branch shown, the chooser above the table already
 * says which, and a column repeating it on every row is the one nobody reads.
 */
export function branchColumn<T>(
  scope: BranchScope,
  header: string,
  branchOf: (row: T) => Branch['id'],
  width?: number,
): readonly DataTableColumn<T>[] {
  if (!scope.isAllBranches || scope.branches.length < 2) return [];
  return [
    {
      id: 'branch',
      header,
      ...(width === undefined ? {} : { width }),
      render: (row) => <span className="text-fg-secondary">{scope.nameOf(branchOf(row))}</span>,
    },
  ];
}

/**
 * The company filter and the branch chooser, as every scoped screen offers them.
 *
 * Worded per screen, from `<screen>.filter.company`, `<screen>.branch` and the
 * keys beside them, as every other label on these screens is: a tenant's
 * terminology may call a branch one thing on the rates board and another on
 * the tills screen.
 */
export function ScopeFilters({
  scope,
  screen,
}: {
  readonly scope: BranchScope;
  readonly screen: ScopedScreen;
}): ReactNode {
  const translator = useTranslator();
  const { companies } = useOrganisation();

  const companyOptions: readonly SelectOption[] = [
    { id: EVERY_COMPANY, label: translator.format(`${screen}.filter.allCompanies`) },
    ...companies.map((one) => ({ id: one.id, label: one.name })),
  ];
  const branchOptions: readonly SelectOption[] = [
    {
      id: ALL_BRANCHES,
      label:
        scope.company === null
          ? translator.format(`${screen}.branch.all`)
          : translator.format(`${screen}.branch.allInCompany`, { company: scope.company.name }),
    },
    ...scope.branches.map((one) => ({ id: one.id, label: one.name })),
  ];

  return (
    <>
      <Select
        label={translator.format(`${screen}.filter.company`)}
        options={companyOptions}
        value={scope.companyFilter}
        onChange={(key) => {
          scope.filterCompany(String(key));
        }}
        className="w-[16rem] max-w-full"
      />
      <Select
        label={translator.format(`${screen}.branch`)}
        placeholder={translator.format(`${screen}.branch.placeholder`)}
        options={branchOptions}
        value={scope.isAllBranches ? ALL_BRANCHES : (scope.chosen?.id ?? null)}
        onChange={(key) => {
          redirect(hrefOf(screen, String(key)));
        }}
        className="w-[16rem] max-w-full"
      />
    </>
  );
}
