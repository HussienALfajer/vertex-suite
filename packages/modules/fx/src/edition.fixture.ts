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
} from '@vertex/platform';

import { Currencies, CurrencyAdministration } from './contract.js';
import { fxModule } from './index.js';

/**
 * `FX` installed the way a store node installs it.
 *
 * The real edition composition, the real registry and the real transactor over
 * the memory store the platform ships — so a test that passes is a statement
 * about the module as an edition hosts it, not about a harness built to agree
 * with it. The build excludes `*.fixture.ts`, so none of this ships.
 */
export interface Installed {
  readonly registry: Registry<MemorySession>;
  readonly store: MemoryStore;
  readonly read: Currencies;
  readonly admin: CurrencyAdministration;
  readonly tenant: Id<'tenant'>;
  /** A person acting in the tenant. What they may do is whatever `answers` says. */
  readonly by: CommandContext;
  /** The system: first-run installation, a migration, a sync. It has nobody to ask about. */
  readonly system: CommandContext;
  /** A second tenant on the same store node, which is the normal case. */
  readonly otherTenant: Id<'tenant'>;
  readonly byOther: CommandContext;
  /**
   * What the stand-in authority answers, for a test that came to prove a guard
   * is live rather than to exercise the command behind it.
   *
   * Everything, by default: a fixture that refused by default would make every
   * test of this module a test of permissions.
   */
  answers(decide: (by: CommandContext, right: string, where?: AuthorisationScope) => boolean): void;
}

/**
 * `SEC`'s answer, stood in for.
 *
 * `FX` asks through `ModuleContext.authorise` and never learns who answers. In a
 * real edition it is `SEC`; here it cannot be, because a module's tests may no
 * more import another module than the module may (`modules.md` §4.1). So the
 * edition hosts a module under the code `SEC` answering the one question `FX`
 * asks, under the key the real one publishes. `apps/back-office`'s composition
 * test is where the real two meet.
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

export function installFx(): Installed {
  let decide: (by: CommandContext, right: string, where?: AuthorisationScope) => boolean = () =>
    true;

  const catalogue = [fxModule<MemorySession>(), authorityStandIn(() => decide)];
  const plan = orThrow(
    composeEdition(catalogue, { modules: ['FX', 'SEC'] }),
    (refusal) => new Error(`The edition would not compose: ${refusal.code}`),
  );

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
    read: registry.require(Currencies),
    admin: registry.require(CurrencyAdministration),
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
