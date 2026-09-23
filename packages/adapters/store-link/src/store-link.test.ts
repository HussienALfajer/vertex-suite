import { newId } from '@vertex/kernel';
import type { OperationEnvelope } from '@vertex/platform';
import { describe, expect, it } from 'vitest';

import {
  DEVICE_CREDENTIAL_HEADER,
  storeLink,
  WireError,
  type StoreLinkOptions,
  type WireFetch,
} from './index.js';

const tenant = newId<'tenant'>();
const register = newId<'register'>();

const envelope: OperationEnvelope = {
  key: newId<'operation'>(),
  tenant,
  actor: newId<'user'>(),
  device: newId<'device'>(),
  correlation: newId<'command'>(),
  sequence: 1,
  kind: 'test.sale',
  payload: { amount: '1.00' },
};

/** A store node that answers with a status and a body, and remembers what it was asked. */
function answering(status: number, body?: unknown) {
  const asked: { url: string; init: Parameters<WireFetch>[1] }[] = [];
  const fetch: WireFetch = (url, init) => {
    asked.push({ url, init });
    return Promise.resolve({
      status,
      json: () =>
        body === undefined ? Promise.reject(new SyntaxError('no body')) : Promise.resolve(body),
    });
  };
  return { fetch, asked };
}

function link(fetch: WireFetch, overrides: Partial<StoreLinkOptions> = {}) {
  return storeLink({
    baseUrl: 'http://store.local:5182/',
    tenant,
    register,
    credential: 'device-secret',
    session: () => 'session-token',
    fetch,
    ...overrides,
  });
}

describe('storeLink — SYN-06 reads the store node answer for what it means to the operation', () => {
  it('SYN-06 delivers to the tenant route with the session and the device credential', async () => {
    const node = answering(200, { status: 'applied' });
    expect(await link(node.fetch).deliver(envelope)).toEqual({ status: 'applied' });
    const [call] = node.asked;
    expect(call?.url).toBe(`http://store.local:5182/v1/tenants/${tenant}/operations.deliver`);
    expect(call?.init.method).toBe('POST');
    expect(call?.init.headers).toMatchObject({
      authorization: 'Bearer session-token',
      [DEVICE_CREDENTIAL_HEADER]: 'device-secret',
    });
    expect(JSON.parse(call?.init.body ?? '')).toEqual({ register, envelope });
    // Bounded, always: a request that hangs holds every sale behind it.
    expect(call?.init.signal).toBeDefined();
  });

  it('SYN-06 takes a receipt at its word: applied and duplicate settle it, the rest decline it', async () => {
    expect(await link(answering(200, { status: 'duplicate' }).fetch).deliver(envelope)).toEqual({
      status: 'duplicate',
    });
    expect(await link(answering(409, { status: 'conflict' }).fetch).deliver(envelope)).toEqual({
      status: 'conflict',
    });
    expect(
      await link(answering(409, { status: 'sequence-gap', expected: 4 }).fetch).deliver(envelope),
    ).toEqual({ status: 'sequence-gap', expected: 4 });
  });

  it('SYN-06 reads the three refusals as the store node declining the operation', async () => {
    for (const [status, reason] of [
      [400, 'invalid'],
      [403, 'forbidden'],
      [422, 'unsupported'],
    ] as const)
      expect(await link(answering(status, { error: 'x' }).fetch).deliver(envelope)).toEqual({
        status: 'refused',
        reason,
      });
  });

  it('SYN-06 reads nobody answering as unreachable, never as a verdict on the operation', async () => {
    const down: WireFetch = () => Promise.reject(new TypeError('fetch failed'));
    expect(await link(down).deliver(envelope)).toEqual({ status: 'unreachable' });
    expect(await link(down).reach()).toBe('unreachable');
    for (const status of [404, 502, 503, 504]) {
      expect(await link(answering(status, {}).fetch).deliver(envelope)).toEqual({
        status: 'unreachable',
      });
      expect(await link(answering(status, {}).fetch).reach()).toBe('unreachable');
    }
    // The status arrived and the body did not: nothing is known, and asking
    // again is safe because the store node applies once (SYN-02).
    expect(await link(answering(200).fetch).deliver(envelope)).toEqual({ status: 'unreachable' });
  });

  it('SYN-06 tells a forgotten session from a missing line, and asks nothing with no session', async () => {
    expect(await link(answering(401, {}).fetch).deliver(envelope)).toEqual({
      status: 'unauthenticated',
    });
    expect(await link(answering(401, {}).fetch).reach()).toBe('unauthenticated');
    const node = answering(200, { status: 'applied' });
    const nobody = link(node.fetch, { session: () => null });
    expect(await nobody.deliver(envelope)).toEqual({ status: 'unauthenticated' });
    expect(await nobody.reach()).toBe('unauthenticated');
    expect(node.asked).toEqual([]);
  });

  it('SYN-06 checks the session it is given now, not the one it was built with', async () => {
    const node = answering(200, { ok: true });
    let session = 'first';
    const reach = link(node.fetch, { session: () => session });
    expect(await reach.reach()).toBe('reachable');
    session = 'second';
    await reach.reach();
    expect(node.asked.map((one) => one.init.headers['authorization'])).toEqual([
      'Bearer first',
      'Bearer second',
    ]);
    expect(node.asked[0]?.url).toBe('http://store.local:5182/v1/session');
  });

  it('throws on an answer the wire does not define, rather than record it against an operation', async () => {
    await expect(link(answering(500, {}).fetch).deliver(envelope)).rejects.toThrow(WireError);
    await expect(link(answering(500, {}).fetch).reach()).rejects.toThrow(WireError);
    // A 200 that is not a settled receipt, and a 409 that claims to be one.
    await expect(
      link(answering(200, { status: 'conflict' }).fetch).deliver(envelope),
    ).rejects.toThrow(WireError);
    await expect(
      link(answering(409, { status: 'applied' }).fetch).deliver(envelope),
    ).rejects.toThrow(WireError);
    await expect(
      link(answering(409, { status: 'sequence-gap' }).fetch).deliver(envelope),
    ).rejects.toThrow(WireError);
  });

  it('refuses a timeout that is not a whole number of milliseconds', () => {
    for (const timeout of [0, -1, 2.5])
      expect(() => link(answering(200).fetch, { timeout })).toThrow(RangeError);
  });

  it('SYN-06 refuses a link set up wrong, rather than read it as a store node that is not there', async () => {
    // `fetch` rejects a bad address or header with the TypeError it uses for a
    // dropped line: unchecked, a misconfigured register would look offline for
    // ever and report nothing.
    const node = answering(200, { status: 'applied' });
    for (const baseUrl of ['store.local:5182', 'ftp://store.local', 'not a url'])
      expect(() => link(node.fetch, { baseUrl })).toThrow(WireError);
    expect(() => link(node.fetch, { credential: 'two words' })).toThrow(WireError);
    const badSession = link(node.fetch, { session: () => 'line\nbreak' });
    await expect(badSession.deliver(envelope)).rejects.toThrow(WireError);
    await expect(badSession.reach()).rejects.toThrow(WireError);
    expect(node.asked).toEqual([]);
  });
});
