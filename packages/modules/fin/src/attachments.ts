import type { TenantId } from '@vertex/contracts';
import { newId, ok, refuse, type Result } from '@vertex/kernel';

import {
  ATTACHMENT_MEDIA_TYPES,
  ATTACHMENT_SIZE_LIMIT,
  type Attachment,
  type AttachmentMediaType,
  type AttachmentStore,
  type AttachmentUpload,
  type PostingRefusal,
} from './contract.js';

/**
 * What the accountant attaches to a manual entry (`FIN-04`), judged and
 * hashed — and where its bytes go, which is not this module's store.
 *
 * Three things are decided about a file before anything is kept: that it is
 * a file, that it is one of the four kinds a shop attaches, and that its
 * bytes begin the way a file of that kind begins. The last is what makes the
 * first two mean something. A label is a claim any caller can make about any
 * bytes, and a store node that kept whatever it was told was a PDF and later
 * served it to a browser would be a store node serving whatever it was
 * given. The signatures are short and the check is cheap; the alternative is
 * trusting a field off a wire, which nothing else in this module does.
 */

type Outcome<T> = Result<T, PostingRefusal>;

/** A value's fields as they may actually arrive. */
type Arriving<T> = { readonly [Field in keyof T]: unknown };

const MEDIA_TYPES: ReadonlySet<string> = new Set(ATTACHMENT_MEDIA_TYPES);

function isMediaType(value: unknown): value is AttachmentMediaType {
  return typeof value === 'string' && MEDIA_TYPES.has(value);
}

/**
 * How a file of each kind begins, by the byte.
 *
 * `%PDF-`; the eight bytes every PNG opens with; the start-of-image marker of
 * a JPEG; and a RIFF container whose form, after its length, is `WEBP`. Each
 * is what the format's own specification says the first bytes are, and each
 * is enough to tell that the bytes were made as that kind of file and not
 * relabelled as one.
 */
const SIGNATURES: Readonly<Record<AttachmentMediaType, readonly (readonly [number, number])[]>> = {
  'application/pdf': [
    [0, 0x25],
    [1, 0x50],
    [2, 0x44],
    [3, 0x46],
    [4, 0x2d],
  ],
  'image/png': [
    [0, 0x89],
    [1, 0x50],
    [2, 0x4e],
    [3, 0x47],
    [4, 0x0d],
    [5, 0x0a],
    [6, 0x1a],
    [7, 0x0a],
  ],
  'image/jpeg': [
    [0, 0xff],
    [1, 0xd8],
    [2, 0xff],
  ],
  'image/webp': [
    [0, 0x52],
    [1, 0x49],
    [2, 0x46],
    [3, 0x46],
    [8, 0x57],
    [9, 0x45],
    [10, 0x42],
    [11, 0x50],
  ],
};

function beginsAs(bytes: Uint8Array, mediaType: AttachmentMediaType): boolean {
  return SIGNATURES[mediaType].every(([offset, expected]) => bytes[offset] === expected);
}

/** A file judged: everything the record will say about it but its place in an entry. */
export type JudgedAttachment = Omit<Attachment, 'tenant' | 'entry' | 'ordinal'>;

/** A file whose shape has been judged, and whose bytes are still to be hashed. */
export interface JudgedFile {
  readonly name: string;
  readonly mediaType: AttachmentMediaType;
  readonly bytes: Uint8Array;
}

/** A file judged and hashed, its bytes still to be kept. */
export interface JudgedUpload {
  readonly attachment: JudgedAttachment;
  readonly bytes: Uint8Array;
}

/**
 * The most a file name may run to. A name is what a screen lists and a
 * person reads; a kilobyte of it is not a name.
 */
const NAME_LIMIT = 255;

/**
 * Web Crypto, declared locally, for the reason the kernel declares it: this
 * module runs on the store node, in the register's Electron process and — in
 * development — in the browser, and Web Crypto is the one digest present in
 * all three. `node:crypto` would make the module unimportable in a bundle.
 */
declare const crypto:
  | { readonly subtle: { digest(algorithm: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer> } }
  | undefined;

/** The SHA-256 of some bytes, in lower-case hexadecimal. */
export async function sha256Of(bytes: Uint8Array): Promise<string> {
  // `typeof`, not a comparison: where the global does not exist at all,
  // reading it throws, and the message below would never be the one seen.
  if (typeof crypto === 'undefined') {
    throw new Error(
      'No SHA-256 is available, so no attachment can be recorded: the hash is what says the ' +
        'bytes handed back are the bytes that were attached.',
    );
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Every file the accountant attached, judged in the order a person would fix
 * it — before anything is hashed or kept, so that a refused list costs
 * neither.
 *
 * `attachment` in a refusal is the file's place in the list, counted from
 * one, as `line` is a line's. Nothing attached is an empty list, not a
 * refusal: the attachments are support for the entry, and `FIN-04` makes the
 * description mandatory, not them.
 */
export function attachmentsArriving(arriving: unknown): Outcome<readonly JudgedFile[]> {
  if (arriving === undefined || arriving === null) return ok([]);
  if (!Array.isArray(arriving)) return refuse('fin.attachment-invalid');

  const judged: JudgedFile[] = [];
  for (const [index, one] of (arriving as readonly unknown[]).entries()) {
    const at = { attachment: index + 1 };
    const { name, mediaType, bytes } = (one ?? {}) as Arriving<AttachmentUpload>;
    if (
      typeof name !== 'string' ||
      name.trim() === '' ||
      name.trim().length > NAME_LIMIT ||
      !(bytes instanceof Uint8Array) ||
      bytes.length === 0
    ) {
      return refuse('fin.attachment-invalid', at);
    }
    if (!isMediaType(mediaType)) {
      return refuse('fin.attachment-type-unsupported', { ...at, mediaType: String(mediaType) });
    }
    if (bytes.length > ATTACHMENT_SIZE_LIMIT) {
      return refuse('fin.attachment-too-large', {
        ...at,
        size: bytes.length,
        limit: ATTACHMENT_SIZE_LIMIT,
      });
    }
    if (!beginsAs(bytes, mediaType)) {
      return refuse('fin.attachment-content-mismatch', { ...at, mediaType });
    }
    judged.push({ name: name.trim(), mediaType, bytes });
  }
  return ok(judged);
}

/**
 * Every judged file hashed, which is what the record will say about it: the
 * hash is what makes the bytes handed back later provably the bytes attached.
 * Done after every cheaper judgement of the entry, because ten megabytes are
 * hashed on the machine every till in the shop depends on.
 */
export async function digested(files: readonly JudgedFile[]): Promise<readonly JudgedUpload[]> {
  const uploads: JudgedUpload[] = [];
  for (const { name, mediaType, bytes } of files) {
    uploads.push({
      attachment: {
        id: newId<'attachment'>(),
        name,
        mediaType,
        size: bytes.length,
        sha256: await sha256Of(bytes),
      },
      bytes,
    });
  }
  return uploads;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Where the bytes of an attachment are kept: under the tenant and the hash.
 *
 * The tenant, so that two shops attaching the same invoice never learn it of
 * each other through a store that already held it. The hash, so that the same
 * file attached twice — to one entry or to two — is kept once, and so that
 * keeping it again, as a replayed command does, changes nothing.
 */
export function keyOfAttachment(tenant: TenantId, sha256: string): string {
  // The hash is this module's own, computed by `sha256Of` for everything it
  // keeps — so anything else here is a record that did not come from this
  // module, and a key built from it could carry a separator into the store's
  // path. Raised, because a store must never be asked for a key of any other
  // shape.
  if (!SHA256_HEX.test(sha256)) {
    throw new Error(`"${sha256}" is not a SHA-256 in lower-case hexadecimal.`);
  }
  return `fin/attachment/${encodeURIComponent(tenant)}/${sha256}`;
}

/** Keeps every judged file where the host keeps files, before the entry that names them is written. */
export async function keepAttachments(
  store: AttachmentStore,
  tenant: TenantId,
  uploads: readonly JudgedUpload[],
): Promise<void> {
  for (const { attachment, bytes } of uploads) {
    await store.put(keyOfAttachment(tenant, attachment.sha256), bytes);
  }
}

/**
 * The bytes of an attachment, from where the host keeps them, verified.
 *
 * Verified against the hash the entry records, every time: the record is the
 * statement that these are the bytes that were attached, and bytes the store
 * has lost or altered are handed out as nothing rather than as the evidence
 * they no longer are. Either is a defect in the store — the module never
 * gave it anything else — so it raises, with what was found.
 */
export async function fetchAttachment(
  store: AttachmentStore,
  attachment: Attachment,
): Promise<Uint8Array> {
  const key = keyOfAttachment(attachment.tenant, attachment.sha256);
  const bytes = await store.get(key);
  if (bytes === null) {
    throw new Error(
      `The bytes of attachment ${attachment.id} of entry ${attachment.entry} are missing from ` +
        `the attachment store (${key}).`,
    );
  }
  const found = await sha256Of(bytes);
  if (found !== attachment.sha256 || bytes.length !== attachment.size) {
    throw new Error(
      `The bytes of attachment ${attachment.id} of entry ${attachment.entry} are not the bytes ` +
        `that were attached: SHA-256 ${found} over ${String(bytes.length)} byte(s), where the ` +
        `entry records ${attachment.sha256} over ${String(attachment.size)}.`,
    );
  }
  return bytes;
}
