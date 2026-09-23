// boundary-exempt: altitude — This opt-in store-node acceptance fixture ends when STK and POS own real movements.
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
const VERSION = 'syn03.fixture.version';
const MOVEMENT = 'syn03.fixture.movement.';

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

export class MovementConflictError extends Error {}

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
    throw new MovementConflictError('Stock movement identity already exists.');
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
