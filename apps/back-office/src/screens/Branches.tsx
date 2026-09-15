import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  actionsColumnWidth,
  Banner,
  Button,
  ConfirmationDialog,
  DataTable,
  Dialog,
  EmptyState,
  PageHeader,
  Panel,
  Select,
  TableRowAction,
  TableRowActions,
  TextInput,
  useToast,
  useTranslator,
  type DataTableColumn,
  type SelectOption,
} from '@vertex/ui';
import type { Branch, Company } from '@vertex/sys/contract';

import { useDeliveryMessage, useOrganisation } from '../organisation.js';
import { hrefOf, redirect, useNavigateTo, useRoute } from '../routing.js';
import {
  ListingBar,
  NameDialog,
  OpenListIcon,
  RenameIcon,
  RestoreIcon,
  StaleBanner,
  StatusBadge,
  WithdrawIcon,
  matchesQuery,
} from './structure.js';

/**
 * The branches of `SYS-09`: the trading sites everything else is scoped by.
 *
 * **The company filter lives in the address**, not in this component's state.
 * The companies screen sends somebody here with a company already chosen, a
 * shopkeeper sends a colleague a link to the branches of one company, and both
 * of those are the same mechanism — so there is one source of truth for what is
 * on screen and it is the one the address bar is already showing.
 *
 * It is replaced rather than pushed, because a filter is not a place: a person
 * who tried three companies and pressed Back expects the screen they came from,
 * not the second of the three.
 *
 * A branch is opened **inside a company**, so with no company registered there
 * is nothing to open one in. The screen says that and offers the way there,
 * rather than presenting a dialog whose first field has no options.
 */

/** Stands for "every company" in the filter. No identifier can collide with it. */
const EVERY_COMPANY = '*';

export function Branches(): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const goTo = useNavigateTo();
  const route = useRoute();
  const { companies, branches, isLoading, unreachable, run } = useOrganisation();
  const messageFor = useDeliveryMessage();

  const [query, setQuery] = useState('');
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [renaming, setRenaming] = useState<Branch | null>(null);
  const [withdrawing, setWithdrawing] = useState<Branch | null>(null);
  const [restoring, setRestoring] = useState<Branch | null>(null);

  const openCompanies = useMemo(() => companies.filter((one) => one.active), [companies]);
  const nameOfCompany = useMemo(
    () => new Map(companies.map((one) => [one.id, one.name] as const)),
    [companies],
  );

  const filter = route.subject;
  const rows = useMemo(
    () =>
      branches.filter(
        (one) =>
          (includeWithdrawn || one.active) &&
          (filter === null || one.company === filter) &&
          matchesQuery(one.name, query),
      ),
    [branches, includeWithdrawn, filter, query],
  );

  async function restore(branch: Branch): Promise<void> {
    const delivery = await run((of) => of.branches.reactivate(branch.id));
    const message = messageFor(delivery);
    toast.show(
      message ?? translator.format('branches.restored', { name: branch.name }),
      message === null ? { tone: 'success' } : { tone: 'danger' },
    );
  }

  async function withdraw(branch: Branch): Promise<void> {
    const delivery = await run((of) => of.branches.deactivate(branch.id));
    const message = messageFor(delivery);
    toast.show(
      message ?? translator.format('branches.withdrawn', { name: branch.name }),
      message === null ? { tone: 'success' } : { tone: 'danger' },
    );
  }

  const columns: readonly DataTableColumn<Branch>[] = [
    {
      id: 'name',
      header: translator.format('branches.column.name'),
      isRowHeader: true,
      render: (branch) => <span className="font-body-medium">{branch.name}</span>,
    },
    {
      id: 'company',
      header: translator.format('branches.column.company'),
      render: (branch) => (
        <span className="text-fg-secondary">{nameOfCompany.get(branch.company) ?? ''}</span>
      ),
    },
    {
      id: 'status',
      header: translator.format('branches.column.status'),
      render: (branch) => <StatusBadge isActive={branch.active} />,
    },
    {
      id: 'actions',
      header: translator.format('branches.column.actions'),
      align: 'end',
      // Three: the locations, the rename, and whichever of withdraw and
      // restore this row is in a state to offer.
      width: actionsColumnWidth(3),
      render: (branch) => (
        <TableRowActions>
          <TableRowAction
            aria-label={translator.format('branches.locations')}
            onPress={() => {
              goTo('locations', branch.id);
            }}
          >
            <OpenListIcon />
          </TableRowAction>
          <TableRowAction
            aria-label={translator.format('branches.rename.title')}
            onPress={() => {
              setRenaming(branch);
            }}
          >
            <RenameIcon />
          </TableRowAction>
          {branch.active ? (
            <TableRowAction
              aria-label={translator.format('branches.withdraw.title')}
              onPress={() => {
                setWithdrawing(branch);
              }}
            >
              <WithdrawIcon />
            </TableRowAction>
          ) : (
            <TableRowAction
              aria-label={translator.format('branches.restore.title')}
              onPress={() => {
                setRestoring(branch);
              }}
            >
              <RestoreIcon />
            </TableRowAction>
          )}
        </TableRowActions>
      ),
    },
  ];

  const filterOptions: readonly SelectOption[] = [
    { id: EVERY_COMPANY, label: translator.format('branches.filter.allCompanies') },
    ...companies.map((one) => ({ id: one.id, label: one.name })),
  ];

  // The same three states as the companies screen, and for the same reason:
  // an empty shop invites, a shop that could not be read explains, and the two
  // must not be shown as each other.
  if (companies.length === 0 && unreachable) {
    return (
      <>
        <PageHeader
          title={translator.format('branches.title')}
          description={translator.format('branches.description')}
        />
        <StaleBanner />
      </>
    );
  }

  if (companies.length === 0 && !isLoading) {
    return (
      <>
        <PageHeader
          title={translator.format('branches.title')}
          description={translator.format('branches.description')}
        />
        <StaleBanner />
        <EmptyState
          message={translator.format('branches.noCompanies')}
          description={translator.format('branches.noCompanies.explanation')}
          action={
            <Button
              tone="primary"
              onPress={() => {
                goTo('companies');
              }}
            >
              {translator.format('branches.noCompanies.action')}
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={translator.format('branches.title')}
        description={translator.format('branches.description')}
        actions={
          <Button
            tone="primary"
            isDisabled={openCompanies.length === 0}
            onPress={() => {
              setIsOpening(true);
            }}
          >
            {translator.format('branches.open')}
          </Button>
        }
      />

      <StaleBanner />

      {branches.length === 0 && unreachable ? null : branches.length === 0 && !isLoading ? (
        <EmptyState
          message={translator.format('branches.empty')}
          description={translator.format('branches.empty.explanation')}
          action={
            <Button
              tone="primary"
              isDisabled={openCompanies.length === 0}
              onPress={() => {
                setIsOpening(true);
              }}
            >
              {translator.format('branches.open')}
            </Button>
          }
        />
      ) : (
        <>
          <ListingBar
            searchLabel={translator.format('branches.search')}
            query={query}
            onQuery={setQuery}
            includeWithdrawn={includeWithdrawn}
            onIncludeWithdrawn={setIncludeWithdrawn}
          >
            <Select
              label={translator.format('branches.filter.company')}
              options={filterOptions}
              value={filter ?? EVERY_COMPANY}
              onChange={(key) => {
                const chosen = String(key);
                redirect(hrefOf('branches', chosen === EVERY_COMPANY ? null : chosen));
              }}
              className="w-[16rem] max-w-full"
            />
          </ListingBar>
          <Panel flush>
            <DataTable
              label={translator.format('branches.table')}
              columns={columns}
              rows={rows}
              emptyMessage={translator.format(isLoading ? 'data.loading' : 'listing.noMatch')}
            />
          </Panel>
        </>
      )}

      <NewBranchDialog
        companies={openCompanies}
        preferred={filter}
        isOpen={isOpening}
        onOpenChange={setIsOpening}
      />

      <NameDialog
        title={translator.format('branches.rename.title')}
        label={translator.format('branches.new.name')}
        submitLabel={translator.format('action.rename')}
        initialName={renaming?.name ?? ''}
        isOpen={renaming !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRenaming(null);
        }}
        onSubmit={async (name) => {
          if (renaming === null) return null;
          const delivery = await run((of) => of.branches.rename(renaming.id, name));
          const message = messageFor(delivery);
          if (message === null) {
            toast.show(translator.format('branches.renamed', { name }), { tone: 'success' });
          }
          return message;
        }}
      />

      <ConfirmationDialog
        title={translator.format('branches.withdraw.title')}
        message={translator.format('branches.withdraw.message', { name: withdrawing?.name ?? '' })}
        confirmLabel={translator.format('branches.withdraw')}
        tone="danger"
        isOpen={withdrawing !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setWithdrawing(null);
        }}
        onConfirm={() => {
          if (withdrawing !== null) void withdraw(withdrawing);
        }}
      />

      <ConfirmationDialog
        title={translator.format('branches.restore.title')}
        message={translator.format('branches.restore.message', { name: restoring?.name ?? '' })}
        confirmLabel={translator.format('branches.restore')}
        isOpen={restoring !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRestoring(null);
        }}
        onConfirm={() => {
          if (restoring !== null) void restore(restoring);
        }}
      />
    </>
  );
}

interface NewBranchDialogProps {
  readonly companies: readonly Company[];
  /** The company the list is filtered to, which is the one somebody is most likely to mean. */
  readonly preferred: string | null;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/**
 * Opening a branch: which company, and what it is called.
 *
 * Written here rather than assembled from `NameDialog`, because the second
 * field is not decoration — a branch belongs to a company permanently, and the
 * refusals it can come back with (`sys.company-inactive`, a name already used
 * inside that company) are about the pair rather than about the name.
 */
function NewBranchDialog({
  companies,
  preferred,
  isOpen,
  onOpenChange,
}: NewBranchDialogProps): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { run } = useOrganisation();
  const messageFor = useDeliveryMessage();

  const only = companies.length === 1 ? (companies[0] ?? null) : null;
  // The record rather than its identifier, so that what is handed to the
  // command is a company this shop actually has — a string out of a listbox is
  // a claim, and resolving it here is where the claim is checked.
  const [company, setCompany] = useState<Company | null>(null);
  const [name, setName] = useState('');
  const [isWorking, setIsWorking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [missing, setMissing] = useState<{ company: boolean; name: boolean }>({
    company: false,
    name: false,
  });

  // **Opening it is the only thing that fills it in**, and the dependency list
  // says so by naming nothing else. `companies` is a fresh array after every
  // reload — and a reload follows every successful command — so listing it here
  // cleared a half-typed branch name the moment anything else in the
  // application refreshed the structure underneath the dialog.
  useEffect(() => {
    if (!isOpen) return;
    // A shop with one company never answers this question; a shop that filtered
    // the list to one has already answered it.
    setCompany(only ?? companies.find((one) => one.id === preferred) ?? null);
    setName('');
    setRefused(null);
    setMissing({ company: false, name: false });
    setIsWorking(false);
  }, [isOpen]);

  async function attempt(): Promise<void> {
    if (isWorking) return;

    const blank = { company: company === null, name: name.trim() === '' };
    setMissing(blank);
    if (company === null || blank.name) {
      setRefused(null);
      return;
    }

    setIsWorking(true);
    setRefused(null);
    const chosen = name.trim();
    const into = company;
    const delivery = await run((of) => of.branches.open({ company: into.id, name: chosen }));
    setIsWorking(false);

    const message = messageFor(delivery);
    if (message === null) {
      toast.show(translator.format('branches.opened', { name: chosen }), { tone: 'success' });
      onOpenChange(false);
    } else {
      setRefused(message);
    }
  }

  const options: readonly SelectOption[] = companies.map((one) => ({
    id: one.id,
    label: one.name,
  }));

  return (
    <Dialog
      title={translator.format('branches.new.title')}
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
          <Button
            tone="primary"
            isDisabled={isWorking}
            onPress={() => {
              void attempt();
            }}
          >
            {translator.format('branches.new.submit')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void attempt();
        }}
        className="flex flex-col gap-[var(--vx-gap-md)]"
      >
        {refused === null ? null : <Banner tone="danger">{refused}</Banner>}
        <Select
          label={translator.format('branches.new.company')}
          placeholder={translator.format('branches.new.company.placeholder')}
          options={options}
          value={company?.id ?? null}
          onChange={(key) => {
            setCompany(companies.find((one) => one.id === key) ?? null);
            setMissing((was) => ({ ...was, company: false }));
          }}
          isRequired
          {...(missing.company
            ? { errorMessage: translator.format('branches.new.company.required') }
            : {})}
        />
        <TextInput
          label={translator.format('branches.new.name')}
          value={name}
          onChange={(next) => {
            setName(next);
            setMissing((was) => ({ ...was, name: false }));
          }}
          autoFocus
          isRequired
          {...(missing.name ? { errorMessage: translator.format('name.required') } : {})}
        />
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
