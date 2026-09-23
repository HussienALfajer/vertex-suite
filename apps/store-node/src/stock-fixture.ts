// boundary-exempt: altitude — This opt-in store-node acceptance fixture ends when STK and POS own real movements and sales.
import { Dec, isDecimalString, isId } from '@vertex/kernel';
import {
  stageOperation,
  type MemorySession,
  type MigrationDeclaration,
  type OperationEnvelope,
  type UnitOfWork,
} from '@vertex/platform';

/** U07.4's small sale fixture. U10/U12 replace its business command, not its transaction path. */
export const STOCK_FIXTURE_KIND = 'syn03.fixture-sale-movement';
/** U07.5's whole sale: one document, its movements and one operation, committed or not at all. */
export const SALE_FIXTURE_KIND = 'syn05.fixture-sale';
const VERSION = 'syn03.fixture.version';
const MOVEMENT = 'syn03.fixture.movement.';
const SALE = 'syn05.fixture.sale.';
/**
 * A sale travels as one operation so the store node applies it in one
 * transaction too. Sent a movement at a time, a power cut between two
 * deliveries would leave the server holding half a sale that the register
 * holds whole — the partial document SYN-05 forbids, only moved upstream.
 */
const MAX_SALE_LINES = 100;

export interface FixtureMovement {
  readonly movement: string;
  readonly tenant: string;
  readonly item: string;
  readonly location: string;
  readonly delta: string;
  readonly source: 'opening-fixture' | 'sale-fixture';
  readonly actor: string | null;
  readonly device: string | null;
  readonly sequence: number | null;
}

export interface SaleMovementPayload {
  readonly movement: string;
  readonly item: string;
  readonly location: string;
  readonly delta: string;
  readonly source: 'sale-fixture';
}

export interface FixtureSaleLine {
  readonly movement: string;
  readonly item: string;
  readonly location: string;
  readonly delta: string;
}

export interface FixtureSalePayload {
  readonly sale: string;
  readonly lines: readonly FixtureSaleLine[];
}

/** The stored sale document, on the register that rang it and on the store node that applied it. */
export interface FixtureSale extends FixtureSalePayload {
  readonly tenant: string;
  readonly actor: string | null;
  readonly device: string | null;
  readonly sequence: number;
}

/** What the till prints: taken from the document that committed, never from the command's input. */
export interface FixtureReceipt {
  readonly sale: string;
  readonly device: string;
  readonly sequence: number;
  readonly lines: readonly { readonly item: string; readonly delta: string }[];
}

export type ReceiptPrinter = (receipt: FixtureReceipt) => Promise<void>;

/** A movement or sale identity is already taken: a replay under a new key, or a sale rung twice. */
export class IdentityConflictError extends Error {}

export function stockFixtureMigrations(): readonly MigrationDeclaration<MemorySession>[] {
  return [
    {
      id: 'syn03.0001-stock-fixture',
      target: 'both',
      up(session) {
        if (session.get(VERSION) !== undefined)
          throw new Error('Stock fixture version exists without its journal.');
        session.put(VERSION, 1);
        return Promise.resolve();
      },
    },
  ];
}

function ready(session: MemorySession): void {
  if (session.get(VERSION) !== 1) throw new Error('Stock fixture migration has not run.');
}

function exactDelta(value: unknown, source: FixtureMovement['source']): string {
  if (
    typeof value !== 'string' ||
    !isDecimalString(value) ||
    !/^-?(?:\d{1,18})(?:\.\d{1,12})?$/u.test(value)
  )
    throw new TypeError('Invalid exact stock delta.');
  const decimal = new Dec(value);
  if (
    decimal.isZero() ||
    (source === 'sale-fixture' && !decimal.isNegative()) ||
    (source === 'opening-fixture' && !decimal.isPositive())
  )
    throw new TypeError('Invalid stock movement direction.');
  return value;
}

function movementKey(tenant: string, movement: string): string {
  return `${MOVEMENT}${tenant}.${movement}`;
}

function save(session: MemorySession, movement: FixtureMovement): void {
  ready(session);
  const key = movementKey(movement.tenant, movement.movement);
  if (session.get(key) !== undefined)
    throw new IdentityConflictError('Stock movement identity already exists.');
  session.put(key, movement);
}

export function openFixtureStock(
  uow: UnitOfWork<MemorySession>,
  input: {
    readonly movement: string;
    readonly item: string;
    readonly location: string;
    readonly quantity: string;
  },
): void {
  const { tenant } = uow.context;
  if (!isId(input.movement) || !isId(input.item) || !isId(input.location))
    throw new TypeError('Invalid opening stock identity.');
  save(uow.session, {
    movement: input.movement,
    tenant,
    item: input.item,
    location: input.location,
    delta: exactDelta(input.quantity, 'opening-fixture'),
    source: 'opening-fixture',
    actor: uow.context.actor,
    device: uow.context.device,
    sequence: null,
  });
}

export function stageFixtureSale(
  uow: UnitOfWork<MemorySession>,
  input: {
    readonly movement: string;
    readonly item: string;
    readonly location: string;
    readonly delta: string;
  },
): OperationEnvelope<SaleMovementPayload> {
  ready(uow.session);
  if (!isId(input.movement) || !isId(input.item) || !isId(input.location))
    throw new TypeError('Invalid sale movement identity.');
  const delta = exactDelta(input.delta, 'sale-fixture');
  const payload: SaleMovementPayload = {
    movement: input.movement,
    item: input.item,
    location: input.location,
    delta,
    source: 'sale-fixture',
  };
  const envelope = stageOperation(uow, STOCK_FIXTURE_KIND, payload);
  save(uow.session, {
    ...payload,
    tenant: uow.context.tenant,
    actor: uow.context.actor,
    device: uow.context.device,
    sequence: envelope.sequence,
  });
  return envelope;
}

export function parseSaleMovement(value: unknown): SaleMovementPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('Invalid sale movement.');
  const payload = value as Record<string, unknown>;
  if (
    Object.keys(payload).sort().join(',') !== 'delta,item,location,movement,source' ||
    payload['source'] !== 'sale-fixture' ||
    typeof payload['movement'] !== 'string' ||
    !isId(payload['movement']) ||
    typeof payload['item'] !== 'string' ||
    !isId(payload['item']) ||
    typeof payload['location'] !== 'string' ||
    !isId(payload['location'])
  )
    throw new TypeError('Invalid sale movement.');
  return {
    movement: payload['movement'],
    item: payload['item'],
    location: payload['location'],
    delta: exactDelta(payload['delta'], 'sale-fixture'),
    source: 'sale-fixture',
  };
}

export function applyFixtureSale(
  uow: UnitOfWork<MemorySession>,
  envelope: OperationEnvelope,
  payload: SaleMovementPayload,
): void {
  if (
    !fixtureMovements(uow.session, uow.context.tenant, payload.item, payload.location).some(
      (movement) => movement.source === 'opening-fixture',
    )
  )
    throw new TypeError('The stock fixture item has no opening movement at this location.');
  save(uow.session, {
    ...payload,
    tenant: uow.context.tenant,
    actor: uow.context.actor,
    device: uow.context.device,
    sequence: envelope.sequence,
  });
}

export function fixtureMovements(
  session: MemorySession,
  tenant: string,
  item: string,
  location: string,
): readonly FixtureMovement[] {
  ready(session);
  return session
    .keys()
    .filter((key) => key.startsWith(`${MOVEMENT}${tenant}.`))
    .map((key) => session.get(key) as FixtureMovement)
    .filter((movement) => movement.item === item && movement.location === location);
}

/** Authoritative quantity is recomputed from immutable movements; no absolute quantity crosses the wire. */
export function fixtureQuantity(
  session: MemorySession,
  tenant: string,
  item: string,
  location: string,
): string {
  const movements = fixtureMovements(session, tenant, item, location);
  // A fixture is bounded to 18 integer and 12 fractional digits per movement.
  // Decimal's 40 significant digits leave room for many millions of movements.
  return movements.reduce((total, one) => total.plus(one.delta), new Dec(0)).toString();
}

function saleKey(tenant: string, sale: string): string {
  return `${SALE}${tenant}.${sale}`;
}

function exactKeys(value: unknown, keys: string): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== keys
  )
    throw new TypeError('Invalid fixture sale.');
  return value as Record<string, unknown>;
}

/** Validates a sale wherever it arrives from — the till's own command, or the wire. */
export function parseFixtureSale(value: unknown): FixtureSalePayload {
  const input = exactKeys(value, 'lines,sale');
  const sale = input['sale'];
  const lines = input['lines'];
  if (
    typeof sale !== 'string' ||
    !isId(sale) ||
    !Array.isArray(lines) ||
    lines.length === 0 ||
    lines.length > MAX_SALE_LINES
  )
    throw new TypeError('Invalid fixture sale.');
  const parsed = lines.map((candidate: unknown): FixtureSaleLine => {
    const line = exactKeys(candidate, 'delta,item,location,movement');
    const { movement, item, location } = line;
    if (
      typeof movement !== 'string' ||
      !isId(movement) ||
      typeof item !== 'string' ||
      !isId(item) ||
      typeof location !== 'string' ||
      !isId(location)
    )
      throw new TypeError('Invalid fixture sale line.');
    return { movement, item, location, delta: exactDelta(line['delta'], 'sale-fixture') };
  });
  if (new Set(parsed.map((line) => line.movement)).size !== parsed.length)
    throw new TypeError('A fixture sale names one movement twice.');
  return { sale, lines: parsed };
}

/** Document first, then its movements: one commit carries all of them, so none is ever alone. */
function saveSale(
  uow: UnitOfWork<MemorySession>,
  envelope: OperationEnvelope,
  payload: FixtureSalePayload,
): FixtureSale {
  const { tenant, actor, device } = uow.context;
  const key = saleKey(tenant, payload.sale);
  if (uow.session.get(key) !== undefined)
    throw new IdentityConflictError('Sale identity already exists.');
  const document: FixtureSale = {
    sale: payload.sale,
    lines: payload.lines,
    tenant,
    actor,
    device,
    sequence: envelope.sequence,
  };
  uow.session.put(key, document);
  for (const line of payload.lines)
    save(uow.session, {
      ...line,
      tenant,
      source: 'sale-fixture',
      actor,
      device,
      sequence: envelope.sequence,
    });
  return document;
}

/**
 * Rings a sale on the till: the document, its movements and its outgoing
 * operation in the caller's one transaction, and the receipt deferred to after
 * that transaction commits (SYN-05).
 *
 * The receipt is not printed here because nothing here knows yet whether the
 * sale will exist. A receipt printed inside the command is a receipt for a sale
 * the power cut, a lost race or a refused line can still take away — and paper,
 * unlike a row, cannot be rolled back.
 */
export function recordFixtureSale(
  uow: UnitOfWork<MemorySession>,
  input: FixtureSalePayload,
  print: ReceiptPrinter,
): OperationEnvelope<FixtureSalePayload> {
  ready(uow.session);
  const payload = parseFixtureSale(input);
  const envelope = stageOperation(uow, SALE_FIXTURE_KIND, payload);
  const document = saveSale(uow, envelope, payload);
  const receipt: FixtureReceipt = {
    sale: document.sale,
    device: envelope.device,
    sequence: document.sequence,
    lines: document.lines.map(({ item, delta }) => ({ item, delta })),
  };
  uow.afterCommit(() => print(receipt));
  return envelope;
}

/** The store node's half: the whole sale applied in the transaction that records its receipt. */
export function applyFixtureSaleDocument(
  uow: UnitOfWork<MemorySession>,
  envelope: OperationEnvelope,
  payload: FixtureSalePayload,
): void {
  ready(uow.session);
  for (const { item, location } of payload.lines)
    if (
      !fixtureMovements(uow.session, uow.context.tenant, item, location).some(
        (movement) => movement.source === 'opening-fixture',
      )
    )
      throw new TypeError('The stock fixture item has no opening movement at this location.');
  saveSale(uow, envelope, payload);
}

export function fixtureSale(
  session: MemorySession,
  tenant: string,
  sale: string,
): FixtureSale | undefined {
  ready(session);
  return session.get(saleKey(tenant, sale)) as FixtureSale | undefined;
}
