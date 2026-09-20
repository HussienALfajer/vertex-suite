import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * How a password is stored, and why it is stored that way.
 *
 * **scrypt, from Node's own standard library.** The alternative worth having is
 * Argon2id, and it is not available without a native dependency that has to
 * compile on both certified platforms — Windows is the store-node and register
 * platform, Linux is the cloud target, and a shop is not a place where a failed
 * node-gyp build can be debugged. A dependency that might not install is a
 * dependency that eventually does not, in a shop, on a Sunday. scrypt is
 * memory-hard, standardised (RFC 7914), and already in the runtime this product
 * has decided to run on.
 *
 * **The parameters are stored beside the hash**, so raising them is not a
 * migration: a password written under the old cost still verifies under the
 * parameters it was written with, and is rewritten the next time its owner
 * signs in. A hash whose cost is implied by whatever the code happens to say
 * today is a hash nobody can ever raise the cost of.
 *
 * `N = 2^15, r = 8, p = 1` is about 32 MiB and roughly a tenth of a second on
 * the kind of machine a till runs on. That is the honest trade: a register
 * signs a cashier in at the start of a shift, not on every keystroke, and the
 * cost is paid once against an attacker who pays it for every guess.
 */

const SCHEME = 'scrypt';
const COST = 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

/**
 * scrypt needs `128 * N * r` bytes, and Node refuses at its own default of
 * 32 MiB — which is exactly what these parameters ask for.
 *
 * Worked out from the parameters actually being used rather than from the
 * constants above, because a stored credential carries its own and they are not
 * always this build's: `SYN-02` applies rows written on other devices. The
 * ceiling is what stops that becoming a way to make a store node allocate a
 * gigabyte by writing one number into one row.
 */
const MEMORY_CEILING = 512 * 1024 * 1024;

/**
 * The most work one stored credential may ask for: sixteen times today's.
 *
 * The memory ceiling above bounds `N` and `r` and says nothing about `p`,
 * which Node runs sequentially — so a synced row saying `p = 32766` pinned a
 * thread-pool thread for the better part of an hour per sign-in attempt, at the
 * start of a shift, with nothing refusing it. Room is left to raise the cost
 * without a release that refuses the credentials the previous one wrote.
 */
const WORK_CEILING = COST * BLOCK_SIZE * PARALLELISM * 16;

function memoryFor(cost: number, blockSize: number): number {
  return Math.min(128 * cost * blockSize * 2, MEMORY_CEILING);
}

/**
 * The shortest and the longest password this system will store, in characters
 * as a person counts them.
 *
 * Counted after composition and by code point. `length` counts UTF-16 units,
 * so an Arabic letter written as a base and a combining mark counted twice and
 * a four-letter password passed as eight.
 *
 * The ceiling is generous and exists so that a password is a password: a
 * megabyte pasted into the field is hashed in full, inside a transaction, on
 * the machine every till in the shop depends on.
 */
const MINIMUM_PASSWORD_LENGTH = 8;
const MAXIMUM_PASSWORD_LENGTH = 1024;

/** What is wrong with a password as a password, before anything is hashed. */
export function passwordLengthProblem(
  password: string,
): { readonly atLeast: number } | { readonly atMost: number } | null {
  // Code points, deliberately, and not grapheme clusters: a password is compared
  // as the code points it hashes, and an emoji sequence is as many characters to
  // a guesser as it has code points.
  const characters = Array.from(password.normalize('NFC')).length;
  if (characters < MINIMUM_PASSWORD_LENGTH) return { atLeast: MINIMUM_PASSWORD_LENGTH };
  if (characters > MAXIMUM_PASSWORD_LENGTH) return { atMost: MAXIMUM_PASSWORD_LENGTH };
  return null;
}

interface Parameters {
  readonly cost: number;
  readonly blockSize: number;
  readonly parallelism: number;
  readonly salt: Buffer;
  readonly key: Buffer;
}

function derive(password: string, parameters: Omit<Parameters, 'key'>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      // Normalised the same way on the way in and the way back, or a password
      // typed on a keyboard that composes Arabic differently from the one it
      // was set on fails to match a password that is, to the person, identical.
      password.normalize('NFC'),
      parameters.salt,
      KEY_BYTES,
      {
        N: parameters.cost,
        r: parameters.blockSize,
        p: parameters.parallelism,
        maxmem: memoryFor(parameters.cost, parameters.blockSize),
      },
      (failure, key) => {
        if (failure !== null) reject(failure);
        else resolve(key);
      },
    );
  });
}

/**
 * The stored form: `scrypt$32768$8$1$<salt>$<key>`, base64url throughout.
 *
 * Self-describing on purpose. The day the cost is raised, every password
 * already stored still says what it was written with, and nothing has to be
 * guessed from a deployment's history.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, {
    cost: COST,
    blockSize: BLOCK_SIZE,
    parallelism: PARALLELISM,
    salt,
  });
  return [
    SCHEME,
    String(COST),
    String(BLOCK_SIZE),
    String(PARALLELISM),
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

function parse(stored: string): Parameters | null {
  const parts = stored.split('$');
  if (parts.length !== 6) return null;
  const [scheme, cost, blockSize, parallelism, salt, key] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  if (scheme !== SCHEME) return null;

  const numbers = [Number(cost), Number(blockSize), Number(parallelism)];
  if (numbers.some((one) => !Number.isInteger(one) || one <= 0)) return null;
  const [parsedCost, parsedBlock, parsedParallel] = numbers as [number, number, number];
  if (parsedCost * parsedBlock * parsedParallel > WORK_CEILING) return null;

  return {
    cost: parsedCost,
    blockSize: parsedBlock,
    parallelism: parsedParallel,
    salt: Buffer.from(salt, 'base64url'),
    key: Buffer.from(key, 'base64url'),
  };
}

/**
 * Whether this password produces the stored key.
 *
 * Compared in constant time. The comparison of two hashes is not obviously
 * worth protecting — an attacker who can measure it is guessing a 64-byte value
 * rather than a password — but the cost is one function call, and a plain `===`
 * here is the kind of thing that gets copied into the place where it does
 * matter.
 *
 * A stored value this does not understand is **false**, never a throw. A row
 * written by a version that used a scheme this build has dropped must fail to
 * sign somebody in; it must not take the store node down at the moment the
 * shift starts.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parameters = parse(stored);
  if (parameters === null || parameters.key.length === 0) return false;

  let key;
  try {
    key = await derive(password, parameters);
  } catch {
    // A parameter this runtime will not honour — beyond the ceiling above, or a
    // combination a future Node rejects — is a credential nobody can verify,
    // which is a refused sign-in and not a crashed store node. The distinction
    // matters at the one moment it arises: the start of a shift.
    return false;
  }
  if (key.length !== parameters.key.length) return false;
  return timingSafeEqual(key, parameters.key);
}

/**
 * Whether a stored credential was written with today's parameters.
 *
 * Asked on every successful sign-in, which is what makes the parameters in the
 * stored form worth having: raising `COST` then costs nothing and reaches
 * everybody who works here, rather than waiting for each of them to forget a
 * password. A shop where nobody has forgotten one is exactly the shop whose
 * passwords are oldest.
 */
export function isCurrent(stored: string): boolean {
  const parameters = parse(stored);
  return (
    parameters !== null &&
    parameters.cost === COST &&
    parameters.blockSize === BLOCK_SIZE &&
    parameters.parallelism === PARALLELISM
  );
}
