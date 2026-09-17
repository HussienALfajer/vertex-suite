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
  PageHeader,
  Panel,
  Select,
  TableRowAction,
  TableRowActions,
  TextInput,
  useAttempt,
  useToast,
  useTranslator,
  useVertex,
  type DataTableColumn,
  type SelectOption,
} from '@vertex/ui';
import type { Result } from '@vertex/kernel';
import type { Branch } from '@vertex/sys/contract';
import type { Assignment, Role, SecRefusal, User } from '@vertex/sec/contract';

import { useDeliveryMessage, useLoaded, useOrganisation } from '../organisation.js';
import type { UsersOfRecord } from '../system.js';
import {
  ReadState,
  branchNames,
  ListingBar,
  NameDialog,
  ReachFields,
  RenameIcon,
  RestoreIcon,
  roleLabel,
  ScopeIcon,
  SecurityIcon,
  StatusBadge,
  WithdrawIcon,
  matchesQuery,
} from './structure.js';
import { useUsers } from '../users.js';

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

/**
 * Adding a person: their handle, their name, and a password to start with.
 *
 * **Role and scope are not asked here.** `enrol` and `assign` are two different
 * commands in the domain this screen is built against, and a dialog that did
 * both would refuse for either reason at once — a taken handle and an empty
 * confinement are not the same mistake, and a person fixing one should not have
 * to re-answer the other. A new person is assigned a role from the row the
 * moment they exist, the same two-step shape `Registers` already uses for a
 * till and the machine standing at it.
 *
 * The password is not length-checked here. `SEC` alone knows the minimum, and
 * this dialog only ever learns it from a refusal — the same restraint
 * `NewRegisterDialog` keeps about what a prefix may contain.
 */
function EnrolDialog({ isOpen, onOpenChange, onEnrolled }: EnrolDialogProps): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { run } = useUsers();
  const messageFor = useDeliveryMessage();

  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [missing, setMissing] = useState({ handle: false, name: false, password: false });
  const [mismatch, setMismatch] = useState(false);
  const {
    isWorking,
    refused,
    setRefused,
    attempt: attemptWith,
  } = useAttempt(isOpen, () => {
    setHandle('');
    setName('');
    setPassword('');
    setConfirm('');
    setMissing({ handle: false, name: false, password: false });
    setMismatch(false);
  });

  async function attempt(): Promise<void> {
    if (isWorking) return;

    const blank = {
      handle: handle.trim() === '',
      name: name.trim() === '',
      password: password === '',
    };
    setMissing(blank);
    if (blank.handle || blank.name || blank.password) {
      setRefused(null);
      return;
    }
    if (password !== confirm) {
      setMismatch(true);
      setRefused(null);
      return;
    }
    setMismatch(false);

    const chosenHandle = handle.trim();
    const chosenName = name.trim();
    const chosenPassword = password;
    await attemptWith(async () => {
      const delivery = await run((of) =>
        of.enrol({ handle: chosenHandle, name: chosenName, password: chosenPassword }),
      );
      const message = messageFor(delivery);
      if (message === null) {
        onEnrolled();
        toast.show(translator.format('users.enrolled', { name: chosenName }), { tone: 'success' });
        onOpenChange(false);
      }
      return message;
    });
  }

  return (
    <Dialog
      title={translator.format('users.new.title')}
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
            {translator.format('users.new.submit')}
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
          label={translator.format('users.new.name')}
          value={name}
          onChange={(next) => {
            setName(next);
            setMissing((was) => ({ ...was, name: false }));
          }}
          autoFocus
          isRequired
          {...(missing.name ? { errorMessage: translator.format('users.new.name.required') } : {})}
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
          {...(mismatch ? { errorMessage: translator.format('users.new.password.mismatch') } : {})}
        />
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden="true" />
      </form>
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

  const [roleId, setRoleId] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [reach, setReach] = useState<'tenant' | 'branches'>('tenant');
  const [chosenBranches, setChosenBranches] = useState<ReadonlySet<string>>(new Set());
  const [missing, setMissing] = useState({ role: false, branches: false });
  const {
    isWorking,
    refused,
    setRefused,
    attempt: attemptWith,
  } = useAttempt(user, () => {
    setRoleId(null);
    setReach('tenant');
    setChosenBranches(new Set());
    setMissing({ role: false, branches: false });
  });

  async function assign(): Promise<void> {
    if (isWorking || user === null) return;

    const blank = {
      role: roleId === null,
      branches: reach === 'branches' && chosenBranches.size === 0,
    };
    setMissing(blank);
    if (blank.role || blank.branches) {
      setRefused(null);
      return;
    }

    const target = user;
    const chosenRole = roleId as Role['id'];
    const confinement =
      reach === 'tenant'
        ? ({ kind: 'tenant' } as const)
        : {
            kind: 'branches' as const,
            branches: [...chosenBranches] as Branch['id'][],
            locations: [],
          };

    await attemptWith(async () => {
      const delivery = await run((of) =>
        of.assignments.assign({ user: target.id, role: chosenRole, confinement }),
      );
      const message = messageFor(delivery);
      if (message === null) {
        assignments.reload();
        const role = roles.find((one) => one.id === chosenRole);
        toast.show(
          translator.format('users.scope.assigned', {
            name: target.name,
            role: role === undefined ? '' : roleLabel(translator, role),
          }),
          { tone: 'success' },
        );
        setRoleId(null);
        setReach('tenant');
        setChosenBranches(new Set());
      }
      return message;
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

  const roleOptions: readonly SelectOption[] = activeRoles.map((one) => ({
    id: one.id,
    label: roleLabel(translator, one),
  }));

  return (
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
                    <Button
                      isDisabled={withdrawing !== null}
                      onPress={() => {
                        void withdraw(assignment);
                      }}
                    >
                      {translator.format('users.scope.withdraw')}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void assign();
          }}
          className="border-line flex flex-col gap-[var(--vx-gap-md)] border-t pt-[var(--vx-gap-lg)]"
        >
          <p className="text-footnote font-body-medium text-fg-secondary">
            {translator.format('users.scope.assign.title')}
          </p>
          <Select
            label={translator.format('users.scope.role')}
            placeholder={translator.format('users.scope.role.placeholder')}
            options={roleOptions}
            value={roleId}
            onChange={(key) => {
              setRoleId(String(key));
              setMissing((was) => ({ ...was, role: false }));
            }}
            {...(missing.role
              ? { errorMessage: translator.format('users.scope.role.required') }
              : {})}
          />
          <ReachFields
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
  );
}
