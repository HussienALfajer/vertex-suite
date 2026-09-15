/**
 * The outcome of an operation that is allowed to refuse.
 *
 * Two different things are being separated here, and conflating them is how a
 * retail system ends up with a catch that swallows a credit-limit breach.
 *
 * A **defect** — a null where there cannot be one, a query against a column
 * that does not exist, a disk that will not write — throws. It is nobody's
 * decision, there is nothing to render, and the only correct response is to
 * abandon the transaction and record the failure.
 *
 * A **refusal** is an ordinary business answer: the customer is over the credit
 * limit (SAL-03), the price is below the minimum (PRC-07), the period is closed
 * (FIN-06), the count is frozen (CNT-04). It is expected, it is a value, it has
 * to reach the screen with enough in it to tell the cashier what happened and
 * what would authorise it. Throwing it loses that shape, and makes the one case
 * the caller must handle look exactly like the ones it must not.
 */

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return Object.freeze({ ok: true as const, value });
}

export function err<E>(error: E): Err<E> {
  return Object.freeze({ ok: false as const, error });
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

/** Transforms the value of a success, leaving a refusal alone. */
export function mapOk<T, E, U>(result: Result<T, E>, transform: (value: T) => U): Result<U, E> {
  return result.ok ? ok(transform(result.value)) : result;
}

/** Transforms a refusal, leaving a success alone. */
export function mapError<T, E, F>(result: Result<T, E>, transform: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(transform(result.error));
}

/** Runs the next step only if this one succeeded, carrying the first refusal out. */
export function andThen<T, E, U>(
  result: Result<T, E>,
  next: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? next(result.value) : result;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Takes the value, or throws the error the caller builds from the refusal.
 *
 * The error is constructed by the caller rather than here, because the boundary
 * that gives up on a refusal is the one that knows what kind of failure it has
 * become: a startup that cannot proceed, a job that will be retried, a request
 * that becomes a 4xx.
 */
export function orThrow<T, E>(result: Result<T, E>, toError: (error: E) => Error): T {
  if (result.ok) {
    return result.value;
  }
  throw toError(result.error);
}

/**
 * A value that may appear in a refusal's message.
 *
 * Deliberately narrow. Everything that reaches a person goes through the
 * translator, and a formatter cannot be handed an object of unknown shape.
 */
export type RefusalValue = string | number | boolean;

/**
 * Why an operation was refused, in a form the interface can render.
 *
 * It carries a **code and its values, never a sentence**. design-system.md §12
 * puts every user-facing string in the terminology layer, and a refusal is the
 * text a cashier reads most often under pressure — it is exactly the string a
 * tenant renames, and exactly the one that has to exist in both languages.
 *
 * The code is namespaced by what refused: sal.credit-limit-exceeded,
 * fin.period-closed. That prefix is also what lets a screen decide whether it
 * knows how to offer an authorisation path for this particular refusal.
 */
export interface Refusal<Code extends string = string> {
  readonly code: Code;
  readonly values: Readonly<Record<string, RefusalValue>>;
}

const NO_VALUES: Readonly<Record<string, RefusalValue>> = Object.freeze({});

export function refusal<Code extends string>(
  code: Code,
  values: Readonly<Record<string, RefusalValue>> = NO_VALUES,
): Refusal<Code> {
  return Object.freeze({ code, values: Object.freeze({ ...values }) });
}

/** A refused outcome, in one call: refuse('fin.period-closed', { period: '2026-03' }). */
export function refuse<Code extends string>(
  code: Code,
  values?: Readonly<Record<string, RefusalValue>>,
): Err<Refusal<Code>> {
  return err(refusal(code, values));
}
