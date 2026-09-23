import type { SystemOfRecord } from './system.js';

export interface RemoteSystemOptions {
  readonly tenant: string;
  readonly baseUrl: string;
}

function encode(value: unknown): string {
  return JSON.stringify(value, (_key, member: unknown) => {
    if (!(member instanceof Uint8Array)) return member;
    let binary = '';
    for (let at = 0; at < member.length; at += 8192)
      binary += String.fromCharCode(...member.subarray(at, at + 8192));
    return { $type: 'vertex.bytes', base64: btoa(binary) };
  });
}

function decode(value: string): unknown {
  return JSON.parse(value, (_key, member: unknown) => {
    if (typeof member !== 'object' || member === null || Array.isArray(member)) return member;
    const bytes = member as Record<string, unknown>;
    if (bytes['$type'] !== 'vertex.bytes') return member;
    if (typeof bytes['base64'] !== 'string') throw new TypeError('Invalid attachment bytes.');
    return Uint8Array.from(atob(bytes['base64']), (character) => character.charCodeAt(0));
  }) as unknown;
}

/** The server is the only place a session becomes actor and tenant authority. */
export function remoteSystem(options: RemoteSystemOptions): SystemOfRecord {
  let token: string | null = null;
  const base = options.baseUrl.replace(/\/$/u, '');
  const call = async (path: string, args: readonly unknown[]): Promise<unknown> => {
    if (!token) throw new Error('No signed-in store-node session.');
    const method = path.endsWith('.list') || READS.has(path) ? 'GET' : 'POST';
    const remotePath = path.startsWith('organisation.') ? path.slice('organisation.'.length) : path;
    const url = `${base}/v1/tenants/${encodeURIComponent(options.tenant)}/${remotePath}`;
    const response = await fetch(
      method === 'GET' ? `${url}?args=${encodeURIComponent(encode(args))}` : url,
      {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body: encode({ args }) } : {}),
      },
    );
    if (response.status === 401) token = null;
    if (!response.ok)
      throw new Error(`Store-node request ${path} failed: ${String(response.status)}`);
    return (decode(await response.text()) as { value: unknown }).value;
  };

  const paths = new Map<string, unknown>();
  const branch = (path: string): unknown => {
    const existing = paths.get(path);
    if (existing) return existing;
    const proxy = new Proxy(() => undefined, {
      get: (_target, property) => branch(path ? `${path}.${String(property)}` : String(property)),
      apply: (_target, _this, args: unknown[]) => call(path, args),
    });
    paths.set(path, proxy);
    return proxy;
  };
  const methods = branch('') as Record<string, unknown>;
  return new Proxy(methods, {
    get: (_target, property) => {
      if (property === 'signIn')
        return async (attempt: { handle: string; password: string }) => {
          const response = await fetch(`${base}/v1/sign-in`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tenant: options.tenant, ...attempt }),
          });
          const answer = (await response.json()) as {
            token?: string;
            authenticated?: unknown;
            ok?: boolean;
            error?: unknown;
          };
          if (!response.ok) return { ok: false, error: answer.error };
          if (!answer.token || !answer.authenticated) throw new Error('Invalid sign-in response.');
          token = answer.token;
          return { ok: true, value: answer.authenticated };
        };
      if (property === 'signOut')
        return async () => {
          const old = token;
          token = null;
          if (old)
            await fetch(`${base}/v1/sign-out`, {
              method: 'POST',
              headers: { authorization: `Bearer ${old}` },
            });
        };
      if (property === 'changeOwnPassword')
        return (...args: unknown[]) => call('changeOwnPassword', args);
      return branch(String(property));
    },
  }) as unknown as SystemOfRecord;
}

const READS = new Set([
  'catalogue.categories',
  'catalogue.category',
  'catalogue.items',
  'catalogue.item',
  'currencies.functional',
  'rates.board',
  'users.roles.rights',
  'users.assignments.of',
  'users.assignments.holdersOf',
  'organisation.numbering.configured',
  'organisation.numbering.preview',
  'organisation.profile.read',
  'chart.tree',
  'calendar.years',
  'calendar.reopenings',
  'journal.entries',
  'journal.entry',
  'journal.reversalOf',
  'journal.attachment',
  'postingExceptions.exceptions',
  'statements.trialBalance',
  'statements.incomeStatement',
  'statements.balanceSheet',
  'statements.generalLedger',
]);
