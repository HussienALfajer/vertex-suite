import type { TenantId } from '@vertex/contracts';
import { isDecimalString, isId, ok, refuse, type Result } from '@vertex/kernel';
import type { UnitOfWork } from '@vertex/platform';
import { convertItemQuantity, itemIn } from './catalogue.js';
import { INVENTORY_ROLE } from './contract.js';
import type {
  CatRefusal,
  CostDirection,
  CostMovementId,
  CostQuote,
  InventoryPosting,
  ItemCost,
  ItemId,
  ItemUnitId,
  RecordSession,
} from './contract.js';

type Outcome<T> = Result<T, CatRefusal>;
const costKey = (tenant: TenantId, item: ItemId): string => `cat/cost/${tenant}/${item}`;
const movementKey = (tenant: TenantId, id: CostMovementId): string =>
  `cat/cost-movement/${tenant}/${id}`;

function scaled(value: string, places: number): bigint | null {
  if (!isDecimalString(value) || value.length > 40 || value.startsWith('-')) return null;
  const [whole = '', fraction = ''] = value.replace(/^\+/, '').split('.');
  if (fraction.length > places && /[1-9]/u.test(fraction.slice(places))) return null;
  const fractional = fraction.slice(0, places).padEnd(places, '0');
  return (
    BigInt(whole === '' ? '0' : whole) * 10n ** BigInt(places) +
    BigInt(fractional === '' ? '0' : fractional)
  );
}

function decimal(value: bigint, places: number): string {
  const digits = value.toString().padStart(places + 1, '0');
  if (places === 0) return digits;
  const fraction = digits.slice(-places).replace(/0+$/u, '');
  return `${digits.slice(0, -places)}${fraction ? `.${fraction}` : ''}`;
}

function state(s: RecordSession, tenant: TenantId, item: ItemId): Outcome<ItemCost> {
  const found = itemIn(s, tenant, item);
  if (found === null) return refuse('cat.item-not-found');
  const baseUnit = found.units[0];
  if (baseUnit === undefined) throw new Error('Item has no base unit.');
  const stored = s.get(costKey(tenant, item)) as ItemCost | undefined;
  if (stored !== undefined) {
    const quantity = scaled(stored.quantity, found.baseUnit.decimals);
    const value = scaled(stored.valueUSD, 2);
    if (
      stored.item !== item ||
      stored.baseUnit.id !== baseUnit.id ||
      quantity === null ||
      value === null ||
      (quantity === 0n && value !== 0n) ||
      !Number.isSafeInteger(stored.revision) ||
      stored.revision < 0 ||
      (quantity === 0n
        ? stored.average !== null
        : stored.average?.valueUSD !== stored.valueUSD ||
          stored.average.quantity !== stored.quantity)
    )
      throw new Error('Corrupt item cost record.');
    return ok(stored);
  }
  return ok({
    item,
    baseUnit,
    quantity: '0',
    valueUSD: '0',
    average: null,
    revision: 0,
  });
}

export const costSnapshot = state;

function sameCost(left: ItemCost, right: ItemCost): boolean {
  return (
    left.item === right.item &&
    left.baseUnit.id === right.baseUnit.id &&
    left.baseUnit.unit.code === right.baseUnit.unit.code &&
    left.baseUnit.unit.kind === right.baseUnit.unit.kind &&
    left.baseUnit.unit.decimals === right.baseUnit.unit.decimals &&
    left.quantity === right.quantity &&
    left.valueUSD === right.valueUSD &&
    left.average?.valueUSD === right.average?.valueUSD &&
    left.average?.quantity === right.average?.quantity &&
    left.revision === right.revision
  );
}

function sameQuote(left: CostQuote, right: CostQuote): boolean {
  return (
    left.movement === right.movement &&
    left.item === right.item &&
    left.direction === right.direction &&
    left.quantity === right.quantity &&
    left.valueUSD === right.valueUSD &&
    sameCost(left.before, right.before) &&
    sameCost(left.after, right.after)
  );
}

function quote(
  s: RecordSession,
  tenant: TenantId,
  movement: CostMovementId,
  item: ItemId,
  amount: string,
  unit: ItemUnitId,
  direction: CostDirection,
  receiptValue?: string,
): Outcome<CostQuote> {
  if (typeof movement !== 'string' || !isId(movement)) return refuse('cat.cost-movement-taken');
  const before = state(s, tenant, item);
  if (!before.ok) return before;
  const converted = convertItemQuantity(s, tenant, item, amount, unit, before.value.baseUnit.id);
  if (!converted.ok) return converted;
  const places = before.value.baseUnit.unit.decimals;
  const quantity = scaled(converted.value.amount, places);
  if (quantity === null || quantity <= 0n) return refuse('cat.cost-quantity-invalid');
  const receiptCents =
    direction === 'receipt' && typeof receiptValue === 'string' ? scaled(receiptValue, 2) : null;
  if (direction === 'receipt' && receiptCents === null) return refuse('cat.cost-value-invalid');
  const existing = s.get(movementKey(tenant, movement)) as CostQuote | undefined;
  if (existing !== undefined)
    return existing.item === item &&
      existing.direction === direction &&
      existing.quantity === decimal(quantity, places) &&
      (direction === 'issue' ||
        (receiptCents !== null && existing.valueUSD === decimal(receiptCents, 2)))
      ? ok(existing)
      : refuse('cat.cost-movement-taken');
  const oldQuantity = scaled(before.value.quantity, places);
  const oldValue = scaled(before.value.valueUSD, 2);
  if (oldQuantity === null || oldValue === null) throw new Error('Corrupt item cost record.');
  let value: bigint;
  if (direction === 'receipt') {
    if (receiptCents === null) return refuse('cat.cost-value-invalid');
    value = receiptCents;
  } else {
    if (quantity > oldQuantity) return refuse('cat.cost-insufficient-stock');
    // The final issue takes the entire residual. Partial issues round once to
    // cents, half up; the residual stays with stock and never vanishes.
    value =
      quantity === oldQuantity
        ? oldValue
        : (oldValue * quantity * 2n + oldQuantity) / (oldQuantity * 2n);
  }
  const nextQuantity = direction === 'receipt' ? oldQuantity + quantity : oldQuantity - quantity;
  const nextValue = direction === 'receipt' ? oldValue + value : oldValue - value;
  const after: ItemCost = {
    ...before.value,
    quantity: decimal(nextQuantity, places),
    valueUSD: decimal(nextValue, 2),
    average:
      nextQuantity === 0n
        ? null
        : { valueUSD: decimal(nextValue, 2), quantity: decimal(nextQuantity, places) },
    revision: before.value.revision + 1,
  };
  const planned: CostQuote = {
    movement,
    item,
    direction,
    quantity: decimal(quantity, places),
    valueUSD: decimal(value, 2),
    before: before.value,
    after,
  };
  return ok(planned);
}

export function quoteReceipt(
  s: RecordSession,
  tenant: TenantId,
  movement: CostMovementId,
  item: ItemId,
  quantity: string,
  unit: ItemUnitId,
  valueUSD: string,
): Outcome<CostQuote> {
  return quote(s, tenant, movement, item, quantity, unit, 'receipt', valueUSD);
}

export function quoteIssue(
  s: RecordSession,
  tenant: TenantId,
  movement: CostMovementId,
  item: ItemId,
  quantity: string,
  unit: ItemUnitId,
): Outcome<CostQuote> {
  return quote(s, tenant, movement, item, quantity, unit, 'issue');
}

function verifyPosting(tenant: TenantId, quote: CostQuote, posted: InventoryPosting | null): void {
  if (posted === null) {
    if (quote.valueUSD === '0') return;
    throw new Error('Item cost changed without a posted inventory entry.');
  }
  const inventory = posted.lines.filter((line) => line.role === INVENTORY_ROLE);
  const line = inventory[0];
  if (line === undefined || inventory.length !== 1)
    throw new Error('Item cost and posted inventory entry disagree.');
  if (
    posted.entry.tenant !== tenant ||
    posted.entry.source.document !== quote.movement ||
    line.side !== (quote.direction === 'receipt' ? 'debit' : 'credit') ||
    !(
      (line.amount.currency === 'USD' && line.amount.amount === quote.valueUSD) ||
      (line.amount.currency !== 'USD' &&
        line.original?.currency === 'USD' &&
        line.original.amount === quote.valueUSD)
    )
  )
    throw new Error('Item cost and posted inventory entry disagree.');
}

export function applyCost(
  uow: UnitOfWork<RecordSession>,
  quote: CostQuote,
  posted: InventoryPosting | null,
): Outcome<ItemCost> {
  const tenant = uow.context.tenant;
  verifyPosting(tenant, quote, posted);
  const existing = uow.session.get(movementKey(tenant, quote.movement)) as CostQuote | undefined;
  if (existing !== undefined) {
    if (!sameQuote(existing, quote))
      throw new Error('A cost movement was replayed with different facts.');
    return ok(existing.after);
  }
  const current = state(uow.session, tenant, quote.item);
  if (!current.ok) throw new Error('Item cost was prepared for an item outside this tenant.');
  const recomputed =
    quote.direction === 'receipt'
      ? quoteReceipt(
          uow.session,
          tenant,
          quote.movement,
          quote.item,
          quote.quantity,
          current.value.baseUnit.id,
          quote.valueUSD,
        )
      : quoteIssue(
          uow.session,
          tenant,
          quote.movement,
          quote.item,
          quote.quantity,
          current.value.baseUnit.id,
        );
  if (!recomputed.ok || !sameQuote(recomputed.value, quote))
    throw new Error('Item cost changed after the entry was prepared.');
  uow.session.put(costKey(tenant, quote.item), quote.after);
  uow.session.put(movementKey(tenant, quote.movement), quote);
  return ok(quote.after);
}
