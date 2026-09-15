import { instant, systemClock, type Clock, type Instant } from './clock.js';
import { EntropyUnavailableError, InvalidIdError } from './errors.js';

/**
 * Identifiers, generated on the device that creates the record.
 *
 * A register that has lost its connection still sells, so an identifier cannot
 * come from a database sequence, a central service, or anything else that has
 * to be asked for. It is generated locally, and it has to be unique against
 * every other device in the shop without any of them coordinating.
 *
 * The form is **UUIDv7** (RFC 9562 §5.7): 48 bits of millisecond timestamp,
 * then a counter, then randomness from a cryptographic source.
 *
 * Why not a random UUIDv4, the obvious offline choice. Two reasons, and the
 * second is the one that matters. A v4 lands at a random point in every index
 * it is written to, so a day of sales touches the whole B-tree instead of its
 * end; and rows in creation order then need a separate timestamp column with
 * its own index, which the identifier could have carried for nothing.
 *
 * Why not ULID, which sorts the same way: it is the same 128 bits in Crockford
 * base32, which no database has a native type for, so every boundary gains a
 * conversion and every mistaken one gains a bug. UUIDv7 is an IETF standard
 * that Postgres, SQLite and every tool the two are read with already handle.
 */

declare const IdEntity: unique symbol;

/**
 * An identifier for one kind of thing.
 *
 * The entity name exists only in the type: the value stored is a plain UUID, in
 * a uuid column, with nothing prefixed to it. What the brand buys is that
 * Id<'item'> cannot be passed where Id<'customer'> is expected — the class of
 * mistake that is invisible in review, because both are strings of the same
 * shape and the code reads correctly either way.
 */
export type Id<E extends string = string> = string & { readonly [IdEntity]: E };

/** Canonical UUIDv7: version nibble 7, variant bits 10, lower case. */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** 2^48 − 1 milliseconds, which the timestamp field runs out at in the year 10889. */
const MAX_TIMESTAMP = 281_474_976_710_655;

/** The 12-bit counter of RFC 9562 §6.2, method 1. */
const COUNTER_LIMIT = 0x1000;

/**
 * The counter is seeded in the lower 11 bits, so 2,048 identifiers can be
 * issued within one millisecond before it has to borrow from the next. Seeded
 * rather than started at zero because a counter that always starts at zero
 * announces how many records were written in each millisecond.
 */
const COUNTER_SEED_MASK = 0x7ffn;

const RAND_B_MASK = (1n << 62n) - 1n;

/**
 * Web Crypto, declared locally.
 *
 * tsconfig.base.json opts out of ambient types on purpose, and this package
 * runs in three places — the store node, the register's Electron process and
 * the browser — of which Web Crypto is the only randomness API present in all
 * three. Importing node:crypto would make the kernel unimportable in a browser
 * bundle, and the kernel is what the display layer formats money with.
 */
declare const crypto: { getRandomValues(array: Uint8Array): Uint8Array } | undefined;

function systemRandomBytes(count: number): Uint8Array {
  if (crypto === undefined) {
    throw new EntropyUnavailableError(
      'No cryptographic random source is available, so no identifier can be issued. ' +
        'Two devices seeded alike would file two different sales under one number.',
    );
  }
  return crypto.getRandomValues(new Uint8Array(count));
}

function bigintFromBytes(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

function format(value: bigint): string {
  const hex = value.toString(16).padStart(32, '0');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export interface IdGeneratorOptions {
  readonly clock?: Clock;
  /** Replaced only by tests, to make a generated value reproducible. */
  readonly randomBytes?: (count: number) => Uint8Array;
}

export interface IdGenerator {
  next<E extends string = string>(): Id<E>;
}

/**
 * An independent generator.
 *
 * Each one holds the last millisecond it issued at and the counter within it,
 * which is what makes two identifiers from the same generator strictly ordered
 * even when they are issued in the same millisecond — the ordering a receipt
 * line, a stock movement and a journal line all depend on.
 */
export function createIdGenerator(options: IdGeneratorOptions = {}): IdGenerator {
  const clock = options.clock ?? systemClock;
  const randomBytes = options.randomBytes ?? systemRandomBytes;

  let issuedAt = 0;
  let counter = 0;

  const seedCounter = (): number => Number(bigintFromBytes(randomBytes(2)) & COUNTER_SEED_MASK);

  return {
    next<E extends string = string>(): Id<E> {
      const observed = clock.now();

      if (observed > issuedAt) {
        issuedAt = observed;
        counter = seedCounter();
      } else {
        // The clock stood still, or went backwards — which it does, when an
        // operator corrects it or time synchronisation steps it back. The
        // generator keeps the last millisecond it used rather than following
        // the clock down: a later record must never sort before an earlier
        // one, and a value already issued must never be issued twice.
        counter += 1;
        if (counter >= COUNTER_LIMIT) {
          issuedAt += 1;
          counter = seedCounter();
        }
      }

      if (issuedAt < 0 || issuedAt > MAX_TIMESTAMP) {
        throw new InvalidIdError(
          `The clock reads ${String(issuedAt)}, which a UUIDv7 timestamp cannot carry.`,
        );
      }

      const value =
        (BigInt(issuedAt) << 80n) |
        (0x7n << 76n) |
        (BigInt(counter) << 64n) |
        (0b10n << 62n) |
        (bigintFromBytes(randomBytes(8)) & RAND_B_MASK);

      return format(value) as Id<E>;
    },
  };
}

const processGenerator = createIdGenerator();

/**
 * A new identifier from this process's generator.
 *
 * The entity is stated by the caller as a type argument — newId<'sale'>() — or,
 * more usually, by the module that owns the entity exporting a named
 * constructor for it.
 */
export function newId<E extends string = string>(): Id<E> {
  return processGenerator.next<E>();
}

/** True when the string is a canonical UUIDv7 this system would have issued. */
export function isId(value: string): boolean {
  return UUID_V7.test(value.trim().toLowerCase());
}

/**
 * Reads an identifier arriving from outside — a request, a sync payload, an
 * imported file — and states what it identifies.
 *
 * Upper case is accepted and normalised, because a UUID is case-insensitive by
 * specification and some systems emit it upper. Everything stored and compared
 * here is lower case, so that string equality is identifier equality.
 */
export function parseId<E extends string = string>(value: string): Id<E> {
  const normalised = value.trim().toLowerCase();
  if (!UUID_V7.test(normalised)) {
    throw new InvalidIdError(`"${value}" is not an identifier this system issues.`);
  }
  return normalised as Id<E>;
}

/**
 * The moment the issuing device believed it was when it generated this.
 *
 * A claim, not a fact: it is the clock of whatever device made the record, and
 * a register's clock is not authoritative (clock.ts). Useful for ordering and
 * for diagnosis; never the business date of a document, which is decided by the
 * shift the document belongs to (POS-01).
 */
export function timeOf(id: Id): Instant {
  return instant(Number(BigInt(`0x${id.slice(0, 8)}${id.slice(9, 13)}`)));
}

/**
 * Compares two identifiers. Lexicographic order is generation order, because
 * the timestamp is the leading field and every field is fixed-width hex.
 */
export function compareIds(a: Id, b: Id): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}
