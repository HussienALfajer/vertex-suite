/**
 * Everything here is a **defect**, never a refusal.
 *
 * A module that declares a permission under another module's prefix, a
 * dependency that does not exist, a subscription to an event nobody publishes —
 * none of these is a business outcome somebody can be shown and asked about.
 * They are wiring that is wrong, they are wrong identically on every machine
 * the edition is installed on, and the correct moment to find out is the moment
 * the process starts rather than the first time a cashier reaches the screen
 * that depends on them.
 *
 * Whether an edition may be composed at all is a different question and is
 * answered with a Refusal (kernel), because the answer is read by whoever is
 * assembling the edition and has to name what is missing.
 */
export class PlatformError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A module's own declaration is malformed, independently of any other module. */
export class ModuleDeclarationError extends PlatformError {}

/** The set of modules cannot be arranged: a cycle, a gap, or two claims on one name. */
export class RegistryError extends PlatformError {}

/** Two modules declared the same permission, account role, setting, switch or event. */
export class DuplicateDeclarationError extends RegistryError {}

/** A subscription names an event that no module in the catalogue publishes. */
export class UndeclaredEventError extends RegistryError {}

/** A contract was required, and the module that provides it is not in this edition. */
export class ContractUnavailableError extends PlatformError {
  readonly key: string;

  constructor(key: string) {
    super(
      `No module in this edition provides "${key}". A caller that can work without it ` +
        'resolves the contract and handles null; one that cannot declares the provider ' +
        'in dependsOn, so the edition refuses to compose without it.',
    );
    this.key = key;
  }
}

/** A contract's construction reached back into itself. */
export class ContractCycleError extends PlatformError {}

/** A migration failed, or the journal and the plan disagree about what has run. */
export class MigrationError extends PlatformError {}
