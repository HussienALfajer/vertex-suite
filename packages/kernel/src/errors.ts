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
