import type { BranchId, TenantId } from '@vertex/contracts';
import type { ConvertedPrice, PriceRate } from '@vertex/fx/contract';
import {
  Dec,
  isId,
  newId,
  ok,
  refuse,
  toDecimalString,
  type Id,
  type Instant,
  type Result,
} from '@vertex/kernel';
import type { CommandContext } from '@vertex/platform';
import {
  DISPLAY_CURRENCY,
  RATE_REVIEW_THRESHOLD,
  type DisplayPrice,
  type DisplayPriceBasis,
  type DisplayPriceChange,
  type DisplayPriceTarget,
  type PriceSubject,
  type PrcRefusal,
  type RateReviewApproval,
  type RateReviewBatch,
  type RateReviewBatchId,
  type RateReviewCounts,
  type RateReviewEntry,
  type RateReviewEntryPage,
  type RateReviewEntryQuery,
  type RateReviewExclusion,
  type RateReviewPolicy,
  type RateReviewPolicyCommand,
  type RateReviewRef,
  type RateReviewRejection,
  type RateReviewSkip,
  type RateReviewSupersession,
  type RateReviewTask,
  type RateReviewTaskId,
  type RateReviewTaskPage,
  type RateReviewTaskQuery,
  type UsdPrice,
} from './contract.js';
import {
  batchKey,
  branchPriceRoot,
  displaySequenceKey,
  historyKeyOf,
  historyRoot,
  overlayKey,
  ownDisplayPrice,
  putOwnDisplayPrice,
  stagedKey,
  stagedRoot,
  storedDisplayPrice,
  type StagedPrice,
} from './display-prices.js';
import { after, padded, range, within } from './keys.js';
import { listIn, listsIn, type RecordSession } from './price-lists.js';
import { currentPrice } from './usd-prices.js';

type Outcome<T> = Result<T, PrcRefusal>;
type Actor = CommandContext['actor'];

/*
 * Records, under a root of their own:
 *
 *   policy                       the owner's threshold
 *   policy-operation/{op}        a threshold change, for its retry
 *   watch/{branch}               the checkpoint: the rate and threshold last
 *                                scanned at the branch, and a scan in progress
 *   task/{task}                  a review task
 *   entry/{task}/{item/list/unit}      a listed price
 *   excluded/{task}/{item/list/unit}   the listed prices excluded, for their page
 *   operation/{op}               a decision, for its retry
 *   batch/{batch}                an attempt to publish an approved task
 *   work                         batches with steps left: staging, folding, clearing
 *
 * A batch's staged prices live under the display prices' root, where the read
 * that must see them once published already looks (`display-prices.ts`).
 */
const root = (tenant: TenantId): string => `prc/review/${encodeURIComponent(tenant)}/`;
const policyKey = (tenant: TenantId): string => `${root(tenant)}policy`;
const policyOperationKey = (tenant: TenantId, operation: string): string =>
  `${root(tenant)}policy-operation/${operation}`;
const watchKey = (tenant: TenantId, branch: BranchId): string => `${root(tenant)}watch/${branch}`;
const taskRoot = (tenant: TenantId): string => `${root(tenant)}task/`;
const taskKey = (tenant: TenantId, task: RateReviewTaskId): string => `${taskRoot(tenant)}${task}`;
const entryRoot = (tenant: TenantId, task: RateReviewTaskId): string =>
  `${root(tenant)}entry/${task}/`;
const excludedRoot = (tenant: TenantId, task: RateReviewTaskId): string =>
  `${root(tenant)}excluded/${task}/`;
const subjectPath = (subject: PriceSubject): string =>
  `${subject.item}/${subject.list}/${subject.unit}`;
const entryKey = (tenant: TenantId, task: RateReviewTaskId, subject: PriceSubject): string =>
  `${entryRoot(tenant, task)}${subjectPath(subject)}`;
const excludedKey = (tenant: TenantId, task: RateReviewTaskId, subject: PriceSubject): string =>
  `${excludedRoot(tenant, task)}${subjectPath(subject)}`;
const operationKey = (tenant: TenantId, operation: string): string =>
  `${root(tenant)}operation/${operation}`;
const workKey = (tenant: TenantId): string => `${root(tenant)}work`;
const usdRoot = (tenant: TenantId): string => `prc/usd/${encodeURIComponent(tenant)}/`;
const usdSequenceKey = (tenant: TenantId): string => `${usdRoot(tenant)}sequence`;
const usdHistoryRoot = (tenant: TenantId): string => `${usdRoot(tenant)}history/`;

/** How far each audit had got: a change after it is a change since. */
interface Marks {
  readonly usd: number;
  readonly display: number;
}

function marksOf(session: RecordSession, tenant: TenantId): Marks {
  return {
    usd: (session.get(usdSequenceKey(tenant)) as number | undefined) ?? 0,
    display: (session.get(displaySequenceKey(tenant)) as number | undefined) ?? 0,
  };
}

/**
 * A task as stored: what a reader sees, less the batch (read beside it), plus
 * where the audits stood when it began to be listed.
 */
interface TaskRecord extends Omit<RateReviewTask, 'batch'> {
  readonly batch: RateReviewBatchId | null;
  readonly marks: Marks;
}

/**
 * A listed price as stored. The proposed basis is not kept whole: its rate is
 * the task's, and its dollar source is the entry's own — only what differs
 * from price to price is written, which is most of what thirty thousand of
 * them cost to hold.
 */
interface EntryRecord extends DisplayPriceTarget {
  readonly task: RateReviewTaskId;
  readonly current: RateReviewEntry['current'];
  readonly usd: RateReviewEntry['usd'];
  readonly proposed: string;
  readonly exact: string;
  readonly residual: string;
  readonly rounding: DisplayPriceBasis['rounding'];
  readonly included: boolean;
  readonly exclusion: RateReviewEntry['exclusion'];
}

interface BatchRecord extends RateReviewBatch {
  readonly tenant: TenantId;
  readonly branch: BranchId;
  /** The last listed price staged. */
  readonly cursor: string | null;
  /** Where the audits stood when it was approved: publication checks every change since. */
  readonly marks: Marks;
  /** Every staged price folded into its own record, or cleared away if abandoned. */
  readonly settled: boolean;
  /** The lists active when it was approved: one withdrawn before publication stops it. */
  readonly lists: readonly string[];
}

/** A scan of one branch's frozen prices against one rate and one threshold. */
interface Scan {
  readonly task: RateReviewTaskId;
  readonly rate: PriceRate;
  readonly policy: { readonly revision: number; readonly threshold: string };
  readonly cursor: string | null;
  readonly counts: RateReviewCounts;
  /** A task this one refreshes: its exclusions are carried over. */
  readonly carry: RateReviewTaskId | null;
  readonly marks: Marks;
  /** Whether the task's record exists yet: it is written with the first price it lists. */
  readonly raised: boolean;
}

/**
 * The checkpoint (`RateReviewMonitor`): the rate revision and threshold
 * revision last scanned at a branch, so that a rate is scanned once however
 * often, and by however many processes, the monitor is driven.
 */
interface Watch {
  readonly rateRevision: string | null;
  readonly policyRevision: number;
  readonly scan: Scan | null;
  /** The latest task raised here: the only one that can still be open. */
  readonly task: RateReviewTaskId | null;
}

interface Replay {
  readonly fingerprint: string;
  readonly task: RateReviewTask;
}

const NO_SKIPS: Readonly<Record<RateReviewSkip, number>> = Object.freeze({
  'list-inactive': 0,
  'subject-invalid': 0,
  'usd-missing': 0,
  unchanged: 0,
  'amount-invalid': 0,
});

// ─── The threshold ────────────────────────────────────────────────────────────

export function policyIn(session: RecordSession, tenant: TenantId): RateReviewPolicy {
  return (
    (session.get(policyKey(tenant)) as RateReviewPolicy | undefined) ?? {
      tenant,
      threshold: null,
      revision: 0,
      changedBy: null,
      changedAt: null,
    }
  );
}

/** A percentage the owner may set, as its canonical decimal, or null for disabled. */
export function validThreshold(value: unknown): Outcome<string | null> {
  if (value === null) return ok(null);
  if (typeof value !== 'string' || !/^\d{1,2}(\.\d{1,2})?$/u.test(value))
    return refuse('prc.threshold-invalid', RATE_REVIEW_THRESHOLD);
  const figure = new Dec(value);
  if (figure.lt(RATE_REVIEW_THRESHOLD.min) || figure.gt(RATE_REVIEW_THRESHOLD.max))
    return refuse('prc.threshold-invalid', RATE_REVIEW_THRESHOLD);
  return ok(figure.toFixed());
}

export function validPolicyCommand(command: unknown): Outcome<RateReviewPolicyCommand> {
  if (typeof command !== 'object' || command === null || Array.isArray(command))
    return refuse('prc.threshold-invalid', RATE_REVIEW_THRESHOLD);
  const fields = command as Record<string, unknown>;
  if (!validOperation(fields['operation'])) return refuse('prc.operation-invalid');
  if (!validRevision(fields['expectedRevision'])) return refuse('prc.revision-stale');
  const threshold = validThreshold(fields['threshold']);
  if (!threshold.ok) return threshold;
  return ok({
    threshold: threshold.value,
    expectedRevision: fields['expectedRevision'],
    operation: fields['operation'],
  });
}

export function putPolicy(
  session: RecordSession,
  tenant: TenantId,
  actor: Actor,
  at: Instant,
  command: RateReviewPolicyCommand,
): Outcome<RateReviewPolicy> {
  const fingerprint = JSON.stringify({ actor, ...command });
  const prior = session.get(policyOperationKey(tenant, command.operation)) as
    { readonly fingerprint: string; readonly policy: RateReviewPolicy } | undefined;
  if (prior !== undefined)
    return prior.fingerprint === fingerprint ? ok(prior.policy) : refuse('prc.operation-reused');
  const current = policyIn(session, tenant);
  if (current.revision !== command.expectedRevision)
    return refuse('prc.revision-stale', { currentRevision: current.revision });
  const policy: RateReviewPolicy = {
    tenant,
    threshold: command.threshold,
    revision: current.revision + 1,
    changedBy: actor,
    changedAt: at,
  };
  session.put(policyKey(tenant), policy);
  session.put(policyOperationKey(tenant, command.operation), { fingerprint, policy });
  return ok(policy);
}

/**
 * Whether today's rate has moved past the threshold from the rate a price was
 * frozen at: `|r1 − r0| × 100 ≥ threshold × r0`, exactly, never divided. See
 * `RATE_REVIEW_THRESHOLD` for why each price is its own baseline.
 */
export function moved(frozenAt: string, today: string, threshold: string): boolean {
  const r0 = new Dec(frozenAt);
  return new Dec(today).minus(r0).abs().times(100).gte(r0.times(threshold));
}

// ─── Reading tasks and entries ────────────────────────────────────────────────

function taskIn(session: RecordSession, tenant: TenantId, id: RateReviewTaskId): TaskRecord | null {
  const found = session.get(taskKey(tenant, id)) as TaskRecord | undefined;
  return found?.tenant === tenant ? found : null;
}

function batchIn(
  session: RecordSession,
  tenant: TenantId,
  id: RateReviewBatchId,
): BatchRecord | null {
  return (session.get(batchKey(tenant, id)) as BatchRecord | undefined) ?? null;
}

function batchView(record: BatchRecord): RateReviewBatch {
  return {
    id: record.id,
    task: record.task,
    state: record.state,
    operation: record.operation,
    actor: record.actor,
    reason: record.reason,
    at: record.at,
    total: record.total,
    staged: record.staged,
    publishedAt: record.publishedAt,
    failure: record.failure,
  };
}

function taskView(session: RecordSession, record: TaskRecord): RateReviewTask {
  const batch = record.batch === null ? null : batchIn(session, record.tenant, record.batch);
  return {
    tenant: record.tenant,
    id: record.id,
    branch: record.branch,
    rate: record.rate,
    policy: record.policy,
    state: record.state,
    raisedAt: record.raisedAt,
    review: record.review,
    counts: record.counts,
    decision: record.decision,
    supersession: record.supersession,
    batch: batch === null ? null : batchView(batch),
  };
}

/** A task at the branch it was named at, or nothing: a task is never found at another branch. */
export function taskAt(
  session: RecordSession,
  tenant: TenantId,
  ref: RateReviewRef,
): Outcome<RateReviewTask> {
  const record = taskIn(session, tenant, ref.task);
  if (record?.branch !== ref.branch) return refuse('prc.review-not-found');
  return ok(taskView(session, record));
}

export function validRef(value: unknown): value is RateReviewRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  return validIdentity(fields['branch']) && validIdentity(fields['task']);
}

export function validTaskQuery(value: unknown): value is RateReviewTaskQuery {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const fields = value as Record<string, unknown>;
  const limit = fields['limit'];
  return (
    (fields['branch'] === undefined || validIdentity(fields['branch'])) &&
    (fields['before'] === undefined || validIdentity(fields['before'])) &&
    (fields['open'] === undefined || typeof fields['open'] === 'boolean') &&
    (limit === undefined ||
      (typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 1 && limit <= 50))
  );
}

/** Newest first: task identities are time-ordered, so the listing is in raising order. */
export function taskPage(
  session: RecordSession,
  tenant: TenantId,
  query: RateReviewTaskQuery,
): RateReviewTaskPage {
  const limit = query.limit ?? 20;
  const keys = within(session, taskRoot(tenant));
  const found: TaskRecord[] = [];
  for (let at = keys.length - 1; at >= 0 && found.length <= limit; at -= 1) {
    const record = session.get(keys[at] ?? '') as TaskRecord | undefined;
    if (record?.tenant !== tenant) continue;
    if (query.before !== undefined && record.id >= query.before) continue;
    if (query.branch !== undefined && record.branch !== query.branch) continue;
    if (query.open === true && !OPEN.has(record.state)) continue;
    found.push(record);
  }
  const tasks = found.slice(0, limit).map((one) => taskView(session, one));
  return { tasks, next: found.length > limit ? (tasks.at(-1)?.id ?? null) : null };
}

const OPEN: ReadonlySet<RateReviewTask['state']> = new Set(['preparing', 'pending', 'approving']);

const CURSOR = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/u;

export function validEntryQuery(value: unknown): value is RateReviewEntryQuery {
  if (!validRef(value)) return false;
  const fields = value as unknown as Record<string, unknown>;
  const limit = fields['limit'];
  const cursor = fields['after'];
  return (
    (cursor === undefined ||
      (typeof cursor === 'string' &&
        CURSOR.test(cursor) &&
        cursor.split('/').every((part) => isId(part)))) &&
    (fields['included'] === undefined || typeof fields['included'] === 'boolean') &&
    (limit === undefined ||
      (typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100))
  );
}

function entryView(
  session: RecordSession,
  tenant: TenantId,
  task: TaskRecord,
  record: EntryRecord,
): RateReviewEntry {
  return {
    task: record.task,
    branch: record.branch,
    subject: record.subject,
    current: record.current,
    usd: record.usd,
    currency: DISPLAY_CURRENCY,
    proposed: record.proposed,
    basis: basisOfEntry(task, record),
    included: record.included,
    exclusion: record.exclusion,
    stale: entryStale(session, tenant, record),
  };
}

function basisOfEntry(task: Pick<TaskRecord, 'rate'>, record: EntryRecord): DisplayPriceBasis {
  return {
    usdAmount: record.usd.amount,
    usdRevision: record.usd.revision,
    rate: task.rate,
    exact: record.exact,
    residual: record.residual,
    rounding: record.rounding,
  };
}

/**
 * Whether the entry can no longer be published as listed: its dollar price or
 * its frozen price has moved on, or its list has been withdrawn — a withdrawn
 * list is not priced (`putDisplayPrice` refuses it too).
 */
function entryStale(session: RecordSession, tenant: TenantId, record: EntryRecord): boolean {
  const usd = currentPrice(session, tenant, record.subject);
  const frozen = storedDisplayPrice(session, tenant, record);
  return (
    usd?.revision !== record.usd.revision ||
    frozen?.revision !== record.current.revision ||
    listIn(session, tenant, record.subject.list)?.active !== true
  );
}

/** Included entries of a task on a list that is no longer active: a walk, for the rare case. */
function onWithdrawnLists(
  session: RecordSession,
  tenant: TenantId,
  task: RateReviewTaskId,
  lists: readonly string[],
): number {
  const withdrawn = new Set(
    lists.filter((id) => listIn(session, tenant, id as PriceSubject['list'])?.active !== true),
  );
  if (withdrawn.size === 0) return 0;
  let count = 0;
  for (const key of within(session, entryRoot(tenant, task))) {
    const record = session.get(key) as EntryRecord;
    if (record.included && withdrawn.has(record.subject.list)) count += 1;
  }
  return count;
}

/** A page of listed prices, in key order, after a cursor. */
export function entryPage(
  session: RecordSession,
  tenant: TenantId,
  query: RateReviewEntryQuery,
): Outcome<RateReviewEntryPage> {
  const task = taskIn(session, tenant, query.task);
  if (task?.branch !== query.branch) return refuse('prc.review-not-found');
  const limit = query.limit ?? 50;
  // Excluded prices have an index of their own: a page of the few a person
  // set aside is not a walk through every price they did not.
  const indexRoot =
    query.included === false ? excludedRoot(tenant, task.id) : entryRoot(tenant, task.id);
  const keys = after(
    session,
    indexRoot,
    query.after === undefined ? null : `${indexRoot}${query.after}`,
  );
  const entries: RateReviewEntry[] = [];
  let last: string | null = null;
  let more = false;
  for (const key of keys) {
    const path = key.slice(indexRoot.length);
    const record = session.get(`${entryRoot(tenant, task.id)}${path}`) as EntryRecord | undefined;
    if (record === undefined) continue;
    if (query.included === true && !record.included) continue;
    if (entries.length === limit) {
      more = true;
      break;
    }
    entries.push(entryView(session, tenant, task, record));
    last = path;
  }
  return ok({ entries, next: more ? last : null });
}

// ─── Decisions ────────────────────────────────────────────────────────────────

function validIdentity(value: unknown): boolean {
  return typeof value === 'string' && isId(value);
}

function validOperation(value: unknown): value is Id<'price-operation'> {
  return validIdentity(value);
}

function validRevision(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value < Number.MAX_SAFE_INTEGER
  );
}

function validReason(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= 500;
}

export function validDecision(
  command: unknown,
  kind: 'reject' | 'approve',
): Outcome<RateReviewRejection | RateReviewApproval> {
  if (!validRef(command)) return refuse('prc.review-not-found');
  const fields = command as unknown as Record<string, unknown>;
  if (!validOperation(fields['operation'])) return refuse('prc.operation-invalid');
  if (kind === 'approve' && !validRevision(fields['expectedReview']))
    return refuse('prc.revision-stale');
  if (!validReason(fields['reason'])) return refuse('prc.reason-required');
  return ok(command as unknown as RateReviewApproval);
}

export function validExclusion(command: unknown): Outcome<RateReviewExclusion> {
  if (!validRef(command)) return refuse('prc.review-not-found');
  const fields = command as unknown as Record<string, unknown>;
  if (!validRevision(fields['expectedReview'])) return refuse('prc.revision-stale');
  const subjects = fields['subjects'];
  if (
    typeof fields['excluded'] !== 'boolean' ||
    !Array.isArray(subjects) ||
    subjects.length === 0 ||
    subjects.length > 100 ||
    !subjects.every((one) => {
      if (typeof one !== 'object' || one === null || Array.isArray(one)) return false;
      const parts = one as Record<string, unknown>;
      return ['list', 'item', 'unit'].every((field) => validIdentity(parts[field]));
    })
  )
    return refuse('prc.subject-invalid');
  return ok(command as unknown as RateReviewExclusion);
}

function replayed(
  session: RecordSession,
  tenant: TenantId,
  operation: string,
  fingerprint: string,
): Outcome<RateReviewTask> | null {
  const prior = session.get(operationKey(tenant, operation)) as Replay | undefined;
  if (prior === undefined) return null;
  return prior.fingerprint === fingerprint ? ok(prior.task) : refuse('prc.operation-reused');
}

export function decisionReplay(
  session: RecordSession,
  tenant: TenantId,
  actor: Actor,
  kind: 'reject' | 'approve',
  command: RateReviewRejection | RateReviewApproval,
): Outcome<RateReviewTask> | null {
  return replayed(session, tenant, command.operation, fingerprintOf(actor, kind, command));
}

function fingerprintOf(
  actor: Actor,
  kind: 'reject' | 'approve',
  command: RateReviewRejection | RateReviewApproval,
): string {
  return JSON.stringify({
    actor,
    kind,
    branch: command.branch,
    task: command.task,
    reason: command.reason,
    expectedReview: 'expectedReview' in command ? command.expectedReview : null,
  });
}

/** The task, if it is awaiting a decision. */
function pendingTask(
  session: RecordSession,
  tenant: TenantId,
  ref: RateReviewRef,
): Outcome<TaskRecord> {
  const task = taskIn(session, tenant, ref.task);
  if (task?.branch !== ref.branch) return refuse('prc.review-not-found');
  if (task.state !== 'pending') return refuse('prc.review-not-pending', { state: task.state });
  return ok(task);
}

export function putExclusion(
  session: RecordSession,
  tenant: TenantId,
  actor: Actor,
  at: Instant,
  command: RateReviewExclusion,
): Outcome<RateReviewTask> {
  const found = pendingTask(session, tenant, command);
  if (!found.ok) return found;
  const task = found.value;
  if (task.review !== command.expectedReview)
    return refuse('prc.revision-stale', { currentRevision: task.review });
  // Each price once, however often it is named: the count is of prices.
  const records = new Map<string, EntryRecord>();
  for (const subject of command.subjects) {
    const record = session.get(entryKey(tenant, task.id, subject)) as EntryRecord | undefined;
    if (record === undefined) return refuse('prc.subject-invalid');
    records.set(subjectPath(subject), record);
  }
  let excluded = task.counts.excluded;
  for (const record of records.values()) {
    if (record.included !== command.excluded) continue;
    excluded += command.excluded ? 1 : -1;
    session.put(entryKey(tenant, task.id, record.subject), {
      ...record,
      included: !command.excluded,
      exclusion: command.excluded ? { actor, at } : null,
    } satisfies EntryRecord);
    if (command.excluded) session.put(excludedKey(tenant, task.id, record.subject), true);
    else session.remove(excludedKey(tenant, task.id, record.subject));
  }
  const revised: TaskRecord = {
    ...task,
    review: task.review + 1,
    counts: { ...task.counts, excluded },
  };
  session.put(taskKey(tenant, task.id), revised);
  return ok(taskView(session, revised));
}

export function putRejection(
  session: RecordSession,
  tenant: TenantId,
  actor: Actor,
  at: Instant,
  command: RateReviewRejection,
): Outcome<RateReviewTask> {
  const replay = decisionReplay(session, tenant, actor, 'reject', command);
  if (replay !== null) return replay;
  const found = pendingTask(session, tenant, command);
  if (!found.ok) return found;
  const rejected: TaskRecord = {
    ...found.value,
    state: 'rejected',
    decision: {
      kind: 'rejected',
      actor,
      at,
      reason: command.reason.trim(),
      operation: command.operation,
    },
  };
  session.put(taskKey(tenant, rejected.id), rejected);
  const view = taskView(session, rejected);
  session.put(operationKey(tenant, command.operation), {
    fingerprint: fingerprintOf(actor, 'reject', command),
    task: view,
  } satisfies Replay);
  return ok(view);
}

/**
 * Supersedes a pending task and has the monitor list its prices again, now,
 * at the same rate and threshold, keeping what the person excluded.
 */
export function putRefresh(
  session: RecordSession,
  tenant: TenantId,
  actor: Actor,
  at: Instant,
  ref: RateReviewRef,
): Outcome<RateReviewTask> {
  const found = pendingTask(session, tenant, ref);
  if (!found.ok) return found;
  const task = found.value;
  const watch = watchIn(session, tenant, task.branch);
  // A scan already under way is listing this branch afresh: it decides what
  // replaces this task, and a second would leave the first's task preparing.
  if (watch.scan !== null) return refuse('prc.review-superseded');
  const superseded = supersede(task, { at, cause: 'refreshed', by: actor });
  session.put(taskKey(tenant, task.id), superseded);
  session.put(watchKey(tenant, task.branch), {
    ...watch,
    scan: freshScan(session, tenant, task.branch, task.rate, task.policy, task.id),
  } satisfies Watch);
  return ok(taskView(session, superseded));
}

function supersede(task: TaskRecord, supersession: RateReviewSupersession): TaskRecord {
  return { ...task, state: 'superseded', supersession };
}

/**
 * How many included prices of a task have changed since the audits stood at
 * `since` — found from the audits themselves, so the cost is the changes, not
 * the task. Every dollar price change and every frozen price change writes an
 * audit entry (`PRC-11`), and each key names its subject.
 */
export function staleSince(
  session: RecordSession,
  tenant: TenantId,
  task: Pick<TaskRecord, 'id' | 'branch'>,
  since: Marks,
  own: RateReviewBatchId | null = null,
): number {
  const touched = new Set<string>();
  const usdHistory = usdHistoryRoot(tenant);
  for (const key of within(session, usdHistory, `${usdHistory}${padded(since.usd + 1)}`)) {
    const [, , item, list, unit] = key.slice(usdHistory.length).split('/');
    if (item && list && unit) touched.add(`${item}/${list}/${unit}`);
  }
  const displayHistory = historyRoot(tenant);
  for (const key of within(
    session,
    displayHistory,
    `${displayHistory}${padded(since.display + 1)}`,
  )) {
    const [, , branch, item, list, unit, batch] = key.slice(displayHistory.length).split('/');
    if (branch !== task.branch || !item || !list || !unit || batch === own) continue;
    // Another batch's entries are changes only once it is published.
    if (
      batch !== undefined &&
      batchIn(session, tenant, batch as RateReviewBatchId)?.state !== 'published'
    )
      continue;
    touched.add(`${item}/${list}/${unit}`);
  }
  let stale = 0;
  for (const path of touched) {
    const record = session.get(`${entryRoot(tenant, task.id)}${path}`) as EntryRecord | undefined;
    if (record?.included === true && entryStale(session, tenant, record)) stale += 1;
  }
  return stale;
}

export interface Acceptance {
  readonly rate: PriceRate;
  readonly policy: number;
}

/**
 * Accepts an approval: the batch is created to be staged, and the task waits
 * on it. Everything the approval was reviewed against is checked here, in the
 * transaction that records it — the rate the caller read from `FX` just
 * before, the threshold, the review revision, and every listed price since
 * the task was listed.
 */
export function putApproval(
  session: RecordSession,
  tenant: TenantId,
  actor: Actor,
  at: Instant,
  command: RateReviewApproval,
  today: PriceRate,
): Outcome<RateReviewTask> {
  const replay = decisionReplay(session, tenant, actor, 'approve', command);
  if (replay !== null) return replay;
  const found = pendingTask(session, tenant, command);
  if (!found.ok) return found;
  const task = found.value;
  if (task.review !== command.expectedReview)
    return refuse('prc.revision-stale', { currentRevision: task.review });
  if (
    policyIn(session, tenant).revision !== task.policy.revision ||
    today.revision !== task.rate.revision
  )
    return refuse('prc.review-superseded');
  const included = task.counts.entries - task.counts.excluded;
  if (included === 0) return refuse('prc.review-empty');
  const stale = staleSince(session, tenant, task, task.marks);
  if (stale > 0) return refuse('prc.review-stale', { stale });

  const batch: BatchRecord = {
    tenant,
    id: newId<'rate-review-batch'>(),
    task: task.id,
    branch: task.branch,
    state: 'staging',
    operation: command.operation,
    actor,
    reason: command.reason.trim(),
    at,
    total: included,
    staged: 0,
    publishedAt: null,
    failure: null,
    cursor: null,
    marks: marksOf(session, tenant),
    settled: false,
    lists: listsIn(session, tenant)
      .filter((one) => one.active)
      .map((one) => one.id),
  };
  const approving: TaskRecord = { ...task, state: 'approving', batch: batch.id };
  session.put(batchKey(tenant, batch.id), batch);
  session.put(taskKey(tenant, task.id), approving);
  session.put(workKey(tenant), [...workIn(session, tenant), batch.id]);
  const view = taskView(session, approving);
  session.put(operationKey(tenant, command.operation), {
    fingerprint: fingerprintOf(actor, 'approve', command),
    task: view,
  } satisfies Replay);
  return ok(view);
}

// ─── The monitor: detection and scans ─────────────────────────────────────────

function watchIn(session: RecordSession, tenant: TenantId, branch: BranchId): Watch {
  return (
    (session.get(watchKey(tenant, branch)) as Watch | undefined) ?? {
      rateRevision: null,
      policyRevision: 0,
      scan: null,
      task: null,
    }
  );
}

export function workIn(session: RecordSession, tenant: TenantId): readonly RateReviewBatchId[] {
  return (session.get(workKey(tenant)) as readonly RateReviewBatchId[] | undefined) ?? [];
}

/** Branches with a scan in progress. */
export function scanningIn(session: RecordSession, tenant: TenantId): readonly BranchId[] {
  const prefix = `${root(tenant)}watch/`;
  return within(session, prefix).flatMap((key): BranchId[] => {
    const watch = session.get(key) as Watch;
    return watch.scan === null ? [] : [key.slice(prefix.length) as BranchId];
  });
}

function freshScan(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  rate: PriceRate,
  policy: Scan['policy'],
  carry: RateReviewTaskId | null,
): Scan {
  return {
    task: newId<'rate-review-task'>(),
    rate,
    policy,
    cursor: null,
    counts: {
      frozen: ((found) => found.end - found.start)(range(session, branchPriceRoot(tenant, branch))),
      scanned: 0,
      moved: 0,
      entries: 0,
      excluded: 0,
      skipped: NO_SKIPS,
    },
    carry,
    marks: marksOf(session, tenant),
    raised: false,
  };
}

/**
 * Compares a branch's checkpoint with today's rate and the threshold, and
 * starts a scan when either has moved on. Whatever task the old rate or
 * threshold raised and nobody has decided is superseded in the same
 * transaction, so a branch never has two open tasks.
 *
 * `today` is null when the branch has no rate for today: nothing is compared,
 * and nothing is superseded — a task raised yesterday cannot be approved
 * without today's rate, and is superseded when today's is recorded.
 *
 * True when it changed anything.
 */
export function detect(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  today: PriceRate | null,
  at: Instant,
): boolean {
  const policy = policyIn(session, tenant);
  const watch = watchIn(session, tenant, branch);
  if (watch.scan !== null) return false;
  const threshold = policy.threshold;
  const rateRevision = threshold === null ? null : (today?.revision ?? watch.rateRevision);
  if (watch.policyRevision === policy.revision && watch.rateRevision === rateRevision) return false;
  if (threshold !== null && today === null) return false;

  const open = watch.task === null ? null : taskIn(session, tenant, watch.task);
  if (open !== null && (open.state === 'pending' || open.state === 'preparing'))
    session.put(
      taskKey(tenant, open.id),
      supersede(open, {
        at,
        cause: open.policy.revision === policy.revision ? 'rate-revised' : 'policy-changed',
        by: null,
      }),
    );
  const scan =
    threshold === null || today === null
      ? null
      : freshScan(session, tenant, branch, today, { revision: policy.revision, threshold }, null);
  session.put(watchKey(tenant, branch), {
    rateRevision,
    policyRevision: policy.revision,
    scan,
    task: watch.task,
  } satisfies Watch);
  return true;
}

/** One frozen price the scan reached, and what it found. */
export interface Candidate extends DisplayPriceTarget {
  readonly key: string;
  readonly frozen: DisplayPrice;
  readonly usd: UsdPrice | null;
  readonly verdict: 'within' | 'list-inactive' | 'usd-missing' | 'moved';
}

export interface ScanStep {
  readonly scan: Scan;
  readonly candidates: readonly Candidate[];
  /** Whether this step reaches the last frozen price. */
  readonly last: boolean;
}

/** The next page of a branch's frozen prices, each judged against the threshold. */
export function scanStep(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  size: number,
): ScanStep | null {
  const { scan } = watchIn(session, tenant, branch);
  if (scan === null) return null;
  const prefix = branchPriceRoot(tenant, branch);
  const page: string[] = [];
  let more = false;
  for (const key of after(
    session,
    prefix,
    scan.cursor === null ? null : `${prefix}${scan.cursor}`,
  )) {
    if (page.length === size) {
      more = true;
      break;
    }
    page.push(key);
  }
  const candidates = page.map((key): Candidate => {
    const [item, list, unit] = key.slice(prefix.length).split('/') as [
      PriceSubject['item'],
      PriceSubject['list'],
      PriceSubject['unit'],
    ];
    const target = { branch, subject: { item, list, unit } };
    const frozen = storedDisplayPrice(session, tenant, target);
    if (frozen === null) throw new Error(`A frozen price listed at ${key} cannot be read.`);
    const usd = currentPrice(session, tenant, target.subject);
    const judged = (): Candidate['verdict'] => {
      if (!moved(frozen.basis.rate.rate, scan.rate.rate, scan.policy.threshold)) return 'within';
      if (listIn(session, tenant, list)?.active !== true) return 'list-inactive';
      if (usd === null) return 'usd-missing';
      return 'moved';
    };
    return { key, ...target, frozen, usd, verdict: judged() };
  });
  return { scan, candidates, last: !more };
}

/**
 * Writes one scanned page: its listed prices, the counts, and — with the last
 * page — the task made ready for review. Refused (`false`) when anything read
 * for the page has changed since, or another process has taken the step: the
 * next drive reads the page again.
 *
 * `figures` has an answer for every candidate the catalogue still knows that
 * `FX` restated, keyed by candidate key; `invalid` the keys the catalogue does
 * not.
 */
export function putScanStep(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  step: ScanStep,
  figures: ReadonlyMap<string, ConvertedPrice>,
  invalid: ReadonlySet<string>,
  at: Instant,
  publish: (task: RateReviewTask) => void,
): boolean {
  const watch = watchIn(session, tenant, branch);
  const scan = watch.scan;
  if (scan === null) return false;
  if (scan.task !== step.scan.task || scan.cursor !== step.scan.cursor) return false;
  for (const one of step.candidates) {
    const frozen = storedDisplayPrice(session, tenant, one);
    const usd = currentPrice(session, tenant, one.subject);
    if (frozen?.revision !== one.frozen.revision || usd?.revision !== one.usd?.revision)
      return false;
  }

  const carry = scan.carry;
  const skipped = { ...scan.counts.skipped };
  let { moved: reached, entries, excluded } = scan.counts;
  for (const one of step.candidates) {
    if (one.verdict === 'within') continue;
    reached += 1;
    if (one.verdict !== 'moved') {
      skipped[one.verdict] += 1;
      continue;
    }
    if (invalid.has(one.key)) {
      skipped['subject-invalid'] += 1;
      continue;
    }
    const figure = figures.get(one.key);
    if (figure === undefined || one.usd === null)
      throw new Error(`A price the rate moved past at ${one.key} was never restated.`);
    if (figure.amount.amount.lte(0)) {
      skipped['amount-invalid'] += 1;
      continue;
    }
    const proposed = toDecimalString(figure.amount);
    if (new Dec(proposed).equals(new Dec(one.frozen.amount))) {
      skipped.unchanged += 1;
      continue;
    }
    const carried =
      carry === null
        ? undefined
        : (session.get(entryKey(tenant, carry, one.subject)) as EntryRecord | undefined);
    const keepOut = carried !== undefined && !carried.included;
    const record: EntryRecord = {
      task: scan.task,
      branch,
      subject: one.subject,
      current: {
        amount: one.frozen.amount,
        revision: one.frozen.revision,
        basis: one.frozen.basis,
      },
      usd: { amount: one.usd.amount, revision: one.usd.revision },
      proposed,
      exact: toDecimalString(figure.exact),
      residual: toDecimalString(figure.residual.amount),
      rounding: figure.rounding,
      included: !keepOut,
      exclusion: keepOut ? carried.exclusion : null,
    };
    session.put(entryKey(tenant, scan.task, one.subject), record);
    if (keepOut) {
      session.put(excludedKey(tenant, scan.task, one.subject), true);
      excluded += 1;
    }
    entries += 1;
  }
  const counts: RateReviewCounts = {
    ...scan.counts,
    scanned: scan.counts.scanned + step.candidates.length,
    moved: reached,
    entries,
    excluded,
    skipped,
  };
  const lastKey = step.candidates.at(-1)?.key;
  const cursor =
    lastKey === undefined ? scan.cursor : lastKey.slice(branchPriceRoot(tenant, branch).length);
  const raised = scan.raised || entries > 0;
  if (raised) {
    const prior = taskIn(session, tenant, scan.task);
    const record: TaskRecord = {
      tenant,
      id: scan.task,
      branch,
      rate: scan.rate,
      policy: scan.policy,
      state: step.last ? 'pending' : 'preparing',
      raisedAt: prior?.raisedAt ?? at,
      review: 0,
      counts,
      decision: null,
      supersession: null,
      batch: null,
      marks: scan.marks,
    };
    session.put(taskKey(tenant, scan.task), record);
    if (step.last) publish(taskView(session, record));
  }
  session.put(watchKey(tenant, branch), {
    ...watch,
    scan: step.last ? null : { ...scan, cursor, counts, raised },
    task: raised ? scan.task : watch.task,
  } satisfies Watch);
  return true;
}

/**
 * A scan that cannot finish: today's rate went, or changed, while it ran. It
 * is dropped with whatever it had listed — superseded — and the checkpoint
 * forgets the rate, so the next detection compares afresh.
 */
export function putScanAbandoned(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  scanTask: RateReviewTaskId,
  at: Instant,
): void {
  const watch = watchIn(session, tenant, branch);
  if (watch.scan?.task !== scanTask) return;
  const raised = taskIn(session, tenant, scanTask);
  if (raised !== null)
    session.put(
      taskKey(tenant, scanTask),
      supersede(raised, { at, cause: 'rate-revised', by: null }),
    );
  session.put(watchKey(tenant, branch), {
    ...watch,
    rateRevision: null,
    scan: null,
    task: raised === null ? watch.task : scanTask,
  } satisfies Watch);
}

// ─── The monitor: staging, publishing, folding ────────────────────────────────

export interface BatchWork {
  readonly batch: BatchRecord;
  readonly task: TaskRecord;
}

export function batchWork(
  session: RecordSession,
  tenant: TenantId,
  id: RateReviewBatchId,
): BatchWork | null {
  const batch = batchIn(session, tenant, id);
  const task = batch === null ? null : taskIn(session, tenant, batch.task);
  return batch === null || task === null ? null : { batch, task };
}

export interface StagingStep extends BatchWork {
  readonly entries: readonly EntryRecord[];
  /** No entries left, yet fewer staged than approved: the task changed under the batch. */
  readonly short: boolean;
  /** Listed prices already changed from what the task lists. */
  readonly stale: number;
}

/** The next page of included prices to stage. */
export function stagingStep(
  session: RecordSession,
  tenant: TenantId,
  work: BatchWork,
  size: number,
): StagingStep {
  const prefix = entryRoot(tenant, work.task.id);
  const cursor = work.batch.cursor === null ? null : `${prefix}${work.batch.cursor}`;
  const entries: EntryRecord[] = [];
  let stale = 0;
  for (const key of after(session, prefix, cursor)) {
    const record = session.get(key) as EntryRecord;
    if (!record.included) continue;
    if (entries.length === size) break;
    entries.push(record);
    if (entryStale(session, tenant, record)) stale += 1;
  }
  return {
    ...work,
    entries,
    stale,
    short: entries.length === 0 && work.batch.staged !== work.batch.total,
  };
}

/** Whether `FX`'s figure today is exactly the one the task lists. */
export function sameFigure(record: EntryRecord, figure: ConvertedPrice, rate: PriceRate): boolean {
  return (
    figure.rate.revision === rate.revision &&
    toDecimalString(figure.amount) === record.proposed &&
    toDecimalString(figure.exact) === record.exact &&
    toDecimalString(figure.residual.amount) === record.residual &&
    figure.rounding.increment === record.rounding.increment &&
    figure.rounding.mode === record.rounding.mode
  );
}

/**
 * Stages a page: each price as it will be published, and its audit entry,
 * where no read looks until the batch is published. Nothing changes that any
 * reader sees. False when another process has taken the step.
 */
export function putStagingStep(
  session: RecordSession,
  tenant: TenantId,
  step: StagingStep,
): boolean {
  const batch = batchIn(session, tenant, step.batch.id);
  if (batch?.state !== 'staging' || batch.cursor !== step.batch.cursor) return false;
  if (step.entries.some((record) => entryStale(session, tenant, record))) return false;
  const sequenceKey = displaySequenceKey(tenant);
  let sequence = (session.get(sequenceKey) as number | undefined) ?? 0;
  for (const record of step.entries) {
    sequence += 1;
    const basis = basisOfEntry(step.task, record);
    const price: DisplayPrice = {
      tenant,
      branch: record.branch,
      subject: record.subject,
      amount: record.proposed,
      currency: DISPLAY_CURRENCY,
      revision: record.current.revision + 1,
      basis,
      approvedBy: batch.actor,
      approvedAt: batch.at,
      reason: batch.reason,
      batch: batch.id,
    };
    const change: DisplayPriceChange = {
      tenant,
      branch: record.branch,
      subject: record.subject,
      operation: batch.operation,
      actor: batch.actor,
      at: batch.at,
      currency: DISPLAY_CURRENCY,
      oldAmount: record.current.amount,
      oldBasis: record.current.basis,
      newAmount: record.proposed,
      basis,
      reason: batch.reason,
      revision: price.revision,
      sequence,
      batch: batch.id,
    };
    const history = historyKeyOf(tenant, change);
    session.put(history, change);
    session.put(stagedKey(tenant, batch.id, record.subject), {
      price,
      history,
    } satisfies StagedPrice);
  }
  session.put(sequenceKey, sequence);
  const last = step.entries.at(-1);
  session.put(batchKey(tenant, batch.id), {
    ...batch,
    staged: batch.staged + step.entries.length,
    cursor: last === undefined ? batch.cursor : subjectPath(last.subject),
  } satisfies BatchRecord);
  return true;
}

/**
 * The publication boundary: one small write that makes every staged price the
 * frozen price at once, with its audit, and decides the task.
 *
 * Checked here, in this transaction, against every change since the batch was
 * approved: a dollar price or frozen price of an included entry, and the
 * threshold. The rate is checked by the caller just before, from `FX`; a
 * correction committing between the two is a correction after publication,
 * and raises a task of its own.
 */
export function putPublication(
  session: RecordSession,
  tenant: TenantId,
  work: BatchWork,
  today: PriceRate,
  at: Instant,
  publish: (batch: RateReviewBatch) => void,
): void {
  const batch = batchIn(session, tenant, work.batch.id);
  const task = taskIn(session, tenant, work.task.id);
  if (batch?.state !== 'staging' || task === null || batch.staged !== batch.total) return;
  if (
    today.revision !== task.rate.revision ||
    policyIn(session, tenant).revision !== task.policy.revision
  ) {
    abandon(session, tenant, batch, task, 'superseded', 0, at);
    return;
  }
  const stale =
    staleSince(session, tenant, task, batch.marks, batch.id) +
    onWithdrawnLists(session, tenant, task.id, batch.lists);
  if (stale > 0) {
    abandon(session, tenant, batch, task, 'stale', stale, at);
    return;
  }
  const published: BatchRecord = { ...batch, state: 'published', publishedAt: at };
  session.put(batchKey(tenant, batch.id), published);
  session.put(taskKey(tenant, task.id), {
    ...task,
    state: 'approved',
    decision: {
      kind: 'approved',
      actor: batch.actor,
      at: batch.at,
      reason: batch.reason,
      operation: batch.operation,
    },
  } satisfies TaskRecord);
  const overlay = overlayKey(tenant, batch.branch);
  const layered = (session.get(overlay) as readonly RateReviewBatchId[] | undefined) ?? [];
  session.put(overlay, [...layered, batch.id]);
  publish(batchView(published));
}

/**
 * A batch that cannot be published. Nothing of it was ever visible; its task
 * goes back to review when a price changed, and is superseded when the rate
 * or threshold did. Its staged prices are cleared by later steps.
 */
export function abandon(
  session: RecordSession,
  tenant: TenantId,
  batch: BatchRecord,
  task: TaskRecord,
  cause: 'stale' | 'superseded',
  stale: number,
  at: Instant,
): void {
  session.put(batchKey(tenant, batch.id), {
    ...batch,
    state: 'abandoned',
    failure: { cause, at, stale },
  } satisfies BatchRecord);
  session.put(
    taskKey(tenant, task.id),
    cause === 'stale'
      ? ({ ...task, state: 'pending' } satisfies TaskRecord)
      : supersede(task, {
          at,
          cause:
            policyIn(session, tenant).revision === task.policy.revision
              ? 'rate-revised'
              : 'policy-changed',
          by: null,
        }),
  );
}

/**
 * Folds a page of a published batch's staged prices into their own records,
 * or clears a page of an abandoned one's. Either way the staged price goes;
 * the reader's answer does not change, because a published staged price and
 * the record it is folded into are the same figure, and a later record is
 * never written over. With the last page, the batch is settled and leaves the
 * work, and — published — the branch's read-through.
 */
export function putSettlingStep(
  session: RecordSession,
  tenant: TenantId,
  id: RateReviewBatchId,
  size: number,
): void {
  const batch = batchIn(session, tenant, id);
  if (batch === null || batch.state === 'staging' || batch.settled) return;
  const { keys: listing, start, end } = range(session, stagedRoot(tenant, id));
  const keys = listing.slice(start, Math.min(end, start + size + 1));
  for (const key of keys.slice(0, size)) {
    const staged = session.get(key) as StagedPrice;
    if (batch.state === 'published') {
      const own = ownDisplayPrice(session, tenant, staged.price);
      if (own === null || own.revision < staged.price.revision)
        putOwnDisplayPrice(session, tenant, staged.price);
    } else session.remove(staged.history);
    session.remove(key);
  }
  if (keys.length > size) return;
  session.put(batchKey(tenant, id), { ...batch, settled: true } satisfies BatchRecord);
  session.put(
    workKey(tenant),
    workIn(session, tenant).filter((one) => one !== id),
  );
  if (batch.state === 'published') {
    const overlay = overlayKey(tenant, batch.branch);
    const layered = (
      (session.get(overlay) as readonly RateReviewBatchId[] | undefined) ?? []
    ).filter((one) => one !== id);
    if (layered.length === 0) session.remove(overlay);
    else session.put(overlay, layered);
  }
}
