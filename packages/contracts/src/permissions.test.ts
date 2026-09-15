import { describe, expect, it } from 'vitest';

import { InvalidPermissionIdError } from './errors.js';
import {
  isPermissionId,
  isStandardAction,
  operation,
  parsePermissionId,
  partsOf,
  permissionId,
  STANDARD_ACTIONS,
} from './permissions.js';

describe('the standard actions', () => {
  // Named without a feature identifier on purpose. The claim "permissions are
  // granted per action" (SEC-02) is SEC's to prove when it grants one; spelling
  // five strings correctly is a prerequisite, and check:coverage reads names, so
  // a name here would let a vocabulary test stand in for the feature itself.
  it('are the five the specification names, in the order it states them', () => {
    expect(STANDARD_ACTIONS).toEqual(['view', 'create', 'edit', 'delete', 'approve']);
  });

  it('are a closed set, so two modules cannot spell one intent two ways', () => {
    expect(isStandardAction('delete')).toBe(true);
    expect(isStandardAction('remove')).toBe(false);
    expect(isStandardAction('Delete')).toBe(false);
  });

  it('cannot be extended by assignment', () => {
    expect(Object.isFrozen(STANDARD_ACTIONS)).toBe(true);
  });
});

describe('permissionId', () => {
  it('composes the namespace, the resource and the action', () => {
    expect(permissionId('sec', 'user', 'create')).toBe('sec.user.create');
  });

  // SEC-09 needs to grant a password reset separately from an edit; that the
  // grammar can carry one is this package's part of it, and no more.
  it('carries an operation outside the five', () => {
    expect(permissionId('sec', 'user', operation('reset-password'))).toBe(
      'sec.user.reset-password',
    );
  });

  it('refuses a segment that would make the identifier unreadable', () => {
    expect(() => permissionId('sec', 'user.password', 'edit')).toThrow(InvalidPermissionIdError);
    expect(() => permissionId('', 'user', 'view')).toThrow(InvalidPermissionIdError);
    expect(() => permissionId('SEC', 'user', 'view')).toThrow(InvalidPermissionIdError);
    expect(() => permissionId('sec', 'User Account', 'view')).toThrow(InvalidPermissionIdError);
  });

  it('accepts the kebab case the rest of the system writes names in', () => {
    expect(permissionId('sys', 'numbering-series', 'edit')).toBe('sys.numbering-series.edit');
  });
});

describe('operation', () => {
  it('refuses a name that is already one of the five', () => {
    expect(() => operation('approve')).toThrow(InvalidPermissionIdError);
  });

  it('refuses a name that is not lower kebab case', () => {
    expect(() => operation('resetPassword')).toThrow(InvalidPermissionIdError);
    expect(() => operation('')).toThrow(InvalidPermissionIdError);
  });
});

describe('parsePermissionId', () => {
  it('reads back what permissionId wrote', () => {
    const id = permissionId('sys', 'branch', 'approve');
    expect(parsePermissionId('sys.branch.approve')).toBe(id);
    expect(partsOf(id)).toEqual({ namespace: 'sys', resource: 'branch', action: 'approve' });
  });

  it('refuses a spelling that differs from the declaration only in case or padding', () => {
    expect(() => parsePermissionId(' sec.user.create ')).toThrow(InvalidPermissionIdError);
    expect(() => parsePermissionId('SEC.user.create')).toThrow(InvalidPermissionIdError);
  });

  it('refuses anything that is not three segments', () => {
    expect(() => parsePermissionId('sec.user')).toThrow(InvalidPermissionIdError);
    expect(() => parsePermissionId('sec.user.create.now')).toThrow(InvalidPermissionIdError);
    expect(() => parsePermissionId('create')).toThrow(InvalidPermissionIdError);
  });

  it('is total as a predicate, so a stored grant can be checked without a try', () => {
    expect(isPermissionId('sec.user.create')).toBe(true);
    expect(isPermissionId('sec.user')).toBe(false);
    expect(isPermissionId('')).toBe(false);
  });
});
