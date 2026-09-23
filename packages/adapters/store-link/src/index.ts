import type {
  DeliveryAnswer,
  OperationEnvelope,
  Reach,
  Receipt,
  RefusalReason,
  StoreLink,
} from '@vertex/platform';

/**
 * The wire a register delivers its operations over, both ends of it.
 *
 * The store node answers in HTTP statuses, and the register has to turn each
 * one back into what it means for the operation — applied, declined, or not
 * asked at all. Those two readings live in two applications, and the day they
 * disagree about a status is the day a register records a sale the store node
 * never looked at as refused, or retries for ever one it has refused. So the
 * names and the meanings are written once, here, and the store node reads its
 * half from the same place (`apps/store-node`).
 */

/** The header carrying the register's own credential, issued when it was paired. */
export const DEVICE_CREDENTIAL_HEADER = 'x-vertex-device-token';

/** The route, under a tenant, that operations are delivered to. */
export const DELIVER_ROUTE = 'operations.deliver';

/** Answers 200 to a session the store node still knows, and 401 to one it does not. */
export const SESSION_PATH = '/v1/session';

/**
 * The statuses a store node answers a delivery with, and what each one means.
 *
 * `applied` and `duplicate` are 200, and every other receipt 409 — the store
 * node looked at the operation and its inbox decided (`receiveOperation`).
 * The refusals are the store node declining to put the operation to its inbox
 * at all. Anything not here is not an answer about the operation.
 */
export const REFUSAL_STATUS: Readonly<Record<RefusalReason, number>> = Object.freeze({
  invalid: 400,
  forbidden: 403,
  unsupported: 422,
});

const REFUSAL_BY_STATUS = new Map<number, RefusalReason>(
  Object.entries(REFUSAL_STATUS).map(([reason, status]) => [status, reason as RefusalReason]),
);

/**
 * `fetch`, as far as this file uses it — declared here rather than taken from
 * `lib.dom` or `@types/node`, because the link runs in both and the package
 * opts into neither set of ambient types.
 */
export interface WireResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

export type WireFetch = (
  url: string,
  init: {
    readonly method: 'GET' | 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly signal: unknown;
  },
) => Promise<WireResponse>;

interface Ambient {
  readonly fetch?: WireFetch;
  readonly AbortSignal?: { timeout(milliseconds: number): unknown };
  readonly URL?: new (input: string) => { readonly protocol: string };
}

const ambient = globalThis as Ambient;

export interface StoreLinkOptions {
  /** Where the store node is: `http://store.local:5182`. */
  readonly baseUrl: string;
  readonly tenant: string;
  /** The register this device holds, which the store node checks it still does. */
  readonly register: string;
  /** The device credential issued at pairing. */
  readonly credential: string;
  /**
   * The signed-in session, read at every call: a person signs in again after
   * the store node forgot them, and the link must carry the new session
   * without being built again. `null` is nobody signed in.
   */
  readonly session: () => string | null;
  /**
   * How long an answer may take, in milliseconds. `StoreLink` requires one:
   * the courier delivers a queue in order, so a request that hangs holds every
   * sale behind it. Five seconds is long for a shop's own network and short
   * enough for a cashier watching the status.
   */
  readonly timeout?: number;
  readonly fetch?: WireFetch;
}

/** A store node that answered with something the wire does not define, or a link set up wrong. */
export class WireError extends Error {}

/**
 * What an HTTP header may carry. Checked here rather than left to `fetch`,
 * which refuses anything else with the same `TypeError` it uses for a dropped
 * line — and a link that read its own misconfiguration as "nobody answered"
 * would show the register offline for ever, and report nothing.
 */
const HEADER_SAFE = /^[\x21-\x7e]+$/u;

function isReceipt(value: unknown): value is Receipt {
  if (typeof value !== 'object' || value === null) return false;
  const status = (value as { status?: unknown }).status;
  const expected = (value as { expected?: unknown }).expected;
  switch (status) {
    case 'applied':
    case 'duplicate':
    case 'conflict':
      return true;
    case 'sequence-gap':
    case 'out-of-order':
      return typeof expected === 'number' && Number.isSafeInteger(expected) && expected >= 1;
    default:
      return false;
  }
}

/** The register's end of the wire, as the courier's `StoreLink`. */
export function storeLink(options: StoreLinkOptions): StoreLink {
  const base = options.baseUrl.replace(/\/+$/u, '');
  const timeout = options.timeout ?? 5_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1)
    throw new RangeError('A store link waits a whole number of milliseconds, at least one.');
  const send = options.fetch ?? ambient.fetch;
  const Signal = ambient.AbortSignal;
  const Url = ambient.URL;
  if (send === undefined || Signal === undefined || Url === undefined)
    throw new WireError('A store link needs fetch, AbortSignal and URL from its runtime.');
  let protocol: string;
  try {
    protocol = new Url(base).protocol;
  } catch {
    throw new WireError('A store link needs the store node address as an absolute URL.');
  }
  if (protocol !== 'http:' && protocol !== 'https:')
    throw new WireError('A store link speaks HTTP or HTTPS to its store node.');
  if (!HEADER_SAFE.test(options.credential))
    throw new WireError('A device credential is printable ASCII, as the wire carries it.');
  const deliverUrl = `${base}/v1/tenants/${encodeURIComponent(options.tenant)}/${DELIVER_ROUTE}`;

  /** The signed-in session, or null for nobody; a session no header can carry is a defect. */
  const sessionNow = (): string | null => {
    const session = options.session();
    if (session !== null && !HEADER_SAFE.test(session))
      throw new WireError('A session token is printable ASCII, as the wire carries it.');
    return session;
  };

  /** The response, or null when no answer came: refused connection, timeout, dropped line. */
  const request = async (
    url: string,
    init: Omit<Parameters<WireFetch>[1], 'signal'>,
  ): Promise<WireResponse | null> => {
    // Outside the `try`: a runtime that cannot bound a request is a defect,
    // not an absent store node.
    const signal = Signal.timeout(timeout);
    try {
      return await send(url, { ...init, signal });
    } catch {
      // With the address and every header checked above, `fetch` rejects for
      // the conditions that mean nobody answered; an answer of any kind, even
      // a 500, resolves.
      return null;
    }
  };

  /**
   * Nobody answering is not the only way the store node can be absent. A
   * gateway in front of it (502, 504), the node declaring itself unavailable
   * (503), or an address that is not a store node at all (404) all leave the
   * operation unasked, and are waited out like a dropped line.
   */
  const absent = (response: WireResponse | null): boolean =>
    response === null ||
    response.status === 404 ||
    (response.status >= 502 && response.status <= 504);

  return {
    async deliver(envelope: OperationEnvelope): Promise<DeliveryAnswer> {
      const session = sessionNow();
      if (session === null) return { status: 'unauthenticated' };
      const response = await request(deliverUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session}`,
          'content-type': 'application/json',
          [DEVICE_CREDENTIAL_HEADER]: options.credential,
        },
        body: JSON.stringify({ register: options.register, envelope }),
      });
      if (response === null || absent(response)) return { status: 'unreachable' };
      if (response.status === 401) return { status: 'unauthenticated' };
      const refused = REFUSAL_BY_STATUS.get(response.status);
      if (refused !== undefined) return { status: 'refused', reason: refused };
      if (response.status === 200 || response.status === 409) {
        let body: unknown;
        try {
          body = await response.json();
        } catch {
          // The answer was cut off after its status arrived: nothing is known
          // about the operation, and asking again is safe (SYN-02).
          return { status: 'unreachable' };
        }
        const settled = response.status === 200;
        if (
          isReceipt(body) &&
          settled === (body.status === 'applied' || body.status === 'duplicate')
        )
          return body;
      }
      // A 500, or a receipt the wire does not define: a defect on one side or
      // the other, which the courier reports and waits out rather than records
      // against an operation nothing was decided about.
      throw new WireError(`The store node answered a delivery with ${String(response.status)}.`);
    },

    async reach(): Promise<Reach> {
      const session = sessionNow();
      if (session === null) return 'unauthenticated';
      const response = await request(`${base}${SESSION_PATH}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${session}` },
      });
      if (response === null || absent(response)) return 'unreachable';
      if (response.status === 401) return 'unauthenticated';
      if (response.status === 200) return 'reachable';
      throw new WireError(
        `The store node answered a session check with ${String(response.status)}.`,
      );
    },
  };
}
