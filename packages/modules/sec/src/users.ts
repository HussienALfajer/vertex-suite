import type { PermissionId, TenantId, UserId } from '@vertex/contracts';
import { err, newId, ok, refusal, refuse, type Instant, type Result } from '@vertex/kernel';
import type { CommandContext } from '@vertex/platform';

import {
  SEC_PERMISSIONS,
  type AdmittedUser,
  type Authenticated,
  type NewUser,
  type RecordSession,
  type Recovery,
  type RecoveryId,
  type SecRefusal,
  type User,
} from './contract.js';
import { decideFor, grantsOf, reachesAllOf, strandedBy, strandingRefusal } from './decide.js';
import {
  identityIn,
  recoveryIn,
  userIn,
  usersIn,
  writeIdentity,
  writeRecovery,
  writeUser,
  type IdentityRecord,
} from './records.js';
import { hashPassword, isCurrent, passwordLengthProblem, verifyPassword } from './credentials.js';

/**
 * People, and the sign-ins behind them: `SEC-09`.
 *
 * The feature is two sentences and a warning, and the shape of this file is the
 * warning. A tenant administrator runs their own shop — adds a cashier,
 * withdraws one, resets a password — and **the vendor never does**. But a
 * sign-in can belong to two shops, and an administrator who could reset one of
 * those could sign in to the other. So the person and the sign-in are two
 * records with two owners: the person is the tenant's, the sign-in is nobody's,
 * and every command that touches the second asks first who else relies on it.
 */

type Outcome<T> = Result<T, SecRefusal>;

/**
 * The handle as it is stored and compared.
 *
 * Composed the same way on the way in and the way back. Arabic is written with
 * combining marks that two keyboards encode differently, and a cashier whose
 * name does not match the one the manager typed — while looking identical on
 * both screens — is a shift that does not start and a fault nobody can see.
 * Case is folded for the same reason: what a person types at six in the morning
 * is not evidence about what they meant.
 */
export function normaliseHandle(raw: string): string | null {
  const handle = raw.normalize('NFC').trim().toLowerCase();
  return handle === '' ? null : handle;
}

function named(value: string): string | null {
  const name = value.trim();
  return name === '' ? null : name;
}

/** A password refused for its length, as the refusal a person reads. */
function badPassword(password: string): SecRefusal | null {
  const problem = passwordLengthProblem(password);
  if (problem === null) return null;
  return 'atLeast' in problem
    ? refusal('sec.password-too-short', problem)
    : refusal('sec.password-too-long', problem);
}

/**
 * How long a recovery may wait for its approvals and its new password.
 *
 * A recovery is weighed by every tenant at the moment each approves it, and
 * what they weigh is the person as they were then. One left open indefinitely
 * could be completed months later for somebody promoted since, on approvals
 * given for somebody else — so it lapses, and a new one is opened and weighed
 * again. A week is long enough for three shops to answer and short enough that
 * the answer is still about the same person.
 */
const RECOVERY_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A command whose subject is the caller's own sign-in, by the administrator's
 * door.
 *
 * An administrator resetting their own password skips the one thing their own
 * change asks for — the current password — so a session left open at a till is
 * an account taken over for good. Their own password changes the way everybody
 * else's own password does.
 */
function ownSignIn(by: CommandContext, user: UserId): SecRefusal | null {
  return by.actor !== null && by.actor === user ? refusal('sec.own-password') : null;
}

function guard(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  right: PermissionId,
): SecRefusal | null {
  return decideFor(session, by, declared, right, undefined).granted
    ? null
    : refusal('sec.not-permitted', { right });
}

/**
 * Whether the caller already holds everything this person holds.
 *
 * Resetting somebody's password is signing in as them. Without this, the right
 * to reset a password is the right to become whoever in the shop holds the most
 * — which would make `sec.user.reset-password` a quieter spelling of ownership,
 * and one that reads on the role editor like an ordinary clerical task.
 *
 * Checked grant by grant, and right by right inside each, for the reason an
 * assignment is: a role is a set, and it takes one member of it to escalate.
 * And measured against every grant this person could be given back, not only
 * the ones in force — see `grantsOf`.
 */
function holdsEverything(
  session: RecordSession,
  by: CommandContext,
  target: UserId,
): SecRefusal | null {
  for (const grant of grantsOf(session, by.tenant, target)) {
    const outranked = reachesAllOf(session, by, grant.rights, grant.assignment.confinement);
    if (outranked !== null) return outranked;
  }
  return null;
}

function tenantsOf(identity: IdentityRecord | null): readonly TenantId[] {
  return identity === null ? [] : identity.tenants;
}

/** What a caller is allowed to know about the sign-in: that it is not only theirs. */
export function isShared(identity: IdentityRecord | null, tenant: TenantId): boolean {
  return tenantsOf(identity).some((one) => one !== tenant);
}

export async function enrolUser(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  input: NewUser,
): Promise<Outcome<User>> {
  const permitted = guard(session, by, declared, SEC_PERMISSIONS.user.create);
  if (permitted !== null) return err(permitted);

  const handle = normaliseHandle(input.handle);
  if (handle === null) return refuse('sec.handle-required');
  const name = named(input.name);
  if (name === null) return refuse('sec.user-name-required');
  const weak = badPassword(input.password);
  if (weak !== null) return err(weak);

  // Unique **within the tenant**, which is as far as it can be without telling
  // one shop who works at another: a refusal that meant "taken somewhere in the
  // world" would answer a question no administrator is entitled to ask.
  if (usersIn(session, by.tenant).some((one) => one.handle === handle)) {
    return refuse('sec.handle-taken', { handle });
  }

  // Hashed inside the transaction, after the guard. It is a tenth of a second
  // of CPU held in a transaction that touches two rows nobody contends for, and
  // the alternative — hashing before the guard — spends that tenth of a second
  // for every caller who is about to be refused.
  const credential = await hashPassword(input.password);
  // Asked again after the hash. The tenth of a second above is long enough for
  // the same person to be enrolled twice from two screens — as `ahmad` and
  // `AHMAD` — and the second could then never sign in, because a sign-in
  // finds the first. A store that serialises its transactions refuses the
  // overlap at commit; this makes the refusal one a person can read.
  if (usersIn(session, by.tenant).some((one) => one.handle === handle)) {
    return refuse('sec.handle-taken', { handle });
  }
  const id = newId<'user'>();

  writeIdentity(session, { id, credential, tenants: Object.freeze([by.tenant]) });
  return ok(
    writeUser(session, {
      tenant: by.tenant,
      id,
      handle,
      name,
      active: true,
      sessionsVoidBefore: null,
      shared: false,
    }),
  );
}

/**
 * Admits an existing sign-in into this tenant as well.
 *
 * The system only. A tenant administrator who could do this could name any
 * identifier, have that person appear in their shop with a role of their
 * choosing, and wait for them to sign in with the password their own shop set —
 * which is the exact attack the rest of `SEC-09` exists to prevent, arrived at
 * from the other side.
 */
export function admitUser(
  session: RecordSession,
  by: CommandContext,
  input: AdmittedUser,
): Outcome<User> {
  if (by.actor !== null) {
    return refuse('sec.not-permitted', { right: SEC_PERMISSIONS.user.create });
  }

  const handle = normaliseHandle(input.handle);
  if (handle === null) return refuse('sec.handle-required');
  const name = named(input.name);
  if (name === null) return refuse('sec.user-name-required');

  const identity = identityIn(session, input.user);
  if (identity === null) return refuse('sec.identity-not-found', { user: input.user });
  // Somebody else's handle. Their own is what a replayed admission carries, and
  // refusing it turned the second delivery of a command that worked into one
  // that failed.
  if (usersIn(session, by.tenant).some((one) => one.handle === handle && one.id !== input.user)) {
    return refuse('sec.handle-taken', { handle });
  }

  // Idempotent: `SYN-02` replays, and admitting somebody twice must not make
  // the tenant appear twice on a record the recovery rule counts.
  if (!identity.tenants.includes(by.tenant)) {
    writeIdentity(session, {
      ...identity,
      tenants: Object.freeze([...identity.tenants, by.tenant]),
    });

    // `shared` is stored rather than worked out on every read, and this is the
    // one moment it can change — so it is corrected here, in the other tenants
    // too. A shop that learned yesterday that this sign-in was theirs alone
    // would otherwise go on offering a password reset that must now be refused,
    // and find out from a refusal instead of from a disabled button.
    for (const other of identity.tenants) {
      const theirs = userIn(session, other, input.user);
      if (theirs !== null && !theirs.shared) writeUser(session, { ...theirs, shared: true });
    }
  }

  const already = userIn(session, by.tenant, input.user);
  return ok(
    writeUser(session, {
      tenant: by.tenant,
      id: input.user,
      handle,
      name,
      active: true,
      sessionsVoidBefore: already?.sessionsVoidBefore ?? null,
      shared: true,
    }),
  );
}

function found(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  id: UserId,
  right: PermissionId,
): Outcome<User> {
  const permitted = guard(session, by, declared, right);
  if (permitted !== null) return err(permitted);

  const user = userIn(session, by.tenant, id);
  if (user === null) return refuse('sec.user-not-found', { user: id });
  return ok(user);
}

export function renameUser(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  id: UserId,
  name: string,
): Outcome<User> {
  const user = found(session, by, declared, id, SEC_PERMISSIONS.user.edit);
  if (!user.ok) return user;

  const trimmed = named(name);
  if (trimmed === null) return refuse('sec.user-name-required');
  return ok(writeUser(session, { ...user.value, name: trimmed }));
}

/**
 * Withdraws somebody from this shop, or puts them back.
 *
 * Never a deletion, and not only because the store cannot delete: `SEC-09` says
 * their historical transactions stay attributable, and a sale whose cashier is
 * an identifier that resolves to nothing is a sale nobody can ask about.
 *
 * A withdrawn person keeps their assignments, and holds none of the rights in
 * them — the decision reads this record, so withdrawing is immediate and
 * putting them back does not have to remember what they had.
 */
export function setUserActive(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  id: UserId,
  active: boolean,
): Outcome<User> {
  const user = found(session, by, declared, id, SEC_PERMISSIONS.user.withdraw);
  if (!user.ok) return user;

  // Checked in both directions. Standing somebody down who outranks you is
  // not escalation, but putting them back is half of one: withdraw, reset the
  // password of an account that now appears to hold nothing, reinstate, sign in.
  const beyond = holdsEverything(session, by, id);
  if (beyond !== null) return err(beyond);

  if (!active) {
    const stranded = strandedBy(session, by.tenant, { kind: 'user', user: id });
    if (stranded !== null) return err(strandingRefusal(stranded, { user: id }));
  }

  return ok(writeUser(session, { ...user.value, active }));
}

/**
 * `SEC-09`'s force sign-out, recorded as a moment rather than performed as an
 * act.
 *
 * Nothing here can reach a register that is offline, and a system that pretends
 * otherwise signs somebody out on the screen of whoever asked while they go on
 * selling in the shop. What it can do is say that sessions issued before this
 * moment are void; `U23` owns sessions and honours it, and a register finds out
 * the next time it asks anything.
 */
export function forceSignOut(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  id: UserId,
  now: Instant,
): Outcome<User> {
  const user = found(session, by, declared, id, SEC_PERMISSIONS.user.forceSignOut);
  if (!user.ok) return user;

  // Ranked like a reset, though it grants nothing. Repeated, it is a manager
  // emptying the owner out of the system faster than the owner can revoke the
  // right that allows it — and the way out of that is the vendor, which is what
  // `SEC-09` rules out in the same sentence it grants the power in.
  const beyond = holdsEverything(session, by, id);
  if (beyond !== null) return err(beyond);

  return ok(writeUser(session, { ...user.value, sessionsVoidBefore: now }));
}

export async function resetPassword(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  id: UserId,
  password: string,
  now: Instant,
): Promise<Outcome<User>> {
  const user = found(session, by, declared, id, SEC_PERMISSIONS.user.resetPassword);
  if (!user.ok) return user;
  const own = ownSignIn(by, id);
  if (own !== null) return err(own);
  const weak = badPassword(password);
  if (weak !== null) return err(weak);

  const identity = identityIn(session, id);
  if (identity === null) return refuse('sec.identity-not-found', { user: id });
  // `SEC-09`, in its own words: only a sign-in that belongs to this tenant
  // alone. The password would work in the other shop too, and the other shop
  // never agreed to this administrator.
  if (isShared(identity, by.tenant)) return refuse('sec.identity-shared', { user: id });

  const beyond = holdsEverything(session, by, id);
  if (beyond !== null) return err(beyond);

  writeIdentity(session, { ...identity, credential: await hashPassword(password) });
  // A reset is what an administrator does about an account somebody else may be
  // using. Leaving that somebody's sessions alive made it a new password for
  // the owner and nothing at all for the intruder; `U23` honours this stamp.
  return ok(writeUser(session, { ...user.value, sessionsVoidBefore: now }));
}

/**
 * The way a password changes when the sign-in is shared: its owner, with the
 * password they already have.
 *
 * Available to everybody, shared or not, and it asks for no right at all — it
 * is the one command in this module whose subject is the caller.
 */
export async function changeOwnPassword(
  session: RecordSession,
  by: CommandContext,
  current: string,
  next: string,
): Promise<Outcome<void>> {
  if (by.actor === null) return refuse('sec.no-actor');
  const weak = badPassword(next);
  if (weak !== null) return err(weak);

  const user = userIn(session, by.tenant, by.actor);
  if (user === null) return refuse('sec.user-not-found', { user: by.actor });
  if (!user.active) return refuse('sec.user-inactive', { user: by.actor });

  const identity = identityIn(session, by.actor);
  const credential = identity?.credential ?? null;
  if (identity === null || credential === null) {
    return refuse('sec.identity-not-found', { user: by.actor });
  }
  if (!(await verifyPassword(current, credential))) {
    return refuse('sec.password-wrong');
  }

  // No sessions voided here, unlike a reset. The stamp is a moment, and the
  // session this change was made from is one of the sessions before it: a
  // person changing their own password would be signed out mid-sentence.
  // Ending their other sessions is `U23`'s, which owns sessions and can tell
  // this one from the rest.
  writeIdentity(session, { ...identity, credential: await hashPassword(next) });
  return ok(undefined);
}

/**
 * A password verified against a sign-in, and nothing more.
 *
 * `U23` builds sessions on this. What it answers is the question underneath
 * one: is this the password, and may this person still work in this shop.
 *
 * An unknown handle and a wrong password produce the **same refusal**, and an
 * unknown handle still pays for a hash. A sign-in screen that answers faster,
 * or differently, for a name that does not exist is a list of everybody who
 * does, readable by anybody who can reach a till.
 */
export async function authenticate(
  session: RecordSession,
  by: CommandContext,
  handle: string,
  password: string,
  now: Instant,
): Promise<Outcome<Authenticated>> {
  const wanted = normaliseHandle(handle);
  const user =
    wanted === null
      ? null
      : (usersIn(session, by.tenant).find((one) => one.handle === wanted) ?? null);
  const identity = user === null ? null : identityIn(session, user.id);
  const credential = identity?.credential ?? null;

  const correct =
    credential === null
      ? await verifyPassword(password, DECOY)
      : await verifyPassword(password, credential);
  if (!correct || user === null) return refuse('sec.password-wrong');

  // Only somebody who has the password learns that the account is withdrawn.
  // Refusing earlier would tell whoever is guessing which names are real.
  if (!user.active) return refuse('sec.user-inactive', { user: user.id });

  // Raising the cost reaches everybody who works here, rather than waiting for
  // each of them to forget a password — and the shop where nobody has forgotten
  // one is exactly the shop whose passwords are oldest. Written here because
  // this is the only moment the plaintext and the stored form are both in hand.
  if (identity !== null && credential !== null && !isCurrent(credential)) {
    writeIdentity(session, { ...identity, credential: await hashPassword(password) });
  }

  return ok(Object.freeze({ user: user.id, tenant: by.tenant, at: now }));
}

/**
 * A credential no password produces, to be checked against when there is none.
 *
 * Written out rather than generated so that the work done for an unknown handle
 * is the same work, every time, on every machine — a hash computed at startup
 * would still be one branch that a clock can see.
 *
 * The key is **exactly the 64 bytes `hashPassword` writes**. One base64url
 * character short and it decodes to 63, so `verifyPassword` returns on its
 * length check instead of reaching the constant-time comparison — and the path
 * taken for an unknown handle would then stop one step earlier than the path
 * taken for a known one. The scrypt derivation dominates both by a margin no
 * attacker could measure, so this was never a way in; but "the same work" is
 * the claim this constant exists to make, and a claim that is only nearly true
 * is one nobody can check.
 */
const DECOY =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$' +
  'ZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/**
 * Opens a recovery for a sign-in more than one shop relies on.
 *
 * Any tenant the sign-in belongs to may open one, and opening it is that
 * tenant's approval — there is nothing for the opener to approve afterwards
 * that they have not already said by opening it.
 */
export function openRecovery(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  user: UserId,
  now: Instant,
): Outcome<Recovery> {
  const permitted = guard(session, by, declared, SEC_PERMISSIONS.user.resetPassword);
  if (permitted !== null) return err(permitted);

  const here = userIn(session, by.tenant, user);
  if (here === null) return refuse('sec.user-not-found', { user });
  const own = ownSignIn(by, user);
  if (own !== null) return err(own);

  const identity = identityIn(session, user);
  if (identity === null) return refuse('sec.identity-not-found', { user });

  const beyond = holdsEverything(session, by, user);
  if (beyond !== null) return err(beyond);

  return ok(
    writeRecovery(session, {
      id: newId<'recovery'>(),
      user,
      opened: now,
      approvedBy: Object.freeze([by.tenant]),
      settled: false,
    }),
  );
}

export function approveRecovery(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  id: RecoveryId,
  now: Instant,
): Outcome<Recovery> {
  const permitted = guard(session, by, declared, SEC_PERMISSIONS.user.resetPassword);
  if (permitted !== null) return err(permitted);

  const recovery = recoveryIn(session, id);
  if (recovery === null) return refuse('sec.recovery-not-found', { recovery: id });
  if (recovery.settled) return refuse('sec.recovery-settled', { recovery: id });
  if (now - recovery.opened > RECOVERY_LIFETIME_MS) {
    return refuse('sec.recovery-expired', { recovery: id });
  }

  // The approval is a tenant's, so it has to come from inside one this sign-in
  // actually works in: a shop that has never employed this person has nothing
  // to weigh and no standing to say yes.
  if (userIn(session, by.tenant, recovery.user) === null) {
    return refuse('sec.user-not-found', { user: recovery.user });
  }

  const beyond = holdsEverything(session, by, recovery.user);
  if (beyond !== null) return err(beyond);

  if (recovery.approvedBy.includes(by.tenant)) return ok(recovery);
  return ok(
    writeRecovery(session, {
      ...recovery,
      approvedBy: Object.freeze([...recovery.approvedBy, by.tenant]),
    }),
  );
}

export async function completeRecovery(
  session: RecordSession,
  by: CommandContext,
  declared: ReadonlySet<string>,
  id: RecoveryId,
  password: string,
  now: Instant,
): Promise<Outcome<void>> {
  const permitted = guard(session, by, declared, SEC_PERMISSIONS.user.resetPassword);
  if (permitted !== null) return err(permitted);

  const recovery = recoveryIn(session, id);
  if (recovery === null) return refuse('sec.recovery-not-found', { recovery: id });
  if (recovery.settled) return refuse('sec.recovery-settled', { recovery: id });
  if (now - recovery.opened > RECOVERY_LIFETIME_MS) {
    return refuse('sec.recovery-expired', { recovery: id });
  }
  const weak = badPassword(password);
  if (weak !== null) return err(weak);

  const identity = identityIn(session, recovery.user);
  if (identity === null) return refuse('sec.identity-not-found', { user: recovery.user });

  // The same standing `open` and `approve` each required — a place in a shop
  // this person works in, **and the rank**. Completing is the step that chooses
  // the password, and it once asked only for the right: a manager refused both
  // opening and approving a recovery for a co-owner completed it with a
  // password of their own, and signed in as the co-owner.
  if (userIn(session, by.tenant, recovery.user) === null) {
    return refuse('sec.user-not-found', { user: recovery.user });
  }
  const own = ownSignIn(by, recovery.user);
  if (own !== null) return err(own);
  const beyond = holdsEverything(session, by, recovery.user);
  if (beyond !== null) return err(beyond);

  // Every tenant, and not a majority or the one that asked. A sign-in that
  // works in three shops is three shops' risk, and any rule short of unanimity
  // is a rule under which two of them decide for the third.
  //
  // Whether, and not how many. The contract promises a tenant learns only that
  // a sign-in is not theirs alone; a count of the shops still to answer told it
  // how many others employ this person.
  if (identity.tenants.some((one) => !recovery.approvedBy.includes(one))) {
    return refuse('sec.recovery-incomplete');
  }

  writeIdentity(session, { ...identity, credential: await hashPassword(password) });
  writeRecovery(session, { ...recovery, settled: true });
  // Every shop's record of this person: the recovery exists because somebody
  // else may hold the old password, in any of them.
  for (const tenant of identity.tenants) {
    const theirs = userIn(session, tenant, recovery.user);
    if (theirs !== null) writeUser(session, { ...theirs, sessionsVoidBefore: now });
  }
  return ok(undefined);
}
