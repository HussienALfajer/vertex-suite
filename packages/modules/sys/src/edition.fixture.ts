import { newId, orThrow, systemClock, type Id } from '@vertex/kernel';
import {
  commandContext,
  composeEdition,
  contractKey,
  createEventBus,
  createMemoryStore,
  createRegistry,
  createTransactor,
  defineModule,
  provideContract,
  systemContext,
  type AuthorisationScope,
  type Authoriser,
  type CommandContext,
  type MemorySession,
  type MemoryStore,
  type Registry,
  type UnitOfWork,
} from '@vertex/platform';

import { DocumentNumbering, Organisation, OrganisationAdministration } from './contract.js';
import { sysModule } from './index.js';

/**
 * `SYS` installed the way a store node installs it.
 *
 * Nothing here is a stub. It is the real edition composition, the real
 * registry, the real transactor over the memory store the platform ships for
 * exactly this — so a test that passes is a statement about the module as it is
 * hosted, not about a harness built to agree with it.
 *
 * It is a fixture rather than a helper inside one test file because two suites
 * need the same installation, and two slightly different installations would
 * eventually disagree about something neither test was watching. The build
 * excludes `*.fixture.ts`, so none of this ships.
 */
export interface Installed {
  readonly registry: Registry<MemorySession>;
  readonly store: MemoryStore;
  readonly read: Organisation;
  readonly admin: OrganisationAdministration;
  readonly numbering: DocumentNumbering;
  /**
   * Numbering joins the caller's transaction, so a test has to be the caller.
   * This is the same `transactor.run` a sale would use, with nothing in the
   * middle: what the test passes down is exactly what `POS` will pass down.
   */
  inTransaction<T>(work: (uow: UnitOfWork<MemorySession>) => Promise<T>): Promise<T>;
  readonly tenant: Id<'tenant'>;
  /** An ordinary administrator of the tenant. No vendor, no system actor. */
  readonly by: CommandContext;
  /**
   * The system: a migration, a scheduled job, a sync applying work that was
   * authorised on the register that did it. It has no actor to ask about.
   */
  readonly system: CommandContext;
  /** A second tenant on the same store node, which is the normal case. */
  readonly otherTenant: Id<'tenant'>;
  readonly byOther: CommandContext;
  /**
   * What the stand-in authority answers, for a test that came to prove a guard
   * is live rather than to exercise the command behind it.
   *
   * It holds everything by default, because a fixture that refused by default
   * would make every test about this module a test about permissions.
   */
  answers(decide: (by: CommandContext, right: string, where?: AuthorisationScope) => boolean): void;
}

/**
 * `SEC`'s answer, stood in for.
 *
 * `SYS` asks whether the caller may act through `ModuleContext.authorise`, and
 * the platform resolves that through whichever contract the host named. In a
 * real edition it is `SEC`; here it cannot be, because `SEC` depends on `SYS`
 * and a test in this package may no more import it than the module may
 * (`modules.md` §4.1, held to by `check:boundaries`).
 *
 * So the edition hosts a module under the code `SEC` that answers the one
 * question `SYS` actually asks of it, under the same key the real one publishes
 * — which is what makes a test here a statement about the module as an edition
 * hosts it rather than about a harness built to agree with it.
 */
const StandInAuthority = contractKey<Authoriser>('sec.authorisation');

function authorityStandIn(
  decide: () => (by: CommandContext, right: string, where?: AuthorisationScope) => boolean,
) {
  return defineModule<MemorySession>({
    code: 'SEC',
    labelKey: 'module.sec',
    provides: [
      provideContract(StandInAuthority, () => ({
        may: (by: CommandContext, right: string, where?: AuthorisationScope) =>
          Promise.resolve(decide()(by, right, where)),
      })),
    ],
  });
}

export function installSys(): Installed {
  let decide: (by: CommandContext, right: string, where?: AuthorisationScope) => boolean = () =>
    true;

  const catalogue = [sysModule<MemorySession>(), authorityStandIn(() => decide)];
  const plan = orThrow(composeEdition(catalogue, { modules: ['SYS', 'SEC'] }), (refusal) => {
    return new Error(`The edition would not compose: ${refusal.code}`);
  });

  const bus = createEventBus({
    onHandlerFailure: (failure) => {
      throw new Error(`A subscriber failed: ${String(failure.cause)}`);
    },
  });
  const store = createMemoryStore();
  const transactor = createTransactor({
    driver: store.driver,
    bus,
    clock: systemClock,
    onEffectFailure: (failure) => {
      throw new Error(`An effect failed: ${String(failure.cause)}`);
    },
  });
  const registry = createRegistry({
    catalogue,
    plan,
    bus,
    transactor,
    clock: systemClock,
    authorisedBy: StandInAuthority,
  });

  const tenant = newId<'tenant'>();
  const otherTenant = newId<'tenant'>();

  return {
    registry,
    store,
    read: registry.require(Organisation),
    admin: registry.require(OrganisationAdministration),
    numbering: registry.require(DocumentNumbering),
    inTransaction: <T>(work: (uow: UnitOfWork<MemorySession>) => Promise<T>): Promise<T> =>
      transactor.run(commandContext({ tenant, actor: newId<'user'>() }), work),
    tenant,
    by: commandContext({ tenant, actor: newId<'user'>() }),
    system: systemContext(tenant),
    otherTenant,
    byOther: commandContext({ tenant: otherTenant, actor: newId<'user'>() }),
    answers(
      next: (by: CommandContext, right: string, where?: AuthorisationScope) => boolean,
    ): void {
      decide = next;
    },
  };
}
