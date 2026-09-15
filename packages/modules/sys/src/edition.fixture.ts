import { newId, orThrow, systemClock, type Id } from '@vertex/kernel';
import {
  commandContext,
  composeEdition,
  createEventBus,
  createMemoryStore,
  createRegistry,
  createTransactor,
  type CommandContext,
  type MemorySession,
  type MemoryStore,
  type Registry,
} from '@vertex/platform';

import { Organisation, OrganisationAdministration } from './contract.js';
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
  readonly tenant: Id<'tenant'>;
  /** An ordinary administrator of the tenant. No vendor, no system actor. */
  readonly by: CommandContext;
  /** A second tenant on the same store node, which is the normal case. */
  readonly otherTenant: Id<'tenant'>;
  readonly byOther: CommandContext;
}

export function installSys(): Installed {
  const catalogue = [sysModule<MemorySession>()];
  const plan = orThrow(composeEdition(catalogue, { modules: ['SYS'] }), (refusal) => {
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
  const registry = createRegistry({ catalogue, plan, bus, transactor, clock: systemClock });

  const tenant = newId<'tenant'>();
  const otherTenant = newId<'tenant'>();

  return {
    registry,
    store,
    read: registry.require(Organisation),
    admin: registry.require(OrganisationAdministration),
    tenant,
    by: commandContext({ tenant, actor: newId<'user'>() }),
    otherTenant,
    byOther: commandContext({ tenant: otherTenant, actor: newId<'user'>() }),
  };
}
