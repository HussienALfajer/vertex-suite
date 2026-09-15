/**
 * The seven roles of `SEC-01`, as a name any module is allowed to say.
 *
 * `SEC` owns roles. But every module declares its own rights (`modules.md` §4.4)
 * and has to be able to say which of the seven hold each one by default —
 * otherwise `SEC` would have to carry a table of every other module's rights,
 * and shipping `CAT` would mean editing `SEC` to tell it what a warehouse
 * keeper does with an item.
 *
 * A module cannot ask `SEC` for the names either: `SEC` depends on `SYS`
 * (`modules.md` §3), so a right declared in `SYS` that imported `SEC` to name a
 * role would be exactly the cycle §4 exists to prevent. The names are therefore
 * vocabulary shared by everyone and owned by nobody, which is what this package
 * is for.
 *
 * **Seeding is all these are.** From the moment a role is seeded it is an
 * ordinary editable row (`SEC-01`): an administrator renames it, changes what
 * it holds, withdraws it, or adds a role named here nowhere. So nothing in this
 * system may branch on one of these values to decide what somebody may do — a
 * check for "is the owner" is a right that does not appear in the role editor,
 * cannot be granted to the assistant manager covering a holiday, and is
 * invisible to the administrator wondering why.
 */
export const SEEDED_ROLES = [
  'owner',
  'manager',
  'accountant',
  'purchasing',
  'warehouse-keeper',
  'floor-supervisor',
  'cashier',
] as const;

export type SeededRole = (typeof SEEDED_ROLES)[number];

const SEEDED: ReadonlySet<string> = new Set(SEEDED_ROLES);

export function isSeededRole(value: string): value is SeededRole {
  return SEEDED.has(value);
}

/**
 * The one role no module lists a right for.
 *
 * The owner holds **every right this edition declares**, computed rather than
 * enumerated, and that is the difference between a rule and a list. A list is
 * something a module can forget to add itself to — and the symptom of
 * forgetting is an owner who cannot do one particular thing in their own shop,
 * with nothing anywhere saying why. `SEC` seeds the owner from what the
 * registry reports, so a module that ships tomorrow is covered by a decision
 * taken today.
 */
export const OWNER: SeededRole = 'owner';
