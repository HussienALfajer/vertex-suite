import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  actionsColumnWidth,
  Badge,
  Banner,
  Button,
  Code,
  ConfirmationDialog,
  DataTable,
  Dialog,
  focusFirstInvalid,
  PageHeader,
  Panel,
  TableRowAction,
  TableRowActions,
  TextInput,
  useAttempt,
  useToast,
  useTranslator,
  useVertex,
  type DataTableColumn,
} from '@vertex/ui';
import type { Result } from '@vertex/kernel';
import type { Branch } from '@vertex/sys/contract';
import type { Assignment, Confinement, Role, SecRefusal, User } from '@vertex/sec/contract';

import { useDeliveryMessage, useLoaded, useOrganisation, type Delivery } from '../organisation.js';
import type { UsersOfRecord } from '../system.js';
import {
  ReadState,
  branchNames,
  ListingBar,
  NameDialog,
  RenameIcon,
  RestoreIcon,
  RoleReachFields,
  roleLabel,
  ScopeIcon,
  SecurityIcon,
  StatusBadge,
  WithdrawIcon,
  matchesQuery,
} from './structure.js';
import { useUsers, type UsersState } from '../users.js';

/** A person `enrol` just produced holds nothing yet — there is no set to build fresh each render. */
const NO_ROLES: ReadonlySet<string> = new Set();

/** What `assignEach` did: the roles that went through, and why the next one did not. */
interface AssignedEach {
  readonly assigned: readonly Role['id'][];
  /** Null when every role went through. */
  readonly refusal: string | null;
}

/**
 * `SEC-01`/`SEC-04`'s assignment, for several roles under one reach.
 *
 * One `assign` per role, in turn, stopping at the first refusal. Each is a
 * commit of its own, so what went through stays through, and the caller is
 * told both halves: what to report as done, and what is left to ask for
 * again — a retry repeats nothing that already succeeded.
 */
async function assignEach(
  run: UsersState['run'],
  messageFor: (delivery: Delivery<unknown>) => string | null,
  user: User['id'],
  roles: readonly Role['id'][],
  confinement: Confinement,
): Promise<AssignedEach> {
  const assigned: Role['id'][] = [];
  for (const role of roles) {
    const refusal = messageFor(
      await run((of) => of.assignments.assign({ user, role, confinement })),
    );
    if (refusal !== null) return { assigned, refusal };
    assigned.push(role);
  }
  return { assigned, refusal: null };
}

/** The reach a person chose, as `SEC` takes it. */
function confinementOf(reach: 'tenant' | 'branches', branches: ReadonlySet<string>): Confinement {
  return reach === 'tenant'
    ? { kind: 'tenant' }
    : { kind: 'branches', branches: [...branches] as Branch['id'][], locations: [] };
}

/** "صار دور «…» لـ«…»" for one role, and the roles listed for several. */
function assignedMessage(
  translator: ReturnType<typeof useTranslator>,
  formattingLocale: string,
  name: string,
  roles: readonly Role[],
): string {
  const labels = roles.map((role) => roleLabel(translator, role));
  const [only] = labels;
  return labels.length === 1 && only !== undefined
    ? translator.format('users.scope.assigned', { name, role: only })
    : translator.format('users.scope.assignedMany', {
        name,
        roles: new Intl.ListFormat(formattingLocale, { style: 'long', type: 'conjunction' }).format(
          labels,
        ),
      });
}

/**
 * `SEC-09`: the people who work in this shop, and the sign-ins behind them.
 *
 * A user is deactivated and never deleted, for the reason `SYS-09` gives about
 * every structural entity: every sale, every adjustment and every approval a
 * person ever made names them, and a removed row turns all of it into an
 * identifier nobody can resolve. Withdrawing here is exactly that — a state, not
 * an erasure — and the row stays reportable for as long as anything references
 * it.
 *
 * **Role and scope (`SEC-01`, `SEC-04`) live in their own dialog rather than on
 * the row itself.** A user can hold several roles at once across several
 * stretches of the shop group — a manager of one branch and a floor supervisor
 * covering another — and there is no column narrow enough to say that at a
 * glance. What the row shows is who this is and whether they may sign in;
 * what they may do once they have is a question this screen answers on demand,
 * not one it tries to summarise in eleven characters.
 *
 * `SEC` cannot be composed in this browser at all (`system.ts`, `dev-system.ts`
 * say why), so what this screen reads and writes through is a development
 * stand-in until `U07` brings a transport to the store node the real module
 * runs on. Nothing here names that file: the screen is built against the port
 * alone, the same way every other screen in this application is.
 */

/**
 * `structure.tsx`'s `StaleBanner`, for `SEC` rather than `SYS` — reading a
 * different provider is the whole difference, so it is not worth generalising
 * the shared one across a boundary the two modules themselves keep apart.
 *
 * Exported for `Roles.tsx`: both screens read the same `UsersProvider`, so
 * there is exactly one banner to show when it falls behind, not one per screen
 * that happens to read it.
 */
export function UsersStaleBanner(): ReactNode {
  const translator = useTranslator();
  const { unreachable, reload } = useUsers();
  if (!unreachable) return null;

  return (
    <Banner
      tone="warning"
      title={translator.format('data.unreachable')}
      actions={<Button onPress={reload}>{translator.format('action.retry')}</Button>}
    >
      {translator.format('data.unreachable.explanation')}
    </Banner>
  );
}

export function Users(): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { users, isLoading, run, reload } = useUsers();
  const messageFor = useDeliveryMessage();

  const [query, setQuery] = useState('');
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [renaming, setRenaming] = useState<User | null>(null);
  const [withdrawing, setWithdrawing] = useState<User | null>(null);
  const [restoring, setRestoring] = useState<User | null>(null);
  const [securing, setSecuring] = useState<User | null>(null);
  const [scoping, setScoping] = useState<User | null>(null);

  const rows = useMemo(
    () =>
      users.filter(
        (one) =>
          (includeWithdrawn || one.active) &&
          (matchesQuery(one.name, query) || matchesQuery(one.handle, query)),
      ),
    [users, includeWithdrawn, query],
  );

  /** Every command here changes the shared list, which the shared reload picks up. */
  async function command(
    work: (of: UsersOfRecord) => Promise<Result<User, SecRefusal>>,
    said: (name: string) => string,
    on: User,
  ): Promise<void> {
    const delivery = await run(work);
    const message = messageFor(delivery);
    toast.show(
      message ?? said(on.name),
      message === null ? { tone: 'success' } : { tone: 'danger' },
    );
  }

  const columns: readonly DataTableColumn<User>[] = [
    {
      id: 'name',
      header: translator.format('users.column.name'),
      isRowHeader: true,
      render: (user) => (
        <span className="flex items-center gap-[var(--vx-gap-sm)]">
          <span className="font-body-medium">{user.name}</span>
          {user.shared ? <Badge tone="info">{translator.format('users.shared')}</Badge> : null}
        </span>
      ),
    },
    {
      id: 'handle',
      header: translator.format('users.column.handle'),
      render: (user) => <Code className="text-fg-secondary">{user.handle}</Code>,
    },
    {
      id: 'status',
      header: translator.format('users.column.status'),
      render: (user) => <StatusBadge isActive={user.active} />,
    },
    {
      id: 'actions',
      header: translator.format('users.column.actions'),
      align: 'end',
      width: actionsColumnWidth(4),
      render: (user) => (
        <TableRowActions>
          <TableRowAction
            aria-label={translator.format('users.scope.action')}
            onPress={() => {
              setScoping(user);
            }}
          >
            <ScopeIcon />
          </TableRowAction>
          <TableRowAction
            aria-label={translator.format('users.security.action')}
            onPress={() => {
              setSecuring(user);
            }}
          >
            <SecurityIcon />
          </TableRowAction>
          <TableRowAction
            aria-label={translator.format('users.rename.title')}
            onPress={() => {
              setRenaming(user);
            }}
          >
            <RenameIcon />
          </TableRowAction>
          {user.active ? (
            <TableRowAction
              aria-label={translator.format('users.withdraw.title')}
              onPress={() => {
                setWithdrawing(user);
              }}
            >
              <WithdrawIcon />
            </TableRowAction>
          ) : (
            <TableRowAction
              aria-label={translator.format('users.restore.title')}
              onPress={() => {
                setRestoring(user);
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
        title={translator.format('users.title')}
        description={translator.format('users.description')}
        actions={
          <Button
            tone="primary"
            onPress={() => {
              setIsEnrolling(true);
            }}
          >
            {translator.format('users.enrol')}
          </Button>
        }
      />

      <UsersStaleBanner />

      <ListingBar
        searchLabel={translator.format('users.search')}
        query={query}
        onQuery={setQuery}
        includeWithdrawn={includeWithdrawn}
        onIncludeWithdrawn={setIncludeWithdrawn}
      />

      {/*
        No empty state here, unlike the four organisation screens. A company or
        a branch can genuinely not exist yet; a **signed-in user** cannot — the
        one reading this screen is already a row in the table underneath it, so
        `users` is never empty while anybody is here to see it. What the table's
        own `emptyMessage` covers is the ordinary case: loading, or a search
        that matched nobody.
      */}
      <Panel flush>
        <DataTable
          label={translator.format('users.table')}
          columns={columns}
          rows={rows}
          emptyMessage={translator.format(isLoading ? 'data.loading' : 'listing.noMatch')}
        />
      </Panel>

      <EnrolDialog isOpen={isEnrolling} onOpenChange={setIsEnrolling} onEnrolled={reload} />

      <NameDialog
        title={translator.format('users.rename.title')}
        label={translator.format('users.new.name')}
        submitLabel={translator.format('action.rename')}
        initialName={renaming?.name ?? ''}
        isOpen={renaming !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRenaming(null);
        }}
        onSubmit={async (name) => {
          if (renaming === null) return null;
          const delivery = await run((of) => of.rename(renaming.id, name));
          const message = messageFor(delivery);
          if (message === null) {
            reload();
            toast.show(translator.format('users.renamed', { name }), { tone: 'success' });
          }
          return message;
        }}
      />

      <ConfirmationDialog
        title={translator.format('users.withdraw.title')}
        message={translator.format('users.withdraw.message', { name: withdrawing?.name ?? '' })}
        confirmLabel={translator.format('users.withdraw')}
        tone="danger"
        isOpen={withdrawing !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setWithdrawing(null);
        }}
        onConfirm={() => {
          if (withdrawing === null) return;
          const taken = withdrawing;
          void command(
            (of) => of.deactivate(taken.id),
            (name) => translator.format('users.withdrawn', { name }),
            taken,
          );
        }}
      />

      <ConfirmationDialog
        title={translator.format('users.restore.title')}
        message={translator.format('users.restore.message', { name: restoring?.name ?? '' })}
        confirmLabel={translator.format('users.restore')}
        isOpen={restoring !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRestoring(null);
        }}
        onConfirm={() => {
          if (restoring === null) return;
          const taken = restoring;
          void command(
            (of) => of.reactivate(taken.id),
            (name) => translator.format('users.restored', { name }),
            taken,
          );
        }}
      />

      <SecurityDialog
        user={securing}
        onOpenChange={(isOpen) => {
          if (!isOpen) setSecuring(null);
        }}
      />

      <ScopeDialog
        user={scoping}
        onOpenChange={(isOpen) => {
          if (!isOpen) setScoping(null);
        }}
      />
    </>
  );
}

interface EnrolDialogProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onEnrolled: () => void;
}

/** Which half of the wizard is on screen: the identity, or the role for the person `enrol` just produced. */
type EnrolStep = { readonly kind: 'identity' } | { readonly kind: 'role'; readonly user: User };

/**
 * Adding a person, then giving them somewhere to stand: `SEC-09`'s enrolment
 * followed by `SEC-01`/`SEC-04`'s assignment, as one wizard rather than a
 * dialog somebody has to reopen from the row.
 *
 * **Still two commands, not one.** `enrol` and `assign` remain separate calls
 * with separate failure domains — a taken handle and an empty confinement are
 * not the same mistake — so a person fixing one is never made to re-answer
 * the other. What changes is only that the second step opens automatically
 * with the person `enrol` just returned already standing in for it, instead
 * of asking whoever is at the keyboard to go find the row again. Declining it
 * — `Later`, or closing the wizard outright — leaves exactly the state this
 * screen already renders correctly: a person with no role yet, reachable from
 * their own row's scope action at any time.
 *
 * There is no way back to the first step. Enrolment has already happened by
 * the time the second is showing, and undoing it is a withdrawal — the same
 * command the row's own action performs — not a field this dialog could
 * silently revise out from under a person it already created.
 *
 * The password is not length-checked here. `SEC` alone knows the minimum, and
 * this dialog only ever learns it from a refusal — the same restraint
 * `NewRegisterDialog` keeps about what a prefix may contain.
 */
function EnrolDialog({ isOpen, onOpenChange, onEnrolled }: EnrolDialogProps): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { formattingLocale } = useVertex();
  const { roles, run } = useUsers();
  const { branches } = useOrganisation();
  const messageFor = useDeliveryMessage();

  const [step, setStep] = useState<EnrolStep>({ kind: 'identity' });
  const activeRoles = useMemo(() => roles.filter((one) => one.active), [roles]);

  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [missing, setMissing] = useState({ handle: false, name: false, password: false });
  const [mismatch, setMismatch] = useState(false);
  const identity = useAttempt(isOpen, () => {
    setStep({ kind: 'identity' });
    setHandle('');
    setName('');
    setPassword('');
    setConfirm('');
    setMissing({ handle: false, name: false, password: false });
    setMismatch(false);
  });

  const [selectedRoleIds, setSelectedRoleIds] = useState<ReadonlySet<string>>(new Set());
  const [reach, setReach] = useState<'tenant' | 'branches'>('tenant');
  const [chosenBranches, setChosenBranches] = useState<ReadonlySet<string>>(new Set());
  const [roleMissing, setRoleMissing] = useState({ roles: false, branches: false });
  const assignment = useAttempt(step.kind === 'role' ? step.user.id : null, () => {
    setSelectedRoleIds(new Set());
    setReach('tenant');
    setChosenBranches(new Set());
    setRoleMissing({ roles: false, branches: false });
  });

  async function submitIdentity(): Promise<void> {
    if (identity.isWorking) return;

    const blank = {
      handle: handle.trim() === '',
      name: name.trim() === '',
      password: password === '',
    };
    setMissing(blank);
    if (blank.handle || blank.name || blank.password) {
      identity.reportInvalid();
      return;
    }
    if (password !== confirm) {
      setMismatch(true);
      identity.reportInvalid();
      return;
    }
    setMismatch(false);

    const chosenHandle = handle.trim();
    const chosenName = name.trim();
    const chosenPassword = password;
    await identity.attempt(async () => {
      const delivery = await run((of) =>
        of.enrol({ handle: chosenHandle, name: chosenName, password: chosenPassword }),
      );
      if (delivery.kind === 'done') {
        onEnrolled();
        toast.show(translator.format('users.enrolled', { name: chosenName }), { tone: 'success' });
        setStep({ kind: 'role', user: delivery.value });
        return null;
      }
      return messageFor(delivery);
    });
  }

  async function submitRoles(): Promise<void> {
    if (assignment.isWorking || step.kind !== 'role') return;
    const target = step.user;

    const blank = {
      roles: selectedRoleIds.size === 0,
      branches: reach === 'branches' && chosenBranches.size === 0,
    };
    setRoleMissing(blank);
    if (blank.roles || blank.branches) {
      assignment.reportInvalid();
      return;
    }

    const chosenRoles = [...selectedRoleIds] as Role['id'][];
    const confinement = confinementOf(reach, chosenBranches);

    await assignment.attempt(async () => {
      const { assigned, refusal } = await assignEach(
        run,
        messageFor,
        target.id,
        chosenRoles,
        confinement,
      );
      if (assigned.length > 0) {
        toast.show(
          assignedMessage(
            translator,
            formattingLocale,
            target.name,
            roles.filter((one) => assigned.includes(one.id)),
          ),
          { tone: 'success' },
        );
      }
      if (refusal !== null) {
        setSelectedRoleIds(new Set(chosenRoles.filter((id) => !assigned.includes(id))));
        return refusal;
      }
      onOpenChange(false);
      return null;
    });
  }

  return (
    <Dialog
      title={
        step.kind === 'identity'
          ? translator.format('users.new.title')
          : translator.format('users.new.role.title', { name: step.user.name })
      }
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      footer={
        step.kind === 'identity' ? (
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
              isDisabled={identity.isWorking}
              onPress={() => void submitIdentity()}
            >
              {translator.format('users.new.submit')}
            </Button>
          </>
        ) : (
          <>
            <Button
              tone="secondary"
              onPress={() => {
                onOpenChange(false);
              }}
            >
              {translator.format('users.new.role.skip')}
            </Button>
            <Button
              tone="primary"
              isDisabled={assignment.isWorking}
              onPress={() => void submitRoles()}
            >
              {translator.format('users.scope.assign')}
            </Button>
          </>
        )
      }
    >
      {step.kind === 'identity' ? (
        <form
          ref={identity.formRef}
          onSubmit={(event) => {
            event.preventDefault();
            void submitIdentity();
          }}
          className="flex flex-col gap-[var(--vx-gap-md)]"
        >
          {identity.refused === null ? null : <Banner tone="danger">{identity.refused}</Banner>}
          <TextInput
            label={translator.format('users.new.name')}
            value={name}
            onChange={(next) => {
              setName(next);
              setMissing((was) => ({ ...was, name: false }));
            }}
            autoFocus
            isRequired
            {...(missing.name
              ? { errorMessage: translator.format('users.new.name.required') }
              : {})}
          />
          <TextInput
            label={translator.format('users.new.handle')}
            description={translator.format('users.new.handle.description')}
            value={handle}
            onChange={(next) => {
              setHandle(next);
              setMissing((was) => ({ ...was, handle: false }));
            }}
            isRequired
            isMachineText
            {...(missing.handle
              ? { errorMessage: translator.format('users.new.handle.required') }
              : {})}
          />
          <TextInput
            label={translator.format('users.new.password')}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(next) => {
              setPassword(next);
              setMissing((was) => ({ ...was, password: false }));
              setMismatch(false);
            }}
            isRequired
            {...(missing.password
              ? { errorMessage: translator.format('users.new.password.required') }
              : {})}
          />
          <TextInput
            label={translator.format('users.new.password.confirm')}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(next) => {
              setConfirm(next);
              setMismatch(false);
            }}
            isRequired
            {...(mismatch
              ? { errorMessage: translator.format('users.new.password.mismatch') }
              : {})}
          />
          <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
        </form>
      ) : (
        <form
          ref={assignment.formRef}
          onSubmit={(event) => {
            event.preventDefault();
            void submitRoles();
          }}
          className="flex flex-col gap-[var(--vx-gap-md)]"
        >
          {assignment.refused === null ? null : <Banner tone="danger">{assignment.refused}</Banner>}
          <p className="text-body text-fg-secondary">
            {translator.format('users.new.role.description', { name: step.user.name })}
          </p>
          <RoleReachFields
            roles={activeRoles}
            selectedRoleIds={selectedRoleIds}
            onSelectedRoleIdsChange={(next) => {
              setSelectedRoleIds(next);
              setRoleMissing((was) => ({ ...was, roles: false }));
            }}
            heldRoleIds={NO_ROLES}
            rolesMissing={roleMissing.roles}
            branches={branches}
            reach={reach}
            onReachChange={(next) => {
              setReach(next);
              setRoleMissing((was) => ({ ...was, branches: false }));
            }}
            chosenBranches={chosenBranches}
            onChosenBranchesChange={(next) => {
              setChosenBranches(next);
              setRoleMissing((was) => ({ ...was, branches: false }));
            }}
            branchesMissing={roleMissing.branches}
          />
          <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
        </form>
      )}
    </Dialog>
  );
}

interface SecurityDialogProps {
  readonly user: User | null;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/**
 * A new password, and ending every session this person holds — `SEC-09`'s two
 * commands that spend something nobody can give back: a secret, and a shift
 * that was mid-sale somewhere. Both are stated in one place because both are
 * about the same question — can this person keep working as themselves right
 * now — and a manager reaching for one is often about to reach for the other.
 *
 * **No second confirmation step**, the same restraint `DeviceDialog` keeps
 * about replacing a machine: what forcing a sign-out costs is said beside the
 * button, read once by somebody about to press it, rather than behind a second
 * dialog they learn to click through.
 */
function SecurityDialog({ user, onOpenChange }: SecurityDialogProps): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { run } = useUsers();
  const messageFor = useDeliveryMessage();

  const [password, setPassword] = useState('');
  const [isMissing, setIsMissing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetRefused, setResetRefused] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutRefused, setSignOutRefused] = useState<string | null>(null);
  const resetFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (user === null) return;
    setPassword('');
    setIsMissing(false);
    setIsResetting(false);
    setResetRefused(null);
    setIsSigningOut(false);
    setSignOutRefused(null);
  }, [user]);

  async function resetPassword(): Promise<void> {
    if (isResetting || user === null) return;
    if (password === '') {
      setIsMissing(true);
      setResetRefused(null);
      focusFirstInvalid(resetFormRef.current);
      return;
    }

    const target = user;
    setIsResetting(true);
    setResetRefused(null);
    const delivery = await run((of) => of.resetPassword(target.id, password));
    setIsResetting(false);

    const message = messageFor(delivery);
    if (message === null) {
      setPassword('');
      toast.show(translator.format('users.security.resetPassword.done', { name: target.name }), {
        tone: 'success',
      });
    } else {
      setResetRefused(message);
    }
  }

  async function signOut(): Promise<void> {
    if (isSigningOut || user === null) return;

    const target = user;
    setIsSigningOut(true);
    setSignOutRefused(null);
    const delivery = await run((of) => of.forceSignOut(target.id));
    setIsSigningOut(false);

    const message = messageFor(delivery);
    if (message === null) {
      toast.show(translator.format('users.security.forceSignOut.done', { name: target.name }), {
        tone: 'success',
      });
    } else {
      setSignOutRefused(message);
    }
  }

  return (
    <Dialog
      title={translator.format('users.security.title', { name: user?.name ?? '' })}
      isOpen={user !== null}
      onOpenChange={onOpenChange}
    >
      <div className="flex flex-col gap-[var(--vx-gap-lg)]">
        {/* A shared sign-in's password is never reset from one shop (`SEC-09`),
            and `SEC` refuses it every time. The row already knows it is shared,
            so the screen says why instead of offering a field that can only be
            refused after somebody has typed a password into it. */}
        {user?.shared === true ? (
          <Banner tone="info">{translator.format('refusal.sec.identity-shared')}</Banner>
        ) : (
          <form
            ref={resetFormRef}
            onSubmit={(event) => {
              event.preventDefault();
              void resetPassword();
            }}
            className="flex flex-col gap-[var(--vx-gap-sm)]"
          >
            {resetRefused === null ? null : <Banner tone="danger">{resetRefused}</Banner>}
            <TextInput
              label={translator.format('users.security.resetPassword')}
              type="password"
              // Somebody else's new password. Without this a password manager
              // offers the administrator's own saved one for the field.
              autoComplete="new-password"
              value={password}
              onChange={(next) => {
                setPassword(next);
                setIsMissing(false);
              }}
              {...(isMissing
                ? { errorMessage: translator.format('users.new.password.required') }
                : {})}
            />
            <div>
              <Button tone="primary" isDisabled={isResetting} onPress={() => void resetPassword()}>
                {translator.format('users.security.resetPassword.submit')}
              </Button>
            </div>
            <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
          </form>
        )}

        <div className="border-line flex flex-col gap-[var(--vx-gap-sm)] border-t pt-[var(--vx-gap-lg)]">
          {signOutRefused === null ? null : <Banner tone="danger">{signOutRefused}</Banner>}
          <p className="text-footnote text-fg-secondary">
            {translator.format('users.security.forceSignOut.description', {
              name: user?.name ?? '',
            })}
          </p>
          <div>
            <Button tone="danger" isDisabled={isSigningOut} onPress={() => void signOut()}>
              {translator.format('users.security.forceSignOut')}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

interface ScopeDialogProps {
  readonly user: User | null;
  readonly onOpenChange: (isOpen: boolean) => void;
}

/**
 * The role a person holds, and where it reaches — `SEC-01` and `SEC-04`
 * together, because a role assigned with no scope is half an answer.
 *
 * Branch-level only: `Confinement` can narrow further, to specific locations
 * within a branch, and this dialog does not yet offer that — a screen never
 * invents a control (`CLAUDE.md`), and nothing here has needed one yet. It
 * arrives with the screen that first does.
 */
function ScopeDialog({ user, onOpenChange }: ScopeDialogProps): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { formattingLocale } = useVertex();
  const { roles, run, ofRecord } = useUsers();
  const { branches } = useOrganisation();
  const messageFor = useDeliveryMessage();

  const readAssignments = useCallback((id: User['id']) => ofRecord.assignments.of(id), [ofRecord]);
  const assignments = useLoaded(user?.id ?? null, readAssignments);

  const activeRoles = useMemo(() => roles.filter((one) => one.active), [roles]);
  const heldRoleIds = useMemo(
    () => new Set((assignments.value ?? []).map((one) => one.role)),
    [assignments.value],
  );

  const [selectedRoleIds, setSelectedRoleIds] = useState<ReadonlySet<string>>(new Set());
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState<Assignment | null>(null);
  const [reach, setReach] = useState<'tenant' | 'branches'>('tenant');
  const [chosenBranches, setChosenBranches] = useState<ReadonlySet<string>>(new Set());
  const [missing, setMissing] = useState({ roles: false, branches: false });
  const {
    isWorking,
    refused,
    setRefused,
    formRef,
    reportInvalid,
    attempt: attemptWith,
  } = useAttempt(user, () => {
    setSelectedRoleIds(new Set());
    setReach('tenant');
    setChosenBranches(new Set());
    setMissing({ roles: false, branches: false });
  });

  /** Every checked role under the one reach chosen for them — `assignEach`. */
  async function assign(): Promise<void> {
    if (isWorking || user === null) return;

    const blank = {
      roles: selectedRoleIds.size === 0,
      branches: reach === 'branches' && chosenBranches.size === 0,
    };
    setMissing(blank);
    if (blank.roles || blank.branches) {
      reportInvalid();
      return;
    }

    const target = user;
    const chosenRoles = [...selectedRoleIds] as Role['id'][];
    const confinement = confinementOf(reach, chosenBranches);

    await attemptWith(async () => {
      const { assigned, refusal } = await assignEach(
        run,
        messageFor,
        target.id,
        chosenRoles,
        confinement,
      );
      // Reloaded whenever anything went through, a refusal part-way included:
      // the list above is what this person holds, and it must not go on
      // saying they hold less than they do.
      if (assigned.length > 0) {
        assignments.reload();
        toast.show(
          assignedMessage(
            translator,
            formattingLocale,
            target.name,
            roles.filter((one) => assigned.includes(one.id)),
          ),
          { tone: 'success' },
        );
      }
      if (refusal !== null) {
        setSelectedRoleIds(new Set(chosenRoles.filter((id) => !assigned.includes(id))));
        return refusal;
      }
      setSelectedRoleIds(new Set());
      setReach('tenant');
      setChosenBranches(new Set());
      return null;
    });
  }

  async function withdraw(assignment: Assignment): Promise<void> {
    if (user === null || withdrawing !== null) return;
    const target = user;
    const role = roles.find((one) => one.id === assignment.role);

    // One at a time. A second press while the first was still out sent the
    // command twice, and a success toast arrived beside a refusal saying the
    // assignment no longer existed.
    setWithdrawing(assignment.role);
    const delivery = await run((of) => of.assignments.withdraw(target.id, assignment.role));
    setWithdrawing(null);
    const message = messageFor(delivery);
    if (message === null) {
      assignments.reload();
      toast.show(
        translator.format('users.scope.withdrawn', {
          name: target.name,
          role: role === undefined ? '' : roleLabel(translator, role),
        }),
        { tone: 'success' },
      );
    } else {
      setRefused(message);
    }
  }

  const confirmingRole =
    confirmingWithdraw === null
      ? null
      : (roles.find((one) => one.id === confirmingWithdraw.role) ?? null);

  return (
    <>
      <Dialog
        title={translator.format('users.scope.title', { name: user?.name ?? '' })}
        isOpen={user !== null}
        onOpenChange={onOpenChange}
        className="max-w-[36rem]"
      >
        <div className="flex flex-col gap-[var(--vx-gap-lg)]">
          {refused === null ? null : <Banner tone="danger">{refused}</Banner>}

          <div className="flex flex-col gap-[var(--vx-gap-sm)]">
            <p className="text-footnote font-body-medium text-fg-secondary">
              {translator.format('users.scope.current')}
            </p>
            {/* "Holds no role" is a statement about this person, and it was shown
                while the read was still out and after it had failed — somebody
                was told a person held nothing and granted a role on that basis. */}
            {assignments.value === null ? (
              <ReadState loaded={assignments} />
            ) : assignments.value.length === 0 ? (
              <p className="text-body text-fg-secondary">{translator.format('users.scope.none')}</p>
            ) : (
              <ul className="flex flex-col gap-[var(--vx-gap-xs)]">
                {assignments.value.map((assignment) => {
                  const role = roles.find((one) => one.id === assignment.role);
                  return (
                    <li
                      key={assignment.role}
                      className="border-line flex items-center justify-between gap-[var(--vx-gap-sm)] rounded-[var(--vx-radius)] border px-[var(--vx-pad-md)] py-[var(--vx-pad-sm)]"
                    >
                      <span className="flex flex-col">
                        <span className="font-body-medium">
                          {role === undefined
                            ? translator.format('data.unknown')
                            : roleLabel(translator, role)}
                        </span>
                        <span className="text-footnote text-fg-secondary">
                          {assignment.confinement.kind === 'tenant'
                            ? translator.format('users.scope.tenantWide')
                            : branchNames(
                                formattingLocale,
                                branches,
                                assignment.confinement.branches,
                              )}
                        </span>
                      </span>
                      <div className="flex gap-[var(--vx-gap-sm)]">
                        {/* Only for a role that can still be assigned: a
                            withdrawn one is not in the list below to be seen
                            ticked, and `SEC` would refuse it. */}
                        {role?.active !== true ? null : (
                          <Button
                            onPress={() => {
                              setSelectedRoleIds(new Set([assignment.role]));
                              setReach(assignment.confinement.kind);
                              setChosenBranches(
                                assignment.confinement.kind === 'branches'
                                  ? new Set(assignment.confinement.branches)
                                  : new Set(),
                              );
                              setMissing({ roles: false, branches: false });
                              formRef.current?.scrollIntoView({
                                behavior: 'smooth',
                                block: 'start',
                              });
                            }}
                          >
                            {translator.format('users.scope.editReach')}
                          </Button>
                        )}
                        <Button
                          isDisabled={withdrawing !== null}
                          onPress={() => {
                            setConfirmingWithdraw(assignment);
                          }}
                        >
                          {translator.format('users.scope.withdraw')}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <form
            ref={formRef}
            onSubmit={(event) => {
              event.preventDefault();
              void assign();
            }}
            className="border-line flex flex-col gap-[var(--vx-gap-md)] border-t pt-[var(--vx-gap-lg)]"
          >
            <p className="text-footnote font-body-medium text-fg-secondary">
              {translator.format('users.scope.assign.title')}
            </p>
            <RoleReachFields
              roles={activeRoles}
              selectedRoleIds={selectedRoleIds}
              onSelectedRoleIdsChange={(next) => {
                setSelectedRoleIds(next);
                setMissing((was) => ({ ...was, roles: false }));
              }}
              heldRoleIds={heldRoleIds}
              rolesMissing={missing.roles}
              branches={branches}
              reach={reach}
              onReachChange={(next) => {
                setReach(next);
                setMissing((was) => ({ ...was, branches: false }));
              }}
              chosenBranches={chosenBranches}
              onChosenBranchesChange={(next) => {
                setChosenBranches(next);
                setMissing((was) => ({ ...was, branches: false }));
              }}
              branchesMissing={missing.branches}
            />
            <div>
              <Button tone="primary" isDisabled={isWorking} onPress={() => void assign()}>
                {translator.format('users.scope.assign')}
              </Button>
            </div>
            <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
          </form>
        </div>
      </Dialog>

      <ConfirmationDialog
        title={translator.format('users.scope.withdraw.confirm.title')}
        message={translator.format('users.scope.withdraw.confirm.message', {
          name: user?.name ?? '',
          role: confirmingRole === null ? '' : roleLabel(translator, confirmingRole),
        })}
        confirmLabel={translator.format('users.scope.withdraw')}
        tone="danger"
        isOpen={confirmingWithdraw !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setConfirmingWithdraw(null);
        }}
        onConfirm={() => {
          if (confirmingWithdraw === null) return;
          const taken = confirmingWithdraw;
          setConfirmingWithdraw(null);
          void withdraw(taken);
        }}
      />
    </>
  );
}
