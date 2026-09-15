import type { Id } from '@vertex/kernel';

/**
 * The identifiers that appear on more than one module's rows.
 *
 * A stock movement names a location; a sale names a register; every document
 * ever written names the user who wrote it. `STK` and `POS` therefore have to
 * be able to **say** `location` and `register` in their own tables — and
 * `modules.md` §4 does not let either of them import `SYS` to do it.
 *
 * So the identifier is vocabulary and the entity is property. Naming a branch
 * costs nothing and commits to nothing; the branch itself — its settings, its
 * activation state, the rule that it is deactivated and never deleted — is
 * `SYS`'s alone, reached through `SYS`'s contract or not at all. That
 * separation is also what keeps §4.3 meaningful: holding an identifier is not a
 * join, and a module that only ever holds one cannot accidentally grow into the
 * other module's data.
 *
 * Only the entities that genuinely cross a boundary are here. A role, a
 * permission grant, an audit record and a numbering series never leave the
 * module that owns them, and putting their identifiers in a shared package
 * would advertise a reach that is not permitted.
 */

/** The shop group a store node holds data for. No query is allowed not to know it. */
export type TenantId = Id<'tenant'>;

/** A legal entity within the tenant; what a document is issued by (`SYS-09`). */
export type CompanyId = Id<'company'>;

/** A trading site. Permissions, numbering and stock are all scoped by it. */
export type BranchId = Id<'branch'>;

/** A place stock sits: a shop floor, a store room, a van (`SYS-09`, `STK-01`). */
export type LocationId = Id<'location'>;

/** A till position, which is not the device standing at it (`SYS-02`, `POS-19`). */
export type RegisterId = Id<'register'>;

/** Who did it. Deactivated and never deleted, so old documents stay attributable. */
export type UserId = Id<'user'>;

/** The physical machine. `SYN-02` sequences the outbox per one of these. */
export type DeviceId = Id<'device'>;
