import { newId, parseId } from '@vertex/kernel';
import { describe, expect, it } from 'vitest';

import type { BranchId, LocationId, RegisterId, TenantId, UserId } from './identity.js';

/** Stands in for any module that records a location without owning one. */
function records(id: LocationId): LocationId {
  return id;
}

describe('the identifiers that cross a module boundary', () => {
  it('cannot be substituted for one another', () => {
    const branch = newId<'branch'>();
    const location = newId<'location'>();

    expect(records(location)).toBe(location);
    // @ts-expect-error — a branch is not a location, though both are uuid strings.
    records(branch);

    expect(branch).not.toBe(location);
  });

  it('are plain uuids once the types are erased, because a module stores them in its own rows', () => {
    const stored = newId<'register'>();
    const read: RegisterId = parseId<'register'>(stored);

    expect(read).toBe(stored);
    expect(typeof read).toBe('string');
    expect(JSON.stringify({ register: read })).toBe(`{"register":"${stored}"}`);
  });

  it('name the entities of SYS and SEC without importing either of them', () => {
    const tenant: TenantId = newId<'tenant'>();
    const user: UserId = newId<'user'>();
    const branch: BranchId = newId<'branch'>();

    // A module holding one of these holds a value, not a row: modules.md §4.3
    // forbids the join that would turn it into the other module's data.
    expect(new Set([tenant, user, branch]).size).toBe(3);
  });
});
