import type { BranchId, TenantId } from '@vertex/contracts';
import { ok, refuse, type Result } from '@vertex/kernel';

import type { OrganisationRefusal, RecordSession } from './contract.js';
import { readRecord, writeRecord, type SettingRecord } from './records.js';
import { branchIn } from './structure.js';

/**
 * Per-branch settings: the second half of `SYS-09`'s first sentence.
 *
 * A value is set for the tenant and a branch may override it, which is what
 * lets one shop in a chain round differently, print a different footer, or open
 * at a different hour without any of it being a code change.
 *
 * `SYS` stores the value and never interprets it. What a setting means belongs
 * to the module that declared it — `modules.md` §4 again — so the value is a
 * string and the reader parses it. A fact `SYS` itself owns is a field instead:
 * a branch's address and place are `SYS-14`'s, and live on the branch.
 */

/** The tenant's own value sits under a scope that cannot be a branch identifier. */
const TENANT_SCOPE = '-';

function settingRecord(
  session: RecordSession,
  tenant: TenantId,
  scope: string,
  key: string,
): SettingRecord | null {
  return readRecord(session, 'setting', tenant, [scope, key]);
}

export function settingIn(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  key: string,
): string | null {
  const override = settingRecord(session, tenant, branch, key);
  if (override !== null && override.value !== null) return override.value;
  return settingRecord(session, tenant, TENANT_SCOPE, key)?.value ?? null;
}

/**
 * Clearing writes `null` instead of removing the row.
 *
 * The store this module holds cannot delete — see `records.ts` — and that is
 * not an obstacle here but the same rule applying: a branch that reverts to the
 * tenant's value has said something, and the row that says it is also what an
 * audit of who changed what will later hang on.
 */
export function setBranchSetting(
  session: RecordSession,
  tenant: TenantId,
  branch: BranchId,
  key: string,
  value: string | null,
): Result<void, OrganisationRefusal> {
  // Checked rather than assumed: a setting written against a branch that does
  // not exist is a row nothing will ever read, and the mistake is silent.
  if (branchIn(session, tenant, branch) === null) return refuse('sys.branch-not-found', { branch });
  writeRecord(session, 'setting', tenant, [branch, key], { value });
  return ok(undefined);
}

export function setTenantSetting(
  session: RecordSession,
  tenant: TenantId,
  key: string,
  value: string | null,
): Result<void, OrganisationRefusal> {
  writeRecord(session, 'setting', tenant, [TENANT_SCOPE, key], { value });
  return ok(undefined);
}
