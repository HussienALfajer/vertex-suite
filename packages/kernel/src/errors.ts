/** Base class for every error raised by the kernel. */
export class KernelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Two amounts of different currencies were combined. */
export class CurrencyMismatchError extends KernelError {
  readonly left: string;
  readonly right: string;

  constructor(left: string, right: string) {
    super(`Cannot combine an amount in ${left} with an amount in ${right}.`);
    this.left = left;
    this.right = right;
  }
}

/** A currency definition is not internally consistent. */
export class InvalidCurrencyError extends KernelError {}

/** A value could not be read as an exact decimal. */
export class InvalidAmountError extends KernelError {}

/**
 * An operation that may only act on a settled amount was given one that is not
 * a whole number of the currency's rounding increments (`FX-07`).
 */
export class UnroundedAmountError extends KernelError {}

/** An allocation could not be performed as requested. */
export class AllocationError extends KernelError {}

/** A value could not be read as an identifier this system issues. */
export class InvalidIdError extends KernelError {}

/**
 * No cryptographic random source was reachable.
 *
 * Fatal rather than degraded. The fallback — a weaker source — is what makes
 * two registers issue the same identifier for two different sales, which is
 * discovered weeks later as a document that cannot be reconciled.
 */
export class EntropyUnavailableError extends KernelError {}

/** A value could not be read as a moment in time. */
export class InvalidInstantError extends KernelError {}

/**
 * A name this runtime does not know as a time zone was used to read a day.
 *
 * A defect rather than a refusal: the name was checked with `timeZoneNamed`
 * where a person typed it, so reaching here means it was not, or that this
 * machine's time-zone data is older than the machine that accepted it.
 */
export class InvalidTimeZoneError extends KernelError {}
