import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

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
import type { Result } from '@vertex/kernel';
import type { Branch, Location, LocationKind, OrganisationRefusal } from '@vertex/sys/contract';

import { useDeliveryMessage, useLoaded, useOrganisation } from '../organisation.js';
import type { OrganisationOfRecord } from '../system.js';
import { hrefOf, redirect, useNavigateTo, useRoute } from '../routing.js';
import {
  ListingBar,
  NameDialog,
  RenameIcon,
  RestoreIcon,
  StaleBanner,
  StatusBadge,
  WithdrawIcon,
  matchesQuery,
} from './structure.js';

/**
 * The stock locations of `SYS-09`: where goods actually sit inside a branch.
 *
 * This screen is **scoped to one branch and cannot not be**. The contract asks
 * for locations per branch rather than per tenant, because a chain with forty
 * branches has hundreds of them and nobody works across the lot; a screen that
 * listed them all would be a screen that has to be filtered before it can be
 * read. So the branch is chosen first, it is chosen in the address bar, and
 * arriving with none picks the first one open rather than showing an empty
 * grid that is not empty.
 *
 * The **kind** is set once and never edited. `STK` treats a shop floor, a store
 * room and a van differently, and stock that has already moved through a
 * location was moved under the rules of the kind it had — so changing it later
 * would rewrite the meaning of movements nobody can go back and re-decide. The
 * contract offers no command for it, and the dialog says so where somebody is
 * choosing.
 */

const KIND_KEYS: Readonly<Record<LocationKind, string>> = {
  'shop-floor': 'location.kind.shop-floor',
  'store-room': 'location.kind.store-room',
  vehicle: 'location.kind.vehicle',
};

const KINDS: readonly LocationKind[] = ['shop-floor', 'store-room', 'vehicle'];

export function Locations(): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const goTo = useNavigateTo();
  const route = useRoute();
  const { branches, isLoading, unreachable, run, ofRecord } = useOrganisation();
  const messageFor = useDeliveryMessage();

  const [query, setQuery] = useState('');
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [renaming, setRenaming] = useState<Location | null>(null);
  const [withdrawing, setWithdrawing] = useState<Location | null>(null);
  const [restoring, setRestoring] = useState<Location | null>(null);

  const openBranches = useMemo(() => branches.filter((one) => one.active), [branches]);
  const chosen = useMemo(
    () => branches.find((one) => one.id === route.subject) ?? null,
    [branches, route.subject],
  );

  // Arriving with no branch named, or with one that is not this tenant's, lands
  // on the first branch that is open. Replacing rather than pushing, so that
  // Back leaves this screen instead of bouncing off the correction.
  useEffect(() => {
    if (chosen !== null || branches.length === 0) return;
    const first = openBranches[0] ?? branches[0];
    if (first !== undefined) redirect(hrefOf('locations', first.id));
  }, [chosen, branches, openBranches]);

  const read = useCallback(
    (branch: Branch['id']) => ofRecord.locations.list(branch, { including: 'all' }),
    [ofRecord],
  );
  const locations = useLoaded(chosen?.id ?? null, read);

  const rows = useMemo(
    () =>
      (locations.value ?? []).filter(
        (one) => (includeWithdrawn || one.active) && matchesQuery(one.name, query),
      ),
    [locations.value, includeWithdrawn, query],
  );

  /** Every command here changes this branch's own list, which the shared reload does not hold. */
  async function command(
    work: (of: OrganisationOfRecord) => Promise<Result<Location, OrganisationRefusal>>,
    said: (name: string) => string,
    on: Location,
  ): Promise<void> {
    const delivery = await run(work);
    const message = messageFor(delivery);
    if (message === null) locations.reload();
    toast.show(
      message ?? said(on.name),
      message === null ? { tone: 'success' } : { tone: 'danger' },
    );
  }

  const columns: readonly DataTableColumn<Location>[] = [
    {
      id: 'name',
      header: translator.format('locations.column.name'),
      isRowHeader: true,
      render: (location) => <span className="font-body-medium">{location.name}</span>,
    },
    {
      id: 'kind',
      header: translator.format('locations.column.kind'),
      // Words rather than a badge: §7.1 keeps the pill for status, and what
      // kind of place this is is not a state it can leave.
      render: (location) => (
        <span className="text-fg-secondary">{translator.format(KIND_KEYS[location.kind])}</span>
      ),
    },
    {
      id: 'status',
      header: translator.format('locations.column.status'),
      render: (location) => <StatusBadge isActive={location.active} />,
    },
    {
      id: 'actions',
      header: translator.format('locations.column.actions'),
      align: 'end',
      // Two: the rename, and whichever of withdraw and restore this row is in
      // a state to offer.
      width: actionsColumnWidth(2),
      render: (location) => (
        <TableRowActions>
          <TableRowAction
            aria-label={translator.format('locations.rename.title')}
            onPress={() => {
              setRenaming(location);
            }}
          >
            <RenameIcon />
          </TableRowAction>
          {location.active ? (
            <TableRowAction
              aria-label={translator.format('locations.withdraw.title')}
              onPress={() => {
                setWithdrawing(location);
              }}
            >
              <WithdrawIcon />
            </TableRowAction>
          ) : (
            <TableRowAction
              aria-label={translator.format('locations.restore.title')}
              onPress={() => {
                setRestoring(location);
              }}
            >
              <RestoreIcon />
            </TableRowAction>
          )}
        </TableRowActions>
      ),
    },
  ];

  // The same three states as the companies screen, and for the same reason.
  if (branches.length === 0 && unreachable) {
    return (
      <>
        <PageHeader
          title={translator.format('locations.title')}
          description={translator.format('locations.description')}
        />
        <StaleBanner />
      </>
    );
  }

  if (branches.length === 0 && !isLoading) {
    return (
      <>
        <PageHeader
          title={translator.format('locations.title')}
          description={translator.format('locations.description')}
        />
        <StaleBanner />
        <EmptyState
          message={translator.format('locations.noBranches')}
          description={translator.format('locations.noBranches.explanation')}
          action={
            <Button
              tone="primary"
              onPress={() => {
                goTo('branches');
              }}
            >
              {translator.format('locations.noBranches.action')}
            </Button>
          }
        />
      </>
    );
  }

  const branchOptions: readonly SelectOption[] = branches.map((one) => ({
    id: one.id,
    label: one.name,
  }));

  return (
    <>
      <PageHeader
        title={translator.format('locations.title')}
        description={translator.format('locations.description')}
        actions={
          <Button
            tone="primary"
            isDisabled={chosen?.active !== true}
            onPress={() => {
              setIsOpening(true);
            }}
          >
            {translator.format('locations.open')}
          </Button>
        }
      />

      <StaleBanner />

      <ListingBar
        searchLabel={translator.format('locations.search')}
        query={query}
        onQuery={setQuery}
        includeWithdrawn={includeWithdrawn}
        onIncludeWithdrawn={setIncludeWithdrawn}
      >
        <Select
          label={translator.format('locations.branch')}
          placeholder={translator.format('locations.branch.placeholder')}
          options={branchOptions}
          value={chosen?.id ?? null}
          onChange={(key) => {
            redirect(hrefOf('locations', String(key)));
          }}
          className="w-[16rem] max-w-full"
        />
      </ListingBar>

      {locations.unreachable ? null : (locations.value ?? []).length === 0 &&
        !locations.isLoading ? (
        <EmptyState
          message={translator.format('locations.empty')}
          description={translator.format('locations.empty.explanation')}
          action={
            <Button
              tone="primary"
              isDisabled={chosen?.active !== true}
              onPress={() => {
                setIsOpening(true);
              }}
            >
              {translator.format('locations.open')}
            </Button>
          }
        />
      ) : (
        <Panel flush>
          <DataTable
            label={translator.format('locations.table')}
            columns={columns}
            rows={rows}
            emptyMessage={translator.format(
              locations.isLoading ? 'data.loading' : 'listing.noMatch',
            )}
          />
        </Panel>
      )}

      {chosen === null ? null : (
        <NewLocationDialog
          branch={chosen}
          isOpen={isOpening}
          onOpenChange={setIsOpening}
          onOpened={locations.reload}
        />
      )}

      <NameDialog
        title={translator.format('locations.rename.title')}
        label={translator.format('locations.new.name')}
        submitLabel={translator.format('action.rename')}
        initialName={renaming?.name ?? ''}
        isOpen={renaming !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRenaming(null);
        }}
        onSubmit={async (name) => {
          if (renaming === null) return null;
          const delivery = await run((of) => of.locations.rename(renaming.id, name));
          const message = messageFor(delivery);
          if (message === null) {
            locations.reload();
            toast.show(translator.format('locations.renamed', { name }), { tone: 'success' });
          }
          return message;
        }}
      />

      <ConfirmationDialog
        title={translator.format('locations.withdraw.title')}
        message={translator.format('locations.withdraw.message', { name: withdrawing?.name ?? '' })}
        confirmLabel={translator.format('locations.withdraw')}
        tone="danger"
        isOpen={withdrawing !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setWithdrawing(null);
        }}
        onConfirm={() => {
          if (withdrawing === null) return;
          const taken = withdrawing;
          void command(
            (of) => of.locations.deactivate(taken.id),
            (name) => translator.format('locations.withdrawn', { name }),
            taken,
          );
        }}
      />

      <ConfirmationDialog
        title={translator.format('locations.restore.title')}
        message={translator.format('locations.restore.message', { name: restoring?.name ?? '' })}
        confirmLabel={translator.format('locations.restore')}
        isOpen={restoring !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRestoring(null);
        }}
        onConfirm={() => {
          if (restoring === null) return;
          const taken = restoring;
          void command(
            (of) => of.locations.reactivate(taken.id),
            (name) => translator.format('locations.restored', { name }),
            taken,
          );
        }}
      />
    </>
  );
}

interface NewLocationDialogProps {
  readonly branch: Branch;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onOpened: () => void;
}

/** Opening a location: what it is called, and what kind of place it is. */
function NewLocationDialog({
  branch,
  isOpen,
  onOpenChange,
  onOpened,
}: NewLocationDialogProps): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { run } = useOrganisation();
  const messageFor = useDeliveryMessage();

  const [name, setName] = useState('');
  // The shop floor, because it is the location every shop has and the one most
  // often opened first. A default that is right most of the time is a field
  // most people never touch.
  const [kind, setKind] = useState<LocationKind>('shop-floor');
  const [isWorking, setIsWorking] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [isMissing, setIsMissing] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setKind('shop-floor');
    setRefused(null);
    setIsMissing(false);
    setIsWorking(false);
  }, [isOpen]);

  async function attempt(): Promise<void> {
    if (isWorking) return;
    if (name.trim() === '') {
      setIsMissing(true);
      setRefused(null);
      return;
    }

    setIsWorking(true);
    setRefused(null);
    const chosen = name.trim();
    const delivery = await run((of) =>
      of.locations.open({ branch: branch.id, name: chosen, kind }),
    );
    setIsWorking(false);

    const message = messageFor(delivery);
    if (message === null) {
      onOpened();
      toast.show(translator.format('locations.opened', { name: chosen }), { tone: 'success' });
      onOpenChange(false);
    } else {
      setRefused(message);
    }
  }

  const kindOptions: readonly SelectOption[] = KINDS.map((one) => ({
    id: one,
    label: translator.format(KIND_KEYS[one]),
  }));

  return (
    <Dialog
      title={translator.format('locations.new.title')}
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
            {translator.format('locations.new.submit')}
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
        <TextInput
          label={translator.format('locations.new.name')}
          value={name}
          onChange={(next) => {
            setName(next);
            setIsMissing(false);
          }}
          autoFocus
          isRequired
          {...(isMissing ? { errorMessage: translator.format('name.required') } : {})}
        />
        <Select
          label={translator.format('locations.new.kind')}
          description={translator.format('locations.new.kind.description')}
          options={kindOptions}
          value={kind}
          onChange={(key) => {
            const picked = KINDS.find((one) => one === key);
            if (picked !== undefined) setKind(picked);
          }}
        />
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
