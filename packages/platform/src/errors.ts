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

/**
 * A catalogue holds one module code twice — a module registered beside a
 * stand-in for it, or the same definition reached by two paths.
 *
 * A subtype of `RegistryError` rather than a use of it directly, so that a host
 * wiring an edition can catch this one case by name: two claims on one module
 * identity, as against a genuine cycle or an unrelated wiring defect.
 */
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

/**
 * A module asked whether somebody may do something, and this edition was
 * composed with nothing that can answer.
 *
 * A defect, and loudly, because the alternative is the failure this seam exists
 * to prevent. Answering "yes" would hand the organisation of the shop to
 * whoever reached the request first; answering "no" would leave an
 * administrator locked out of their own system with nothing saying why. Both
 * are silent, and both are wrong on every machine this edition is installed on,
 * so it is the host's wiring that is reported rather than the caller's command.
 */
export class AuthoriserUnavailableError extends PlatformError {
  readonly right: string;

  constructor(right: string) {
    super(
      `A module asked whether the caller may "${right}", and this edition has no authoriser. ` +
        'Pass `authorisedBy` to createRegistry, naming the contract that answers it — ' +
        '`Authorisation` from @vertex/sec/contract in every edition that ships SEC, which is ' +
        'every edition, since SEC is a core module.',
    );
    this.right = right;
  }
}

/**
 * A migration failed, or the journal and the plan disagree about what has run:
 * one recorded that the plan no longer names, or one pending before one applied.
 */
export class MigrationError extends PlatformError {}
