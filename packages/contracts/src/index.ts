/**
 * The vocabulary more than one module has to agree on, and no module owns.
 *
 * It holds four things and refuses to hold a fifth until something needs it.
 * The package map (`modules.md` §2) also lists event schemas and account codes
 * here: the envelope and the typed event name already live in `platform`, and
 * the account **role** — `stk.inventory` rather than `1200`, because `FIN-01`
 * gives every tenant its own chart — is declared by the module that posts to
 * it. A shared list of either would be a file with nothing in it yet, which is
 * a promise rather than a boundary.
 *
 * The third arrived when something needed it: a module declaring a right has to
 * name the seeded roles that hold it, and cannot import `SEC` to do so without
 * creating the cycle `SEC` depending on `SYS` already rules out.
 *
 * The fourth arrived the same way, with the ledger: a module declaring an
 * account role has to name the reserved purpose it expects (`FIN-01`), and
 * cannot import `FIN` to do so — `FX` posts a rounding residual and `FIN`
 * depends on `FX`.
 */
export { InvalidPermissionIdError, VocabularyError } from './errors.js';

export type {
  BranchId,
  CompanyId,
  DeviceId,
  LocationId,
  RegisterId,
  TenantId,
  UserId,
} from './identity.js';

export { isSeededRole, OWNER, SEEDED_ROLES, type SeededRole } from './roles.js';

export {
  isReservedAccount,
  PER_CURRENCY_ACCOUNT,
  RESERVED_ACCOUNTS,
  type ReservedAccount,
} from './accounts.js';

export {
  isPermissionId,
  isStandardAction,
  operation,
  parsePermissionId,
  partsOf,
  permissionId,
  STANDARD_ACTIONS,
  type Action,
  type Operation,
  type PermissionId,
  type StandardAction,
} from './permissions.js';
