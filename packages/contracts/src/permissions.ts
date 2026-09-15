import { InvalidPermissionIdError } from './errors.js';

/**
 * The grammar of a permission: `<module>.<resource>.<action>`.
 *
 * `SEC-02` grants a right **per action, not per screen**, so that a role can
 * view a document without being able to approve it. That sentence is a shape:
 * three parts, one of which is drawn from a small fixed set, which is what lets
 * `SEC-01`'s role editor draw a grid an owner can read in one pass instead of a
 * list of several hundred sentences.
 *
 * What lives here is the grammar and nothing else. Which permissions exist is
 * each module's own declaration, and whether a given user holds one is `SEC`'s
 * answer; this package knows about no module and can decide neither. The
 * division is deliberate: `platform` already refuses a declaration whose name
 * falls outside the declaring module's namespace, so ownership is checked where
 * ownership is known, and spelling is checked where spelling is known.
 */

declare const PermissionIdBrand: unique symbol;
declare const OperationBrand: unique symbol;

/**
 * One segment of a name, in the case the whole system writes names in:
 * `sec`, `user`, `numbering-series`, `reset-password`.
 */
const SEGMENT = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * The five of `SEC-02`, in the order the feature states them.
 *
 * Closed, and frozen, because the alternative is two modules spelling one
 * intent two ways — `delete` here and `remove` there — and a role editor that
 * cannot put them in the same column. An owner deciding who may approve a
 * purchase invoice is not helped by learning which verb that module's author
 * preferred.
 */
export const STANDARD_ACTIONS = Object.freeze([
  'view',
  'create',
  'edit',
  'delete',
  'approve',
] as const);

export type StandardAction = (typeof STANDARD_ACTIONS)[number];

/**
 * An action that is genuinely not one of the five.
 *
 * `SEC-09` needs `reset-password` and `force-sign-out`; neither is a create or
 * an edit, and flattening them into one would hide from an administrator
 * exactly the right they are most careful about granting. Forcing every
 * operation through the five verbs would have been the tidier model and the
 * wrong one.
 *
 * It is a separate type rather than a plain string so that leaving the grid is
 * something a module has to **say**: `permissionId('sec', 'user', 'create')`
 * type-checks against the five and catches the typo, while anything else has to
 * be written as `operation('reset-password')` and is greppable ever after.
 */
export type Operation = string & { readonly [OperationBrand]: 'operation' };

export type Action = StandardAction | Operation;

/** A complete permission identifier: `sec.user.create`, `sys.branch.approve`. */
export type PermissionId = string & { readonly [PermissionIdBrand]: 'permission' };

const STANDARD: ReadonlySet<string> = new Set(STANDARD_ACTIONS);

export function isStandardAction(value: string): value is StandardAction {
  return STANDARD.has(value);
}

function requireSegment(part: string, what: string, whole: string): void {
  if (!SEGMENT.test(part)) {
    throw new InvalidPermissionIdError(
      `"${part}" is not a ${what}. A permission is three lower-case segments separated by ` +
        `dots — ${whole} — so that one reading of the name says who owns the right, over ` +
        'what, and to do what.',
    );
  }
}

/**
 * Names an action outside the five.
 *
 * Refuses one of the five by that name: the same right spelled two ways is the
 * failure the closed set exists to prevent, and it would be invisible — both
 * spellings work, and a role granted one simply does not hold the other.
 */
export function operation(name: string): Operation {
  if (isStandardAction(name)) {
    throw new InvalidPermissionIdError(
      `"${name}" is already one of the five standard actions. Pass it directly; an operation ` +
        'of the same name would be a second right that looks like the first.',
    );
  }
  requireSegment(name, 'action', '<module>.<resource>.<action>');
  return name as Operation;
}

/** Composes an identifier. Every part is checked, because every part ends up in a grant. */
export function permissionId(namespace: string, resource: string, action: Action): PermissionId {
  requireSegment(namespace, 'module namespace', '<module>.<resource>.<action>');
  requireSegment(resource, 'resource name', '<module>.<resource>.<action>');
  requireSegment(action, 'action', '<module>.<resource>.<action>');
  return `${namespace}.${resource}.${action}` as PermissionId;
}

function parts(value: string): [string, string, string] | null {
  const segments = value.split('.');
  if (segments.length !== 3) return null;
  const [namespace, resource, action] = segments as [string, string, string];
  if (!SEGMENT.test(namespace) || !SEGMENT.test(resource) || !SEGMENT.test(action)) return null;
  return [namespace, resource, action];
}

/**
 * Whether a string is a permission identifier, without throwing.
 *
 * For a grant read back from storage or arriving over sync, where the question
 * is asked about data rather than about code.
 */
export function isPermissionId(value: string): boolean {
  return parts(value) !== null;
}

/**
 * Reads an identifier, in the one spelling the system writes.
 *
 * Neither trimmed nor lower-cased on the way in, which is where this differs
 * from `parseId`. A uuid's case carries no meaning, so normalising one loses
 * nothing; `SEC.user.create` is a different string from the `sec.user.create`
 * that `platform` checked when the module declared it, and quietly repairing it
 * would hide whatever wrote it that way — a hand-edited seed, a spreadsheet
 * import, a serialiser that upper-cases keys. A grant that silently repairs
 * itself is a grant nobody can reason about.
 */
export function parsePermissionId(value: string): PermissionId {
  if (parts(value) === null) {
    throw new InvalidPermissionIdError(
      `"${value}" is not a permission identifier. The form is <module>.<resource>.<action>, ` +
        'all lower case, exactly as the module declared it.',
    );
  }
  return value as PermissionId;
}

/** The three parts, for a role editor that groups rights by module and resource. */
export function partsOf(id: PermissionId): {
  readonly namespace: string;
  readonly resource: string;
  readonly action: Action;
} {
  const split = parts(id);
  if (split === null) {
    // Unreachable through the type: a PermissionId only comes from the two
    // functions above, and both check. A cast somewhere would be the defect.
    throw new InvalidPermissionIdError(`"${id}" is not a permission identifier.`);
  }
  const [namespace, resource, action] = split;
  return Object.freeze({ namespace, resource, action: action as Action });
}
