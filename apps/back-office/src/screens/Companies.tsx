import { useMemo, useState, type ReactNode } from 'react';

import {
  Button,
  ConfirmationDialog,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  TableRowAction,
  TableRowActions,
  useToast,
  useTranslator,
  type DataTableColumn,
} from '@vertex/ui';
import type { Company } from '@vertex/sys/contract';

import { useDeliveryMessage, useOrganisation } from '../organisation.js';
import { useNavigateTo } from '../routing.js';
import {
  ListingBar,
  NameDialog,
  OpenListIcon,
  ProfileIcon,
  RenameIcon,
  RestoreIcon,
  StaleBanner,
  StatusBadge,
  WithdrawIcon,
  matchesQuery,
} from './structure.js';

/**
 * The companies of `SYS-09`: the legal entities a document is issued by.
 *
 * Two things on this screen are the feature rather than the design.
 *
 * **Nothing is deleted.** A company is withdrawn from use and stays where every
 * document that names it can still find it, which is why the destructive action
 * is a withdrawal, why it can be undone from the same row, and why the listing
 * can be asked to show what has been withdrawn. An administrator who could not
 * see a withdrawn company could not put it back, and `SYS-09` says calling the
 * vendor must never be necessary.
 *
 * **Registering one is the whole of it.** `SYS-05`'s profile is created in the
 * same transaction, blank but for the name, because a receipt printed on the
 * shop's first afternoon has to print something. So this screen asks for a name
 * and sends people to the profile screen for the rest, rather than presenting a
 * long form at the one moment the answer to most of it is not known yet.
 */
export function Companies(): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const goTo = useNavigateTo();
  const { companies, branches, isLoading, unreachable, run } = useOrganisation();
  const messageFor = useDeliveryMessage();

  const [query, setQuery] = useState('');
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [renaming, setRenaming] = useState<Company | null>(null);
  const [withdrawing, setWithdrawing] = useState<Company | null>(null);

  const branchesPerCompany = useMemo(() => {
    const counted = new Map<string, number>();
    for (const branch of branches) {
      if (branch.active) counted.set(branch.company, (counted.get(branch.company) ?? 0) + 1);
    }
    return counted;
  }, [branches]);

  const rows = useMemo(
    () =>
      companies.filter((one) => (includeWithdrawn || one.active) && matchesQuery(one.name, query)),
    [companies, includeWithdrawn, query],
  );

  async function restore(company: Company): Promise<void> {
    const delivery = await run((of) => of.companies.reactivate(company.id));
    const message = messageFor(delivery);
    toast.show(
      message ?? translator.format('companies.restored', { name: company.name }),
      message === null ? { tone: 'success' } : { tone: 'danger' },
    );
  }

  async function withdraw(company: Company): Promise<void> {
    const delivery = await run((of) => of.companies.deactivate(company.id));
    const message = messageFor(delivery);
    toast.show(
      message ?? translator.format('companies.withdrawn', { name: company.name }),
      message === null ? { tone: 'success' } : { tone: 'danger' },
    );
  }

  const columns: readonly DataTableColumn<Company>[] = [
    {
      id: 'name',
      header: translator.format('companies.column.name'),
      isRowHeader: true,
      render: (company) => <span className="font-body-medium">{company.name}</span>,
    },
    {
      id: 'branches',
      header: translator.format('companies.column.branches'),
      render: (company) => (
        <span className="text-fg-secondary tabular-nums">
          {translator.format('companies.branchCount', {
            count: branchesPerCompany.get(company.id) ?? 0,
          })}
        </span>
      ),
    },
    {
      id: 'status',
      header: translator.format('companies.column.status'),
      render: (company) => <StatusBadge isActive={company.active} />,
    },
    {
      id: 'actions',
      header: translator.format('companies.column.actions'),
      align: 'end',
      width: '1%',
      render: (company) => (
        <TableRowActions>
          <TableRowAction
            aria-label={translator.format('companies.profile')}
            onPress={() => {
              goTo('business-profile', company.id);
            }}
          >
            <ProfileIcon />
          </TableRowAction>
          <TableRowAction
            aria-label={translator.format('companies.branches')}
            onPress={() => {
              goTo('branches', company.id);
            }}
          >
            <OpenListIcon />
          </TableRowAction>
          <TableRowAction
            aria-label={translator.format('companies.rename.title')}
            onPress={() => {
              setRenaming(company);
            }}
          >
            <RenameIcon />
          </TableRowAction>
          {company.active ? (
            <TableRowAction
              aria-label={translator.format('companies.withdraw.title')}
              onPress={() => {
                setWithdrawing(company);
              }}
            >
              <WithdrawIcon />
            </TableRowAction>
          ) : (
            <TableRowAction
              aria-label={translator.format('companies.restore')}
              onPress={() => {
                void restore(company);
              }}
            >
              <RestoreIcon />
            </TableRowAction>
          )}
        </TableRowActions>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={translator.format('companies.title')}
        description={translator.format('companies.description')}
        actions={
          <Button
            tone="primary"
            onPress={() => {
              setIsRegistering(true);
            }}
          >
            {translator.format('companies.register')}
          </Button>
        }
      />

      <StaleBanner />

      {/* An empty shop and a shop that could not be read look identical from
          here and call for opposite reactions, so the invitation to register
          the first company is only offered when the list is known to be
          empty. Otherwise the banner above says what actually happened. */}
      {companies.length === 0 && !isLoading && !unreachable ? (
        <EmptyState
          message={translator.format('companies.empty')}
          description={translator.format('companies.empty.explanation')}
          action={
            <Button
              tone="primary"
              onPress={() => {
                setIsRegistering(true);
              }}
            >
              {translator.format('companies.register')}
            </Button>
          }
        />
      ) : (
        <>
          <ListingBar
            searchLabel={translator.format('companies.search')}
            query={query}
            onQuery={setQuery}
            includeWithdrawn={includeWithdrawn}
            onIncludeWithdrawn={setIncludeWithdrawn}
          />
          <Panel flush>
            <DataTable
              label={translator.format('companies.table')}
              columns={columns}
              rows={rows}
              // Reaching this at all means the shop has companies or is still
              // being asked, so an empty grid is a search or a filter and never an
              // empty shop — which the branch above answers with somewhere to start.
              emptyMessage={translator.format(isLoading ? 'data.loading' : 'listing.noMatch')}
            />
          </Panel>
        </>
      )}

      <NameDialog
        title={translator.format('companies.new.title')}
        label={translator.format('companies.new.name')}
        description={translator.format('companies.new.name.description')}
        submitLabel={translator.format('companies.new.submit')}
        isOpen={isRegistering}
        onOpenChange={setIsRegistering}
        onSubmit={async (name) => {
          const delivery = await run((of) => of.companies.register({ name }));
          const message = messageFor(delivery);
          if (message === null) {
            toast.show(translator.format('companies.registered', { name }), { tone: 'success' });
          }
          return message;
        }}
      />

      <NameDialog
        title={translator.format('companies.rename.title')}
        label={translator.format('companies.new.name')}
        submitLabel={translator.format('action.rename')}
        initialName={renaming?.name ?? ''}
        isOpen={renaming !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRenaming(null);
        }}
        onSubmit={async (name) => {
          if (renaming === null) return null;
          const delivery = await run((of) => of.companies.rename(renaming.id, name));
          const message = messageFor(delivery);
          if (message === null) {
            toast.show(translator.format('companies.renamed', { name }), { tone: 'success' });
          }
          return message;
        }}
      />

      <ConfirmationDialog
        title={translator.format('companies.withdraw.title')}
        message={translator.format('companies.withdraw.message', {
          name: withdrawing?.name ?? '',
        })}
        confirmLabel={translator.format('companies.withdraw')}
        tone="danger"
        isOpen={withdrawing !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setWithdrawing(null);
        }}
        onConfirm={() => {
          if (withdrawing !== null) void withdraw(withdrawing);
        }}
      />
    </>
  );
}
