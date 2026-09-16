import type { DeviceId, TenantId, UserId } from '@vertex/contracts';
import { newId, type Id } from '@vertex/kernel';

/**
 * A correlation is the platform's own, not a thing in the shop, so it is named
 * here. The tenant, the actor and the device are entities two modules apart
 * both write down, and so belong to the shared vocabulary rather than to
 * whichever package happened to need them first.
 */
export type CorrelationId = Id<'command'>;

/**
 * Who is doing this, on what, and as part of which command.
 *
 * Every command runs with one of these and every event it produces carries it.
 * Nothing here is optional decoration:
 *
 * - **tenant** — a store node may hold more than one, and there is no query in
 *   this system that is allowed not to know which.
 * - **actor** — null means the system itself: a migration, a scheduled
 *   revaluation, a sync applying somebody else's work. SEC-04 records who
 *   caused every change, and "nobody" is an answer that has to be explicit
 *   rather than an absence that could equally be a bug.
 * - **device** — POS-19 and SYS-02 both turn on which physical register
 *   produced a document, and SYN-02 sequences the outbox per device.
 * - **correlation** — one value shared by every event of one command. It is
 *   what lets the outbox replay a command exactly once (SYN-02), what ties an
 *   audit record to the sale that caused it, and what makes a support question
 *   about one receipt answerable.
 */
export interface CommandContext {
  readonly tenant: TenantId;
  readonly actor: UserId | null;
  readonly device: DeviceId | null;
  readonly correlation: CorrelationId;
}

export interface CommandContextInput {
  readonly tenant: TenantId;
  /**
   * Required, and null only on purpose. An optional actor made `{ tenant }` —
   * the context a caller gets by forgetting a field, or a sync payload that
   * lost one in transit — into the system, and the system holds every right:
   * `authorise` answered yes without asking anybody. Leaving it out now fails
   * to compile, and fails at run time for anything that did not compile
   * against this type. `systemContext` is the one way to mean "nobody".
   */
  readonly actor: UserId | null;
  readonly device?: DeviceId | null;
  /**
   * Supplied when a command is being **re-run**: a retried outbox entry or a
   * replayed sync operation keeps the correlation of the original, which is
   * what makes applying it twice detectable rather than merely unlikely.
   */
  readonly correlation?: CorrelationId;
}

export function commandContext(input: CommandContextInput): CommandContext {
  // Widened for the check: the type already requires the field, and this is
  // for the caller the type never saw — JavaScript, or data read off a wire.
  if ((input as { readonly actor?: unknown }).actor === undefined) {
    throw new TypeError(
      'A command context must say who is acting. Pass actor: null only for the system, ' +
        'or use systemContext.',
    );
  }
  return Object.freeze({
    tenant: input.tenant,
    actor: input.actor,
    device: input.device ?? null,
    correlation: input.correlation ?? newId<'command'>(),
  });
}

/** A command nobody asked for: a migration, a scheduled job, an applied sync. */
export function systemContext(tenant: TenantId): CommandContext {
  return commandContext({ tenant, actor: null });
}
