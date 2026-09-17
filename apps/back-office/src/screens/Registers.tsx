import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  actionsColumnWidth,
  Badge,
  Banner,
  Button,
  Code,
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
  useAttempt,
  useToast,
  useTranslator,
  type DataTableColumn,
  type SelectOption,
} from '@vertex/ui';
import type { Result } from '@vertex/kernel';
import type { Branch, OrganisationRefusal, Register } from '@vertex/sys/contract';

import { useDeliveryMessage, useLoaded, useOrganisation } from '../organisation.js';
import type { OrganisationOfRecord } from '../system.js';
import { hrefOf, redirect, useNavigateTo, useRoute } from '../routing.js';
import {
  ReadState,
  DeviceIcon,
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
 * The tills of `SYS-09`, and the machines standing at them (`SYS-02`).
 *
 * **Two things on one screen, because they are one question.** A register is a
 * position in a shop — the counter by the door — and the machine at it is a box
 * that gets replaced when it dies. Every other screen in this application shows
 * one kind of row; this one shows a row and what is currently plugged into it,
 * because the whole of `SYS-02`'s guarantee lives in the distance between the
 * two: the position keeps its prefix for ever, and the machine carries a
 * generation that goes up whenever a different one takes over.
 *
 * Scoped to one branch, chosen in the address bar, for the reason the locations
 * screen is: a till belongs to a branch and nobody works across forty of them.
 *
 * **The prefix is set once and never edited**, and the contract offers no
 * command for it. Every number this register has ever issued carries it, and a
 * number printed on a receipt in somebody's pocket cannot be renamed — so the
 * dialog says so where somebody is typing one, rather than the screen offering
 * an edit that would have to be refused.
 */

/**
 * Enough of a machine's identifier to tell two of them apart at a glance.
 *
 * The **tail**, not the head. A UUIDv7 leads with its timestamp, so two tills
 * paired in the same minute share their first characters and differ only near
 * the end — the opposite of what somebody scanning a column needs. The whole
 * identifier is one keystroke away in the dialog, which is where it is actually
 * compared against what the till is showing.
 */
function shortenDevice(device: string): string {
  return device.slice(-8);
}

export function Registers(): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const goTo = useNavigateTo();
  const route = useRoute();
  const { branches, isLoading, unreachable, run, ofRecord } = useOrganisation();
  const messageFor = useDeliveryMessage();

  const [query, setQuery] = useState('');
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [renaming, setRenaming] = useState<Register | null>(null);
  const [withdrawing, setWithdrawing] = useState<Register | null>(null);
  const [restoring, setRestoring] = useState<Register | null>(null);
  const [pairing, setPairing] = useState<Register | null>(null);

  const openBranches = useMemo(() => branches.filter((one) => one.active), [branches]);
  const chosen = useMemo(
    () => branches.find((one) => one.id === route.subject) ?? null,
    [branches, route.subject],
  );

  // Arriving with no branch named lands on the first one open, replacing rather
  // than pushing so that Back leaves the screen instead of bouncing off the
  // correction. The same arrangement the locations screen uses, for the same
  // reason: this list cannot be read without a branch.
  useEffect(() => {
    if (chosen !== null || branches.length === 0) return;
    const first = openBranches[0] ?? branches[0];
    if (first !== undefined) redirect(hrefOf('registers', first.id));
  }, [chosen, branches, openBranches]);

  const read = useCallback(
    (branch: Branch['id']) => ofRecord.registers.list(branch, { including: 'all' }),
    [ofRecord],
  );
  const registers = useLoaded(chosen?.id ?? null, read);

  const rows = useMemo(
    () =>
      (registers.value ?? []).filter(
        (one) => (includeWithdrawn || one.active) && matchesQuery(one.name, query),
      ),
    [registers.value, includeWithdrawn, query],
  );

  /**
   * Tills in use that no machine is standing at.
   *
   * Counted because such a till is invisible otherwise: it is open, it looks
   * exactly like the one next to it, and the first thing anybody learns about
   * it is a cashier being refused at the moment of a sale. The number reaches
   * the screen where the fix is, rather than the till where it is not.
   */
  const idle = useMemo(
    () => (registers.value ?? []).filter((one) => one.active && one.heldBy === null).length,
    [registers.value],
  );

  /** Every command here changes this branch's own list, which the shared reload does not hold. */
  async function command(
    work: (of: OrganisationOfRecord) => Promise<Result<Register, OrganisationRefusal>>,
    said: (name: string) => string,
    on: Register,
  ): Promise<void> {
    const delivery = await run(work);
    const message = messageFor(delivery);
    if (message === null) registers.reload();
    toast.show(
      message ?? said(on.name),
      message === null ? { tone: 'success' } : { tone: 'danger' },
    );
  }

  const columns: readonly DataTableColumn<Register>[] = [
    {
      id: 'name',
      header: translator.format('registers.column.name'),
      isRowHeader: true,
      render: (register) => <span className="font-body-medium">{register.name}</span>,
    },
    {
      id: 'prefix',
      // Monospaced, because it is read character by character off a printed
      // number rather than as a word.
      header: translator.format('registers.column.prefix'),
      render: (register) => <Code className="text-fg-secondary">{register.prefix}</Code>,
    },
    {
      id: 'device',
      header: translator.format('registers.column.device'),
      render: (register) =>
        register.heldBy === null ? (
          // A warning rather than the quiet neutral a withdrawn row gets: this
          // till is in use and cannot sell, which is a state somebody has to
          // act on rather than one it may sit in for years.
          <Badge tone="warning">{translator.format('registers.device.none')}</Badge>
        ) : (
          <Code
            className="text-fg-secondary"
            title={translator.format('registers.device.full', { device: register.heldBy })}
          >
            {shortenDevice(register.heldBy)}
          </Code>
        ),
    },
    {
      id: 'generation',
      header: translator.format('registers.column.generation'),
      render: (register) => (
        <span className="text-fg-secondary tabular-nums">
          {translator.format(
            register.generation === 0 ? 'registers.generation.none' : 'registers.generation.value',
            { generation: register.generation },
          )}
        </span>
      ),
    },
    {
      id: 'status',
      header: translator.format('registers.column.status'),
      render: (register) => <StatusBadge isActive={register.active} />,
    },
    {
      id: 'actions',
      header: translator.format('registers.column.actions'),
      align: 'end',
      // Three: the machine, the rename, and whichever of withdraw and restore
      // this row is in a state to offer.
      width: actionsColumnWidth(3),
      render: (register) => (
        <TableRowActions>
          <TableRowAction
            aria-label={translator.format('registers.device.action')}
            // A withdrawn till takes no machine — `SYS` refuses it — so it is
            // not offered, rather than refused after somebody typed an identifier.
            isDisabled={!register.active}
            onPress={() => {
              setPairing(register);
            }}
          >
            <DeviceIcon />
          </TableRowAction>
          <TableRowAction
            aria-label={translator.format('registers.rename.title')}
            onPress={() => {
              setRenaming(register);
            }}
          >
            <RenameIcon />
          </TableRowAction>
          {register.active ? (
            <TableRowAction
              aria-label={translator.format('registers.withdraw.title')}
              onPress={() => {
                setWithdrawing(register);
              }}
            >
              <WithdrawIcon />
            </TableRowAction>
          ) : (
            <TableRowAction
              aria-label={translator.format('registers.restore.title')}
              onPress={() => {
                setRestoring(register);
              }}
            >
              <RestoreIcon />
            </TableRowAction>
          )}
        </TableRowActions>
      ),
    },
  ];

  // The same three states as the locations screen, and for the same reason: a
  // shop that could not be read and a shop with nothing in it look identical
  // and call for opposite reactions.
  if (branches.length === 0 && unreachable) {
    return (
      <>
        <PageHeader
          title={translator.format('registers.title')}
          description={translator.format('registers.description')}
        />
        <StaleBanner />
      </>
    );
  }

  if (branches.length === 0 && !isLoading) {
    return (
      <>
        <PageHeader
          title={translator.format('registers.title')}
          description={translator.format('registers.description')}
        />
        <StaleBanner />
        <EmptyState
          message={translator.format('registers.noBranches')}
          description={translator.format('registers.noBranches.explanation')}
          action={
            <Button
              tone="primary"
              onPress={() => {
                goTo('branches');
              }}
            >
              {translator.format('registers.noBranches.action')}
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
        title={translator.format('registers.title')}
        description={translator.format('registers.description')}
        actions={
          <Button
            tone="primary"
            isDisabled={chosen?.active !== true}
            onPress={() => {
              setIsOpening(true);
            }}
          >
            {translator.format('registers.open')}
          </Button>
        }
      />

      <StaleBanner />

      {idle === 0 ? null : (
        <Banner tone="warning" title={translator.format('registers.idle')}>
          {translator.format('registers.idle.explanation', { count: idle })}
        </Banner>
      )}

      <ListingBar
        searchLabel={translator.format('registers.search')}
        query={query}
        onQuery={setQuery}
        includeWithdrawn={includeWithdrawn}
        onIncludeWithdrawn={setIncludeWithdrawn}
      >
        <Select
          label={translator.format('registers.branch')}
          placeholder={translator.format('registers.branch.placeholder')}
          options={branchOptions}
          value={chosen?.id ?? null}
          onChange={(key) => {
            redirect(hrefOf('registers', String(key)));
          }}
          className="w-[16rem] max-w-full"
        />
      </ListingBar>

      <ReadState loaded={registers} />
      {registers.unreachable ? null : (registers.value ?? []).length === 0 &&
        !registers.isLoading ? (
        <EmptyState
          message={translator.format('registers.empty')}
          description={translator.format('registers.empty.explanation')}
          action={
            <Button
              tone="primary"
              isDisabled={chosen?.active !== true}
              onPress={() => {
                setIsOpening(true);
              }}
            >
              {translator.format('registers.open')}
            </Button>
          }
        />
      ) : (
        <Panel flush>
          <DataTable
            label={translator.format('registers.table')}
            columns={columns}
            rows={rows}
            emptyMessage={translator.format(
              registers.isLoading ? 'data.loading' : 'listing.noMatch',
            )}
          />
        </Panel>
      )}

      {chosen === null ? null : (
        <NewRegisterDialog
          branch={chosen}
          isOpen={isOpening}
          onOpenChange={setIsOpening}
          onOpened={registers.reload}
        />
      )}

      <DeviceDialog
        register={pairing}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPairing(null);
        }}
        onAssigned={() => {
          setPairing(null);
          registers.reload();
        }}
      />

      <NameDialog
        title={translator.format('registers.rename.title')}
        label={translator.format('registers.new.name')}
        submitLabel={translator.format('action.rename')}
        initialName={renaming?.name ?? ''}
        isOpen={renaming !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRenaming(null);
        }}
        onSubmit={async (name) => {
          if (renaming === null) return null;
          const delivery = await run((of) => of.registers.rename(renaming.id, name));
          const message = messageFor(delivery);
          if (message === null) {
            registers.reload();
            toast.show(translator.format('registers.renamed', { name }), { tone: 'success' });
          }
          return message;
        }}
      />

      <ConfirmationDialog
        title={translator.format('registers.withdraw.title')}
        message={translator.format('registers.withdraw.message', { name: withdrawing?.name ?? '' })}
        confirmLabel={translator.format('registers.withdraw')}
        tone="danger"
        isOpen={withdrawing !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setWithdrawing(null);
        }}
        onConfirm={() => {
          if (withdrawing === null) return;
          const taken = withdrawing;
          void command(
            (of) => of.registers.deactivate(taken.id),
            (name) => translator.format('registers.withdrawn', { name }),
            taken,
          );
        }}
      />

      <ConfirmationDialog
        title={translator.format('registers.restore.title')}
        message={translator.format('registers.restore.message', { name: restoring?.name ?? '' })}
        confirmLabel={translator.format('registers.restore')}
        isOpen={restoring !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRestoring(null);
        }}
        onConfirm={() => {
          if (restoring === null) return;
          const taken = restoring;
          void command(
            (of) => of.registers.reactivate(taken.id),
            (name) => translator.format('registers.restored', { name }),
            taken,
          );
        }}
      />
    </>
  );
}

interface NewRegisterDialogProps {
  readonly branch: Branch;
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onOpened: () => void;
}

/**
 * Opening a till: what it is called, and the mark every number it issues will
 * carry.
 *
 * Written here rather than assembled from `NameDialog` because the second field
 * is not decoration. The prefix is permanent, it is unique across the whole
 * tenant rather than within this branch, and the refusals it comes back with
 * are about it rather than about the name — so the field needs its own
 * sentence saying what it costs to get wrong.
 */
function NewRegisterDialog({
  branch,
  isOpen,
  onOpenChange,
  onOpened,
}: NewRegisterDialogProps): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { run } = useOrganisation();
  const messageFor = useDeliveryMessage();

  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [missing, setMissing] = useState<{ name: boolean; prefix: boolean }>({
    name: false,
    prefix: false,
  });
  const {
    isWorking,
    refused,
    setRefused,
    attempt: attemptWith,
  } = useAttempt(isOpen, () => {
    setName('');
    setPrefix('');
    setMissing({ name: false, prefix: false });
  });

  async function attempt(): Promise<void> {
    if (isWorking) return;

    const blank = { name: name.trim() === '', prefix: prefix.trim() === '' };
    setMissing(blank);
    if (blank.name || blank.prefix) {
      setRefused(null);
      return;
    }

    // Only the blanks are answered here. **What a prefix may contain is the
    // domain's rule**, and checking it again in this dialog would be a second
    // copy of a pattern that exists to keep a printed number unambiguous — the
    // two would eventually disagree about a character nobody had thought about,
    // and the disagreement would show up as a field that refuses something the
    // shop would have accepted.
    const chosen = name.trim();
    const mark = prefix.trim();
    await attemptWith(async () => {
      const delivery = await run((of) =>
        of.registers.open({ branch: branch.id, name: chosen, prefix: mark }),
      );
      const message = messageFor(delivery);
      if (message === null) {
        onOpened();
        toast.show(translator.format('registers.opened', { name: chosen }), { tone: 'success' });
        onOpenChange(false);
      }
      return message;
    });
  }

  return (
    <Dialog
      title={translator.format('registers.new.title')}
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
            {translator.format('registers.new.submit')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          // §11.1 has Enter submit the form somebody is standing in.
          event.preventDefault();
          void attempt();
        }}
        className="flex flex-col gap-[var(--vx-gap-md)]"
      >
        {refused === null ? null : <Banner tone="danger">{refused}</Banner>}
        <TextInput
          label={translator.format('registers.new.name')}
          value={name}
          onChange={(next) => {
            setName(next);
            setMissing((was) => ({ ...was, name: false }));
          }}
          autoFocus
          isRequired
          {...(missing.name ? { errorMessage: translator.format('name.required') } : {})}
        />
        <TextInput
          label={translator.format('registers.new.prefix')}
          description={translator.format('registers.new.prefix.description')}
          value={prefix}
          onChange={(next) => {
            setPrefix(next);
            setMissing((was) => ({ ...was, prefix: false }));
          }}
          isRequired
          {...(missing.prefix
            ? { errorMessage: translator.format('registers.new.prefix.required') }
            : {})}
        />
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}

interface DeviceDialogProps {
  /** The till whose machine is being named. Null is the dialog closed. */
  readonly register: Register | null;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onAssigned: () => void;
}

/**
 * Saying which machine is standing at a till — the one action on this screen
 * that spends something nobody can give back.
 *
 * **The identifier is typed rather than chosen, and that is the honest shape of
 * the thing.** A machine generates its own identifier on the device that will
 * use it (`README.md`), `SEC` owns what a device is, and until a device
 * registry and a pairing flow exist there is no list here to pick from — so the
 * administrator copies what the till is showing on its own screen. Inventing an
 * identifier here instead would be this application naming a machine it has
 * never seen, and the machine would go on calling itself something else for
 * ever.
 *
 * The shape is judged by `SYS` rather than here, and has to be: the same
 * command arrives from a sync that never passed through a screen, and a rule
 * enforced in two places is a rule that ends up enforced differently.
 *
 * There is no second confirmation step. A dialog somebody has to answer twice
 * is a dialog they learn to answer without reading, so what a replacement costs
 * is said **in** the dialog, beside the field, where it is read once by
 * somebody who is about to type.
 */
function DeviceDialog({ register, onOpenChange, onAssigned }: DeviceDialogProps): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { run } = useOrganisation();
  const messageFor = useDeliveryMessage();

  const [claimed, setClaimed] = useState('');
  const [isMissing, setIsMissing] = useState(false);
  const {
    isWorking,
    refused,
    setRefused,
    attempt: attemptWith,
  } = useAttempt(register, () => {
    setClaimed('');
    setIsMissing(false);
  });

  const standing = register?.heldBy ?? null;

  async function attempt(): Promise<void> {
    if (isWorking || register === null) return;

    const typed = claimed.trim();
    if (typed === '') {
      setIsMissing(true);
      setRefused(null);
      return;
    }

    const till = register;
    await attemptWith(async () => {
      const delivery = await run((of) => of.registers.assignDevice(till.id, typed));
      if (delivery.kind !== 'done') return messageFor(delivery);

      onAssigned();
      // Naming the same machine again is not an error and must not be reported
      // as a success either: no generation was spent, and somebody who came
      // here to replace a machine needs to know the replacement did not happen.
      const spent = delivery.value.generation !== till.generation;
      toast.show(
        spent
          ? translator.format('registers.device.assigned', {
              name: till.name,
              generation: delivery.value.generation,
            })
          : translator.format('registers.device.unchanged', { name: till.name }),
        { tone: spent ? 'success' : 'info' },
      );
      onOpenChange(false);
      return null;
    });
  }

  return (
    <Dialog
      title={translator.format(
        standing === null ? 'registers.device.assign.title' : 'registers.device.replace.title',
      )}
      isOpen={register !== null}
      onOpenChange={onOpenChange}
      className="max-w-[36rem]"
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
            {translator.format('registers.device.submit')}
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
        {standing === null ? null : (
          <>
            <Banner tone="warning">{translator.format('registers.device.replace.warning')}</Banner>
            <p className="text-footnote text-fg-secondary">
              {translator.format('registers.device.current', {
                device: standing,
                generation: register?.generation ?? 0,
              })}
            </p>
          </>
        )}
        <TextInput
          label={translator.format('registers.device.label')}
          description={translator.format('registers.device.label.description')}
          placeholder={translator.format('registers.device.placeholder')}
          value={claimed}
          onChange={(next) => {
            setClaimed(next);
            setIsMissing(false);
          }}
          autoFocus
          isRequired
          isMachineText
          {...(isMissing ? { errorMessage: translator.format('registers.device.required') } : {})}
        />
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  );
}
