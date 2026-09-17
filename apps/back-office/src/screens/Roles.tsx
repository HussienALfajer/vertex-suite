import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { isStandardAction, partsOf, STANDARD_ACTIONS, type PermissionId } from '@vertex/contracts';
import type { Result } from '@vertex/kernel';
import {
  actionsColumnWidth,
  Banner,
  Button,
  ConfirmationDialog,
  DataTable,
  PageHeader,
  Panel,
  Select,
  Switch,
  TableRowAction,
  TableRowActions,
  useAttempt,
  useToast,
  useTranslator,
  useVertex,
  type DataTableColumn,
  type SelectOption,
} from '@vertex/ui';
import type { Branch } from '@vertex/sys/contract';
import type { Assignment, Role, SecRefusal, User } from '@vertex/sec/contract';

import { nameOfPermission } from '../catalogue.js';
import { useDeliveryMessage, useLoaded, useOrganisation } from '../organisation.js';
import { hrefOf, redirect, useNavigateTo, useRoute } from '../routing.js';
import type { DeclaredRight, UsersOfRecord } from '../system.js';
import {
  ReadState,
  branchNames,
  ListingBar,
  NameDialog,
  OpenListIcon,
  ReachFields,
  RenameIcon,
  RestoreIcon,
  roleLabel,
  StatusBadge,
  WithdrawIcon,
  matchesQuery,
} from './structure.js';
import { UsersStaleBanner } from './Users.js';
import { useUsers } from '../users.js';

/**
 * `SEC-01` and `SEC-02`: the roles themselves, and what each one holds.
 *
 * One screen with two things opened into it rather than three screens, because
 * they are one question asked from one side each time: a role's own list, what
 * it may do (the grid), and who it reaches (its holders). `Users.tsx`'s scope
 * dialog answers the same last question from the **user**'s side — a manager
 * of one branch and a floor supervisor covering another needs that view too —
 * and neither repeats the other's command: both call the same `assign` and
 * `withdraw`.
 *
 * A role is opened by its identifier in the address (`route.subject`), the
 * same device `BusinessProfile` and `Branches` already use to say what a
 * screen is looking at without inventing a second frame around this one.
 */

/** `resourceKey` is the namespace-qualified pair `partsOf` split off — `sys.branch`, not `branch`. */
function resourceLabel(translator: ReturnType<typeof useTranslator>, resourceKey: string): string {
  const key = `permission.resource.${resourceKey}`;
  return translator.has(key) ? translator.format(key) : resourceKey;
}

interface GridRow {
  readonly id: string;
  /** `<namespace>.<resource>` — what names both the row and its catalogue key. */
  readonly resourceKey: string;
  readonly standard: ReadonlyMap<string, PermissionId>;
}

/**
 * `registry.permissions`, laid out the way `SEC-02` states the rule: one row
 * per resource, one column per one of the five actions. Grouped by
 * `partsOf(id).resource` rather than by any list this screen keeps of its
 * own, so a module that declares a sixth resource tomorrow gets a row here
 * without this file changing.
 */
function standardGrid(rights: readonly DeclaredRight[]): readonly GridRow[] {
  const byResource = new Map<string, Map<string, PermissionId>>();
  for (const right of rights) {
    const { namespace, resource, action } = partsOf(right.id);
    if (!isStandardAction(action)) continue;
    const resourceKey = `${namespace}.${resource}`;
    const row = byResource.get(resourceKey) ?? new Map<string, PermissionId>();
    row.set(action, right.id);
    byResource.set(resourceKey, row);
  }
  return [...byResource.entries()]
    .map(([resourceKey, standard]) => ({ id: resourceKey, resourceKey, standard }))
    .sort((a, b) => a.resourceKey.localeCompare(b.resourceKey));
}

/** The rights outside the five — `SEC-09`'s reset-password and force-sign-out among them. */
function extraRights(rights: readonly DeclaredRight[]): readonly PermissionId[] {
  return rights.filter((one) => !isStandardAction(partsOf(one.id).action)).map((one) => one.id);
}

export function Roles(): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { roles, rights, isLoading, run, reload } = useUsers();
  const messageFor = useDeliveryMessage();
  const route = useRoute();
  const goTo = useNavigateTo();

  const [query, setQuery] = useState('');
  const [includeWithdrawn, setIncludeWithdrawn] = useState(false);
  const [isDefining, setIsDefining] = useState(false);
  const [renaming, setRenaming] = useState<Role | null>(null);
  const [withdrawing, setWithdrawing] = useState<Role | null>(null);
  const [restoring, setRestoring] = useState<Role | null>(null);

  const rows = useMemo(
    () =>
      roles.filter(
        (one) =>
          (includeWithdrawn || one.active) && matchesQuery(roleLabel(translator, one), query),
      ),
    [roles, includeWithdrawn, query, translator],
  );

  const opened = useMemo(
    () => roles.find((one) => one.id === route.subject) ?? null,
    [roles, route.subject],
  );

  // An address naming a role this shop does not have — an old link, a role of
  // another shop — was ignored, and the address went on naming it. It is
  // replaced with the listing, which is what is on screen.
  useEffect(() => {
    if (!isLoading && route.subject !== null && opened === null) redirect(hrefOf('roles'));
  }, [isLoading, route.subject, opened]);

  async function command(
    work: (of: UsersOfRecord) => Promise<Result<Role, SecRefusal>>,
    said: (name: string) => string,
    on: Role,
  ): Promise<void> {
    const delivery = await run(work);
    const message = messageFor(delivery);
    toast.show(
      message ?? said(roleLabel(translator, on)),
      message === null ? { tone: 'success' } : { tone: 'danger' },
    );
  }

  const columns: readonly DataTableColumn<Role>[] = [
    {
      id: 'name',
      header: translator.format('roles.column.name'),
      isRowHeader: true,
      render: (role) => <span className="font-body-medium">{roleLabel(translator, role)}</span>,
    },
    {
      id: 'status',
      header: translator.format('roles.column.status'),
      render: (role) => <StatusBadge isActive={role.active} />,
    },
    {
      id: 'actions',
      header: translator.format('roles.column.actions'),
      align: 'end',
      width: actionsColumnWidth(3),
      render: (role) => (
        <TableRowActions>
          <TableRowAction
            aria-label={translator.format('roles.open.action')}
            onPress={() => {
              goTo('roles', role.id);
            }}
          >
            <OpenListIcon />
          </TableRowAction>
          <TableRowAction
            aria-label={translator.format('roles.rename.title')}
            onPress={() => {
              setRenaming(role);
            }}
          >
            <RenameIcon />
          </TableRowAction>
          {role.active ? (
            <TableRowAction
              aria-label={translator.format('roles.withdraw.title')}
              onPress={() => {
                setWithdrawing(role);
              }}
            >
              <WithdrawIcon />
            </TableRowAction>
          ) : (
            <TableRowAction
              aria-label={translator.format('roles.restore.title')}
              onPress={() => {
                setRestoring(role);
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
        title={translator.format('roles.title')}
        description={translator.format('roles.description')}
        actions={
          <Button
            tone="primary"
            onPress={() => {
              setIsDefining(true);
            }}
          >
            {translator.format('roles.define')}
          </Button>
        }
      />

      <UsersStaleBanner />

      <ListingBar
        searchLabel={translator.format('roles.search')}
        query={query}
        onQuery={setQuery}
        includeWithdrawn={includeWithdrawn}
        onIncludeWithdrawn={setIncludeWithdrawn}
      />

      <Panel flush>
        <DataTable
          label={translator.format('roles.table')}
          columns={columns}
          rows={rows}
          emptyMessage={translator.format(
            isLoading
              ? 'data.loading'
              : rows.length === 0 && query === '' && !includeWithdrawn
                ? 'roles.empty'
                : 'listing.noMatch',
          )}
        />
      </Panel>

      {opened === null ? null : (
        <RoleDetail
          role={opened}
          rights={rights}
          onClose={() => {
            goTo('roles');
          }}
        />
      )}

      <NameDialog
        title={translator.format('roles.new.title')}
        label={translator.format('roles.new.name')}
        submitLabel={translator.format('roles.new.submit')}
        isOpen={isDefining}
        onOpenChange={setIsDefining}
        onSubmit={async (name) => {
          const delivery = await run((of) => of.roles.define({ name }));
          const message = messageFor(delivery);
          if (message === null) {
            reload();
            toast.show(translator.format('roles.defined', { name }), { tone: 'success' });
          }
          return message;
        }}
      />

      <NameDialog
        title={translator.format('roles.rename.title')}
        label={translator.format('roles.new.name')}
        submitLabel={translator.format('action.rename')}
        initialName={renaming === null ? '' : roleLabel(translator, renaming)}
        isOpen={renaming !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRenaming(null);
        }}
        onSubmit={async (name) => {
          if (renaming === null) return null;
          const delivery = await run((of) => of.roles.rename(renaming.id, name));
          const message = messageFor(delivery);
          if (message === null) {
            reload();
            toast.show(translator.format('roles.renamed', { name }), { tone: 'success' });
          }
          return message;
        }}
      />

      <ConfirmationDialog
        title={translator.format('roles.withdraw.title')}
        message={translator.format('roles.withdraw.message', {
          name: withdrawing === null ? '' : roleLabel(translator, withdrawing),
        })}
        confirmLabel={translator.format('roles.withdraw')}
        tone="danger"
        isOpen={withdrawing !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setWithdrawing(null);
        }}
        onConfirm={() => {
          if (withdrawing === null) return;
          const taken = withdrawing;
          void command(
            (of) => of.roles.withdraw(taken.id),
            (name) => translator.format('roles.withdrawn', { name }),
            taken,
          );
        }}
      />

      <ConfirmationDialog
        title={translator.format('roles.restore.title')}
        message={translator.format('roles.restore.message', {
          name: restoring === null ? '' : roleLabel(translator, restoring),
        })}
        confirmLabel={translator.format('roles.restore')}
        isOpen={restoring !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setRestoring(null);
        }}
        onConfirm={() => {
          if (restoring === null) return;
          const taken = restoring;
          void command(
            (of) => of.roles.restore(taken.id),
            (name) => translator.format('roles.restored', { name }),
            taken,
          );
        }}
      />
    </>
  );
}

interface RoleDetailProps {
  readonly role: Role;
  readonly rights: readonly DeclaredRight[];
  readonly onClose: () => void;
}

/** What a role is, opened: the grid it grants through, and who it reaches. */
function RoleDetail({ role, rights, onClose }: RoleDetailProps): ReactNode {
  const translator = useTranslator();
  return (
    <Panel
      title={roleLabel(translator, role)}
      actions={<Button onPress={onClose}>{translator.format('action.close')}</Button>}
    >
      <div className="flex flex-col gap-[var(--vx-gap-lg)]">
        <PermissionsGrid role={role} rights={rights} />
        <HoldersSection role={role} />
      </div>
    </Panel>
  );
}

interface PermissionsGridProps {
  readonly role: Role;
  readonly rights: readonly DeclaredRight[];
}

/**
 * `SEC-02`: one switch per (resource, action) this role does or does not
 * hold. `Switch`, not `Checkbox` — every cell is its own command, granted or
 * revoked the moment it is toggled, which is exactly the distinction
 * `Toggle.tsx` draws between the two controls.
 *
 * A cell with no control at all is not a missing feature: it is a resource
 * that never declared this particular action — `sys.business-profile` has no
 * `delete`, because a company's own business profile is revised, not removed.
 */
function PermissionsGrid({ role, rights }: PermissionsGridProps): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { run } = useUsers();
  const messageFor = useDeliveryMessage();

  const grid = useMemo(() => standardGrid(rights), [rights]);
  const extra = useMemo(() => extraRights(rights), [rights]);

  async function toggle(id: PermissionId, isGranted: boolean): Promise<void> {
    const delivery = await run((of) =>
      isGranted ? of.roles.revoke(role.id, [id]) : of.roles.grant(role.id, [id]),
    );
    const message = messageFor(delivery);
    toast.show(
      message ??
        translator.format(isGranted ? 'roles.rights.revoked' : 'roles.rights.granted', {
          role: roleLabel(translator, role),
          right: nameOfPermission(translator, id),
        }),
      message === null ? { tone: 'success' } : { tone: 'danger' },
    );
  }

  const columns: readonly DataTableColumn<GridRow>[] = [
    {
      id: 'resource',
      header: translator.format('roles.rights.resource'),
      isRowHeader: true,
      render: (row) => (
        <span className="font-body-medium">{resourceLabel(translator, row.resourceKey)}</span>
      ),
    },
    ...STANDARD_ACTIONS.map((action) => ({
      id: action,
      header: translator.format(`permission.action.${action}`),
      render: (row: GridRow) => {
        const id = row.standard.get(action);
        if (id === undefined) {
          return (
            <span aria-hidden="true" className="text-fg-disabled">
              —
            </span>
          );
        }
        const granted = role.rights.includes(id);
        return (
          <Switch
            isSelected={granted}
            // A withdrawn role takes no grant — `SEC` refuses it — so its grid
            // is read, not edited, until the role is restored.
            isDisabled={!role.active}
            onChange={() => void toggle(id, granted)}
          >
            <span className="sr-only">{nameOfPermission(translator, id)}</span>
          </Switch>
        );
      },
    })),
  ];

  return (
    <div className="flex flex-col gap-[var(--vx-gap-md)]">
      <div className="flex flex-col gap-[var(--vx-gap-xs)]">
        <h3 className="text-heading font-body-semibold text-fg">
          {translator.format('roles.rights.title')}
        </h3>
        <p className="text-body text-fg-secondary">
          {translator.format('roles.rights.description')}
        </p>
      </div>
      <Panel flush>
        <DataTable
          label={translator.format('roles.rights.title')}
          columns={columns}
          rows={grid}
          emptyMessage={translator.format('listing.noMatch')}
        />
      </Panel>
      {extra.length === 0 ? null : (
        <div className="flex flex-col gap-[var(--vx-gap-sm)]">
          <p className="text-footnote font-body-medium text-fg-secondary">
            {translator.format('roles.rights.extra')}
          </p>
          {extra.map((id) => {
            const granted = role.rights.includes(id);
            return (
              <Switch
                key={id}
                isSelected={granted}
                isDisabled={!role.active}
                onChange={() => void toggle(id, granted)}
              >
                {nameOfPermission(translator, id)}
              </Switch>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface HoldersSectionProps {
  readonly role: Role;
}

/**
 * `SEC-04` from the role's own side. `Users.tsx`'s `ScopeDialog` answers the
 * identical question from a user's side — fixing the role and choosing among
 * users here, fixing the user and choosing among roles there — and both call
 * the same `assignments.assign` / `assignments.withdraw`, so a scope granted
 * from either screen is exactly as visible from the other.
 */
function HoldersSection({ role }: HoldersSectionProps): ReactNode {
  const translator = useTranslator();
  const toast = useToast();
  const { formattingLocale } = useVertex();
  const { users, run, ofRecord } = useUsers();
  const { branches } = useOrganisation();
  const messageFor = useDeliveryMessage();

  const readHolders = useCallback(
    (id: Role['id']) => ofRecord.assignments.holdersOf(id),
    [ofRecord],
  );
  const holders = useLoaded(role.id, readHolders);

  const activeUsers = useMemo(() => users.filter((one) => one.active), [users]);

  const [userId, setUserId] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const [reach, setReach] = useState<'tenant' | 'branches'>('tenant');
  const [chosenBranches, setChosenBranches] = useState<ReadonlySet<string>>(new Set());
  const [missing, setMissing] = useState({ user: false, branches: false });
  const {
    isWorking,
    refused,
    setRefused,
    attempt: attemptWith,
  } = useAttempt(role.id, () => {
    setUserId(null);
    setReach('tenant');
    setChosenBranches(new Set());
    setMissing({ user: false, branches: false });
  });

  async function assign(): Promise<void> {
    if (isWorking) return;

    const blank = {
      user: userId === null,
      branches: reach === 'branches' && chosenBranches.size === 0,
    };
    setMissing(blank);
    if (blank.user || blank.branches) {
      setRefused(null);
      return;
    }

    const chosenUser = userId as User['id'];
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
        of.assignments.assign({ user: chosenUser, role: role.id, confinement }),
      );
      const message = messageFor(delivery);
      if (message === null) {
        holders.reload();
        const person = users.find((one) => one.id === chosenUser);
        toast.show(
          translator.format('users.scope.assigned', {
            name: person?.name ?? '',
            role: roleLabel(translator, role),
          }),
          { tone: 'success' },
        );
        setUserId(null);
        setReach('tenant');
        setChosenBranches(new Set());
      }
      return message;
    });
  }

  async function withdraw(assignment: Assignment): Promise<void> {
    if (withdrawing !== null) return;
    const person = users.find((one) => one.id === assignment.user);
    // One at a time, for the reason the person's own dialog gives.
    setWithdrawing(assignment.user);
    const delivery = await run((of) => of.assignments.withdraw(assignment.user, role.id));
    setWithdrawing(null);
    const message = messageFor(delivery);
    if (message === null) {
      holders.reload();
      toast.show(
        translator.format('users.scope.withdrawn', {
          name: person?.name ?? '',
          role: roleLabel(translator, role),
        }),
        { tone: 'success' },
      );
    } else {
      setRefused(message);
    }
  }

  const userOptions: readonly SelectOption[] = activeUsers.map((one) => ({
    id: one.id,
    label: one.name,
  }));

  return (
    <div className="border-line flex flex-col gap-[var(--vx-gap-md)] border-t pt-[var(--vx-gap-lg)]">
      <h3 className="text-heading font-body-semibold text-fg">
        {translator.format('roles.holders.title')}
      </h3>
      {refused === null ? null : <Banner tone="danger">{refused}</Banner>}

      {/* As for a person's roles: "nobody holds this role" is a statement,
          and it is not made about a read that has not answered. */}
      {holders.value === null ? (
        <ReadState loaded={holders} />
      ) : holders.value.length === 0 ? (
        <p className="text-body text-fg-secondary">{translator.format('roles.holders.none')}</p>
      ) : (
        <ul className="flex flex-col gap-[var(--vx-gap-xs)]">
          {holders.value.map((assignment) => {
            const person = users.find((one) => one.id === assignment.user);
            return (
              <li
                key={assignment.user}
                className="border-line flex items-center justify-between gap-[var(--vx-gap-sm)] rounded-[var(--vx-radius)] border px-[var(--vx-pad-md)] py-[var(--vx-pad-sm)]"
              >
                <span className="flex flex-col">
                  <span className="font-body-medium">
                    {person?.name ?? translator.format('data.unknown')}
                  </span>
                  <span className="text-footnote text-fg-secondary">
                    {assignment.confinement.kind === 'tenant'
                      ? translator.format('users.scope.tenantWide')
                      : branchNames(formattingLocale, branches, assignment.confinement.branches)}
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

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void assign();
        }}
        className="border-line flex flex-col gap-[var(--vx-gap-md)] border-t pt-[var(--vx-gap-lg)]"
      >
        <p className="text-footnote font-body-medium text-fg-secondary">
          {translator.format('roles.holders.assign.title')}
        </p>
        <Select
          label={translator.format('roles.holders.user')}
          placeholder={translator.format('roles.holders.user.placeholder')}
          options={userOptions}
          value={userId}
          onChange={(key) => {
            setUserId(String(key));
            setMissing((was) => ({ ...was, user: false }));
          }}
          {...(missing.user
            ? { errorMessage: translator.format('roles.holders.user.required') }
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
  );
}
