import type { TenantId } from '@vertex/contracts';
import {
  isDecimalString,
  isId,
  isRounded,
  money,
  ok,
  refuse,
  toDecimalString,
  type Currency,
  type Result,
} from '@vertex/kernel';
import type { ItemId, ItemUnitId } from '@vertex/cat/contract';
import type {
  PriceHistoryFilter,
  PriceHistoryPage,
  PriceSubject,
  PrcRefusal,
  UsdPrice,
  UsdPriceChange,
  UsdPriceCommand,
} from './contract.js';
import { listIn, type RecordSession } from './price-lists.js';

type Outcome<T> = Result<T, PrcRefusal>;
const root = (tenant: TenantId): string => `prc/usd/${encodeURIComponent(tenant)}/`;
const priceRoot = (tenant: TenantId): string => `${root(tenant)}price/`;
const historyRoot = (tenant: TenantId): string => `${root(tenant)}history/`;
const operationRoot = (tenant: TenantId): string => `${root(tenant)}operation/`;
const priceKey = (tenant: TenantId, subject: PriceSubject): string =>
  `${priceRoot(tenant)}${subject.item}/${subject.list}/${subject.unit}`;

export function validSubject(subject: unknown): subject is PriceSubject {
  if (typeof subject !== 'object' || subject === null || Array.isArray(subject)) return false;
  const fields = subject as Record<string, unknown>;
  return ['list', 'item', 'unit'].every(
    (field) => typeof fields[field] === 'string' && isId(fields[field]),
  );
}

export function currentPrice(
  session: RecordSession,
  tenant: TenantId,
  subject: PriceSubject,
): UsdPrice | null {
  return (session.get(priceKey(tenant, subject)) as UsdPrice | undefined) ?? null;
}

export function itemPrices(
  session: RecordSession,
  tenant: TenantId,
  item: ItemId,
  units: readonly ItemUnitId[],
): readonly UsdPrice[] {
  const found: UsdPrice[] = [];
  for (const key of session.keys()) {
    if (!key.startsWith(`${priceRoot(tenant)}${item}/`)) continue;
    const price = session.get(key) as UsdPrice;
    if (
      price.subject.item === item &&
      units.includes(price.subject.unit) &&
      listIn(session, tenant, price.subject.list)
    )
      found.push(price);
  }
  return found.sort(
    (a, b) =>
      a.subject.list.localeCompare(b.subject.list) || a.subject.unit.localeCompare(b.subject.unit),
  );
}

export function validateCommand(command: unknown, usd: Currency): Outcome<UsdPriceCommand> {
  if (typeof command !== 'object' || command === null || Array.isArray(command))
    return refuse('prc.subject-invalid');
  const fields = command as Record<string, unknown>;
  if (!validSubject(fields['subject'])) return refuse('prc.subject-invalid');
  if (typeof fields['operation'] !== 'string' || !isId(fields['operation']))
    return refuse('prc.operation-invalid');
  if (
    typeof fields['expectedRevision'] !== 'number' ||
    !Number.isSafeInteger(fields['expectedRevision']) ||
    fields['expectedRevision'] < 0 ||
    fields['expectedRevision'] >= Number.MAX_SAFE_INTEGER
  )
    return refuse('prc.revision-stale');
  if (
    typeof fields['reason'] !== 'string' ||
    fields['reason'].trim() === '' ||
    fields['reason'].length > 500
  )
    return refuse('prc.reason-required');
  const input = fields['amount'];
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return refuse('prc.amount-invalid');
  const figure = input as Record<string, unknown>;
  if (
    usd.code !== 'USD' ||
    figure['currency'] !== 'USD' ||
    typeof figure['amount'] !== 'string' ||
    figure['amount'].length > 32 ||
    !isDecimalString(figure['amount'])
  )
    return refuse('prc.amount-invalid');
  const parsed = money(figure['amount'], usd.code);
  const decimals = figure['amount'].split('.')[1]?.length ?? 0;
  if (
    decimals > usd.decimals ||
    parsed.amount.lte(0) ||
    parsed.amount.gt('999999999999.99') ||
    !isRounded(parsed, { ...usd, code: 'USD' })
  )
    return refuse('prc.amount-invalid');
  return ok(command as UsdPriceCommand);
}

export function putPrice(
  session: RecordSession,
  tenant: TenantId,
  actor: UsdPriceChange['actor'],
  at: UsdPriceChange['at'],
  command: UsdPriceCommand,
): Outcome<UsdPrice> {
  const opKey = `${operationRoot(tenant)}${command.operation}`;
  const fingerprint = JSON.stringify({
    actor,
    subject: command.subject,
    amount: command.amount,
    expectedRevision: command.expectedRevision,
    reason: command.reason,
  });
  const prior = session.get(opKey) as { fingerprint: string; price: UsdPrice } | undefined;
  if (prior)
    return prior.fingerprint === fingerprint ? ok(prior.price) : refuse('prc.operation-reused');
  const list = listIn(session, tenant, command.subject.list);
  if (!list) return refuse('prc.list-not-found');
  if (!list.active) return refuse('prc.list-inactive');
  const old = currentPrice(session, tenant, command.subject);
  if ((old?.revision ?? 0) !== command.expectedRevision)
    return refuse('prc.revision-stale', { currentRevision: old?.revision ?? 0 });
  const amount = toDecimalString(money(command.amount.amount, 'USD'));
  const sequenceKey = `${root(tenant)}sequence`;
  const sequence = ((session.get(sequenceKey) as number | undefined) ?? 0) + 1;
  const price: UsdPrice = {
    tenant,
    subject: command.subject,
    amount,
    currency: 'USD',
    revision: command.expectedRevision + 1,
  };
  const change: UsdPriceChange = {
    tenant,
    subject: command.subject,
    operation: command.operation,
    actor,
    at,
    oldAmount: old?.amount ?? null,
    newAmount: amount,
    reason: command.reason.trim(),
    revision: price.revision,
    sequence,
  };
  session.put(sequenceKey, sequence);
  session.put(priceKey(tenant, command.subject), price);
  session.put(
    `${historyRoot(tenant)}${String(sequence).padStart(16, '0')}/${String(at).padStart(16, '0')}/${command.subject.item}/${command.subject.list}/${command.subject.unit}`,
    change,
  );
  session.put(opKey, { fingerprint, price });
  return ok(price);
}

export function priceHistory(
  session: RecordSession,
  tenant: TenantId,
  filter: PriceHistoryFilter,
): Outcome<PriceHistoryPage> {
  const candidate: unknown = filter;
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
    return refuse('prc.history-query-invalid');
  const validId = (value: unknown): boolean =>
    value === undefined || (typeof value === 'string' && isId(value));
  const validTime = (value: unknown): boolean =>
    value === undefined || (typeof value === 'number' && Number.isSafeInteger(value));
  if (
    !validId(filter.item) ||
    !validId(filter.list) ||
    !validId(filter.unit) ||
    !validTime(filter.from) ||
    !validTime(filter.to) ||
    (filter.before !== undefined && (!Number.isSafeInteger(filter.before) || filter.before < 1)) ||
    (filter.limit !== undefined &&
      (!Number.isSafeInteger(filter.limit) || filter.limit < 1 || filter.limit > 100))
  )
    return refuse('prc.history-query-invalid');
  const limit = filter.limit ?? 50;
  const matching = session
    .keys()
    .filter((key) => key.startsWith(historyRoot(tenant)))
    .flatMap((key) => {
      const [sequence, at, item, list, unit] = key.slice(historyRoot(tenant).length).split('/');
      if (!sequence || !at || !item || !list || !unit) return [];
      const position = Number(sequence);
      const time = Number(at);
      return (!filter.item || item === filter.item) &&
        (!filter.list || list === filter.list) &&
        (!filter.unit || unit === filter.unit) &&
        (filter.from === undefined || time >= filter.from) &&
        (filter.to === undefined || time <= filter.to) &&
        (filter.before === undefined || position < filter.before)
        ? [{ key, position }]
        : [];
    })
    .sort((a, b) => b.position - a.position)
    .slice(0, limit + 1);
  const entries = matching.slice(0, limit).map(({ key }) => session.get(key) as UsdPriceChange);
  const last = entries.at(-1);
  return ok({
    entries,
    next: matching.length > limit && last ? last.sequence : null,
  });
}
